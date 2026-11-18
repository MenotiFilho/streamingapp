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
//! ## Black bars are mpv's own business, asked for by a client
//!
//! ADR-0003 settles that the picture is mpv's and the Host never composites a
//! frame, so the black bars around a Stream are handled by mpv's own tooling
//! rather than a reimplementation: mpv ships `TOOLS/lua/autocrop.lua`, which
//! drives `cropdetect` and the `video-crop` property, and it is vendored here
//! verbatim as `scripts/autocrop.lua` and loaded into every Player. The Host
//! starts it with `autocrop-auto=no`, so a Stream opens exactly as its source is
//! and the first frame keeps whatever bars the Stream carries; a client asks for
//! the script's own toggle (`autocrop/toggle_crop`) when it wants them found, and
//! asks again to restore the full frame (#119, ADR-0014). The script is
//! unmodified, and the Host detects nothing itself. mpv's script is
//! GPL-compatible with this crate's own licence, and the checked-in copy is used
//! as it came from upstream.

mod observing;
mod previewing;
mod telling;

use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use host_core::{
    bucket_of, Frame, Observation, Picture, PlaybackError, PlaybackState, Player, PreviewCache,
    Previewer, StreamUrl, Telling,
};
use libmpv2::events::Event;
use libmpv2::mpv_end_file_reason as EndFileReason;
use libmpv2::Mpv;

use crate::observing::{failure_words, observe, Memory, Properties, RawChapter, RawTrack};

