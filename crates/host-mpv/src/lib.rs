//! The Host's Player, made real: mpv, linked in-process, with the picture where
//! this platform can put it.
//!
//! `host-core` asks for playback through [`host_core::Player`]; this crate is
//! what answers. The seam and the Host's rules live there, and nothing here
//! decides anything about a Stream beyond how mpv is told and how mpv is read —
//! both pure, both in [`telling`] and [`observing`].
//!
//! ## The picture, per platform (ADR-0003, ADR-0007)
//!
//! mpv owns the video output and its swapchain, so that HDR and 10-bit reach the
//! display through mpv's own pipeline; the Host never composites a frame. Where
//! that surface *is* is the one thing the Host cannot decide on its own, so it
//! is a [`Surface`] a caller hands in:
//!
//! - [`Surface::InWindow`]: mpv draws into a child window of the Host's own,
//!   given through mpv's `wid` — set before mpv is initialized, because `wid` is
//!   an option and mpv reads it once. This is the Windows shape, proven on the
//!   prototype branch (#3); the child window is then pushed behind the Host's
//!   webview and made click-through, which is the shell's business, not a
//!   Player's.
//! - [`Surface::OwnWindow`]: mpv opens a window of its own, for platforms that
//!   have no `wid` at all (Wayland, macOS) and for X11 until #19 settles whether
//!   the overlay works there. The picture is mpv's and the Host's interface is
//!   in its own window above it.
//! - [`Surface::Headless`]: no video output and no audio output, which is what a
//!   test drives a real mpv with.
//!
//! ## What mpv is started with
//!
//! HDR passthrough needs `gpu-next`; hardware decode is `auto-safe`, so a
//! machine without it still plays; `keep-open` leaves a Stream at its end
//! instead of unloading it, which is what makes "ended" something the Host can
//! see and resume from (#29); and the options that only mean something at
//! initialization — `wid` among them — are set on the handle before
//! `mpv_initialize` runs.

mod observing;
mod telling;

use std::sync::Mutex;

use host_core::{Observation, Picture, PlaybackError, Player, SeekTarget, StreamUrl};
use libmpv2::events::Event;
use libmpv2::mpv_end_file_reason as EndFileReason;
use libmpv2::Mpv;

use crate::observing::{failure_words, observe, Memory, Properties};
use crate::telling::Telling;

/// Where the picture is put, as this platform can manage it.
///
/// A Player is started with one, and it cannot change afterwards: `wid` is read
/// by mpv when it initializes, and a window that exists is not one mpv moves to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Surface {
    /// Inside the Host's own window, by the platform's window handle: mpv draws
    /// into a child window of it (`wid`).
    InWindow { handle: i64 },
    /// In a window of mpv's own, for a platform that cannot hand mpv a place to
    /// draw inside the Host's.
    OwnWindow,
    /// Nowhere: no video output is opened at all. What a headless test drives.
    Headless,
}

/// Why a Player could not be started.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("mpv could not be started: {detail}")]
pub struct MpvError {
    pub detail: String,
}

impl From<libmpv2::Error> for MpvError {
    fn from(error: libmpv2::Error) -> Self {
        Self {
            detail: error.to_string(),
        }
    }
}

/// What a surface means for where the picture is, as every client is told it.
pub(crate) fn picture(surface: Surface) -> Picture {
    match surface {
        Surface::InWindow { .. } => Picture::InWindow,
        Surface::OwnWindow => Picture::OwnWindow,
        Surface::Headless => Picture::Nowhere,
    }
}

/// The real Player: mpv, in this process, with the picture wherever `Surface`
/// says.
pub struct MpvPlayer {
    mpv: Mpv,
    /// Where the picture was put, settled when mpv was started and asked of the
    /// Host once.
    picture: Picture,
    /// What mpv's events said about the open it was given — the part of its
    /// answer that is said once rather than read whenever it is asked.
    memory: Mutex<Memory>,
}

impl MpvPlayer {
    /// Start mpv with this surface.
    ///
    /// The options are set before mpv is initialized, which is the only time
    /// `wid` can be set, and the event queue is drained rather than waited on
    /// afterwards: the Host asks a Player what it is doing, and a Player that
    /// blocked on mpv's event loop would block the Action surface with it.
    pub fn start(surface: Surface) -> Result<Self, MpvError> {
        let mpv = Mpv::with_initializer(|init| {
            for (name, value) in options(surface) {
                init.set_option(name, value.as_str())?;
            }
            Ok(())
        })?;

        Ok(Self {
            mpv,
            picture: picture(surface),
            memory: Mutex::new(Memory::idle()),
        })
    }

