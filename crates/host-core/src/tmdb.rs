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
//! Videos are TMDB's where a key is held: a series' seasons and episodes are
//! read into Videos keyed `tmdb:<id>:<season>:<episode>`, which is the
//! protocol's `{title}:{season}:{episode}` rule applied to TMDB's id, and a
//! per-Addon bridge ([`ExternalId`], [`video_id`]) rewrites one into the
//! spelling each Addon declares at the moment Streams are asked for (ADR-0020).
//! The season endpoints cost one ask per season, which is what the ADR left to
//! the build to find out; the episodes of a season that could not be read are
//! dropped rather than blanking the ones around them, and a Title's Videos are
//! replaced only when *something* was read.
//!
//! ## The feed
//!
//! Discover (CONTEXT.md, *Discover*) is the one page of Titles that is not an
//! Addon's: the week TMDB says is trending, or a `/discover` page filtered by
//! genre and sort order. [`DiscoverQuery`] is a client's ask after it has been
//! judged — the two kinds do not share their genres or their `sort_by` values,
//! so the filters are judged against the kind's own lists — and it becomes one
//! of the two [`TmdbRequest`]s; [`read_page`] reads the answer leniently into
//! [`MetaPreview`]s keyed `tmdb:<id>`, the same shape a catalog row carries so
//! that a client draws both with one card. A page is never cached: it is a live
//! thing whose staleness is worse than its latency (ADR-0020).

use serde_json::{Map, Value};

use crate::addon::{MAX_ITEMS, MAX_STRING_LEN};
use crate::catalog::MetaPreview;
use crate::meta::Video;

/// Where TMDB answers questions at, in the version the marked one.
pub const TMDB_ROOT: &str = "https://api.themoviedb.org/3";

/// Where TMDB takes a poster from, at the size a card is drawn at.
///
/// TMDB documents its sizes under `/configuration`
/// (<https://developer.themoviedb.org/reference/configuration-details>):
/// `poster_sizes` has `w780`, `backdrop_sizes` has `w780` and `w1280`, the
/// largest documented still is `w300`, and `logo_sizes` ends at `w500` before
/// `original`.
pub const IMAGE_ROOT: &str = "https://image.tmdb.org/t/p/w780";

/// Where TMDB takes a wordmark from, at the size a Title screen draws one.
pub const LOGO_ROOT: &str = "https://image.tmdb.org/t/p/w500";

/// Where TMDB takes an episode's still from: the 16:9 art an episode row shows,
/// at the largest still size TMDB documents.
pub const STILL_ROOT: &str = "https://image.tmdb.org/t/p/w300";

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

    /// The addon protocol's spelling of it, which is what a `MetaPreview`'s
    /// `type` — and a Title's — is: a film is `movie` on both sides, a series is
    /// `series` here and `tv` in TMDB's paths.
    pub(crate) fn as_protocol(self) -> &'static str {
        match self {
            Self::Movie => "movie",
            Self::Tv => "series",
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

    /// The date a record of this kind is dated by on a feed: a film's release
    /// and a series' first airing.
    fn as_date_field(self) -> &'static str {
        match self {
            Self::Movie => "release_date",
            Self::Tv => "first_air_date",
        }
    }

    /// The `sort_by` values TMDB documents for this kind.
    ///
    /// The two enums are not the same set: a film has `revenue` and a series
    /// does not, and a series has `first_air_date` where a film has
    /// `primary_release_date`. Asking one kind's sort of the other is asking
    /// TMDB a question it does not answer.
    fn sorts(self) -> &'static [&'static str] {
        match self {
            Self::Movie => MOVIE_SORTS,
            Self::Tv => TV_SORTS,
        }
    }

    /// Whether `genre` is one of the genre ids TMDB lists for this kind.
    fn knows_genre(self, genre: u32) -> bool {
        match self {
            Self::Movie => MOVIE_GENRES,
            Self::Tv => TV_GENRES,
        }
        .contains(&genre)
    }
}

impl std::fmt::Display for Kind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_protocol())
    }
}

/// The genre ids TMDB lists for films, from `/genre/movie/list`.
///
/// The ids are stable and the names beside them are translations, which is why
/// a filter travels by id (research note §3). Kept here because it is the list
/// a movie's `with_genres` is judged against.
const MOVIE_GENRES: &[u32] = &[
    12, 14, 16, 18, 27, 28, 35, 36, 37, 53, 80, 99, 878, 9648, 10402, 10749, 10751, 10752, 10770,
];

/// The genre ids TMDB lists for series, from `/genre/tv/list`: not the movie
/// set. `28` is a film's Action and no series' genre, and `10759` is a series'
/// Action & Adventure and no film's.
const TV_GENRES: &[u32] = &[
    16, 18, 35, 37, 80, 99, 9648, 10751, 10759, 10762, 10763, 10764, 10765, 10766, 10767, 10768,
];

/// The `sort_by` values TMDB documents for `/discover/movie`.
const MOVIE_SORTS: &[&str] = &[
    "original_title.asc",
    "original_title.desc",
    "popularity.asc",
    "popularity.desc",
    "revenue.asc",
    "revenue.desc",
    "primary_release_date.asc",
    "primary_release_date.desc",
    "title.asc",
    "title.desc",
    "vote_average.asc",
    "vote_average.desc",
    "vote_count.asc",
    "vote_count.desc",
];

/// The `sort_by` values TMDB documents for `/discover/tv`, which are not the
/// movie set either.
const TV_SORTS: &[&str] = &[
    "first_air_date.asc",
    "first_air_date.desc",
    "name.asc",
    "name.desc",
    "original_name.asc",
    "original_name.desc",
    "popularity.asc",
    "popularity.desc",
    "vote_average.asc",
    "vote_average.desc",
    "vote_count.asc",
    "vote_count.desc",
];

/// A Discover ask, judged: the kind, the page, and the filters a client chose,
/// in TMDB's own terms.
///
/// What a client sends is the protocol's words — a `movie` or a `series`, a
/// page numbered from 1, a genre id, a `sort_by` value — and what this holds is
/// the same ask after it has been judged: the kind is TMDB's, the page is one
/// TMDB numbers, and a genre or sort is one *that kind's* list holds. Judging
/// is per kind because the two kinds' sets differ (research note §3–§5): a
/// movie genre sent to a series, or a film's `revenue` sort sent to one, is
/// refused here rather than sent to be answered with an empty page.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiscoverQuery {
    pub kind: Kind,
    pub page: u32,
    pub genre: Option<u32>,
    pub sort: Option<String>,
}

