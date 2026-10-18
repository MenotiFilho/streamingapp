//! Searching TMDB with a key held, driven the way a client drives it: an
//! Action in, an Answer out. Nothing below the Action surface is named here, and
//! no test reaches the network: every TMDB page is a recorded fixture, and a URL
//! with none panics rather than being answered.
//!
//! The keyless arm is not here: `SearchCatalogs` is the Addons' path, and what
//! this file checks about it is that it is still exactly that.

use std::sync::Arc;

use host_core::{
    Action, ActionError, AddonProvider, FetchError, FixtureClock, FixtureFetcher, FixturePlayer,
    Host, InMemorySecretStore, InMemoryStore, SearchRow, SecretBackend, Store, ACTION_VERSION,
};

/// The owner's TMDB credential, as the v3 api-key shape the Host takes.
const TMDB_KEY: &str = "0123456789abcdef0123456789abcdef";
/// The other shape: a v4 read-access token, which travels in a header and never
/// in a URL.
const TMDB_TOKEN: &str = "eyJhbGciOiJIUzI1NiJ9.eyJzY29wZSI6InJlYWQifQ.a-signature";

const TMDB: &str = "https://api.themoviedb.org/3";

const SEARCH_MOVIE: &str = concat!(
    "https://api.themoviedb.org/3/search/movie?query=matrix&page=1&api_key=",
    "0123456789abcdef0123456789abcdef"
);
const SEARCH_MOVIE_PAGE_2: &str = concat!(
    "https://api.themoviedb.org/3/search/movie?query=matrix&page=2&api_key=",
    "0123456789abcdef0123456789abcdef"
);
const SEARCH_TV: &str = concat!(
    "https://api.themoviedb.org/3/search/tv?query=breaking%20bad&page=1&api_key=",
    "0123456789abcdef0123456789abcdef"
);
const SEARCH_ENCODED: &str = concat!(
    "https://api.themoviedb.org/3/search/movie?query=blood%20%26%20guts&page=1&api_key=",
    "0123456789abcdef0123456789abcdef"
);

/// The same ask with a token instead of a key: the URL is clean of it.
const SEARCH_MOVIE_CLEAN: &str = "https://api.themoviedb.org/3/search/movie?query=matrix&page=1";

const MOVIE_PAGE: &str = include_str!("fixtures/tmdb-page-movie.json");
const TV_PAGE: &str = include_str!("fixtures/tmdb-page-tv.json");

/// An Action as a client sends it: the versioned envelope, as JSON text.
fn action(body: &serde_json::Value) -> Action {
    let envelope = format!(r#"{{"version":{ACTION_VERSION},"action":{body}}}"#);
    Action::parse(&envelope).unwrap_or_else(|error| panic!("{envelope} should parse: {error}"))
}

/// An ask to search, as the Search screen sends one per kind.
fn search(query: &str, kind: &str, page: u32) -> Action {
    action(&serde_json::json!({
        "type": "search",
        "query": query,
        "kind": kind,
        "page": page,
    }))
}

/// A Host over a store and a fetcher, with no Addon configured: a keyed Search
/// never asks an Addon.
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
            .serving(SEARCH_MOVIE, MOVIE_PAGE)
            .serving(SEARCH_MOVIE_PAGE_2, MOVIE_PAGE)
            .serving(SEARCH_TV, TV_PAGE)
            .serving(SEARCH_ENCODED, MOVIE_PAGE),
    )
}

/// Enter a TMDB key the way the window's form does.
fn enter_key(host: &mut Host, key: &str) {
    host.dispatch(action(
        &serde_json::json!({ "type": "set_tmdb_key", "key": key }),
    ))
    .unwrap_or_else(|error| panic!("entering a TMDB key should work: {error}"));
}

/// The Search row an ask answered with.
fn searched(host: &mut Host, ask: Action) -> SearchRow {
    let response = host
        .dispatch(ask)
        .unwrap_or_else(|error| panic!("searching should work: {error}"));
    response
        .search()
        .cloned()
        .unwrap_or_else(|| panic!("an ask to search answers with a row: {response:?}"))
}

