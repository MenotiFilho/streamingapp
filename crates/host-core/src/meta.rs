//! A meta response, in the Host's own words: **one Title, and its Videos**.
//!
//! Opening a Title is the other half of browsing (ADR-0005): a catalog row draws
//! cards from `MetaPreview`s, and opening one asks the Addon that supplied it for
//! the whole item — the poster, the year, the description and the runtime, and,
//! for a series, its seasons and episodes. Each episode is a [`Video`]: the unit
//! Watch progress is recorded against, carrying the id its Addon indexes it by
//! (`tt0903747:1:1`), so everything after this can act on one specific Video.
//!
//! ## Sparse is not broken
//!
//! A meta response is read *leniently*. The identity is the client's, not the
//! Addon's: the client asked to open a Title it already has a card for, so the id
//! and the type are known before the Addon answers, and the answer is about *that*
//! Title however it was phrased. Every field it does not send is a field the Title
//! does not have — an Addon that answers with a handful, or with no `meta` at all,
//! which is what the SDK's handler says when it knows nothing about the item, still
//! leaves a Title that opens rather than an error where a card used to be. The
//! window falls back to the card it already holds.
//!
//! What *is* refused is what could not be a meta response: a body that is not a
//! JSON object, and a `meta` that is there but is not an object. A `videos` list
//! is refused rather than read as empty when it is not a list, or when it is
//! longer than the Host will hold: an empty list of Videos is a film, and reading
//! a lie as a film would hide a series' episodes. A `genres` list that is not one
//! is ignored instead, because genres decorate a Title while its Videos are what a
//! Title *is* — the same leniency a catalog item's genres already get.
//!
//! Only the fields this Host acts on are read, and art is now among them: a
//! Title's `background` and `logo` and a Video's `thumbnail` are carried so the
//! Title screen and a series' episode rows can be drawn (ADR-0011's #62
//! amendment) — the same widening Home's hero got from a catalog item. A meta
//! response carries far more — Cinemeta's `cast`, `director`, `trailers`,
//! `links`, `slug`, `popularities`, `imdb_id`, and a Video's `overview`,
//! `rating`, `firstAired` and `tvdb_id` — and all of it is ignored rather than
//! refused, because reading a field nothing acts on is a promise this Host would
//! not be keeping (ADR-0009). It arrives when a ticket that acts on it does.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::addon::{AddonId, MAX_ITEMS, MAX_STRING_LEN};
use crate::request::TitleRef;
/// The most of a meta body the Host will read.
///
/// A Title is one item's metadata; addon answers in the wild are tens of
/// kilobytes, and a series' full episode list is the largest of them. An Addon
/// answering with megabytes is misbehaving or lying.
pub const MAX_META_BYTES: usize = 4 * 1024 * 1024;

/// A film or series, as its Addon describes it — the identity and the metadata a
/// Title screen is drawn from, and the Videos it can be watched as.
///
/// The [`addon`](Self::addon) that answered travels with it, because that is what
/// later tickets ask for Streams of one of its Videos, and because a Title here is
/// always one Addon's answer to one client (ADR-0005), never shared state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Title {
    /// The Addon that answered. Never where its manifest lives.
    pub addon: AddonId,
    /// The id the client opened, which is the id its Addon indexes it by —
    /// `tt0903747`, `tmdb:603`.
    pub id: String,
    /// What the Title is keyed by: TMDB's, where one of its records met it,
    /// and the supplying Addon's where one did not — the unchanged key of a
    /// Title nothing mapped (CONTEXT.md, *Title*).
    pub key: TitleKey,
    #[serde(rename = "type")]
    pub r#type: String,
    /// The Title's name. The id stands in when the Addon named it nothing, so a
    /// Title always has something to be called.
    pub name: String,
    pub poster: Option<String>,
    /// The backdrop's address, where the Addon sent one: the art a Title screen
    /// is drawn from, where the poster beside it is portrait.
    pub background: Option<String>,
    /// The logo's address, where the Addon sent one: a wordmark a Title screen
    /// overlays on the backdrop, where a client draws one.
    pub logo: Option<String>,
    pub description: Option<String>,
    /// The year, or a series' years: `1999`, `2008–2013`, `2020-`.
    pub release_info: Option<String>,
    /// How long it runs, as the Addon spells it: `136 min`, `1h 49min`.
    pub runtime: Option<String>,
    pub imdb_rating: Option<String>,
    pub genres: Vec<String>,
    /// The Title's Videos, in the Addon's own order: empty for a film, and a
    /// season's episodes, plus any specials, for a series.
    pub videos: Vec<Video>,
}

