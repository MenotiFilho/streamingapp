//! The Player: the Host's seam for playing a Stream, and what it says about it.
//!
//! Choosing a Stream ends in bytes moving, and the thing that moves them is not
//! the Host: [`Player`] is the seam, and mpv is its implementation (ADR-0013).
//! The Host decides *what* to play — a client's chosen Stream, judged before
//! anything hears of it — and owns *what every client is told*; the Player is
//! the limb that opens, pauses, seeks and stops, and reports where it is.
//!
//! The seam is per platform in exactly one respect, and it is not a decision
//! made here: where the picture is put. On Windows mpv draws into the Host's own
//! window; where the platform has no way to hand mpv a place to draw, mpv opens
//! its own window. That choice belongs to the shell that builds a Player, not to
//! the Host that asks one to play (#19 settles which Linux mechanism works).
//!
//! ## The Player is reported on, not trusted
//!
//! An open is asynchronous: [`Player::open`] agrees to *try*, and the Stream
//! either starts, ends, or fails some moment later. So the Host does not take
//! the Player's word from the call — it reads [`Player::observe`], folds what
//! came back into state pure and without I/O, and publishes a Snapshot when
//! anything moved. That is also where a Stream that fails to open becomes
//! visible: the failure arrives as an observation, and the client that pressed
//! play is told so beside the list it came from.
//!
//! ## A Stream URL never travels outward
//!
//! A Snapshot reaches every paired client, and a Stream URL is a URL a debrid
//! Addon put a credential in. So the URL a Player is given stays where it was
//! given — in the Host's own state, beside the Session — and what a Snapshot
//! carries is the Addon's own words about the candidate (ADR-0009's rule,
//! applied to Streams; `streams.rs` keeps the Addon's words verbatim, and this
//! module keeps them the only thing about a Stream that travels).

use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::addon::{AddonId, MAX_STRING_LEN};
use crate::preferences::{StreamBuffer, SubtitleColor, SubtitleLanguage, SubtitleScale};
use crate::request::VideoRef;
use crate::stream::{holdable, Playback, Stream};

/// A URL the Host will hand to a Player.
///
/// The one thing about a Stream that is never published: a direct URL from a
/// debrid Addon can carry the owner's session in it, and a Snapshot reaches
/// every paired client. Validated once, here, so that a Player is never handed
/// something that is not a URL this Host will open.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(transparent)]
pub struct StreamUrl(String);

impl StreamUrl {
    /// A URL to open, or why the Host will not open it.
    ///
    /// Only `http` and `https`: the Streams this Host plays are files served
    /// over the web, and a scheme nothing here would ever open is a promise
    /// this Host would not be keeping (ADR-0009).
    ///
    /// As long as a Stream's own words may be (`MAX_STRING_LEN`), not as long as
    /// a manifest URL: a Stream is listed with any URL the list holds, and a
    /// debrid URL carries the owner's configuration and runs past 2 KiB. A
    /// shorter bound here listed candidates the press then refused (#249).
    pub fn parse(raw: &str) -> Result<Self, InvalidStreamUrl> {
        let refused = || InvalidStreamUrl {
            url: raw.to_owned(),
        };

        if raw.is_empty() || raw.len() > MAX_STRING_LEN {
            return Err(refused());
        }
        if raw.chars().any(char::is_control) {
            return Err(refused());
        }
        match url::Url::parse(raw) {
            Ok(url) if matches!(url.scheme(), "http" | "https") && url.host().is_some() => {
                Ok(Self(url.to_string()))
            }
            _ => Err(refused()),
        }
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for StreamUrl {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// A URL that is not one this Host will open.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, thiserror::Error)]
#[error("{url:?} is not a Stream URL — a direct URL is an http(s) address of a file")]
pub struct InvalidStreamUrl {
    pub url: String,
}

/// What a client asked to play, judged: the URL the Player will be given, and
/// the Addon's own words about the candidate — which is all that travels out.
///
/// Built by [`Action::validate`](crate::Action::validate) and nothing else, so a
/// `ChosenStream` that exists is a Stream a Player can be handed. Deliberately
/// not `Serialize`: there is no shape of this that a Snapshot could carry, and
/// that is the point.
#[derive(Debug, Clone, PartialEq)]
pub struct ChosenStream {
    /// The URL the Player is given, and the one thing about a Stream no
    /// Snapshot carries.
    pub url: StreamUrl,
    /// The candidate as every client is told about it: the Addon's badge line,
    /// its description, the file's name — and never where the bytes are.
    pub now_playing: NowPlaying,
}

/// The Stream that is playing, in the Addon's own words, without its URL.
///
/// Story 37's "which Stream is playing": the Addon that answered, and what it
/// called the candidate. A Snapshot can carry every field of this, which is why
/// they are the only fields here (ADR-0009).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NowPlaying {
    /// The Video being watched, by the type its Title carries and the id its
    /// Addon indexes it by.
    pub video: VideoRef,
    /// The Addon whose answer the candidate came from.
    pub addon: AddonId,
    /// The Addon's own name for the candidate, verbatim — for AIOStreams, its
    /// badge line (`1080p`, `4k DV | HDR`).
    pub name: Option<String>,
    /// The Addon's longer line under it: the release, the size, the seeders.
    pub description: Option<String>,
    /// The file's own name, where the Addon knows it.
    pub filename: Option<String>,
    /// The release the Addon binge-groups a series' episodes by.
    pub binge_group: Option<String>,
}

impl ChosenStream {
    /// The candidate as the Host holds it: the URL to open and the words to
    /// publish, or why this Host will not play it.
    ///
    /// The words are the client's, and they are only words: a client that sends
    /// a name it never got from an Addon is lying about a badge line, and the
    /// Host has no record to check it against — the list a client chooses from
    /// is that client's own (ADR-0005). What is judged is the part that
    /// matters: *where the bytes are*. An `infoHash` is a candidate this Host
    /// has no bridge to fetch (#12) and one it will not pretend to play, and a
    /// word too long to hold is dropped the way a Stream read from an Addon
    /// drops one.
    pub fn parse(video: VideoRef, addon: AddonId, stream: &Stream) -> Result<Self, Unplayable> {
        let url = match &stream.playback {
            Playback::Direct { url } => StreamUrl::parse(url).map_err(Unplayable::from)?,
            Playback::InfoHash { .. } => {
                return Err(Unplayable {
                    detail: "that Stream is an infoHash: a torrent, which this Host cannot fetch \
                             yet — the bridge that would is #12"
                        .to_owned(),
                })
            }
        };

        Ok(Self {
            url,
            now_playing: NowPlaying {
                video,
                addon,
                name: held(stream.name.as_deref()),
                description: held(stream.description.as_deref()),
                filename: held(stream.filename.as_deref()),
                binge_group: held(stream.binge_group.as_deref()),
            },
        })
    }
}

/// A word of the candidate's, if it is one the Host will hold and publish.
fn held(word: Option<&str>) -> Option<String> {
    word.filter(|word| holdable(word)).map(str::to_owned)
}

/// A Stream the Host has no way to play.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, thiserror::Error)]
#[error("{detail}")]
pub struct Unplayable {
    pub detail: String,
}

impl From<InvalidStreamUrl> for Unplayable {
    /// A URL that is not one this Host opens is a candidate it cannot play —
    /// the same refusal, in the words a client reads.
    fn from(error: InvalidStreamUrl) -> Self {
        Self {
            detail: error.to_string(),
        }
    }
}

/// Where the Player's picture is drawn: the one thing about playback that is a
/// fact about the machine rather than about the Stream, and the one a client
/// sharing the Host's window has to act on.
///
/// mpv owns the picture and its swapchain, and the Host never composites a
/// frame (ADR-0003), so where that picture *is* decides what a client's own
/// interface may draw over: a picture inside the same window as the interface
/// leaves a hole for it, and a picture in a window of its own is something the
/// interface can only say the whereabouts of.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Picture {
    /// Inside the same window the Host's own interface is drawn in — mpv was
    /// given the window's handle as its `wid`. The interface leaves the
    /// picture's rectangle unpainted and the video shows through the hole.
    InWindow,
    /// In a window of the Player's own, which the Host's interface can neither
    /// draw into nor over: the interface says where the picture is instead.
    /// Where a platform has no `wid` at all — Wayland and macOS — and on X11
    /// until #19 settles what works there.
    OwnWindow,
    /// Nowhere: no video output is open at all.
    Nowhere,
}

/// The Player: the Host's limb for playing a Stream, and its eyes on what is
/// playing.
///
/// One implementation is mpv, linked in-process, with the picture put wherever
/// this platform can put it (ADR-0013); tests drive [`FixturePlayer`] instead,
/// which is what makes the Host's own rules — what a Snapshot says while an open
/// is in flight, what a failure does to the list — testable without a player.
pub trait Player: Send + Sync + 'static {
    /// Where this Player puts its picture, as it was set up.
    ///
    /// A fact about the environment, like where a credential is held and not
    /// like a preference: it is settled when the Player is started, and no
    /// Action changes it.
    fn picture(&self) -> Picture;

    /// Open a Stream, replacing whatever was playing.
    ///
    /// Agreeing is not playing: a URL that cannot be reached is found out
    /// later, and arrives through [`Player::observe`] as a failure.
    ///
    /// `start` is where the open begins, in seconds from the Stream's start —
    /// the resume point of a Stream being picked up again (#29), or `None` for
    /// one that begins at its beginning. It is part of opening rather than a
    /// [`Telling`] because it is read as the file loads: a control sent
    /// afterwards would move a Stream that has already started in the wrong
    /// place.
    fn open(&self, url: &StreamUrl, start: Option<f64>) -> Result<(), PlaybackError>;