/// The stem the vendored script is written under, and the one name mpv keys it
/// by: the file is `<stem>.lua`, its toggle binding is `<stem>/toggle_crop`, and
/// `script-opts` is keyed `<stem>-*` (#119).
pub(crate) const AUTOCROP_SCRIPT_STEM: &str = "autocrop";

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
/// into a directory named for the process id so two processes do not overwrite
/// each other's copy, and under [`AUTOCROP_SCRIPT_STEM`] so that the script's
/// name, its `script-opts` key and its toggle binding are one constant (#119). A
/// failure to write it is logged and returns nothing: a Player without the stock
/// autocrop still plays, and that is the only failure a person would accept here.
fn autocrop_script() -> Option<&'static str> {
    static ON_DISK: OnceLock<Option<String>> = OnceLock::new();

    ON_DISK
        .get_or_init(|| {
            let directory = std::env::temp_dir().join(format!(
                "streamingapp-{AUTOCROP_SCRIPT_STEM}-{}",
                std::process::id()
            ));
            let path = directory.join(format!("{AUTOCROP_SCRIPT_STEM}.lua"));
            let written =
                std::fs::create_dir_all(&directory).and_then(|()| std::fs::write(&path, AUTOCROP));
            match written {
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
    /// option, before mpv starts — with its automatic pass switched off, unless
    /// writing it failed, in which case playback goes on without it.
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
            // `vo-configured` is the video output's own fact: a resume waits
            // for it before the first frame can be on screen.
            configured: self
                .mpv
                .get_property::<bool>("vo-configured")
                .unwrap_or(false),
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
            // A string property carrying one JSON object: where the demuxer's
            // read has reached. `demuxer-cache-time` is not this — it is the
            // read's own end, not a span to draw.
            cache_state: self.mpv.get_property::<String>("demuxer-cache-state").ok(),
            // Held for bytes, whoever's pause it is not: mpv's own fact, which
            // is false whenever it cannot answer.
            paused_for_cache: self
                .mpv
                .get_property::<bool>(observing::PAUSED_FOR_CACHE)
                .unwrap_or(false),
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
                        hearing_impaired: self
                            .mpv
                            .get_property::<bool>(&format!("track-list/{index}/hearing-impaired"))
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

    fn open(&self, url: &StreamUrl, start: Option<f64>) -> Result<(), PlaybackError> {
        // Whatever the last open left behind is over: an ending already in the
        // queue is about the Stream being replaced, not the one being asked
        // for, and taking it for the new one would report a failure that was
        // not its own.
        let mut memory = self
            .memory
            .lock()
            .expect("nothing panics while holding the Player's memory");
        self.drain(&mut memory);

        // mpv's `pause` belongs to the player and not to the file: a Stream that
        // was stopped while the picture was held would be followed by one that
        // opens held too, and a client that asked to play would be shown a
        // Stream sitting at 0:00 offering Play. Opening a Stream means playing
        // it, whatever the last one was left doing — except a resume, which is
        // held until its picture is configured so the room does not start with
        // sound over a poster.
        let starting = start.is_some();
        self.tell(Telling::Pause(starting))?;

        // Where a resume begins, set before the file is loaded because that is
        // when mpv reads it: a seek sent afterwards would move a Stream that has
        // already started in the wrong place.
        let (option, value) = telling::start(start);
        self.mpv
            .set_property(option, value.as_str())
            .map_err(|error| PlaybackError::Command {
                detail: error.to_string(),
            })?;

        // An open that mpv will not even take is the one failure this call can
        // report: whether the *Stream* opens is found out later, in `observe`.
        let result = telling::opening(url)
            .into_iter()
            .try_for_each(|command| self.run(command))
            .map_err(|error| match error {
                PlaybackError::Command { detail } => PlaybackError::Open { detail },
                other => other,
            });
        if result.is_ok() {
            *memory = Memory::asking();
            if starting {
                memory.begin_start();
            }
        }
        result
    }

    fn tell(&self, telling: Telling) -> Result<(), PlaybackError> {
        for command in telling::commands(&telling) {
            self.run(command)?;
        }
        Ok(())
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

        // A resume is held paused until the picture is configured. The wait is
        // bounded: a Stream with no video at all must still play its sound.
        if memory.starting() {
            let ready =
                properties.configured && properties.width.is_some() && properties.height.is_some();
            if (ready || memory.start_timed_out()) && self.tell(Telling::Pause(false)).is_ok() {
                memory.start_ready();
            }
        }

        let mut observation = observe(&memory, &properties);
        if memory.starting() {
            observation.state = PlaybackState::Opening;
        }

        // Said once per Stream, when the picture first comes up: what mpv is
        // decoding with is what says whether hardware decode is engaged, and a
        // log is where a person finds that out (the walkthrough checks this
        // line). Nothing about the Stream appears beside it.
        //
        // "The picture is up" is mpv's own `vo-configured` — a fact about the
        // video output — rather than whether a pixel format happened to be
        // readable on this tick, which is a fact about the timing.
        let (current, format) = self.decoding();
        let decode = (
            current.as_deref().unwrap_or("no"),
            format.as_deref().unwrap_or("unknown"),
        );
        let drawing = self
            .mpv
            .get_property::<bool>("vo-configured")
            .unwrap_or(false);
        if memory.reported(&observation, drawing, decode) {
            tracing::info!(
                hwdec = decode.0,
                pixelformat = decode.1,
                "the picture is playing",
            );
        }

        observation
    }
}

/// The real Seek preview: a second libmpv, silent and hidden, that yields one
/// frame at a time.
///
/// It is not the Player: the moment a person points at is not where the Stream is
/// playing, so the picture on screen cannot answer without seeking away from
/// itself (ADR-0028). This one draws nowhere (`vo=null`), plays to nobody
/// (`ao=null`), selects no track, and leaves through
/// [`screenshot-to-file`](previewing::screenshot) — a JPEG in a temporary
/// directory, read and deleted.
///
/// ## What it costs, and how it is rationed
///
/// - **Arming is free.** The URL is kept, and no libmpv exists until the first
///   still is asked for. A Stream that is never hovered costs one `String`.
/// - **The connection is not.** A worker lets it go after
///   [`RELEASE_AFTER`] without a still, so a burst of hovering pays one
///   connection and a later burst another. The stills already taken stay in
///   memory.
/// - **The ceiling is not decided here.** The Host disarms the worker when the
///   first report says the Stream is too dear, or will not say what it costs;
///   what is left is one that may run.
///
/// ## Failure is silence
///
/// A Stream that will not open, a seek that never becomes ready, a provider that
/// refuses the second connection: each is one log line and an absent still. A
/// preview is decoration and may never interrupt a film, and a debrid provider's
/// policy is not something a client is told through the player (ADR-0028).
pub struct MpvPreviewer {
    inner: std::sync::Arc<PreviewInner>,
}

/// The previewer's two halves, and the reason they are two.
///
/// `armed` is what the Host has asked for — set by `arm` and `disarm`, which the
/// Host calls while it holds its change lock — and `worker` is the libmpv that
/// takes the stills, which a Question holds for as long as a capture takes. If
/// they shared one lock, a play that arrived during a capture would wait up to
/// the capture's own timeout while the Host's change lock was held around it: a
/// decoration stopping a film from starting (ADR-0028). So an arming is written
/// down first and adopted by the worker when it is free — immediately, when no
/// capture is in flight, and otherwise at the end of the one that is.
struct PreviewInner {
    armed: Mutex<Armed>,
    worker: Mutex<PreviewWorker>,
}

/// What the Host has armed: the Stream's URL, and a count that changes with
/// every arm and disarm so a worker that was busy capturing can tell that what
/// it holds is stale.
#[derive(Debug, Clone, Default)]
struct Armed {
    url: Option<StreamUrl>,
    generation: u64,
}

/// What the second instance is doing: the URL it adopted, whether that Stream is
/// loaded, the stills it has already answered, and when it was last asked for
/// one.
struct PreviewWorker {
    /// The arming this worker has adopted, so it can tell when a newer one
    /// arrived while it was capturing.
    generation: u64,
    mpv: Option<Mpv>,
    url: Option<StreamUrl>,
    /// Whether the URL has been opened into `mpv`. Every still after the first is
    /// a seek on that one load.
    loaded: bool,
    /// Whether the frame turned out to be HDR, and the chain installed for it.
    filters: &'static str,
    /// The stills already taken, keyed by bucket.
    cache: PreviewCache,
    /// How many stills were actually captured, which a test reads to prove a
    /// bucket was served from memory rather than from a seek.
    captures: usize,
    /// When the last still was asked for, for the idle release.
    last_used: Option<Instant>,
}

impl PreviewWorker {
    fn idle() -> Self {
        Self {
            generation: 0,
            mpv: None,
            url: None,
            loaded: false,
            filters: previewing::SDR_FILTERS,
            cache: PreviewCache::default(),
            captures: 0,
            last_used: None,
        }
    }

    /// Adopt what the Host has armed, where it is not what this worker holds
    /// already.
    ///
    /// A different Stream's stills are not this one's, and the connection the
    /// last one held is not this one's to keep: both go, and the URL is the one
    /// the Host named last. Doing this here rather than in `arm` is what keeps an
    /// arming from waiting on a capture the Host is not holding.
    fn reconcile(&mut self, armed: &Armed) {
        if armed.generation == self.generation {
            return;
        }
        self.release();
        self.cache.clear();
        self.url = armed.url.clone();
        self.generation = armed.generation;
    }

    /// Let the connection — and the frame, and the file — go, keeping the URL
    /// and the stills already taken. The next ask opens the Stream again.
    fn release(&mut self) {
        self.mpv = None;
        self.loaded = false;
        // A new instance is started with the SDR chain, which is what every
        // frame pays for and an HDR one replaces.
        self.filters = previewing::SDR_FILTERS;
    }

    /// Whether this worker has been left alone long enough to let its connection
    /// go, where it holds one.
    fn owes_release(&self, now: Instant) -> bool {
        if self.mpv.is_none() {
            return false;
        }
        let idle = self
            .last_used
            .map(|last| now.saturating_duration_since(last))
            .unwrap_or_default();
        previewing::release_after_idle(idle)
    }

    /// Take one still, or nothing at all.
    fn capture(&mut self, bucket: u64) -> Option<Frame> {
        let at = previewing::seek_target(bucket);
        let url = self.url.as_ref()?.as_str().to_owned();
        let path = previewing::still_path(&preview_directory(), bucket);
        let to_file = path.to_str()?.to_owned();

        // A failed capture is still a use of the connection: the worker is let
        // go of thirty seconds after the last *attempt*, not never because the
        // first one timed out.
        self.last_used = Some(Instant::now());

        if self.mpv.is_none() {
            match preview_instance() {
                Ok(mpv) => self.mpv = Some(mpv),
                Err(error) => {
                    tracing::warn!(
                        %error,
                        "the Seek preview could not start its own player"
                    );
                    return None;
                }
            }
        }
        let mpv = self.mpv.as_ref()?;

        // Whatever mpv said about the last ask is not about this one.
        while mpv.wait_event(0.0).is_some() {}

        if self.loaded {
            // The worker is held paused between stills so it stops reading the
            // Stream; a seek needs it running to produce the frame at the target.
            command(mpv, ("set", vec!["pause".to_owned(), "no".to_owned()]));
            let (name, arguments) = previewing::seek(at);
            if !command(mpv, (name, arguments)) {
                tracing::warn!(
                    at,
                    "the Seek preview could not move the worker to the moment asked for"
                );
                return None;
            }
        } else {
            let (name, arguments) = previewing::load(&url, at);
            if !command(mpv, (name, arguments)) {
                tracing::warn!(
                    at,
                    "the Seek preview could not open the Stream a second time"
                );
                return None;
            }
        }

        // A screenshot taken before the frames change returns the *previous*
        // frame, with `time-pos` already at the target: the event, never the
        // position, is what says a frame exists (ADR-0028).
        if !ready(mpv) {
            tracing::warn!(
                at,
                "the Seek preview found no frame at the moment asked for"
            );
            return None;
        }
        self.loaded = true;

        let wanted = frame_filters(mpv);
        if wanted != self.filters {
            // The filter graph applies to the next frame, so the chain is
            // installed and the same moment taken again. Only HDR pays for this.
            command(mpv, ("set", vec!["vf".to_owned(), wanted.to_owned()]));
            while mpv.wait_event(0.0).is_some() {}
            let (name, arguments) = previewing::seek(at);
            if !command(mpv, (name, arguments)) || !ready(mpv) {
                tracing::warn!(
                    at,
                    "the Seek preview could not take an HDR frame at the moment asked for"
                );
                return None;
            }
            self.filters = wanted;
        }

        let (name, arguments) = previewing::screenshot(&to_file);
        if !command(mpv, (name, arguments)) {
            tracing::warn!(
                at,
                "the Seek preview could not write the still it asked for"
            );
            return None;
        }

        // Nothing more is read from the Stream until the next still is asked
        // for. A worker that kept playing would spend a Stream's bitrate for a
        // picture nobody is looking at.
        command(mpv, ("set", vec!["pause".to_owned(), "yes".to_owned()]));

        let bytes = std::fs::read(&path).ok();
        let _ = std::fs::remove_file(&path);
        let frame = Frame::jpeg(&bytes?);
        self.cache.keep(bucket, frame.clone());
        self.captures += 1;
        self.last_used = Some(Instant::now());

        Some(frame)
    }
}

impl MpvPreviewer {
    /// Start the seam.
    ///
    /// Nothing mpv is started here: a Host that is never pointed at a timeline
    /// starts no second player at all. The thread this spawns only notices when
    /// the worker has been idle too long, and it ends when the previewer is
    /// dropped.
    pub fn start() -> Self {
        let inner = std::sync::Arc::new(PreviewInner {
            armed: Mutex::new(Armed::default()),
            worker: Mutex::new(PreviewWorker::idle()),
        });
        let reaper = std::sync::Arc::downgrade(&inner);
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_secs(1));
            let Some(inner) = reaper.upgrade() else {
                return;
            };
            let mut worker = inner
                .worker
                .lock()
                .expect("nothing panics while holding the preview worker");
            let armed = inner
                .armed
                .lock()
                .expect("nothing panics while holding the previewer's arming")
                .clone();
            worker.reconcile(&armed);
            if worker.owes_release(Instant::now()) {
                worker.release();
            }
        });

        Self { inner }
    }

    /// How many stills this worker has actually captured, for a test that
    /// proves a bucket already answered cost no seek. Nothing else reads it.
    pub fn captures(&self) -> usize {
        self.inner
            .worker
            .lock()
            .expect("nothing panics while holding the preview worker")
            .captures
    }

    /// Write an arming down, and adopt it now if no capture holds the worker.
    ///
    /// The `try_lock` is the whole point: a Stream opening must never wait for a
    /// still being taken for the Stream that is being replaced. When the worker
    /// is busy, the arming is adopted when the capture that holds it is done —
    /// `reconcile` runs before any capture and on every reaper tick.
    fn rearm(&self, url: Option<StreamUrl>) {
        let armed = {
            let mut armed = self
                .inner
                .armed
                .lock()
                .expect("nothing panics while holding the previewer's arming");
            armed.generation += 1;
            armed.url = url;
            armed.clone()
        };

        if let Ok(mut worker) = self.inner.worker.try_lock() {
            worker.reconcile(&armed);
        }
    }
}