/// What a Title is keyed by: the identity the Host and its stores speak the
/// Title with, whoever described it.
///
/// The mapping is upwards and one-way: a Title keyed by its Addon until TMDB's
/// own record names it, and then keyed by that record's id. Which key a Title
/// carries is not the credential's business and is never a secret.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TitleKey {
    /// Keyed by its TMDB id — the number TMDB addresses the record by.
    Tmdb { id: u32 },
    /// Keyed by the Addon that supplied it: the Addon and the id it indexes
    /// the Title by, the pair everything it later answers about is asked
    /// with.
    Addon { addon: AddonId, id: String },
}

/// One playable unit of a Title: the film itself, or a single episode.
///
/// The [`id`](Self::id) is what Watch progress is recorded against and what a
/// Stream is later asked for by, so an item whose Addon gave it no id is not a
/// Video and is dropped.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Video {
    /// The id the Addon indexes this Video by: `tt0903747:1:1`.
    pub id: String,
    /// The episode's name, where the Addon gave one.
    pub name: Option<String>,
    /// The episode's still, where the Addon gave one: the 16:9 art a series'
    /// episode row is drawn from.
    pub thumbnail: Option<String>,
    /// The season, where the Addon numbered one. `0` is a series' specials.
    pub season: Option<u32>,
    /// The number within the season.
    pub episode: Option<u32>,
}

impl Video {
    /// A Video named by its id alone: the id it is keyed by, and the season and
    /// episode the protocol indexes at the end of it, where both are numbers.
    ///
    /// What a library entry is drawn from when no Addon answered about the
    /// Video — the entry is keyed by the id Watch progress was recorded against.
    /// The episode's name is deliberately absent: it is not in the id, and the
    /// Host does not invent one.
    pub fn keyed(id: &str) -> Self {
        let (season, episode) = episode_numbers(id);

        Self {
            id: id.to_owned(),
            name: None,
            thumbnail: None,
            season,
            episode,
        }
    }
}

/// One title's id, and the season and episode of it a Video id indexes, where
/// that id is an episode of it.
///
/// The protocol indexes an episode as `{title}:{season}:{episode}`, specials as
/// season zero, and a title's own id is whatever stands before those last two
/// parts: an Addon keyed by a namespaced id (`kitsu:12345`) indexes its episodes
/// as `kitsu:12345:1:1`, so the shape is "two numeric parts at the end" rather
/// than "exactly three parts". This is the one reading of that shape — the
/// library's card and the Host's next-episode rule both go through it — so the
/// two cannot disagree about what an episode is. A Video whose id does not end
/// that way — a film's — is not an episode, and the answer is `None`.
pub fn episode_of(id: &str) -> Option<(&str, u32, u32)> {
    let mut parts = id.rsplitn(3, ':');
    let episode = parts.next()?.parse::<u32>().ok()?;
    let season = parts.next()?.parse::<u32>().ok()?;
    // What is left is the title, however many `:` of its own it carries.
    let title = parts.next()?;

    (!title.is_empty()).then_some((title, season, episode))
}

/// The season and episode numbers an id ends in, where its last two
/// `:`-separated parts are both numbers.
pub fn episode_numbers(id: &str) -> (Option<u32>, Option<u32>) {
    match episode_of(id) {
        Some((_, season, episode)) => (Some(season), Some(episode)),
        None => (None, None),
    }
}

