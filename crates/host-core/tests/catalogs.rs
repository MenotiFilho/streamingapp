//! Browsing and searching, driven the way a client drives it: an Action in, a
//! Response out. Nothing below the Action surface is named here, and nothing in
//! this file reaches the network: every fetch is a recorded fixture.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use host_core::{
    Action, ActionError, AddonProvider, CatalogRow, FetchError, Fetcher, FixtureClock,
    FixtureFetcher, FixturePlayer, Host, InMemorySecretStore, InMemoryStore, Provider, Response,
    SecretBackend, Store, ACTION_VERSION,
};

/// A Player a test drives by hand: nothing plays unless a test says so, and
/// every telling is remembered.
fn player() -> Arc<FixturePlayer> {
    Arc::new(FixturePlayer::new())
}

/// A clock a test drives by hand, for the Watch progress a play records (#29).
fn clock() -> Arc<FixtureClock> {
    Arc::new(FixtureClock::new())
}

/// A Host needs somewhere to look a credential up; tests hold theirs here.
fn secrets() -> Arc<InMemorySecretStore> {
    Arc::new(InMemorySecretStore::backed_by(SecretBackend::Keyring))
}

/// The real Provider over this fetcher: the addon protocol, so a `find_streams`
/// in a file that recorded no `stream` answer fails loudly rather than reaching
/// anywhere.
fn provider(fetcher: &Arc<FixtureFetcher>) -> Arc<dyn Provider> {
    Arc::new(AddonProvider::new(fetcher.clone()))
}

/// The recorded Addons, and the pages recorded from them.
const CINEMETA: &str = "https://v3-cinemeta.strem.io/manifest.json";
const CINEMETA_TOP: &str = "https://v3-cinemeta.strem.io/catalog/movie/top.json";
const CINEMETA_TOP_PAGE_2: &str = "https://v3-cinemeta.strem.io/catalog/movie/top/skip=100.json";
const CINEMETA_SEARCH: &str = "https://v3-cinemeta.strem.io/catalog/movie/top/search=matrix.json";
/// The same catalog searched for something with an ampersand in it: what the
/// Host must ask at when a value needs encoding.
const CINEMETA_SEARCH_ENCODED: &str =
    "https://v3-cinemeta.strem.io/catalog/movie/top/search=blood%20%26%20guts.json";
const CINEMETA_YEAR: &str = "https://v3-cinemeta.strem.io/catalog/movie/year/genre=2026.json";
const STREMBOXD: &str = "https://api.stremboxd.com/manifest.json";
const STREMBOXD_POPULAR: &str = "https://api.stremboxd.com/catalog/movie/letterboxd-popular.json";

const CINEMETA_MANIFEST: &str = include_str!("fixtures/cinemeta-manifest.json");
const STREMBOXD_MANIFEST: &str = include_str!("fixtures/stremboxd-manifest.json");
const CINEMETA_TOP_BODY: &str = include_str!("fixtures/cinemeta-catalog-movie-top.json");
const CINEMETA_TOP_PAGE_2_BODY: &str =
    include_str!("fixtures/cinemeta-catalog-movie-top-skip100.json");
const CINEMETA_SEARCH_BODY: &str = include_str!("fixtures/cinemeta-search-movie-top.json");
const STREMBOXD_POPULAR_BODY: &str =
    include_str!("fixtures/stremboxd-catalog-letterboxd-popular.json");
const HOSTILE_CATALOG: &str = include_str!("fixtures/hostile-catalog.json");
const BAD_ITEM: &str = include_str!("fixtures/catalog-with-a-bad-item.json");

/// Cinemeta declares `top` for series as well as for movies, and a search asks
/// every catalog that offers one — so searching with Cinemeta configured asks
/// this too.
const CINEMETA_SERIES_SEARCH: &str =
    "https://v3-cinemeta.strem.io/catalog/series/top/search=matrix.json";
/// Stremboxd's tier-1 manifest advertises a search catalog that its own recorded
/// deployment does not answer without a config segment (recorded 2026-10-15).
const STREMBOXD_SEARCH: &str =
    "https://api.stremboxd.com/catalog/movie/letterboxd-search/search=matrix.json";