impl DiscoverQuery {
    /// Judge a client's ask, or why it is not one TMDB can be given.
    pub fn parse(
        kind: &str,
        page: u32,
        genre: Option<u32>,
        sort: Option<String>,
    ) -> Result<Self, DiscoverQueryError> {
        let kind = Kind::parse(kind).ok_or_else(|| DiscoverQueryError::Kind {
            kind: kind.to_owned(),
        })?;
        if page == 0 {
            return Err(DiscoverQueryError::Page { page });
        }
        if let Some(genre) = genre {
            if !kind.knows_genre(genre) {
                return Err(DiscoverQueryError::Genre { kind, genre });
            }
        }
        if let Some(sort) = &sort {
            if !kind.sorts().contains(&sort.as_str()) {
                return Err(DiscoverQueryError::Sort {
                    kind,
                    sort: sort.clone(),
                });
            }
        }

        Ok(Self {
            kind,
            page,
            genre,
            sort,
        })
    }

    /// The request this ask is: the week's trending feed where nothing filters
    /// it, and a `/discover` page where a genre or a sort order does (ADR-0020).
    pub fn request(&self) -> TmdbRequest {
        if self.genre.is_none() && self.sort.is_none() {
            TmdbRequest::Trending {
                kind: self.kind,
                page: self.page,
            }
        } else {
            TmdbRequest::Discover {
                kind: self.kind,
                page: self.page,
                genre: self.genre,
                sort: self.sort.clone(),
            }
        }
    }
}

/// Why a Discover ask is not one TMDB can be given.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum DiscoverQueryError {
    #[error("`{kind}` is not a kind TMDB discovers: it answers for a `movie` or a `series`")]
    Kind { kind: String },
    #[error("page {page} is not a page TMDB answers: its pages are numbered from 1")]
    Page { page: u32 },
    #[error("genre {genre} is not one of the genres TMDB lists for a {kind}")]
    Genre { kind: Kind, genre: u32 },
    #[error("`{sort}` is not one of the sort orders TMDB offers for a {kind}")]
    Sort { kind: Kind, sort: String },
}

/// A Search ask, judged: a query, the kind TMDB searches it in, and the page.
///
/// The query itself is judged where it enters — the one `search_query` rule the
/// Addons' `SearchCatalogs` is held to as well — so what this holds has already
/// been trimmed of the space around it and found non-empty. What is judged here
/// is what is TMDB's: the kind is one TMDB keeps records for, and the page is
/// one it numbers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SearchQuery {
    pub query: String,
    pub kind: Kind,
    pub page: u32,
}

impl SearchQuery {
    /// Judge an ask whose query the Action layer already read.
    pub fn parse(query: String, kind: &str, page: u32) -> Result<Self, SearchQueryError> {
        let kind = Kind::parse(kind).ok_or_else(|| SearchQueryError::Kind {
            kind: kind.to_owned(),
        })?;
        if page == 0 {
            return Err(SearchQueryError::Page { page });
        }

        Ok(Self { query, kind, page })
    }

    /// The request this ask is: TMDB's search for the kind, never `/search/multi`
    /// — the two kinds are two rows, and people are not Titles (ADR-0010's
    /// amendment).
    pub fn request(&self) -> TmdbRequest {
        TmdbRequest::Search {
            kind: self.kind,
            page: self.page,
            query: self.query.clone(),
        }
    }
}

/// Why a Search ask is not one TMDB can be given.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum SearchQueryError {
    #[error("`{kind}` is not a kind TMDB searches: it answers for a `movie` or a `series`")]
    Kind { kind: String },
    #[error("page {page} is not a page TMDB answers: its pages are numbered from 1")]
    Page { page: u32 },
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
        raw.parse::<u32>().ok().and_then(Self::from_number)
    }

    /// An id already a number, where it is one TMDB could have given: no
    /// record is numbered zero.
    pub fn from_number(id: u32) -> Option<Self> {
        (id > 0).then_some(Self(id))
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

/// A Video id in TMDB's own spelling: the record it plays, and where in a
/// series it sits.
///
/// `tmdb:603` is a film — the protocol's film rule is one Video whose id is the
/// item's — and `tmdb:1396:1:2` is an episode of a series by the protocol's
/// `{title}:{season}:{episode}` rule. [`crate::meta::episode_of`] is the one
/// reading of that shape, so an id it does not read as an episode is read here
/// as the record and nothing else. The kind travels with it because it was
/// judged to read the id at all, and every later question about the record —
/// which `/external_ids` to ask, which path a Title's record is at — needs it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TmdbVideo {
    pub kind: Kind,
    pub id: TmdbId,
    /// The season and the episode, where the id carries them.
    pub at: Option<(u32, u32)>,
}

/// A Video id in TMDB's spelling, or nothing where it is not one.
///
/// The kind is the one the client carried: only films and series have TMDB
/// records, so a `tmdb:` id of any other kind names nothing.
pub fn video_id(kind: &str, id: &str) -> Option<TmdbVideo> {
    let kind = Kind::parse(kind)?;

    let (record, at) = match crate::meta::episode_of(id) {
        Some((record, season, episode)) => (record, Some((season, episode))),
        None => (id, None),
    };
    let record = TmdbId::parse(record.strip_prefix("tmdb:")?)?;

    Some(TmdbVideo {
        kind,
        id: record,
        at,
    })
}