    /// Do one thing the Host asked of the Player, in the Host's own terms.
    ///
    /// One method rather than one per mpv property: a [`Telling`] is what the
    /// Host *means*, and `host-mpv` is the only thing that spells it (ADR-0013).
    /// A control the platform cannot honour is a refusal — and by the time one
    /// arrives the Host's own record has already moved, because the Host's
    /// record moves at the moment of the Action and the Player's next report is
    /// what corrects it.
    fn tell(&self, telling: Telling) -> Result<(), PlaybackError>;

    /// Let the Stream go: the Player is left with nothing open.
    fn stop(&self) -> Result<(), PlaybackError>;

    /// What the Player is doing at this moment.
    ///
    /// Must not block: the Host asks between Actions, from whatever thread
    /// holds it, and a Player that waited on playback here would stall the
    /// Action surface.
    fn observe(&self) -> Observation;
}

/// Where a seek goes: to a second of the Stream, or by some seconds from where
/// playback is.
///
/// The protocol's own two seek modes, because they are two different things a
/// person means: "go to 1:20:00" and "skip back ten seconds".
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SeekTarget {
    /// To this many seconds from the Stream's start.
    To { seconds: f64 },
    /// By this many seconds from where playback is, forward or back.
    By { seconds: f64 },
}

impl SeekTarget {
    /// The same target, or why the Host will not seek to it: a seek is a finite
    /// number of seconds, and a `NaN` or an infinity is not a place or a
    /// distance. The number travels in the refusal as its own words, because a
    /// `NaN` has no wire form to carry.
    pub fn checked(self) -> Result<Self, InvalidSeekTarget> {
        let seconds = match self {
            SeekTarget::To { seconds } | SeekTarget::By { seconds } => seconds,
        };

        if seconds.is_finite() {
            Ok(self)
        } else {
            Err(InvalidSeekTarget {
                seconds: seconds.to_string(),
            })
        }
    }

    /// Where the seek lands, given where playback is and how long the Stream is.
    ///
    /// The Host's own record of the position moves at the moment of the Action
    /// and the Player's next report corrects it; this is the arithmetic that
    /// moves it, clamped the way every player clamps — never before the start,
    /// never past a duration the Stream has stated.
    pub fn landing(self, position: f64, duration: Option<f64>) -> f64 {
        let wanted = match self {
            SeekTarget::To { seconds } => seconds,
            SeekTarget::By { seconds } => position + seconds,
        };
        let end = duration.unwrap_or(f64::INFINITY);

        wanted.clamp(0.0, end)
    }
}

/// A track mpv numbers, as the Host refers to it.
///
/// A positive integer by construction: mpv numbers its tracks from one, and a
/// zero or a negative id is not a track anything can select. The only way to
/// hold one is [`TrackId::new`], so a `Telling` that carries a `TrackId` is one
/// no Player could be handed something it does not understand.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct TrackId(pub i64);

impl TrackId {
    /// The track with this id, or nothing: mpv's ids are positive.
    pub fn new(id: i64) -> Option<Self> {
        (id > 0).then_some(Self(id))
    }
}

impl std::fmt::Display for TrackId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// The two kinds of track the Host offers a control for.
///
/// Video is deliberately not here: the picture's track is mpv's own business,
/// and no client asks which one carries it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TrackKind {
    Audio,
    Subtitle,
}

/// One track the Stream carries, as mpv lists it.
///
/// The Host's own record of what a Stream offers, so a client can name one to
/// select and see which is on — and so the Host can refuse an id that is not
/// there before a Player hears of it. A word the container gave is kept
/// verbatim, the way an Addon's own words are — and bounded the same way, with
/// [`Track::bounded`], because every one of them travels to every paired client.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Track {
    /// mpv's own number for the track, which is what a selection names.
    pub id: TrackId,
    /// Whether this carries the sound or the subtitles.
    pub kind: TrackKind,
    /// The language the container says, where it says one.
    pub language: Option<String>,
    /// The track's own title, where it has one.
    pub title: Option<String>,
    /// The codec the container names (`aac`, `subrip`).
    pub codec: Option<String>,
    /// Whether the track came in the file (`true`) rather than being added to
    /// the Stream afterwards (`false`).
    pub embedded: bool,
    /// Whether this is the track playing now.
    pub selected: bool,
    /// Whether the Stream marks this the default of its kind.
    pub default: bool,
    /// Whether the subtitles are forced: the ones a container says to show.
    pub forced: bool,
}

impl Track {
    /// The same track, with every word the container gave kept only where it is
    /// one a Snapshot will hold.
    ///
    /// The Player is the only thing that produces a `Track`, and its words come
    /// from whatever the Stream's own metadata says: a title megabytes long is
    /// a Stream's word, and one that would travel to every paired client. A
    /// word too long to hold becomes absence, the way it does for an Addon.
    pub fn bounded(mut self) -> Self {
        self.language = held(self.language.as_deref());
        self.title = held(self.title.as_deref());
        self.codec = held(self.codec.as_deref());
        self
    }
}

/// One chapter marker, as mpv lists it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Chapter {
    /// The chapter's position in the Stream's own list, from zero.
    pub index: usize,
    /// The chapter's name, where the container gives one.
    pub title: Option<String>,
    /// Where the chapter starts, in seconds from the Stream's start.
    pub time: f64,
}

/// How much of the Stream the Player has read, in the Stream's own timeline.
///
/// The span a timeline draws behind its progress bar: where the read begins and
/// how far it has reached. It is not the position — a paused Stream keeps
/// reading ahead, so the span grows while the position holds — and a seek into
/// a part that was never read leaves a gap between what has been played and
/// this span, which is the point of publishing it rather than a count of bytes
/// read from the start.
///
/// Absent where the Player has no answer: nothing open, or a span it cannot
/// make from a read of nothing. `None` is not "nothing is buffered".
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Buffered {
    /// Where the read begins, in seconds from the Stream's start.
    pub start: f64,
    /// Where it has reached, in seconds from the Stream's start.
    pub end: f64,
}

impl Buffered {
    /// Whether two readings describe the same span: no end moved by a second.
    /// A paused Stream reads a little further with every tick, and a reading
    /// that moved less than that is not news a client could see.
    fn same_reading(self, other: Self) -> bool {
        (self.start - other.start).abs() < 1.0 && (self.end - other.end).abs() < 1.0
    }
}

/// How large the picture is, in pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VideoSize {
    pub width: u32,
    pub height: u32,
}

/// The part of the picture left after cropping, in the source's own pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CropRectangle {
    pub width: u32,
    pub height: u32,
    /// How far the kept rectangle starts from the left of the source.
    pub x: u32,
    /// How far it starts from the top.
    pub y: u32,
}

/// What to do about the black bars around a picture.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum Crop {
    /// Leave the whole picture as it is.
    Off,
    /// Keep only this rectangle of it.
    Rectangle {
        width: u32,
        height: u32,
        x: u32,
        y: u32,
    },
}

/// What shape the picture is drawn at.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum Aspect {
    /// The shape the Stream itself is — what "no override" means.
    Source,
    /// A ratio the picture is stretched to.
    Ratio { value: f64 },
}

/// What mpv says about how a Stream is playing, where it says anything.
///
/// The moving numbers a person debugging playback wants, and nothing about the
/// Stream itself: `hardware_decode` is a word like `no` or `d3d11va`, kept
/// verbatim and bounded like every other word a Snapshot carries.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Statistics {
    /// Bits per second mpv reports for the video, where a picture is being
    /// decoded at all.
    pub bitrate: Option<u64>,
    /// Frames mpv has dropped, where it counts them.
    pub dropped_frames: Option<u64>,
    /// What is decoding the picture: `"no"` for software, a hardware API's name
    /// otherwise.
    pub hardware_decode: Option<String>,
}

impl Statistics {
    /// The same report, with the words the Player gave kept only where they are
    /// ones a Snapshot will hold.
    pub fn bounded(mut self) -> Self {
        self.hardware_decode = held(self.hardware_decode.as_deref());
        self
    }
}

/// Where to move in the chapter list.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum ChapterStep {
    /// The chapter after the one playing.
    Next,
    /// The chapter before it.
    Previous,
    /// The chapter at this position in the Stream's list.
    At { index: usize },
}

/// One thing the Host asks of its Player.
///
/// The whole vocabulary above the seam: a control is a telling, and the Player
/// is what spells it (ADR-0013). Opening a Stream and letting one go are
/// methods of their own, because they are not controls a client names; anything
/// a client controls while something plays is here.
#[derive(Debug, Clone, PartialEq)]
pub enum Telling {
    /// Hold the picture where it is, or let it run.
    Pause(bool),
    /// Move within the Stream.
    Seek(SeekTarget),
    /// Play this audio track.
    AudioTrack(TrackId),
    /// Show subtitles from this track, or none at all.
    SubtitleTrack(Option<TrackId>),
    /// Shift the subtitles by this many seconds, forward or back.
    SubtitleDelay { seconds: f64 },
    /// Play at this rate.
    Speed { rate: f64 },
    /// Play at this level.
    Volume { level: f64 },
    /// Mute or unmute.
    Muted(bool),
    /// Move to another chapter.
    Chapter(ChapterStep),
    /// Crop the picture, or stop cropping it.
    Crop(Crop),
    /// Ask the Player's own autocrop script for its toggle: detect the picture's
    /// black bars and crop to them, or restore the full frame where a crop is
    /// already set (#119). The rectangle is the script's to find, so this tells
    /// the Player nothing about it.
    Autocrop,
    /// Override the picture's shape.
    Aspect(Aspect),
    /// The language the Player prefers when it selects a subtitle track for the
    /// owner: mpv's `slang`. `None` clears it.
    SubtitleLanguage(Option<SubtitleLanguage>),
    /// The colour the Player draws subtitles in where a track leaves the colour
    /// open. A track that styles its own text keeps that styling (ADR-0024).
    SubtitleColor(SubtitleColor),
    /// How large the Player draws subtitles, relative to its own size. Applies
    /// to styled and unstyled subtitles alike (ADR-0024).
    SubtitleScale(SubtitleScale),
    /// How much of the Stream the Player keeps read ahead, and the memory that
    /// read-ahead may take. Told at startup and with every change of the
    /// preference; the Player decides how its own read-ahead spells the pair
    /// (ADR-0026).
    StreamBuffer(StreamBuffer),
    /// Load an external subtitle (the Addon `subtitles` fallback, S4).
    AddSubtitle {
        url: StreamUrl,
        title: Option<String>,
        language: Option<String>,
    },
}

