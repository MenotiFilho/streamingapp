//! Watch progress, and the library every client reads it from.
//!
//! Two things live here, and they are two halves of one feature (#29).
//!
//! **Watch progress** is where the Host is in a Video: the position it last
//! wrote down, how long the Stream was, whether the Video counts as watched, and
//! when it wrote that down. It is recorded from the position the Host already
//! publishes — the Player is sampled, and what it reports is folded in — and it
//! is stored, so a Host that is killed mid-Stream comes back knowing where it
//! was. Playback itself is not stored (ADR-0013): what survives is the progress,
//! not the Stream.
//!
//! **The library** is what a client sees of it: a [`ResumeEntry`] per Video,
//! carrying the Video and enough of its Title to draw a card without opening it.
//! The card is what the client was reading when it pressed play — a Title is a
//! client's own business (ADR-0005), so the Host is *told* which Title a Video
//! belongs to rather than working it out from an Addon — and the Addon that
//! supplied it is what a removed Addon is judged against: an entry whose Addon
//! is gone stays listed, marked unplayable, rather than vanishing.
//!
//! ## Finished is a moment, not a state
//!
//! A Video counts as watched when playback reaches its end *or* stops within
//! [`FINISHED_TAIL`] seconds of it. That is deliberate: a Stream that is killed
//! at the credits, or that ends just before mpv would say so, is finished by any
//! account, and an entry that stayed "partly watched" at 99.8% would offer a
//! resume point two seconds from the end. The tail is a named constant so the
//! rule has one place, and a test at its boundary.

use serde::{Deserialize, Serialize};

use crate::addon::{AddonId, MAX_STRING_LEN};
use crate::meta::Video;
use crate::request::{TitleRef, VideoRef};

/// How near a Stream's end counts as having watched it, in seconds.
///
/// The last of a Stream, not a fraction of it: a person who stops in the credits
/// has watched the thing, and the tail is short enough that "partly watched"
/// still means what it says.
pub const FINISHED_TAIL: f64 = 30.0;

/// How far playback must move before the stored position is rewritten.
///
/// The Player is sampled four times a second, and every one of those is a
/// position the Host publishes; a store write four times a second would be a
/// database ground down by its own player. Five seconds is finer than a resume
/// point needs to be and coarse enough that an unclean exit loses at most that
/// much — which is the trade #29's checklist is about.
pub const PROGRESS_EVERY: f64 = 5.0;

/// The Title a client was reading when it pressed play, as the client sends it
/// back: the raw shape, judged by [`TitleStub::parse`] before anything stores it.
///
/// A Title is the client's own (ADR-0005): the Host was not asked for it, it is
/// not in the Stream, and the Addon that supplied it is not necessarily the one
/// the Stream came from. So the client that opened it hands back the least of it
/// a card is drawn from, and the Host keeps that rather than re-asking an Addon
/// — which is also what lets the library work with no network at all.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TitleCard {
    /// The Addon the client opened the Title from, or `None` for a Discovered
    /// Title: one TMDB named and no Addon did, which has no Addon to judge a
    /// removal against (ADR-0020). Held as an `AddonId`, which is the type that
    /// judges it, so a card can only ever name a real one.
    pub addon: Option<AddonId>,
    /// The id the Addon indexes the Title by: `tt0903747` for its episodes too.
    pub id: String,
    /// The Title's content type: `movie`, `series`, …
    #[serde(rename = "type")]
    pub r#type: String,
    /// What the Title is called.
    pub name: String,
    /// The Title's poster, where the Addon gave one.
    pub poster: Option<String>,
}

/// The least of a Title a library card is drawn from — judged.
///
/// Valid by construction: [`TitleStub::parse`] is the only way to make one, and
/// it refuses a Title whose type and id are not ones a request could name. The
/// words are bounded the way every word that travels to a client is: a name too
/// long to hold falls back to the id, and a poster that is not one is dropped.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TitleStub {
    addon: Option<AddonId>,
    id: String,
    #[serde(rename = "type")]
    r#type: String,
    name: String,
    poster: Option<String>,
}

