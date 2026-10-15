//! The Tauri IPC bridge: the Action surface, reached from the window.
//!
//! This module is a translator and nothing else. It parses the envelope the
//! window sent, hands the Action to the Host, and publishes the Snapshots that
//! came back. It decides nothing, so the window has no capability a remote client
//! could not have (ADR-0002).

use std::sync::Mutex;

use host_core::{Action, ActionError, Host, Snapshot};
use serde_json::Value;
use tauri::{AppHandle, Emitter};

/// The event the Host publishes Snapshots on. A client listens, and never polls
/// for state it changed itself.
pub const SNAPSHOT_EVENT: &str = "host://snapshot";

/// The Host, as the window's commands hold it.
///
/// One mutex, held for the length of one Action: the Action surface is the only
/// door, and it is a door one client goes through at a time.
pub struct HostHandle(Mutex<Host>);

impl HostHandle {
    pub fn new(host: Host) -> Self {
        Self(Mutex::new(host))
    }
}

/// The state as it stands — what a window that has just loaded is owed.
#[tauri::command]
pub fn snapshot(host: tauri::State<'_, HostHandle>) -> Snapshot {
    host.0
        .lock()
        .expect("nothing panics while holding the Host")
        .snapshot()
}

/// Take an Action, and publish what changed.
///
/// The envelope arrives as raw JSON and is parsed by the Host's own surface, so a
/// malformed one comes back in the Host's vocabulary (`malformed`,
/// `unsupported_version`, …) rather than as an IPC deserialization error.
#[tauri::command]
pub fn dispatch(
    app: AppHandle,
    host: tauri::State<'_, HostHandle>,
    envelope: Value,
) -> Result<(), ActionError> {
    let action: Action = Action::parse_value(&envelope)?;
    let published = host
        .0
        .lock()
        .expect("nothing panics while holding the Host")
        .dispatch(action)?;

    for snapshot in published {
        tracing::info!(revision = snapshot.revision, "publishing a Snapshot");
        if let Err(error) = app.emit(SNAPSHOT_EVENT, snapshot) {
            // The window that asked may be closing, or reloading. There is nobody
            // left to tell, and nothing the Host should undo over it.
            tracing::warn!(%error, "no window took the Snapshot");
        }
    }

    Ok(())
}