/// Why a meta response was not read, in the Host's own vocabulary.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum MetaError {
    #[error("that is not a meta response: {detail}")]
    NotJson { detail: String },
    #[error("{field} should be {expected}")]
    WrongType {
        field: String,
        expected: &'static str,
    },
    #[error("{field} is longer than this Host will hold ({limit})")]
    TooLarge { field: String, limit: usize },
}

impl Title {
    /// Read a meta response into a Title.
    ///
    /// Pure: no I/O, no state, and a refusal is just a value. `addon` is the
    /// Addon that was asked and `asked` is the identity the client opened; both
    /// are known before the Addon answered, and the identity is the client's own
    /// however the answer phrases it.
    pub fn parse(body: &str, addon: AddonId, asked: &TitleRef) -> Result<Self, MetaError> {
        if body.len() > MAX_META_BYTES {
            return Err(MetaError::TooLarge {
                field: "the meta response".to_owned(),
                limit: MAX_META_BYTES,
            });
        }

        let value: Value = serde_json::from_str(body).map_err(|error| MetaError::NotJson {
            detail: error.to_string(),
        })?;
        let object = value.as_object().ok_or_else(|| MetaError::NotJson {
            detail: "a meta response is a JSON object".to_owned(),
        })?;

        // No `meta`, or an explicit `null`, is an Addon saying it knows nothing
        // about this Title — which is an answer, not a failure.
        let meta = match object.get("meta") {
            None | Some(Value::Null) => None,
            Some(Value::Object(meta)) => Some(meta),
            Some(_) => {
                return Err(MetaError::WrongType {
                    field: "meta".to_owned(),
                    expected: "an object",
                })
            }
        };

        Ok(Self {
            // The identity belongs to the client, never to the body: the Title
            // *is* the item that was asked about, and an Addon cannot rename it.
            // A fresh answer is keyed by the Addon that gave it, until TMDB's
            // own records say otherwise — which is a decision above the parse.
            addon: addon.clone(),
            id: asked.id.clone(),
            key: TitleKey::Addon {
                addon,
                id: asked.id.clone(),
            },
            r#type: asked.r#type.clone(),
            name: meta
                .and_then(|meta| field(meta, "name"))
                .unwrap_or_else(|| asked.id.clone()),
            poster: meta.and_then(|meta| field(meta, "poster")),
            background: meta.and_then(|meta| field(meta, "background")),
            logo: meta.and_then(|meta| field(meta, "logo")),
            description: meta.and_then(|meta| field(meta, "description")),
            release_info: meta.and_then(|meta| field(meta, "releaseInfo")),
            runtime: meta.and_then(|meta| field(meta, "runtime")),
            imdb_rating: meta.and_then(|meta| field(meta, "imdbRating")),
            genres: match meta.and_then(|meta| meta.get("genres")) {
                None | Some(Value::Null) => Vec::new(),
                Some(value) => genres(value),
            },
            videos: match meta.and_then(|meta| meta.get("videos")) {
                None | Some(Value::Null) => Vec::new(),
                Some(value) => videos(value)?,
            },
        })
    }
}

/// The seasons' Videos, in the Addon's order.
///
/// A `videos` that is not a list is refused: an empty list of Videos is a film,
/// and reading a lie as a film would hide a series' episodes. A single record
/// that cannot be read is dropped rather than blanking the list around it,
/// because a Video with no id is one episode nobody can play — and a series of
/// twenty is not all-or-nothing.
fn videos(value: &Value) -> Result<Vec<Video>, MetaError> {
    let items = value.as_array().ok_or_else(|| MetaError::WrongType {
        field: "meta.videos".to_owned(),
        expected: "an array",
    })?;
    if items.len() > MAX_ITEMS {
        return Err(MetaError::TooLarge {
            field: "meta.videos".to_owned(),
            limit: MAX_ITEMS,
        });
    }

    Ok(items.iter().filter_map(video).collect())
}

