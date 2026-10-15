use std::sync::Arc;

use crate::action::{Action, ActionError, ValidatedAction};
use crate::addon::{Addon, AddonId, Manifest};
use crate::cache::CatalogCache;
use crate::catalog::{CatalogRow, Page};
use crate::fetcher::Fetcher;
use crate::request::{CatalogRef, Extra, ResourceRequest, CATALOG};
use crate::response::{Answer, Response};
use crate::snapshot::Snapshot;
use crate::state::{Change, Persist, State};
use crate::store::{Store, StoreError};

/// The Host: its state, and the one door to it.
///
/// Every Action — from the window, from a remote client, from a timer — arrives
/// at [`Host::dispatch`], and every publication leaves as a [`Response`]: the
/// Snapshots every client is owed, and the answer only the client that asked
/// gets. There is no second path (ADR-0002).
pub struct Host {
    store: Arc<dyn Store>,
    fetcher: Arc<dyn Fetcher>,
    state: State,
    revision: u64,
    /// Pages the Addons have already answered, so that a re-request inside the
    /// Addon's own `cacheMaxAge` never reaches the network.
    cache: CatalogCache,
}

impl Host {
    /// Load the Host's state from the store.
    ///
    /// Preparing the store — creating the database, running its migrations — is
    /// the store's own concern; by the time this is called the store can be read.
    /// The fetcher is only needed once an Action asks for something over the
    /// network, so a Host with no Addons never touches it.
    pub fn new(store: Arc<dyn Store>, fetcher: Arc<dyn Fetcher>) -> Result<Self, StoreError> {
        let state = State::holding(store.read_preferences()?, store.read_addons()?);
        Ok(Self {
            store,
            fetcher,
            state,
            revision: 0,
            cache: CatalogCache::default(),
        })
    }

    /// The state as it stands — what a client that has just connected, or just
    /// reconnected, is owed.
    pub fn snapshot(&self) -> Snapshot {
        Snapshot::build(&self.state, self.revision)
    }

    /// Take an Action, and publish or answer what came of it.
    ///
    /// Validation is pure and comes first, then whatever I/O the Action needs,
    /// and only then the state. An Action that is rejected, that cannot be
    /// fetched, or that the store refuses leaves the state and every future
    /// Snapshot exactly as they were.
    pub fn dispatch(&mut self, action: Action) -> Result<Response, ActionError> {
        let validated = action.validate()?;

        let change = match self.resolve(validated)? {
            Resolved::Change(change) => change,
            // A question changed nothing anyone else can see, so there is no
            // Snapshot to publish and the revision does not move.
            Resolved::Answer(answer) => return Ok(Response::answered(answer)),
        };

        let mut next = self.state.clone();
        let persist = next.apply(change);
        match persist {
            Persist::Preferences => self.store.write_preferences(next.preferences()),
            Persist::Addons => self.store.write_addons(next.addons()),
        }
        .map_err(|error| ActionError::Store {
            detail: error.to_string(),
        })?;

        self.state = next;
        self.revision += 1;
        Ok(Response::published(vec![self.snapshot()]))
    }

