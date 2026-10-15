use serde::{Deserialize, Serialize};

use crate::preferences::SubtitleLanguage;
use crate::state::State;

/// The Host's state as it travels outward: the only shape state leaves in.
///
/// A Snapshot is built by a pure function of the state, and it is chosen so that a
/// credential cannot be represented in it — there is no field a key could occupy,
/// and no free-form map one could be smuggled through. Whatever later tickets add
/// here has to keep that true; `the_snapshot_declares_only_fields_it_can_safely_carry`
/// holds the line.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Snapshot {
    /// Moves forward by one with every Action that changes state, so a client can
    /// tell a newer Snapshot from an older one and ignore the older.
    pub revision: u64,
    pub preferences: PreferencesSnapshot,
}

/// The preference fields a client may see.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreferencesSnapshot {
    /// The subtitle language the Host prefers, or `null` when it has none and
    /// chooses per Video. A language tag by construction, so the wire cannot carry
    /// anything else here.
    pub subtitle_language: Option<SubtitleLanguage>,
}

impl Snapshot {
    /// Build the Snapshot for a state. Pure: the same state and revision always
    /// build the same Snapshot.
    pub(crate) fn build(state: &State, revision: u64) -> Self {
        Self {
            revision,
            preferences: PreferencesSnapshot {
                subtitle_language: state.preferences().subtitle_language().cloned(),
            },
        }
    }
}