impl TitleStub {
    /// The stub for a card, or why the Title it names is not one the Host will
    /// key anything by.
    pub fn parse(card: &TitleCard) -> Result<Self, crate::request::InvalidTitleRef> {
        let title = TitleRef::parse(&card.r#type, &card.id)?;

        Ok(Self {
            addon: card.addon.clone(),
            id: title.id,
            r#type: title.r#type,
            name: held(&card.name).unwrap_or_else(|| card.id.clone()),
            poster: held(&card.poster.clone().unwrap_or_default()),
        })
    }

    /// The Addon the Title came from — what a removed Addon is judged against —
    /// or `None` for a Discovered Title, which none supplied (ADR-0020).
    pub fn addon(&self) -> Option<&AddonId> {
        self.addon.as_ref()
    }

    /// The id the Addon indexes the Title by.
    pub fn id(&self) -> &str {
        &self.id
    }

    /// The Title's content type: `movie`, `series`, …
    pub fn r#type(&self) -> &str {
        &self.r#type
    }

    /// What the Title is called — the id, where the name could not be held.
    pub fn name(&self) -> &str {
        &self.name
    }

    /// The Title's poster, where it had one the Host will hold.
    pub fn poster(&self) -> Option<&str> {
        self.poster.as_deref()
    }
}

/// One Video's Watch progress, as the Host stores it.
///
/// Keyed by the Video — one entry per Video, and the unit the spec names for it
/// — and carrying the Title it belongs to so the library can draw a card without
/// opening anything. `updated_at` is not published: it is what orders the entry
/// and what #30's merge resolves two writes by, not something a client reads.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WatchProgress {
    /// The Video this is progress in, by the type and id it is keyed by.
    pub video: VideoRef,
    /// The Title it belongs to, for the card.
    pub title: TitleStub,
    /// Where to resume, in seconds from the Stream's start.
    pub position: Option<f64>,
    /// How long the Stream is, where the Stream said — a live Stream does not.
    pub duration: Option<f64>,
    /// Whether the Video counts as watched: at its end, or within
    /// [`FINISHED_TAIL`] of it.
    pub watched: bool,
    /// When this was last written, in milliseconds since the Unix epoch.
    pub updated_at: i64,
}

impl WatchProgress {
    /// A Video just started at `position`: nothing is known about the new Stream
    /// yet, so the duration starts out unknown and arrives with the Player's
    /// first report, and the Video is not watched until it finishes again.
    pub fn starting(video: VideoRef, title: TitleStub, position: Option<f64>, at: i64) -> Self {
        Self {
            video,
            title,
            position,
            duration: None,
            watched: false,
            updated_at: at,
        }
    }

    /// The same entry with where playback is now, as the Host's own record has
    /// it. A duration the Host does not know yet leaves the one that was known;
    /// `watched` never goes back on its own — only a fresh start unmarks it.
    pub fn playing(&self, position: Option<f64>, duration: Option<f64>, at: i64) -> Self {
        let position = position.or(self.position);
        let duration = duration.or(self.duration);
        let watched = self.watched
            || position
                .zip(duration)
                .is_some_and(|(at, of)| finished(at, of));

        Self {
            video: self.video.clone(),
            title: self.title.clone(),
            position,
            duration,
            watched,
            updated_at: at,
        }
    }

    /// Whether this write is worth making: the entry is new, the Video just
    /// finished, or playback has moved [`PROGRESS_EVERY`] seconds since the last
    /// write. A tick that moved a quarter of a second is not one.
    pub fn worth_writing(&self, stored: &Self) -> bool {
        if self.watched != stored.watched || self.duration != stored.duration {
            return true;
        }

        match (self.position, stored.position) {
            (Some(now), Some(then)) => (now - then).abs() >= PROGRESS_EVERY,
            (Some(_), None) => true,
            (None, _) => false,
        }
    }

