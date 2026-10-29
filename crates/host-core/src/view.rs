//! A frozen view of the Host, and the questions that resolve from it.
//!
//! A question — browsing a Catalog, searching, Discover, opening a Title,
//! finding Streams — reads state and then reaches the network. It must not hold
//! the Host's change lock for the length of that fetch, or one slow Addon queues
//! every other client behind it (ADR-0022).
//!
//! So the door clones a [`HostView`] under a short lock and lets the question
//! resolve outside it. What is frozen is the Addon list, which is the state a
//! question reads: a question that was dispatched before an Addon was removed may
//! still answer from it, and a change never waits for the question's fetch. The
//! credential and the page cache are *shared* rather than copied — a credential
//! is read at the moment of use and the cache is a memo, not state a client sees.
//!
//! The two questions that ask a set of Addons — `search_catalogs` and
//! `find_streams` — fan their asks out inside the question, under a bound, and
//! still answer in configured order (ADR-0023).

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::action::{ActionError, ValidatedAction};
use crate::addon::{Addon, AddonId, Manifest, MAX_ITEMS};
use crate::cache::CatalogCache;
use crate::catalog::{CatalogRow, Page};
use crate::discover::DiscoverRow;
use crate::fetcher::{FetchError, Fetcher};
use crate::library::{Library, LibraryCache};
use crate::log::millis;
use crate::meta::{self, Title, Video};
use crate::preview::{PreviewCeiling, Previewer};
use crate::provider::Provider;
use crate::request::{
    CatalogRef, Extra, ResourceRequest, TitleRef, VideoRef, CATALOG, META, STREAM,
};
use crate::response::Answer;
use crate::secret::{CredentialKind, SecretStore};
use crate::stream::AddonStreams;
use crate::stremio::StremioApi;
use crate::tmdb;

/// The Host as a question sees it: the Addon list frozen at dispatch, the seams
/// it reaches, and the one page cache every view shares.
///
/// Built by [`crate::Host::view`] under the change lock. Every field is either
/// owned or an `Arc`, so the view is `Send + Sync` and a question resolves on any
/// thread without the Host's state lock.
/// The seams and memos a view shares with the Host and every other view.
///
/// Grouped so [`HostView::new`] names one shared thing rather than growing an
/// argument list every time a question gains a seam; the fields are still one
/// `Arc` each, never a copied Host state.
pub(crate) struct HostViewShared {
    pub(crate) cache: Arc<Mutex<CatalogCache>>,
    pub(crate) library_cache: Arc<Mutex<LibraryCache>>,
    pub(crate) stremio: Option<Arc<dyn StremioApi>>,
}

pub struct HostView {
    /// The configured Addons, in the Host's order, as they stood when the view
    /// was taken. A change that removes one afterwards does not invalidate a
    /// question already dispatched (ADR-0022).
    addons: Vec<Addon>,
    fetcher: Arc<dyn Fetcher>,
    provider: Arc<dyn Provider>,
    secrets: Arc<dyn SecretStore>,
    /// The stills of the Stream playing, asked for by a client pointing at its
    /// timeline. Shared with the Host and every view; the URL it holds never
    /// leaves it (ADR-0028).
    previewer: Arc<dyn Previewer>,
    /// Whether the Stream may be previewed, as the Host last decided it. Frozen
    /// with the rest of the view, so a still is never asked for on a Stream whose
    /// ceiling has not been settled — or has been settled against it.
    preview_gate: PreviewCeiling,
    /// The pages Addons have already answered, shared with the Host and every
    /// other view. Its lock is taken for `fresh`, `when_stale` and `keep` and is
    /// never held across a fetch: two questions asking for different pages do not
    /// queue behind each other.
    cache: Arc<Mutex<CatalogCache>>,
    /// The account's Library documents, shared with the Host and every view.
    /// Like the catalog cache this is a memo: a question takes the lock for the
    /// plan, the keep and the read, never across the account's network call.
    library_cache: Arc<Mutex<LibraryCache>>,
    /// The account API, where the Host was built with one. No account or no
    /// `authKey` is a Host that does not read the room; the key itself is read
    /// from the secret store at the moment of the ask (ADR-0029).
    stremio: Option<Arc<dyn StremioApi>>,
}

impl HostView {
    pub(crate) fn new(
        addons: Vec<Addon>,
        fetcher: Arc<dyn Fetcher>,
        provider: Arc<dyn Provider>,
        secrets: Arc<dyn SecretStore>,
        previewer: Arc<dyn Previewer>,
        preview_gate: PreviewCeiling,
        shared: HostViewShared,
    ) -> Self {
        Self {
            addons,
            fetcher,
            provider,
            secrets,
            previewer,
            preview_gate,
            cache: shared.cache,
            library_cache: shared.library_cache,
            stremio: shared.stremio,
        }
    }

