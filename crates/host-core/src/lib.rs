//! The Host's domain: its state, the one Action surface that changes it, and the
//! Snapshots it publishes.
//!
//! Nothing here knows about Tauri, about the network or about SQL. The app shell
//! in `src-tauri/` and the remote client server a later ticket adds are both thin
//! translators over the same door: an [`Action`] in, a state change or an answer
//! out (ADR-0002).
//!
//! ```
//! use std::sync::Arc;
//!
//! use host_core::{
//!     Action, AddonProvider, FixtureClock, FixtureFetcher, FixturePlayer, Host,
//!     InMemorySecretStore, InMemoryStore, SubtitleLanguage,
//! };
//!
//! let store = Arc::new(InMemoryStore::new());
//! let secrets = Arc::new(InMemorySecretStore::new());
//! let fetcher = Arc::new(FixtureFetcher::new());
//! let provider = Arc::new(AddonProvider::new(fetcher.clone()));
//! let mut host = Host::new(
//!     store,
//!     fetcher,
//!     secrets,
//!     provider,
//!     Arc::new(FixturePlayer::new()),
//!     Arc::new(FixtureClock::new()),
//! )?;
//! let action = Action::parse(r#"{"version":1,"action":{"type":"set_subtitle_language","language":"pt-BR"}}"#)?;
//! let response = host.dispatch(action)?;
//!
//! let published = &response.snapshots[0];
//! let preferred = published.preferences.subtitle_language.as_ref();
//! assert_eq!(preferred.map(SubtitleLanguage::as_str), Some("pt-BR"));
//! # Ok::<(), Box<dyn std::error::Error>>(())
//! ```

mod action;
mod addon;
mod cache;
mod catalog;
mod clock;
mod fetcher;
mod host;
mod meta;
mod playback;
mod preferences;
mod progress;
mod provider;
mod request;
mod response;
mod secret;
mod snapshot;
mod state;
mod store;
mod stream;
mod stremio;
mod subtitles;
mod sync;
mod tmdb;

pub use action::{Action, ActionError, ValidatedAction, ACTION_VERSION};
pub use addon::{
    Addon, AddonId, BehaviorHints, Catalog, ExtraProp, InvalidAddonId, InvalidManifestUrl,
    Manifest, ManifestError, ManifestUrl, Resource, MAX_ITEMS, MAX_MANIFEST_BYTES, MAX_STRING_LEN,
    MAX_URL_LEN,
};
pub use catalog::{CacheHints, CatalogError, CatalogRow, MetaPreview, Page, MAX_CATALOG_BYTES};
pub use clock::{Clock, FixtureClock, SystemClock};
pub use fetcher::{FetchError, Fetcher, FixtureFetcher};
pub use host::Host;
pub use meta::{MetaError, Title, TitleKey, Video, MAX_META_BYTES};
pub use playback::{
    Aspect, Chapter, ChapterStep, ChosenStream, Control, Crop, CropRectangle, FixturePlayer,
    InvalidAspect, InvalidCrop, InvalidSeekTarget, InvalidSpeed, InvalidStreamUrl,
    InvalidSubtitleDelay, InvalidVolume, NowPlaying, Observation, Picture, PlaybackError,
    PlaybackSnapshot, PlaybackState, Player, SeekTarget, Statistics, StreamUrl, Telling, Track,
    TrackId, TrackKind, Unplayable, VideoSize,
};
pub use preferences::{InvalidSubtitleLanguage, Preferences, SubtitleLanguage};
pub use progress::{
    ResumeEntry, TitleCard, TitleStub, UnplayableEntry, UnplayableReason, WatchProgress,
    FINISHED_TAIL, PROGRESS_EVERY,
};
pub use provider::{AddonProvider, FixtureProvider, Provider};
pub use request::{
    CatalogRef, Extra, InvalidCatalogRef, InvalidExtra, InvalidTitleRef, InvalidVideoRef,
    ResourceRequest, TitleRef, VideoRef, CATALOG, MAX_EXTRAS, META, SEARCH, SKIP, STREAM,
    SUBTITLES,
};
pub use response::{Answer, Response};
pub use secret::{
    CredentialKind, InMemorySecretStore, InvalidTmdbKey, SecretBackend, SecretError, SecretStore,
    TmdbKey,
};
pub use snapshot::{PreferencesSnapshot, ProtectionSnapshot, Snapshot};
pub use store::{InMemoryStore, Store, StoreError};
pub use stream::{AddonStreams, Playback, Stream, StreamError, Warning, MAX_STREAM_BYTES};
pub use stremio::{FixtureStremio, StremioApi, SyncError};
pub use subtitles::{Subtitle, SubtitleError, MAX_FALLBACK_SUBTITLES, MAX_SUBTITLES_BYTES};
pub use sync::{merge, BitField, Merged, RemoteItem, WatchedField};
pub use tmdb::{
    Credential, ExternalId, Kind, TmdbDetails, TmdbError, TmdbId, TmdbRequest, IMAGE_ROOT,
    TMDB_ROOT,
};
