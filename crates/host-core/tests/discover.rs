//! Discovering from TMDB, driven the way a client drives it: an Action in, an
//! Answer out. Nothing below the Action surface is named here, and no test
//! reaches the network: every TMDB page is a recorded fixture, and a URL with
//! none panics rather than being answered.

use std::sync::Arc;

use host_core::{
    Action, ActionError, AddonProvider, DiscoverRow, FetchError, FixtureClock, FixtureFetcher,
    FixturePlayer, Host, InMemorySecretStore, InMemoryStore, SecretBackend, Store, ACTION_VERSION,
};

/// The owner's TMDB credential, as the v3 api-key shape the Host takes.
const TMDB_KEY: &str = "0123456789abcdef0123456789abcdef";
/// The other shape: a v4 read-access token, which travels in a header and never
/// in a URL.
const TMDB_TOKEN: &str = "eyJhbGciOiJIUzI1NiJ9.eyJzY29wZSI6InJlYWQifQ.a-signature";

const TMDB: &str = "https://api.themoviedb.org/3";

const TRENDING_MOVIE: &str = concat!(
    "https://api.themoviedb.org/3/trending/movie/week?page=1&api_key=",
    "0123456789abcdef0123456789abcdef"
);
const TRENDING_MOVIE_PAGE_2: &str = concat!(
    "https://api.themoviedb.org/3/trending/movie/week?page=2&api_key=",
    "0123456789abcdef0123456789abcdef"
);
const TRENDING_TV: &str = concat!(
    "https://api.themoviedb.org/3/trending/tv/week?page=1&api_key=",
    "0123456789abcdef0123456789abcdef"
);
const DISCOVER_MOVIE_PAGE_2: &str = concat!(
    "https://api.themoviedb.org/3/discover/movie?page=2&with_genres=28&sort_by=popularity.desc&api_key=",
    "0123456789abcdef0123456789abcdef"
);
const DISCOVER_TV_SORTED: &str = concat!(
    "https://api.themoviedb.org/3/discover/tv?page=1&sort_by=vote_average.desc&api_key=",
    "0123456789abcdef0123456789abcdef"
);

/// The same ask with a token instead of a key: the URL is clean of it.
const TRENDING_MOVIE_CLEAN: &str = "https://api.themoviedb.org/3/trending/movie/week?page=1";

const MOVIE_PAGE: &str = include_str!("fixtures/tmdb-page-movie.json");
const TV_PAGE: &str = include_str!("fixtures/tmdb-page-tv.json");

