use serde::{Deserialize, Serialize};

use crate::addon::{Addon, AddonId, BehaviorHints, Catalog, Manifest, Resource};
use crate::autoplay::AutoplaySnapshot;
use crate::device::DeviceSummary;
use crate::pairing::PairingCode;
use crate::playback::{Picture, PlaybackSnapshot};
use crate::preferences::{
    FeaturedCatalog, Language, StreamBuffer, SubtitleColor, SubtitleScale, TorrentCache,
    UpNextPlayback,
};
use crate::progress::{ContinueEntry, ResumeEntry};
use crate::secret::SecretBackend;
use crate::state::State;
use crate::title_cache::CachedTitle;

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
    /// The configured Addons, as what they say they offer and whether each is
    /// enabled. Never where they live: an Addon's manifest URL can carry its
    /// credentials, and a Snapshot reaches every paired client (ADR-0009,
    /// ADR-0044 §1–§2).
    pub addons: Vec<AddonSnapshot>,
    /// The one Catalog the owner has marked as the Host's featured feed, where
    /// there is one: the row a client's Home hero is drawn from, its first items
    /// in the Addon's own order. A preference of the Host's rather than a
    /// client's, so every client draws the same hero — and one that names an
    /// Addon the Host no longer has is cleared in the same change that removes it
    /// (#74, and CONTEXT.md's "Featured catalog").
    pub featured_catalog: Option<FeaturedCatalog>,
    /// Where the Host's credentials live, and which it knows it holds — the one
    /// thing about credentials that is not itself one, and is what the interface
    /// shows when it says how exposed they are.
    pub protection: ProtectionSnapshot,
    /// Continue watching: one entry per Title the Host has Watch progress in,
    /// the Title's card — the Video it played last, or that Video's Up next once
    /// it is finished — most recently played first, the row every client draws.
    /// This is the shared state the spec names beside playback, so it travels as
    /// a Snapshot rather than as an answer (#273, #274).
    pub continue_watching: Vec<ContinueEntry>,
    /// The Watch progress itself, one entry per Video: where each Video was
    /// left, which the playback view and the episode lookup still read. It is
    /// not the Continue watching row — that is one card per Title, above.
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

/// One configured Addon as a Snapshot carries it: what its manifest says it
/// offers, and whether the owner has it enabled (ADR-0009, ADR-0044 §1–§2).
///
/// Never where its manifest lives: the URL is a credential by presumption and
/// has no field here.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AddonSnapshot {
    pub id: AddonId,
    pub name: String,
    pub version: String,
    pub resources: Vec<Resource>,
    pub types: Vec<String>,
    pub catalogs: Vec<Catalog>,
    pub id_prefixes: Vec<String>,
    pub behavior_hints: BehaviorHints,
    pub enabled: bool,
}

impl AddonSnapshot {
    pub(crate) fn from_addon(addon: &Addon) -> Self {
        let Manifest {
            id,
            name,
            version,
            resources,
            types,
            catalogs,
            id_prefixes,
            behavior_hints,
        } = addon.manifest().clone();
        Self {
            id,
            name,
            version,
            resources,
            types,
            catalogs,
            id_prefixes,
            behavior_hints,
            enabled: addon.is_enabled(),
        }
    }
}

/// The preference fields a client may see.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreferencesSnapshot {
    /// The Subtitle languages, first the most wanted: up to three, and empty
    /// when the Host follows the file. Language tags by construction, so the wire
    /// cannot carry anything else here (ADR-0041).
    pub subtitle_languages: Vec<Language>,
    /// The Audio languages: the same, for the soundtrack.
    pub audio_languages: Vec<Language>,
    /// The colour the Player draws subtitles in where a track leaves the colour
    /// open. Always a value — white is the default rather than an absence — so a
    /// client never has to invent one (ADR-0024).
    pub subtitle_color: SubtitleColor,
    /// How large the Player draws subtitles, relative to its own size. Always a
    /// value, for the same reason.
    pub subtitle_scale: SubtitleScale,
    /// How much of a Stream the Player keeps read ahead: the time it aims for
    /// and the memory that look-ahead may take. Always values — a Host that has
    /// never been told keeps the default pair (ADR-0026).
    pub stream_buffer: StreamBuffer,
    /// The most disk a playing torrent may take. Always a value: 2 GB for a Host
    /// that has never been told (ADR-0042 §3).
    pub torrent_cache: TorrentCache,
    /// What Play does for a Title's Up next: play it directly, or open the
    /// Streams picker. Always a value — direct is the default, and the choice
    /// governs only Up next, never Resume (#276).
    pub up_next_playback: UpNextPlayback,
    /// Whether the Host advances on its own to a Title's Up next after a short
    /// countdown when an episode's Stream ends, or waits until someone asks.
    /// Always a value — on is the default (#302, #314).
    pub autoplay: bool,
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
    /// Build the Snapshot for a state. Pure: the same state, cached Titles,
    /// revision and picture always build the same Snapshot.
    ///
    /// `cached` is the Host's cached Titles, which is where Continue watching's
    /// Up next is read from; it is not state, so a cached Title gaining episodes
    /// moves the row without an Action (#274, ADR-0038).
    ///
    /// `autoplay` is the countdown the Host is running, read off its clock at
    /// the moment of the build: it is the Host's own record beside the state, not
    /// part of it (ADR-0040).
    ///
    /// `picture` is the Player's answer to where it draws: a fact about the
    /// machine the Host was built on, like which backend holds a credential, and
    /// not something any Action changes.
    pub(crate) fn build(
        state: &State,
        cached: &[CachedTitle],
        revision: u64,
        picture: Picture,
        address: Option<&str>,
        autoplay: Option<AutoplaySnapshot>,
    ) -> Self {
        let mut playback = state.playback().snapshot(picture);
        playback.autoplay = autoplay;

        Self {
            revision,
            playback,
            preferences: PreferencesSnapshot {
                subtitle_languages: state.preferences().subtitle_languages().to_vec(),
                audio_languages: state.preferences().audio_languages().to_vec(),
                subtitle_color: state.preferences().subtitle_color().clone(),
                subtitle_scale: state.preferences().subtitle_scale(),
                stream_buffer: state.preferences().stream_buffer(),
                torrent_cache: state.preferences().torrent_cache(),
                up_next_playback: state.preferences().up_next_playback(),
                autoplay: state.preferences().autoplay(),
            },
            addons: state
                .addons()
                .iter()
                .map(AddonSnapshot::from_addon)
                .collect(),
            // Keep the stored preference when its Addon is disabled, but hide
            // it from the published Snapshot so no client draws a Home hero
            // from a disabled Addon; re-enabling restores it (ADR-0044 §2).
            featured_catalog: state
                .preferences()
                .featured_catalog()
                .filter(|featured| state.is_addon_enabled(&featured.addon))
                .cloned(),
            protection: ProtectionSnapshot {
                backend: state.protection().backend,
                tmdb_held: state.protection().tmdb_held,
                stremio_held: state.protection().stremio_held,
            },
            continue_watching: crate::progress::continue_watching(state.watch(), cached, |addon| {
                state.addon_unplayable(addon)
            }),
            watch_progress: state
                .watch()
                .iter()
                .map(|entry| {
                    // A Title with no Addon behind it is never marked: there is
                    // no removal or disable to judge (ADR-0020, ADR-0044 §2).
                    let reason = entry
                        .title
                        .addon()
                        .and_then(|addon| state.addon_unplayable(addon));
                    entry.resume_entry(reason)
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