/// A speed that is not one this Host will set: a finite number from a twentieth
/// to a hundred.
#[derive(Debug, Clone, PartialEq, Serialize, thiserror::Error)]
#[error("{rate} is not a playback speed — a speed is a number from 0.05 to 100")]
pub struct InvalidSpeed {
    /// The value offered, as a refusal can carry it: `NaN` has no JSON form.
    pub rate: String,
}

/// A volume that is not one this Host will set: a finite number from silence to
/// a tenth over full scale, which is where mpv's own `volume-max` ends.
#[derive(Debug, Clone, PartialEq, Serialize, thiserror::Error)]
#[error("{level} is not a volume — a volume is a number from 0 to 130")]
pub struct InvalidVolume {
    /// The value offered, as a refusal can carry it.
    pub level: String,
}

/// A subtitle delay that is not one this Host will set: a finite number of
/// seconds within an hour either way.
#[derive(Debug, Clone, PartialEq, Serialize, thiserror::Error)]
#[error("{seconds} is not a subtitle delay — a delay is at most an hour either way")]
pub struct InvalidSubtitleDelay {
    /// The value offered, as a refusal can carry it.
    pub seconds: String,
}

/// A picture shape that is not one this Host will draw: a finite ratio greater
/// than zero and at most a hundred.
#[derive(Debug, Clone, PartialEq, Serialize, thiserror::Error)]
#[error("{value} is not a picture shape — an aspect ratio is greater than 0 and at most 100")]
pub struct InvalidAspect {
    /// The value offered, as a refusal can carry it.
    pub value: String,
}

/// A crop that would keep no picture at all.
#[derive(Debug, Clone, PartialEq, Serialize, thiserror::Error)]
#[error("{crop} is not a crop — a crop needs a width and a height, both greater than zero")]
pub struct InvalidCrop {
    /// The rectangle offered, as mpv would spell it.
    pub crop: String,
}

/// A speed, or why this Host will not set it.
pub(crate) fn checked_speed(rate: f64) -> Result<f64, InvalidSpeed> {
    if rate.is_finite() && (0.05..=100.0).contains(&rate) {
        Ok(rate)
    } else {
        Err(InvalidSpeed {
            rate: rate.to_string(),
        })
    }
}

/// A volume, or why this Host will not set it.
pub(crate) fn checked_volume(level: f64) -> Result<f64, InvalidVolume> {
    if level.is_finite() && (0.0..=130.0).contains(&level) {
        Ok(level)
    } else {
        Err(InvalidVolume {
            level: level.to_string(),
        })
    }
}

/// A subtitle delay, or why this Host will not set it.
pub(crate) fn checked_subtitle_delay(seconds: f64) -> Result<f64, InvalidSubtitleDelay> {
    if seconds.is_finite() && seconds.abs() <= 3600.0 {
        Ok(seconds)
    } else {
        Err(InvalidSubtitleDelay {
            seconds: seconds.to_string(),
        })
    }
}

/// A crop, or why this Host will not set it: a rectangle that keeps nothing is
/// not a picture.
pub(crate) fn checked_crop(crop: &Crop) -> Result<(), InvalidCrop> {
    match crop {
        Crop::Off => Ok(()),
        Crop::Rectangle { width, height, .. } if *width > 0 && *height > 0 => Ok(()),
        Crop::Rectangle {
            width,
            height,
            x,
            y,
        } => Err(InvalidCrop {
            crop: format!("{width}x{height}+{x}+{y}"),
        }),
    }
}

/// An aspect, or why this Host will not draw it.
pub(crate) fn checked_aspect(aspect: &Aspect) -> Result<(), InvalidAspect> {
    match aspect {
        Aspect::Source => Ok(()),
        Aspect::Ratio { value } if value.is_finite() && *value > 0.0 && *value <= 100.0 => Ok(()),
        Aspect::Ratio { value } => Err(InvalidAspect {
            value: value.to_string(),
        }),
    }
}

/// The control an Action asked for, where the Action is one: what a refusal
/// names when there is nothing playing to control.
///
/// A type rather than a word, because the word reaches a client: a refusal that
/// carried a `String` would let a typo become a message somebody reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Control {
    Pause,
    Seek,
    Stop,
    AudioTrack,
    SubtitleTrack,
    SubtitleDelay,
    Speed,
    Volume,
    Mute,
    Chapter,
    Crop,
    /// The stock autocrop script's own toggle (#119).
    Autocrop,
    Aspect,
    /// S4: skipping to the Video after this one in its Title.
    NextEpisode,
    /// S4: skipping back to the Video before this one in its Title, the mirror
    /// of `NextEpisode` (ADR-0021).
    PreviousEpisode,
}

impl std::fmt::Display for Control {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Control::Pause => "pause",
            Control::Seek => "seek",
            Control::Stop => "stop",
            Control::AudioTrack => "audio track",
            Control::SubtitleTrack => "subtitle track",
            Control::SubtitleDelay => "subtitle delay",
            Control::Speed => "speed",
            Control::Volume => "volume",
            Control::Mute => "mute",
            Control::Chapter => "chapter",
            Control::Crop => "crop",
            Control::Autocrop => "autocrop",
            Control::Aspect => "aspect",
            Control::NextEpisode => "next episode",
            Control::PreviousEpisode => "previous episode",
        })
    }
}

/// A seek that is not a number of seconds this Host will seek to.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, thiserror::Error)]
#[error("{seconds} is not a number of seconds to seek by")]
pub struct InvalidSeekTarget {
    /// The value offered, as the words a refusal can carry: a `NaN` has no
    /// place in a Snapshot or in any other JSON.
    pub seconds: String,
}

/// What the Player is doing, as the Host's own vocabulary has it — and as every
/// client is told it.
///
/// A Stream that fails to open is not a state of its own: the Player is left
/// doing nothing, so the state is `idle` and the failure is published beside it
/// (see [`PlaybackSnapshot`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlaybackState {
    /// Nothing is playing: nothing has been played, or the last Stream was
    /// stopped.
    Idle,
    /// A Stream is open and the first frame has not arrived.
    Opening,
    Playing,
    Paused,
    /// The Stream reached its end. The Host knows which one it was, which is
    /// what a later ticket resumes from (#29).
    Ended,
}

/// What the Player says about itself at one moment.
///
/// The whole of what the Host reads to know where playback is: what state the
/// Player is in, how far it has come, how long the Stream is, and the words it
/// has for an open that failed. Nothing here is a decision; the Host's own
/// [`crate::Snapshot`] is built from it.
#[derive(Debug, Clone, PartialEq)]
pub struct Observation {
    pub state: PlaybackState,
    /// Where playback is, in seconds from the Stream's start. Absent while a
    /// Stream is opening, and while the Player has nothing open.
    pub position: Option<f64>,
    /// How long the Stream is, in seconds, where the Stream says — a live
    /// Stream does not.
    pub duration: Option<f64>,
    /// The span of the Stream the Player has read, where it can say. `None` is
    /// a Player with no answer, not a Stream with nothing read.
    pub buffered: Option<Buffered>,
    /// Why an open failed, in the Player's own words, set once and until the
    /// next open. The Host shows it to the client that pressed play.
    pub failure: Option<String>,
    /// The Stream's tracks — audio and subtitles — in the order the Player
    /// reported them, or `None` while the Player has not said.
    ///
    /// `None` is not "no tracks": it is a Player that could not say, and the
    /// difference is what keeps the Addon subtitle fallback from firing on a
    /// read that failed (ADR-0014). An empty list, by contrast, is a Stream
    /// whose tracks the Player did list, and which carried no subtitle at all.
    pub tracks: Option<Vec<Track>>,
    /// The Stream's chapters, in the order the container gives them.
    pub chapters: Vec<Chapter>,
    /// Which chapter is playing, by its position in `chapters`.
    pub chapter: Option<usize>,
    /// The rate playback runs at.
    pub speed: Option<f64>,
    /// The level playback runs at.
    pub volume: Option<f64>,
    /// Whether the sound is held.
    pub muted: Option<bool>,
    /// How far the subtitles are shifted.
    pub subtitle_delay: Option<f64>,
    /// The rectangle kept after cropping, or `None` while uncropped.
    pub crop: Option<CropRectangle>,
    /// The shape being drawn at, or `None` until something is loaded.
    pub aspect: Option<Aspect>,
    /// How large the picture is.
    pub resolution: Option<VideoSize>,
    /// What the Player says about how the Stream is playing.
    pub statistics: Option<Statistics>,
}

impl Observation {
    /// A Player doing nothing.
    pub fn idle() -> Self {
        Self {
            state: PlaybackState::Idle,
            position: None,
            duration: None,
            buffered: None,
            failure: None,
            tracks: None,
            chapters: Vec::new(),
            chapter: None,
            speed: None,
            volume: None,
            muted: None,
            subtitle_delay: None,
            crop: None,
            aspect: None,
            resolution: None,
            statistics: None,
        }
    }

    /// A Player playing a Stream of this length, at this position.
    pub fn playing(position: f64, duration: f64) -> Self {
        Self {
            state: PlaybackState::Playing,
            position: Some(position),
            duration: Some(duration),
            ..Self::idle()
        }
    }
}

impl Default for Observation {
    fn default() -> Self {
        Self::idle()
    }
}

/// Why the Player did not do what the Host asked of it.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum PlaybackError {
    #[error("the Player could not open that Stream: {detail}")]
    Open { detail: String },
    #[error("the Player could not do that: {detail}")]
    Command { detail: String },
}