/// One Video, or nothing when it cannot be read as one.
///
/// An item that is not an object, or that carries no id, is not a Video: the id
/// is what Watch progress and Streams are keyed by, so a record without one is
/// one nobody can act on.
fn video(value: &Value) -> Option<Video> {
    let object = value.as_object()?;

    Some(Video {
        id: string(object.get("id")?)?,
        // `name` is what Cinemeta calls an episode's title and `title` is what
        // the SDK's own type calls it.
        name: field(object, "name").or_else(|| field(object, "title")),
        thumbnail: field(object, "thumbnail"),
        season: number(object, "season"),
        // The protocol spells an episode's number two ways and real Addons send
        // both: Cinemeta's `episode` and the SDK's own `number`. `episode` is
        // read first because it is the one that names what the number is.
        episode: number(object, "episode").or_else(|| number(object, "number")),
    })
}

/// An item's genres, where the Addon spelled them as a list of strings.
///
/// A genre list that is not a list of strings is ignored rather than failing the
/// Title around it: genres are decoration, and a Title that cannot say what it is
/// about is still a Title — the same leniency a catalog item's genres get. Like a
/// catalog item's, it is bounded by the body rather than by a count of its own.
fn genres(value: &Value) -> Vec<String> {
    value
        .as_array()
        .map(|items| items.iter().filter_map(string).collect())
        .unwrap_or_default()
}

/// One named field of a meta object, read as a string.
fn field(object: &Map<String, Value>, name: &str) -> Option<String> {
    string(object.get(name)?)
}

/// One named field of a meta object, read as a number.
fn number(object: &Map<String, Value>, name: &str) -> Option<u32> {
    object
        .get(name)
        .and_then(Value::as_u64)
        .and_then(|number| u32::try_from(number).ok())
}