    /// The Addons this view froze, in the Host's order — for a change that walks
    /// them with the same read-only helpers a question uses.
    pub(crate) fn addons(&self) -> &[Addon] {
        &self.addons
    }

    /// Resolve one of the nine questions.
    ///
    /// The door routes by [`ValidatedAction::is_question`](crate::ValidatedAction::is_question);
    /// a change reaching here is a door bug, refused rather than resolved. The
    /// read-only helpers this calls are also used by changes (`Resume`,
    /// `NextEpisode`, `PreviousEpisode`) through their own short view.
    pub fn ask(&self, validated: ValidatedAction) -> Result<Answer, ActionError> {
        Ok(match &validated {
            ValidatedAction::BrowseCatalog {
                addon,
                catalog,
                extra,
            } => {
                let configured = self.addon(addon)?;
                let requested =
                    ResourceRequest::new(CATALOG, &catalog.r#type, &catalog.id).with_extra(
                        with_required_values(configured.manifest(), catalog, extra.clone()),
                    );
                if !configured.manifest().answers(&requested) {
                    return Err(why_not(configured.manifest(), catalog, &requested));
                }

                let row = self.catalog_row(&configured, &requested);
                Answer::Catalogs(vec![row])
            }
            ValidatedAction::SearchCatalogs { query } => {
                // Every catalog that offers a search, in the order the Addons
                // are configured, and each Addon's own order within that. One
                // Addon failing is one row with nothing in it, not a failed
                // search (ADR-0010). The asks fan out, and the rows are written
                // back by plan position, so completion order changes nothing a
                // client sees (ADR-0023).
                let plan: Vec<(&Addon, ResourceRequest)> = self
                    .addons
                    .iter()
                    .flat_map(|addon| {
                        addon.manifest().catalogs.iter().filter_map(move |catalog| {
                            let extra = catalog.search_extra(query)?;
                            Some((
                                addon,
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

                let rows = fan_out(&plan, |(addon, requested)| {
                    let started = Instant::now();
                    let row = self.catalog_row(addon, requested);
                    // A cache hit is still this Addon's row, and still an ask
                    // worth timing; the line has no field for which it was.
                    addon_ask_log(
                        CATALOG,
                        addon.id(),
                        started.elapsed(),
                        row.failure.as_ref().map_or("ok", ActionError::kind),
                    );
                    row
                });
                Answer::Catalogs(rows)
            }
            ValidatedAction::Discover { query } => {
                // A Discover page is never cached: TMDB sends no cache hints to
                // honour and a feed is a live thing whose staleness is worse
                // than its latency, so every page reaches it (ADR-0020). A
                // credential that is not held refuses the ask itself, before a
                // row exists: there is nothing to ask TMDB with.
                let credential = self
                    .tmdb_credential()
                    .ok_or(ActionError::NoTmdbCredential)?;
                let row = self.tmdb_row(&query.request(), query.kind, &credential);
                Answer::Discover(vec![row])
            }
            ValidatedAction::Search { query } => {
                // Search with a key held is TMDB's, and never cached: every
                // submit and every page reaches it (ADR-0010's amendment). With
                // no key held the Addons' catalogs are the whole of Search, and
                // this question names no Addon to fall back to, so it refuses
                // before a row exists.
                let credential = self
                    .tmdb_credential()
                    .ok_or(ActionError::NoTmdbCredential)?;
                let row = self.tmdb_row(&query.request(), query.kind, &credential);
                Answer::Search(row)
            }
            ValidatedAction::OpenTitle { addon, title } => {
                let configured = self.addon(addon)?;
                let requested = ResourceRequest::new(META, &title.r#type, &title.id);
                if !configured.manifest().answers(&requested) {
                    return Err(ActionError::UnknownTitle {
                        addon: configured.id().clone(),
                        title: title.clone(),
                    });
                }

                // The request the Addon was judged on is the one it is asked
                // with: a second construction is a second thing that can drift.
                let mut title = self.fetch_title(&configured, title, &requested)?;
                self.tmdb_refine(&mut title);
                Answer::Title(Box::new(title))
            }
            ValidatedAction::OpenDiscoveredTitle { id, kind } => {
                Answer::Title(Box::new(self.open_discovered(*id, *kind)?))
            }
            ValidatedAction::FindStreams { video } => {
                // Every configured Addon that answers for it, in the order
                // they are configured, each answer a group of its own: one
                // Addon failing is that group with nothing in it, not a
                // question that fails (ADR-0010 — a search's rule, applied to
                // Streams). A TMDB-keyed Video is asked of each Addon in the
                // spelling that Addon declares (ADR-0020). The asks fan out and
                // the groups come back in configured order, never completion
                // order (ADR-0023).
                let asked = self.asks_for(STREAM, video);
                // An Addon that declares no spelling this Host can build is not
                // asked: its group stays empty at its configured index, and it
                // does not take one of the fan-out's eight slots (ADR-0020,
                // ADR-0023). Every other Addon is one ask to be timed.
                let mut slots: Vec<Option<AddonStreams>> = asked
                    .iter()
                    .map(|asked| {
                        asked.requested.is_none().then(|| AddonStreams {
                            addon: asked.addon.id().clone(),
                            streams: Vec::new(),
                            failure: None,
                        })
                    })
                    .collect();
                let asks: Vec<(usize, &Asked)> = asked
                    .iter()
                    .enumerate()
                    .filter(|(_, asked)| asked.requested.is_some())
                    .collect();

                let answers = fan_out(&asks, |(index, asked)| {
                    let requested = asked
                        .requested
                        .as_ref()
                        .expect("the fan-out plan holds only asked Addons");
                    let started = Instant::now();
                    let (streams, failure) = match self.provider.streams(&asked.addon, requested) {
                        Ok(streams) => (streams, None),
                        Err(failure) => (Vec::new(), Some(failure)),
                    };
                    addon_ask_log(
                        STREAM,
                        asked.addon.id(),
                        started.elapsed(),
                        failure.as_ref().map_or("ok", ActionError::kind),
                    );
                    (
                        *index,
                        AddonStreams {
                            addon: asked.addon.id().clone(),
                            streams,
                            failure,
                        },
                    )
                });
                for (index, group) in answers {
                    slots[index] = Some(group);
                }
                Answer::Streams(
                    slots
                        .into_iter()
                        .map(|group| group.expect("every Streams slot is filled"))
                        .collect(),
                )
            }
            // A still for one moment of the Stream playing, from the previewer's
            // own limb — never from the picture on screen (ADR-0028). A Stream
            // whose ceiling is not settled yet, or is settled against it, is
            // never asked about: the gate is what keeps the second connection
            // from being opened for a question that is already answered.
            ValidatedAction::Preview { at } => Answer::Preview {
                at: *at,
                image: self
                    .preview_gate
                    .affordable()
                    .then(|| self.previewer.preview(*at))
                    .flatten()
                    .map(|frame| frame.image().to_owned()),
            },
            ValidatedAction::Library => Answer::Library(self.library()?),
            // The door classifies before it gets here; a change is refused
            // rather than answered. Every change is named, so adding one to
            // `ValidatedAction` fails to compile until it is classified here
            // as well as in `is_question` and `Host::change`.
            ValidatedAction::SetSubtitleLanguage(_)
            | ValidatedAction::ClearSubtitleLanguage
            | ValidatedAction::SetSubtitleColor(_)
            | ValidatedAction::SetSubtitleScale(_)
            | ValidatedAction::SetStreamBuffer(_)
            | ValidatedAction::SetFeaturedCatalog { .. }
            | ValidatedAction::ClearFeaturedCatalog
            | ValidatedAction::AddAddon(_)
            | ValidatedAction::ReorderAddon { .. }
            | ValidatedAction::RemoveAddon(_)
            | ValidatedAction::SetTmdbKey(_)
            | ValidatedAction::ClearTmdbKey
            | ValidatedAction::SignInStremio(_)
            | ValidatedAction::SignOutStremio
            | ValidatedAction::PairDevice { .. }
            | ValidatedAction::RevokeDevice(_)
            | ValidatedAction::PlayStream { .. }
            | ValidatedAction::Resume { .. }
            | ValidatedAction::SetPaused { .. }
            | ValidatedAction::Seek { .. }
            | ValidatedAction::SetAudioTrack { .. }
            | ValidatedAction::SetSubtitleTrack { .. }
            | ValidatedAction::SetSubtitleDelay { .. }
            | ValidatedAction::SetSpeed { .. }
            | ValidatedAction::SetVolume { .. }
            | ValidatedAction::SetMuted { .. }
            | ValidatedAction::NextChapter
            | ValidatedAction::PreviousChapter
            | ValidatedAction::SetChapter { .. }
            | ValidatedAction::SetCrop { .. }
            | ValidatedAction::Autocrop
            | ValidatedAction::SetAspect { .. }
            | ValidatedAction::NextEpisode
            | ValidatedAction::PreviousEpisode
            | ValidatedAction::StopPlayback => {
                return Err(ActionError::Malformed {
                    detail: "a change is not a question".to_owned(),
                })
            }
        })
    }

    /// One configured Addon in this view, or the refusal that names it.
    fn addon(&self, id: &AddonId) -> Result<Addon, ActionError> {
        self.addons
            .iter()
            .find(|addon| addon.id() == id)
            .cloned()
            .ok_or_else(|| ActionError::UnknownAddon {
                id: id.as_str().to_owned(),
            })
    }

    /// One catalog row: what is cached, or what the Addon answers, or why it
    /// could not answer — with what was cached served instead when the Addon
    /// said it may be.
    fn catalog_row(&self, addon: &Addon, requested: &ResourceRequest) -> CatalogRow {
        let url = requested.url(addon.manifest_url().as_str());
        let name = addon
            .manifest()
            .catalog(&requested.r#type, &requested.id)
            .map(|catalog| catalog.name.clone())
            .unwrap_or_else(|| requested.id.clone());

        let (sent, metas, failure) = match self.fresh(&url) {
            Some(page) => (page.sent, page.metas, None),
            None => match self.fetch_page(&url) {
                Ok(page) => (page.sent, page.metas, None),
                Err(failure) => match self.when_stale(&url) {
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
    ///
    /// The fetch and the parse are outside the cache lock, and `keep` takes it
    /// only to write the page back: a slow Addon holds no lock at all.
    fn fetch_page(&self, url: &str) -> Result<Page, ActionError> {
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
            .lock()
            .expect("nothing panics while holding the catalog cache")
            .keep(url, page.sent, page.metas.clone(), page.hints);
        Ok(page)
    }

    /// The page for this URL while the Addon says it is still good.
    fn fresh(&self, url: &str) -> Option<crate::cache::Kept> {
        self.cache
            .lock()
            .expect("nothing panics while holding the catalog cache")
            .fresh(url)
    }

    /// The same, for an Addon that cannot be reached.
    fn when_stale(&self, url: &str) -> Option<crate::cache::Kept> {
        self.cache
            .lock()
            .expect("nothing panics while holding the catalog cache")
            .when_stale(url)
    }

    /// One page of TMDB's, whether a Discover feed or a Search: what TMDB
    /// answered, or why it could not — the failure in the Host's vocabulary, as
    /// a row rather than as a refused screen, so one failed call does not blank
    /// the feed or the row (ADR-0010's amendment, ADR-0020).
    ///
    /// Nothing is kept: the page is read and dropped with the answer that
    /// carried it, so the same page asked for twice reaches TMDB twice.
    fn tmdb_row(
        &self,
        request: &tmdb::TmdbRequest,
        kind: tmdb::Kind,
        credential: &tmdb::Credential,
    ) -> DiscoverRow {
        let protocol = kind.as_protocol().to_owned();
        let failed = |failure: ActionError| DiscoverRow {
            r#type: protocol.clone(),
            sent: 0,
            metas: Vec::new(),
            failure: Some(failure),
        };

        match self.fetch_tmdb(request, credential) {
            Err(error) => failed(tmdb_failure(error)),
            Ok(body) => match tmdb::read_page(&body, kind) {
                Ok(page) => DiscoverRow {
                    r#type: protocol,
                    sent: page.sent,
                    metas: page.metas,
                    failure: None,
                },
                Err(error) => failed(ActionError::Tmdb {
                    detail: error.to_string(),
                }),
            },
        }
    }

    /// Open one Title: what its Addon answers about the item the client asked for.
    ///
    /// A meta answer is not kept in the page cache: a Title is one item the owner
    /// opened on purpose, not a page a client pages through, and the Addon's
    /// `cacheMaxAge` is a hint for the latter (ADR-0010). Nor does it come back as
    /// a row with a failure in it — one Addon was asked for one Title, so an Addon
    /// that cannot answer is an error the window explains, not a Title with
    /// nothing in it that a person would have to guess about.
    ///
    /// `requested` is the request the Addon was already judged against, so the
    /// thing asked for is the thing `Manifest::answers` said yes to.
    pub(crate) fn fetch_title(
        &self,
        addon: &Addon,
        asked: &TitleRef,
        requested: &ResourceRequest,
    ) -> Result<Title, ActionError> {
        let url = requested.url(addon.manifest_url().as_str());
        let body = self
            .fetcher
            .fetch(&url)
            .map_err(|error| ActionError::Fetch {
                detail: error.to_string(),
            })?;

        Title::parse(&body, addon.id().clone(), asked).map_err(|error| ActionError::Meta {
            detail: error.to_string(),
        })
    }

    /// Open a Discovered Title: the record TMDB keeps for it, read whole.
    ///
    /// The one question that needs a TMDB credential to answer at all: a
    /// Discovered Title *is* its TMDB record, so a Host that holds no key has
    /// nothing to open it from, and a TMDB that cannot answer is the answer
    /// refused rather than degraded (ADR-0020).
    fn open_discovered(&self, id: tmdb::TmdbId, kind: tmdb::Kind) -> Result<Title, ActionError> {
        let key = self
            .tmdb_credential()
            .ok_or(ActionError::NoTmdbCredential)?;
        let details = self.tmdb_details(kind, id, &key)?;
        let videos = self.tmdb_videos(&details, id, &key);

        // The record is the whole of it: no Addon answered, and every field
        // TMDB did not give stays empty rather than being invented.
        let mut title = Title {
            addon: None,
            id: tmdb::video_spelling(id, None),
            key: meta::TitleKey::Tmdb { id: id.0 },
            r#type: kind.as_protocol().to_owned(),
            name: tmdb::video_spelling(id, None),
            poster: None,
            background: None,
            logo: None,
            description: None,
            release_info: None,
            runtime: None,
            imdb_rating: None,
            genres: Vec::new(),
            videos: Vec::new(),
        };
        details.with_videos(videos).onto(&mut title);

        Ok(title)
    }

    /// One record's details, read — or why TMDB could not answer at all.
    pub(crate) fn tmdb_details(
        &self,
        kind: tmdb::Kind,
        id: tmdb::TmdbId,
        key: &tmdb::Credential,
    ) -> Result<tmdb::TmdbDetails, ActionError> {
        let request = tmdb::TmdbRequest::Details { kind, id };
        let body = self.fetch_tmdb(&request, key).map_err(tmdb_failure)?;

        tmdb::read_details(&body, kind).map_err(|error| ActionError::Tmdb {
            detail: error.to_string(),
        })
    }

    /// TMDB's Videos for a record: a series' seasons and episodes, read one
    /// season at a time, or `None` where there were none to read.
    ///
    /// `None` is not "a film": it is "TMDB's Videos were not read" — a record
    /// that listed no seasons, or every season's answer failing — and it leaves
    /// the Title's own Videos standing rather than replacing them with
    /// emptiness. A season that could not be fetched or read is skipped rather
    /// than blanking the series around it, the way one bad catalog item is.
    ///
    /// A film is the case where TMDB's Videos and the Title's are one and the
    /// same Video, so there is nothing to replace: the film is played by the id
    /// its Title carries, `tt0133093` through an Addon and `tmdb:603` through
    /// Discover. The two unify in **Continue watching** when the client plays
    /// the spelling TMDB keys — which a TMDB-first Title screen does by its
    /// `key` — and not before; the Host will not renumber a Video the client
    /// named, because the id is what its Streams were found by (ADR-0011).
    pub(crate) fn tmdb_videos(
        &self,
        details: &tmdb::TmdbDetails,
        id: tmdb::TmdbId,
        key: &tmdb::Credential,
    ) -> Option<Vec<Video>> {
        if details.seasons.is_empty() {
            return None;
        }

        let mut read_any = false;
        let mut videos: Vec<Video> = Vec::new();
        for season in &details.seasons {
            if videos.len() >= MAX_ITEMS {
                break;
            }
            let request = tmdb::TmdbRequest::Season {
                id,
                season: *season,
            };
            let Ok(body) = self.fetch_tmdb(&request, key) else {
                continue;
            };
            if let Ok(episodes) = tmdb::read_season(&body, id, *season) {
                read_any = true;
                videos.extend(episodes);
            }
        }
        videos.truncate(MAX_ITEMS);

        read_any.then_some(videos)
    }

    /// Where TMDB's own record meets a Title it already names, deliver its
    /// metadata onto the Addon's answer — and key the Title by that record.
    ///
    /// Every step is one that can go without: a Title whose id belongs to
    /// nothing TMDB answers for, an owner who has entered no key, a credential
    /// the store cannot read back, a TMDB that cannot answer, and an answer
    /// that refuses to be read all leave the Title exactly the Addon's — open,
    /// keyed by the Addon, unmapped by whatever the interface commits to. A
    /// TMDB outage blanks nothing.
    ///
    /// Where TMDB *does* answer, its word is the Title's: the art, the
    /// description, the runtime, the rating, the genres — and the **Videos**,
    /// which are its seasons and episodes where they were read, so a series
    /// played through an Addon card and through Discover is one series with one
    /// set of Videos (ADR-0011's amendment, ADR-0020).
    ///
    /// The credential is read here, at the moment of the request it builds,
    /// and kept no further: it reaches neither state nor Snapshot nor log.
    /// What keying there is follows the identity and is not the credential's
    /// business: a `tmdb:` id is keyed by its record whether the owner gave a
    /// key or not, for the id is the record's own.
    fn tmdb_refine(&self, title: &mut Title) {
        let Some(external) = tmdb::ExternalId::parse(&title.r#type, &title.id) else {
            return;
        };
        let id = match &external {
            tmdb::ExternalId::Tmdb(id) => {
                title.key = meta::TitleKey::Tmdb { id: id.0 };
                *id
            }
            tmdb::ExternalId::Imdb(imdb) => {
                let Some(key) = self.tmdb_credential() else {
                    return;
                };
                let kind = match tmdb::Kind::parse(&title.r#type) {
                    Some(kind) => kind,
                    None => return,
                };
                let request = tmdb::TmdbRequest::Find {
                    kind,
                    imdb: imdb.clone(),
                };
                let Some(answer) = self.fetch_tmdb(&request, &key).ok() else {
                    return;
                };
                match tmdb::read_find(&answer, kind) {
                    Ok(Some(id)) => id,
                    // An answer that says nothing mapped is an answer: the
                    // Title stays the Addon's, visible and keyed by it.
                    Ok(None) => return,
                    Err(_) => return,
                }
            }
        };

        let Some(key) = self.tmdb_credential() else {
            return;
        };
        let kind = match tmdb::Kind::parse(&title.r#type) {
            Some(kind) => kind,
            None => return,
        };
        let Some(record) = self
            .fetch_tmdb(&tmdb::TmdbRequest::Details { kind, id }, &key)
            .ok()
        else {
            return;
        };
        match tmdb::read_details(&record, kind) {
            Ok(details) => {
                let videos = self.tmdb_videos(&details, id, &key);
                details.with_videos(videos).onto(title);
                title.key = meta::TitleKey::Tmdb { id: id.0 };
            }
            // A details answer that was not one: the id stood — the find said
            // so — and the metadata is the Addon's word.
            Err(_) if matches!(external, tmdb::ExternalId::Imdb(_)) => {
                title.key = meta::TitleKey::Tmdb { id: id.0 };
            }
            Err(_) => {}
        }
    }

    /// The credential TMDB wants, looked up at the moment of use — or nothing,
    /// which is the Host hearing no key is held.
    pub(crate) fn tmdb_credential(&self) -> Option<tmdb::Credential> {
        let key = self.secrets.read(CredentialKind::TmdbKey).ok().flatten()?;
        Some(tmdb::Credential::parse(&key))
    }

    /// Read the account Library, diffed against the index the cache was last
    /// read against (#165, ADR-0029).
    ///
    /// A cold cache asks `datastoreGet {all:true}`; a warm one asks only the ids
    /// whose `datastoreMeta` mtime moved. The cache lock is taken for the plan,
    /// the keep and the read, and never across the account's network call. A
    /// failed index or document read is returned *with* the rows the cache still
    /// has, so the room can say "could not refresh" without saying "empty".
    fn library(&self) -> Result<Library, ActionError> {
        let stremio = self.stremio.as_ref().ok_or(ActionError::SyncUnavailable)?;
        let key = self
            .secrets
            .read(CredentialKind::StremioAuthKey)
            .ok()
            .flatten()
            .ok_or(ActionError::SyncUnavailable)?;

        let meta = match stremio.library_meta(&key) {
            Ok(meta) => meta,
            Err(error) => {
                let entries = self
                    .library_cache
                    .lock()
                    .expect("the Library cache is not poisoned")
                    .entries();
                return Ok(Library {
                    entries,
                    failure: Some(ActionError::Library {
                        detail: error.to_string(),
                    }),
                });
            }
        };

        let plan = self
            .library_cache
            .lock()
            .expect("the Library cache is not poisoned")
            .plan(&meta);
        let fetched = if plan.all {
            stremio.library(&key, None)
        } else if plan.ids.is_empty() {
            Ok(Vec::new())
        } else {
            stremio.library(&key, Some(&plan.ids))
        };

        match fetched {
            Ok(items) => {
                let mut cache = self
                    .library_cache
                    .lock()
                    .expect("the Library cache is not poisoned");
                if plan.all || !plan.ids.is_empty() {
                    cache.keep(items, &meta);
                }
                cache.set_meta(&meta);
                Ok(Library {
                    entries: cache.entries(),
                    failure: None,
                })
            }
            Err(error) => {
                let entries = self
                    .library_cache
                    .lock()
                    .expect("the Library cache is not poisoned")
                    .entries();
                Ok(Library {
                    entries,
                    failure: Some(ActionError::Library {
                        detail: error.to_string(),
                    }),
                })
            }
        }
    }

    /// The Addons a Video's Streams — or subtitles — are asked of, each with
    /// the request its own manifest declares.
    ///
    /// For a Video in the addon protocol's own namespace this is
    /// `Manifest::answers`'s judgement, the one ADR-0010 wrote down: an Addon
    /// that does not answer is not asked, and appears nowhere. For a Video TMDB
    /// keys — `tmdb:603`, `tmdb:1396:1:2` — the request is built **per Addon**,
    /// in the spelling that Addon declares: `tmdb:` stays as it is,
    /// `tt`-declaring Addons are asked with the `/external_ids`-resolved IMDb
    /// id, and an Addon that declares neither is considered and not asked, its
    /// group empty (ADR-0020). The `/external_ids` ask happens once for the
    /// Video however many Addons want that spelling.
    ///
    /// The request built is still judged with `Manifest::answers` before it is
    /// returned: the request judged is the request asked.
    pub(crate) fn asks_for(&self, resource: &str, video: &VideoRef) -> Vec<Asked> {
        let plain = |video: &VideoRef| ResourceRequest::new(resource, &video.r#type, &video.id);

        let Some(tmdb_video) = tmdb::video_id(&video.r#type, &video.id) else {
            return self
                .addons
                .iter()
                .filter(|addon| addon.manifest().answers(&plain(video)))
                .map(|addon| Asked {
                    addon: addon.clone(),
                    requested: Some(plain(video)),
                })
                .collect();
        };

        let kind = tmdb_video.kind;
        // Which spelling each Addon that offers the resource wants, settled
        // before anything is resolved: an Addon with no `stream` resource is
        // never worth an `/external_ids` ask.
        let spelled: Vec<(&Addon, Option<Spelling>)> = self
            .addons
            .iter()
            .filter(|addon| addon.manifest().declares(resource, &video.r#type))
            .map(|addon| {
                let spelling = addon
                    .manifest()
                    .declared_prefixes(resource)
                    .and_then(spelling_of);
                (addon, spelling)
            })
            .collect();

        let wants_imdb = spelled
            .iter()
            .any(|(_, spelling)| *spelling == Some(Spelling::Imdb));
        let imdb = wants_imdb
            .then(|| self.tmdb_imdb(kind, tmdb_video.id))
            .flatten();

        spelled
            .into_iter()
            .map(|(addon, spelling)| {
                let requested = match (spelling, imdb.as_deref()) {
                    (Some(Spelling::Tmdb), _) => Some(plain(video)),
                    (Some(Spelling::Imdb), Some(imdb)) => Some(ResourceRequest::new(
                        resource,
                        &video.r#type,
                        episode_spelling(imdb, tmdb_video.at),
                    )),
                    // A spelling this Host could not build — the IMDb id TMDB
                    // does not keep, or an Addon that declared neither — is an
                    // Addon that is not asked.
                    _ => None,
                };

                Asked {
                    addon: addon.clone(),
                    requested: requested.filter(|requested| addon.manifest().answers(requested)),
                }
            })
            .collect()
    }

    /// The request one named Addon is asked one Video by, in the spelling its
    /// own manifest declares — or `None` where it declares none, or does not
    /// answer for the Video (ADR-0020).
    pub(crate) fn ask_of(
        &self,
        addon: &Addon,
        resource: &str,
        video: &VideoRef,
    ) -> Option<ResourceRequest> {
        self.asks_for(resource, video)
            .into_iter()
            .find(|asked| asked.addon.id() == addon.id())
            .and_then(|asked| asked.requested)
    }

    /// The IMDb id TMDB keeps for a record, where a key is held and TMDB
    /// answers: one hop of the per-Addon bridge (ADR-0020).
    fn tmdb_imdb(&self, kind: tmdb::Kind, id: tmdb::TmdbId) -> Option<String> {
        let key = self.tmdb_credential()?;
        let request = tmdb::TmdbRequest::ExternalIds { kind, id };
        let answer = self.fetch_tmdb(&request, &key).ok()?;

        tmdb::read_external_ids(&answer).ok().flatten()
    }

    /// Fetch one TMDB answer, or why it could not be fetched. The URL a query
    /// credential built carries the credential in it and is dropped when the
    /// fetch is over: a caller reads the answer, or TMDB's failure, and never
    /// the URL the credential rode in.
    fn fetch_tmdb(
        &self,
        request: &tmdb::TmdbRequest,
        credential: &tmdb::Credential,
    ) -> Result<String, FetchError> {
        let url = request.url(credential);
        if let Some((name, value)) = credential.header() {
            self.fetcher.fetch_with_headers(&url, &[(name, &value)])
        } else {
            self.fetcher.fetch(&url)
        }
    }
}

/// The most Addon asks one question has in flight at once.
///
/// A question asks a handful of Addons, and a wider burst would be one client's
/// search arriving at every Addon at once. Eight is wide enough that a Home-sized
/// search overlaps most of its Addons and narrow enough that one slow Addon
/// occupies one slot rather than the question (ADR-0023).
const FAN_OUT_LIMIT: usize = 8;

/// Ask the items up to [`FAN_OUT_LIMIT`] at a time, answering in the order they
/// were given.
///
/// One scoped thread per item, and the chunk's threads are joined before the
/// next chunk is spawned, so no more than the limit are ever in flight — even
/// when one ask is slow, in which case the next chunk waits (ADR-0023). Every
/// answer is written into the slot its item occupies, so completion order can
/// never move a Row or a group. A panic in an ask is re-raised on the asking
/// thread after the chunk's other threads have been accounted for.
fn fan_out<T, R, F>(items: &[T], ask: F) -> Vec<R>
where
    T: Sync,
    R: Send,
    F: Fn(&T) -> R + Sync,
{
    let mut answers: Vec<Option<R>> = items.iter().map(|_| None).collect();

    std::thread::scope(|scope| {
        let ask = &ask;
        for (asked, slots) in items
            .chunks(FAN_OUT_LIMIT)
            .zip(answers.chunks_mut(FAN_OUT_LIMIT))
        {
            let mut handles = Vec::with_capacity(asked.len());
            for (item, slot) in asked.iter().zip(slots.iter_mut()) {
                handles.push(scope.spawn(move || {
                    *slot = Some(ask(item));
                }));
            }
            // Joined before the next chunk is spawned: this is the bound. Every
            // thread in the chunk is accounted for before a panic is re-raised,
            // so the first failure cannot leave its siblings unjoined.
            let mut panic = None;
            for handle in handles {
                if let Err(caught) = handle.join() {
                    panic.get_or_insert(caught);
                }
            }
            if let Some(panic) = panic {
                std::panic::resume_unwind(panic);
            }
        }
    });

    answers
        .into_iter()
        .map(|answer| answer.expect("every fan-out item writes its answer"))
        .collect()
}

/// One `info` line per Addon ask inside a fan-out.
///
/// The helper takes only the resource's stable name, the Addon's own id, the
/// duration and the outcome — a stable word or an error's kind. There is no
/// slot for a URL, a query, an `ActionError`, or an answer, so a later caller
/// cannot accidentally widen the line, the way `HostDoor`'s question log cannot
/// (ADR-0022, ADR-0023).
fn addon_ask_log(
    resource: &'static str,
    addon: &AddonId,
    duration: Duration,
    outcome: &'static str,
) {
    tracing::info!(
        addon = addon.as_str(),
        resource,
        duration_ms = millis(duration),
        outcome,
        "an Addon was asked"
    );
}

/// One Addon, and the request one Video is asked of it by — or `None` where the
/// Addon was considered and not asked, which for a TMDB-keyed Video is its own
/// kind of answer: an empty group (ADR-0020).
pub(crate) struct Asked {
    pub(crate) addon: Addon,
    pub(crate) requested: Option<ResourceRequest>,
}

/// How one Addon's manifest says a TMDB-keyed Video is spelled to it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Spelling {
    /// `tmdb:<id>`, or `tmdb:<id>:<season>:<episode>`: the id the client
    /// named, which needs no second ask.
    Tmdb,
    /// `tt…`, or `tt…:<season>:<episode>`: TMDB's `/external_ids` answer,
    /// re-spelled.
    Imdb,
}

/// The spelling an Addon's declared id prefixes ask for, where it declares one.
///
/// `tmdb:` is preferred where an Addon declares both spellings, because it is
/// the id in hand and the `tt` one is a network hop. An Addon that declares
/// neither family — including one that declares nothing at all, which the
/// protocol reads as "every id" — is not asked: which of two namespaces to
/// guess is not the Host's to guess, and the ADR says the group is empty
/// (ADR-0020).
fn spelling_of(prefixes: &[String]) -> Option<Spelling> {
    if prefixes.iter().any(|prefix| prefix.starts_with("tmdb")) {
        Some(Spelling::Tmdb)
    } else if prefixes.iter().any(|prefix| prefix == "tt") {
        Some(Spelling::Imdb)
    } else {
        None
    }
}

/// The id an Addon keyed by `tt` is asked an episode by: TMDB's IMDb id with
/// the season and episode the playing Video carried.
fn episode_spelling(imdb: &str, at: Option<(u32, u32)>) -> String {
    match at {
        Some((season, episode)) => format!("{imdb}:{season}:{episode}"),
        None => imdb.to_owned(),
    }
}

/// Why a TMDB call failed, in TMDB's name.
///
/// The shared [`Fetcher`] speaks of the Addon it was built for, and a Discover
/// row that said "the Addon answered with status 429" would name the wrong
/// party: what a client reads is that TMDB did not answer, and with what
/// (ADR-0020).
fn tmdb_failure(error: FetchError) -> ActionError {
    ActionError::Tmdb {
        detail: match error {
            FetchError::Status { status } => format!("TMDB answered with status {status}"),
            FetchError::Unreachable { detail } => {
                format!("TMDB could not be reached: {detail}")
            }
            FetchError::Body { detail } => {
                format!("TMDB answered with something that is not text: {detail}")
            }
        },
    }
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