impl Previewer for MpvPreviewer {
    fn arm(&self, url: &StreamUrl) {
        self.rearm(Some(url.clone()));
    }

    fn disarm(&self) {
        self.rearm(None);
    }

    fn preview(&self, at: f64) -> Option<Frame> {
        let mut worker = self
            .inner
            .worker
            .lock()
            .expect("nothing panics while holding the preview worker");
        let armed = self
            .inner
            .armed
            .lock()
            .expect("nothing panics while holding the previewer's arming")
            .clone();
        worker.reconcile(&armed);

        let bucket = bucket_of(at);
        if let Some(frame) = worker.cache.get(bucket) {
            worker.last_used = Some(Instant::now());
            return Some(frame);
        }

        worker.capture(bucket)
    }
}

/// Start the second, silent libmpv the preview worker drives.
///
/// The options are the pure list in [`previewing::options`]; nothing here knows
/// what a still is worth. Two libmpv instances coexist in one process, which is
/// what makes a still of a moment other than the one playing possible at all
/// (ADR-0028).
fn preview_instance() -> Result<Mpv, MpvError> {
    let options = previewing::options();
    Ok(Mpv::with_initializer(|init| {
        for (name, value) in options {
            init.set_option(name, value.as_str())?;
        }
        Ok(())
    })?)
}

