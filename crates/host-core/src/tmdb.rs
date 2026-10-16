//! TMDB: the metadata Titles map to, where the addon protocol's ids cannot say
//! who a Title is on their own.
//!
//! The addon protocol is what the Host is asked by, but its ids are whoever
//! supplied the item's — an IMDb id here, a `tmdb:` prefix there, and a
//! collection of less common ones elsewhere. TMDB is the one catalogue that
//! says what a Title *is* in words the whole ecosystem agrees on, so the
//! identity of a Title is TMDB's where one of its records can be reached, and
//! the supplying Addon's otherwise (CONTEXT.md, *Title*).
//!
//! ## The path, and the credential
//!
//! TMDB v3 wants its credential in one of two shapes ("Application
//! authentication"): a v3 API key goes as the `api_key` query item, and a v4
//! read-access token (a JWT) goes in an `Authorization: Bearer` header. The key
//! cannot travel as a header — TMDB answers 401 to that — so the [`Credential`]
//! decides once, by shape, and a Bearer keeps the Urls clean of it entirely.
//! Both forms of the credential are built at the moment of the request and
//! never stored further; nothing here holds one.
//!
//! ## Sparse, and refusing
//!
//! A TMDB answer is read leniently, after the same manner the addon protocol's
//! meta responses are read ([`crate::meta`]): every field TMDB did not send is
//! a field the Title keeps from its Addon, and the merge ([`TmdbDetails::onto`])
//! takes TMDB's word only where TMDB gave one. What *is* refused is what could
//! not be a TMDB answer: a body that is not a JSON object. An unlisted item —
//! a `find` with neither the results the kind asked for nor an id in them — is
//! an answer too, and it is not mapping.
//!
//! Videos are not TMDB's to renumber here. A series' episodes keep the ids
//! their Addon indexes them by (`tt0903747:1:1`), because that is what Watch
//! progress and Stream requests are keyed by; matching a TMDB episode to an
//! addon Video is a decision this Host has not taken yet, and a metadata
//! refinement is not a place where it can be improvised.

use serde_json::{Map, Value};

use crate::addon::MAX_STRING_LEN;

/// Where TMDB answers questions at, in the version the marked one.
pub const TMDB_ROOT: &str = "https://api.themoviedb.org/3";

/// Where TMDB takes its images from, at the size a card is drawn at.
pub const IMAGE_ROOT: &str = "https://image.tmdb.org/t/p/w780";

/// Which of the addon protocol's kinds TMDB answers for.
///
/// The protocol spells a series a `series` and TMDB spells one a `tv`; a film
/// is `movie` on both sides. The other kinds — `channel`, `tv`, a catalogue of
/// releases — are not Titles TMDB has records for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Movie,
    Tv,
}

impl Kind {
    /// A kind from the addon protocol's own spelling of it.
    pub fn parse(kind: &str) -> Option<Self> {
        match kind {
            "movie" => Some(Self::Movie),
            "series" => Some(Self::Tv),
            _ => None,
        }
    }

    /// The resource path's spelling of it, which is TMDB's.
    fn as_resource(self) -> &'static str {
        match self {
            Self::Movie => "movie",
            Self::Tv => "tv",
        }
    }

    /// TMDB spells the two their names differently from their paths: a record's
    /// name is a movie's `title` and a series' `name`.
    fn as_name_field(self) -> &'static str {
        match self {
            Self::Movie => "title",
            Self::Tv => "name",
        }
    }
}

/// A TMDB id: the number one of its records is addressed by.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TmdbId(pub u32);

impl TmdbId {
    /// A number, or why this string is not one.
    ///
    /// The Host will not send a zero or read more than fits a `u32`: an id
    /// that long is not TMDB's.
    pub fn parse(raw: &str) -> Option<Self> {
        raw.parse::<u32>().ok().filter(|id| *id > 0).map(Self)
    }
}

/// Which catalogue outside the addon protocol a Title's id belongs to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExternalId {
    /// The id said it itself: `tmdb:603` is TMDB's own, and needs only its
    /// details read.
    Tmdb(TmdbId),
    /// `tt0133093` is an IMDb id, and TMDB is asked which of its records it is.
    Imdb(String),
}