/// A Video id in TMDB's spelling: `tmdb:<id>`, or `tmdb:<id>:<season>:<episode>`
/// where the Video is an episode of one. The one place the spelling is built,
/// so a Video read from a season, a Title built from a record and an episode
/// step's next id cannot disagree about it.
pub fn video_spelling(id: TmdbId, at: Option<(u32, u32)>) -> String {
    match at {
        Some((season, episode)) => format!("tmdb:{}:{season}:{episode}", id.0),
        None => format!("tmdb:{}", id.0),
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
    /// The ids TMDB keeps for a record: which `tt…` string it answers to, one
    /// hop of the per-Addon bridge (ADR-0020).
    ExternalIds { kind: Kind, id: TmdbId },
    /// One season's episodes, by the record and the season number TMDB gave it.
    /// Seasons are a series' shape only.
    Season { id: TmdbId, season: u32 },
    /// The week of what a kind has trending, at `page`.
    Trending { kind: Kind, page: u32 },
    /// A `/discover` page for a kind: the filters a [`DiscoverQuery`] judged.
    Discover {
        kind: Kind,
        page: u32,
        genre: Option<u32>,
        sort: Option<String>,
    },
    /// A `/search` page for a kind: the query a [`SearchQuery`] judged, asked
    /// of the kind's own endpoint rather than `/search/multi`.
    Search {
        kind: Kind,
        page: u32,
        query: String,
    },
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
            Self::ExternalIds { kind, id } => {
                url.push('/');
                url.push_str(kind.as_resource());
                url.push('/');
                url.push_str(&id.0.to_string());
                url.push_str("/external_ids");
            }
            Self::Season { id, season } => {
                url.push_str("/tv/");
                url.push_str(&id.0.to_string());
                url.push_str("/season/");
                url.push_str(&season.to_string());
            }
            Self::Trending { kind, page } => {
                url.push_str("/trending/");
                url.push_str(kind.as_resource());
                url.push_str("/week?page=");
                url.push_str(&page.to_string());
            }
            Self::Discover {
                kind,
                page,
                genre,
                sort,
            } => {
                url.push_str("/discover/");
                url.push_str(kind.as_resource());
                url.push_str("?page=");
                url.push_str(&page.to_string());
                if let Some(genre) = genre {
                    url.push_str("&with_genres=");
                    url.push_str(&genre.to_string());
                }
                if let Some(sort) = sort {
                    url.push_str("&sort_by=");
                    url.push_str(&encode(sort));
                }
            }
            Self::Search { kind, page, query } => {
                url.push_str("/search/");
                url.push_str(kind.as_resource());
                url.push_str("?query=");
                url.push_str(&encode(query));
                url.push_str("&page=");
                url.push_str(&page.to_string());
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

/// What TMDB says about a series' run, in the three states the Title cache
/// treats differently.
///
/// TMDB's `status` is a free string with six staff-confirmed values. Four of
/// them (`Returning Series`, `In Production`, `Planned`, `Pilot`) say the
/// series is still running; `Ended` and `Canceled` say it has stopped. A value
/// the Host does not know is no answer rather than a guess (ADR-0038 §2).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SeriesStatus {
    Running,
    Ended,
    Cancelled,
}

impl SeriesStatus {
    /// Read TMDB's status string, where it is one the Host knows.
    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "Returning Series" | "In Production" | "Planned" | "Pilot" => Some(Self::Running),
            "Ended" => Some(Self::Ended),
            "Canceled" => Some(Self::Cancelled),
            _ => None,
        }
    }

    /// The word the store keeps it under.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Running => "running",
            Self::Ended => "ended",
            Self::Cancelled => "cancelled",
        }
    }

    /// Read the store's word back.
    pub fn from_stored(raw: &str) -> Option<Self> {
        match raw {
            "running" => Some(Self::Running),
            "ended" => Some(Self::Ended),
            "cancelled" => Some(Self::Cancelled),
            _ => None,
        }
    }

    /// Whether the series is still gaining episodes, which is what makes its
    /// cached copy worth re-reading after a day rather than a month.
    pub fn is_running(self) -> bool {
        matches!(self, Self::Running)
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
    /// The backdrop, built the same way, at the size a 16:9 hero is drawn at.
    pub background: Option<String>,
    /// The wordmark, where TMDB has one.
    pub logo: Option<String>,
    /// The year a film was released, or a series' years: `1999`, `2008–2013`,
    /// the shape the Host already publishes.
    pub release_info: Option<String>,
    /// How long it runs, as the Host spells it: `136 min`.
    pub runtime: Option<String>,
    /// TMDB's own score for the record — `vote_average`, one decimal — which is
    /// the rating a TMDB-supplied Title carries. The Title has one rating field
    /// — `imdbRating`, which is what the facts row draws — and where TMDB
    /// answered, its score is what fills it; an Addon's `imdbRating` stands only
    /// where TMDB said nothing at all. TMDB's score is not IMDb's, and it is not
    /// offered as IMDb's: it is the record's word for how good the thing is.
    pub rating: Option<String>,
    /// The genres' names, where TMDB answered with any.
    pub genres: Vec<String>,
    /// Which seasons the record lists, ascending: each is asked for its
    /// episodes when a series' Videos are read. Empty for a film.
    pub seasons: Vec<u32>,
    /// Whether TMDB says the series is running, ended or cancelled — the fact
    /// the Title cache's freshness window turns on (ADR-0038 §2). `None` for a
    /// film, a record that sent no status, and a status the Host does not know.
    pub status: Option<SeriesStatus>,
    /// The record's Videos, where they were read: a series' seasons and
    /// episodes, keyed `tmdb:<id>:<season>:<episode>`. `None` is "not read" —
    /// a film's list, or a series whose season answers were not read — and
    /// leaves the Title's own Videos standing (ADR-0011's amendment).
    pub videos: Option<Vec<Video>>,
}

impl TmdbDetails {
    /// The same record with its Videos read, so that one merge carries both.
    pub fn with_videos(mut self, videos: Option<Vec<Video>>) -> Self {
        self.videos = videos;
        self
    }

