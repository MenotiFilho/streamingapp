//! Where the Host keeps things.
//!
//! The platform's data directory holds everything the Host owns — the database and
//! the logs — so that uninstalling the app does not take a person's library with
//! it. The config directory is resolved too, for the settings a person may one day
//! want to edit by hand; nothing is written there yet.

use std::io;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};

/// The Host's database, inside the data directory.
pub const DATABASE_FILE: &str = "host.sqlite3";

/// The directory the Host owns: the database, the logs, and later the library.
pub fn data_dir(app: &AppHandle) -> Result<PathBuf, PathError> {
    ensure(app.path().app_data_dir().map_err(PathError::resolve)?)
}

/// The directory for what only this machine needs and nothing is lost without:
/// `%LOCALAPPDATA%\dev.streamingapp.host\` on Windows, where a roaming profile
/// must not carry it. The Torrent engine keeps its torrents in `torrents/` here,
/// and the Host removes that directory at every start (ADR-0042 §3).
pub fn local_data_dir(app: &AppHandle) -> Result<PathBuf, PathError> {
    ensure(
        app.path()
            .app_local_data_dir()
            .map_err(PathError::resolve)?,
    )
}

/// The directory for settings a person may want to edit by hand.
pub fn config_dir(app: &AppHandle) -> Result<PathBuf, PathError> {
    ensure(app.path().app_config_dir().map_err(PathError::resolve)?)
}

fn ensure(directory: PathBuf) -> Result<PathBuf, PathError> {
    std::fs::create_dir_all(&directory).map_err(|source| PathError::Create {
        path: directory.clone(),
        source,
    })?;
    Ok(directory)
}

/// A platform directory the Host could not resolve or create.
#[derive(Debug, thiserror::Error)]
pub enum PathError {
    #[error("the platform has no directory for the Host's {what}: {source}")]
    Resolve {
        what: &'static str,
        #[source]
        source: tauri::Error,
    },

    #[error("the directory {path} could not be created: {source}")]
    Create {
        path: PathBuf,
        #[source]
        source: io::Error,
    },
}

impl PathError {
    fn resolve(source: tauri::Error) -> Self {
        Self::Resolve {
            what: "data and configuration",
            source,
        }
    }
}
