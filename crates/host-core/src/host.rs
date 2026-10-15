use std::sync::Arc;

use crate::action::{Action, ActionError};
use crate::snapshot::Snapshot;
use crate::state::State;
use crate::store::{Store, StoreError};

/// The Host: its state, and the one door to it.
///
/// Every mutation — from the window, from a remote client, from a timer — arrives
/// as an [`Action`] at [`Host::dispatch`], and every publication leaves as a
/// [`Snapshot`]. There is no second path (ADR-0002).
pub struct Host {
    store: Arc<dyn Store>,
    state: State,
    revision: u64,
}

impl Host {
    /// Load the Host's state from the store.
    ///
    /// Preparing the store — creating the database, running its migrations — is
    /// the store's own concern; by the time this is called the store can be read.
    pub fn new(store: Arc<dyn Store>) -> Result<Self, StoreError> {
        let state = State::with_preferences(store.read_preferences()?);
        Ok(Self {
            store,
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
    /// Validation is pure and comes first. The state is replaced only once the
    /// store has accepted the write, so an Action that is rejected or that the
    /// store refuses leaves the state and every future Snapshot exactly as they
    /// were.
    pub fn dispatch(&mut self, action: Action) -> Result<Vec<Snapshot>, ActionError> {
        let validated = action.validate()?;

        let mut next = self.state.clone();
        next.apply(validated);
        self.store
            .write_preferences(next.preferences())
            .map_err(|error| ActionError::Store {
                detail: error.to_string(),
            })?;

        self.state = next;
        self.revision += 1;
        Ok(vec![self.snapshot()])
    }
}