impl ExternalId {
    /// The outside identity of a Title the addon protocol named.
    ///
    /// The kind is the one the client carried, and it is part of what decides:
    /// an id TMDB has no record for is an id that cannot be refined however it
    /// is spelled.
    pub fn parse(kind: &str, id: &str) -> Option<Self> {
        Kind::parse(kind)?;

        if let Some(rest) = id.strip_prefix("tmdb:") {
            let id = TmdbId::parse(rest)?;
            return Some(Self::Tmdb(id));
        }

        let imdb = id.strip_prefix("tt")?;
        if imdb.is_empty() || !imdb.chars().all(|c| c.is_ascii_digit()) {
            return None;
        }
        if imdb.len() > MAX_STRING_LEN {
            return None;
        }
        // The find ask carries the id as its Addon spells it, `tt` and all:
        // that is what TMDB's `find` endpoint is asked with.
        Some(Self::Imdb(id.to_owned()))
    }
}

/// The credential TMDB wants on its requests, in the shape the owner gave it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Credential {
    /// A v3 API key. It goes as the `api_key` query item — TMDB does not take it
    /// in a header — which is why a URL it was built onto contains it, and why
    /// such a URL is never kept, logged or published by this Host.
    Query(String),
    /// A v4 read-access token (the JWT TMDB calls the API Read Access Token).
    /// It goes in the `Authorization` header: it never touches a URL.
    Bearer(String),
}

impl Credential {
    /// The shape of what was typed. A JWT is discoverable because a JWT is a
    /// dotted base64 triple; everything else is the shorter v3 key.
    pub fn parse(raw: &str) -> Self {
        if raw.starts_with("ey") && raw.matches('.').count() == 2 {
            Self::Bearer(raw.to_owned())
        } else {
            Self::Query(raw.to_owned())
        }
    }

    /// The query item the credential wants, if one there is.
    pub fn query(&self) -> Option<(&'static str, &str)> {
        match self {
            Self::Query(key) => Some(("api_key", key.as_str())),
            Self::Bearer(_) => None,
        }
    }

    /// The header the credential wants, if one there is.
    pub fn header(&self) -> Option<(&'static str, String)> {
        match self {
            Self::Query(_) => None,
            Self::Bearer(token) => Some(("Authorization", format!("Bearer {token}"))),
        }
    }
}

/// What the Host asks TMDB for, and the URL it asks at.
///
/// The request and its URL are apart for the reason [`crate::request`] is: the
/// URL is a pure function of the request and the credential, and a credential
/// may or may not ride in it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TmdbRequest {
    /// The FindTMDB record of an external id: the id is a path component and
    /// say where it came from.
    Find { kind: Kind, imdb: String },
    /// One record's metadata, by the id TMDB addresses it by.
    Details { kind: Kind, id: TmdbId },
}

impl TmdbRequest {
    /// The URL to ask at, with what the credential wants built onto it.
    pub fn url(&self, credential: &Credential) -> String {
        let mut url = String::new();
        url.push_str(TMDB_ROOT);
        match self {
            Self::Find { imdb, .. } => {
                url.push_str("/find/");
                url.push_str(&encode(imdb));
                url.push_str("?external_source=imdb_id");
            }
            Self::Details { kind, id } => {
                url.push('/');
                url.push_str(kind.as_resource());
                url.push('/');
                url.push_str(&id.0.to_string());
            }
        }

        // A `find` URL already carries its query; a details URL starts its own.
        // Either way, one query item, built once.
        if let Some((name, value)) = credential.query() {
            url.push(if url.contains('?') { '&' } else { '?' });
            url.push_str(name);
            url.push('=');
            url.push_str(&encode(value));
        }
        url
    }
}