#[test]
fn a_search_with_no_key_held_is_refused_rather_than_answered() {
    let (mut host, fetcher) = recorded();

    let refused = host.dispatch(search("matrix", "movie", 1));

    assert_eq!(
        refused.err(),
        Some(ActionError::NoTmdbCredential),
        "the Host says it has nothing to ask TMDB with rather than answering an empty row"
    );
    assert!(
        fetcher.asked().is_empty(),
        "nothing was asked of TMDB: {:?}",
        fetcher.asked()
    );
}

#[test]
fn a_keyed_search_asks_tmdbs_movie_endpoint_and_answers_a_row_of_its_hits() {
    let (mut host, fetcher) = recorded();
    enter_key(&mut host, TMDB_KEY);

    let row = searched(&mut host, search("matrix", "movie", 1));

    assert_eq!(row.r#type, "movie");
    assert_eq!(row.sent, 2);
    assert!(
        row.failure.is_none(),
        "a page TMDB answered is not a failure"
    );
    assert_eq!(
        fetcher.asked(),
        vec![SEARCH_MOVIE.to_owned()],
        "a film search asks /search/movie and never /search/multi"
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
        "a hit is drawn from TMDB's poster: {:?}",
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
}

#[test]
fn a_series_search_asks_the_tv_endpoint_and_spells_its_own_fields() {
    let (mut host, fetcher) = recorded();
    enter_key(&mut host, TMDB_KEY);

    let row = searched(&mut host, search("breaking bad", "series", 1));

    assert_eq!(
        fetcher.asked(),
        vec![SEARCH_TV.to_owned()],
        "a series search asks /search/tv, with its query encoded"
    );
    assert_eq!(row.r#type, "series", "the protocol's word for TMDB's tv");
    assert_eq!(row.metas[0].id, "tmdb:1396");
    assert_eq!(
        row.metas[0].name, "Breaking Bad",
        "a series names itself in `name`"
    );
}

#[test]
fn every_search_row_pages_on_its_own_page_number_and_reaches_tmdb_every_time() {
    let (mut host, fetcher) = recorded();
    enter_key(&mut host, TMDB_KEY);

    searched(&mut host, search("matrix", "movie", 1));
    searched(&mut host, search("matrix", "movie", 2));
    searched(&mut host, search("matrix", "movie", 1));

    assert_eq!(
        fetcher.asked(),
        vec![
            SEARCH_MOVIE.to_owned(),
            SEARCH_MOVIE_PAGE_2.to_owned(),
            SEARCH_MOVIE.to_owned(),
        ],
        "the same query asked for twice is asked for twice: Search is never cached"
    );
}

#[test]
fn a_query_travels_encoded_so_an_ampersand_is_part_of_the_query() {
    let (mut host, fetcher) = recorded();
    enter_key(&mut host, TMDB_KEY);

    searched(&mut host, search("blood & guts", "movie", 1));

    assert_eq!(
        fetcher.asked(),
        vec![SEARCH_ENCODED.to_owned()],
        "an Ampersand that survives unencoded is a second query item"
    );
}

#[test]
fn a_tmdb_that_is_rate_limited_is_a_row_with_a_failure() {
    let (mut host, _) =
        host_over(FixtureFetcher::new().failing(SEARCH_MOVIE, FetchError::Status { status: 429 }));
    enter_key(&mut host, TMDB_KEY);

    let row = searched(&mut host, search("matrix", "movie", 1));

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
fn an_answer_that_is_not_a_tmdb_page_is_a_row_with_a_failure() {
    let (mut host, _) = host_over(FixtureFetcher::new().serving(SEARCH_MOVIE, "not json"));
    enter_key(&mut host, TMDB_KEY);

    let row = searched(&mut host, search("matrix", "movie", 1));

    match &row.failure {
        Some(ActionError::Tmdb { detail }) => assert!(
            detail.starts_with("that is not a TMDB answer"),
            "a body that is not a page says so: {detail}"
        ),
        failure => panic!("a body that is not a page is a failure row: {failure:?}"),
    }
}

#[test]
fn an_ask_outside_tmdbs_terms_is_refused_before_the_network() {
    let (mut host, fetcher) = recorded();
    enter_key(&mut host, TMDB_KEY);

    assert!(
        matches!(
            host.dispatch(search("matrix", "channel", 1)),
            Err(ActionError::InvalidSearch { .. })
        ),
        "a kind TMDB keeps no records for is refused before TMDB hears of it"
    );
    assert!(
        matches!(
            host.dispatch(search("matrix", "movie", 0)),
            Err(ActionError::InvalidSearch { .. })
        ),
        "TMDB numbers its pages from 1"
    );
    assert!(
        matches!(
            host.dispatch(search("   ", "movie", 1)),
            Err(ActionError::Query { .. })
        ),
        "the one search rule judges the query itself, as `SearchCatalogs` is judged"
    );
    assert!(fetcher.asked().is_empty(), "nothing was asked");
}

#[test]
fn a_query_key_travels_in_the_url_and_never_into_the_answer() {
    let (mut host, _) = recorded();
    enter_key(&mut host, TMDB_KEY);

    let response = host
        .dispatch(search("matrix", "movie", 1))
        .expect("searching should work");
    let published = serde_json::to_string(&response).expect("a Response serializes");

    assert!(
        !published.contains(TMDB_KEY),
        "the credential reaches nothing a client reads: {published}"
    );
    assert!(
        !published.contains(TMDB),
        "and neither does the URL it was built onto"
    );
}

#[test]
fn a_bearer_token_travels_in_the_header_and_never_into_the_url_or_the_answer() {
    let (mut host, fetcher) =
        host_over(FixtureFetcher::new().serving(SEARCH_MOVIE_CLEAN, MOVIE_PAGE));
    enter_key(&mut host, TMDB_TOKEN);

    let row = searched(&mut host, search("matrix", "movie", 1));
    assert_eq!(row.sent, 2);

    assert_eq!(
        fetcher.asked(),
        vec![SEARCH_MOVIE_CLEAN.to_owned()],
        "a token never rides in the URL TMDB is asked at"
    );
    assert_eq!(
        fetcher.headers_of(SEARCH_MOVIE_CLEAN),
        vec![("Authorization".to_owned(), format!("Bearer {TMDB_TOKEN}"),)],
        "it rides in the header, and only there"
    );
    assert!(
        !serde_json::to_string(&row)
            .expect("a row serializes")
            .contains(TMDB_TOKEN),
        "and reaches nothing a client reads"
    );
}

#[test]
fn the_keyless_path_is_still_the_addons_own_catalogs() {
    let (mut host, fetcher) = recorded();

    let response = host
        .dispatch(action(
            &serde_json::json!({ "type": "search_catalogs", "query": "matrix" }),
        ))
        .expect("the Addons' search should work");

    assert!(
        response.search().is_none(),
        "`SearchCatalogs` is not TMDB's question: {:?}",
        response.answer
    );
    assert!(
        response.catalogs().is_some(),
        "it answers with catalog rows, as it always has: {:?}",
        response.answer
    );
    assert!(
        fetcher.asked().is_empty(),
        "no Addon is configured and TMDB is not asked: {:?}",
        fetcher.asked()
    );
}

#[test]
fn the_answer_is_the_declared_wire_shape_and_publishes_no_snapshot() {
    let (mut host, _) = recorded();
    enter_key(&mut host, TMDB_KEY);
    let before = host.snapshot();

    let response = host
        .dispatch(search("matrix", "movie", 1))
        .expect("searching should work");

    assert!(
        response.snapshots.is_empty(),
        "a search is a question: it publishes nothing and no client's state moves"
    );
    assert_eq!(host.snapshot(), before, "the revision did not move");

    let published = serde_json::to_value(&response).expect("a Response serializes");
    assert_eq!(
        published
            .pointer("/answer/search/type")
            .and_then(|v| v.as_str()),
        Some("movie")
    );
    assert_eq!(
        published
            .pointer("/answer/search/sent")
            .and_then(|v| v.as_u64()),
        Some(2)
    );
    assert_eq!(
        published.pointer("/answer/search/failure"),
        Some(&serde_json::Value::Null),
        "a row that read is not a row that failed"
    );
    assert_eq!(
        published
            .pointer("/answer/search/metas/0/id")
            .and_then(|v| v.as_str()),
        Some("tmdb:603")
    );
    for field in ["poster", "background"] {
        assert!(
            published
                .pointer(&format!("/answer/search/metas/0/{field}"))
                .and_then(|v| v.as_str())
                .is_some_and(|address| address.starts_with("https://image.tmdb.org/t/p/")),
            "the {field} is a TMDB address a card can draw"
        );
    }
}
