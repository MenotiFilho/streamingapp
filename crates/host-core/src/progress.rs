//! Watch progress, and the Continue watching row built from it.
//!
//! **Watch progress** is where the Host is in a Video: the position it last
//! wrote down, how long the Stream was, whether the Video counts as watched, and
//! when it wrote that down. It is recorded from the position the Host already
//! publishes — the Player is sampled, and what it reports is folded in — and it
//! is stored, so a Host that is killed mid-Stream comes back knowing where it
//! was. Playback itself is not stored (ADR-0013): what survives is the progress,
//! not the Stream.
//!
//! **Continue watching** is what a client sees of it: one [`ContinueEntry`] per
//! Title, carrying the Video that Title played last — the card — and enough of
//! its Title to draw it without opening anything (#273). A Title is a client's
//! own business (ADR-0005), so the Host is *told* which Title a Video belongs to
//! rather than working it out from an Addon — and the Addon that supplied it is
//! what a removed Addon is judged against: an entry whose Addon is gone stays
//! listed, marked unplayable, rather than vanishing.
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
use crate::meta::{next_video, Video};
use crate::request::{TitleRef, VideoRef};
use crate::title_cache::{CachedTitle, TitleProbe};

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
/// — which is also what lets Continue watching work with no network at all.
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
    /// The Title's backdrop, where the Addon gave one. Continue watching draws
    /// 16:9 cards, and the poster beside it is portrait.
    pub background: Option<String>,
    /// The Title's wordmark, where the Addon or TMDB gave one. Continue
    /// watching Wide cards and the Opening surface draw it offline
    /// (ADR-0044 §7).
    #[serde(default)]
    pub logo: Option<String>,
}

/// The least of a Title a Continue watching card is drawn from — judged.
///
/// Valid by construction: [`TitleStub::parse`] is the only way to make one, and
/// it refuses a Title whose type and id are not ones a request could name. The
/// words are bounded the way every word that travels to a client is: a name too
/// long to hold falls back to the id, and a poster, backdrop or logo that is
/// not one is dropped.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TitleStub {
    addon: Option<AddonId>,
    id: String,
    #[serde(rename = "type")]
    r#type: String,
    name: String,
    poster: Option<String>,
    background: Option<String>,
    #[serde(default)]
    logo: Option<String>,
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
            poster: held(card.poster.as_deref().unwrap_or_default()),
            background: held(card.background.as_deref().unwrap_or_default()),
            logo: held(card.logo.as_deref().unwrap_or_default()),
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

    /// The Title's backdrop, where it had one the Host will hold: the 16:9 art
    /// Continue watching draws, where the poster beside it is portrait.
    pub fn background(&self) -> Option<&str> {
        self.background.as_deref()
    }

    /// The Title's wordmark, where it had one the Host will hold: drawn on
    /// Continue watching Wide cards and on the Opening surface offline
    /// (ADR-0044 §7).
    pub fn logo(&self) -> Option<&str> {
        self.logo.as_deref()
    }
}

