//! The two bridges to the one Action surface: the window's, and the wire's.
//!
//! This module is a translator and nothing else. It parses the envelope the
//! window sent, hands the Action to the Host, and publishes the Snapshots that
//! came back; and it implements [`host_wire::Surface`] so that a remote client
//! reaches exactly the same door. It decides nothing, so the window has no
//! capability a remote client could not have (ADR-0002).
//!
//! Publishing is one place for both: a Snapshot goes to the window over Tauri's
//! event bus and to every paired remote connection through the [`Broadcast`], and
//! a client cannot tell which of the two carried it.

use std::sync::Arc;

use host_core::{
    Action, ActionError, DeviceSummary, DeviceToken, Host, HostDoor, Response, Snapshot,
};
use host_wire::{Broadcast, Surface};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

/// The event the Host publishes Snapshots on. A client listens, and never polls
/// for state it changed itself.
pub const SNAPSHOT_EVENT: &str = "host://snapshot";

/// The Host, as the window's commands hold it.
///
/// A wrapper and nothing else: the lock policy is [`HostDoor`]'s in `host-core`,
/// where the question/change split is decided (ADR-0022). The shell holds the
/// door, forwards the calls, and owns no mutex of its own.
pub struct HostHandle(HostDoor);

impl HostHandle {
    pub fn new(host: Host) -> Self {
        Self(HostDoor::new(host))
    }

    /// Take an Action, without publishing what came of it: the callers differ in
    /// where they publish, and there is one place for each of them.
    pub fn dispatch(&self, action: Action) -> Result<Response, ActionError> {
        self.0.dispatch(action)
    }

    /// Read the Player and fold what it reports into state, publishing a
    /// Snapshot when anything moved.
    ///
    /// This is the shell's clock and not a client's Action: playback moves on its
    /// own, and the Host holds no threads and no timers of its own (ADR-0013).
    /// A report that says what the Host already held returns nothing.
    pub fn sample(&self) -> Option<Snapshot> {
        self.0.sample()
    }

    /// Merge newer remote watch progress from the Stremio account into the
    /// library (#30), publishing a Snapshot if anything moved.
    pub fn pull_remote(&self) -> Option<Snapshot> {
        self.0.pull_remote()
    }

    /// The Host is going away: write down where the Stream got to, and tell the
    /// account where one is signed in (#30). Answers whether an account was told.
    pub fn shutdown(&self) -> bool {
        self.0.shutdown()
    }

    /// Tell the Host where its wire server answers, once it has bound.
    pub fn set_serving(&self, address: &str) {
        self.0.set_serving(address);
    }

    /// The state as it stands — what a window that has just loaded is owed.
    pub fn snapshot(&self) -> Snapshot {
        self.0.snapshot()
    }

    /// The device a presented token belongs to, or nothing (#31).
    pub fn device(&self, token: &DeviceToken) -> Option<DeviceSummary> {
        self.0.device(token)
    }
}

/// The state as it stands — what a window that has just loaded is owed.
#[tauri::command]
pub fn snapshot(host: tauri::State<'_, HostHandle>) -> Snapshot {
    host.snapshot()
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
    let response = host.dispatch(action)?;

    publish(&app, &response.snapshots);

    Ok(response)
}

/// Send Snapshots to every window that is listening, and to every paired remote
/// connection.
///
/// One place, so that the clock in the shell, an Action taken by the window and an
/// Action taken by a remote client publish the same way and a client cannot tell
/// which of them moved the state.
pub fn publish(app: &AppHandle, snapshots: &[Snapshot]) {
    for snapshot in snapshots {
        tracing::info!(revision = snapshot.revision, "publishing a Snapshot");
        if let Err(error) = app.emit(SNAPSHOT_EVENT, snapshot) {
            // The window that asked may be closing, or reloading. There is nobody
            // left to tell, and nothing the Host should undo over it.
            tracing::warn!(%error, "no window took the Snapshot");
        }
        if let Some(broadcast) = app.try_state::<Broadcast>() {
            broadcast.publish(snapshot);
        }
    }
}

/// The Action surface, as the wire server reaches it (#31).
///
/// The same handle the window's commands use, and the same `publish`: a remote
/// client is the window's equal, and the only thing this adds is that the
/// Snapshots also go out over the WebSocket.
pub struct WireSurface {
    app: AppHandle,
}

impl WireSurface {
    pub fn new(app: AppHandle) -> Arc<Self> {
        Arc::new(Self { app })
    }
}

impl Surface for WireSurface {
    fn dispatch(&self, action: Action) -> Result<Response, ActionError> {
        let response = self.app.state::<HostHandle>().dispatch(action)?;
        publish(&self.app, &response.snapshots);
        Ok(response)
    }

    fn device(&self, token: &DeviceToken) -> Option<DeviceSummary> {
        self.app.state::<HostHandle>().device(token)
    }

    fn snapshot(&self) -> Snapshot {
        self.app.state::<HostHandle>().snapshot()
    }
}
