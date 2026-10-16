//! The Tauri IPC bridge: the Action surface, reached from the window.
//!
//! This module is a translator and nothing else. It parses the envelope the
//! window sent, hands the Action to the Host, and publishes the Snapshots that
//! came back. It decides nothing, so the window has no capability a remote client
//! could not have (ADR-0002).

use std::sync::Mutex;

use host_core::{Action, ActionError, Host, Response, Snapshot};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

/// The event the Host publishes Snapshots on. A client listens, and never polls
/// for state it changed itself.
pub const SNAPSHOT_EVENT: &str = "host://snapshot";

/// The Host, as the window's commands hold it.
///
/// One mutex, held for the length of one Action: the Action surface is the only
/// door, and it is a door one client goes through at a time. An Action that
/// fetches — adding an Addon — holds it across the fetch, which is what keeps two
/// Actions from interleaving into a state neither of them asked for.
pub struct HostHandle(Mutex<Host>);

impl HostHandle {
    pub fn new(host: Host) -> Self {
        Self(Mutex::new(host))
    }

    /// Read the Player and fold what it reports into state, publishing a
    /// Snapshot when anything moved.
    ///
    /// This is the shell's clock and not a client's Action: playback moves on its
    /// own, and the Host holds no threads and no timers of its own (ADR-0013).
    /// A report that says what the Host already held returns nothing.
    pub fn sample(&self) -> Option<Snapshot> {
        self.0
            .lock()
            .expect("nothing panics while holding the Host")
            .sample()
    }

    /// Merge newer remote watch progress from the Stremio account into the
    /// library (#30), publishing a Snapshot if anything moved.
    pub fn pull_remote(&self) -> Option<Snapshot> {
        self.0
            .lock()
            .expect("nothing panics while holding the Host")
            .pull_remote()
    }

    /// The Host is going away: write down where the Stream got to, and tell the
    /// account where one is signed in (#30). Answers whether an account was told.
    pub fn shutdown(&self) -> bool {
        self.0
            .lock()
            .expect("nothing panics while holding the Host")
            .shutdown()
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

/// Take an Action, publish what changed, and answer the caller.
///
/// The envelope arrives as raw JSON and is parsed by the Host's own surface, so a
/// malformed one comes back in the Host's vocabulary (`malformed`,
/// `unsupported_version`, …) rather than as an IPC deserialization error.
///
/// This one runs off the main thread: taking an Action can mean fetching an
/// Addon's manifest or a page of one of its catalogs, and the window must not
/// freeze on someone else's server. The Host is reached through the `AppHandle`
/// rather than a borrowed `State`, because a command defined this way may not
/// hold a borrow across the thread it runs on.
///
/// The Snapshots go to every window; the answer is returned to the one that
/// asked, because browsing is a client's own business (ADR-0005).
#[tauri::command(async)]
pub fn dispatch(app: AppHandle, envelope: Value) -> Result<Response, ActionError> {
    let action: Action = Action::parse_value(&envelope)?;
    let host = app.state::<HostHandle>();
    let response = host
        .0
        .lock()
        .expect("nothing panics while holding the Host")
        .dispatch(action)?;

    publish(&app, &response.snapshots);

    Ok(response)
}

/// Send Snapshots to every window that is listening.
///
/// One place, so that the clock in the shell and an Action taken by a client
/// publish the same way and a client cannot tell which of them moved the state.
pub fn publish(app: &AppHandle, snapshots: &[Snapshot]) {
    for snapshot in snapshots {
        tracing::info!(revision = snapshot.revision, "publishing a Snapshot");
        if let Err(error) = app.emit(SNAPSHOT_EVENT, snapshot) {
            // The window that asked may be closing, or reloading. There is nobody
            // left to tell, and nothing the Host should undo over it.
            tracing::warn!(%error, "no window took the Snapshot");
        }
    }
}
