//! The Title cache, driven the way a client drives it: an Action in, an Answer
//! out, and a store that survives a restart (ADR-0038, #271). Nothing below
//! names the cache or its table; a cache hit is proved by the fixture fetcher
//! being asked nothing.

use std::sync::Arc;

use host_core::{
    Action, AddonId, AddonProvider, Answer, FixtureClock, FixtureFetcher,
    FixturePlayer, FixtureStremio, Host, InMemorySecretStore, InMemoryStore, Provider,
    SecretBackend, Store, Title, TitleCard, TitleKey, TitleStub, VideoRef, WatchProgress,
    ACTION_VERSION, MAX_CACHED_TITLES,
};
use serde_json::{json, Value};

const CINEMETA: &str = "https://v3-cinemeta.strem.io/manifest.json";
const CINEMETA_MOVIE: &str = "https://v3-cinemeta.strem.io/meta/movie/tt0133093.json";
const CINEMETA_SERIES: &str = "https://v3-cinemeta.strem.io/meta/series/tt0903747.json";

const TMDB_KEY: &str = "0123456789abcdef0123456789abcdef";
const TMDB_FIND_SERIES: &str =
    "https://api.themoviedb.org/3/find/tt0903747?external_source=imdb_id&api_key=0123456789abcdef0123456789abcdef";
const TMDB_MOVIE_603: &str =
    "https://api.themoviedb.org/3/movie/603?api_key=0123456789abcdef0123456789abcdef";
const TMDB_TV_1396: &str =
    "https://api.themoviedb.org/3/tv/1396?api_key=0123456789abcdef0123456789abcdef";
const TMDB_TV_1396_SEASON_0: &str =
    "https://api.themoviedb.org/3/tv/1396/season/0?api_key=0123456789abcdef0123456789abcdef";
const TMDB_TV_1396_SEASON_1: &str =
    "https://api.themoviedb.org/3/tv/1396/season/1?api_key=0123456789abcdef0123456789abcdef";
const TMDB_TV_1396_SEASON_2: &str =
    "https://api.themoviedb.org/3/tv/1396/season/2?api_key=0123456789abcdef0123456789abcdef";
const TMDB_TV_200001: &str =
    "https://api.themoviedb.org/3/tv/200001?api_key=0123456789abcdef0123456789abcdef";

const CINEMETA_MANIFEST: &str = include_str!("fixtures/cinemeta-manifest.json");
const MOVIE_BODY: &str = include_str!("fixtures/cinemeta-meta-movie.json");
const SERIES_BODY: &str = include_str!("fixtures/cinemeta-meta-series.json");
const TMDB_FIND_SERIES_BODY: &str = include_str!("fixtures/tmdb-find-bb.json");
const TMDB_MOVIE_DETAILS: &str = include_str!("fixtures/tmdb-movie-details.json");
const TMDB_TV_DETAILS: &str = include_str!("fixtures/tmdb-tv-details.json");
const TMDB_TV_DETAILS_MAKING: &str = include_str!("fixtures/tmdb-tv-details-making.json");
const TMDB_TV_SEASON_0: &str = include_str!("fixtures/tmdb-tv-season-0.json");
const TMDB_TV_SEASON_1: &str = include_str!("fixtures/tmdb-tv-season-1.json");
const TMDB_TV_SEASON_2: &str = include_str!("fixtures/tmdb-tv-season-2.json");

const DAY: i64 = 24 * 60 * 60 * 1000;
const SIX_MONTHS: i64 = 180 * DAY;