/// What the Host is playing, and what it was last told about it.
///
/// The Host's own record, kept beside the rest of its state and never in the
/// store: playback does not survive a restart, and the Watch progress that does
/// is #29's business. `playing` is `Some` from the moment a client chooses a
/// Stream until a stop says there is none — including through a failure, where
/// it is what tells the client *which* candidate did not open — and the words
/// that travel are [`Self::snapshot`]'s.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct PlaybackSession {
    /// The Stream the Player is on, or was last on.
    playing: Option<ChosenStream>,
    state: PlaybackState,
    position: Option<f64>,
    duration: Option<f64>,
    /// The span of the Stream the Player has read, as the Host's record holds
    /// it. The Player's report corrects it, with a span that moved by less than
    /// a second at either end counted as the same reading.
    buffered: Option<Buffered>,
    /// Why the last open failed, kept until the next play or stop.
    failure: Option<String>,
    /// The Stream's tracks, as the Player last reported them: the Host's own
    /// record of what a selection may name before a Player hears of it.
    tracks: Vec<Track>,
    /// The Stream's chapters, and which one is playing.
    chapters: Vec<Chapter>,
    chapter: Option<usize>,
    /// The controls' own values, as the Host last knew or last set them. Each
    /// moves at the moment of the Action and is corrected by the Player's next
    /// report, the way the position is.
    speed: Option<f64>,
    volume: Option<f64>,
    muted: Option<bool>,
    subtitle_delay: Option<f64>,
    crop: Option<CropRectangle>,
    aspect: Option<Aspect>,
    resolution: Option<VideoSize>,
    statistics: Option<Statistics>,
    /// Whether the Host has already asked the Addons for subtitles for the
    /// Stream playing now (ADR-0014). The Player has never heard of it, so a
    /// report that rebuilds the session carries it forward rather than losing
    /// it; a new Stream starts a fresh record.
    subtitles_attempted: bool,
}

impl PlaybackSession {
    /// Nothing has been played.
    pub(crate) fn idle() -> Self {
        Self {
            playing: None,
            state: PlaybackState::Idle,
            position: None,
            duration: None,
            buffered: None,
            failure: None,
            tracks: Vec::new(),
            chapters: Vec::new(),
            chapter: None,
            speed: None,
            volume: None,
            muted: None,
            subtitle_delay: None,
            crop: None,
            aspect: None,
            resolution: None,
            statistics: None,
            subtitles_attempted: false,
        }
    }

    /// A Stream was chosen and the Player agreed to try: the open is in flight.
    ///
    /// Nothing is known about the new Stream yet — not a track, not a chapter,
    /// not a speed — so every control's record starts empty and the Player's
    /// first full report is what fills it in.
    pub(crate) fn opening(chosen: ChosenStream) -> Self {
        Self {
            playing: Some(chosen),
            state: PlaybackState::Opening,
            ..Self::idle()
        }
    }

    /// The state every client is told: what is playing, where it is, and how the
    /// last open went. `picture` is the Player's own answer to where it draws,
    /// and is not the session's to know.
    pub(crate) fn snapshot(&self, picture: Picture) -> PlaybackSnapshot {
        PlaybackSnapshot {
            state: self.state,
            picture,
            failure: self.failure.clone(),
            now_playing: self
                .playing
                .as_ref()
                .map(|chosen| chosen.now_playing.clone()),
            // The Host's own reading of the Video's id — no Addon is asked, and
            // whether a neighbour exists is the press's business, not the
            // field's (ADR-0021).
            episode: self
                .playing
                .as_ref()
                .and_then(|chosen| crate::meta::episode_of(&chosen.now_playing.video.id))
                .map(|(_, season, episode)| Episode { season, episode }),
            position: self.position,
            duration: self.duration,
            buffered: self.buffered,
            tracks: self.tracks.clone(),
            chapters: self.chapters.clone(),
            chapter: self.chapter,
            speed: self.speed,
            volume: self.volume,
            muted: self.muted,
            subtitle_delay: self.subtitle_delay,
            crop: self.crop,
            aspect: self.aspect,
            resolution: self.resolution,
            statistics: self.statistics.clone(),
        }
    }

    /// Whether the Host is on a Stream at all — playing, opening, paused, ended
    /// or failed. A stop is allowed for all of those; a control is not.
    pub(crate) fn has_stream(&self) -> bool {
        self.playing.is_some()
    }

    /// Whether the Player is on something it can be told to control: a Stream
    /// that has started, and not one that is over.
    pub(crate) fn is_live(&self) -> bool {
        self.playing.is_some()
            && matches!(
                self.state,
                PlaybackState::Opening | PlaybackState::Playing | PlaybackState::Paused
            )
    }

    /// Whether the Host is on a Stream that reached its end. No control moves a
    /// finished Stream, but its Video is still the position an episode step
    /// reads from: the after-end affordance is exactly that step (#68).
    pub(crate) fn has_ended(&self) -> bool {
        self.playing.is_some() && self.state == PlaybackState::Ended
    }

    /// The chapters the Stream offers, as the Player last reported them.
    pub(crate) fn chapters(&self) -> &[Chapter] {
        &self.chapters
    }

    /// Whether the Stream carries this track of this kind, as the Player last
    /// reported it — what a selection names, and what an id that names no track
    /// is refused against. The judgement lives here, beside the list it reads
    /// and the selection it guards, rather than in the Host that asks.
    pub(crate) fn knows_track(&self, kind: TrackKind, id: TrackId) -> bool {
        self.tracks
            .iter()
            .any(|track| track.kind == kind && track.id == id)
    }

    /// The Stream the Host is on, as it was chosen — the Video and the Addon's
    /// own words about the candidate. What the Host's own rules read when they
    /// need to know *what* is playing rather than *where* (the subtitle
    /// fallback of ADR-0014, and next episode).
    pub(crate) fn chosen(&self) -> Option<&ChosenStream> {
        self.playing.as_ref()
    }

    /// Where playback is, as the Host's own record has it — the Player's last
    /// report, or where a control just moved it. What a Watch progress write
    /// records.
    pub(crate) fn position(&self) -> Option<f64> {
        self.position
    }

    /// How long the Stream is, as the Player last said.
    pub(crate) fn duration(&self) -> Option<f64> {
        self.duration
    }

    /// Whether the Host has already asked the Addons for subtitles for the
    /// Stream playing now.
    pub(crate) fn subtitles_attempted(&self) -> bool {
        self.subtitles_attempted
    }

    /// Record that the Addon subtitles fallback was attempted, so it is not
    /// attempted again for the Stream playing now.
    ///
    /// Not published: this is the Host's own note to itself, and the Player's
    /// next report — carrying the tracks the fallback added — is what a
    /// Snapshot carries.
    pub(crate) fn record_subtitles_attempt(&mut self) {
        self.subtitles_attempted = true;
    }

    /// Hold the picture where it is, or let it run — the record moving at the
    /// moment of the Action, with the Player's next report correcting it.
    pub(crate) fn set_paused(&mut self, paused: bool) {
        self.state = if paused {
            PlaybackState::Paused
        } else {
            PlaybackState::Playing
        };
    }

    /// Move within the Stream, as far as the Host knows how far the Stream goes.
    pub(crate) fn seek(&mut self, target: SeekTarget) {
        let Some(position) = self.position else {
            // Where playback is is not known yet — an open still in flight.
            // The Player goes there all the same; the position arrives with
            // its next report.
            return;
        };

        self.position = Some(target.landing(position, self.duration));
    }

    /// Which track of this kind is on, as the Host's own record has it: the one
    /// named, or none of them where none was named.
    pub(crate) fn select(&mut self, kind: TrackKind, id: Option<TrackId>) {
        for track in self.tracks.iter_mut().filter(|track| track.kind == kind) {
            track.selected = Some(track.id) == id;
        }
    }

    /// The rate the Host's own record says playback runs at.
    pub(crate) fn set_speed(&mut self, rate: f64) {
        self.speed = Some(rate);
    }

    /// The level the Host's own record says playback runs at.
    pub(crate) fn set_volume(&mut self, level: f64) {
        self.volume = Some(level);
    }

    /// Whether the Host's own record says the sound is held.
    pub(crate) fn set_muted(&mut self, muted: bool) {
        self.muted = Some(muted);
    }

    /// How far the Host's own record says the subtitles are shifted.
    pub(crate) fn set_subtitle_delay(&mut self, seconds: f64) {
        self.subtitle_delay = Some(seconds);
    }

    /// Move the Host's own record of which chapter is playing, clamped to the
    /// list the Player last reported — the same clamp mpv's own `add chapter`
    /// applies, and an empty list holds no chapter at all.
    pub(crate) fn chapter_step(&mut self, step: ChapterStep) {
        let last = self.chapters.len().checked_sub(1);
        self.chapter = match (step, last) {
            (ChapterStep::At { index }, Some(_)) => Some(index),
            (ChapterStep::Next, Some(last)) => {
                Some(self.chapter.map_or(0, |index| (index + 1).min(last)))
            }
            (ChapterStep::Previous, Some(_)) => {
                Some(self.chapter.map_or(0, |index| index.saturating_sub(1)))
            }
            (_, None) => None,
        };
    }

    /// The crop the Host's own record holds: the rectangle kept, or none.
    pub(crate) fn cropped(&mut self, crop: Crop) {
        self.crop = match crop {
            Crop::Off => None,
            Crop::Rectangle {
                width,
                height,
                x,
                y,
            } => Some(CropRectangle {
                width,
                height,
                x,
                y,
            }),
        };
    }

    /// The shape the Host's own record says the picture is drawn at.
    pub(crate) fn shaped(&mut self, aspect: Aspect) {
        self.aspect = Some(aspect);
    }

    /// Let the Stream go: nothing is playing, and what failed no longer is.
    pub(crate) fn stop(&mut self) {
        *self = Self::idle();
    }