/// One Video's Watch progress, as the Host stores it.
///
/// Keyed by the Video — one entry per Video, and the unit the spec names for it
/// — and carrying the Title it belongs to so Continue watching can draw the
/// Title's card without opening anything. `updated_at` is not published: it is
/// what orders the card that Title shows and what #30's merge resolves two
/// writes by, not something a client reads.
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
    /// The Addon whose Stream was playing this Video, where one played it.
    ///
    /// Read back by Playing Up next, which continues the release: the Addon and
    /// the `bingeGroup` are what make the Up next the same release rather than
    /// an unrelated candidate (ADR-0012, ADR-0014). `None` for an entry written
    /// before this field existed and for a position merged in from the Stremio
    /// account, neither of which saw a Stream.
    pub stream_addon: Option<AddonId>,
    /// The release the Stream was binge-grouped by, where its Addon said — the
    /// other half of the continuity Playing Up next continues.
    pub binge_group: Option<String>,
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
            stream_addon: None,
            binge_group: None,
            updated_at: at,
        }
    }

    /// The same entry, with the Stream it is playing chosen from `addon` and
    /// binge-grouped as `binge_group`: what Playing Up next continues from.
    #[must_use]
    pub fn streamed_by(mut self, addon: AddonId, binge_group: Option<String>) -> Self {
        self.stream_addon = Some(addon);
        self.binge_group = binge_group;
        self
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
            stream_addon: self.stream_addon.clone(),
            binge_group: self.binge_group.clone(),
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

    /// The entry as every client is told it, given why the Addon that supplied
    /// its Title — where one did — cannot be asked (`None` when it is configured
    /// and enabled).
    ///
    /// The stub is a mark and not a hiding: an entry whose Addon is gone or
    /// disabled is published exactly as it was, with [`UnplayableEntry`] saying
    /// why it cannot be played now (ADR-0015, ADR-0044 §2). An entry with **no**
    /// Addon behind it — a Discovered Title — has no Addon to judge and is never
    /// marked (ADR-0020).
    pub fn resume_entry(&self, reason: Option<UnplayableReason>) -> ResumeEntry {
        ResumeEntry {
            video: Video::keyed(&self.video.id),
            title: self.title.clone(),
            position: self.position,
            duration: self.duration,
            watched: self.watched,
            unplayable: self.unplayable(reason),
        }
    }

    /// The Title's Continue watching card, where this entry is the Video the
    /// Title played last. The same judgement of a removed or disabled Addon as
    /// [`WatchProgress::resume_entry`].
    pub fn continue_entry(&self, reason: Option<UnplayableReason>) -> ContinueEntry {
        ContinueEntry {
            video: Video::keyed(&self.video.id),
            title: self.title.clone(),
            position: self.position,
            duration: self.duration,
            watched: self.watched,
            up_next: false,
            unplayable: self.unplayable(reason),
        }
    }

    /// Why this entry cannot be played now, or `None` when it can.
    fn unplayable(&self, reason: Option<UnplayableReason>) -> Option<UnplayableEntry> {
        let addon = self.title.addon()?;
        reason.map(|reason| UnplayableEntry {
            reason,
            addon: addon.clone(),
        })
    }
}

/// Whether a Stream at `position` of `duration` has been watched.
pub fn finished(position: f64, duration: f64) -> bool {
    duration > 0.0 && position + FINISHED_TAIL >= duration
}

/// Whether a Title's card has left the row because there is nothing after the
/// Video played last: a caught-up series, watched by its TMDB record from now on
/// (ADR-0038 §5, #277).
///
/// A cached list that does not hold the finished Video proves nothing, so it is
/// not caught-up: the finished Video still stands as the card until the Title is
/// read (#274).
pub(crate) fn caught_up(progress: &[WatchProgress], cached: &[CachedTitle]) -> bool {
    let Some(card) = progress.iter().max_by_key(|entry| entry.updated_at) else {
        return false;
    };
    if !card.watched || card.title.r#type() != "series" {
        return false;
    }
    let Some(videos) = cached_videos(cached, card) else {
        return false;
    };

    next_video(videos, &card.video.id).is_none()
}

/// One Video with Watch progress, as every client is told it: a card's worth of
/// the Video and its Title, where it was left, and whether it can be played now.
///
/// One per Video, which is the unit Watch progress is kept in. The Continue
/// watching row is not this list: it is one card per Title, drawn by
/// [`continue_watching`] below (#273).
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

/// One Title on Continue watching, as every client is told it: the Title's card
/// — the Video it played last, or that Video's Up next once it is finished —
/// with the Title it belongs to, where the card's Video was left, and whether it
/// can be played now.
///
/// One per Title, never one per Video: watching six episodes of a series is six
/// Watch progress entries and one card (#273). Which Video is the card, and
/// whether the Title is on the row at all, is [`continue_watching`]'s decision.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContinueEntry {
    /// The card's Video — the one the Title played last, or its Up next — named
    /// as every Video is.
    pub video: Video,
    /// The Title it belongs to, enough to draw a card without opening it.
    pub title: TitleStub,
    /// Where the card's Video was left, in seconds from the Stream's start, or
    /// `None` where playback never got far enough to say.
    pub position: Option<f64>,
    /// How long the card's Video is, where it said.
    pub duration: Option<f64>,
    /// Whether the card's Video counts as watched: at its end, or within
    /// [`FINISHED_TAIL`] of it.
    pub watched: bool,
    /// Whether the card's Video is the Title's Up next rather than the Video it
    /// played last. An Up next has no progress of its own unless it was already
    /// partly watched, and it is the Video a Title opened from this card is
    /// anchored on (#274, #275).
    pub up_next: bool,
    /// Why this card cannot be played now, or `None` when it can.
    pub unplayable: Option<UnplayableEntry>,
}