    /// The entry as every client is told it, given whether the Addon that
    /// supplied its Title — where one did — is still configured.
    ///
    /// The stub is a mark and not a hiding: an entry whose Addon is gone is
    /// published exactly as it was, with [`UnplayableEntry`] saying why it cannot
    /// be played now. An entry with **no** Addon behind it — a Discovered Title —
    /// has no removal to judge and is never marked (ADR-0020).
    pub fn resume_entry(&self, addon_held: bool) -> ResumeEntry {
        ResumeEntry {
            video: Video::keyed(&self.video.id),
            title: self.title.clone(),
            position: self.position,
            duration: self.duration,
            watched: self.watched,
            unplayable: self
                .title
                .addon()
                .filter(|_| !addon_held)
                .map(|addon| UnplayableEntry {
                    reason: UnplayableReason::AddonRemoved,
                    addon: addon.clone(),
                }),
        }
    }
}

/// Whether a Stream at `position` of `duration` has been watched.
pub fn finished(position: f64, duration: f64) -> bool {
    duration > 0.0 && position + FINISHED_TAIL >= duration
}

/// One Video with Watch progress, as every client is told it: a card's worth of
/// the Video and its Title, where it was left, and whether it can be played now.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResumeEntry {
    /// The Video, named by the id it is keyed by and the season and episode that
    /// id carries.
    pub video: Video,
    /// The Title it belongs to, enough to draw a card without opening it.
    pub title: TitleStub,
    /// Where it was left, in seconds from the Stream's start, or `None` where
    /// playback never got far enough to say.
    pub position: Option<f64>,
    /// How long the Stream is, where it said.
    pub duration: Option<f64>,
    /// Whether the Video counts as watched: at its end, or within
    /// [`FINISHED_TAIL`] of it.
    pub watched: bool,
    /// Why this entry cannot be played now, or `None` when it can.
    pub unplayable: Option<UnplayableEntry>,
}

/// Why a library entry is not one the Host will play.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UnplayableEntry {
    pub reason: UnplayableReason,
    /// The Addon that is no longer configured.
    pub addon: AddonId,
}

/// The reasons a library entry is marked unplayable.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UnplayableReason {
    /// The Addon that supplied the Title is no longer configured, so the Host
    /// cannot ask it again — and the entry stays listed rather than vanishing.
    AddonRemoved,
}

