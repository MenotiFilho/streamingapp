//! The Player this platform gets, and the window juggling Windows needs to put
//! its picture inside the Host's own window.
//!
//! `host-core` asks for playback through its `Player` seam; this module is the
//! shell's part of the answer: *which* mechanism the seam is given on this
//! platform, and — where the picture lands in the Host's own window — the
//! platform calls that make that window behave.
//!
//! ## Which surface (ADR-0003, ADR-0007, and #19)
//!
//! - **Windows**: mpv is given the Host window's `HWND` as its `wid`, so it
//!   draws into a child window of ours. The prototype branch proved the shape
//!   (#3): the child is pushed to the bottom of the z-order, the webview above
//!   it draws the interface, and clicks land on the interface.
//! - **Everywhere else**: mpv opens a window of its own. X11 *could* be handed a
//!   `wid` too, and whether the overlay works there is exactly what #19 is for;
//!   until it is settled, assuming it would be a guess. Wayland and macOS have
//!   no `wid` to give at all.
//!
//! A Player that will not start is not a Host that will not run: playback is one
//! of the things the Host does, so a machine without a usable libmpv browses,
//! searches and explains that it cannot play, rather than refusing to open.

use std::sync::Arc;

use host_core::{Observation, Picture, PlaybackError, Player, SeekTarget, StreamUrl};
use host_mpv::{MpvError, MpvPlayer, Placement};
use tauri::WebviewWindow;

#[cfg(windows)]
mod windows;

/// Start the Player this platform gets, and start watching for the picture
/// window where there is one to watch for.
pub fn start(window: &WebviewWindow) -> Result<Arc<dyn Player>, MpvError> {
    let placement = placement(window);
    let player = Arc::new(MpvPlayer::start(placement)?);

    #[cfg(windows)]
    if let Placement::InWindow { handle } = placement {
        // mpv creates its child window when a Stream starts, and a child window
        // is created on top: the picture would cover the interface until
        // something pushed it down. That something is this, and it keeps the
        // child the size of the window from then on.
        windows::adopt(handle);
    }

    Ok(player)
}

/// Where the picture goes on this platform.
fn placement(window: &WebviewWindow) -> Placement {
    #[cfg(windows)]
    {
        // The handle Tauri made the window with: `wid` is set before mpv is
        // initialized, and mpv reads it once.
        return match window.hwnd() {
            Ok(handle) => Placement::InWindow {
                handle: handle.0 as i64,
            },
            Err(error) => {
                tracing::warn!(%error, "the Host's window has no handle to give mpv");
                Placement::OwnWindow
            }
        };
    }

    #[cfg(not(windows))]
    {
        let _ = window;
        Placement::OwnWindow
    }
}

/// The Player a Host gets when there is none: every telling is refused, and it
/// says why in the words the failure was reported with.
///
/// Playback is one of the things the Host does, not the thing it is: a machine
/// whose libmpv will not start still browses, and says plainly that nothing can
/// play. Every refusal reads the same, because the reason is the same.
pub struct NoPlayer {
    detail: String,
}

impl NoPlayer {
    pub fn new(detail: impl Into<String>) -> Self {
        Self {
            detail: detail.into(),
        }
    }

    fn refusal(&self) -> PlaybackError {
        PlaybackError::Command {
            detail: self.detail.clone(),
        }
    }
}

impl Player for NoPlayer {
    fn picture(&self) -> Picture {
        Picture::Nowhere
    }

    fn open(&self, _url: &StreamUrl) -> Result<(), PlaybackError> {
        Err(self.refusal())
    }

    fn set_paused(&self, _paused: bool) -> Result<(), PlaybackError> {
        Err(self.refusal())
    }

    fn seek(&self, _target: SeekTarget) -> Result<(), PlaybackError> {
        Err(self.refusal())
    }

    fn stop(&self) -> Result<(), PlaybackError> {
        Err(self.refusal())
    }

    fn observe(&self) -> Observation {
        Observation::idle()
    }
}
