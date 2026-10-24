//! The Seek preview: a still of one moment of the Stream, and the seam it comes
//! through.
//!
//! Pointing at the timeline says what time it is and nothing else; a poster is
//! metadata and an episode still is somebody's artwork, so the only picture of a
//! moment that is really *of this Stream* is a frame the Player yields for it.
//! That is what a **Seek preview** is (CONTEXT.md), and it is the one kind of
//! frame that crosses the Player seam — asked for at one moment and never at the
//! frame rate (ADR-0028).
//!
//! It is a seam of its own rather than a method on [`Player`](crate::Player):
//! the Player is the Stream playing now, and a fake player should not have to
//! pretend to produce pictures. `host-mpv` answers it with a second, silent
//! libmpv; tests answer it with [`FixturePreviewer`].
//!
//! ## The two brakes
//!
//! A still costs a second connection to a URL that is a debrid session and a few
//! megabytes of seeking, so a preview is a decoration that may never compete
//! with the film:
//!
//! - **The ceiling.** A Stream reading more than [`PREVIEW_CEILING_BPS`] is
//!   never previewed, and neither is one that will not say what it costs:
//!   [`preview_ceiling`] is that decision, and it is pure so it is tested
//!   without a player.
//! - **The bucket.** A still is asked for per [`PREVIEW_BUCKET_SECONDS`], cached
//!   in [`PreviewCache`], and a second ask for a bucket already answered costs
//!   nothing at all. The still may be up to five seconds off the pointer, which
//!   nobody can see in a still frame.
//!
//! A preview that cannot be produced is silent: [`Previewer::preview`] answers
//! `None`, the caller draws time and chapter alone, and nothing about playback
//! or a Snapshot moves.

use std::collections::VecDeque;
use std::sync::Mutex;

use base64::Engine;
use serde::Serialize;

use crate::playback::{Statistics, StreamUrl};

/// How many seconds of the Stream one still stands for.
///
/// A seek costs the bytes between the target and its keyframe — about 5 MB at
/// the ceiling, more when the release has a long GOP — so asking once a second
/// while a person drags would be hundreds of megabytes for a tooltip. Five
/// seconds is at most four seconds off the cursor, which is invisible in a
/// still (ADR-0028).
pub const PREVIEW_BUCKET_SECONDS: f64 = 5.0;

/// How many stills one Stream keeps in memory: 200 buckets, about 2 MB.
pub const PREVIEW_CACHE_FRAMES: usize = 200;

/// The most a Stream may report reading and still be previewed, in bits per
/// second.
///
/// A safety valve rather than a feature: a debrid account may allow one
/// connection at a time or count the second one, and the Host cannot know which
/// before trying. Above this — and where nothing is stated at all — the still is
/// not worth the risk to the film (ADR-0028).
pub const PREVIEW_CEILING_BPS: u64 = 20_000_000;

/// How long a Stream is given to say what it costs before it is treated as one
/// nobody can price.
///
/// `video-bitrate` is the video output's own count of what it is reading, and a
/// report taken the moment a file loads can be missing it; a rule that refused on
/// that first report would never preview anything at all. Three seconds is long
/// enough for the picture to come up and short enough that an unpriced Stream is
/// refused rather than assumed cheap — which is what *unknown refuses* means in
/// practice (ADR-0028).
pub const PREVIEW_BITRATE_GRACE_MS: i64 = 3_000;

/// One still of a Stream: a JPEG in a `data:` URL, which is what a client hands
/// to an `<img>` and what a wire frame can carry.
#[derive(Clone, PartialEq, Eq)]
pub struct Frame {
    image: String,
}

impl Frame {
    /// A still made of these JPEG bytes, as the `data:` URL a client draws.
    pub fn jpeg(bytes: &[u8]) -> Self {
        Self {
            image: format!(
                "data:image/jpeg;base64,{}",
                base64::engine::general_purpose::STANDARD.encode(bytes)
            ),
        }
    }