/// An Action as a client sends it: the versioned envelope, as JSON text.
fn action(body: &serde_json::Value) -> Action {
    let envelope = format!(r#"{{"version":{ACTION_VERSION},"action":{body}}}"#);
    Action::parse(&envelope).unwrap_or_else(|error| panic!("{envelope} should parse: {error}"))
}

/// An ask to discover, with the filters a client chose — or null where it chose
/// none, which is what its own form sends.
fn discover(kind: &str, page: u32, genre: Option<u32>, sort: Option<&str>) -> Action {
    action(&serde_json::json!({
        "type": "discover",
        "kind": kind,
        "page": page,
        "genre": genre,
        "sort": sort,
    }))
}

/// A Host over a store and a fetcher, with no Addon configured: Discover never
/// asks an Addon.
fn host_over(fetcher: FixtureFetcher) -> (Host, Arc<FixtureFetcher>) {
    let fetcher = Arc::new(fetcher);
    let provider = Arc::new(AddonProvider::new(fetcher.clone()));
    let host = Host::new(
        Arc::new(InMemoryStore::new()) as Arc<dyn Store>,
        fetcher.clone(),
        Arc::new(InMemorySecretStore::backed_by(SecretBackend::Keyring)),
        provider,
        Arc::new(FixturePlayer::new()),
        Arc::new(FixtureClock::new()),
    )
    .expect("a Host over a store starts");
    (host, fetcher)
}

/// A Host with every page these tests ask for recorded.
fn recorded() -> (Host, Arc<FixtureFetcher>) {
    host_over(
        FixtureFetcher::new()
            .serving(TRENDING_MOVIE, MOVIE_PAGE)
            .serving(TRENDING_MOVIE_PAGE_2, MOVIE_PAGE)
            .serving(TRENDING_TV, TV_PAGE)
            .serving(DISCOVER_MOVIE_PAGE_2, MOVIE_PAGE)
            .serving(DISCOVER_TV_SORTED, TV_PAGE),
    )
}

/// Enter a TMDB key the way the window's form does.
fn enter_key(host: &mut Host, key: &str) {
    host.dispatch(action(
        &serde_json::json!({ "type": "set_tmdb_key", "key": key }),
    ))
    .unwrap_or_else(|error| panic!("entering a TMDB key should work: {error}"));
}

/// The Discover rows an ask answered with.
fn discovered(host: &mut Host, ask: Action) -> Vec<DiscoverRow> {
    let response = host
        .dispatch(ask)
        .unwrap_or_else(|error| panic!("discovering should work: {error}"));
    response
        .discover()
        .map(<[DiscoverRow]>::to_vec)
        .unwrap_or_else(|| panic!("an ask to discover answers with rows: {response:?}"))
}

#[test]
fn a_discover_with_no_key_held_is_refused_rather_than_answered() {
    let (mut host, fetcher) = recorded();

    let refused = host.dispatch(discover("movie", 1, None, None));

    assert_eq!(
        refused.err(),
        Some(ActionError::NoTmdbCredential),
        "the Host says it has nothing to ask TMDB with rather than answering an empty feed"
    );
    assert!(
        fetcher.asked().is_empty(),
        "nothing was asked of TMDB: {:?}",
        fetcher.asked()
    );
}

#[test]
fn discover_defaults_to_the_weeks_trending_feed() {
    let (mut host, fetcher) = recorded();
    enter_key(&mut host, TMDB_KEY);

    let rows = discovered(&mut host, discover("movie", 1, None, None));

    assert_eq!(rows.len(), 1, "one ask answers one row");
    let row = &rows[0];
    assert_eq!(row.r#type, "movie");
    assert_eq!(row.sent, 2);
    assert!(
        row.failure.is_none(),
        "a page TMDB answered is not a failure"
    );
    assert_eq!(
        fetcher.asked(),
        vec![TRENDING_MOVIE.to_owned()],
        "neither a genre nor a sort asks the week TMDB calls trending"
    );

    assert_eq!(
        row.metas[0].id, "tmdb:603",
        "an item is keyed by TMDB's own id"
    );
    assert_eq!(row.metas[0].name, "The Matrix");
    assert!(
        row.metas[0]
            .poster
            .as_deref()
            .is_some_and(|poster| poster.starts_with("https://image.tmdb.org/t/p/w780")),
        "a card is drawn from TMDB's poster: {:?}",
        row.metas[0].poster
    );
    assert!(
        row.metas[0]
            .background
            .as_deref()
            .is_some_and(|background| background.starts_with("https://image.tmdb.org/t/p/w780")),
        "the backdrop beside it is TMDB's too: {:?}",
        row.metas[0].background
    );
    assert_eq!(row.metas[0].release_info.as_deref(), Some("1999"));
}

#[test]
fn a_filtered_discover_asks_the_discover_endpoint_in_the_kinds_own_terms() {
    let (mut host, fetcher) = recorded();
    enter_key(&mut host, TMDB_KEY);

    let rows = discovered(
        &mut host,
        discover("movie", 2, Some(28), Some("popularity.desc")),
    );

    assert_eq!(
        fetcher.asked(),
        vec![DISCOVER_MOVIE_PAGE_2.to_owned()],
        "a genre or a sort is a /discover page, asked with the page and the filters it chose"
    );
    assert_eq!(rows[0].sent, 2);
    assert_eq!(rows[0].metas[0].id, "tmdb:603");
}

#[test]
fn a_series_feed_asks_the_tv_endpoints_and_spells_its_own_fields() {
    let (mut host, fetcher) = recorded();
    enter_key(&mut host, TMDB_KEY);

    let rows = discovered(&mut host, discover("series", 1, None, None));
    assert_eq!(fetcher.asked(), vec![TRENDING_TV.to_owned()]);
    assert_eq!(
        rows[0].r#type, "series",
        "the protocol's word for TMDB's tv"
    );
    assert_eq!(
        rows[0].metas[0].id, "tmdb:1396",
        "the same numeric id the series' other endpoints use"
    );
    assert_eq!(
        rows[0].metas[0].name, "Breaking Bad",
        "a series names itself in `name`"
    );
    assert_eq!(
        rows[0].metas[0].release_info.as_deref(),
        Some("2008"),
        "a series is dated by its first airing"
    );

    let sorted = discovered(
        &mut host,
        discover("series", 1, None, Some("vote_average.desc")),
    );
    assert_eq!(
        fetcher.asked().last().map(String::as_str),
        Some(DISCOVER_TV_SORTED)
    );
    assert_eq!(sorted[0].r#type, "series");
}

#[test]
fn a_tmdb_that_is_rate_limited_is_a_row_with_a_failure() {
    let (mut host, _) = host_over(
        FixtureFetcher::new().failing(TRENDING_MOVIE, FetchError::Status { status: 429 }),
    );
    enter_key(&mut host, TMDB_KEY);

    let rows = discovered(&mut host, discover("movie", 1, None, None));

    let row = &rows[0];
    assert_eq!(row.r#type, "movie");
    assert_eq!(row.sent, 0);
    assert!(row.metas.is_empty());
    assert_eq!(
        row.failure,
        Some(ActionError::Tmdb {
            detail: "TMDB answered with status 429".to_owned(),
        }),
        "a rate limit is a row that says TMDB did not answer, not a panicked Host"
    );
}

#[test]
fn a_page_that_is_not_a_tmdb_answer_is_a_row_with_a_failure() {
    let (mut host, _) = host_over(FixtureFetcher::new().serving(TRENDING_MOVIE, "not json"));
    enter_key(&mut host, TMDB_KEY);

    let rows = discovered(&mut host, discover("movie", 1, None, None));

    match &rows[0].failure {
        Some(ActionError::Tmdb { detail }) => assert!(
            detail.starts_with("that is not a TMDB answer"),
            "a body that is not a page says so: {detail}"
        ),
        failure => panic!("a page that is not one is a failure row: {failure:?}"),
    }
}

#[test]
fn every_discover_page_reaches_tmdb_and_nothing_is_cached() {
    let (mut host, fetcher) = recorded();
    enter_key(&mut host, TMDB_KEY);

    discovered(&mut host, discover("movie", 1, None, None));
    discovered(&mut host, discover("movie", 2, None, None));
    discovered(&mut host, discover("movie", 1, None, None));

    assert_eq!(
        fetcher.asked(),
        vec![
            TRENDING_MOVIE.to_owned(),
            TRENDING_MOVIE_PAGE_2.to_owned(),
            TRENDING_MOVIE.to_owned(),
        ],
        "the same page asked for twice is asked for twice: Discover is never cached"
    );
}

#[test]
fn a_query_key_travels_in_the_url_and_never_into_the_answer() {
    let (mut host, _) = recorded();
    enter_key(&mut host, TMDB_KEY);

    let response = host
        .dispatch(discover("movie", 1, None, None))
        .expect("discovering should work");
    let published = serde_json::to_value(&response).expect("a Response serializes");

    assert!(
        !published.to_string().contains(TMDB_KEY),
        "the credential reaches nothing a client reads: {published}"
    );
    assert!(
        !serde_json::to_string(&response)
            .expect("a Response serializes")
            .contains(TMDB),
        "and neither does the URL it was built onto"
    );
}

#[test]
fn a_bearer_token_travels_in_the_header_and_never_into_the_url_or_the_answer() {
    let (mut host, fetcher) =
        host_over(FixtureFetcher::new().serving(TRENDING_MOVIE_CLEAN, MOVIE_PAGE));
    enter_key(&mut host, TMDB_TOKEN);

    let rows = discovered(&mut host, discover("movie", 1, None, None));
    assert_eq!(rows[0].sent, 2);

    assert_eq!(
        fetcher.asked(),
        vec![TRENDING_MOVIE_CLEAN.to_owned()],
        "a token never rides in the URL TMDB is asked at"
    );
    assert_eq!(
        fetcher.headers_of(TRENDING_MOVIE_CLEAN),
        vec![("Authorization".to_owned(), format!("Bearer {TMDB_TOKEN}"),)],
        "it rides in the header, and only there"
    );
    assert!(
        !serde_json::to_string(&rows)
            .expect("rows serialize")
            .contains(TMDB_TOKEN),
        "and reaches nothing a client reads"
    );
}

#[test]
fn an_ask_outside_tmdbs_terms_is_refused_before_the_network() {
    let (mut host, fetcher) = recorded();
    enter_key(&mut host, TMDB_KEY);

    let refused = host.dispatch(discover("series", 1, Some(28), None));

    assert!(
        matches!(refused, Err(ActionError::InvalidDiscover { .. })),
        "a film's genre on a series is refused before TMDB hears of it: {refused:?}"
    );
    assert!(fetcher.asked().is_empty(), "nothing was asked");
}

#[test]
fn the_answer_is_the_declared_wire_shape_and_publishes_no_snapshot() {
    let (mut host, _) = recorded();
    enter_key(&mut host, TMDB_KEY);
    let before = host.snapshot();

    let response = host
        .dispatch(discover("movie", 1, None, None))
        .expect("discovering should work");

    assert!(
        response.snapshots.is_empty(),
        "a feed is a question: it publishes nothing and no client's state moves"
    );
    assert_eq!(host.snapshot(), before, "the revision did not move");

    let published = serde_json::to_value(&response).expect("a Response serializes");
    assert_eq!(
        published
            .pointer("/answer/discover/0/type")
            .and_then(|v| v.as_str()),
        Some("movie")
    );
    assert_eq!(
        published
            .pointer("/answer/discover/0/sent")
            .and_then(|v| v.as_u64()),
        Some(2)
    );
    assert_eq!(
        published.pointer("/answer/discover/0/failure"),
        Some(&serde_json::Value::Null),
        "a row that read is not a row that failed"
    );
    assert_eq!(
        published
            .pointer("/answer/discover/0/metas/0/id")
            .and_then(|v| v.as_str()),
        Some("tmdb:603")
    );
    for field in ["poster", "background"] {
        assert!(
            published
                .pointer(&format!("/answer/discover/0/metas/0/{field}"))
                .and_then(|v| v.as_str())
                .is_some_and(|address| address.starts_with("https://image.tmdb.org/t/p/")),
            "the {field} is a TMDB address a card can draw"
        );
    }
}