/// The Continue watching row: one [`ContinueEntry`] per Title, the Title's card
/// being the Video it played last, or that Video's Up next once it is finished,
/// most recently played first.
///
/// Titles are grouped by type plus id, the way the Title stub carries them; the
/// same series reached under two keys is two Titles and therefore two cards,
/// which is accepted (ADR-0020's hazard).
///
/// `cached` is the Host's cached Titles, and their lists of Videos are what Up
/// next is worked out from — so the row is right offline and after a restart
/// (#274, ADR-0038). A finished Video whose Title is not cached stays on the row
/// marked watched; once the Title is cached the next Snapshot moves it on.
///
/// `addon_unplayable` judges a card's Addon the way the Snapshot does: a card
/// whose Addon is gone or disabled stays listed, marked unplayable with
/// [`UnplayableReason::AddonRemoved`] or [`UnplayableReason::AddonDisabled`].
///
/// A card leaves the row when there is nothing left to continue: a finished
/// film; a series whose finished Video is the last of its numbered episodes or
/// has nothing listed after it; a finished special with no special after it.
/// Watch progress itself is always kept.
pub fn continue_watching(
    progress: &[WatchProgress],
    cached: &[CachedTitle],
    addon_unplayable: impl Fn(&AddonId) -> Option<UnplayableReason>,
) -> Vec<ContinueEntry> {
    let mut cards: Vec<&WatchProgress> = Vec::new();
    for entry in progress {
        match cards.iter_mut().find(|card| same_title(card, entry)) {
            // The latest write is the Title's card. A tie keeps the entry held
            // first, and the list the Host holds is already newest first.
            Some(card) if entry.updated_at > card.updated_at => *card = entry,
            Some(_) => {}
            None => cards.push(entry),
        }
    }

    cards.sort_by_key(|card| std::cmp::Reverse(card.updated_at));

    let mut entries = Vec::new();
    for card in cards {
        if is_finished_film(card) {
            continue;
        }
        let reason = card.title.addon().and_then(&addon_unplayable);

        // A Video still being watched is the card, whatever comes after it.
        if !card.watched {
            entries.push(card.continue_entry(reason));
            continue;
        }

        // A finished Video moves the card on to its Up next in the Title's own
        // cached list (ADR-0039). No cached list is "not known yet", so the
        // finished Video stays; a cached list with nothing after it is a series
        // with nothing left to continue, and the card leaves the row.
        let Some(videos) = cached_videos(cached, card) else {
            entries.push(card.continue_entry(reason));
            continue;
        };
        let Some(next) = next_video(videos, &card.video.id) else {
            continue;
        };
        entries.push(up_next_entry(card, next, progress, reason));
    }
    entries
}

/// The Videos of the cached Title a card names, where the cache holds one that
/// lists the card's own Video.
///
/// The newest matching copy is the truth where the cache holds the same Title
/// under two keys. A copy that does not list the Video cannot say what follows
/// it, so it is not used and the card falls back to the finished Video as
/// watched — an answer that is never wrong, only briefly behind (#274).
fn cached_videos<'a>(cached: &'a [CachedTitle], card: &WatchProgress) -> Option<&'a [Video]> {
    let probe = TitleProbe::from_stub(&card.title);
    cached
        .iter()
        .filter(|held| held.names(&probe))
        .filter(|held| {
            held.title
                .videos
                .iter()
                .any(|video| video.id == card.video.id)
        })
        .max_by_key(|held| held.read_at)
        .map(|held| held.title.videos.as_slice())
}