    /// The state as the Player's report leaves it — or nothing, when the report
    /// says exactly what the Host already held.
    ///
    /// Pure, and the only place an observation enters state: a tick that
    /// reports the same position is not a change, and publishes nothing.
    /// Nothing moves while no Stream is open: what a stale Player says about a
    /// Stream the owner stopped is not about anything.
    pub(crate) fn advanced(&self, observation: &Observation) -> Option<Self> {
        self.playing.as_ref()?;

        let next = Self {
            playing: self.playing.clone(),
            state: observation.state,
            position: observation.position,
            duration: observation.duration,
            // A paused Stream's cache keeps filling, so a span that grew by
            // less than a second at both ends says exactly what the Host
            // already holds: keeping the old reading means the revision does
            // not move four times a second to say nothing (ADR-0013). A Player
            // that starts or stops answering is always news.
            buffered: match (self.buffered, observation.buffered) {
                (Some(held), Some(reported)) if held.same_reading(reported) => Some(held),
                (_, reported) => reported,
            },
            failure: observation.failure.clone(),
            // A Player that could not say what the Stream carries says *nothing*
            // rather than "nothing": the tracks the Host already held stand, and
            // the fallback stays un-attempted until a report it can trust
            // arrives (ADR-0014).
            tracks: observation
                .tracks
                .clone()
                .unwrap_or_else(|| self.tracks.clone()),
            chapters: observation.chapters.clone(),
            chapter: observation.chapter,
            speed: observation.speed,
            volume: observation.volume,
            muted: observation.muted,
            subtitle_delay: observation.subtitle_delay,
            crop: observation.crop,
            aspect: observation.aspect,
            resolution: observation.resolution,
            statistics: observation.statistics.clone(),
            // The Player never heard of this, so a report that rebuilds the
            // session carries the attempt forward rather than forgetting it and
            // asking four times a second (ADR-0014).
            subtitles_attempted: self.subtitles_attempted,
        };

        (next != *self).then_some(next)
    }

    /// Whether this report differs from an earlier one in something a client
    /// draws, rather than in the clock's own moving numbers.
    ///
    /// `position` is an anchor clients project from with their own monotonic
    /// clock, and `statistics` move with the bitrate a picture happens to be
    /// reading. Neither is news on every sample. The buffered span stays visible:
    /// a client cannot project a cache, and the span's comparison already
    /// ignores a movement too small to see.
    pub(crate) fn differs_publicly_from(&self, earlier: &Self) -> bool {
        self.playing != earlier.playing
            || self.state != earlier.state
            || self.duration != earlier.duration
            || self.buffered != earlier.buffered
            || self.failure != earlier.failure
            || self.tracks != earlier.tracks
            || self.chapters != earlier.chapters
            || self.chapter != earlier.chapter
            || self.speed != earlier.speed
            || self.volume != earlier.volume
            || self.muted != earlier.muted
            || self.subtitle_delay != earlier.subtitle_delay
            || self.crop != earlier.crop
            || self.aspect != earlier.aspect
            || self.resolution != earlier.resolution
    }
}

/// Where in its Title a Video sits: which season, and which episode.
///
/// The Host's own reading of the Video's id and nothing else — the shape the
/// protocol writes an episode's id in, read through [`crate::meta::episode_of`],
/// the way the library's card reads it too. It is deliberately not a verdict: a
/// numbered `S1E1` can be wrong for a season that starts at specials, so whether
/// a neighbour exists stays the refusal an episode step answers with (ADR-0021).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Episode {
    pub season: u32,
    pub episode: u32,
}

/// What every client is told about playback: the one genuinely shared state
/// (the spec's own words), so it travels as a Snapshot and never as an answer.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlaybackSnapshot {
    /// What the Player is doing. `idle` when nothing is playing — including
    /// after an open failed, which is what `failure` says.
    pub state: PlaybackState,
    /// Where the picture is, so that a client sharing the Host's window knows
    /// where the hole for it goes.
    pub picture: Picture,
    /// Why the last Stream could not be opened, in the Player's own words, and
    /// null when nothing has failed since the last play or stop.
    pub failure: Option<String>,
    /// The Stream playing, or the one that failed, in the Addon's own words.
    /// Never where its bytes are: a Stream URL can carry a debrid credential,
    /// and a Snapshot reaches every paired client (ADR-0009).
    pub now_playing: Option<NowPlaying>,
    /// Which season and episode the Stream playing is, where the Video's own id
    /// says — the reading both clients grey their episode steps from, beside
    /// `position` and `crop` rather than inside `now_playing`, which is the
    /// Addon's words and knows nothing of the protocol's id shape (ADR-0021).
    /// Null for a film.
    pub episode: Option<Episode>,
    /// Where playback is, in seconds from the Stream's start.
    pub position: Option<f64>,
    /// How long the Stream is, in seconds, where the Stream says.
    pub duration: Option<f64>,
    /// The span of the Stream the Player has read, in the Stream's own
    /// timeline — what a client draws behind its progress bar. Null where the
    /// Player has no answer.
    pub buffered: Option<Buffered>,
    /// The Stream's tracks — audio and subtitles — in mpv's own order.
    pub tracks: Vec<Track>,
    /// The Stream's chapters, in the order the container gives them.
    pub chapters: Vec<Chapter>,
    /// Which chapter is playing, by its position in `chapters`.
    pub chapter: Option<usize>,
    /// The rate playback runs at.
    pub speed: Option<f64>,
    /// The level playback runs at.
    pub volume: Option<f64>,
    /// Whether the sound is held.
    pub muted: Option<bool>,
    /// How far the subtitles are shifted.
    pub subtitle_delay: Option<f64>,
    /// The rectangle kept after cropping, or null while uncropped.
    pub crop: Option<CropRectangle>,
    /// The shape being drawn at, or null until something is loaded.
    pub aspect: Option<Aspect>,
    /// How large the picture is.
    pub resolution: Option<VideoSize>,
    /// What the Player says about how the Stream is playing.
    pub statistics: Option<Statistics>,
}

/// A [`Player`] a test drives by hand: it records every telling, and reports
/// whatever a test told it to report.
///
/// The fake the seam is tested against: the Host's rules — what a Snapshot says
/// while an open is in flight, what a failure does, that a position which does
/// not move publishes nothing — are driven without a player, and a test that
/// reaches for the real one has to say so. It reports its picture as being
/// inside the Host's window, which is the shape the platforms this project runs
/// on build; a test that cares says otherwise with [`Self::drawing`].
#[derive(Debug)]
pub struct FixturePlayer {
    opened: Mutex<Vec<Opening>>,
    /// Every telling the Host asked for, in order — the whole control surface,
    /// in the one vocabulary the seam speaks.
    tellings: Mutex<Vec<Telling>>,
    stopped: Mutex<usize>,
    observing: Mutex<Observation>,
    /// Where the fixture says its picture is. Inside the window by default,
    /// because that is the shape a Host on the platforms this project runs on
    /// is built with; a test that cares says otherwise.
    picture: Picture,
    /// Set when the Player refuses everything, for the paths where it is gone.
    refusing: Mutex<Option<PlaybackError>>,
}

/// One Stream the Host asked the fixture to open, and where it was to start.
#[derive(Debug, Clone, PartialEq)]
struct Opening {
    url: String,
    start: Option<f64>,
}

impl FixturePlayer {
    pub fn new() -> Self {
        Self {
            opened: Mutex::new(Vec::new()),
            tellings: Mutex::new(Vec::new()),
            stopped: Mutex::new(0),
            observing: Mutex::new(Observation::idle()),
            picture: Picture::InWindow,
            refusing: Mutex::new(None),
        }
    }

    /// Say where this Player draws, for the tests that read that off a Snapshot.
    pub fn drawing(mut self, picture: Picture) -> Self {
        self.picture = picture;
        self
    }
    /// Report this from now on, until a test says otherwise.
    pub fn reporting(self, observation: Observation) -> Self {
        *self
            .observing
            .lock()
            .expect("the fixture player is not poisoned") = observation;
        self
    }

    /// Report this from now on — for a test that has already handed the Player
    /// to a Host.
    pub fn now_reporting(&self, observation: Observation) {
        *self
            .observing
            .lock()
            .expect("the fixture player is not poisoned") = observation;
    }

    /// Report a different reading of how much of the Stream has been read,
    /// leaving everything else the Player says as it was.
    ///
    /// What a test says between two ticks to watch a paused Stream's cache
    /// fill: the position holds, and only the span moves.
    pub fn now_buffered(&self, buffered: Option<Buffered>) {
        self.observing
            .lock()
            .expect("the fixture player is not poisoned")
            .buffered = buffered;
    }

    /// Refuse every telling with this, for the paths where the Player is gone.
    pub fn refusing(self, error: PlaybackError) -> Self {
        *self
            .refusing
            .lock()
            .expect("the fixture player is not poisoned") = Some(error);
        self
    }

    /// Every URL the Host asked to open, in order.
    pub fn opened(&self) -> Vec<String> {
        self.opened
            .lock()
            .expect("the fixture player is not poisoned")
            .iter()
            .map(|opening| opening.url.clone())
            .collect()
    }

    /// Every open the Host asked for, with where each was to start: what a
    /// resume is asserted through.
    pub fn openings(&self) -> Vec<(String, Option<f64>)> {
        self.opened
            .lock()
            .expect("the fixture player is not poisoned")
            .iter()
            .map(|opening| (opening.url.clone(), opening.start))
            .collect()
    }

    /// Every telling the Host asked for, in order.
    pub fn tellings(&self) -> Vec<Telling> {
        self.tellings
            .lock()
            .expect("the fixture player is not poisoned")
            .clone()
    }

    /// Forget everything recorded so far.
    ///
    /// A Host states its preferences to its Player before anything is opened
    /// (ADR-0024, ADR-0026), so a test that watches one control wants what *its*
    /// Action told the Player, not that preamble.
    pub fn forget(&self) {
        self.opened
            .lock()
            .expect("the fixture player is not poisoned")
            .clear();
        self.tellings
            .lock()
            .expect("the fixture player is not poisoned")
            .clear();
        *self
            .stopped
            .lock()
            .expect("the fixture player is not poisoned") = 0;
    }

