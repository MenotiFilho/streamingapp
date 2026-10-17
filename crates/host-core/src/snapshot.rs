use serde::{Deserialize, Serialize};

use crate::addon::Manifest;
use crate::device::DeviceSummary;
use crate::pairing::PairingCode;
use crate::playback::{Picture, PlaybackSnapshot};
use crate::preferences::SubtitleLanguage;
use crate::progress::ResumeEntry;
use crate::secret::SecretBackend;
use crate::state::State;

/// The Host's state as it travels outward: the only shape state leaves in.
///
/// A Snapshot is built by a pure function of the state, and it is chosen so that a
/// credential cannot be represented in it — there is no field a key could occupy,
/// and no free-form map one could be smuggled through. Whatever later tickets add
/// here has to keep that true; `the_snapshot_declares_only_fields_it_can_safely_carry`
/// holds the line.
///
/// The same rule covers a Stream's URL, which is a credential by the same
/// presumption an Addon's manifest URL is: what a Snapshot says about playback
/// is the candidate's own words, never where its bytes are (ADR-0009, ADR-0013).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Snapshot {
    /// Moves forward by one with every Action that changes state, so a client can
    /// tell a newer Snapshot from an older one and ignore the older.
    pub revision: u64,
    /// What is playing, where it is, and how the last open went — the one
    /// genuinely shared state the spec names, which is why it is a Snapshot and
    /// not an answer.
    pub playback: PlaybackSnapshot,
    pub preferences: PreferencesSnapshot,
    /// The configured Addons, as what they say they offer. Never where they live:
    /// an Addon's manifest URL can carry its credentials, and a Snapshot reaches
    /// every paired client (ADR-0009).
    pub addons: Vec<Manifest>,
    /// Where the Host's credentials live, and which it knows it holds — the one
    /// thing about credentials that is not itself one, and is what the interface
    /// shows when it says how exposed they are.
    pub protection: ProtectionSnapshot,
    /// The library: one entry per Video the Host has Watch progress in, most
    /// recently played first. This is the shared state the spec names beside
    /// playback — what is in the library, and where in each Video the owner got
    /// to — so it travels as a Snapshot rather than as an answer, and every
    /// client sees the same Continue watching row (#29).
    pub watch_progress: Vec<ResumeEntry>,
    /// The devices the Host has paired, in the order they paired. Enough to list
    /// them and to name one when revoking; what a device *holds* is not here, and
    /// there is no field in a [`DeviceSummary`] it could occupy (#31).
    pub devices: Vec<DeviceSummary>,
    /// The code the Host is showing, which a client that has not paired redeems
    /// once. It travels in the Snapshot because the window that displays it is a
    /// client of the same Snapshot stream as everything else and has no private
    /// path to it (ADR-0002); it is not a credential, it is what a credential is
    /// minted from, it is single-use, and it rotates the moment it is redeemed.
    pub pairing_code: PairingCode,
    /// Where this Host answers on the network, as `host:port` — a fact about the
    /// machine the Host is running on, like where the picture is drawn, and what
    /// the window reads out so a person knows where to point a browser. Nothing
    /// when the Host has no wire server (a test, or a Host that could not bind).
    pub address: Option<String>,
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

/// Where the Host's credentials are held, as the secret store reports itself.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProtectionSnapshot {
    /// Which backend is actually holding them: the OS keyring, or the owner-only
    /// (0600) file where no keyring exists.
    pub backend: SecretBackend,
    /// Whether a TMDB key is held. A fact about what was set, not the key.
    pub tmdb_held: bool,
    /// Whether a Stremio account is signed in — a fact about what was set, not
    /// the `authKey`, and what the interface reads as "sync is on" (#30).
    pub stremio_held: bool,
}

impl Snapshot {
    /// Build the Snapshot for a state. Pure: the same state, revision and
    /// picture always build the same Snapshot.
    ///
    /// `picture` is the Player's answer to where it draws: a fact about the
    /// machine the Host was built on, like which backend holds a credential, and
    /// not something any Action changes.
    pub(crate) fn build(
        state: &State,
        revision: u64,
        picture: Picture,
        address: Option<&str>,
    ) -> Self {
        Self {
            revision,
            playback: state.playback().snapshot(picture),
            preferences: PreferencesSnapshot {
                subtitle_language: state.preferences().subtitle_language().cloned(),
            },
            addons: state
                .addons()
                .iter()
                .map(|addon| addon.manifest().clone())
                .collect(),
            protection: ProtectionSnapshot {
                backend: state.protection().backend,
                tmdb_held: state.protection().tmdb_held,
                stremio_held: state.protection().stremio_held,
            },
            watch_progress: state
                .watch()
                .iter()
                .map(|entry| {
                    // A Title with no Addon behind it is never marked: there is
                    // no removal to judge (ADR-0020).
                    entry.resume_entry(
                        entry
                            .title
                            .addon()
                            .is_none_or(|addon| state.has_addon(addon)),
                    )
                })
                .collect(),
            devices: state
                .devices()
                .iter()
                .map(|device| device.summary())
                .collect(),
            pairing_code: state.pairing().clone(),
            address: address.map(str::to_owned),
        }
    }
}
