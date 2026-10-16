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
//! use host_core::{Action, FixtureFetcher, Host, InMemoryStore, SubtitleLanguage};
//!
//! let store = Arc::new(InMemoryStore::new());
//! let fetcher = Arc::new(FixtureFetcher::new());
//! let mut host = Host::new(store, fetcher)?;
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
mod fetcher;
mod host;
mod meta;
mod preferences;
mod request;
mod response;
mod snapshot;
mod state;
mod store;

pub use action::{Action, ActionError, ValidatedAction, ACTION_VERSION};
pub use addon::{
    Addon, AddonId, BehaviorHints, Catalog, ExtraProp, InvalidAddonId, InvalidManifestUrl,
    Manifest, ManifestError, ManifestUrl, Resource, MAX_ITEMS, MAX_MANIFEST_BYTES, MAX_STRING_LEN,
    MAX_URL_LEN,
};
pub use catalog::{CacheHints, CatalogError, CatalogRow, MetaPreview, Page, MAX_CATALOG_BYTES};
pub use fetcher::{FetchError, Fetcher, FixtureFetcher};
pub use host::Host;
pub use meta::{MetaError, Title, Video, MAX_META_BYTES};
pub use preferences::{InvalidSubtitleLanguage, Preferences, SubtitleLanguage};
pub use request::{
    CatalogRef, Extra, InvalidCatalogRef, InvalidExtra, InvalidTitleRef, ResourceRequest, TitleRef,
    CATALOG, MAX_EXTRAS, META, SEARCH, SKIP,
};
pub use response::{Answer, Response};
pub use snapshot::{PreferencesSnapshot, Snapshot};
pub use store::{InMemoryStore, Store, StoreError};