    /// How many times the Host asked the Player to stop.
    pub fn stopped(&self) -> usize {
        *self
            .stopped
            .lock()
            .expect("the fixture player is not poisoned")
    }

    /// Refuse unless a test said the Player is gone.
    fn allowed(&self) -> Result<(), PlaybackError> {
        match self
            .refusing
            .lock()
            .expect("the fixture player is not poisoned")
            .clone()
        {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }
}

impl Default for FixturePlayer {
    /// The same Player [`FixturePlayer::new`] makes: a test that has nothing to
    /// say about the Player can leave one out of its setup entirely.
    fn default() -> Self {
        Self::new()
    }
}

impl Player for FixturePlayer {
    fn picture(&self) -> Picture {
        self.picture
    }

    fn open(&self, url: &StreamUrl, start: Option<f64>) -> Result<(), PlaybackError> {
        self.allowed()?;
        self.opened
            .lock()
            .expect("the fixture player is not poisoned")
            .push(Opening {
                url: url.as_str().to_owned(),
                start,
            });
        Ok(())
    }

    fn tell(&self, telling: Telling) -> Result<(), PlaybackError> {
        self.allowed()?;
        self.tellings
            .lock()
            .expect("the fixture player is not poisoned")
            .push(telling);
        Ok(())
    }

    fn stop(&self) -> Result<(), PlaybackError> {
        self.allowed()?;
        *self
            .stopped
            .lock()
            .expect("the fixture player is not poisoned") += 1;
        Ok(())
    }