    /// The same still, as the `data:` URL that travels.
    pub fn image(&self) -> &str {
        &self.image
    }
}

/// A still's bytes are never printed: a failing assertion that dumped a
/// megabyte of base64 would be unreadable, and the picture is not the point of
/// the test.
impl std::fmt::Debug for Frame {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Frame")
            .field("image", &format!("<{} chars>", self.image.len()))
            .finish()
    }
}

/// The bucket a moment falls in: whole [`PREVIEW_BUCKET_SECONDS`] steps from the
/// Stream's start.
pub fn bucket_of(at: f64) -> u64 {
    if !at.is_finite() || at <= 0.0 {
        return 0;
    }
    (at / PREVIEW_BUCKET_SECONDS).floor() as u64
}

/// Where a bucket begins, in seconds: the moment the worker seeks to.
pub fn bucket_start(bucket: u64) -> f64 {
    bucket as f64 * PREVIEW_BUCKET_SECONDS
}

/// The stills one Stream has answered, keyed by bucket, oldest evicted first.
///
/// `get` takes the cache mutably because a hit is a use: the still moves to the
/// back, so dragging back and forth over a film keeps what is being looked at
/// rather than what was looked at first.
#[derive(Debug, Default)]
pub struct PreviewCache {
    frames: VecDeque<(u64, Frame)>,
}

impl PreviewCache {
    /// The still for a bucket, where it has been answered already.
    pub fn get(&mut self, bucket: u64) -> Option<Frame> {
        let index = self.frames.iter().position(|(kept, _)| *kept == bucket)?;
        let entry = self.frames.remove(index)?;
        let frame = entry.1.clone();
        self.frames.push_back(entry);
        Some(frame)
    }

    /// Keep a bucket's still, evicting the oldest once the cache is full.
    pub fn keep(&mut self, bucket: u64, frame: Frame) {
        if let Some(index) = self.frames.iter().position(|(kept, _)| *kept == bucket) {
            self.frames.remove(index);
        }
        self.frames.push_back((bucket, frame));
        while self.frames.len() > PREVIEW_CACHE_FRAMES {
            self.frames.pop_front();
        }
    }

    /// Forget every still: what arming a different Stream does.
    pub fn clear(&mut self) {
        self.frames.clear();
    }

    /// How many stills are held.
    pub fn len(&self) -> usize {
        self.frames.len()
    }

    /// Whether nothing has been answered yet.
    pub fn is_empty(&self) -> bool {
        self.frames.is_empty()
    }
}

/// What one report of the Player says about whether a Seek preview may run on
/// the Stream.
///
/// The report is the Player's own `Statistics`, and the question is asked once
/// per Stream: before it answers there is nothing to decide.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PreviewCeiling {
    /// The Player has not said how much the Stream costs yet.
    Waiting,
    /// The Stream is known and affordable: a preview may run.
    Affordable,
    /// The Stream is too dear, or will not say what it costs: never preview it.
    Refused,
}

impl PreviewCeiling {
    /// Whether this decision is one the previewer should be armed under.
    pub fn affordable(self) -> bool {
        matches!(self, Self::Affordable)
    }
}

/// Whether a Stream may be previewed, from what the Player reports about it.
///
/// Known and at or under the ceiling arms; over the ceiling refuses; and a
/// bitrate that is zero or absent refuses too — there is no cumulative-bytes
/// meter to bound what a worker with an unknown bitrate would cost, so the only
/// honest rule is not to start one (ADR-0028). A bitrate nobody has stated yet is
/// given until `waited` — [`PREVIEW_BITRATE_GRACE_MS`] of playback — because the
/// report that says a file has loaded is not yet a report about what it costs;
/// after that, absent is absent.
pub fn preview_ceiling(statistics: Option<&Statistics>, waited: bool) -> PreviewCeiling {
    let Some(statistics) = statistics else {
        return PreviewCeiling::Waiting;
    };

    match statistics.bitrate {
        Some(bitrate) if bitrate > 0 && bitrate <= PREVIEW_CEILING_BPS => {
            PreviewCeiling::Affordable
        }
        Some(bitrate) if bitrate > PREVIEW_CEILING_BPS => PreviewCeiling::Refused,
        // Zero, or nothing stated, is a rate nobody can bound. The Stream is
        // given its moment to say; one that still will not is refused.
        _ if waited => PreviewCeiling::Refused,
        _ => PreviewCeiling::Waiting,
    }
}