/// A non-empty string of a length the Host will hold, or nothing.
///
/// A field of the wrong type is the same as a field the Addon did not send: this
/// is the leniency the module's preamble describes, applied to every field but the
/// ones whose shape is a fact about the Addon.
fn string(value: &Value) -> Option<String> {
    let text = value.as_str()?;
    if text.is_empty() || text.len() > MAX_STRING_LEN {
        return None;
    }
    Some(text.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    const MOVIE: &str = include_str!("../tests/fixtures/cinemeta-meta-movie.json");
    const SERIES: &str = include_str!("../tests/fixtures/cinemeta-meta-series.json");
    const SPARSE: &str = include_str!("../tests/fixtures/sparse-meta.json");
    const HOSTILE: &str = include_str!("../tests/fixtures/hostile-meta.json");

    fn addon() -> AddonId {
        AddonId::parse("com.linvo.cinemeta").expect("an Addon id")
    }

    fn asked(r#type: &str, id: &str) -> TitleRef {
        TitleRef::parse(r#type, id).expect("a Title a request could name")
    }

    fn parsed(body: &str, asked: &TitleRef) -> Title {
        Title::parse(body, addon(), asked)
            .unwrap_or_else(|error| panic!("{body} should parse: {error}"))
    }

    fn refused(body: &str, asked: &TitleRef) -> MetaError {
        match Title::parse(body, addon(), asked) {
            Ok(title) => panic!("{body} should be refused, but parsed as {title:?}"),
            Err(error) => error,
        }
    }

    #[test]
    fn a_recorded_film_is_read_into_its_metadata_and_no_videos() {
        let title = parsed(MOVIE, &asked("movie", "tt0133093"));

        assert_eq!(title.addon.as_str(), "com.linvo.cinemeta");
        assert_eq!(title.id, "tt0133093");
        assert_eq!(title.r#type, "movie");
        assert_eq!(title.name, "The Matrix");
        assert!(title
            .poster
            .as_deref()
            .is_some_and(|poster| poster.starts_with("https://")));
        assert_eq!(title.release_info.as_deref(), Some("1999"));
        assert_eq!(title.runtime.as_deref(), Some("136 min"));
        assert_eq!(title.imdb_rating.as_deref(), Some("8.7"));
        assert_eq!(title.genres, vec!["Action", "Sci-Fi"]);
        assert!(title
            .description
            .as_deref()
            .is_some_and(|description| description.contains("hacker")));
        assert_eq!(
            title.background.as_deref(),
            Some("https://images.metahub.space/background/medium/tt0133093/img"),
            "the backdrop a Title screen is drawn from"
        );
        assert_eq!(
            title.logo.as_deref(),
            Some("https://images.metahub.space/logo/medium/tt0133093/img"),
            "the wordmark a Title screen overlays on it"
        );
        assert!(
            title.videos.is_empty(),
            "a film has no Videos: {:?}",
            title.videos
        );
    }

    #[test]
    fn a_recorded_series_is_read_into_its_videos_in_the_addons_own_order() {
        let title = parsed(SERIES, &asked("series", "tt0903747"));

        assert_eq!(title.name, "Breaking Bad");
        assert_eq!(title.release_info.as_deref(), Some("2008–2013"));
        assert_eq!(title.runtime.as_deref(), Some("49 min"));
        assert_eq!(
            title
                .videos
                .iter()
                .map(|video| (video.season, video.episode))
                .collect::<Vec<_>>(),
            vec![
                (Some(0), Some(1)),
                (Some(1), Some(1)),
                (Some(1), Some(2)),
                (Some(1), Some(3)),
                (Some(2), Some(1)),
            ],
            "the Addon's order is the order, specials included"
        );

        let pilot = &title.videos[1];
        assert_eq!(pilot.id, "tt0903747:1:1");
        assert_eq!(pilot.name.as_deref(), Some("Pilot"));
        assert_eq!(
            pilot.thumbnail.as_deref(),
            Some("https://episodes.metahub.space/tt0903747/1/1/w780.jpg"),
            "Cinemeta sends every episode its own 16:9 still"
        );
        assert!(
            title.videos.iter().all(|video| video.thumbnail.is_some()),
            "the specials carry one too: {:?}",
            title
                .videos
                .iter()
                .map(|video| video.thumbnail.as_deref())
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn every_video_carries_the_id_its_addon_indexes_it_by() {
        // The id is what Watch progress is recorded against and what a Stream is
        // asked for by, so it is the one field a Video exists to carry.
        let title = parsed(SERIES, &asked("series", "tt0903747"));
        let ids: Vec<&str> = title.videos.iter().map(|video| video.id.as_str()).collect();

        assert_eq!(
            ids,
            vec![
                "tt0903747:0:1",
                "tt0903747:1:1",
                "tt0903747:1:2",
                "tt0903747:1:3",
                "tt0903747:2:1",
            ]
        );
        assert_eq!(
            ids.iter().collect::<std::collections::HashSet<_>>().len(),
            ids.len(),
            "no two Videos share an id, which is how a client tells them apart"
        );
    }

    #[test]
    fn a_sparse_answer_is_a_title_with_what_it_has_rather_than_a_failure() {
        // An Addon is allowed to answer with the least a meta response can be.
        let title = parsed(SPARSE, &asked("movie", "tt0133093"));

        assert_eq!(title.id, "tt0133093");
        assert_eq!(title.r#type, "movie");
        assert_eq!(title.name, "The Matrix");
        assert_eq!(title.poster, None);
        assert_eq!(title.background, None, "no art to draw, and no failure");
        assert_eq!(title.logo, None);
        assert_eq!(title.description, None);
        assert_eq!(title.release_info, None);
        assert_eq!(title.runtime, None);
        assert_eq!(title.imdb_rating, None);
        assert!(title.genres.is_empty());
        assert!(title.videos.is_empty());
    }

    #[test]
    fn an_addon_that_knows_nothing_about_a_title_still_leaves_one_open() {
        // The SDK's own handler answers `{"meta": null}` when it has nothing.
        // That is an answer, not a failure: the identity the client opened it by
        // is what is left, and the window has the card it clicked as a fallback.
        for body in [r#"{"meta":null}"#, "{}"] {
            let title = parsed(body, &asked("series", "tt0903747"));

            assert_eq!(title.id, "tt0903747", "in {body}");
            assert_eq!(title.r#type, "series", "in {body}");
            assert_eq!(title.name, "tt0903747", "in {body}");
            assert_eq!(title.poster, None);
            assert!(title.videos.is_empty());
        }
    }

    #[test]
    fn a_title_is_the_item_the_client_asked_about_however_the_addon_answers() {
        // The identity is the client's: an Addon answering about some other item,
        // or omitting the id and the type, does not get to rename the Title the
        // client opened.
        for body in [
            r#"{"meta":{"id":"tt10838180","type":"series","name":"Something Else"}}"#,
            r#"{"meta":{"name":"One"}}"#,
        ] {
            let title = parsed(body, &asked("series", "tt0903747"));

            assert_eq!(title.id, "tt0903747", "in {body}");
            assert_eq!(title.r#type, "series", "in {body}");
        }
    }

    #[test]
    fn a_bit_of_an_answer_is_read_for_the_bits_it_has() {
        let title = parsed(
            r#"{"meta":{"id":"tt1","type":"movie","name":"One","genres":"Action","runtime":7}}"#,
            &asked("movie", "tt1"),
        );

        assert_eq!(title.name, "One");
        assert_eq!(
            title.genres,
            Vec::<String>::new(),
            "a field of the wrong shape is a field the Addon did not send"
        );
        assert_eq!(title.runtime, None);
    }

    #[test]
    fn a_video_that_cannot_be_read_is_dropped_rather_than_blanking_the_series() {
        let title = parsed(
            r#"{"meta":{"id":"tt1","type":"series","name":"One","videos":[
                {"id":"tt1:1:1","name":"Pilot","season":1,"episode":1},
                {"name":"no id, so nobody can play it","season":1,"episode":2},
                "not a video at all",
                {"id":"tt1:1:3","name":"Three","season":1,"number":3}
            ]}}"#,
            &asked("series", "tt1"),
        );

        assert_eq!(
            title
                .videos
                .iter()
                .map(|video| video.id.as_str())
                .collect::<Vec<_>>(),
            vec!["tt1:1:1", "tt1:1:3"],
            "the two Videos that read survive the two that do not"
        );
        assert_eq!(
            title.videos[1].episode,
            Some(3),
            "an episode numbered the SDK's way is read the same as one numbered Cinemeta's"
        );
    }

    #[test]
    fn a_video_is_named_by_either_name_the_protocol_spells_a_title_by() {
        // Cinemeta calls an episode's title `name`; the SDK's own type calls it
        // `title`.
        let title = parsed(
            r#"{"meta":{"id":"tt1","type":"series","name":"One","videos":[
                {"id":"tt1:1:1","title":"Pilot"}
            ]}}"#,
            &asked("series", "tt1"),
        );

        assert_eq!(title.videos[0].name.as_deref(), Some("Pilot"));
    }

    #[test]
    fn a_video_id_is_read_as_an_episode_of_the_title_before_its_numbers() {
        assert_eq!(episode_of("tt0903747:1:2"), Some(("tt0903747", 1, 2)));
        assert_eq!(
            episode_of("kitsu:12345:1:1"),
            Some(("kitsu:12345", 1, 1)),
            "a title's own id is not always one part, so the numbers read from the right"
        );
        assert_eq!(
            episode_of("tt0903747:0:1"),
            Some(("tt0903747", 0, 1)),
            "specials"
        );

        for film in ["tt0133093", "tt0903747:1", ":1:1", ""] {
            assert_eq!(
                episode_of(film),
                None,
                "{film:?} does not end in two numbers, so it is not an episode"
            );
        }
    }

    #[test]
    fn fields_this_host_has_no_use_for_are_ignored_rather_than_refused() {
        // Cinemeta's meta carries `cast`, `director`, `trailers`, `links`,
        // `slug`, `popularities`, `imdb_id` and `moviedb_id` beside the fields
        // the Host reads, and a Title that knows more than the Host does still
        // opens.
        let title = parsed(SERIES, &asked("series", "tt0903747"));

        assert_eq!(title.imdb_rating.as_deref(), Some("9.5"));
        assert_eq!(title.genres, vec!["Crime", "Drama", "Thriller"]);
    }

    #[test]
    fn art_of_a_shape_the_host_will_not_hold_is_art_the_addon_did_not_send() {
        // The same leniency every field gets: a backdrop or a still that is not
        // a string the Host will hold is absent rather than a refusal of the
        // whole answer.
        let title = parsed(
            r#"{"meta":{"id":"tt1","type":"series","name":"One",
                "background":7,"logo":"","videos":[{"id":"tt1:1:1","thumbnail":false}]}}"#,
            &asked("series", "tt1"),
        );

        assert_eq!(title.background, None);
        assert_eq!(title.logo, None);
        assert_eq!(title.videos[0].thumbnail, None);
    }

    #[test]
    fn a_body_that_is_not_a_meta_response_is_refused() {
        for body in [
            "",
            "not json at all",
            "<html>hello</html>",
            "[]",
            "\"a meta response\"",
            "5",
            "null",
        ] {
            assert!(
                matches!(
                    refused(body, &asked("movie", "tt1")),
                    MetaError::NotJson { .. }
                ),
                "{body:?} is not a meta response"
            );
        }
    }

    #[test]
    fn a_meta_that_is_not_an_object_is_refused_rather_than_read_as_no_title() {
        assert_eq!(
            refused(HOSTILE, &asked("movie", "tt1")),
            MetaError::WrongType {
                field: "meta".to_owned(),
                expected: "an object",
            },
            "an answer that is not about an item is a fact about the Addon"
        );
    }

    #[test]
    fn a_videos_list_that_is_not_a_list_is_refused_rather_than_read_as_a_film() {
        // Reading a lie as "no Videos" would turn a series into a film and hide
        // every episode; an answer that cannot be read is better than a wrong one.
        assert_eq!(
            refused(
                r#"{"meta":{"id":"tt1","type":"series","name":"One","videos":"every episode"}}"#,
                &asked("series", "tt1")
            ),
            MetaError::WrongType {
                field: "meta.videos".to_owned(),
                expected: "an array",
            }
        );
    }

    #[test]
    fn a_videos_list_longer_than_the_host_holds_is_refused() {
        let too_many = serde_json::json!({
            "meta": {
                "id": "tt1",
                "type": "series",
                "name": "One",
                "videos": vec![
                    serde_json::json!({ "id": "tt1:1:1", "season": 1, "episode": 1 });
                    MAX_ITEMS + 1
                ],
            },
        })
        .to_string();

        assert_eq!(
            refused(&too_many, &asked("series", "tt1")),
            MetaError::TooLarge {
                field: "meta.videos".to_owned(),
                limit: MAX_ITEMS,
            }
        );
    }

    #[test]
    fn a_body_longer_than_the_host_holds_is_refused_before_it_is_parsed() {
        let body = format!("{} {{", " ".repeat(MAX_META_BYTES));

        assert_eq!(
            refused(&body, &asked("movie", "tt1")),
            MetaError::TooLarge {
                field: "the meta response".to_owned(),
                limit: MAX_META_BYTES,
            }
        );
    }

    #[test]
    fn the_wire_shape_is_the_declared_one() {
        let title = parsed(MOVIE, &asked("movie", "tt0133093"));
        let published = serde_json::to_value(&title).expect("a Title serializes");

        assert_eq!(published["addon"], "com.linvo.cinemeta");
        assert_eq!(published["type"], "movie");
        assert_eq!(published["releaseInfo"], "1999");
        assert_eq!(published["imdbRating"], "8.7");
        assert_eq!(
            published["background"], "https://images.metahub.space/background/medium/tt0133093/img",
            "the art rides the answer to the client that opened the Title"
        );
        assert_eq!(
            published["logo"],
            "https://images.metahub.space/logo/medium/tt0133093/img"
        );
        assert_eq!(
            published["videos"],
            serde_json::json!([]),
            "the wire shape is camelCased for a JavaScript client"
        );
    }
}
