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
//!     InMemorySecretStore, InMemoryStore, Language,
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
//! let action = Action::parse(r#"{"version":1,"action":{"type":"set_subtitle_languages","languages":["pt-BR"]}}"#)?;
//! let response = host.dispatch(action)?;
//!
//! let published = &response.snapshots[0];
//! let preferred = published.preferences.subtitle_languages.first();
//! assert_eq!(preferred.map(Language::as_str), Some("pt-BR"));
//! # Ok::<(), Box<dyn std::error::Error>>(())
//! ```

mod action;
mod addon;
mod autoplay;
mod background;
mod cache;
mod catalog;
mod clock;
mod device;
mod discover;
mod door;
mod fetcher;
mod handpick;
mod host;
mod library;
mod log;
mod meta;
mod pairing;
mod playback;
mod preferences;
mod preview;
mod progress;
mod provider;
mod random;
mod request;
mod response;
mod search;
mod secret;
mod snapshot;
mod state;
mod store;
mod stream;
mod stremio;
mod subtitles;
mod sync;
mod title_cache;
mod tmdb;
mod torrent;
mod tracks;
mod view;
mod wire;

pub use action::{Action, ActionError, ValidatedAction, ACTION_VERSION};
pub use addon::{
    Addon, AddonId, BehaviorHints, Catalog, ExtraProp, InvalidAddonId, InvalidManifestUrl,
    Manifest, ManifestError, ManifestUrl, Resource, MAX_ITEMS, MAX_MANIFEST_BYTES, MAX_STRING_LEN,
    MAX_URL_LEN,
};
pub use autoplay::{AutoplayPhase, AutoplaySnapshot, UpNextEpisode, AUTOPLAY_COUNTDOWN_MS};
pub use background::{FixtureRevisions, RevisionSink};
pub use catalog::{CacheHints, CatalogError, CatalogRow, MetaPreview, Page, MAX_CATALOG_BYTES};
pub use clock::{Clock, FixtureClock, SystemClock};
pub use device::{
    Device, DeviceId, DeviceName, DeviceSummary, DeviceToken, InvalidDeviceId, InvalidDeviceName,
    InvalidDeviceToken, InvalidTokenDigest, TokenDigest,
};
pub use discover::DiscoverRow;
pub use door::HostDoor;
pub use fetcher::{FetchError, Fetcher, FixtureFetcher};
pub use host::{Drained, Host};
pub use library::{Library, LibraryEntry};
pub use meta::{
    next_video, ordered_videos, previous_video, MetaError, Title, TitleKey, Video, MAX_META_BYTES,
};
pub use pairing::{InvalidPairingCode, PairingCode, PAIRING_CODE_LEN};
pub use playback::{
    Aspect, Buffered, Chapter, ChapterStep, ChosenStream, Control, Crop, CropRectangle, Episode,
    FixturePlayer, InvalidAspect, InvalidCrop, InvalidSeekTarget, InvalidSpeed, InvalidStreamUrl,
    InvalidSubtitleDelay, InvalidVolume, NowPlaying, Observation, Picture, PlaybackError,
    PlaybackSnapshot, PlaybackState, Player, SeekTarget, Statistics, StreamUrl, Telling, Track,
    TrackId, TrackKind, Unplayable, VideoSize,
};
pub use preferences::{
    DuplicateLanguage, FeaturedCatalog, InvalidLanguage, InvalidLanguageList, InvalidStreamBuffer,
    InvalidSubtitleColor, InvalidSubtitleScale, InvalidUpNextPlayback, Language, LanguageList,
    Preferences, StreamBuffer, SubtitleColor, SubtitleScale, TooManyLanguages, UpNextPlayback,
};
pub use preview::{
    bucket_of, bucket_start, checked_preview_at, preview_ceiling, FixturePreviewer, Frame,
    InvalidPreviewAt, NoPreviewer, PreviewCache, PreviewCeiling, Previewer,
    PREVIEW_BITRATE_GRACE_MS, PREVIEW_BUCKET_SECONDS, PREVIEW_CACHE_FRAMES, PREVIEW_CEILING_BPS,
};
pub use progress::{
    continue_watching, ContinueEntry, ResumeEntry, TitleCard, TitleStub, UnplayableEntry,
    UnplayableReason, WatchProgress, FINISHED_TAIL, PROGRESS_EVERY,
};
pub use provider::{AddonProvider, FixtureProvider, Provider};
pub use request::{
    CatalogRef, Extra, InvalidCatalogRef, InvalidExtra, InvalidTitleRef, InvalidVideoRef,
    ResourceRequest, TitleRef, VideoRef, CATALOG, MAX_EXTRAS, META, SEARCH, SKIP, STREAM,
    SUBTITLES,
};
pub use response::{Answer, Response};
pub use search::SearchRow;
pub use secret::{
    CredentialKind, InMemorySecretStore, InvalidTmdbKey, SecretBackend, SecretError, SecretStore,
    TmdbKey,
};
pub use snapshot::{PreferencesSnapshot, ProtectionSnapshot, Snapshot};
pub use store::{InMemoryStore, Store, StoreError};
pub use stream::{AddonStreams, Playback, Stream, StreamError, Warning, MAX_STREAM_BYTES};
pub use stremio::{FixtureStremio, LibraryMeta, StremioApi, SyncError};
pub use subtitles::{Subtitle, SubtitleError, MAX_FALLBACK_SUBTITLES, MAX_SUBTITLES_BYTES};
pub use sync::{merge, BitField, Merged, RemoteItem, WatchedField};
pub use title_cache::{
    CachedTitle, TitleSource, CAUGHT_UP_CHECK_MILLIS, MAX_CACHED_TITLES, OTHER_FRESH_MILLIS,
    RUNNING_FRESH_MILLIS, TMDB_CACHE_CEILING_MILLIS,
};
pub use tmdb::{
    video_id, video_spelling, Credential, DiscoverQuery, DiscoverQueryError, ExternalId, Kind,
    NextEpisode, SearchQuery, SearchQueryError, SeriesStatus, TmdbDetails, TmdbError, TmdbId,
    TmdbRequest, TmdbVideo, IMAGE_ROOT, LOGO_ROOT, STILL_ROOT, TMDB_ROOT,
};
pub use torrent::{
    FailureKind, FixtureTorrentEngine, InfoHash, InvalidInfoHash, NoTorrentEngine, ServeHints,
    ServeRequest, TorrentEngine, TorrentError, TorrentLimits, TorrentPhase, TorrentReport,
};
pub use tracks::codes_for_list;
pub use view::HostView;
pub use wire::{permitted, ClientFrame, Refusal, ServerFrame, WIRE_VERSION};