    /// Tell mpv one thing, and report what mpv said about the telling itself.
    fn tell(&self, telling: Telling) -> Result<(), PlaybackError> {
        let (name, arguments) = telling.command();
        let arguments: Vec<&str> = arguments.iter().map(String::as_str).collect();

        self.mpv
            .command(name, &arguments)
            .map_err(|error| PlaybackError::Command {
                detail: error.to_string(),
            })
    }

    /// Drain everything mpv has said since the last time it was asked, into the
    /// memory the Host's reading is built from.
    fn drain(&self, memory: &mut Memory) {
        loop {
            match self.mpv.wait_event(0.0) {
                None => break,
                Some(Ok(Event::StartFile)) | Some(Ok(Event::FileLoaded)) => memory.started(),
                Some(Ok(Event::EndFile(EndFileReason::Eof))) => memory.reached_end(),
                Some(Ok(Event::EndFile(_))) => memory.let_go(),
                // mpv reports "that file could not be played" as the event's
                // own error rather than a reason, which is exactly the case
                // this keeps the words for.
                Some(Err(error)) => memory.failed(failure_words(code_of(&error))),
                Some(Ok(_)) => {}
            }
        }
    }

    /// What mpv is decoding with, where it says: its `hwdec-current` and the
    /// picture's own pixel format.
    ///
    /// Not part of the Host's state — #28's statistics are where a *client*
    /// reads this — but the one fact that says whether hardware decode is
    /// engaged at all, and the one thing a person debugging playback wants in
    /// the log. A URL never appears here: an mpv `path` is the Stream.
    fn decoding(&self) -> (Option<String>, Option<String>) {
        let current = self
            .mpv
            .get_property::<String>("hwdec-current")
            .ok()
            .filter(|name| !name.is_empty());
        let format = self
            .mpv
            .get_property::<String>("video-params.pixelformat")
            .ok()
            .filter(|name| !name.is_empty());

        (current, format)
    }

    /// What mpv's properties answer right now.
    fn properties(&self) -> Properties {
        Properties {
            // A `path` is the one property that says a file is loaded: a
            // position is unavailable while one is being opened, and a pause is
            // true whether or not there is anything to pause.
            loaded: self.mpv.get_property::<String>("path").is_ok(),
            paused: self.mpv.get_property::<bool>("pause").unwrap_or(false),
            ended: self
                .mpv
                .get_property::<bool>("eof-reached")
                .unwrap_or(false),
            position: self.position(),
            duration: self.duration(),
        }
    }

    /// Where playback is, where mpv has a position at all.
    fn position(&self) -> Option<f64> {
        self.mpv
            .get_property::<f64>("time-pos")
            .ok()
            .filter(|seconds| seconds.is_finite() && *seconds >= 0.0)
    }

    /// How long the file is, where it says at all — a live Stream does not.
    fn duration(&self) -> Option<f64> {
        self.mpv
            .get_property::<f64>("duration")
            .ok()
            .filter(|seconds| seconds.is_finite() && *seconds > 0.0)
    }
}

impl Player for MpvPlayer {
    fn picture(&self) -> Picture {
        self.picture
    }

    fn open(&self, url: &StreamUrl) -> Result<(), PlaybackError> {
        // Whatever the last open left behind is over: an ending already in the
        // queue is about the Stream being replaced, not the one being asked
        // for, and taking it for the new one would report a failure that was
        // not its own.
        let mut memory = self
            .memory
            .lock()
            .expect("nothing panics while holding the Player's memory");
        self.drain(&mut memory);
        let result = self.tell(Telling::Load(url.clone()));
        if result.is_ok() {
            *memory = Memory::asking();
        }
        result
    }

    fn set_paused(&self, paused: bool) -> Result<(), PlaybackError> {
        self.tell(Telling::Pause(paused))
    }

    fn seek(&self, target: SeekTarget) -> Result<(), PlaybackError> {
        self.tell(Telling::Seek(target))
    }

    fn stop(&self) -> Result<(), PlaybackError> {
        let mut memory = self
            .memory
            .lock()
            .expect("nothing panics while holding the Player's memory");
        let result = self.tell(Telling::Stop);
        if result.is_ok() {
            self.drain(&mut memory);
            *memory = Memory::idle();
        }
        result
    }

    fn observe(&self) -> Observation {
        let mut memory = self
            .memory
            .lock()
            .expect("nothing panics while holding the Player's memory");
        self.drain(&mut memory);
        let properties = self.properties();
        let observation = observe(&memory, &properties);

        // Said once per Stream, when the picture first comes up: what mpv is
        // decoding with is what says whether hardware decode is engaged, and a
        // log is where a person finds that out (the walkthrough checks this
        // line). Nothing about the Stream appears beside it.
        if memory.watching(&observation) {
            let (current, format) = self.decoding();
            tracing::info!(
                hwdec = current.as_deref().unwrap_or("no"),
                pixelformat = format.as_deref().unwrap_or("unknown"),
                "the picture is playing",
            );
        }

        observation
    }
}

