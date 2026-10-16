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
//! is a [`Placement`] a caller hands in:
//!
//! - [`Placement::InWindow`]: mpv draws into a child window of the Host's own,
//!   given through mpv's `wid` — set before mpv is initialized, because `wid` is
//!   an option and mpv reads it once. This is the Windows shape, proven on the
//!   prototype branch (#3); the child window is then pushed behind the Host's
//!   webview and made click-through, which is the shell's business, not a
//!   Player's.
//! - [`Placement::OwnWindow`]: mpv opens a window of its own, for platforms that
//!   have no `wid` at all (Wayland, macOS) and for X11 until #19 settles whether
//!   the overlay works there. The picture is mpv's and the Host's interface is
//!   in its own window above it.
//! - [`Placement::Headless`]: no video output and no audio output, which is what a
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
//!
//! ## Black bars are mpv's own business
//!
//! ADR-0003 settles that the picture is mpv's and the Host never composites a
//! frame, so the black bars around a Stream are handled by mpv's own tooling
//! rather than a reimplementation: mpv ships `TOOLS/lua/autocrop.lua`, which
//! drives `cropdetect` and the `video-crop` property, and it is vendored here
//! verbatim as `scripts/autocrop.lua` and loaded into every Player. mpv's own
//! script is the behaviour a person gets from mpv, and the Host's job is to not
//! fight it: a manual `video-crop` the Host sets is overwritten by the script's
//! next run, which is exactly what "a stock mpv script driving the property"
//! means. mpv's script is GPL-compatible with this crate's own licence, and the
//! checked-in copy is used as it came from upstream.

mod observing;
mod telling;

use std::sync::{Mutex, OnceLock};

use host_core::{Observation, Picture, PlaybackError, Player, StreamUrl, Telling};
use libmpv2::events::Event;
use libmpv2::mpv_end_file_reason as EndFileReason;
use libmpv2::Mpv;

use crate::observing::{failure_words, observe, Memory, Properties, RawChapter, RawTrack};

/// mpv's stock autocrop script, vendored from upstream (ADR-0003).
///
/// `TOOLS/lua/autocrop.lua` from mpv's own tree, unmodified and embedded so
/// that a Player gets the same black-bar behaviour as the command-line player
/// without shipping a separate file beside the binary. It was taken from
/// <https://raw.githubusercontent.com/mpv-player/mpv/master/TOOLS/lua/autocrop.lua>
/// (sha256 `2e7afdc366b4c54451b4faab1e350a3f6119a4cd4a1c6d984d98e2347a6fbb20`)
/// and is GPL-compatible with this crate's own licence.
const AUTOCROP: &str = include_str!("../scripts/autocrop.lua");

/// Where the picture is put, as this platform can manage it.
///
/// The *placing* of the picture is not the picture: a Player is started with
/// where to draw — the platform's own handle, a window of its own, or nowhere —
/// and what it reports afterwards is the [`Picture`] that came of it, which is
/// the word the Glossary and every Snapshot use. It cannot change afterwards:
/// `wid` is read by mpv when it initializes, and a window that exists is not one
/// mpv moves to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Placement {
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
pub(crate) fn picture(surface: Placement) -> Picture {
    match surface {
        Placement::InWindow { .. } => Picture::InWindow,
        Placement::OwnWindow => Picture::OwnWindow,
        Placement::Headless => Picture::Nowhere,
    }
}

/// Where the vendored autocrop script was written for this process, if it could
/// be written at all.
///
/// mpv's `scripts` is an initialization-only option that takes *paths*, so the
/// script embedded above has to exist on disk before mpv starts. It is written
/// once per process — every Player a process builds is handed the same path —
/// under a name that carries the process id so two processes do not overwrite
/// each other's copy. A failure to write it is logged and returns nothing: a
/// Player without the stock autocrop still plays, and that is the only failure
/// a person would accept here.
fn autocrop_script() -> Option<&'static str> {
    static ON_DISK: OnceLock<Option<String>> = OnceLock::new();

    ON_DISK
        .get_or_init(|| {
            let path = std::env::temp_dir()
                .join(format!("streamingapp-autocrop-{}.lua", std::process::id()));
            match std::fs::write(&path, AUTOCROP) {
                Ok(()) => path.to_str().map(str::to_owned),
                Err(error) => {
                    tracing::warn!(
                        %error,
                        "mpv's stock autocrop script could not be written; playback \
                         continues without it"
                    );
                    None
                }
            }
        })
        .as_deref()
}