/// An Action as a client sends it: the versioned envelope, as JSON text.
fn action(body: &serde_json::Value) -> Action {
    let envelope = format!(r#"{{"version":{ACTION_VERSION},"action":{body}}}"#);
    Action::parse(&envelope).unwrap_or_else(|error| panic!("{envelope} should parse: {error}"))
}

/// Show a page of a catalog, with the values a client chose.
fn browse(addon: &str, r#type: &str, id: &str, extra: &[(&str, &str)]) -> Action {
    action(&serde_json::json!({
        "type": "browse_catalog",
        "addon": addon,
        "catalog": { "type": r#type, "id": id },
        "extra": extra
            .iter()
            .map(|(name, value)| serde_json::json!({ "name": name, "value": value }))
            .collect::<Vec<_>>(),
    }))
}

fn search(query: &str) -> Action {
    action(&serde_json::json!({ "type": "search_catalogs", "query": query }))
}

fn rows(response: &Response) -> &[CatalogRow] {
    response.catalogs().unwrap_or_else(|| {
        panic!("an Action that was a question answers with catalog rows: {response:?}")
    })
}

fn names(row: &CatalogRow) -> Vec<&str> {
    row.metas.iter().map(|meta| meta.name.as_str()).collect()
}

/// A Host over a store and a fetcher, with the recorded Addons configured.
fn host_with_recorded_addons() -> (Host, Arc<FixtureFetcher>) {
    let fetcher = Arc::new(
        FixtureFetcher::new()
            .serving(CINEMETA, CINEMETA_MANIFEST)
            .serving(STREMBOXD, STREMBOXD_MANIFEST)
            .serving(CINEMETA_TOP, CINEMETA_TOP_BODY)
            .serving(CINEMETA_TOP_PAGE_2, CINEMETA_TOP_PAGE_2_BODY)
            .serving(CINEMETA_SEARCH, CINEMETA_SEARCH_BODY)
            .serving(CINEMETA_SEARCH_ENCODED, CINEMETA_SEARCH_BODY)
            .serving(
                CINEMETA_SERIES_SEARCH,
                page_of(&["The Matrix", "Matrix Reloaded"]),
            )
            .failing(STREMBOXD_SEARCH, FetchError::Status { status: 404 })
            .serving(CINEMETA_YEAR, CINEMETA_TOP_BODY)
            .serving(STREMBOXD_POPULAR, STREMBOXD_POPULAR_BODY),
    );
    let mut host = Host::new(
        Arc::new(InMemoryStore::new()) as Arc<dyn Store>,
        fetcher.clone(),
        secrets(),
        provider(&fetcher),
        player(),
        clock(),
    )
    .expect("a Host over a store starts");
    configure(&mut host, CINEMETA);
    configure(&mut host, STREMBOXD);
    (host, fetcher)
}

fn configure(host: &mut Host, url: &str) {
    host.dispatch(action(
        &serde_json::json!({ "type": "add_addon", "url": url }),
    ))
    .unwrap_or_else(|error| panic!("configuring {url} should work: {error}"));
}

fn browsed(host: &mut Host, action: Action) -> Response {
    host.dispatch(action)
        .unwrap_or_else(|error| panic!("browsing should work: {error}"))
}

#[test]
fn a_catalog_row_comes_back_from_a_configured_addon_in_the_addons_own_order() {
    let (mut host, fetcher) = host_with_recorded_addons();

    let response = browsed(&mut host, browse("com.linvo.cinemeta", "movie", "top", &[]));

    let row = &rows(&response)[0];
    assert_eq!(row.addon.as_str(), "com.linvo.cinemeta");
    assert_eq!(row.r#type, "movie");
    assert_eq!(row.id, "top");
    assert_eq!(
        row.name, "Popular",
        "the catalog's own name comes back with it"
    );
    assert_eq!(row.failure, None);
    assert_eq!(row.metas.len(), 8);

    let recorded: serde_json::Value =
        serde_json::from_str(CINEMETA_TOP_BODY).expect("the fixture is JSON");
    let expected: Vec<&str> = recorded["metas"]
        .as_array()
        .expect("the fixture has metas")
        .iter()
        .map(|meta| meta["name"].as_str().expect("a recorded item has a name"))
        .collect();
    assert_eq!(
        names(row),
        expected,
        "the row is the Addon's own order and nothing is reordered or dropped"
    );

    assert_eq!(
        fetcher.asked(),
        vec![
            CINEMETA.to_owned(),
            STREMBOXD.to_owned(),
            CINEMETA_TOP.to_owned()
        ],
        "the Host asked for the page it was asked for, and nothing else"
    );
}

#[test]
fn browsing_publishes_no_snapshot_and_moves_no_revision() {
    // What one client is looking at is not state anybody else shares (ADR-0005),
    // so a question is not a change: no Snapshot, and the revision stands still.
    let (mut host, _fetcher) = host_with_recorded_addons();
    let before = host.snapshot();

    let response = browsed(&mut host, browse("com.linvo.cinemeta", "movie", "top", &[]));

    assert!(
        response.snapshots.is_empty(),
        "a question publishes nothing: {:?}",
        response.snapshots
    );
    assert_eq!(host.snapshot(), before);
}

#[test]
fn a_catalog_with_more_items_than_one_page_can_be_paged_through() {
    let (mut host, fetcher) = host_with_recorded_addons();

    let first = browsed(&mut host, browse("com.linvo.cinemeta", "movie", "top", &[]));
    let second = browsed(
        &mut host,
        browse("com.linvo.cinemeta", "movie", "top", &[("skip", "100")]),
    );

    let first = &rows(&first)[0];
    let second = &rows(&second)[0];
    assert!(
        second
            .metas
            .iter()
            .all(|next| !first.metas.iter().any(|seen| seen.id == next.id)),
        "the second page is the next page, not the first one again: {:?}",
        names(second)
    );
    assert_eq!(
        fetcher.asked().last().map(String::as_str),
        Some(CINEMETA_TOP_PAGE_2),
        "paging on is asked for as `skip`, in the protocol's own querystring"
    );
}

#[test]
fn a_value_that_needs_encoding_reaches_the_addon_encoded() {
    let (mut host, fetcher) = host_with_recorded_addons();

    let response = browsed(
        &mut host,
        browse(
            "com.linvo.cinemeta",
            "movie",
            "top",
            &[("search", "blood & guts")],
        ),
    );

    assert_eq!(
        fetcher.asked().last().map(String::as_str),
        Some(CINEMETA_SEARCH_ENCODED),
        "an ampersand in a search is data, not another parameter"
    );
    // The Addon answers that URL with what the fixture holds; what matters here
    // is the URL it was asked at, which the line above asserts.
    assert_eq!(rows(&response)[0].failure, None);
}

#[test]
fn a_search_asks_every_addon_that_offers_one_and_not_the_ones_that_do_not() {
    let fetcher = Arc::new(
        FixtureFetcher::new()
            .serving(
                SEARCHABLE,
                searchable_manifest("community.searchable", "Searchable"),
            )
            .serving(WITHOUT_SEARCH, plain_manifest("community.plain"))
            .serving(
                "https://searchable.example.com/catalog/movie/top/search=matrix.json",
                page_of(&["The Matrix", "The Matrix Reloaded"]),
            ),
    );
    let mut host = host_over(fetcher.clone());
    configure(&mut host, SEARCHABLE);
    configure(&mut host, WITHOUT_SEARCH);

    let response = browsed(&mut host, search("matrix"));

    assert_eq!(
        rows(&response).len(),
        1,
        "only the Addon whose catalog offers search was asked: {:?}",
        fetcher.asked()
    );
    assert_eq!(
        names(&rows(&response)[0]),
        vec!["The Matrix", "The Matrix Reloaded"]
    );
    assert_eq!(
        rows(&response)[0].addon.as_str(),
        "community.searchable",
        "the row says which Addon it came from, because a search asks several"
    );
}

#[test]
fn searching_finds_the_records_of_the_catalogs_that_offer_it() {
    let (mut host, fetcher) = host_with_recorded_addons();

    let response = browsed(&mut host, search("matrix"));

    // Three catalogs offer search: Cinemeta's `top` for movies and for series,
    // and Stremboxd's own search catalog. Every one of them is a row (ADR-0010).
    let rows = rows(&response);
    assert_eq!(
        rows.iter()
            .map(|row| (row.addon.as_str(), row.r#type.as_str(), row.id.as_str()))
            .collect::<Vec<_>>(),
        vec![
            ("com.linvo.cinemeta", "movie", "top"),
            ("com.linvo.cinemeta", "series", "top"),
            ("community.stremboxd", "movie", "letterboxd-search"),
        ],
        "a search asks every catalog that offers one, in the Addons' own order"
    );
    assert_eq!(
        names(&rows[0])[0],
        "The Matrix",
        "the recorded search comes back in the row for the catalog it came from: {:?}",
        names(&rows[0])
    );
    assert_eq!(
        names(&rows[1]),
        vec!["The Matrix", "Matrix Reloaded"],
        "and each row carries its own catalog's answers"
    );
    assert!(
        fetcher.asked().iter().any(|url| url == CINEMETA_SEARCH),
        "the search was asked for with `search`, as the protocol does it: {:?}",
        fetcher.asked()
    );
    assert!(
        matches!(rows[2].failure, Some(ActionError::Fetch { ref detail }) if detail.contains("404")),
        "the one that does not answer says so without blanking the other two: {:?}",
        rows[2]
    );
}

#[test]
fn one_addon_failing_does_not_blank_anothers_results() {
    let fetcher = Arc::new(
        FixtureFetcher::new()
            .serving(
                SEARCHABLE,
                searchable_manifest("community.searchable", "Searchable"),
            )
            .serving(
                ALSO_SEARCHABLE,
                searchable_manifest("community.other", "Other"),
            )
            .serving(
                "https://searchable.example.com/catalog/movie/top/search=matrix.json",
                page_of(&["The Matrix"]),
            )
            .failing(
                "https://other.example.com/catalog/movie/top/search=matrix.json",
                FetchError::Status { status: 503 },
            ),
    );
    let mut host = host_over(fetcher);
    configure(&mut host, SEARCHABLE);
    configure(&mut host, ALSO_SEARCHABLE);

    let response = browsed(&mut host, search("matrix"));

    let rows = rows(&response);
    assert_eq!(rows.len(), 2, "both Addons were asked");
    assert_eq!(names(&rows[0]), vec!["The Matrix"]);
    assert_eq!(rows[0].failure, None);
    assert!(
        matches!(rows[1].failure, Some(ActionError::Fetch { ref detail }) if detail.contains("503")),
        "the Addon that failed says so in its own row: {:?}",
        rows[1]
    );
    assert_eq!(rows[1].metas, Vec::new());
}

#[test]
fn a_page_that_lies_about_its_shape_is_a_row_that_says_so() {
    let fetcher = Arc::new(
        FixtureFetcher::new()
            .serving(SEARCHABLE, searchable_manifest("community.liar", "Liar"))
            .serving(
                "https://searchable.example.com/catalog/movie/top.json",
                HOSTILE_CATALOG,
            ),
    );
    let mut host = host_over(fetcher);
    configure(&mut host, SEARCHABLE);

    let response = browsed(&mut host, browse("community.liar", "movie", "top", &[]));

    assert!(
        matches!(rows(&response)[0].failure, Some(ActionError::Catalog { ref detail }) if detail.contains("metas should be an array")),
        "a catalog that lies is reported, not crashed on: {:?}",
        rows(&response)[0]
    );
}

#[test]
fn a_row_carries_how_many_items_the_addon_sent_even_when_some_could_not_be_read() {
    // A client pages on by what the Addon sent, not by what it holds: a page
    // with one unreadable item in it would otherwise start the next page one
    // item too early and show something twice.
    let fetcher = Arc::new(
        FixtureFetcher::new()
            .serving(SEARCHABLE, searchable_manifest("community.liar", "Liar"))
            .serving(
                "https://searchable.example.com/catalog/movie/top.json",
                BAD_ITEM,
            ),
    );
    let mut host = host_over(fetcher);
    configure(&mut host, SEARCHABLE);

    let response = browsed(&mut host, browse("community.liar", "movie", "top", &[]));

    let row = &rows(&response)[0];
    assert_eq!(names(row), vec!["The Matrix", "Paprika"]);
    assert_eq!(
        row.sent, 4,
        "the Addon sent four items; two of them could not be read"
    );
    assert_eq!(row.failure, None);
}

#[test]
fn a_second_request_inside_the_cache_window_does_not_reach_the_network() {
    let (mut host, fetcher) = host_with_recorded_addons();

    browsed(&mut host, browse("com.linvo.cinemeta", "movie", "top", &[]));
    let asked_once = fetcher.asked().len();
    let response = browsed(&mut host, browse("com.linvo.cinemeta", "movie", "top", &[]));

    assert_eq!(
        fetcher.asked().len(),
        asked_once,
        "Cinemeta's own `cacheMaxAge` says the page is still good: {:?}",
        fetcher.asked()
    );
    assert_eq!(
        rows(&response)[0].metas.len(),
        8,
        "the page is answered from the cache"
    );
}

#[test]
fn a_page_the_addon_said_not_to_keep_is_asked_for_again() {
    let fetcher = Arc::new(
        FixtureFetcher::new()
            .serving(SEARCHABLE, searchable_manifest("community.plain", "Plain"))
            .serving(
                "https://searchable.example.com/catalog/movie/top.json",
                r#"{"metas":[],"cacheMaxAge":0}"#,
            ),
    );
    let mut host = host_over(fetcher.clone());
    configure(&mut host, SEARCHABLE);

    browsed(&mut host, browse("community.plain", "movie", "top", &[]));
    browsed(&mut host, browse("community.plain", "movie", "top", &[]));

    assert_eq!(
        fetcher
            .asked()
            .iter()
            .filter(|url| url.as_str() == "https://searchable.example.com/catalog/movie/top.json")
            .count(),
        2,
        "a page with no cache hint is not kept, so it is asked for again"
    );
}

#[test]
fn a_page_the_addon_said_may_outlive_itself_is_served_when_the_addon_goes_away() {
    // `staleError` is the Addon saying "serve this if I cannot be reached" — and
    // the window it describes is `cacheMaxAge` extended by `staleError`. A page
    // it may not keep is re-asked for, and the last good answer is served when
    // the asking fails.
    let switchboard = Arc::new(Switchboard::new(
        FixtureFetcher::new()
            .serving(SEARCHABLE, searchable_manifest("community.plain", "Plain"))
            .serving(
                "https://searchable.example.com/catalog/movie/top.json",
                r#"{"metas":[{"id":"tt1","type":"movie","name":"Left Behind"}],
                    "cacheMaxAge":0,"staleError":3600}"#,
            ),
    ));
    let mut host = Host::new(
        Arc::new(InMemoryStore::new()) as Arc<dyn Store>,
        switchboard.clone(),
        secrets(),
        Arc::new(AddonProvider::new(switchboard.clone())),
        player(),
        clock(),
    )
    .expect("a Host over a store starts");
    configure(&mut host, SEARCHABLE);
    browsed(&mut host, browse("community.plain", "movie", "top", &[]));

    switchboard.failing(true);
    let response = browsed(&mut host, browse("community.plain", "movie", "top", &[]));

    let row = &rows(&response)[0];
    assert_eq!(
        row.failure, None,
        "the Addon being down is not the client's problem yet"
    );
    assert_eq!(names(row), vec!["Left Behind"]);
}

#[test]
fn a_page_the_addon_said_nothing_about_serving_stale_is_reported_when_it_fails() {
    let switchboard = Arc::new(Switchboard::new(
        FixtureFetcher::new()
            .serving(SEARCHABLE, searchable_manifest("community.plain", "Plain"))
            .serving(
                "https://searchable.example.com/catalog/movie/top.json",
                r#"{"metas":[{"id":"tt1","type":"movie","name":"Left Behind"}]}"#,
            ),
    ));
    let mut host = Host::new(
        Arc::new(InMemoryStore::new()) as Arc<dyn Store>,
        switchboard.clone(),
        secrets(),
        Arc::new(AddonProvider::new(switchboard.clone())),
        player(),
        clock(),
    )
    .expect("a Host over a store starts");
    configure(&mut host, SEARCHABLE);
    browsed(&mut host, browse("community.plain", "movie", "top", &[]));

    switchboard.failing(true);
    let response = browsed(&mut host, browse("community.plain", "movie", "top", &[]));

    assert!(
        matches!(rows(&response)[0].failure, Some(ActionError::Fetch { .. })),
        "an Addon that said nothing about stale answers has nothing to serve: {:?}",
        rows(&response)[0]
    );
}

#[test]
fn browsing_an_addon_the_host_does_not_have_is_refused() {
    let (mut host, _fetcher) = host_with_recorded_addons();

    let refused = host.dispatch(browse("org.example.nowhere", "movie", "top", &[]));

    assert!(matches!(
        refused,
        Err(ActionError::UnknownAddon { ref id }) if id == "org.example.nowhere"
    ));
}

#[test]
fn browsing_a_catalog_the_addon_never_declared_is_refused() {
    let (mut host, fetcher) = host_with_recorded_addons();
    let asked_before = fetcher.asked().len();

    let refused = host.dispatch(browse("com.linvo.cinemeta", "movie", "nowhere", &[]));

    assert_eq!(
        refused.err(),
        Some(ActionError::UnknownCatalog {
            addon: host_core::AddonId::parse("com.linvo.cinemeta").expect("an Addon id"),
            catalog: host_core::CatalogRef::parse("movie", "nowhere").expect("a catalog"),
        })
    );
    assert_eq!(
        fetcher.asked().len(),
        asked_before,
        "a catalog that was never declared is not asked for"
    );
}

#[test]
fn a_value_the_catalog_never_declared_is_refused() {
    let (mut host, fetcher) = host_with_recorded_addons();
    let asked_before = fetcher.asked().len();

    let refused = host.dispatch(browse(
        "com.linvo.cinemeta",
        "movie",
        "top",
        &[("sort", "newest")],
    ));

    assert!(
        matches!(refused, Err(ActionError::Extra { ref detail }) if detail.contains("sort")),
        "a value the catalog never declared is named: {refused:?}"
    );
    assert_eq!(fetcher.asked().len(), asked_before);
}

#[test]
fn a_value_the_catalog_requires_is_filled_in_from_what_it_offers() {
    // Cinemeta's `year` catalog cannot be asked for without a `genre`, so the
    // Host — the client of the protocol (ADR-0006) — sends the first one it
    // offers rather than making the window know that.
    let (mut host, fetcher) = host_with_recorded_addons();

    let response = browsed(
        &mut host,
        browse("com.linvo.cinemeta", "movie", "year", &[]),
    );

    assert_eq!(
        fetcher.asked().last().map(String::as_str),
        Some(CINEMETA_YEAR),
        "the required value is filled in with the first one the catalog offers"
    );
    assert_eq!(rows(&response)[0].failure, None);
}

#[test]
fn a_catalog_that_requires_a_value_offering_none_says_so_rather_than_being_asked() {
    let (mut host, fetcher) = host_with_recorded_addons();
    let asked_before = fetcher.asked().len();

    let refused = host.dispatch(browse("com.linvo.cinemeta", "series", "last-videos", &[]));

    assert!(
        matches!(refused, Err(ActionError::Extra { ref detail }) if detail.contains("lastVideosIds")),
        "a catalog with nothing to default to is refused, and named: {refused:?}"
    );
    assert_eq!(fetcher.asked().len(), asked_before);
}

#[test]
fn a_catalog_row_is_the_declared_wire_shape() {
    // The window reads this by hand, so the shape it declares is the shape that
    // arrives — and it carries no field a credential could occupy.
    let (mut host, _fetcher) = host_with_recorded_addons();

    let response = browsed(&mut host, browse("com.linvo.cinemeta", "movie", "top", &[]));
    let published = serde_json::to_value(&response).expect("a Response serializes");

    assert_eq!(published["snapshots"], serde_json::json!([]));
    let row = &published["answer"]["catalogs"][0];
    assert_eq!(row["addon"], "com.linvo.cinemeta");
    assert_eq!(row["type"], "movie");
    assert_eq!(row["id"], "top");
    assert_eq!(row["name"], "Popular");
    assert_eq!(row["failure"], serde_json::Value::Null);
    assert_eq!(row["metas"][0]["id"], "tt22084616");
    assert_eq!(
        row["metas"][0]["posterShape"],
        serde_json::Value::Null,
        "the wire shape is camelCased for a JavaScript client"
    );
}

// --- the addons the tests build for themselves -------------------------------

const SEARCHABLE: &str = "https://searchable.example.com/manifest.json";
const ALSO_SEARCHABLE: &str = "https://other.example.com/manifest.json";
const WITHOUT_SEARCH: &str = "https://plain.example.com/manifest.json";

fn host_over(fetcher: Arc<FixtureFetcher>) -> Host {
    Host::new(
        Arc::new(InMemoryStore::new()) as Arc<dyn Store>,
        fetcher.clone(),
        secrets(),
        provider(&fetcher),
        player(),
        clock(),
    )
    .expect("a Host over a store starts")
}

fn searchable_manifest(id: &str, name: &str) -> String {
    serde_json::json!({
        "id": id,
        "name": name,
        "version": "1.0.0",
        "resources": ["catalog"],
        "types": ["movie"],
        "catalogs": [{
            "type": "movie",
            "id": "top",
            "name": "Top",
            "extra": [{ "name": "search" }, { "name": "skip" }],
        }],
    })
    .to_string()
}

fn plain_manifest(id: &str) -> String {
    serde_json::json!({
        "id": id,
        "name": "Plain",
        "version": "1.0.0",
        "resources": ["catalog"],
        "types": ["movie"],
        "catalogs": [{ "type": "movie", "id": "top", "name": "Top" }],
    })
    .to_string()
}

/// A page with these names in it, for the Addons the tests build themselves.
fn page_of(names: &[&str]) -> String {
    serde_json::json!({
        "metas": names
            .iter()
            .enumerate()
            .map(|(index, name)| serde_json::json!({
                "id": format!("tt{}", index + 1),
                "type": "movie",
                "name": name,
                "poster": "https://example.com/poster.jpg",
            }))
            .collect::<Vec<_>>(),
    })
    .to_string()
}

/// A [`Fetcher`] that can be told to start failing, the way an Addon that goes
/// down mid-session does.
struct Switchboard {
    inner: FixtureFetcher,
    failing: AtomicBool,
    asked: Mutex<Vec<String>>,
}

impl Switchboard {
    fn new(inner: FixtureFetcher) -> Self {
        Self {
            inner,
            failing: AtomicBool::new(false),
            asked: Mutex::new(Vec::new()),
        }
    }

    fn failing(&self, yes: bool) {
        self.failing.store(yes, Ordering::SeqCst);
    }
}

impl Fetcher for Switchboard {
    fn fetch_with_headers(
        &self,
        url: &str,
        headers: &[(&str, &str)],
    ) -> Result<String, FetchError> {
        self.asked
            .lock()
            .expect("the switchboard is not poisoned")
            .push(url.to_owned());
        if self.failing.load(Ordering::SeqCst) {
            return Err(FetchError::Unreachable {
                detail: "the Addon went away".to_owned(),
            });
        }
        self.inner.fetch_with_headers(url, headers)
    }
}
