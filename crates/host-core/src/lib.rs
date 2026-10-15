//! The Host's domain: its state, the one Action surface that changes it, and the
//! Snapshots it publishes.
//!
//! Nothing here knows about Tauri, about the network or about SQL. The app shell
//! in `src-tauri/` and the remote client server a later ticket adds are both thin
//! translators over the same door: an [`Action`] in, a state change and emitted
//! [`Snapshot`]s out (ADR-0002).
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
//! let published = host.dispatch(action)?;
//!
//! let preferred = published[0].preferences.subtitle_language.as_ref();
//! assert_eq!(preferred.map(SubtitleLanguage::as_str), Some("pt-BR"));
//! # Ok::<(), Box<dyn std::error::Error>>(())
//! ```

mod action;
mod addon;
mod fetcher;
mod host;
mod preferences;
mod snapshot;
mod state;
mod store;

pub use action::{Action, ActionError, ValidatedAction, ACTION_VERSION};
pub use addon::{
    Addon, AddonId, BehaviorHints, Catalog, InvalidAddonId, InvalidManifestUrl, Manifest,
    ManifestError, ManifestUrl, Resource, MAX_ITEMS, MAX_MANIFEST_BYTES, MAX_STRING_LEN,
    MAX_URL_LEN,
};
pub use fetcher::{FetchError, Fetcher, FixtureFetcher};
pub use host::Host;
pub use preferences::{InvalidSubtitleLanguage, Preferences, SubtitleLanguage};
pub use snapshot::{PreferencesSnapshot, Snapshot};
pub use store::{InMemoryStore, Store, StoreError};