/// One TMDB record's metadata, read leniently from its details.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct TmdbDetails {
    /// The name TMDB's own language for the record gives.
    pub name: Option<String>,
    /// The record's summary, which supersede a Title's description.
    pub overview: Option<String>,
    /// The poster at TMDB's size for a card, built from the path the answer
    /// carried.
    pub poster: Option<String>,
    /// The year a film was released, or a series' years: `1999`, `2008–2013`,
    /// the shape the Host already publishes.
    pub release_info: Option<String>,
    /// How long it runs, as the Host spells it: `136 min`.
    pub runtime: Option<String>,
    /// The genres' names, where TMDB answered with any.
    pub genres: Vec<String>,
}

impl TmdbDetails {
    /// TMDB metadata onto the Title that was asking, where TMDB has it.
    ///
    /// Every field TMDB did not send keeps the Addon's word; every field it did
    /// send takes TMDB's. The Title's identity fields — the Addon that
    /// answered and the id it opened by — are not TMDB's to speak for, and
    /// neither are its Videos, whose ids the Streams are asked for by.
    pub fn onto(self, title: &mut crate::meta::Title) {
        if let Some(name) = self.name {
            title.name = name;
        }
        if let Some(poster) = self.poster {
            title.poster = Some(poster);
        }
        if let Some(description) = self.overview {
            title.description = Some(description);
        }
        if let Some(release_info) = self.release_info {
            title.release_info = Some(release_info);
        }
        if let Some(runtime) = self.runtime {
            title.runtime = Some(runtime);
        }
        if !self.genres.is_empty() {
            title.genres = self.genres;
        }
    }
}

/// Why a TMDB answer was not read.
/// A refusal is a fact about TMDB, not about the Title asking: a Title whose
/// TMDB lookup was refused opens as the Addon described it, unmapped unless
/// its id said it was TMDB's own.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum TmdbError {
    #[error("that is not a TMDB answer: {detail}")]
    NotJson { detail: String },
}

/// Which TMDB record an IMDb id is — `Some` when it mapped, `None` when TMDB
/// answered with nothing of that kind, and why it was not read at all.
///
/// The answer carries both kinds' results, and the kind the Title was asked by
/// is the one that counts: a film's `movie_results` is empty exactly when the
/// lookup found no film, however full the series' list beside it looks. An
/// empty list is an answer — unmapped — while a list that is not its key's
/// array is a fact about a body pretending to be a find answer.
pub fn read_find(body: &str, kind: Kind) -> Result<Option<TmdbId>, TmdbError> {
    let value: Value = serde_json::from_str(body).map_err(|error| TmdbError::NotJson {
        detail: error.to_string(),
    })?;
    let object = value.as_object().ok_or_else(|| TmdbError::NotJson {
        detail: "a find answer is a JSON object".to_owned(),
    })?;

    let results = object
        .get(match kind {
            Kind::Movie => "movie_results",
            Kind::Tv => "tv_results",
        })
        .and_then(Value::as_array)
        .ok_or_else(|| TmdbError::NotJson {
            detail: "the kind's results should be an array".to_owned(),
        })?;

    Ok(results
        .first()
        .and_then(|result| result.as_object())
        .and_then(|record| record.get("id"))
        .and_then(Value::as_u64)
        .and_then(|id| u32::try_from(id).ok().filter(|id| *id > 0))
        .map(TmdbId))
}

/// One details answer, after the manner a meta response is read.
pub fn read_details(body: &str, kind: Kind) -> Result<TmdbDetails, TmdbError> {
    let value: Value = serde_json::from_str(body).map_err(|error| TmdbError::NotJson {
        detail: error.to_string(),
    })?;
    let record = value.as_object().ok_or_else(|| TmdbError::NotJson {
        detail: "a details answer is a JSON object".to_owned(),
    })?;
    let record = Record {
        object: record,
        kind,
    };

    Ok(TmdbDetails {
        name: record.name(),
        overview: string(record.object, "overview"),
        poster: record.poster(),
        release_info: record.release_info(),
        runtime: record.runtime(),
        genres: record.genres(),
    })
}

/// A details record behind the kind that says how its own fields are spelled.
struct Record<'a> {
    object: &'a Map<String, Value>,
    kind: Kind,
}