/// The Host's seam for a still of one moment of the Stream playing.
///
/// `arm` is told the URL when a Stream opens and costs nothing — the
/// implementation connects lazily, on the first `preview` — and `disarm` lets
/// the URL go. The URL never leaves the implementation: it is a debrid session,
/// and no Snapshot may carry it (ADR-0009, ADR-0028).
///
/// `preview` answers a still for a moment, or nothing at all: a Stream that will
/// not open, a seek that never becomes ready, and a provider that refuses the
/// second connection are each one log line and an absent picture, never a
/// failure a client is told about. It may block — it is a seek and a capture —
/// but it is asked from a Question, which resolves outside the Host's change
/// lock (ADR-0022).
pub trait Previewer: Send + Sync + 'static {
    /// Tell the previewer which Stream is open. Cheap, and connects to nothing.
    fn arm(&self, url: &StreamUrl);

    /// Let the Stream go: the next ask has nothing to show, and any connection
    /// the worker held is released.
    fn disarm(&self);

    /// The still of the moment `at`, in seconds from the Stream's start, where
    /// one can be had.
    fn preview(&self, at: f64) -> Option<Frame>;
}

/// A Host with no previewer: every ask is answered with nothing.
///
/// What a test gets when it does not name one, and what a Host whose platform
/// cannot preview is. A preview is decoration, so its absence is not a failure
/// and nothing else changes (ADR-0028).
#[derive(Debug, Default)]
pub struct NoPreviewer;

impl Previewer for NoPreviewer {
    fn arm(&self, _url: &StreamUrl) {}

    fn disarm(&self) {}

    fn preview(&self, _at: f64) -> Option<Frame> {
        None
    }
}

/// A [`Previewer`] a test drives by hand: it records what it was armed with, and
/// makes a still per bucket without a player.
///
/// The fake the seam is tested against: a Question's answer, the cache's own
/// rule — a bucket asked for twice is one capture — and the arm/disarm a
/// Stream's open and stop ask for are all driven without mpv. A test that
/// reaches for the real previewer has to say so.
#[derive(Debug, Default)]
pub struct FixturePreviewer {
    armed: Mutex<Option<String>>,
    armings: Mutex<Vec<String>>,
    disarms: Mutex<usize>,
    cache: Mutex<PreviewCache>,
    /// Which Stream is armed, counted: a still of one Stream is not a still of
    /// another, and this is the fake's whole way of saying so.
    generation: Mutex<u64>,
    asks: Mutex<usize>,
    captures: Mutex<usize>,
    refusing: Mutex<bool>,
}

impl FixturePreviewer {
    /// A previewer that answers a still for every bucket.
    pub fn new() -> Self {
        Self::default()
    }

    /// Answer nothing, for the paths where the worker cannot produce a still.
    pub fn refusing(self) -> Self {
        *self
            .refusing
            .lock()
            .expect("the fixture previewer is not poisoned") = true;
        self
    }

    /// Every URL the Host armed, in order.
    pub fn armings(&self) -> Vec<String> {
        self.armings
            .lock()
            .expect("the fixture previewer is not poisoned")
            .clone()
    }

    /// The URL the previewer is holding, where it is armed.
    pub fn armed(&self) -> Option<String> {
        self.armed
            .lock()
            .expect("the fixture previewer is not poisoned")
            .clone()
    }