    /// Turn a validated Action into the change it will make, or the answer it
    /// will give.
    ///
    /// This is where an Action's I/O happens: an Addon's manifest, or a page of
    /// one of its catalogs, is fetched and read here, so that what reaches state
    /// is already a decided thing. A failure here has touched neither state nor
    /// store.
    fn resolve(&mut self, validated: ValidatedAction) -> Result<Resolved, ActionError> {
        Ok(match validated {
            ValidatedAction::SetSubtitleLanguage(language) => {
                Resolved::Change(Change::SetSubtitleLanguage(language))
            }
            ValidatedAction::ClearSubtitleLanguage => {
                Resolved::Change(Change::ClearSubtitleLanguage)
            }
            ValidatedAction::AddAddon(url) => {
                let body =
                    self.fetcher
                        .fetch(url.as_str())
                        .map_err(|error| ActionError::Fetch {
                            detail: error.to_string(),
                        })?;
                let manifest = Manifest::parse(&body).map_err(|error| ActionError::Manifest {
                    detail: error.to_string(),
                })?;
                Resolved::Change(Change::AddAddon(Box::new(Addon::new(url, manifest))))
            }
            ValidatedAction::RemoveAddon(id) => {
                if !self.state.has_addon(&id) {
                    return Err(ActionError::UnknownAddon {
                        id: id.as_str().to_owned(),
                    });
                }
                Resolved::Change(Change::RemoveAddon(id))
            }
            ValidatedAction::BrowseCatalog {
                addon,
                catalog,
                extra,
            } => {
                let configured = self.addon(&addon)?;
                let requested = ResourceRequest::new(CATALOG, &catalog.r#type, &catalog.id)
                    .with_extra(with_required_values(configured.manifest(), &catalog, extra));
                if !configured.manifest().answers(&requested) {
                    return Err(why_not(configured.manifest(), &catalog, &requested));
                }

                let row = self.catalog_row(&configured, &requested);
                Resolved::Answer(Answer::Catalogs(vec![row]))
            }
            ValidatedAction::SearchCatalogs { query } => {
                // Every catalog that offers a search, in the order the Addons
                // were configured and each Addon's own order within that. One
                // Addon failing is one row with nothing in it, not a failed
                // search (ADR-0010).
                let plan: Vec<(Addon, ResourceRequest)> = self
                    .state
                    .addons()
                    .iter()
                    .flat_map(|addon| {
                        addon.manifest().catalogs.iter().filter_map(|catalog| {
                            let extra = catalog.search_extra(&query)?;
                            Some((
                                addon.clone(),
                                ResourceRequest::new(
                                    CATALOG,
                                    catalog.r#type.as_str(),
                                    catalog.id.as_str(),
                                )
                                .with_extra(extra),
                            ))
                        })
                    })
                    .collect();

                let rows = plan
                    .iter()
                    .map(|(addon, requested)| self.catalog_row(addon, requested))
                    .collect();
                Resolved::Answer(Answer::Catalogs(rows))
            }
        })
    }

    /// One configured Addon, or the refusal that names it.
    fn addon(&self, id: &AddonId) -> Result<Addon, ActionError> {
        self.state
            .addon(id)
            .cloned()
            .ok_or_else(|| ActionError::UnknownAddon {
                id: id.as_str().to_owned(),
            })
    }

    /// One catalog row: what is cached, or what the Addon answers, or why it
    /// could not answer — with what was cached served instead when the Addon
    /// said it may be.
    fn catalog_row(&mut self, addon: &Addon, requested: &ResourceRequest) -> CatalogRow {
        let url = requested.url(addon.manifest_url().as_str());
        let name = addon
            .manifest()
            .catalog(&requested.r#type, &requested.id)
            .map(|catalog| catalog.name.clone())
            .unwrap_or_else(|| requested.id.clone());

        let (sent, metas, failure) = match self.cache.fresh(&url) {
            Some(page) => (page.sent, page.metas, None),
            None => match self.fetch_page(&url) {
                Ok(page) => (page.sent, page.metas, None),
                Err(failure) => match self.cache.when_stale(&url) {
                    Some(page) => (page.sent, page.metas, None),
                    None => (0, Vec::new(), Some(failure)),
                },
            },
        };

        CatalogRow {
            addon: addon.id().clone(),
            r#type: requested.r#type.clone(),
            id: requested.id.clone(),
            name,
            sent,
            metas,
            failure,
        }
    }

    /// Fetch one page and keep it for as long as its Addon says it lasts.
    fn fetch_page(&mut self, url: &str) -> Result<Page, ActionError> {
        let body = self
            .fetcher
            .fetch(url)
            .map_err(|error| ActionError::Fetch {
                detail: error.to_string(),
            })?;
        let page = Page::parse(&body).map_err(|error| ActionError::Catalog {
            detail: error.to_string(),
        })?;

        self.cache
            .keep(url, page.sent, page.metas.clone(), page.hints);
        Ok(page)
    }
}

/// An Action with everything it needed already resolved.
enum Resolved {
    Change(Change),
    Answer(Answer),
}

/// The values a catalog requires, filled in from what it offers when the client
/// did not choose them.
fn with_required_values(
    manifest: &Manifest,
    catalog: &CatalogRef,
    chosen: Vec<Extra>,
) -> Vec<Extra> {
    match manifest.catalog(&catalog.r#type, &catalog.id) {
        Some(declared) => declared.with_defaults(chosen),
        None => chosen,
    }
}

/// Why an Addon will not answer this request, in the Host's own words.
///
/// Only reached when the request is one the Addon does not answer: a catalog it
/// never declared, a value it never declared, or one it requires and offers no
/// value to default to.
fn why_not(
    manifest: &Manifest,
    reference: &CatalogRef,
    requested: &ResourceRequest,
) -> ActionError {
    let Some(catalog) = manifest.catalog(&reference.r#type, &reference.id) else {
        return ActionError::UnknownCatalog {
            addon: manifest.id.clone(),
            catalog: reference.clone(),
        };
    };
    let named = reference;

    if let Some(unknown) = requested
        .extra
        .iter()
        .find(|chosen| !catalog.extra.iter().any(|prop| prop.name == chosen.name))
    {
        return ActionError::Extra {
            detail: format!("the catalog {named} does not take {:?}", unknown.name),
        };
    }
    if let Some(missing) = catalog.extra.iter().find(|prop| {
        prop.is_required
            && !requested
                .extra
                .iter()
                .any(|chosen| chosen.name == prop.name)
    }) {
        return ActionError::Extra {
            detail: format!(
                "the catalog {named} needs {:?}, and its Addon offers no value to default to",
                missing.name
            ),
        };
    }

    ActionError::Extra {
        detail: format!("the catalog {named} cannot be asked for with those values"),
    }
}