impl Record<'_> {
    /// A record's name is a movie's `title` and a series' `name`.
    fn name(&self) -> Option<String> {
        string(self.object, self.kind.as_name_field())
    }

    /// The poster is a relative path in the answer, and an absolute URL in the
    /// Title — the size the Host draws cards at.
    fn poster(&self) -> Option<String> {
        let path = string(self.object, "poster_path")?;
        Some(format!("{IMAGE_ROOT}{path}"))
    }

    fn release_info(&self) -> Option<String> {
        match self.kind {
            Kind::Movie => date(self.object, "release_date").map(|when| when.year.to_string()),
            // Both ends of the window TMDB spells as dates, and a series that
            // is still being made only has the years it started in: "2020-".
            Kind::Tv => {
                let first = date(self.object, "first_air_date")?;
                let last = date(self.object, "last_air_date");
                let ended = self
                    .object
                    .get("in_production")
                    .and_then(Value::as_bool)
                    .map(|still_making| !still_making)
                    .unwrap_or(false);

                match (last, ended) {
                    (Some(last), true) if last.year > first.year => {
                        Some(format!("{}–{}", first.year, last.year))
                    }
                    (Some(last), true) if last.year == first.year => Some(last.year.to_string()),
                    (Some(last), _) if last.year > first.year => Some(format!("{}-", first.year)),
                    _ => Some(first.year.to_string()),
                }
            }
        }
    }

    /// A film's runtime is TMDB's own `runtime`; a series', the most of an
    /// episode TMDB says they run. Which episode is which is not a decision
    /// this Host has taken. A runtime of zero is one TMDB did not send.
    fn runtime(&self) -> Option<String> {
        match self.kind {
            Kind::Movie => unsigned(self.object, "runtime"),
            Kind::Tv => self
                .object
                .get("episode_run_time")
                .and_then(Value::as_array)
                .and_then(|times| times.first())
                .and_then(Value::as_u64)
                .and_then(|time| u32::try_from(time).ok()),
        }
        .filter(|minutes| *minutes > 0)
        .map(|minutes| format!("{minutes} min"))
    }

    fn genres(&self) -> Vec<String> {
        self.object
            .get("genres")
            .and_then(Value::as_array)
            .map(|genres| {
                genres
                    .iter()
                    .filter_map(|genre| string(genre.as_object()?, "name"))
                    .collect()
            })
            .unwrap_or_default()
    }
}

/// The parts of a TMDB date this Host reads: the year it says the thing began.
struct Date {
    year: u32,
}

/// A date in a `YYYY-MM-DD`, read for its year and nothing else.
///
/// A date of the wrong shape is the same as none: the field it was in is a
/// field the record did not send.
fn date(record: &Map<String, Value>, name: &str) -> Option<Date> {
    let text = string(record, name)?;
    if text.len() != 10 || text.as_bytes()[4] != b'-' {
        return None;
    }
    let year = TmdbId::parse(&text[..4])?;
    Some(Date { year: year.0 })
}

/// One named field of a record, read as a string.
fn string(object: &Map<String, Value>, name: &str) -> Option<String> {
    object.get(name)?.as_str().map(str::to_owned)
}

/// One named field of a record, read as a number.
fn unsigned(object: &Map<String, Value>, name: &str) -> Option<u32> {
    object
        .get(name)
        .and_then(Value::as_u64)
        .and_then(|number| u32::try_from(number).ok())
}