/// The card a finished Video moves on to: its Up next, carrying that Video's own
/// Watch progress where it was already partly watched (#274).
fn up_next_entry(
    card: &WatchProgress,
    video: &Video,
    progress: &[WatchProgress],
    reason: Option<UnplayableReason>,
) -> ContinueEntry {
    let watched = progress
        .iter()
        .find(|entry| entry.video.id == video.id && entry.video.r#type == card.video.r#type);

    ContinueEntry {
        video: video.clone(),
        title: card.title.clone(),
        position: watched.and_then(|entry| entry.position),
        duration: watched.and_then(|entry| entry.duration),
        watched: watched.is_some_and(|entry| entry.watched),
        up_next: true,
        unplayable: card.unplayable(reason),
    }
}

/// Whether two entries name the same Title: type plus id, as the stub carries
/// the identity a row groups by.
pub(crate) fn same_title(one: &WatchProgress, other: &WatchProgress) -> bool {
    one.title.r#type() == other.title.r#type() && one.title.id() == other.title.id()
}

/// Whether a title stub names the type and id a reference names — the same
/// identity [`same_title`] groups by, for a caller holding a reference rather
/// than a second stub.
pub(crate) fn names(title: &TitleStub, r#type: &str, id: &str) -> bool {
    title.r#type() == r#type && title.id() == id
}

/// Whether this entry is a film that has been watched through: nothing is left
/// to continue, so it leaves the row while its Watch progress stays (#273).
fn is_finished_film(entry: &WatchProgress) -> bool {
    entry.watched && entry.title.r#type() == "movie"
}

/// Why a Continue watching entry is not one the Host will play.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UnplayableEntry {
    pub reason: UnplayableReason,
    /// The Addon that is no longer configured or is switched off.
    pub addon: AddonId,
}