    /// How many times the Host let the Stream go.
    pub fn disarms(&self) -> usize {
        *self
            .disarms
            .lock()
            .expect("the fixture previewer is not poisoned")
    }

    /// How many stills were asked for.
    pub fn asks(&self) -> usize {
        *self
            .asks
            .lock()
            .expect("the fixture previewer is not poisoned")
    }

    /// How many stills were *made* — one per bucket, the way a real capture is
    /// one seek. A second ask for a bucket leaves this where it was.
    pub fn captures(&self) -> usize {
        *self
            .captures
            .lock()
            .expect("the fixture previewer is not poisoned")
    }

    /// The still this fake makes for a bucket: unlike a real one, it is a
    /// function of the bucket and of which Stream is armed, so two buckets are
    /// two pictures and so are two Streams.
    fn still(generation: u64, bucket: u64) -> Frame {
        Frame::jpeg(format!("still of bucket {bucket} of stream {generation}").as_bytes())
    }
}

impl Previewer for FixturePreviewer {
    fn arm(&self, url: &StreamUrl) {
        *self
            .armed
            .lock()
            .expect("the fixture previewer is not poisoned") = Some(url.as_str().to_owned());
        *self
            .generation
            .lock()
            .expect("the fixture previewer is not poisoned") += 1;
        self.armings
            .lock()
            .expect("the fixture previewer is not poisoned")
            .push(url.as_str().to_owned());
        // A new Stream's stills are not the last one's.
        self.cache
            .lock()
            .expect("the fixture previewer is not poisoned")
            .clear();
    }

    fn disarm(&self) {
        *self
            .armed
            .lock()
            .expect("the fixture previewer is not poisoned") = None;
        *self
            .disarms
            .lock()
            .expect("the fixture previewer is not poisoned") += 1;
        self.cache
            .lock()
            .expect("the fixture previewer is not poisoned")
            .clear();
    }

    fn preview(&self, at: f64) -> Option<Frame> {
        *self
            .asks
            .lock()
            .expect("the fixture previewer is not poisoned") += 1;
        if *self
            .refusing
            .lock()
            .expect("the fixture previewer is not poisoned")
        {
            return None;
        }
        if self
            .armed
            .lock()
            .expect("the fixture previewer is not poisoned")
            .is_none()
        {
            return None;
        }

        let bucket = bucket_of(at);
        let generation = *self
            .generation
            .lock()
            .expect("the fixture previewer is not poisoned");
        let mut cache = self
            .cache
            .lock()
            .expect("the fixture previewer is not poisoned");
        if let Some(frame) = cache.get(bucket) {
            return Some(frame);
        }

        let frame = Self::still(generation, bucket);
        cache.keep(bucket, frame.clone());
        *self
            .captures
            .lock()
            .expect("the fixture previewer is not poisoned") += 1;
        Some(frame)
    }
}

/// A preview's own refusal: a moment that is not a number of seconds the Host
/// will ask about.
///
/// A separate refusal from the seek's because it says a different thing: a seek
/// that is not a number cannot move playback, and a preview that is not one is a
/// question the Host will not put to a worker.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, thiserror::Error)]
#[error("{seconds:?} is not a moment of a Stream to take a still of")]
pub struct InvalidPreviewAt {
    /// The value offered, as the words a refusal can carry: a `NaN` has no place
    /// in any other JSON.
    pub seconds: String,
}