/// One path component, encoded the way the addon protocol encodes its own
/// ([`crate::request`]): `encodeURIComponent`'s set.
fn encode(value: &str) -> String {
    percent_encoding::utf8_percent_encode(value, crate::request::COMPONENT).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::addon::AddonId;
    use crate::meta::Title;
    use crate::request::TitleRef;
    use crate::{IMAGE_ROOT, TMDB_ROOT};

    const FIND_MATRIX: &str = include_str!("../tests/fixtures/tmdb-find-matrix.json");
    const MOVIE_DETAILS: &str = include_str!("../tests/fixtures/tmdb-movie-details.json");
    const TV_DETAILS: &str = include_str!("../tests/fixtures/tmdb-tv-details.json");
    const TV_DETAILS_MAKING: &str = include_str!("../tests/fixtures/tmdb-tv-details-making.json");

    const CINEMETA_SERIES: &str = include_str!("../tests/fixtures/cinemeta-meta-series.json");

    fn cinematic() -> AddonId {
        AddonId::parse("com.linvo.cinemeta").expect("an Addon id")
    }

    fn addon_movie() -> Title {
        Title::parse(
            r#"{"meta":{"name":"The Matrix","runtime":"136 min","genres":["Action"],"videos":[]}}"#,
            cinematic(),
            &TitleRef::parse("movie", "tt0133093").expect("a Title"),
        )
        .expect("the Addon's Title parses")
    }

    fn token(raw: &str) -> Credential {
        Credential::parse(raw)
    }

    #[test]
    fn the_kinds_the_addon_protocol_spells_are_read_into_tmdbs_language() {
        assert_eq!(Kind::parse("movie"), Some(Kind::Movie));
        assert_eq!(Kind::parse("series"), Some(Kind::Tv));
        assert!(
            Kind::parse("channel").is_none(),
            "not a kind TMDB answers for"
        );
        assert!(
            Kind::parse("tv").is_none(),
            "the protocol's word, not TMDB's"
        );
    }

    #[test]
    fn an_id_tmdb_addresses_a_record_by_is_a_number_above_zero() {
        assert_eq!(TmdbId::parse("603"), Some(TmdbId(603)));
        assert_eq!(TmdbId::parse("0"), None, "no record is numbered zero");
        assert_eq!(TmdbId::parse("60x"), None);
        assert_eq!(TmdbId::parse(""), None);
    }

    #[test]
    fn an_outside_identity_is_what_the_id_says_it_is() {
        assert_eq!(
            ExternalId::parse("movie", "tmdb:603"),
            Some(ExternalId::Tmdb(TmdbId(603))),
            "a `tmdb:` id says it itself, and needs only its details read"
        );
        assert_eq!(
            ExternalId::parse("series", "tt0903747"),
            Some(ExternalId::Imdb("tt0903747".to_owned())),
            "an IMDb id carries the `tt` its find ask is asked with"
        );
    }

    #[test]
    fn ids_that_belong_to_nothing_outside_the_protocol_say_so() {
        for (kind, id) in [
            ("movie", "tmdb:"),
            ("movie", "tmdb:60x"),
            ("movie", "tt"),
            ("movie", "tt090374x"),
            ("series", "not-a-prefix:603"),
            ("series", "yltrium:xyz"),
            ("channel", "tmdb:603"),
            ("movie", "tmdb:0"),
        ] {
            assert!(
                ExternalId::parse(kind, id).is_none(),
                "{kind}/{id} is not an outside identity"
            );
        }
    }

    #[test]
    fn a_credential_takes_its_own_shape_and_travel_own_place() {
        let api_key = token("0123456789abcdef0123456789abcdef");
        assert_eq!(
            api_key.clone().query(),
            Some(("api_key", "0123456789abcdef0123456789abcdef")),
            "a v3 key goes as the query item: TMDB answers 401 to it in a header"
        );
        assert_eq!(api_key.header(), None, "one kind, one place");

        let access = token("eyJhbGciOiJIUzI1NiJ9.eyJzY29wZSI6InJlYWQifQ.sig");
        assert_eq!(access.clone().query(), None, "a token never rides in a URL");
        assert_eq!(
            access.header(),
            Some((
                "Authorization",
                "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzY29wZSI6InJlYWQifQ.sig".to_owned()
            ))
        );
    }

    #[test]
    fn a_request_asks_where_tmdb_answers_with_what_its_kind_carries() {
        let find = TmdbRequest::Find {
            kind: Kind::Movie,
            imdb: "0133093".to_owned(),
        };
        assert_eq!(
            find.url(&token("a-key")),
            "https://api.themoviedb.org/3/find/0133093?external_source=imdb_id&api_key=a-key",
        );

        let details = TmdbRequest::Details {
            kind: Kind::Tv,
            id: TmdbId(1396),
        };
        assert_eq!(
            details.url(&token("a-key")),
            "https://api.themoviedb.org/3/tv/1396?api_key=a-key",
        );
    }

    #[test]
    fn a_token_makes_its_url_clean_of_every_credential_it_carries() {
        let the_token = "eyJhbGciOiJIUzI1NiJ9.eyJzY29wZSI6InJlYWQifQ.a-signature";

        for request in [
            TmdbRequest::Find {
                kind: Kind::Movie,
                imdb: "0133093".to_owned(),
            },
            TmdbRequest::Details {
                kind: Kind::Movie,
                id: TmdbId(603),
            },
        ] {
            let built = request.url(&token(the_token));
            assert!(
                !built.contains(the_token) && !built.contains("api_key"),
                "a token in the header never appears in the URL it travelled beside: {built}"
            );
            assert!(
                built.starts_with(TMDB_ROOT),
                "the request is asked where TMDB answers: {built}"
            );
        }
    }

    #[test]
    fn a_recorded_find_answers_with_the_record_of_the_kind_the_title_is() {
        assert_eq!(
            read_find(FIND_MATRIX, Kind::Movie),
            Ok(Some(TmdbId(603))),
            "the film The Matrix is TMDB record 603"
        );
        assert_eq!(
            read_find(FIND_MATRIX, Kind::Tv),
            Ok(None),
            "the kind's own side is the one that counts, and an empty one is the answer no record was found"
        );
    }

    #[test]
    fn a_find_answer_that_is_not_one_is_refused() {
        for body in ["", "not json", "[]", "\"a find\"", "5", "null"] {
            assert!(
                matches!(read_find(body, Kind::Movie), Err(TmdbError::NotJson { .. })),
                "{body:?} is not a find answer"
            );
        }

        // The kind's side of it is what must be its array — the other kinds'
        // results beside it do not make a body a find answer about a film.
        assert_eq!(
            read_find(r#"{"tv_results":5}"#, Kind::Movie),
            Err(TmdbError::NotJson {
                detail: "the kind's results should be an array".to_owned()
            })
        );
    }

    #[test]
    fn a_record_whose_id_is_not_an_id_is_not_one_to_key_a_title_by() {
        assert_eq!(
            read_find(r#"{"movie_results":[{"name":"no id"}]}"#, Kind::Movie),
            Ok(None),
            "nothing mapped, however full the other kinds' side of the answer looks"
        );
    }

    #[test]
    fn a_recorded_film_is_read_into_its_metadata() {
        let details = read_details(MOVIE_DETAILS, Kind::Movie).expect("a details answer");

        assert_eq!(details.name.as_deref(), Some("The Matrix"));
        assert!(
            details
                .poster
                .as_deref()
                .is_some_and(|poster| poster.starts_with(IMAGE_ROOT)),
            "the poster is asked at the size a card draws: {:?}",
            details.poster
        );
        assert_eq!(details.release_info.as_deref(), Some("1999"));
        assert_eq!(details.runtime.as_deref(), Some("136 min"));
        assert_eq!(details.genres, vec!["Action", "Science Fiction"]);
        assert!(details
            .overview
            .as_deref()
            .is_some_and(|overview| overview.contains("Morpheus")));
    }

    #[test]
    fn a_recorded_series_is_read_into_its_metadata_and_its_years() {
        let details = read_details(TV_DETAILS, Kind::Tv).expect("a details answer");

        assert_eq!(details.name.as_deref(), Some("Breaking Bad"));
        assert_eq!(
            details.release_info.as_deref(),
            Some("2008–2013"),
            "a series that is over carries the years it ran between"
        );
        assert_eq!(
            details.runtime.as_deref(),
            Some("45 min"),
            "a series runs as TMDB spells an episode's length"
        );
        assert_eq!(details.genres, vec!["Drama", "Crime"]);
    }

    #[test]
    fn a_series_still_making_carries_the_year_it_started_with() {
        let details = read_details(TV_DETAILS_MAKING, Kind::Tv).expect("a details answer");

        assert_eq!(
            details.release_info.as_deref(),
            Some("2020-"),
            "the years TMDB expects more of are the years so far"
        );
    }

    #[test]
    fn a_details_answer_that_is_not_one_is_refused() {
        for body in ["", "not json", "[]", "5", "null", "\"a record\""] {
            assert!(
                matches!(
                    read_details(body, Kind::Movie),
                    Err(TmdbError::NotJson { .. })
                ),
                "{body:?} is not a details answer"
            );
        }
    }

    #[test]
    fn a_record_that_said_little_leaves_every_field_the_addons_word() {
        let details = read_details(r#"{"id":603}"#, Kind::Movie).expect("a details answer");

        assert_eq!(details.name, None);
        assert_eq!(details.poster, None);
        assert_eq!(details.overview, None);
        assert_eq!(details.release_info, None);
        assert_eq!(details.runtime, None);
        assert!(details.genres.is_empty());

        let mut title = addon_movie();
        let before = title.clone();
        details.onto(&mut title);

        assert_eq!(title, before, "a record that said nothing refines nothing");
    }

    #[test]
    fn tmdb_takes_the_fields_it_answered_and_the_addon_keeps_the_rest() {
        let mut title = addon_movie();
        read_details(MOVIE_DETAILS, Kind::Movie)
            .expect("a details answer")
            .onto(&mut title);

        assert_eq!(title.name, "The Matrix", "the name became TMDB's");
        assert!(
            title
                .poster
                .as_deref()
                .is_some_and(|poster| poster.starts_with(IMAGE_ROOT)),
            "the poster is TMDB's, where TMDB gave one"
        );
        assert_eq!(title.genres, vec!["Action", "Science Fiction"]);
        assert_eq!(title.release_info.as_deref(), Some("1999"));
        assert_eq!(title.runtime.as_deref(), Some("136 min"));
    }

    #[test]
    fn the_identity_and_the_videos_are_never_tmdbs_to_rename() {
        let mut series_title = Title::parse(
            CINEMETA_SERIES,
            cinematic(),
            &TitleRef::parse("series", "tt0903747").expect("a Title"),
        )
        .expect("the Addon's Title parses");
        read_details(TV_DETAILS, Kind::Tv)
            .expect("a details answer")
            .onto(&mut series_title);

        assert_eq!(series_title.addon.as_str(), "com.linvo.cinemeta");
        assert_eq!(series_title.id, "tt0903747");
        assert_eq!(
            series_title
                .videos
                .iter()
                .map(|video| video.id.as_str())
                .collect::<Vec<_>>(),
            vec![
                "tt0903747:0:1",
                "tt0903747:1:1",
                "tt0903747:1:2",
                "tt0903747:1:3",
                "tt0903747:2:1",
            ],
            "the Videos keep the ids Streams are asked for by; a refinement never renumbers"
        );
    }

    #[test]
    fn a_runtime_tmdb_said_nothing_about_keeps_the_addons_word() {
        let mut title = addon_movie();
        read_details(r#"{"id":603}"#, Kind::Movie)
            .expect("a sparse record is an answer")
            .onto(&mut title);

        assert_eq!(title.runtime.as_deref(), Some("136 min"));
        assert_eq!(title.genres, vec!["Action"]);
    }

    #[test]
    fn a_runtime_of_no_minutes_is_a_runtime_tmdb_did_not_send() {
        let details =
            read_details(r#"{"id":603,"runtime":0}"#, Kind::Movie).expect("a details answer");

        assert_eq!(
            details.runtime, None,
            "a runtime nobody sent is a runtime the record does not carry"
        );
    }

    #[test]
    fn a_title_carries_its_key_on_the_wire_the_way_a_client_reads_it() {
        let key = crate::meta::TitleKey::Tmdb { id: 603 };
        assert_eq!(
            serde_json::to_value(key).expect("a TitleKey serializes"),
            serde_json::json!({ "kind": "tmdb", "id": 603 })
        );

        let key = crate::meta::TitleKey::Addon {
            addon: cinematic(),
            id: "tt0133093".to_owned(),
        };
        assert_eq!(
            serde_json::to_value(key).expect("a TitleKey serializes"),
            serde_json::json!({
                "kind": "addon",
                "addon": "com.linvo.cinemeta",
                "id": "tt0133093",
            })
        );
    }
}