/// The real Player: mpv, in this process, with the picture wherever `Placement`
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
    ///
    /// mpv's stock autocrop script is written out and loaded here — as an
    /// option, before mpv starts — unless writing it failed, in which case
    /// playback goes on without it.
    pub fn start(surface: Placement) -> Result<Self, MpvError> {
        let script = autocrop_script();
        let mpv = Mpv::with_initializer(|init| {
            for (name, value) in options(surface, script) {
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

    /// Run one mpv command, and report what mpv said about the command itself.
    ///
    /// The command is already in mpv's own spelling — the pure half, in
    /// [`telling`] — so what is left here is only the call.
    fn run(&self, command: (&'static str, Vec<String>)) -> Result<(), PlaybackError> {
        let (name, arguments) = command;
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
    ///
    /// Lists — the tracks and the chapters — come through mpv's indexed
    /// property syntax, one property per field, because the safe crate reads
    /// only scalars off a handle (no `NODE`/JSON), and everything is handed on
    /// in mpv's own shape for [`observe`] to decide.
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
            tracks: self.tracks(),
            chapters: self.chapters(),
            chapter: self.mpv.get_property::<i64>("chapter").ok(),
            speed: self.number("speed"),
            volume: self.number("volume"),
            muted: self.mpv.get_property::<bool>("mute").ok(),
            subtitle_delay: self.number("sub-delay"),
            crop: self.mpv.get_property::<String>("video-crop").ok(),
            aspect: self.number("video-aspect-override"),
            width: self.mpv.get_property::<i64>("width").ok(),
            height: self.mpv.get_property::<i64>("height").ok(),
            video_bitrate: self.mpv.get_property::<i64>("video-bitrate").ok(),
            dropped_frames: self.mpv.get_property::<i64>("frame-drop-count").ok(),
            hardware_decode: self.text("hwdec-current"),
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

    /// One real property, where mpv answers with a number.
    fn number(&self, name: &str) -> Option<f64> {
        self.mpv
            .get_property::<f64>(name)
            .ok()
            .filter(|value| value.is_finite())
    }

    /// One string property, where it says something rather than nothing.
    fn text(&self, name: &str) -> Option<String> {
        self.mpv
            .get_property::<String>(name)
            .ok()
            .filter(|word| !word.is_empty())
    }

    /// Every track mpv lists, in mpv's own order.
    ///
    /// `track-list/count` answers zero when nothing is loaded — a fact about the
    /// file — and each track is a numbered set of properties beneath it. A track
    /// mpv cannot name a type for is not one anything here could control, so it
    /// is left out.
    ///
    /// `None` is mpv refusing to answer how many tracks there are, which is not
    /// a file with no tracks: the Host waits for a report it can act on rather
    /// than treating a failed read as an empty Stream (ADR-0014).
    fn tracks(&self) -> Option<Vec<RawTrack>> {
        let count = self.mpv.get_property::<i64>("track-list/count").ok()?;

        Some(
            (0..count.max(0))
                .filter_map(|index| {
                    Some(RawTrack {
                        id: self
                            .mpv
                            .get_property::<i64>(&format!("track-list/{index}/id"))
                            .ok()?,
                        kind: self
                            .mpv
                            .get_property::<String>(&format!("track-list/{index}/type"))
                            .ok()?,
                        language: self.text(&format!("track-list/{index}/lang")),
                        title: self.text(&format!("track-list/{index}/title")),
                        codec: self.text(&format!("track-list/{index}/codec")),
                        external: self
                            .mpv
                            .get_property::<bool>(&format!("track-list/{index}/external"))
                            .unwrap_or(false),
                        selected: self
                            .mpv
                            .get_property::<bool>(&format!("track-list/{index}/selected"))
                            .unwrap_or(false),
                        default: self
                            .mpv
                            .get_property::<bool>(&format!("track-list/{index}/default"))
                            .unwrap_or(false),
                        forced: self
                            .mpv
                            .get_property::<bool>(&format!("track-list/{index}/forced"))
                            .unwrap_or(false),
                    })
                })
                .collect(),
        )
    }

    /// Every chapter mpv lists, in the order the container gives them.
    fn chapters(&self) -> Vec<RawChapter> {
        let count = self
            .mpv
            .get_property::<i64>("chapter-list/count")
            .unwrap_or(0);

        (0..count.max(0))
            .map(|index| RawChapter {
                title: self.text(&format!("chapter-list/{index}/title")),
                time: self
                    .mpv
                    .get_property::<f64>(&format!("chapter-list/{index}/time"))
                    .unwrap_or(0.0),
            })
            .collect()
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

        // An open that mpv will not even take is the one failure this call can
        // report: whether the *Stream* opens is found out later, in `observe`.
        let result = self.run(telling::load(url)).map_err(|error| match error {
            PlaybackError::Command { detail } => PlaybackError::Open { detail },
            other => other,
        });
        if result.is_ok() {
            *memory = Memory::asking();
        }
        result
    }

    fn tell(&self, telling: Telling) -> Result<(), PlaybackError> {
        self.run(telling::command(&telling))
    }

    fn stop(&self) -> Result<(), PlaybackError> {
        let mut memory = self
            .memory
            .lock()
            .expect("nothing panics while holding the Player's memory");
        let result = self.run(telling::stop());
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
        let (current, format) = self.decoding();
        if memory.reported(&observation, format.is_some()) {
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
///
/// `scripts` is where mpv's stock autocrop goes, and it is an option only mpv
/// reads before it starts — like `wid` — so its path is resolved by the caller
/// and passed in rather than written by this pure half.
fn options(surface: Placement, script: Option<&str>) -> Vec<(&'static str, String)> {
    let mut options: Vec<(&'static str, String)> = vec![
        (
            "vo",
            match surface {
                Placement::Headless => "null",
                // HDR passthrough needs gpu-next, and the fallback keeps a
                // machine without it playing (ADR-0003).
                Placement::InWindow { .. } | Placement::OwnWindow => "gpu-next,gpu,",
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

    // mpv's own autocrop script, from a path that exists on disk; absent when
    // it could not be written, which is a Player without autocrop and not a
    // Player that will not start. The option's name is `scripts`, a list:
    // `script` is only an alias for `--scripts-append` on the command line and
    // is not an option the client API knows.
    if let Some(script) = script {
        options.push(("scripts", script.to_owned()));
    }

    match surface {
        // `wid`, before mpv is initialized: it is an option, and mpv reads it
        // once. This is the one thing the prototype's recipe carries over as a
        // constraint rather than a curiosity (docs/research/spike-windows-embedding.md).
        Placement::InWindow { handle } => options.push(("wid", handle.to_string())),
        Placement::OwnWindow => {}
        // Nobody to hear it: a Stream still plays, and every property a headless
        // test asserts on is answered the same way.
        Placement::Headless => options.push(("ao", "null".to_owned())),
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
        let options = options(Placement::InWindow { handle: 1234 }, None);

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
        let options = options(Placement::OwnWindow, None);

        assert_eq!(option(&options, "wid"), None);
        assert_eq!(
            option(&options, "vo"),
            Some("gpu-next,gpu,"),
            "the picture is still mpv's own, in mpv's own window"
        );
    }

    #[test]
    fn a_headless_player_draws_nowhere_and_says_nothing() {
        let options = options(Placement::Headless, None);

        assert_eq!(option(&options, "vo"), Some("null"));
        assert_eq!(option(&options, "ao"), Some("null"));
        assert_eq!(option(&options, "wid"), None);
    }

    #[test]
    fn the_stock_autocrop_script_is_loaded_before_mpv_starts() {
        // `scripts` is an option mpv reads once, at initialization, and the
        // Player hands it the path it wrote the vendored script to.
        let with_script = options(
            Placement::Headless,
            Some("/tmp/streamingapp-autocrop-1.lua"),
        );

        assert_eq!(
            option(&with_script, "scripts"),
            Some("/tmp/streamingapp-autocrop-1.lua"),
            "mpv's own autocrop runs for every Player (ADR-0003)"
        );

        assert_eq!(
            option(&options(Placement::Headless, None), "scripts"),
            None,
            "a Player whose script could not be written starts without it"
        );
    }

    #[test]
    fn where_the_picture_is_is_what_the_placement_says() {
        assert_eq!(
            picture(Placement::InWindow { handle: 1 }),
            Picture::InWindow,
            "a picture in the Host's own window is one the interface leaves a hole for"
        );
        assert_eq!(picture(Placement::OwnWindow), Picture::OwnWindow);
        assert_eq!(picture(Placement::Headless), Picture::Nowhere);
    }

    #[test]
    fn a_stream_at_its_end_stays_loaded_so_that_ended_is_a_state_the_host_can_see() {
        for surface in [
            Placement::InWindow { handle: 1 },
            Placement::OwnWindow,
            Placement::Headless,
        ] {
            assert_eq!(
                option(&options(surface, None), "keep-open"),
                Some("yes"),
                "{surface:?} leaves a Stream at its end rather than unloading it"
            );
        }
    }
}