/// The moment a preview asks about, or why the Host will not take a still of it.
///
/// A moment of a Stream is a finite number of seconds from its start; a negative
/// one, a `NaN` and an infinity name no moment anything could seek to.
pub fn checked_preview_at(at: f64) -> Result<f64, InvalidPreviewAt> {
    if at.is_finite() && at >= 0.0 {
        Ok(at)
    } else {
        Err(InvalidPreviewAt {
            seconds: at.to_string(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn statistics(bitrate: Option<u64>) -> Statistics {
        Statistics {
            bitrate,
            dropped_frames: None,
            hardware_decode: None,
        }
    }

    fn stream(raw: &str) -> StreamUrl {
        StreamUrl::parse(raw).expect("a Stream URL")
    }

    #[test]
    fn a_bucket_is_five_seconds_from_the_streams_start() {
        assert_eq!(bucket_of(0.0), 0);
        assert_eq!(bucket_of(4.999), 0);
        assert_eq!(bucket_of(5.0), 1, "a bucket begins where the last ends");
        assert_eq!(bucket_of(42.0), 8);
        assert_eq!(
            bucket_of(42.9),
            8,
            "the whole bucket answers a moment in it"
        );

        assert_eq!(bucket_start(0), 0.0);
        assert_eq!(
            bucket_start(8),
            40.0,
            "a bucket is sought to where it starts"
        );
    }

    #[test]
    fn a_moment_before_the_start_is_the_first_bucket() {
        // Validation refuses these before a worker sees them; the arithmetic
        // still has to be total, because it is called from a seam.
        assert_eq!(bucket_of(-1.0), 0);
        assert_eq!(bucket_of(f64::NAN), 0);
        assert_eq!(bucket_of(f64::INFINITY), 0, "an infinity names no moment");
    }

    #[test]
    fn a_still_is_a_jpeg_data_url_a_client_can_draw() {
        let frame = Frame::jpeg(&[0xff, 0xd8, 0xff]);

        assert!(
            frame.image().starts_with("data:image/jpeg;base64,"),
            "the image is one an <img> takes as it is: {}",
            frame.image()
        );
        let encoded = frame.image().trim_start_matches("data:image/jpeg;base64,");
        assert_eq!(
            base64::engine::general_purpose::STANDARD
                .decode(encoded)
                .expect("the still's own bytes"),
            vec![0xff, 0xd8, 0xff]
        );
        assert!(
            format!("{frame:?}").contains("chars"),
            "a failure never dumps the picture: {frame:?}"
        );
    }

    #[test]
    fn a_stream_keeps_two_hundred_stills_and_the_oldest_leaves_first() {
        let mut cache = PreviewCache::default();
        for bucket in 0..PREVIEW_CACHE_FRAMES as u64 + 10 {
            cache.keep(bucket, Frame::jpeg(&bucket.to_le_bytes()));
        }

        assert_eq!(cache.len(), PREVIEW_CACHE_FRAMES);
        assert!(
            cache.get(0).is_none(),
            "the first still is the one an overflowing cache drops"
        );
        assert!(
            cache.get(PREVIEW_CACHE_FRAMES as u64 + 9).is_some(),
            "the newest still is kept"
        );
    }

    #[test]
    fn a_still_that_is_looked_at_again_is_not_the_next_one_dropped() {
        let mut cache = PreviewCache::default();
        for bucket in 0..PREVIEW_CACHE_FRAMES as u64 {
            cache.keep(bucket, Frame::jpeg(&bucket.to_le_bytes()));
        }

        // Looking at the first still keeps it recent, so the second is the
        // oldest when one more arrives.
        assert!(cache.get(0).is_some());
        cache.keep(999, Frame::jpeg(b"new"));

        assert!(cache.get(0).is_some(), "a still just looked at is kept");
        assert!(cache.get(1).is_none(), "the least recently used one left");
    }

    #[test]
    fn a_known_bitrate_at_or_under_the_ceiling_may_be_previewed() {
        assert_eq!(
            preview_ceiling(Some(&statistics(Some(8_000_000))), false),
            PreviewCeiling::Affordable
        );
        assert_eq!(
            preview_ceiling(Some(&statistics(Some(PREVIEW_CEILING_BPS))), false),
            PreviewCeiling::Affordable,
            "the ceiling itself is still affordable"
        );
    }

    #[test]
    fn a_bitrate_over_the_ceiling_is_never_previewed() {
        assert_eq!(
            preview_ceiling(Some(&statistics(Some(PREVIEW_CEILING_BPS + 1))), false),
            PreviewCeiling::Refused
        );
        assert!(!PreviewCeiling::Refused.affordable());
    }

    #[test]
    fn a_bitrate_that_nobody_states_is_given_a_moment_and_then_refused() {
        assert_eq!(
            preview_ceiling(Some(&statistics(None)), false),
            PreviewCeiling::Waiting,
            "a file that has only just loaded has not said what it costs yet"
        );
        assert_eq!(
            preview_ceiling(Some(&statistics(None)), true),
            PreviewCeiling::Refused,
            "a Stream that still will not say is not one to gamble on"
        );
        assert_eq!(
            preview_ceiling(Some(&statistics(Some(0))), true),
            PreviewCeiling::Refused,
            "a zero is a rate nobody stated, not a free Stream"
        );
    }

    #[test]
    fn a_player_that_has_not_reported_yet_leaves_the_ceiling_waiting() {
        assert_eq!(preview_ceiling(None, false), PreviewCeiling::Waiting);
        assert_eq!(
            preview_ceiling(None, true),
            PreviewCeiling::Waiting,
            "no report at all is not an unknown bitrate: there is nothing loaded to ask about"
        );
    }

    #[test]
    fn the_fixture_answers_a_bucket_once_and_serves_the_second_ask_from_memory() {
        let previewer = FixturePreviewer::new();
        previewer.arm(&stream("https://stream.example.org/a.mkv"));

        let first = previewer.preview(42.0).expect("a still");
        let second = previewer.preview(43.0).expect("the same bucket's still");

        assert_eq!(first, second, "43 s is the same bucket as 42 s");
        assert_eq!(previewer.asks(), 2);
        assert_eq!(
            previewer.captures(),
            1,
            "a second ask for a bucket is served without a capture"
        );

        let other = previewer.preview(50.0).expect("another bucket");
        assert_ne!(
            first, other,
            "two buckets are two moments, and two pictures"
        );
        assert_eq!(previewer.captures(), 2);
    }

    #[test]
    fn an_unarmed_previewer_has_nothing_to_show() {
        let previewer = FixturePreviewer::new();

        assert_eq!(previewer.preview(10.0), None);
        assert_eq!(previewer.captures(), 0, "nothing is captured unarmed");
    }

    #[test]
    fn arming_a_stream_forgets_the_last_streams_stills() {
        let previewer = FixturePreviewer::new();
        previewer.arm(&stream("https://stream.example.org/a.mkv"));
        let first = previewer.preview(10.0).expect("a still");

        previewer.arm(&stream("https://stream.example.org/b.mkv"));
        let second = previewer.preview(10.0).expect("the new Stream's still");

        assert_ne!(
            first, second,
            "a still of one Stream is not a still of another"
        );
        assert_eq!(
            previewer.armed().as_deref(),
            Some("https://stream.example.org/b.mkv")
        );
    }

    #[test]
    fn a_previewer_that_cannot_answer_says_nothing_rather_than_failing() {
        let previewer = FixturePreviewer::new().refusing();
        previewer.arm(&stream("https://stream.example.org/a.mkv"));

        assert_eq!(previewer.preview(10.0), None);
        assert_eq!(previewer.captures(), 0);
    }

    #[test]
    fn a_moment_is_a_finite_number_of_seconds_from_the_start() {
        assert_eq!(checked_preview_at(0.0), Ok(0.0));
        assert_eq!(checked_preview_at(42.5), Ok(42.5));

        for refused in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, -1.0] {
            let error = checked_preview_at(refused).expect_err("not a moment");
            assert_eq!(error.seconds, refused.to_string());
        }
    }
}