    fn observe(&self) -> Observation {
        self.observing
            .lock()
            .expect("the fixture player is not poisoned")
            .clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(raw: &str) -> StreamUrl {
        StreamUrl::parse(raw)
            .unwrap_or_else(|error| panic!("{raw} should be a Stream URL: {error}"))
    }

    fn candidate(playback: Playback) -> Stream {
        Stream {
            name: Some("AIOStreams\n1080p".to_owned()),
            description: Some("The Matrix 1999".to_owned()),
            playback,
            warnings: Vec::new(),
            filename: Some("The.Matrix.1999.1080p.mkv".to_owned()),
            binge_group: Some("aiostreams|1080p".to_owned()),
        }
    }

    fn video() -> VideoRef {
        VideoRef::parse("movie", "tt0133093").expect("a Video a request could name")
    }

    fn addon() -> AddonId {
        AddonId::parse("community.aiostreams").expect("an Addon id")
    }

    #[test]
    fn a_stream_url_is_an_http_address_and_nothing_else() {
        assert_eq!(
            url("https://stream.example.org/v/tt0133093-1080p.mkv").as_str(),
            "https://stream.example.org/v/tt0133093-1080p.mkv"
        );
        assert!(StreamUrl::parse("http://example.org/a.mkv").is_ok());

        for raw in [
            "",
            "not a url",
            "/local/file.mkv",
            "file:///etc/passwd",
            "magnet:?xt=urn:btih:deadbeef",
            "s3://bucket/a.mkv",
            "https://",
        ] {
            assert!(
                matches!(StreamUrl::parse(raw), Err(InvalidStreamUrl { .. })),
                "{raw:?} is not a Stream URL this Host will open"
            );
        }
    }

    /// #249: a debrid or AIOStreams URL carries the owner's configuration in
    /// its path and runs past two thousand bytes. The list holds any word up to
    /// `MAX_STRING_LEN`, so the URL a candidate is listed with must be one the
    /// Host opens — a candidate listed as playable and refused at the press is
    /// the bug.
    #[test]
    fn a_direct_url_the_list_holds_is_a_url_the_host_plays() {
        let held_url = |len: usize| {
            let head = "https://debrid.example.org/stream/";
            format!("{head}{}.mkv", "a".repeat(len - head.len() - ".mkv".len()))
        };

        for len in [crate::addon::MAX_URL_LEN + 1, crate::addon::MAX_STRING_LEN] {
            let raw = held_url(len);
            assert!(crate::stream::holdable(&raw), "the list holds {len} bytes");
            assert!(
                ChosenStream::parse(
                    video(),
                    addon(),
                    &candidate(Playback::Direct { url: raw.clone() }),
                )
                .is_ok(),
                "a {len}-byte direct URL is listed as playable, so it must play"
            );
        }

        // Past what the list holds, the candidate never reaches a list at all.
        assert!(StreamUrl::parse(&held_url(crate::addon::MAX_STRING_LEN + 1)).is_err());
    }

    #[test]
    fn a_chosen_stream_keeps_the_addons_words_and_the_url_apart() {
        let chosen = ChosenStream::parse(
            video(),
            addon(),
            &candidate(Playback::Direct {
                url: "https://stream.example.org/v/tt0133093.mkv".to_owned(),
            }),
        )
        .expect("a direct URL is a candidate this Host plays");

        assert_eq!(
            chosen.url.as_str(),
            "https://stream.example.org/v/tt0133093.mkv"
        );
        assert_eq!(
            chosen.now_playing,
            NowPlaying {
                video: video(),
                addon: addon(),
                name: Some("AIOStreams\n1080p".to_owned()),
                description: Some("The Matrix 1999".to_owned()),
                filename: Some("The.Matrix.1999.1080p.mkv".to_owned()),
                binge_group: Some("aiostreams|1080p".to_owned()),
            }
        );
    }

    #[test]
    fn the_wire_shape_of_a_chosen_stream_has_nowhere_a_url_could_go() {
        let chosen = ChosenStream::parse(
            video(),
            addon(),
            &candidate(Playback::Direct {
                url: "https://stream.example.org/v/tt0133093.mkv".to_owned(),
            }),
        )
        .expect("a direct URL is a candidate this Host plays");

        let published = serde_json::to_value(&chosen.now_playing).expect("it serializes");

        assert_eq!(
            published,
            serde_json::json!({
                "video": { "type": "movie", "id": "tt0133093" },
                "addon": "community.aiostreams",
                "name": "AIOStreams\n1080p",
                "description": "The Matrix 1999",
                "filename": "The.Matrix.1999.1080p.mkv",
                "bingeGroup": "aiostreams|1080p",
            }),
            "the shape a Snapshot carries is the declared one — and has no url in it"
        );
        assert!(
            !serde_json::to_string(&published)
                .expect("it serializes")
                .contains("stream.example.org"),
            "where the bytes are never travels outward"
        );
    }

    #[test]
    fn a_torrent_is_a_candidate_this_host_will_not_pretend_to_play() {
        let refused = ChosenStream::parse(
            video(),
            addon(),
            &candidate(Playback::InfoHash {
                info_hash: "61065ea115b7cc3e8db9fb5ab1f6f327f08bd1c9".to_owned(),
            }),
        );

        assert!(
            matches!(&refused, Err(Unplayable { detail }) if detail.contains("infoHash")),
            "an infoHash is listed and marked, and never played: {refused:?}"
        );
    }

    #[test]
    fn a_chosen_streams_words_are_dropped_rather_than_believed_when_they_are_not_ones_to_hold() {
        let mut stream = candidate(Playback::Direct {
            url: "https://stream.example.org/v/tt0133093.mkv".to_owned(),
        });
        stream.name = Some("x".repeat(crate::addon::MAX_STRING_LEN + 1));
        stream.description = Some(String::new());
        stream.filename = None;

        let chosen = ChosenStream::parse(video(), addon(), &stream)
            .expect("a long badge line does not make a Stream unplayable");

        assert_eq!(
            chosen.now_playing,
            NowPlaying {
                video: video(),
                addon: addon(),
                name: None,
                description: None,
                filename: None,
                binge_group: Some("aiostreams|1080p".to_owned()),
            },
            "a word too long to hold is absence, the way it is for an Addon's answer"
        );
    }

    #[test]
    fn a_session_moves_where_the_player_says_and_nowhere_while_nothing_is_open() {
        let session = PlaybackSession::idle();
        assert_eq!(
            session.advanced(&Observation::playing(12.0, 100.0)),
            None,
            "a Player talking about a Stream the Host never opened says nothing"
        );

        let session = PlaybackSession::opening(
            ChosenStream::parse(
                video(),
                addon(),
                &candidate(Playback::Direct {
                    url: "https://stream.example.org/v/x.mkv".to_owned(),
                }),
            )
            .expect("a direct URL is a candidate this Host plays"),
        );
        let next = session
            .advanced(&Observation::playing(12.5, 100.0))
            .expect("a position that moved is a change");
        assert_eq!(next.state, PlaybackState::Playing);
        assert_eq!(next.position, Some(12.5));
        assert_eq!(next.duration, Some(100.0));
        assert_eq!(
            session.advanced(&Observation::playing(12.5, 100.0)),
            Some(next.clone()),
            "the same report from a different session is the same state"
        );
        assert_eq!(
            next.advanced(&Observation::playing(12.5, 100.0)),
            None,
            "a tick that reports the same position is not a change"
        );
    }

    #[test]
    fn a_buffered_span_is_the_same_reading_until_an_end_moves_by_a_second() {
        let session = PlaybackSession::opening(
            ChosenStream::parse(
                video(),
                addon(),
                &candidate(Playback::Direct {
                    url: "https://stream.example.org/v/x.mkv".to_owned(),
                }),
            )
            .expect("a direct URL is a candidate this Host plays"),
        );

        let held = Buffered {
            start: 0.0,
            end: 60.0,
        };
        let first = session
            .advanced(&Observation {
                buffered: Some(held),
                ..Observation::playing(12.5, 600.0)
            })
            .expect("a span arriving is a change");

        assert_eq!(
            first.advanced(&Observation {
                buffered: Some(Buffered {
                    start: 0.4,
                    end: 60.4,
                }),
                ..Observation::playing(12.5, 600.0)
            }),
            None,
            "four tenths of a second at both ends is the same reading"
        );
        assert!(
            first
                .advanced(&Observation {
                    buffered: Some(Buffered {
                        start: 1.0,
                        end: 61.0,
                    }),
                    ..Observation::playing(12.5, 600.0)
                })
                .is_some(),
            "a second at both ends is a reading a client is told about"
        );
        assert!(
            first
                .advanced(&Observation {
                    buffered: Some(Buffered {
                        start: 0.0,
                        end: 61.0,
                    }),
                    ..Observation::playing(12.5, 600.0)
                })
                .is_some(),
            "and so is one end alone moving that far"
        );

        let moved = first
            .advanced(&Observation {
                state: PlaybackState::Paused,
                buffered: Some(Buffered {
                    start: 0.4,
                    end: 60.4,
                }),
                ..Observation::playing(12.5, 600.0)
            })
            .expect("a paused Stream is a change");
        assert_eq!(
            moved.buffered,
            Some(held),
            "a reading that is not news does not move the span the Host holds"
        );
    }

    #[test]
    fn a_failure_leaves_the_stream_the_host_was_on_named_and_says_why() {
        let session = PlaybackSession::opening(
            ChosenStream::parse(
                video(),
                addon(),
                &candidate(Playback::Direct {
                    url: "https://stream.example.org/v/x.mkv".to_owned(),
                }),
            )
            .expect("a direct URL is a candidate this Host plays"),
        );

        let failed = session
            .advanced(&Observation {
                state: PlaybackState::Idle,
                failure: Some(
                    "That Stream could not be opened — mpv could not load it.".to_owned(),
                ),
                ..Observation::idle()
            })
            .expect("a failed open is a change");

        assert_eq!(
            failed.snapshot(Picture::InWindow),
            PlaybackSnapshot {
                state: PlaybackState::Idle,
                picture: Picture::InWindow,
                failure: Some(
                    "That Stream could not be opened — mpv could not load it.".to_owned()
                ),
                now_playing: Some(
                    ChosenStream::parse(
                        video(),
                        addon(),
                        &candidate(Playback::Direct {
                            url: "https://stream.example.org/v/x.mkv".to_owned(),
                        }),
                    )
                    .expect("a direct URL is a candidate this Host plays")
                    .now_playing
                ),
                episode: None,
                position: None,
                duration: None,
                buffered: None,
                tracks: Vec::new(),
                chapters: Vec::new(),
                chapter: None,
                speed: None,
                volume: None,
                muted: None,
                subtitle_delay: None,
                crop: None,
                aspect: None,
                resolution: None,
                statistics: None,
            },
            "the client that pressed play is told which candidate did not open"
        );

        let stopped = {
            let mut stopped = failed.clone();
            stopped.stop();
            stopped
        };
        assert_eq!(
            stopped.snapshot(Picture::InWindow).failure,
            None,
            "a stop clears the failure"
        );
        assert_eq!(stopped.snapshot(Picture::InWindow).now_playing, None);
        assert!(!stopped.has_stream());
    }

    #[test]
    fn a_seek_lands_where_the_host_knows_the_stream_goes() {
        // The arithmetic of a seek, and its two clamps: a player never seeks
        // before the start, and never past a duration the Stream stated.
        let cases = [
            (SeekTarget::To { seconds: 120.0 }, 10.0, Some(300.0), 120.0),
            (SeekTarget::To { seconds: 120.0 }, 10.0, None, 120.0),
            (SeekTarget::To { seconds: -5.0 }, 10.0, Some(300.0), 0.0),
            (SeekTarget::To { seconds: 900.0 }, 10.0, Some(300.0), 300.0),
            (SeekTarget::By { seconds: -10.0 }, 8.0, Some(300.0), 0.0),
            (SeekTarget::By { seconds: -10.0 }, 40.0, Some(300.0), 30.0),
            (SeekTarget::By { seconds: 10.0 }, 295.0, Some(300.0), 300.0),
        ];

        for (target, position, duration, expected) in cases {
            assert_eq!(
                target.landing(position, duration),
                expected,
                "{target:?} from {position} of {duration:?}"
            );
        }
    }

    #[test]
    fn a_seek_that_is_not_a_number_of_seconds_is_refused() {
        assert_eq!(
            SeekTarget::To { seconds: 12.5 }.checked(),
            Ok(SeekTarget::To { seconds: 12.5 })
        );

        for target in [
            SeekTarget::To { seconds: f64::NAN },
            SeekTarget::By {
                seconds: f64::INFINITY,
            },
            SeekTarget::By {
                seconds: f64::NEG_INFINITY,
            },
        ] {
            assert!(
                matches!(target.checked(), Err(InvalidSeekTarget { .. })),
                "{target:?} is not a place to go"
            );
        }
    }

    #[test]
    fn a_telling_reaches_a_fixture_player_and_is_remembered() {
        let player = FixturePlayer::new();

        player
            .open(&url("https://example.org/a.mkv"), None)
            .expect("open");
        player.tell(Telling::Pause(true)).expect("pause");
        player.tell(Telling::Pause(false)).expect("resume");
        player
            .tell(Telling::Seek(SeekTarget::By { seconds: -10.0 }))
            .expect("seek");
        player.stop().expect("stop");

        assert_eq!(player.opened(), vec!["https://example.org/a.mkv"]);
        assert_eq!(
            player.openings(),
            vec![("https://example.org/a.mkv".to_owned(), None)],
            "a Stream with no resume point opens at its beginning"
        );
        assert_eq!(
            player.tellings(),
            vec![
                Telling::Pause(true),
                Telling::Pause(false),
                Telling::Seek(SeekTarget::By { seconds: -10.0 }),
            ],
            "the whole control surface is one vocabulary, and every telling is remembered"
        );
        assert_eq!(player.stopped(), 1);
    }

    #[test]
    fn a_fixture_player_that_was_told_to_refuse_refuses_everything() {
        let player = FixturePlayer::new().refusing(PlaybackError::Open {
            detail: "mpv is gone".to_owned(),
        });

        assert!(matches!(
            player.open(&url("https://example.org/a.mkv"), None),
            Err(PlaybackError::Open { .. })
        ));
        assert!(matches!(
            player.tell(Telling::Pause(true)),
            Err(PlaybackError::Open { .. })
        ));
        assert!(player.tellings().is_empty());
        assert!(player.opened().is_empty());
    }

    #[test]
    fn the_published_shape_is_the_declared_one() {
        let session = PlaybackSession::opening(
            ChosenStream::parse(
                video(),
                addon(),
                &candidate(Playback::Direct {
                    url: "https://stream.example.org/v/x.mkv".to_owned(),
                }),
            )
            .expect("a direct URL is a candidate this Host plays"),
        );

        let published =
            serde_json::to_value(session.snapshot(Picture::InWindow)).expect("it serializes");

        assert_eq!(
            published,
            serde_json::json!({
                "state": "opening",
                "picture": "in_window",
                "failure": null,
                "nowPlaying": {
                    "video": { "type": "movie", "id": "tt0133093" },
                    "addon": "community.aiostreams",
                    "name": "AIOStreams\n1080p",
                    "description": "The Matrix 1999",
                    "filename": "The.Matrix.1999.1080p.mkv",
                    "bingeGroup": "aiostreams|1080p",
                },
                "episode": null,
                "position": null,
                "duration": null,
                "buffered": null,
                "tracks": [],
                "chapters": [],
                "chapter": null,
                "speed": null,
                "volume": null,
                "muted": null,
                "subtitleDelay": null,
                "crop": null,
                "aspect": null,
                "resolution": null,
                "statistics": null,
            }),
            "the window reads this by hand, so the shape it declares is the shape that arrives"
        );
    }

    #[test]
    fn the_controls_bound_is_the_declared_one() {
        assert_eq!(checked_speed(1.0), Ok(1.0));
        assert_eq!(checked_speed(0.05), Ok(0.05));
        assert_eq!(checked_speed(100.0), Ok(100.0));
        for bad in [0.0, 0.04, 100.1, f64::NAN, f64::INFINITY] {
            assert!(
                matches!(checked_speed(bad), Err(InvalidSpeed { .. })),
                "{bad}"
            );
        }

        assert_eq!(checked_volume(100.0), Ok(100.0));
        assert_eq!(checked_volume(0.0), Ok(0.0));
        assert_eq!(checked_volume(130.0), Ok(130.0));
        for bad in [-0.1, 130.1, f64::NAN] {
            assert!(
                matches!(checked_volume(bad), Err(InvalidVolume { .. })),
                "{bad}"
            );
        }

        assert_eq!(checked_subtitle_delay(-2.5), Ok(-2.5));
        assert_eq!(checked_subtitle_delay(-3600.0), Ok(-3600.0));
        for bad in [3600.1, -3600.1, f64::NAN] {
            assert!(
                matches!(
                    checked_subtitle_delay(bad),
                    Err(InvalidSubtitleDelay { .. })
                ),
                "{bad}"
            );
        }

        assert_eq!(checked_aspect(&Aspect::Source), Ok(()));
        assert_eq!(checked_aspect(&Aspect::Ratio { value: 1.7778 }), Ok(()));
        for bad in [0.0, -1.0, 100.1, f64::NAN] {
            assert!(
                matches!(
                    checked_aspect(&Aspect::Ratio { value: bad }),
                    Err(InvalidAspect { .. })
                ),
                "{bad}"
            );
        }

        assert_eq!(checked_crop(&Crop::Off), Ok(()));
        assert_eq!(
            checked_crop(&Crop::Rectangle {
                width: 96,
                height: 72,
                x: 16,
                y: 0,
            }),
            Ok(())
        );
        for bad in [
            Crop::Rectangle {
                width: 0,
                height: 72,
                x: 0,
                y: 0,
            },
            Crop::Rectangle {
                width: 96,
                height: 0,
                x: 0,
                y: 0,
            },
        ] {
            assert!(
                matches!(checked_crop(&bad), Err(InvalidCrop { .. })),
                "{bad:?}"
            );
        }
    }

    #[test]
    fn a_track_id_is_positive_or_it_is_not_a_track() {
        assert_eq!(TrackId::new(7), Some(TrackId(7)));
        assert_eq!(TrackId::new(0), None);
        assert_eq!(TrackId::new(-3), None);
    }

    #[test]
    fn the_wire_shape_of_a_track_crop_aspect_and_the_statistics_is_the_declared_one() {
        let track = Track {
            id: TrackId(2),
            kind: TrackKind::Subtitle,
            language: Some("por".to_owned()),
            title: None,
            codec: Some("subrip".to_owned()),
            embedded: true,
            selected: false,
            default: false,
            forced: false,
        };
        assert_eq!(
            serde_json::to_value(&track).expect("a track serializes"),
            serde_json::json!({
                "id": 2,
                "kind": "subtitle",
                "language": "por",
                "title": null,
                "codec": "subrip",
                "embedded": true,
                "selected": false,
                "default": false,
                "forced": false,
            })
        );

        assert_eq!(
            serde_json::to_value(Crop::Off).expect("a crop serializes"),
            serde_json::json!({ "kind": "off" })
        );
        assert_eq!(
            serde_json::to_value(Crop::Rectangle {
                width: 96,
                height: 72,
                x: 16,
                y: 0,
            })
            .expect("a crop serializes"),
            serde_json::json!({
                "kind": "rectangle",
                "width": 96,
                "height": 72,
                "x": 16,
                "y": 0,
            })
        );

        assert_eq!(
            serde_json::to_value(Aspect::Source).expect("an aspect serializes"),
            serde_json::json!({ "kind": "source" })
        );
        assert_eq!(
            serde_json::to_value(Aspect::Ratio { value: 1.7778 }).expect("an aspect serializes"),
            serde_json::json!({ "kind": "ratio", "value": 1.7778 })
        );

        assert_eq!(
            serde_json::to_value(Statistics {
                bitrate: None,
                dropped_frames: Some(0),
                hardware_decode: Some("no".to_owned()),
            })
            .expect("statistics serialize"),
            serde_json::json!({
                "bitrate": null,
                "droppedFrames": 0,
                "hardwareDecode": "no",
            }),
            "a word and two numbers, camelCased for a JavaScript client"
        );
    }

    #[test]
    fn a_player_report_folds_its_tracks_chapters_and_controls_over_the_session() {
        let session = PlaybackSession::opening(
            ChosenStream::parse(
                video(),
                addon(),
                &candidate(Playback::Direct {
                    url: "https://stream.example.org/v/x.mkv".to_owned(),
                }),
            )
            .expect("a direct URL is a candidate this Host plays"),
        );

        let observation = Observation {
            state: PlaybackState::Playing,
            position: Some(12.5),
            duration: Some(600.0),
            tracks: Some(vec![
                Track {
                    id: TrackId(1),
                    kind: TrackKind::Audio,
                    language: Some("eng".to_owned()),
                    title: None,
                    codec: Some("aac".to_owned()),
                    embedded: true,
                    selected: true,
                    default: true,
                    forced: false,
                },
                Track {
                    id: TrackId(2),
                    kind: TrackKind::Subtitle,
                    language: Some("por".to_owned()),
                    title: None,
                    codec: Some("subrip".to_owned()),
                    embedded: true,
                    selected: false,
                    default: false,
                    forced: false,
                },
            ]),
            chapters: vec![
                Chapter {
                    index: 0,
                    title: Some("Intro".to_owned()),
                    time: 0.0,
                },
                Chapter {
                    index: 1,
                    title: None,
                    time: 300.0,
                },
            ],
            chapter: Some(0),
            speed: Some(1.0),
            volume: Some(100.0),
            muted: Some(false),
            subtitle_delay: Some(-0.5),
            crop: Some(CropRectangle {
                width: 96,
                height: 72,
                x: 16,
                y: 0,
            }),
            aspect: Some(Aspect::Source),
            resolution: Some(VideoSize {
                width: 128,
                height: 72,
            }),
            statistics: Some(Statistics {
                bitrate: None,
                dropped_frames: Some(0),
                hardware_decode: Some("no".to_owned()),
            }),
            ..Observation::idle()
        };

        let next = session
            .advanced(&observation)
            .expect("a report with a track list is a change");

        let snapshot = next.snapshot(Picture::InWindow);
        assert_eq!(
            snapshot.tracks,
            observation.tracks.clone().unwrap_or_default()
        );
        assert_eq!(snapshot.chapters, observation.chapters);
        assert_eq!(snapshot.chapter, Some(0));
        assert_eq!(snapshot.speed, Some(1.0));
        assert_eq!(snapshot.volume, Some(100.0));
        assert_eq!(snapshot.muted, Some(false));
        assert_eq!(snapshot.subtitle_delay, Some(-0.5));
        assert_eq!(snapshot.crop, observation.crop);
        assert_eq!(snapshot.aspect, Some(Aspect::Source));
        assert_eq!(snapshot.resolution, observation.resolution);
        assert_eq!(snapshot.statistics, observation.statistics);
    }

    #[test]
    fn the_whole_published_playback_object_is_the_frozen_one() {
        // The window is written against this object by hand, so the whole of it
        // is asserted — every field, every null, and every camelCased name.
        let session = PlaybackSession::opening(
            ChosenStream::parse(
                VideoRef::parse("series", "tt0903747:1:1").expect("a Video a request could name"),
                AddonId::parse("community.aiostreams").expect("an Addon id"),
                &Stream {
                    name: Some("1080p".to_owned()),
                    description: None,
                    playback: Playback::Direct {
                        url: "https://stream.example.org/v/tt0903747-1-1.mkv".to_owned(),
                    },
                    warnings: Vec::new(),
                    filename: None,
                    binge_group: None,
                },
            )
            .expect("a direct URL is a candidate this Host plays"),
        );

        let observation = Observation {
            state: PlaybackState::Playing,
            position: Some(12.5),
            duration: Some(600.0),
            buffered: Some(Buffered {
                start: 12.0,
                end: 40.0,
            }),
            tracks: Some(vec![
                Track {
                    id: TrackId(1),
                    kind: TrackKind::Audio,
                    language: Some("eng".to_owned()),
                    title: Some("English stereo".to_owned()),
                    codec: Some("aac".to_owned()),
                    embedded: true,
                    selected: true,
                    default: true,
                    forced: false,
                },
                Track {
                    id: TrackId(2),
                    kind: TrackKind::Subtitle,
                    language: Some("por".to_owned()),
                    title: None,
                    codec: Some("subrip".to_owned()),
                    embedded: true,
                    selected: false,
                    default: false,
                    forced: false,
                },
            ]),
            chapters: vec![Chapter {
                index: 0,
                title: Some("Intro".to_owned()),
                time: 0.0,
            }],
            chapter: Some(0),
            speed: Some(1.0),
            volume: Some(100.0),
            muted: Some(false),
            subtitle_delay: Some(0.0),
            crop: Some(CropRectangle {
                width: 96,
                height: 72,
                x: 16,
                y: 0,
            }),
            aspect: Some(Aspect::Source),
            resolution: Some(VideoSize {
                width: 128,
                height: 72,
            }),
            statistics: Some(Statistics {
                bitrate: None,
                dropped_frames: Some(0),
                hardware_decode: Some("no".to_owned()),
            }),
            ..Observation::idle()
        };

        let played = session
            .advanced(&observation)
            .expect("a full report is a change");
        let published =
            serde_json::to_value(played.snapshot(Picture::InWindow)).expect("it serializes");

        assert_eq!(
            published,
            serde_json::json!({
                "state": "playing",
                "picture": "in_window",
                "failure": null,
                "nowPlaying": {
                    "video": { "type": "series", "id": "tt0903747:1:1" },
                    "addon": "community.aiostreams",
                    "name": "1080p", "description": null, "filename": null, "bingeGroup": null
                },
                "episode": { "season": 1, "episode": 1 },
                "position": 12.5,
                "duration": 600.0,
                "buffered": { "start": 12.0, "end": 40.0 },
                "tracks": [
                    { "id": 1, "kind": "audio", "language": "eng", "title": "English stereo", "codec": "aac",
                      "embedded": true, "selected": true, "default": true, "forced": false },
                    { "id": 2, "kind": "subtitle", "language": "por", "title": null, "codec": "subrip",
                      "embedded": true, "selected": false, "default": false, "forced": false }
                ],
                "chapters": [ { "index": 0, "title": "Intro", "time": 0.0 } ],
                "chapter": 0,
                "speed": 1.0,
                "volume": 100.0,
                "muted": false,
                "subtitleDelay": 0.0,
                "crop": { "width": 96, "height": 72, "x": 16, "y": 0 },
                "aspect": { "kind": "source" },
                "resolution": { "width": 128, "height": 72 },
                "statistics": { "bitrate": null, "droppedFrames": 0, "hardwareDecode": "no" }
            }),
            "the whole playback object the window reads is the frozen one"
        );
    }

    #[test]
    fn a_tracks_words_are_kept_only_where_they_are_ones_a_snapshot_will_hold() {
        let long = "x".repeat(crate::addon::MAX_STRING_LEN + 1);
        let track = Track {
            id: TrackId(1),
            kind: TrackKind::Subtitle,
            language: Some(long.clone()),
            title: Some(String::new()),
            codec: Some("subrip".to_owned()),
            embedded: false,
            selected: false,
            default: false,
            forced: false,
        }
        .bounded();

        assert_eq!(
            track.language, None,
            "a word too long to hold is absence, the way it is for an Addon"
        );
        assert_eq!(track.title, None, "and so is one that says nothing");
        assert_eq!(track.codec.as_deref(), Some("subrip"));

        let statistics = Statistics {
            bitrate: None,
            dropped_frames: Some(0),
            hardware_decode: Some(long),
        }
        .bounded();
        assert_eq!(statistics.hardware_decode, None);
    }
}