/// An Action as a client sends it: the versioned envelope, as JSON text.
fn action(body: &Value) -> Action {
    let envelope = format!(r#"{{"version":{ACTION_VERSION},"action":{body}}}"#);
    Action::parse(&envelope).unwrap_or_else(|error| panic!("{envelope} should parse: {error}"))
}

fn open(addon: &str, r#type: &str, id: &str) -> Action {
    action(&json!({
        "type": "open_title",
        "addon": addon,
        "title": { "type": r#type, "id": id },
    }))
}

fn open_discovered(id: u32, kind: &str) -> Action {
    action(&json!({
        "type": "open_discovered_title",
        "key": { "kind": "tmdb", "id": id },
        "kind": kind,
    }))
}

fn title(response: &host_core::Response) -> &Title {
    response
        .title()
        .unwrap_or_else(|| panic!("opening a Title should answer with one: {response:?}"))
}

fn opened(host: &mut Host, action: Action) -> Title {
    let response = host
        .dispatch(action)
        .unwrap_or_else(|error| panic!("opening a Title should work: {error}"));
    title(&response).clone()
}

fn secrets() -> Arc<InMemorySecretStore> {
    Arc::new(InMemorySecretStore::backed_by(SecretBackend::Keyring))
}

fn provider(fetcher: &Arc<FixtureFetcher>) -> Arc<dyn Provider> {
    Arc::new(AddonProvider::new(fetcher.clone()))
}

fn configure(host: &mut Host, url: &str) {
    host.dispatch(action(&json!({ "type": "add_addon", "url": url })))
        .unwrap_or_else(|error| panic!("configuring {url} should work: {error}"));
}

fn set_tmdb_key(host: &mut Host) {
    host.dispatch(action(&json!({ "type": "set_tmdb_key", "key": TMDB_KEY })))
        .expect("entering a TMDB key should work");
}

fn clear_tmdb_key(host: &mut Host) {
    host.dispatch(action(&json!({ "type": "clear_tmdb_key" })))
        .expect("clearing a TMDB key should work");
}

fn remove_addon(host: &mut Host, id: &str) {
    host.dispatch(action(&json!({ "type": "remove_addon", "id": id })))
        .unwrap_or_else(|error| panic!("removing {id} should work: {error}"));
}

/// The fixture clock every freshness test is driven by.
fn clock() -> Arc<FixtureClock> {
    Arc::new(FixtureClock::new().at(1_000))
}

fn host_over(
    store: Arc<InMemoryStore>,
    fetcher: Arc<FixtureFetcher>,
    clock: Arc<FixtureClock>,
    key: bool,
) -> Host {
    let mut host = Host::new(
        store as Arc<dyn Store>,
        fetcher.clone(),
        secrets(),
        provider(&fetcher),
        Arc::new(FixturePlayer::new()),
        clock,
    )
    .expect("a Host over a store starts");
    configure(&mut host, CINEMETA);
    if key {
        set_tmdb_key(&mut host);
    }
    host
}

/// A fetcher holding the recorded Cinemeta film and series.
fn addon_fetcher() -> Arc<FixtureFetcher> {
    Arc::new(
        FixtureFetcher::new()
            .serving(CINEMETA, CINEMETA_MANIFEST)
            .serving(CINEMETA_MOVIE, MOVIE_BODY)
            .serving(CINEMETA_SERIES, SERIES_BODY),
    )
}

/// The Breaking Bad path: the Addon's answer, the mapping, the record and its
/// three seasons.
fn breaking_bad_fetcher() -> FixtureFetcher {
    FixtureFetcher::new()
        .serving(CINEMETA, CINEMETA_MANIFEST)
        .serving(CINEMETA_SERIES, SERIES_BODY)
        .serving(TMDB_FIND_SERIES, TMDB_FIND_SERIES_BODY)
        .serving(TMDB_TV_1396, TMDB_TV_DETAILS)
        .serving(TMDB_TV_1396_SEASON_0, TMDB_TV_SEASON_0)
        .serving(TMDB_TV_1396_SEASON_1, TMDB_TV_SEASON_1)
        .serving(TMDB_TV_1396_SEASON_2, TMDB_TV_SEASON_2)
}

fn asked_for(fetcher: &FixtureFetcher, url: &str) -> usize {
    fetcher.asked().iter().filter(|asked| *asked == url).count()
}

// --- An open the Host already holds asks nothing ------------------------------

#[test]
fn a_second_open_of_a_fresh_title_fetches_nothing() {
    let store = Arc::new(InMemoryStore::new());
    let fetcher = addon_fetcher();
    let mut host = host_over(store.clone(), fetcher.clone(), clock(), false);

    let first = opened(&mut host, open("com.linvo.cinemeta", "movie", "tt0133093"));
    let asked = fetcher.asked().len();
    let second = opened(&mut host, open("com.linvo.cinemeta", "movie", "tt0133093"));

    assert_eq!(second, first, "the same Title is answered");
    assert_eq!(
        fetcher.asked().len(),
        asked,
        "the second open reached nothing: {:?}",
        fetcher.asked()
    );
    assert_eq!(
        store.persisted_titles().len(),
        1,
        "the Title was written down the first time and not again"
    );
    assert_eq!(store.persisted_titles()[0].title.name, "The Matrix");
}

#[test]
fn a_title_kept_on_disk_opens_on_a_restarted_host_with_no_network() {
    let store = Arc::new(InMemoryStore::new());
    let clock = clock();
    let mut first = host_over(store.clone(), addon_fetcher(), clock.clone(), false);
    let answered = opened(
        &mut first,
        open("com.linvo.cinemeta", "series", "tt0903747"),
    );
    drop(first);

    // A Host that started over the same store, with nothing recorded to reach:
    // any fetch would panic in the fixture fetcher.
    let offline = Arc::new(FixtureFetcher::new());
    let mut restarted = Host::new(
        store as Arc<dyn Store>,
        offline.clone(),
        secrets(),
        provider(&offline),
        Arc::new(FixturePlayer::new()),
        clock,
    )
    .expect("the restarted Host starts from the store");

    let reopened = opened(
        &mut restarted,
        open("com.linvo.cinemeta", "series", "tt0903747"),
    );

    assert_eq!(reopened, answered, "the kept answer is the answer");
    assert!(
        offline.asked().is_empty(),
        "a cold start with no network fetched nothing: {:?}",
        offline.asked()
    );
}

#[test]
fn a_mapped_title_is_kept_whole_and_the_second_open_does_not_ask_tmdb_again() {
    let store = Arc::new(InMemoryStore::new());
    let fetcher = Arc::new(breaking_bad_fetcher().serving(TMDB_FIND_SERIES, TMDB_FIND_SERIES_BODY));
    let mut host = host_over(store.clone(), fetcher.clone(), clock(), true);

    let first = opened(&mut host, open("com.linvo.cinemeta", "series", "tt0903747"));
    let asked = fetcher.asked().len();
    let second = opened(&mut host, open("com.linvo.cinemeta", "series", "tt0903747"));

    assert_eq!(second, first);
    assert_eq!(first.key, TitleKey::Tmdb { id: 1396 });
    assert_eq!(
        fetcher.asked().len(),
        asked,
        "no Addon, no find and no season was asked again: {:?}",
        fetcher.asked()
    );
    assert_eq!(
        store.persisted_titles()[0].source,
        host_core::TitleSource::Both,
        "the kept copy is the joined one, so its TMDB half is the terms' to expire"
    );
}

// --- Fresh for a day or a month ----------------------------------------------

#[test]
fn a_running_series_is_fresh_for_a_day_and_refetched_after_it() {
    let store = Arc::new(InMemoryStore::new());
    let fetcher = Arc::new(
        FixtureFetcher::new()
            .serving(CINEMETA, CINEMETA_MANIFEST)
            .serving(TMDB_TV_200001, TMDB_TV_DETAILS_MAKING),
    );
    let clock = clock();
    let mut host = host_over(store, fetcher.clone(), clock.clone(), true);

    opened(&mut host, open_discovered(200001, "series"));
    assert_eq!(asked_for(&fetcher, TMDB_TV_200001), 1);

    clock.tick(DAY - 1);
    opened(&mut host, open_discovered(200001, "series"));
    assert_eq!(
        asked_for(&fetcher, TMDB_TV_200001),
        1,
        "inside the day it is fresh"
    );

    clock.tick(2);
    opened(&mut host, open_discovered(200001, "series"));
    assert_eq!(
        asked_for(&fetcher, TMDB_TV_200001),
        1,
        "a stale open answers the cached copy before it reaches anything"
    );
    assert_eq!(host.drain(), 1);
    assert_eq!(
        asked_for(&fetcher, TMDB_TV_200001),
        2,
        "past the day draining reads it again (#272)"
    );
}

#[test]
fn a_film_is_fresh_for_thirty_days_and_refetched_after_them() {
    let store = Arc::new(InMemoryStore::new());
    let fetcher = Arc::new(
        FixtureFetcher::new()
            .serving(CINEMETA, CINEMETA_MANIFEST)
            .serving(TMDB_MOVIE_603, TMDB_MOVIE_DETAILS),
    );
    let clock = clock();
    let mut host = host_over(store, fetcher.clone(), clock.clone(), true);

    opened(&mut host, open_discovered(603, "movie"));
    clock.tick(30 * DAY - 1);
    opened(&mut host, open_discovered(603, "movie"));
    assert_eq!(asked_for(&fetcher, TMDB_MOVIE_603), 1, "inside the month");

    clock.tick(2);
    opened(&mut host, open_discovered(603, "movie"));
    assert_eq!(
        asked_for(&fetcher, TMDB_MOVIE_603),
        1,
        "the stale open is answered from the cache"
    );
    assert_eq!(host.drain(), 1);
    assert_eq!(
        asked_for(&fetcher, TMDB_MOVIE_603),
        2,
        "past the month draining reads it again (#272)"
    );
}

#[test]
fn an_ended_series_is_fresh_for_thirty_days_and_refetched_after_them() {
    let store = Arc::new(InMemoryStore::new());
    let fetcher = Arc::new(breaking_bad_fetcher());
    let clock = clock();
    let mut host = host_over(store, fetcher.clone(), clock.clone(), true);

    opened(&mut host, open_discovered(1396, "series"));
    let season_reads = asked_for(&fetcher, TMDB_TV_1396_SEASON_1);
    clock.tick(30 * DAY - 1);
    opened(&mut host, open_discovered(1396, "series"));
    assert_eq!(
        asked_for(&fetcher, TMDB_TV_1396_SEASON_1),
        season_reads,
        "a series TMDB says has ended is not read again inside the month"
    );

    clock.tick(2);
    opened(&mut host, open_discovered(1396, "series"));
    assert_eq!(
        asked_for(&fetcher, TMDB_TV_1396_SEASON_1),
        season_reads,
        "the stale open is answered from the cache"
    );
    assert_eq!(host.drain(), 1);
    assert_eq!(
        asked_for(&fetcher, TMDB_TV_1396_SEASON_1),
        season_reads + 1,
        "past the month draining reads its Videos again (#272)"
    );
}

#[test]
fn an_addons_title_is_fresh_for_thirty_days_and_refetched_after_them() {
    let store = Arc::new(InMemoryStore::new());
    let fetcher = addon_fetcher();
    let clock = clock();
    let mut host = host_over(store, fetcher.clone(), clock.clone(), false);

    opened(&mut host, open("com.linvo.cinemeta", "movie", "tt0133093"));
    clock.tick(30 * DAY - 1);
    opened(&mut host, open("com.linvo.cinemeta", "movie", "tt0133093"));
    assert_eq!(asked_for(&fetcher, CINEMETA_MOVIE), 1);

    clock.tick(2);
    opened(&mut host, open("com.linvo.cinemeta", "movie", "tt0133093"));
    assert_eq!(
        asked_for(&fetcher, CINEMETA_MOVIE),
        1,
        "the stale open is answered from the cache"
    );
    assert_eq!(host.drain(), 1);
    assert_eq!(
        asked_for(&fetcher, CINEMETA_MOVIE),
        2,
        "a stale Title is refetched behind its answer (#272)"
    );
}

// --- A source removed ---------------------------------------------------------

#[test]
fn removing_a_titles_addon_keeps_its_copy_until_it_goes_stale() {
    let store = Arc::new(InMemoryStore::new());
    let fetcher = addon_fetcher();
    let clock = clock();
    let mut host = host_over(store.clone(), fetcher.clone(), clock.clone(), false);
    opened(&mut host, open("com.linvo.cinemeta", "movie", "tt0133093"));

    remove_addon(&mut host, "com.linvo.cinemeta");
    let asked = fetcher.asked().len();

    let kept = opened(&mut host, open("com.linvo.cinemeta", "movie", "tt0133093"));
    assert_eq!(
        kept.name, "The Matrix",
        "the removed Addon's copy still opens"
    );
    assert_eq!(fetcher.asked().len(), asked, "and it asked nothing");

    clock.tick(30 * DAY + 1);
    let stale = opened(&mut host, open("com.linvo.cinemeta", "movie", "tt0133093"));
    assert_eq!(
        stale.name, "The Matrix",
        "a stale copy is still served: the refresh cannot better it"
    );
    assert_eq!(host.drain(), 1);
    assert_eq!(
        fetcher.asked().len(),
        asked,
        "the failed refresh asked nothing"
    );
    assert_eq!(
        store.persisted_titles().len(),
        1,
        "the copy is kept rather than thrown away with the Addon"
    );
}

#[test]
fn removing_the_tmdb_key_keeps_a_discovered_title_until_it_goes_stale() {
    let store = Arc::new(InMemoryStore::new());
    let fetcher = Arc::new(
        FixtureFetcher::new()
            .serving(CINEMETA, CINEMETA_MANIFEST)
            .serving(TMDB_MOVIE_603, TMDB_MOVIE_DETAILS),
    );
    let clock = clock();
    let mut host = host_over(store, fetcher.clone(), clock.clone(), true);
    opened(&mut host, open_discovered(603, "movie"));

    clear_tmdb_key(&mut host);
    let asked = fetcher.asked().len();
    let kept = opened(&mut host, open_discovered(603, "movie"));
    assert_eq!(kept.name, "The Matrix");
    assert_eq!(fetcher.asked().len(), asked, "no key, and no fetch either");

    clock.tick(30 * DAY + 1);
    let stale = opened(&mut host, open_discovered(603, "movie"));
    assert_eq!(
        stale.name, "The Matrix",
        "a stale Discovered Title is still served"
    );
    assert_eq!(host.drain(), 1);
    assert_eq!(
        fetcher.asked().len(),
        asked,
        "the failed refresh fetched nothing"
    );
}

#[test]
fn a_stale_title_whose_addon_is_gone_is_refetched_from_tmdb() {
    let store = Arc::new(InMemoryStore::new());
    let fetcher = Arc::new(breaking_bad_fetcher());
    let clock = clock();
    let mut host = host_over(store, fetcher.clone(), clock.clone(), true);
    opened(&mut host, open("com.linvo.cinemeta", "series", "tt0903747"));

    remove_addon(&mut host, "com.linvo.cinemeta");
    clock.tick(30 * DAY + 1);
    let asked = fetcher.asked().len();

    let stale = opened(&mut host, open("com.linvo.cinemeta", "series", "tt0903747"));
    assert_eq!(
        stale.key,
        TitleKey::Tmdb { id: 1396 },
        "the stale copy still opens"
    );

    assert_eq!(host.drain(), 1);
    let refreshed = opened(&mut host, open("com.linvo.cinemeta", "series", "tt0903747"));

    assert_eq!(refreshed.key, TitleKey::Tmdb { id: 1396 });
    assert_eq!(
        refreshed.addon,
        Some(AddonId::parse("com.linvo.cinemeta").expect("an Addon id")),
        "TMDB described it, but the Title is still the one the client opened"
    );
    assert_eq!(
        refreshed.id, "tt0903747",
        "an Addon's id, kept however the refreshed copy is described"
    );
    assert_eq!(
        fetcher.asked().len(),
        asked + 4,
        "draining read the record and its three seasons again: {:?}",
        &fetcher.asked()[asked..]
    );
}

// --- The bound ----------------------------------------------------------------

/// The URL a synthetic Title is asked at: Cinemeta answers `tt…` films.
fn synthetic_url(index: usize) -> String {
    format!("https://v3-cinemeta.strem.io/meta/movie/tt{index:07}.json")
}

/// A fetcher serving the manifest and `count` distinct Titles, so the bound can
/// be reached without recording a hundred files.
fn synthetic_fetcher(count: usize) -> Arc<FixtureFetcher> {
    let mut fetcher = FixtureFetcher::new().serving(CINEMETA, CINEMETA_MANIFEST);
    for index in 0..=count {
        fetcher = fetcher.serving(&synthetic_url(index), r#"{"meta":{"name":"One"}}"#);
    }
    Arc::new(fetcher)
}

fn synthetic(id: usize) -> String {
    format!("tt{id:07}")
}

/// The Watch progress a card leaves behind: enough to be the Title the cache
/// must not evict, and nothing else.
fn watched(index: usize) -> WatchProgress {
    let id = synthetic(index);
    WatchProgress {
        video: VideoRef::parse("movie", &id).expect("a Video"),
        title: TitleStub::parse(&TitleCard {
            addon: Some(AddonId::parse("com.linvo.cinemeta").expect("an Addon id")),
            id: id.clone(),
            r#type: "movie".to_owned(),
            name: "One".to_owned(),
            poster: None,
            background: None,
        })
        .expect("a Title"),
        position: Some(10.0),
        duration: Some(100.0),
        watched: false,
        updated_at: 0,
    }
}

#[test]
fn the_cache_never_evicts_a_title_behind_watch_progress() {
    let store = Arc::new(InMemoryStore::new().holding_watch(vec![watched(0)]));
    let fetcher = synthetic_fetcher(MAX_CACHED_TITLES + 1);
    let clock = clock();
    let mut host = host_over(store, fetcher.clone(), clock.clone(), false);

    opened(
        &mut host,
        open("com.linvo.cinemeta", "movie", &synthetic(0)),
    );
    for index in 1..=MAX_CACHED_TITLES {
        clock.tick(1);
        opened(
            &mut host,
            open("com.linvo.cinemeta", "movie", &synthetic(index)),
        );
    }

    opened(
        &mut host,
        open("com.linvo.cinemeta", "movie", &synthetic(0)),
    );
    assert_eq!(
        asked_for(&fetcher, &synthetic_url(0)),
        1,
        "the Title behind Watch progress survived the bound"
    );

    opened(
        &mut host,
        open("com.linvo.cinemeta", "movie", &synthetic(1)),
    );
    assert_eq!(
        asked_for(&fetcher, &synthetic_url(1)),
        2,
        "the oldest read that nothing protected is the one that went"
    );
}

fn library_item(index: usize) -> Value {
    json!({
        "_id": synthetic(index),
        "name": "One",
        "type": "movie",
        "poster": "https://images.example.org/one.jpg",
        "posterShape": "poster",
        "removed": false,
        "temp": false,
        "_mtime": "2026-01-01T00:00:00.000Z",
        "state": { "timeOffset": 0, "duration": 3_600_000 }
    })
}

fn sign_in(host: &mut Host) {
    host.dispatch(action(&json!({
        "type": "sign_in_stremio",
        "email": "me@example.org",
        "password": "hunter2"
    })))
    .expect("signing in");
}

fn read_library(host: &mut Host) {
    match host
        .dispatch(Action::Library)
        .expect("the Library question")
    {
        host_core::Response {
            answer: Some(Answer::Library(_)),
            ..
        } => {}
        other => panic!("expected a Library answer, got {other:?}"),
    }
}

#[test]
fn the_cache_never_evicts_a_title_in_the_library() {
    let stremio = Arc::new(
        FixtureStremio::new()
            .with_account("me@example.org", "hunter2", "AUTHKEY")
            .holding(vec![library_item(0)]),
    );
    let store = Arc::new(InMemoryStore::new());
    let fetcher = synthetic_fetcher(MAX_CACHED_TITLES + 1);
    let clock = clock();
    let mut host = host_over(store, fetcher.clone(), clock.clone(), false).with_stremio(stremio);
    sign_in(&mut host);
    read_library(&mut host);

    opened(
        &mut host,
        open("com.linvo.cinemeta", "movie", &synthetic(0)),
    );
    for index in 1..=MAX_CACHED_TITLES {
        clock.tick(1);
        opened(
            &mut host,
            open("com.linvo.cinemeta", "movie", &synthetic(index)),
        );
    }

    opened(
        &mut host,
        open("com.linvo.cinemeta", "movie", &synthetic(0)),
    );
    assert_eq!(
        asked_for(&fetcher, &synthetic_url(0)),
        1,
        "the Library's Title survived the bound"
    );
}

// --- TMDB's six-month ceiling -------------------------------------------------

#[test]
fn a_tmdb_copy_past_six_months_is_dropped_even_behind_watch_progress() {
    let store = Arc::new(InMemoryStore::new().holding_watch(vec![WatchProgress {
        video: VideoRef::parse("movie", "tmdb:603").expect("a Video"),
        title: TitleStub::parse(&TitleCard {
            addon: None,
            id: "tmdb:603".to_owned(),
            r#type: "movie".to_owned(),
            name: "The Matrix".to_owned(),
            poster: None,
            background: None,
        })
        .expect("a Title"),
        position: Some(10.0),
        duration: Some(100.0),
        watched: false,
        updated_at: 0,
    }]));
    let fetcher = Arc::new(
        FixtureFetcher::new()
            .serving(CINEMETA, CINEMETA_MANIFEST)
            .serving(TMDB_MOVIE_603, TMDB_MOVIE_DETAILS)
            .serving(TMDB_TV_200001, TMDB_TV_DETAILS_MAKING),
    );
    let clock = clock();
    let mut host = host_over(store.clone(), fetcher, clock.clone(), true);
    opened(&mut host, open_discovered(603, "movie"));
    assert_eq!(store.persisted_titles().len(), 1);

    clock.tick(SIX_MONTHS + 1);
    // One more read is what asks the cache to make room; the watched copy is
    // past the terms ceiling and goes first.
    opened(&mut host, open_discovered(200001, "series"));

    assert!(
        store
            .persisted_titles()
            .iter()
            .all(|cached| cached.title.key != TitleKey::Tmdb { id: 603 }),
        "TMDB's terms outrank Watch progress: {:?}",
        store
            .persisted_titles()
            .iter()
            .map(|cached| &cached.title.key)
            .collect::<Vec<_>>()
    );
}