/// The options mpv is started with, as its own names and values.
///
/// Pure, and tested as the list it is: what a Player is started with is a
/// decision, and a decision that lives in a test is one that cannot be changed
/// by accident. `gpu-next` because HDR passthrough needs it and the fallback
/// keeps a machine without it playing (ADR-0003); `hwdec=auto-safe` so that
/// hardware decode is engaged where the machine can and playback still works
/// where it cannot; `keep-open` so that a Stream at its end stays loaded, which
/// is what makes "ended" and a resume from it possible (#29).
fn options(surface: Surface) -> Vec<(&'static str, String)> {
    let mut options: Vec<(&'static str, String)> = vec![
        (
            "vo",
            match surface {
                Surface::Headless => "null",
                // HDR passthrough needs gpu-next, and the fallback keeps a
                // machine without it playing (ADR-0003).
                Surface::InWindow { .. } | Surface::OwnWindow => "gpu-next,gpu,",
            }
            .to_owned(),
        ),
        ("hwdec", "auto-safe".to_owned()),
        ("keep-open", "yes".to_owned()),
        ("target-colorspace-hint", "yes".to_owned()),
        ("idle", "yes".to_owned()),
        ("config", "no".to_owned()),
        ("osc", "no".to_owned()),
        ("input-default-bindings", "no".to_owned()),
    ];

    match surface {
        // `wid`, before mpv is initialized: it is an option, and mpv reads it
        // once. This is the one thing the prototype's recipe carries over as a
        // constraint rather than a curiosity (docs/research/spike-windows-embedding.md).
        Surface::InWindow { handle } => options.push(("wid", handle.to_string())),
        Surface::OwnWindow => {}
        // Nobody to hear it: a Stream still plays, and every property a headless
        // test asserts on is answered the same way.
        Surface::Headless => options.push(("ao", "null".to_owned())),
    }

    options
}

/// mpv's error number, where the error has one.
fn code_of(error: &libmpv2::Error) -> i32 {
    match error {
        libmpv2::Error::Raw(code) => *code,
        _ => -1,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn option<'a>(options: &'a [(&'static str, String)], name: &str) -> Option<&'a str> {
        options
            .iter()
            .find(|(option, _)| *option == name)
            .map(|(_, value)| value.as_str())
    }

    #[test]
    fn a_host_window_is_told_to_mpv_before_it_is_initialized() {
        let options = options(Surface::InWindow { handle: 1234 });

        assert_eq!(
            option(&options, "wid"),
            Some("1234"),
            "mpv draws into the Host's own window by its handle"
        );
        assert_eq!(
            option(&options, "vo"),
            Some("gpu-next,gpu,"),
            "HDR passthrough needs gpu-next, and the fallback keeps the rest playing"
        );
        assert_eq!(option(&options, "hwdec"), Some("auto-safe"));
    }

    #[test]
    fn a_platform_without_a_place_to_draw_gets_a_window_of_mpvs_own() {
        let options = options(Surface::OwnWindow);

        assert_eq!(option(&options, "wid"), None);
        assert_eq!(
            option(&options, "vo"),
            Some("gpu-next,gpu,"),
            "the picture is still mpv's own, in mpv's own window"
        );
    }

    #[test]
    fn a_headless_player_draws_nowhere_and_says_nothing() {
        let options = options(Surface::Headless);

        assert_eq!(option(&options, "vo"), Some("null"));
        assert_eq!(option(&options, "ao"), Some("null"));
        assert_eq!(option(&options, "wid"), None);
    }

    #[test]
    fn where_the_picture_is_is_what_the_surface_says() {
        assert_eq!(
            picture(Surface::InWindow { handle: 1 }),
            Picture::InWindow,
            "a picture in the Host's own window is one the interface leaves a hole for"
        );
        assert_eq!(picture(Surface::OwnWindow), Picture::OwnWindow);
        assert_eq!(picture(Surface::Headless), Picture::Nowhere);
    }

    #[test]
    fn a_stream_at_its_end_stays_loaded_so_that_ended_is_a_state_the_host_can_see() {
        for surface in [
            Surface::InWindow { handle: 1 },
            Surface::OwnWindow,
            Surface::Headless,
        ] {
            assert_eq!(
                option(&options(surface), "keep-open"),
                Some("yes"),
                "{surface:?} leaves a Stream at its end rather than unloading it"
            );
        }
    }
}