/// A word a client sent, kept only where it is one the Host will hold and
/// publish: non-empty, short enough, and free of control characters.
fn held(word: &str) -> Option<String> {
    if word.is_empty() || word.len() > MAX_STRING_LEN || word.chars().any(char::is_control) {
        return None;
    }
    Some(word.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn addon() -> AddonId {
        AddonId::parse("com.linvo.cinemeta").expect("an Addon id")
    }

    fn video(r#type: &str, id: &str) -> VideoRef {
        VideoRef::parse(r#type, id).expect("a Video a request could name")
    }

    fn card(name: &str) -> TitleCard {
        TitleCard {
            addon: Some(addon()),
            id: "tt0903747".to_owned(),
            r#type: "series".to_owned(),
            name: name.to_owned(),
            poster: Some("https://images.example.org/bb.jpg".to_owned()),
        }
    }

    fn stub() -> TitleStub {
        TitleStub::parse(&card("Breaking Bad")).expect("a card the Host will keep")
    }

    fn progress() -> WatchProgress {
        WatchProgress {
            video: video("series", "tt0903747:1:2"),
            title: stub(),
            position: Some(402.0),
            duration: Some(2820.0),
            watched: false,
            updated_at: 1_000,
        }
    }

    #[test]
    fn a_card_is_kept_as_the_least_of_a_title_a_card_is_drawn_from() {
        let stub = stub();

        assert_eq!(
            stub.addon().map(AddonId::as_str),
            Some("com.linvo.cinemeta")
        );
        assert_eq!(stub.id(), "tt0903747");
        assert_eq!(stub.r#type(), "series");
        assert_eq!(stub.name(), "Breaking Bad");
        assert_eq!(stub.poster(), Some("https://images.example.org/bb.jpg"));
    }

    #[test]
    fn a_title_with_no_addon_keeps_no_addon_and_is_never_marked_removed() {
        // A Discovered Title has no Addon to lose: `addon_removed` is a mark
        // about an Addon that is gone, and there is none to be gone (ADR-0020).
        let stub = TitleStub::parse(&TitleCard {
            addon: None,
            id: "tmdb:1396".to_owned(),
            r#type: "series".to_owned(),
            name: "Breaking Bad".to_owned(),
            poster: None,
        })
        .expect("a Discovered Title is one the Host will key by its own id");

        assert_eq!(stub.addon(), None);

        let entry = WatchProgress {
            video: video("series", "tmdb:1396:1:1"),
            title: stub.clone(),
            position: Some(120.0),
            duration: Some(2820.0),
            watched: false,
            updated_at: 1_000,
        };
        assert_eq!(
            entry.resume_entry(false).unplayable,
            None,
            "there is no removed Addon where there was no Addon"
        );

        let was_the_addons = WatchProgress {
            title: TitleStub::parse(&card("Breaking Bad")).expect("a card the Host will keep"),
            ..entry
        };
        assert!(
            matches!(
                was_the_addons.resume_entry(false).unplayable,
                Some(UnplayableEntry {
                    reason: UnplayableReason::AddonRemoved,
                    ..
                })
            ),
            "a Title that did have an Addon keeps the mark when it is gone"
        );
        assert_eq!(was_the_addons.resume_entry(true).unplayable, None);
    }

    #[test]
    fn a_card_that_names_no_title_a_request_could_name_is_refused() {
        for broken in [
            TitleCard {
                id: String::new(),
                ..card("One")
            },
            TitleCard {
                r#type: "ser ies".to_owned(),
                ..card("One")
            },
        ] {
            assert!(
                TitleStub::parse(&broken).is_err(),
                "{broken:?} names no Title the Host will key anything by"
            );
        }
    }

    #[test]
    fn a_name_or_a_poster_the_host_will_not_hold_falls_back_rather_than_fails() {
        // The id stands in for a name that cannot be held, the way a Title with
        // no name is named by its id, and a poster that is not one is no poster.
        let stub = TitleStub::parse(&TitleCard {
            name: String::new(),
            poster: Some("\u{0}".to_owned()),
            ..card("One")
        })
        .expect("the Title is still one the Host will key by");

        assert_eq!(stub.name(), "tt0903747");
        assert_eq!(stub.poster(), None);
    }

    #[test]
    fn a_video_is_named_by_the_season_and_episode_its_id_carries() {
        assert_eq!(
            Video::keyed("tt0903747:1:2"),
            Video {
                id: "tt0903747:1:2".to_owned(),
                name: None,
                season: Some(1),
                episode: Some(2),
                thumbnail: None,
            }
        );
        assert_eq!(
            Video::keyed("kitsu:12345:0:1"),
            Video {
                id: "kitsu:12345:0:1".to_owned(),
                name: None,
                season: Some(0),
                episode: Some(1),
                thumbnail: None,
            },
            "a title id is not always one part, so the numbers read from the right"
        );
        assert_eq!(
            Video::keyed("tt0133093"),
            Video {
                id: "tt0133093".to_owned(),
                name: None,
                season: None,
                episode: None,
                thumbnail: None,
            },
            "a film is one Video and carries no episode numbers"
        );
        assert_eq!(
            Video::keyed("tt0903747:1"),
            Video {
                id: "tt0903747:1".to_owned(),
                name: None,
                season: None,
                episode: None,
                thumbnail: None,
            },
            "two numbers are what an episode is; one is not one"
        );
    }

    #[test]
    fn a_stream_at_its_end_or_within_the_last_moments_of_it_is_watched() {
        assert!(finished(2820.0, 2820.0), "the end is finished");
        assert!(finished(2790.0, 2820.0), "the last thirty seconds are");
        assert!(
            !finished(2789.0, 2820.0),
            "a second earlier is a resume point, not a finished Video"
        );
        assert!(
            !finished(0.0, 0.0),
            "a Stream with no stated length is not finished"
        );
        assert!(!finished(600.0, 3600.0));
    }

    #[test]
    fn starting_an_entry_places_it_at_the_resume_point_and_unmarks_it() {
        let watched = WatchProgress {
            watched: true,
            position: Some(2820.0),
            duration: Some(2820.0),
            ..progress()
        };

        let started = WatchProgress::starting(
            watched.video.clone(),
            watched.title.clone(),
            Some(120.0),
            2_000,
        );

        assert_eq!(started.position, Some(120.0));
        assert_eq!(
            started.duration, None,
            "the new Stream's length is not known yet"
        );
        assert!(
            !started.watched,
            "a Video being rewatched is not finished yet"
        );
    }

    #[test]
    fn playing_moves_the_position_forward_and_finishes_at_the_end() {
        let entry = progress();

        let moved = entry.playing(Some(900.0), Some(2820.0), 2_000);
        assert_eq!(moved.position, Some(900.0));
        assert!(!moved.watched);

        let done = entry.playing(Some(2810.0), Some(2820.0), 3_000);
        assert!(done.watched);
        assert_eq!(done.updated_at, 3_000);
    }

    #[test]
    fn a_duration_the_host_does_not_know_yet_does_not_erase_the_one_it_had() {
        let entry = progress();

        let moved = entry.playing(Some(500.0), None, 2_000);

        assert_eq!(moved.duration, Some(2820.0));
    }

    #[test]
    fn a_write_is_worth_it_only_when_something_moved() {
        let stored = progress();

        assert!(
            !stored
                .playing(Some(403.0), Some(2820.0), 1_250)
                .worth_writing(&stored),
            "a quarter of a second is not a resume point"
        );
        assert!(
            stored
                .playing(Some(408.0), Some(2820.0), 1_250)
                .worth_writing(&stored),
            "five seconds is"
        );
        assert!(
            stored
                .playing(Some(2810.0), Some(2820.0), 1_250)
                .worth_writing(&stored),
            "finishing is worth a write however little the position moved"
        );
        let unknown_length = WatchProgress {
            duration: None,
            position: Some(12.0),
            ..progress()
        };
        assert!(
            unknown_length
                .playing(Some(12.0), Some(2820.0), 1_250)
                .worth_writing(&unknown_length),
            "the duration arriving for the first time is worth a write"
        );
    }

    #[test]
    fn an_entry_whose_addon_is_gone_is_published_as_a_stub_rather_than_hidden() {
        let entry = progress();

        let playable = entry.resume_entry(true);
        assert_eq!(playable.unplayable, None);
        assert_eq!(playable.video.season, Some(1));
        assert_eq!(playable.video.episode, Some(2));

        let stub = entry.resume_entry(false);
        assert_eq!(
            stub.unplayable,
            Some(UnplayableEntry {
                reason: UnplayableReason::AddonRemoved,
                addon: addon(),
            })
        );
        assert_eq!(stub.title.name(), "Breaking Bad");

        let published = serde_json::to_value(&stub).expect("an entry serializes");
        assert_eq!(
            published["unplayable"],
            serde_json::json!({ "reason": "addon_removed", "addon": "com.linvo.cinemeta" })
        );
        assert_eq!(published["title"]["type"], "series");
        assert_eq!(
            published["updatedAt"],
            serde_json::Value::Null,
            "when it was written is the Host's own bookkeeping and never travels"
        );
    }
}