/// Run one command on the preview worker, and answer whether mpv took it.
///
/// The command is already in mpv's own spelling — the pure half, in
/// [`previewing`] — so what is left here is only the call, and the answer is a
/// word rather than an error: every refusal on this path is silence.
fn command(mpv: &Mpv, (name, arguments): (&'static str, Vec<String>)) -> bool {
    let arguments: Vec<&str> = arguments.iter().map(String::as_str).collect();
    mpv.command(name, &arguments).is_ok()
}

/// Wait for the frame the last command asked for to exist.
///
/// `MPV_EVENT_PLAYBACK_RESTART` is the only thing that says one does: `time-pos`
/// is at the target before any frame is. A Stream that ends, an error, and three
/// seconds of nothing are all "there is no still" (ADR-0028).
fn ready(mpv: &Mpv) -> bool {
    let deadline = Instant::now() + Duration::from_secs_f64(previewing::READY_TIMEOUT_SECONDS);

    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return false;
        }
        match mpv.wait_event(remaining.as_secs_f64()) {
            Some(Ok(Event::PlaybackRestart)) => return true,
            Some(Ok(Event::EndFile(_))) | Some(Err(_)) | None => return false,
            Some(Ok(_)) => {}
        }
    }
}

/// The filter chain the frame at the worker's position is taken through.
///
/// The decision is the pure [`previewing::filters`]; this reads mpv's two
/// `video-params` properties and hands them on. A frame the container says
/// nothing about is SDR, which is left exactly as it came.
fn frame_filters(mpv: &Mpv) -> &'static str {
    let primaries = mpv.get_property::<String>("video-params/primaries").ok();
    let gamma = mpv.get_property::<String>("video-params/gamma").ok();

    previewing::filters(primaries.as_deref(), gamma.as_deref())
}