    /// TMDB metadata onto the Title that was asking, where TMDB has it.
    ///
    /// Every field TMDB did not send keeps the Addon's word; every field it did
    /// send takes TMDB's. The Title's identity fields — the Addon that
    /// answered and the id it opened by — are not TMDB's to speak for. Its
    /// Videos are: where they were read, they replace the Addon's episode list
    /// whole, because a season's episodes are one answer and half of TMDB's
    /// list beside half of an Addon's would be a series nobody could play in
    /// order (ADR-0011's amendment, ADR-0020).
    pub fn onto(self, title: &mut crate::meta::Title) {
        if let Some(name) = self.name {
            title.name = name;
        }
        if let Some(poster) = self.poster {
            title.poster = Some(poster);
        }
        if let Some(background) = self.background {
            title.background = Some(background);
        }
        if let Some(logo) = self.logo {
            title.logo = Some(logo);
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
        if let Some(rating) = self.rating {
            title.imdb_rating = Some(rating);
        }
        if !self.genres.is_empty() {
            title.genres = self.genres;
        }
        if let Some(videos) = self.videos {
            title.videos = videos;
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
    #[error("the {field} is longer than this Host will hold ({limit})")]
    TooLarge { field: String, limit: usize },
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
        background: image(record.object, "backdrop_path"),
        logo: record.image("logo_path", LOGO_ROOT),
        release_info: record.release_info(),
        runtime: record.runtime(),
        rating: rating(record.object),
        genres: record.genres(),
        seasons: record.seasons(),
        status: match kind {
            Kind::Tv => record
                .object
                .get("status")
                .and_then(Value::as_str)
                .and_then(SeriesStatus::parse),
            // A film's `status` says "Released", which is not a series' run.
            Kind::Movie => None,
        },
        videos: None,
    })
}

/// Which IMDb id TMDB keeps for a record, where it keeps one.
///
/// The answer to `/movie/{id}/external_ids` is `{"id":…,"imdb_id":"tt…",…}`,
/// and the id is read only where it is an IMDb one — an `imdb_id` that is not
/// `tt` and digits is a field the answer did not carry. An answer that is not
/// an object at all is a fact about TMDB, not a record with no IMDb id.
pub fn read_external_ids(body: &str) -> Result<Option<String>, TmdbError> {
    let value: Value = serde_json::from_str(body).map_err(|error| TmdbError::NotJson {
        detail: error.to_string(),
    })?;
    let record = value.as_object().ok_or_else(|| TmdbError::NotJson {
        detail: "an external ids answer is a JSON object".to_owned(),
    })?;

    Ok(string(record, "imdb_id").filter(|imdb| {
        imdb.strip_prefix("tt")
            .is_some_and(|digits| !digits.is_empty() && digits.chars().all(|c| c.is_ascii_digit()))
    }))
}

/// One season's episodes, read into the Host's Videos.
///
/// The episodes arrive at `/tv/{id}/season/{season}` as an `episodes` array,
/// each carrying the `episode_number` TMDB numbered it by and, where there is
/// one, the `still_path` of its 16:9 still. Each becomes a Video keyed
/// `tmdb:<id>:<season>:<episode>` — the id every Stream ask and every Watch
/// progress entry is keyed by (ADR-0020). A record that cannot be read is
/// dropped rather than blanking the season around it, the way one bad catalog
/// item is dropped; an `episodes` that is not a list is a body that is not a
/// season answer and is refused.
pub fn read_season(body: &str, id: TmdbId, season: u32) -> Result<Vec<Video>, TmdbError> {
    let value: Value = serde_json::from_str(body).map_err(|error| TmdbError::NotJson {
        detail: error.to_string(),
    })?;
    let record = value.as_object().ok_or_else(|| TmdbError::NotJson {
        detail: "a season answer is a JSON object".to_owned(),
    })?;

    let episodes = match record.get("episodes") {
        None | Some(Value::Null) => return Ok(Vec::new()),
        Some(value) => value.as_array().ok_or_else(|| TmdbError::NotJson {
            detail: "a season's episodes should be an array".to_owned(),
        })?,
    };
    if episodes.len() > MAX_ITEMS {
        return Err(TmdbError::TooLarge {
            field: "episodes".to_owned(),
            limit: MAX_ITEMS,
        });
    }

    let mut videos: Vec<Video> = episodes
        .iter()
        .filter_map(|episode| {
            let episode = episode.as_object()?;
            let number = unsigned(episode, "episode_number")?;

            Some(Video {
                id: video_spelling(id, Some((season, number))),
                name: string(episode, "name"),
                season: Some(season),
                episode: Some(number),
                thumbnail: still(episode),
            })
        })
        .collect();
    videos.sort_by_key(|video| video.episode);

    Ok(videos)
}

/// One page of TMDB records, read into the previews a row is drawn from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TmdbPage {
    /// How many results the answer carried, including any this Host could not
    /// read — the same count a catalog row carries, so a page with one unread
    /// record in it does not look like a shorter one.
    pub sent: usize,
    /// The items, in TMDB's own order, each keyed `tmdb:<id>`.
    pub metas: Vec<MetaPreview>,
}

/// One page of a trending or discover answer, after the manner a catalog page
/// is read.
///
/// A result that lies — no id, no name, a type that is not this kind's — is
/// *dropped* rather than allowed to blank the page around it; a body that is
/// not a page at all is refused, because that is a fact about TMDB rather than
/// about one record. The kind is the one the page was asked for, and it is what
/// decides where a record's name and date live (`title` for a film, `name` for
/// a series).
pub fn read_page(body: &str, kind: Kind) -> Result<TmdbPage, TmdbError> {
    let value: Value = serde_json::from_str(body).map_err(|error| TmdbError::NotJson {
        detail: error.to_string(),
    })?;
    let object = value.as_object().ok_or_else(|| TmdbError::NotJson {
        detail: "a page answer is a JSON object".to_owned(),
    })?;

    let results = object
        .get("results")
        .and_then(Value::as_array)
        .ok_or_else(|| TmdbError::NotJson {
            detail: "the results should be an array".to_owned(),
        })?;
    if results.len() > MAX_ITEMS {
        return Err(TmdbError::TooLarge {
            field: "results".to_owned(),
            limit: MAX_ITEMS,
        });
    }

    Ok(TmdbPage {
        sent: results.len(),
        metas: results
            .iter()
            .filter_map(|result| preview(result, kind))
            .collect(),
    })
}

/// One TMDB record, as the Meta preview a row carries — or nothing when it
/// cannot be read as one.
fn preview(value: &Value, kind: Kind) -> Option<MetaPreview> {
    let record = value.as_object()?;
    let id = record
        .get("id")
        .and_then(Value::as_u64)
        .and_then(|id| u32::try_from(id).ok())
        .filter(|id| *id > 0)?;

    Some(MetaPreview {
        id: format!("tmdb:{id}"),
        r#type: kind.as_protocol().to_owned(),
        name: string(record, kind.as_name_field())?,
        poster: image(record, "poster_path"),
        // A card drawn from a feed says what the protocol assumes of a poster
        // and nothing else: TMDB sends no `poster_shape`, and inventing one
        // would be the Host speaking for it.
        poster_shape: None,
        background: image(record, "backdrop_path"),
        release_info: date(record, kind.as_date_field()).map(|when| when.year.to_string()),
        imdb_rating: rating(record),
        // The genre *ids* are in the answer and the genre *names* are not;
        // naming them would be a second list this Host keeps, and a card drawn
        // from Discover shows the poster and the name.
        genres: Vec::new(),
        description: string(record, "overview"),
    })
}

/// One of a record's image fields, as the absolute URL a card is drawn from:
/// the path is relative in the answer, and an address builds only from one that
/// says it is.
fn image(record: &Map<String, Value>, field: &str) -> Option<String> {
    image_at(record, field, IMAGE_ROOT)
}

/// The same, at the size asked for: a poster and a backdrop are both drawn at
/// `IMAGE_ROOT`'s `w780`, a wordmark at `LOGO_ROOT`'s `w500` and an episode's
/// still at `STILL_ROOT`'s `w300` — every one of them a size `/configuration`
/// documents.
fn image_at(record: &Map<String, Value>, field: &str, root: &str) -> Option<String> {
    let path = string(record, field)?;
    path.starts_with('/').then(|| format!("{root}{path}"))
}

