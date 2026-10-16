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

use crate::addon::{AddonId, MAX_URL_LEN};
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
    pub fn parse(raw: &str) -> Result<Self, InvalidStreamUrl> {
        let refused = || InvalidStreamUrl {
            url: raw.to_owned(),
        };

        if raw.is_empty() || raw.len() > MAX_URL_LEN {
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
    fn open(&self, url: &StreamUrl) -> Result<(), PlaybackError>;

    /// Hold the picture where it is, or let it run.
    fn set_paused(&self, paused: bool) -> Result<(), PlaybackError>;

    /// Move within the Stream.
    fn seek(&self, target: SeekTarget) -> Result<(), PlaybackError>;

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
    /// Why an open failed, in the Player's own words, set once and until the
    /// next open. The Host shows it to the client that pressed play.
    pub failure: Option<String>,
}

impl Observation {
    /// A Player doing nothing.
    pub fn idle() -> Self {
        Self {
            state: PlaybackState::Idle,
            position: None,
            duration: None,
            failure: None,
        }
    }

    /// A Player playing a Stream of this length, at this position.
    pub fn playing(position: f64, duration: f64) -> Self {
        Self {
            state: PlaybackState::Playing,
            position: Some(position),
            duration: Some(duration),
            failure: None,
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
    /// Why the last open failed, kept until the next play or stop.
    failure: Option<String>,
}

impl PlaybackSession {
    /// Nothing has been played.
    pub(crate) fn idle() -> Self {
        Self {
            playing: None,
            state: PlaybackState::Idle,
            position: None,
            duration: None,
            failure: None,
        }
    }

    /// A Stream was chosen and the Player agreed to try: the open is in flight.
    pub(crate) fn opening(chosen: ChosenStream) -> Self {
        Self {
            playing: Some(chosen),
            state: PlaybackState::Opening,
            position: None,
            duration: None,
            failure: None,
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
            position: self.position,
            duration: self.duration,
        }
    }

    /// Whether the Host is on a Stream at all — playing, opening, paused, ended
    /// or failed. A stop is allowed for all of those; pause and seek are not.
    pub(crate) fn has_stream(&self) -> bool {
        self.playing.is_some()
    }

    /// Whether the Player is on something it can be told to pause or seek:
    /// a Stream that has started, and not one that is over.
    pub(crate) fn is_live(&self) -> bool {
        self.playing.is_some()
            && matches!(
                self.state,
                PlaybackState::Opening | PlaybackState::Playing | PlaybackState::Paused
            )
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
            failure: observation.failure.clone(),
        };

        (next != *self).then_some(next)
    }
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
    /// Where playback is, in seconds from the Stream's start.
    pub position: Option<f64>,
    /// How long the Stream is, in seconds, where the Stream says.
    pub duration: Option<f64>,
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
    opened: Mutex<Vec<String>>,
    paused: Mutex<Vec<bool>>,
    sought: Mutex<Vec<SeekTarget>>,
    stopped: Mutex<usize>,
    observing: Mutex<Observation>,
    /// Where the fixture says its picture is. Inside the window by default,
    /// because that is the shape a Host on the platforms this project runs on
    /// is built with; a test that cares says otherwise.
    picture: Picture,
    /// Set when the Player refuses everything, for the paths where it is gone.
    refusing: Mutex<Option<PlaybackError>>,
}

impl FixturePlayer {
    pub fn new() -> Self {
        Self {
            opened: Mutex::new(Vec::new()),
            paused: Mutex::new(Vec::new()),
            sought: Mutex::new(Vec::new()),
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
            .clone()
    }

    /// Every pause the Host asked for, in order.
    pub fn paused(&self) -> Vec<bool> {
        self.paused
            .lock()
            .expect("the fixture player is not poisoned")
            .clone()
    }

    /// Every seek the Host asked for, in order.
    pub fn sought(&self) -> Vec<SeekTarget> {
        self.sought
            .lock()
            .expect("the fixture player is not poisoned")
            .clone()
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

    fn open(&self, url: &StreamUrl) -> Result<(), PlaybackError> {
        self.allowed()?;
        self.opened
            .lock()
            .expect("the fixture player is not poisoned")
            .push(url.as_str().to_owned());
        Ok(())
    }

    fn set_paused(&self, paused: bool) -> Result<(), PlaybackError> {
        self.allowed()?;
        self.paused
            .lock()
            .expect("the fixture player is not poisoned")
            .push(paused);
        Ok(())
    }

    fn seek(&self, target: SeekTarget) -> Result<(), PlaybackError> {
        self.allowed()?;
        self.sought
            .lock()
            .expect("the fixture player is not poisoned")
            .push(target);
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
                position: None,
                duration: None,
                failure: Some(
                    "That Stream could not be opened — mpv could not load it.".to_owned(),
                ),
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
                position: None,
                duration: None,
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
            .open(&url("https://example.org/a.mkv"))
            .expect("open");
        player.set_paused(true).expect("pause");
        player.set_paused(false).expect("resume");
        player
            .seek(SeekTarget::By { seconds: -10.0 })
            .expect("seek");
        player.stop().expect("stop");

        assert_eq!(player.opened(), vec!["https://example.org/a.mkv"]);
        assert_eq!(player.paused(), vec![true, false]);
        assert_eq!(player.sought(), vec![SeekTarget::By { seconds: -10.0 }]);
        assert_eq!(player.stopped(), 1);
    }

    #[test]
    fn a_fixture_player_that_was_told_to_refuse_refuses_everything() {
        let player = FixturePlayer::new().refusing(PlaybackError::Open {
            detail: "mpv is gone".to_owned(),
        });

        assert!(matches!(
            player.open(&url("https://example.org/a.mkv")),
            Err(PlaybackError::Open { .. })
        ));
        assert!(matches!(
            player.set_paused(true),
            Err(PlaybackError::Open { .. })
        ));
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
                "position": null,
                "duration": null,
            }),
            "the window reads this by hand, so the shape it declares is the shape that arrives"
        );
    }
}