/// The reasons a Continue watching entry is marked unplayable.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UnplayableReason {
    /// The Addon that supplied the Title is no longer configured, so the Host
    /// cannot ask it again — and the entry stays listed rather than vanishing.
    AddonRemoved,
    /// The Addon that supplied the Title is still configured, but switched off
    /// by the owner (ADR-0044 §2). Re-enabling it restores the entry without
    /// re-adding the Addon.
    AddonDisabled,
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
    use crate::meta::{Title, TitleKey};
    use crate::title_cache::TitleSource;

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
            background: Some("https://images.example.org/bb-backdrop.jpg".to_owned()),
            logo: Some("https://images.example.org/bb-logo.png".to_owned()),
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
            stream_addon: None,
            binge_group: None,
            updated_at: 1_000,
        }
    }

    fn episode(id: &str, position: f64, at: i64, watched: bool) -> WatchProgress {
        WatchProgress {
            video: video("series", id),
            title: stub(),
            position: Some(position),
            duration: Some(2820.0),
            watched,
            stream_addon: None,
            binge_group: None,
            updated_at: at,
        }
    }

    fn film(at: i64, watched: bool) -> WatchProgress {
        WatchProgress {
            video: video("movie", "tt0133093"),
            title: TitleStub::parse(&TitleCard {
                addon: Some(addon()),
                id: "tt0133093".to_owned(),
                r#type: "movie".to_owned(),
                name: "The Matrix".to_owned(),
                poster: None,
                background: None,
                logo: None,
            })
            .expect("a film the Host will keep"),
            position: Some(8_000.0),
            duration: Some(8_160.0),
            watched,
            stream_addon: None,
            binge_group: None,
            updated_at: at,
        }
    }

    fn cards(entries: &[WatchProgress]) -> Vec<ContinueEntry> {
        continue_watching(entries, &[], |_| None)
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
        assert_eq!(
            stub.background(),
            Some("https://images.example.org/bb-backdrop.jpg"),
            "16:9 Continue watching art rides the card the client handed back"
        );
        assert_eq!(
            stub.logo(),
            Some("https://images.example.org/bb-logo.png"),
            "the Title's wordmark rides the card for Wide cards and Opening (ADR-0044 §7)"
        );
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
            background: None,
            logo: None,
        })
        .expect("a Discovered Title is one the Host will key by its own id");

        assert_eq!(stub.addon(), None);

        let entry = WatchProgress {
            video: video("series", "tmdb:1396:1:1"),
            title: stub.clone(),
            position: Some(120.0),
            duration: Some(2820.0),
            watched: false,
            stream_addon: None,
            binge_group: None,
            updated_at: 1_000,
        };
        assert_eq!(
            entry
                .resume_entry(Some(UnplayableReason::AddonRemoved))
                .unplayable,
            None,
            "there is no removed Addon where there was no Addon"
        );
        assert_eq!(
            entry
                .resume_entry(Some(UnplayableReason::AddonDisabled))
                .unplayable,
            None,
            "there is no disabled Addon where there was no Addon"
        );

        let was_the_addons = WatchProgress {
            title: TitleStub::parse(&card("Breaking Bad")).expect("a card the Host will keep"),
            ..entry
        };
        assert!(
            matches!(
                was_the_addons
                    .resume_entry(Some(UnplayableReason::AddonRemoved))
                    .unplayable,
                Some(UnplayableEntry {
                    reason: UnplayableReason::AddonRemoved,
                    ..
                })
            ),
            "a Title that did have an Addon keeps the mark when it is gone"
        );
        assert!(
            matches!(
                was_the_addons
                    .resume_entry(Some(UnplayableReason::AddonDisabled))
                    .unplayable,
                Some(UnplayableEntry {
                    reason: UnplayableReason::AddonDisabled,
                    ..
                })
            ),
            "a Title that did have an Addon wears the disabled mark when it is switched off"
        );
        assert_eq!(was_the_addons.resume_entry(None).unplayable, None);
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
            background: Some("\u{0}".to_owned()),
            logo: Some("\u{0}".to_owned()),
            ..card("One")
        })
        .expect("the Title is still one the Host will key by");

        assert_eq!(stub.name(), "tt0903747");
        assert_eq!(stub.poster(), None);
        assert_eq!(
            stub.background(),
            None,
            "a backdrop that is not one is not art Continue watching draws"
        );
        assert_eq!(
            stub.logo(),
            None,
            "a logo with control characters is dropped like poster and background"
        );

        let too_long = "https://images.example.org/".to_owned() + &"a".repeat(MAX_STRING_LEN);
        for dropped in [String::new(), too_long] {
            let stub = TitleStub::parse(&TitleCard {
                logo: Some(dropped.clone()),
                ..card("One")
            })
            .expect("the Title is still one the Host will key by");
            assert_eq!(
                stub.logo(),
                None,
                "an empty or overlong logo is dropped: len={}",
                dropped.len()
            );
        }
    }

    #[test]
    fn a_card_and_stub_without_logo_deserialize_cleanly_for_backward_compatibility() {
        let card: TitleCard = serde_json::from_str(
            r#"{"addon":"com.linvo.cinemeta","id":"tt0903747","type":"series","name":"Breaking Bad","poster":null,"background":null}"#,
        )
        .expect("a TitleCard without logo deserializes cleanly");
        assert_eq!(card.logo, None);

        let stub: TitleStub = serde_json::from_str(
            r#"{"addon":"com.linvo.cinemeta","id":"tt0903747","type":"series","name":"Breaking Bad","poster":null,"background":null}"#,
        )
        .expect("a TitleStub without logo deserializes cleanly");
        assert_eq!(stub.logo(), None);
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
                air_date: None,
                description: None,
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
                air_date: None,
                description: None,
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
                air_date: None,
                description: None,
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
                air_date: None,
                description: None,
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

        let playable = entry.resume_entry(None);
        assert_eq!(playable.unplayable, None);
        assert_eq!(playable.video.season, Some(1));
        assert_eq!(playable.video.episode, Some(2));

        let stub = entry.resume_entry(Some(UnplayableReason::AddonRemoved));
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
            published["title"]["background"], "https://images.example.org/bb-backdrop.jpg",
            "the backdrop is published beside the poster it falls back from"
        );
        assert_eq!(
            published["title"]["logo"], "https://images.example.org/bb-logo.png",
            "the wordmark is published beside poster and background (ADR-0044 §7)"
        );
        assert_eq!(
            published["updatedAt"],
            serde_json::Value::Null,
            "when it was written is the Host's own bookkeeping and never travels"
        );

        let disabled = entry.resume_entry(Some(UnplayableReason::AddonDisabled));
        assert_eq!(
            disabled.unplayable,
            Some(UnplayableEntry {
                reason: UnplayableReason::AddonDisabled,
                addon: addon(),
            })
        );
        let published_disabled = serde_json::to_value(&disabled).expect("an entry serializes");
        assert_eq!(
            published_disabled["unplayable"],
            serde_json::json!({ "reason": "addon_disabled", "addon": "com.linvo.cinemeta" })
        );
    }

    #[test]
    fn six_episodes_of_one_series_are_one_card_led_by_the_last_played() {
        let played: Vec<WatchProgress> = (1..=6)
            .map(|n| {
                episode(
                    &format!("tt0903747:1:{n}"),
                    100.0 * f64::from(n),
                    i64::from(n) * 1_000,
                    false,
                )
            })
            .collect();

        let cards = cards(&played);

        assert_eq!(cards.len(), 1, "a series is one card, not six: {cards:?}");
        assert_eq!(cards[0].video.id, "tt0903747:1:6");
        assert_eq!(
            cards[0].position,
            Some(600.0),
            "the card carries the position of the Video played last"
        );
        assert_eq!(cards[0].duration, Some(2820.0));
    }

    #[test]
    fn rewatching_an_earlier_episode_makes_it_the_card() {
        // Watched 1:1, then 1:2, then went back to 1:1: the card follows what
        // was played last, not what is furthest along.
        let cards = cards(&[
            episode("tt0903747:1:1", 100.0, 1_000, false),
            episode("tt0903747:1:2", 200.0, 2_000, false),
            episode("tt0903747:1:1", 300.0, 3_000, false),
        ]);

        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0].video.id, "tt0903747:1:1");
        assert_eq!(cards[0].position, Some(300.0));
    }

    #[test]
    fn two_titles_are_ordered_by_the_latest_play_of_each() {
        let cards = cards(&[
            episode("tt0903747:1:2", 100.0, 3_000, false),
            film(2_000, false),
            episode("tt0903747:1:1", 100.0, 1_000, false),
        ]);

        assert_eq!(
            cards
                .iter()
                .map(|card| card.video.id.as_str())
                .collect::<Vec<_>>(),
            vec!["tt0903747:1:2", "tt0133093"],
            "the series was played after the film, and its old episode does not order it"
        );
    }

    #[test]
    fn a_finished_film_leaves_the_row_and_a_part_watched_one_stays() {
        assert!(
            cards(&[film(1_000, true)]).is_empty(),
            "a finished film has nothing to continue"
        );
        assert_eq!(
            cards(&[film(1_000, false)]).len(),
            1,
            "a film left part-watched is still a card"
        );
    }

    #[test]
    fn a_finished_episode_whose_title_is_not_cached_stays_as_watched() {
        let cards = cards(&[episode("tt0903747:1:1", 2_820.0, 1_000, true)]);

        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0].video.id, "tt0903747:1:1");
        assert!(
            cards[0].watched,
            "with no cached list there is no Up next, so the finished Video stays"
        );
        assert!(!cards[0].up_next);
    }

    #[test]
    fn titles_are_grouped_by_type_and_id_together() {
        let same_id_as_a_film = WatchProgress {
            video: video("movie", "tt0903747"),
            title: TitleStub::parse(&TitleCard {
                addon: Some(addon()),
                id: "tt0903747".to_owned(),
                r#type: "movie".to_owned(),
                name: "A film that shares an id".to_owned(),
                poster: None,
                background: None,
                logo: None,
            })
            .expect("a film the Host will keep"),
            ..episode("tt0903747:1:1", 100.0, 1_000, false)
        };

        let cards = cards(&[
            episode("tt0903747:1:2", 100.0, 2_000, false),
            same_id_as_a_film,
        ]);

        assert_eq!(
            cards.len(),
            2,
            "the same id under two types is two Titles: {cards:?}"
        );
    }

    #[test]
    fn a_card_whose_addon_is_gone_is_listed_and_marked_unplayable() {
        let cards = continue_watching(
            &[episode("tt0903747:1:2", 100.0, 1_000, false)],
            &[],
            |_| Some(UnplayableReason::AddonRemoved),
        );

        assert_eq!(
            cards[0].unplayable,
            Some(UnplayableEntry {
                reason: UnplayableReason::AddonRemoved,
                addon: addon(),
            })
        );

        let disabled = continue_watching(
            &[episode("tt0903747:1:2", 100.0, 1_000, false)],
            &[],
            |_| Some(UnplayableReason::AddonDisabled),
        );

        assert_eq!(
            disabled[0].unplayable,
            Some(UnplayableEntry {
                reason: UnplayableReason::AddonDisabled,
                addon: addon(),
            })
        );
    }

    /// A cached copy of the series the fixture's episodes belong to: opened
    /// through its Addon, met by TMDB (so keyed by TMDB's id, with TMDB's Videos).
    fn cached_under_tmdb(title_id: &str) -> CachedTitle {
        let mut title = Title::parse(
            r#"{"meta":{"id":"tt0903747","type":"series","name":"Breaking Bad","videos":[
                {"id":"tmdb:1396:1:1","season":1,"episode":1},
                {"id":"tmdb:1396:1:2","season":1,"episode":2}
            ]}}"#,
            addon(),
            &TitleRef::parse("series", title_id).expect("a Title"),
        )
        .expect("a Title parses");
        title.key = TitleKey::Tmdb { id: 1396 };

        CachedTitle {
            title,
            read_at: 0,
            source: TitleSource::Both,
            status: None,
            next_episode: None,
        }
    }

    #[test]
    fn a_caught_up_series_is_the_one_with_nothing_after_its_card() {
        let cached = cached_under_tmdb("tt0903747");
        let card = |video: &str| WatchProgress {
            title: TitleStub::parse(&TitleCard {
                addon: None,
                id: "tmdb:1396".to_owned(),
                r#type: "series".to_owned(),
                name: "Breaking Bad".to_owned(),
                poster: None,
                background: None,
                logo: None,
            })
            .expect("a Discovered Title is one the Host will key"),
            ..episode(video, 2_820.0, 1_000, true)
        };

        assert!(
            caught_up(&[card("tmdb:1396:1:2")], std::slice::from_ref(&cached)),
            "the last Video the cached list holds is caught up"
        );
        assert!(
            !caught_up(&[card("tmdb:1396:1:1")], &[cached]),
            "a Video with one after it is not caught up"
        );
        assert!(
            !caught_up(&[card("tmdb:1396:1:2")], &[]),
            "no cached list proves nothing, so the finished Video is still the card"
        );
    }

    #[test]
    fn up_next_is_found_where_the_card_and_the_cached_copy_spell_the_title_differently() {
        // A card played from a Discover search names `tmdb:1396`; the cache met
        // the same series through its Addon and holds it keyed by TMDB's id.
        // Both spellings are the one Title, and its Videos are the list Up next
        // reads (#271).
        let cached = cached_under_tmdb("tt0903747");
        let card = WatchProgress {
            title: TitleStub::parse(&TitleCard {
                addon: None,
                id: "tmdb:1396".to_owned(),
                r#type: "series".to_owned(),
                name: "Breaking Bad".to_owned(),
                poster: None,
                background: None,
                logo: Some("https://images.example.org/bb-logo.png".to_owned()),
            })
            .expect("a Discovered Title is one the Host will key"),
            ..episode("tmdb:1396:1:1", 2_820.0, 1_000, true)
        };

        let cards = continue_watching(&[card], &[cached], |_| None);

        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0].video.id, "tmdb:1396:1:2");
        assert!(cards[0].up_next);
        assert_eq!(
            cards[0].title.logo(),
            Some("https://images.example.org/bb-logo.png"),
            "an Up next ContinueEntry preserves the Title's wordmark logo"
        );
    }

    #[test]
    fn a_cached_copy_that_does_not_list_the_finished_video_answers_no_up_next() {
        // The copy cannot say what follows a Video it does not hold, so the card
        // stays the finished Video as watched rather than guessing (#274).
        let cached = cached_under_tmdb("tt0903747");
        let cards = continue_watching(
            &[episode("tt0903747:1:9", 2_820.0, 1_000, true)],
            &[cached],
            |_| None,
        );

        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0].video.id, "tt0903747:1:9");
        assert!(cards[0].watched);
        assert!(!cards[0].up_next);
    }
}