/// TMDB's own score on the record, where anybody has voted on it: nobody's zero
/// is not a rating, so an unvoted record carries none.
fn rating(record: &Map<String, Value>) -> Option<String> {
    let voted = record
        .get("vote_count")
        .and_then(Value::as_u64)
        .unwrap_or(0)
        > 0;
    let average = record.get("vote_average").and_then(Value::as_f64)?;

    (voted && average > 0.0).then(|| format!("{average:.1}"))
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
        image(self.object, "poster_path")
    }

    /// One image field, at the size asked for — the wordmark and a still are
    /// not drawn at a card's size.
    fn image(&self, field: &str, root: &str) -> Option<String> {
        image_at(self.object, field, root)
    }
    /// The season numbers the record lists, ascending and each once. `0` is a
    /// series' specials, which are episodes like any others; a film lists no
    /// seasons, whatever a body pretending to be its record carries.
    fn seasons(&self) -> Vec<u32> {
        if self.kind != Kind::Tv {
            return Vec::new();
        }
        let mut seasons: Vec<u32> = self
            .object
            .get("seasons")
            .and_then(Value::as_array)
            .map(|seasons| {
                seasons
                    .iter()
                    .filter_map(|season| season.as_object())
                    .filter_map(|season| unsigned(season, "season_number"))
                    .collect()
            })
            .unwrap_or_default();
        seasons.sort_unstable();
        seasons.dedup();
        seasons.truncate(crate::addon::MAX_ITEMS);

        seasons
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

/// One named field of a record, read as a non-empty string of a length the Host
/// will hold. A field of the wrong shape, an empty one and an overlong one are
/// all absence — the leniency the module's preamble describes, applied to every
/// field.
fn string(object: &Map<String, Value>, name: &str) -> Option<String> {
    let text = object.get(name)?.as_str()?;
    if text.is_empty() || text.len() > MAX_STRING_LEN {
        return None;
    }
    Some(text.to_owned())
}

/// One named field of a record, read as a number.
fn unsigned(object: &Map<String, Value>, name: &str) -> Option<u32> {
    object
        .get(name)
        .and_then(Value::as_u64)
        .and_then(|number| u32::try_from(number).ok())
}

/// An episode's still, at the size an episode row draws it.
fn still(episode: &Map<String, Value>) -> Option<String> {
    image_at(episode, "still_path", STILL_ROOT)
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
    const SEASON_0: &str = include_str!("../tests/fixtures/tmdb-tv-season-0.json");
    const SEASON_1: &str = include_str!("../tests/fixtures/tmdb-tv-season-1.json");
    const EXTERNAL_MATRIX: &str = include_str!("../tests/fixtures/tmdb-external-ids-matrix.json");
    const EXTERNAL_BB: &str = include_str!("../tests/fixtures/tmdb-external-ids-bb.json");
    const PAGE_MOVIE: &str = include_str!("../tests/fixtures/tmdb-page-movie.json");
    const PAGE_TV: &str = include_str!("../tests/fixtures/tmdb-page-tv.json");

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

        let external = TmdbRequest::ExternalIds {
            kind: Kind::Movie,
            id: TmdbId(603),
        };
        assert_eq!(
            external.url(&token("a-key")),
            "https://api.themoviedb.org/3/movie/603/external_ids?api_key=a-key",
            "the ids TMDB keeps are a record's own sub-resource"
        );

        let season = TmdbRequest::Season {
            id: TmdbId(1396),
            season: 0,
        };
        assert_eq!(
            season.url(&token("a-key")),
            "https://api.themoviedb.org/3/tv/1396/season/0?api_key=a-key",
            "specials are season zero, which is a season number like any other"
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
            TmdbRequest::ExternalIds {
                kind: Kind::Tv,
                id: TmdbId(1396),
            },
            TmdbRequest::Season {
                id: TmdbId(1396),
                season: 1,
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
        assert!(
            details
                .background
                .as_deref()
                .is_some_and(|background| background.starts_with(IMAGE_ROOT)),
            "the backdrop is at the size a 16:9 hero draws: {:?}",
            details.background
        );
        assert_eq!(
            details.rating.as_deref(),
            Some("8.2"),
            "TMDB's own score, which is the rating a TMDB-supplied Title carries"
        );
        assert_eq!(details.release_info.as_deref(), Some("1999"));
        assert_eq!(details.runtime.as_deref(), Some("136 min"));
        assert_eq!(details.genres, vec!["Action", "Science Fiction"]);
        assert!(
            details.seasons.is_empty(),
            "a film has no seasons to ask for: {:?}",
            details.seasons
        );
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
        assert_eq!(
            details.seasons,
            vec![0, 1, 2],
            "the record says which seasons to ask for, ascending, specials included"
        );
        assert_eq!(
            details.logo.as_deref(),
            Some("https://image.tmdb.org/t/p/w500/bb-logo.png")
        );
    }

    #[test]
    fn a_season_is_read_into_videos_keyed_by_tmdb_and_carrying_its_stills() {
        let videos = read_season(SEASON_1, TmdbId(1396), 1).expect("a season answer");

        assert_eq!(
            videos
                .iter()
                .map(|video| video.id.as_str())
                .collect::<Vec<_>>(),
            vec!["tmdb:1396:1:1", "tmdb:1396:1:2", "tmdb:1396:1:3",],
            "the protocol's `{{title}}:{{season}}:{{episode}}` rule over TMDB's id"
        );
        assert_eq!(videos[0].name.as_deref(), Some("Pilot"));
        assert_eq!((videos[0].season, videos[0].episode), (Some(1), Some(1)));
        assert_eq!(
            videos[1].thumbnail.as_deref(),
            Some("https://image.tmdb.org/t/p/w300/still-1396-1-2.jpg"),
            "an episode row draws the 16:9 still TMDB sent"
        );
    }

    #[test]
    fn specials_are_a_season_like_any_other_with_nothing_to_draw() {
        let videos = read_season(SEASON_0, TmdbId(1396), 0).expect("a season answer");

        assert_eq!(videos.len(), 1);
        assert_eq!(videos[0].id, "tmdb:1396:0:1");
        assert_eq!(
            (videos[0].season, videos[0].episode),
            (Some(0), Some(1)),
            "season zero is how the protocol spells a special"
        );
        assert_eq!(
            videos[0].thumbnail, None,
            "a still TMDB did not send is absence, not a broken URL"
        );
    }

    #[test]
    fn a_season_answer_that_is_not_one_is_refused_or_read_as_empty() {
        for body in ["", "not json", "[]", "5", "\"a season\""] {
            assert!(
                matches!(
                    read_season(body, TmdbId(1396), 1),
                    Err(TmdbError::NotJson { .. })
                ),
                "{body:?} is not a season answer"
            );
        }
        assert_eq!(
            read_season(r#"{"episodes":5}"#, TmdbId(1396), 1),
            Err(TmdbError::NotJson {
                detail: "a season's episodes should be an array".to_owned()
            })
        );
        assert_eq!(
            read_season(r#"{"season_number":1}"#, TmdbId(1396), 1),
            Ok(Vec::new()),
            "a season with no episodes to read is a season with none"
        );
    }

    #[test]
    fn a_season_record_that_cannot_be_read_is_dropped_rather_than_blanking_the_season() {
        let videos = read_season(
            r#"{"episodes":[
                {"episode_number":1,"name":"One","still_path":"/one.jpg"},
                {"name":"no number, so nobody can play it"},
                "not an episode",
                {"episode_number":3,"name":"Three"}
            ]}"#,
            TmdbId(1396),
            1,
        )
        .expect("a season answer");

        assert_eq!(
            videos
                .iter()
                .map(|video| video.id.as_str())
                .collect::<Vec<_>>(),
            vec!["tmdb:1396:1:1", "tmdb:1396:1:3"],
            "the two that read survive the two that do not"
        );
        assert_eq!(
            videos[1].thumbnail, None,
            "an episode with no still is one with no still"
        );
    }

    #[test]
    fn an_external_ids_answer_carries_the_imdb_id_or_nothing() {
        assert_eq!(
            read_external_ids(EXTERNAL_MATRIX),
            Ok(Some("tt0133093".to_owned()))
        );
        assert_eq!(
            read_external_ids(EXTERNAL_BB),
            Ok(Some("tt0903747".to_owned()))
        );

        for body in [
            r#"{"id":603,"imdb_id":null}"#,
            r#"{"id":603}"#,
            r#"{"id":603,"imdb_id":"nm0000206"}"#,
            r#"{"id":603,"imdb_id":"tt"}"#,
            r#"{"id":603,"imdb_id":5}"#,
        ] {
            assert_eq!(
                read_external_ids(body),
                Ok(None),
                "{body} names no IMDb id this Host will send, which is not a failed read"
            );
        }

        for body in ["", "not json", "[]", "5", "null"] {
            assert!(
                matches!(read_external_ids(body), Err(TmdbError::NotJson { .. })),
                "{body:?} is not an external ids answer"
            );
        }
    }

    #[test]
    fn a_tmdb_video_id_names_the_record_and_where_a_video_sits_in_it() {
        assert_eq!(
            video_id("movie", "tmdb:603"),
            Some(TmdbVideo {
                kind: Kind::Movie,
                id: TmdbId(603),
                at: None
            }),
            "a film is one Video whose id is the record's"
        );
        assert_eq!(
            video_id("series", "tmdb:1396:1:2"),
            Some(TmdbVideo {
                kind: Kind::Tv,
                id: TmdbId(1396),
                at: Some((1, 2))
            })
        );
        assert_eq!(
            video_id("series", "tmdb:1396:0:1"),
            Some(TmdbVideo {
                kind: Kind::Tv,
                id: TmdbId(1396),
                at: Some((0, 1))
            }),
            "specials are season zero"
        );

        for (kind, id) in [
            ("movie", "tt0133093"),
            ("movie", "tmdb:0"),
            ("movie", "tmdb:"),
            ("series", "tmdb:1396:1"),
            ("series", "tmdb:1396:x:1"),
            ("channel", "tmdb:603"),
        ] {
            assert_eq!(
                video_id(kind, id),
                None,
                "{kind}/{id} is not a Video TMDB keys"
            );
        }
    }

    #[test]
    fn details_onto_replace_every_video_only_where_they_were_read() {
        let mut title = addon_movie();
        read_details(MOVIE_DETAILS, Kind::Movie)
            .expect("a details answer")
            .with_videos(Some(vec![crate::meta::Video {
                id: "tmdb:603".to_owned(),
                name: Some("The Matrix".to_owned()),
                season: None,
                episode: None,
                thumbnail: None,
            }]))
            .onto(&mut title);
        assert_eq!(
            title
                .videos
                .iter()
                .map(|video| video.id.as_str())
                .collect::<Vec<_>>(),
            vec!["tmdb:603"],
            "the Videos TMDB answered with are the Title's"
        );

        let mut series_title = Title::parse(
            CINEMETA_SERIES,
            cinematic(),
            &TitleRef::parse("series", "tt0903747").expect("a Title"),
        )
        .expect("the Addon's Title parses");
        let before = series_title.videos.clone();
        read_details(TV_DETAILS, Kind::Tv)
            .expect("a details answer")
            .onto(&mut series_title);
        assert_eq!(
            series_title.videos, before,
            "a merge that read no Videos leaves the Addon's episode list standing"
        );
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
    fn a_series_record_says_whether_it_is_running_ended_or_cancelled() {
        // The stored freshness window turns on this: a running series is read
        // again after a day, an ended or cancelled one after a month. TMDB
        // spells the running states four ways, and its status is a free string,
        // so anything else is no answer rather than a guess.
        assert_eq!(
            read_details(TV_DETAILS, Kind::Tv)
                .expect("a details answer")
                .status,
            Some(SeriesStatus::Ended)
        );
        assert_eq!(
            read_details(TV_DETAILS_MAKING, Kind::Tv)
                .expect("a details answer")
                .status,
            Some(SeriesStatus::Running)
        );
        for running in ["Returning Series", "In Production", "Planned", "Pilot"] {
            let body = format!(r#"{{"id":1396,"status":"{running}"}}"#);
            assert_eq!(
                read_details(&body, Kind::Tv)
                    .expect("a details answer")
                    .status,
                Some(SeriesStatus::Running),
                "{running} is still running"
            );
        }
        assert_eq!(
            read_details(r#"{"id":1396,"status":"Canceled"}"#, Kind::Tv)
                .expect("a details answer")
                .status,
            Some(SeriesStatus::Cancelled),
            "TMDB spells it with one l"
        );
        assert_eq!(
            read_details(r#"{"id":1396,"status":"Something New"}"#, Kind::Tv)
                .expect("a details answer")
                .status,
            None,
            "a status the Host does not know is no answer rather than a guess"
        );
        assert_eq!(
            read_details(MOVIE_DETAILS, Kind::Movie)
                .expect("a details answer")
                .status,
            None,
            "a film released is not a series still running"
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
        assert_eq!(
            title.imdb_rating.as_deref(),
            Some("8.2"),
            "the rating became TMDB's own score, which is the one it has"
        );
        assert!(
            title.background.is_some(),
            "the backdrop arrived: {title:?}"
        );
        assert_eq!(
            title.logo.as_deref(),
            Some("https://image.tmdb.org/t/p/w500/matrix-logo.png"),
            "and so did the wordmark"
        );
    }

    #[test]
    fn the_identity_is_never_tmdbs_to_rename() {
        let mut series_title = Title::parse(
            CINEMETA_SERIES,
            cinematic(),
            &TitleRef::parse("series", "tt0903747").expect("a Title"),
        )
        .expect("the Addon's Title parses");
        read_details(TV_DETAILS, Kind::Tv)
            .expect("a details answer")
            .onto(&mut series_title);

        assert_eq!(
            series_title.addon.as_ref().map(|addon| addon.as_str()),
            Some("com.linvo.cinemeta")
        );
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
            "a details answer rekeys nothing: the Videos TMDB read replace the list whole, and nothing else does"
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

    #[test]
    fn a_discover_ask_becomes_the_trending_feed_when_nothing_filters_it() {
        let ask = DiscoverQuery::parse("movie", 1, None, None).expect("an ask TMDB can be given");

        assert_eq!(ask.kind, Kind::Movie);
        assert_eq!(
            ask.request(),
            TmdbRequest::Trending {
                kind: Kind::Movie,
                page: 1,
            },
            "neither a genre nor a sort: the week TMDB calls trending"
        );
    }

    #[test]
    fn a_discover_ask_with_a_filter_becomes_a_discover_page() {
        let ask = DiscoverQuery::parse(
            "series",
            2,
            Some(10765),
            Some("vote_average.desc".to_owned()),
        )
        .expect("an ask TMDB can be given");

        assert_eq!(ask.kind, Kind::Tv);
        assert_eq!(
            ask.request(),
            TmdbRequest::Discover {
                kind: Kind::Tv,
                page: 2,
                genre: Some(10765),
                sort: Some("vote_average.desc".to_owned()),
            },
            "a genre alone and a sort alone filter it too, and both become /discover"
        );

        let genre_only = DiscoverQuery::parse("movie", 1, Some(28), None).expect("an ask");
        assert_eq!(
            genre_only.request(),
            TmdbRequest::Discover {
                kind: Kind::Movie,
                page: 1,
                genre: Some(28),
                sort: None,
            }
        );
    }

    #[test]
    fn a_discover_ask_is_judged_against_its_own_kinds_genres_and_sorts() {
        // The two lists are not the same set (research note §3): Action is 28
        // for a film and 10759 for a series, and neither id is the other's.
        assert!(DiscoverQuery::parse("movie", 1, Some(28), None).is_ok());
        assert!(DiscoverQuery::parse("series", 1, Some(10759), None).is_ok());
        assert!(DiscoverQuery::parse("movie", 1, None, Some("revenue.desc".to_owned())).is_ok());
        assert!(
            DiscoverQuery::parse("series", 1, None, Some("first_air_date.asc".to_owned())).is_ok()
        );

        assert_eq!(
            DiscoverQuery::parse("series", 1, Some(28), None),
            Err(DiscoverQueryError::Genre {
                kind: Kind::Tv,
                genre: 28,
            }),
            "a film's Action is not a series' genre"
        );
        assert_eq!(
            DiscoverQuery::parse("movie", 1, Some(10759), None),
            Err(DiscoverQueryError::Genre {
                kind: Kind::Movie,
                genre: 10759,
            }),
            "a series' Action & Adventure is not a film's genre"
        );
        assert_eq!(
            DiscoverQuery::parse("series", 1, None, Some("revenue.desc".to_owned())),
            Err(DiscoverQueryError::Sort {
                kind: Kind::Tv,
                sort: "revenue.desc".to_owned(),
            }),
            "a film has revenue and a series does not"
        );
        assert_eq!(
            DiscoverQuery::parse("movie", 1, None, Some("first_air_date.desc".to_owned())),
            Err(DiscoverQueryError::Sort {
                kind: Kind::Movie,
                sort: "first_air_date.desc".to_owned(),
            }),
            "a series has a first air date and a film does not"
        );
    }

    #[test]
    fn a_discover_ask_that_is_not_one_says_what_is_wrong() {
        assert_eq!(
            DiscoverQuery::parse("channel", 1, None, None),
            Err(DiscoverQueryError::Kind {
                kind: "channel".to_owned()
            }),
            "the protocol's kinds that TMDB does not answer for are not kinds here"
        );
        assert_eq!(
            DiscoverQuery::parse("tv", 1, None, None),
            Err(DiscoverQueryError::Kind {
                kind: "tv".to_owned()
            }),
            "TMDB's own word for a series is not the client's"
        );
        assert_eq!(
            DiscoverQuery::parse("movie", 0, None, None),
            Err(DiscoverQueryError::Page { page: 0 }),
            "TMDB numbers its pages from 1"
        );
    }

    #[test]
    fn a_discover_request_asks_tmdb_where_the_kinds_own_parameters_go() {
        let trending = TmdbRequest::Trending {
            kind: Kind::Movie,
            page: 2,
        };
        assert_eq!(
            trending.url(&token("a-key")),
            "https://api.themoviedb.org/3/trending/movie/week?page=2&api_key=a-key",
        );

        let filtered = TmdbRequest::Discover {
            kind: Kind::Tv,
            page: 3,
            genre: Some(10765),
            sort: Some("vote_average.desc".to_owned()),
        };
        assert_eq!(
            filtered.url(&token("a-key")),
            "https://api.themoviedb.org/3/discover/tv?page=3&with_genres=10765&sort_by=vote_average.desc&api_key=a-key",
        );

        let bare = TmdbRequest::Discover {
            kind: Kind::Movie,
            page: 1,
            genre: None,
            sort: None,
        };
        assert_eq!(
            bare.url(&token("a-key")),
            "https://api.themoviedb.org/3/discover/movie?page=1&api_key=a-key",
            "a filter the client did not choose is not sent at all"
        );
    }

    #[test]
    fn a_token_makes_a_feeds_url_clean_of_every_credential_it_carries() {
        let the_token = "eyJhbGciOiJIUzI1NiJ9.eyJzY29wZSI6InJlYWQifQ.a-signature";

        for request in [
            TmdbRequest::Trending {
                kind: Kind::Movie,
                page: 1,
            },
            TmdbRequest::Discover {
                kind: Kind::Tv,
                page: 1,
                genre: Some(10765),
                sort: None,
            },
            TmdbRequest::Search {
                kind: Kind::Movie,
                page: 1,
                query: "matrix".to_owned(),
            },
        ] {
            let built = request.url(&token(the_token));
            assert!(
                !built.contains(the_token) && !built.contains("api_key"),
                "a token in the header never appears in the URL it travelled beside: {built}"
            );
        }
    }

    #[test]
    fn a_search_ask_becomes_a_search_of_its_own_kind() {
        let ask =
            SearchQuery::parse("matrix".to_owned(), "series", 2).expect("an ask TMDB can be given");

        assert_eq!(ask.kind, Kind::Tv);
        assert_eq!(
            ask.request(),
            TmdbRequest::Search {
                kind: Kind::Tv,
                page: 2,
                query: "matrix".to_owned(),
            },
            "a series searches /search/tv, never /search/multi"
        );
    }

    #[test]
    fn a_search_ask_that_is_not_one_says_what_is_wrong() {
        assert_eq!(
            SearchQuery::parse("matrix".to_owned(), "channel", 1),
            Err(SearchQueryError::Kind {
                kind: "channel".to_owned()
            }),
            "the protocol's kinds that TMDB does not answer for are not kinds here"
        );
        assert_eq!(
            SearchQuery::parse("matrix".to_owned(), "movie", 0),
            Err(SearchQueryError::Page { page: 0 }),
            "TMDB numbers its pages from 1"
        );
    }

    #[test]
    fn a_search_request_carries_its_query_encoded_and_its_page_beside_it() {
        let request = TmdbRequest::Search {
            kind: Kind::Movie,
            page: 1,
            query: "blood & guts".to_owned(),
        };

        assert_eq!(
            request.url(&token("a-key")),
            "https://api.themoviedb.org/3/search/movie?query=blood%20%26%20guts&page=1&api_key=a-key",
            "an Ampersand in a query survives only encoded"
        );
    }

    #[test]
    fn a_recorded_film_page_is_read_into_tmdb_keyed_previews() {
        let page = read_page(PAGE_MOVIE, Kind::Movie).expect("a page answer");

        assert_eq!(page.sent, 2);
        let first = &page.metas[0];
        assert_eq!(
            first.id, "tmdb:603",
            "the id is TMDB's own, keyed so a client can act on it"
        );
        assert_eq!(first.r#type, "movie");
        assert_eq!(first.name, "The Matrix");
        assert_eq!(first.release_info.as_deref(), Some("1999"));
        assert_eq!(first.imdb_rating.as_deref(), Some("8.2"));
        assert!(
            first.poster.as_deref().is_some_and(
                |poster| poster == "https://image.tmdb.org/t/p/w780/p96dm7kpeOlUwhich.jpg"
            ),
            "the poster is the path asked at the size a card draws: {:?}",
            first.poster
        );
        assert!(
            first
                .background
                .as_deref()
                .is_some_and(|background| background
                    == "https://image.tmdb.org/t/p/w780/f89U3ADr1oiBwOy1K7t4E93Xu5A.jpg"),
            "the backdrop beside it is the 16:9 art a hero draws: {:?}",
            first.background
        );
        assert!(first.description.is_some());
        assert_eq!(
            page.metas[1].id, "tmdb:640146",
            "the order is TMDB's, and an item is not reordered or dropped"
        );
    }

    #[test]
    fn a_recorded_series_page_is_read_the_way_a_series_spells_itself() {
        let page = read_page(PAGE_TV, Kind::Tv).expect("a page answer");

        assert_eq!(page.sent, 2);
        let first = &page.metas[0];
        assert_eq!(first.id, "tmdb:1396");
        assert_eq!(first.r#type, "series", "the protocol's word for TMDB's tv");
        assert_eq!(
            first.name, "Breaking Bad",
            "a series names itself in `name`"
        );
        assert_eq!(
            first.release_info.as_deref(),
            Some("2008"),
            "a feed dates a series by its first airing"
        );
        assert_eq!(first.imdb_rating.as_deref(), Some("8.9"));
        assert!(first.poster.is_some() && first.background.is_some());
    }

    #[test]
    fn a_page_item_that_lies_is_dropped_rather_than_blanking_the_page() {
        let body = serde_json::json!({
            "page": 1,
            "results": [
                { "id": 603, "title": "The Matrix", "release_date": "1999-03-31" },
                5,
                { "title": "no id", "release_date": "1999-03-31" },
                { "id": 0, "title": "no record is numbered zero" },
                { "id": 604, "title": "" },
                { "id": 605, "name": "a series' name on a film's page" },
                { "id": 606, "title": "One", "poster_path": "not-a-path" },
            ],
        })
        .to_string();

        let page = read_page(&body, Kind::Movie).expect("a page answer");

        assert_eq!(
            page.sent, 7,
            "every result was in the page, readable or not"
        );
        assert_eq!(
            page.metas
                .iter()
                .map(|meta| meta.id.as_str())
                .collect::<Vec<_>>(),
            vec!["tmdb:603", "tmdb:606"],
            "the records that read survive the ones that do not"
        );
        assert_eq!(
            page.metas[1].poster, None,
            "a path that is not one is no address rather than a broken one"
        );
    }

    #[test]
    fn a_record_that_nobody_voted_on_carries_no_rating() {
        let body = r#"{"results":[{"id":1,"title":"Unreleased","vote_average":0,"vote_count":0}]}"#;
        let page = read_page(body, Kind::Movie).expect("a page answer");

        assert_eq!(page.metas[0].imdb_rating, None);
    }

    #[test]
    fn a_page_that_is_not_one_is_refused() {
        for body in [
            "",
            "not json",
            "[]",
            "5",
            "null",
            "\"a page\"",
            r#"{"page":1}"#,
            r#"{"page":1,"results":"The Matrix"}"#,
        ] {
            assert!(
                matches!(read_page(body, Kind::Movie), Err(TmdbError::NotJson { .. })),
                "{body:?} is not a TMDB page"
            );
        }
    }

    #[test]
    fn a_page_longer_than_the_host_holds_is_refused() {
        let body = serde_json::json!({
            "results": vec![
                serde_json::json!({ "id": 1, "title": "One" });
                MAX_ITEMS + 1
            ],
        })
        .to_string();

        assert_eq!(
            read_page(&body, Kind::Movie),
            Err(TmdbError::TooLarge {
                field: "results".to_owned(),
                limit: MAX_ITEMS,
            })
        );
    }
}
