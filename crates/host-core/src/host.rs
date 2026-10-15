use std::sync::Arc;

use crate::action::{Action, ActionError, ValidatedAction};
use crate::addon::{Addon, Manifest};
use crate::fetcher::Fetcher;
use crate::snapshot::Snapshot;
use crate::state::{Change, Persist, State};
use crate::store::{Store, StoreError};

/// The Host: its state, and the one door to it.
///
/// Every mutation — from the window, from a remote client, from a timer — arrives
/// as an [`Action`] at [`Host::dispatch`], and every publication leaves as a
/// [`Snapshot`]. There is no second path (ADR-0002).
pub struct Host {
    store: Arc<dyn Store>,
    fetcher: Arc<dyn Fetcher>,
    state: State,
    revision: u64,
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
        })
    }

    /// The state as it stands — what a client that has just connected, or just
    /// reconnected, is owed.
    pub fn snapshot(&self) -> Snapshot {
        Snapshot::build(&self.state, self.revision)
    }

    /// Take an Action, and publish what changed.
    ///
    /// Validation is pure and comes first, then whatever I/O the Action needs, and
    /// only then the state. An Action that is rejected, that cannot be fetched, or
    /// that the store refuses leaves the state and every future Snapshot exactly as
    /// they were.
    pub fn dispatch(&mut self, action: Action) -> Result<Vec<Snapshot>, ActionError> {
        let validated = action.validate()?;
        let change = self.resolve(validated)?;

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
        Ok(vec![self.snapshot()])
    }

    /// Turn a validated Action into the change it will make.
    ///
    /// This is where an Action's I/O happens: an Addon is fetched and parsed here,
    /// so that what reaches state is already a decided thing. A failure here has
    /// touched neither state nor store.
    fn resolve(&self, validated: ValidatedAction) -> Result<Change, ActionError> {
        Ok(match validated {
            ValidatedAction::SetSubtitleLanguage(language) => Change::SetSubtitleLanguage(language),
            ValidatedAction::ClearSubtitleLanguage => Change::ClearSubtitleLanguage,
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
                Change::AddAddon(Box::new(Addon::new(url, manifest)))
            }
            ValidatedAction::RemoveAddon(id) => {
                if !self.state.has_addon(&id) {
                    return Err(ActionError::UnknownAddon {
                        id: id.as_str().to_owned(),
                    });
                }
                Change::RemoveAddon(id)
            }
        })
    }
}