/// The process's own temporary directory, one per process, for the files a still
/// is written to and deleted from.
///
/// `std::env::temp_dir()` rather than `/tmp`: the Windows build has no `/tmp`,
/// and the still leaves mpv through a file because the safe crate cannot read
/// `screenshot-raw` (ADR-0028).
fn preview_directory() -> std::path::PathBuf {
    let directory =
        std::env::temp_dir().join(format!("streamingapp-preview-{}", std::process::id()));
    let _ = std::fs::create_dir_all(&directory);
    directory
}

/// The options mpv is started with, as its own names and values.
///
/// Pure, and tested as the list it is: what a Player is started with is a
/// decision, and a decision that lives in a test is one that cannot be changed
/// by accident. `gpu-next` because HDR passthrough needs it and the fallback
/// keeps a machine without it playing (ADR-0003); `hwdec=auto-safe` so that
/// hardware decode is engaged where the machine can and playback still works
/// where it cannot; `keep-open` so that a Stream at its end stays loaded, which
/// is what makes "ended" and a resume from it possible (#29). A placement in
/// the Host's own window also keeps the video output up, black, when no Stream
/// is playing, so a Stop never leaves a hole where the desktop shows (#250).
///
/// `scripts` is where mpv's stock autocrop goes, and it is an option only mpv
/// reads before it starts — like `wid` — so its path is resolved by the caller
/// and passed in rather than written by this pure half. `script-opts` turns the
/// script's automatic pass off, so the first frame is uncropped until a client
/// asks for its toggle (#119).
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
        // mpv stands down: the Host chooses the Track, and mpv's own fallbacks
        // must not fight it (ADR-0041). No unrelated default subtitle when
        // `slang` misses, no forced subtitle by mpv's rule, and no choosing by
        // the OS language when a list is empty: following the file is the file's
        // own default. `track-auto-selection` and `subs-with-matching-audio`
        // stay at `yes`, so the first guess still selects something before the
        // Host's first report and a matching soundtrack hides no subtitle.
        ("subs-fallback", "no".to_owned()),
        ("subs-fallback-forced", "no".to_owned()),
        ("subs-match-os-language", "no".to_owned()),
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
    // is not an option the client API knows. `script-opts` is the script's own
    // `auto=no`, under the name its file gives it: the script still answers its
    // toggle, it just does not crop on `file-loaded` any more (#119).
    if let Some(script) = script {
        options.push(("scripts", script.to_owned()));
        options.push(("script-opts", format!("{AUTOCROP_SCRIPT_STEM}-auto=no")));
    }

    match surface {
        // `wid`, before mpv is initialized: it is an option, and mpv reads it
        // once. This is the one thing the prototype's recipe carries over as a
        // constraint rather than a curiosity (docs/research/spike-windows-embedding.md).
        //
        // `force-window` keeps the video output — and the child window `wid`
        // named — alive with no video, drawing `background-color`; without it a
        // Stop destroys the child before the Host publishes `idle`, and the
        // Host's transparent window shows the desktop (#250). The shell paints
        // its ink over the kept window once `idle` arrives, so the black is
        // never seen at rest (docs/research/mpv-idle-window.md).
        Placement::InWindow { handle } => {
            options.push(("wid", handle.to_string()));
            options.push(("force-window", "yes".to_owned()));
            options.push(("background-color", "#000000".to_owned()));
        }
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
    fn mpv_stands_down_so_the_hosts_choice_is_not_fought() {
        for surface in [Placement::Headless, Placement::InWindow { handle: 1 }] {
            let options = options(surface, None);

            assert_eq!(option(&options, "subs-fallback"), Some("no"));
            assert_eq!(option(&options, "subs-fallback-forced"), Some("no"));
            assert_eq!(option(&options, "subs-match-os-language"), Some("no"));
            // Left at mpv's default `yes`, by not being set at all.
            assert_eq!(option(&options, "track-auto-selection"), None);
            assert_eq!(option(&options, "subs-with-matching-audio"), None);
        }
    }

    #[test]
    fn a_host_window_is_kept_up_and_black_while_idle() {
        // The Host paints its own ink before it tears a Stream down, but a Stop
        // from a Remote arrives here directly and mpv destroys its child window
        // before the Host can publish `idle`; the transparent window then shows
        // the desktop (#250). `force-window` keeps the video output — and the
        // child window `wid` named — alive with no video, drawing the background
        // colour, so there is never a hole for the page to race. A window of
        // mpv's own has no such hole: the page is not transparent over it.
        let host_window = options(Placement::InWindow { handle: 1234 }, None);

        assert_eq!(option(&host_window, "force-window"), Some("yes"));
        assert_eq!(
            option(&host_window, "background-color"),
            Some("#000000"),
            "the kept window is black, not whatever mpv last drew"
        );
        assert_eq!(
            option(&options(Placement::OwnWindow, None), "force-window"),
            None,
            "a window of mpv's own is not behind the Host's page"
        );
        assert_eq!(
            option(&options(Placement::Headless, None), "force-window"),
            None,
            "a headless Player draws nowhere"
        );
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
        // Player hands it the path it wrote the vendored script to. The script's
        // automatic pass is switched off in the same options, so a Stream opens
        // exactly as its source is and a client asks for the crop (#119).
        let with_script = options(
            Placement::Headless,
            Some("/tmp/streamingapp-autocrop-1/autocrop.lua"),
        );

        assert_eq!(
            option(&with_script, "scripts"),
            Some("/tmp/streamingapp-autocrop-1/autocrop.lua"),
            "mpv's own autocrop is loaded for every Player (ADR-0014)"
        );
        assert_eq!(
            option(&with_script, "script-opts"),
            Some("autocrop-auto=no"),
            "the script's own option is what keeps the first frame uncropped"
        );

        assert_eq!(
            option(&options(Placement::Headless, None), "scripts"),
            None,
            "a Player whose script could not be written starts without it"
        );
        assert_eq!(
            option(&options(Placement::Headless, None), "script-opts"),
            None,
            "and with no script there is no option to give it"
        );
    }

    #[test]
    fn the_written_script_is_named_autocrop_so_its_binding_is_a_constant() {
        let path = autocrop_script().expect("the vendored script is written to the temp directory");
        let path = std::path::Path::new(path);

        assert_eq!(
            path.file_stem().and_then(|stem| stem.to_str()),
            Some("autocrop"),
            "mpv names the binding after the script's own file: autocrop/toggle_crop"
        );
        let directory = path
            .parent()
            .and_then(|parent| parent.file_name())
            .and_then(|name| name.to_str())
            .expect("the script lives in its own directory");
        assert!(
            directory.starts_with("streamingapp-autocrop-"),
            "the directory carries the process id so two processes do not overwrite each other"
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
