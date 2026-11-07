//! Stale Titles open at once and refresh behind the client (ADR-0038 §2, #272).
//!
//! The Host is driven the way a client drives it: an Action in, the Answer out,
//! and the background queue drained inline. A revision is proved to reach the
//! client whose open queued it and nobody else; a refresh that changed nothing,
//! failed or met a `429` is proved to reach nobody and keep the copy.

use std::sync::Arc;

use host_core::{
    Action, AddonProvider, Answer, FetchError, FixtureClock, FixtureFetcher, FixturePlayer,
    FixtureRevisions, Host, InMemorySecretStore, InMemoryStore, Provider, RevisionSink,
    SecretBackend, Store, Title,
};
use serde_json::{json, Value};

const CINEMETA: &str = "https://v3-cinemeta.strem.io/manifest.json";
const CINEMETA_MOVIE: &str = "https://v3-cinemeta.strem.io/meta/movie/tt0133093.json";

const TMDB_KEY: &str = "0123456789abcdef0123456789abcdef";
/// The one request a series' details and its Videos are read with (#270).
const TMDB_TV_200001: &str = concat!(
    "https://api.themoviedb.org/3/tv/200001?append_to_response=",
    "season/0,season/1,season/2,season/3,season/4,season/5,season/6,season/7,",
    "season/8,season/9,season/10,season/11,season/12,season/13,season/14,season/15,",
    "season/16,season/17,season/18,season/19",
    "&api_key=0123456789abcdef0123456789abcdef",
);

const CINEMETA_MANIFEST: &str = include_str!("fixtures/cinemeta-manifest.json");
const MOVIE_BODY: &str = include_str!("fixtures/cinemeta-meta-movie.json");
const TMDB_TV_DETAILS_MAKING: &str = include_str!("fixtures/tmdb-tv-details-making.json");

/// A meta answer that is the same Title, changed: what a background refresh
/// brings when a source has news.
const MOVIE_CHANGED: &str = r#"{"meta":{"id":"tt0133093","type":"movie","name":"The Matrix Resurrections","description":"A changed copy."}}"#;

const DAY: i64 = 24 * 60 * 60 * 1000;

/// An Action as a client sends it: the versioned envelope, as JSON text.
fn action(body: &Value) -> Action {
    let envelope = format!(r#"{{"version":1,"action":{body}}}"#);
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

fn look_hint(addon: Option<&str>, r#type: &str, id: &str) -> Action {
    action(&json!({
        "type": "look_hint",
        "addon": addon,
        "title": { "type": r#type, "id": id },
    }))
}

fn title(response: &host_core::Response) -> &Title {
    response
        .title()
        .unwrap_or_else(|| panic!("opening a Title should answer with one: {response:?}"))
}

fn opened(host: &mut Host, action: Action) -> Title {
    title(
        &host
            .dispatch(action)
            .unwrap_or_else(|error| panic!("opening a Title should work: {error}")),
    )
    .clone()
}

/// The same open, saying which client is owed a revised Answer if it changes.
fn opened_asking(host: &mut Host, action: Action, revisions: &Arc<FixtureRevisions>) -> Title {
    let revisions: Option<Arc<dyn RevisionSink>> = Some(revisions.clone());
    title(
        &host
            .dispatch_asking(action, revisions)
            .unwrap_or_else(|error| panic!("opening a Title should work: {error}")),
    )
    .clone()
}

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
        Arc::new(InMemorySecretStore::backed_by(SecretBackend::Keyring)),
        Arc::new(AddonProvider::new(fetcher.clone())) as Arc<dyn Provider>,
        Arc::new(FixturePlayer::new()),
        clock,
    )
    .expect("a Host over a store starts");
    host.dispatch(action(&json!({ "type": "add_addon", "url": CINEMETA })))
        .unwrap_or_else(|error| panic!("configuring Cinemeta should work: {error}"));
    if key {
        host.dispatch(action(&json!({ "type": "set_tmdb_key", "key": TMDB_KEY })))
            .expect("entering a TMDB key should work");
    }
    host
}

fn addon_fetcher() -> Arc<FixtureFetcher> {
    Arc::new(
        FixtureFetcher::new()
            .serving(CINEMETA, CINEMETA_MANIFEST)
            .serving(CINEMETA_MOVIE, MOVIE_BODY),
    )
}

fn revised_titles(revisions: &FixtureRevisions) -> Vec<Title> {
    revisions
        .revised()
        .into_iter()
        .map(|answer| match answer {
            Answer::Revision(title) => *title,
            other => panic!("a revision is a revised Title, not {other:?}"),
        })
        .collect()
}

// --- A stale open is answered at once, and refreshed once ---------------------

#[test]
fn a_stale_title_opens_at_once_and_two_opens_queue_one_refresh() {
    let fetcher = addon_fetcher();
    let clock = clock();
    let mut host = host_over(
        Arc::new(InMemoryStore::new()),
        fetcher.clone(),
        clock.clone(),
        false,
    );

    let first = opened(&mut host, open("com.linvo.cinemeta", "movie", "tt0133093"));
    let asked = fetcher.asked().len();

    clock.tick(30 * DAY + 1);
    let stale = opened(&mut host, open("com.linvo.cinemeta", "movie", "tt0133093"));
    assert_eq!(stale, first, "the stale open is answered from the cache");
    assert_eq!(
        fetcher.asked().len(),
        asked,
        "no fetch happened before the answer: {:?}",
        fetcher.asked()
    );

    let again = opened(&mut host, open("com.linvo.cinemeta", "movie", "tt0133093"));
    assert_eq!(again, first);
    assert_eq!(fetcher.asked().len(), asked);

    assert_eq!(
        host.drain().ran,
        1,
        "two opens of one stale Title are one job"
    );
    assert_eq!(
        fetcher.asked().len(),
        asked + 1,
        "draining refetched it exactly once: {:?}",
        fetcher.asked()
    );
}

#[test]
fn a_stale_discovered_title_opens_at_once_and_refreshes_behind() {
    let fetcher = Arc::new(
        FixtureFetcher::new()
            .serving(CINEMETA, CINEMETA_MANIFEST)
            .serving(TMDB_TV_200001, TMDB_TV_DETAILS_MAKING),
    );
    let clock = clock();
    let mut host = host_over(
        Arc::new(InMemoryStore::new()),
        fetcher.clone(),
        clock.clone(),
        true,
    );
    let staged = Arc::new(FixtureRevisions::new());

    let cached = opened(&mut host, open_discovered(200001, "series"));
    let asked = fetcher.asked().len();
    clock.tick(DAY + 1);

    let changed = TMDB_TV_DETAILS_MAKING.replace("Still Making", "Still Making More");
    fetcher.update(TMDB_TV_200001, Ok(changed));

    let stale = opened_asking(&mut host, open_discovered(200001, "series"), &staged);
    assert_eq!(stale, cached, "the stale open is answered from the cache");
    assert_eq!(
        fetcher.asked().len(),
        asked,
        "and reached nothing before it"
    );

    assert_eq!(host.drain().ran, 1);
    let revised = revised_titles(&staged);
    assert_eq!(revised.len(), 1);
    assert_eq!(revised[0].name, "Still Making More");
}

// --- A revision goes to the asking client, and only for a change --------------

#[test]
fn a_refresh_that_changed_the_title_answers_only_the_client_that_asked() {
    let fetcher = addon_fetcher();
    let clock = clock();
    let mut host = host_over(
        Arc::new(InMemoryStore::new()),
        fetcher.clone(),
        clock.clone(),
        false,
    );
    let asker = Arc::new(FixtureRevisions::new());
    let bystander = Arc::new(FixtureRevisions::new());

    let cached = opened(&mut host, open("com.linvo.cinemeta", "movie", "tt0133093"));
    clock.tick(30 * DAY + 1);
    fetcher.update(CINEMETA_MOVIE, Ok(MOVIE_CHANGED.to_owned()));

    let stale = opened_asking(
        &mut host,
        open("com.linvo.cinemeta", "movie", "tt0133093"),
        &asker,
    );
    assert_eq!(stale, cached);

    assert_eq!(host.drain().ran, 1);

    let revised = revised_titles(&asker);
    assert_eq!(revised.len(), 1, "the asking client is told once");
    assert_eq!(revised[0].name, "The Matrix Resurrections");
    assert!(
        bystander.revised().is_empty(),
        "a client that did not ask is told nothing"
    );

    let after = opened(&mut host, open("com.linvo.cinemeta", "movie", "tt0133093"));
    assert_eq!(
        after, revised[0],
        "the refreshed copy is what the cache keeps"
    );
}

#[test]
fn a_refresh_that_changed_nothing_delivers_nothing() {
    let fetcher = addon_fetcher();
    let clock = clock();
    let mut host = host_over(
        Arc::new(InMemoryStore::new()),
        fetcher.clone(),
        clock.clone(),
        false,
    );
    let asker = Arc::new(FixtureRevisions::new());

    let cached = opened(&mut host, open("com.linvo.cinemeta", "movie", "tt0133093"));
    clock.tick(30 * DAY + 1);
    let stale = opened_asking(
        &mut host,
        open("com.linvo.cinemeta", "movie", "tt0133093"),
        &asker,
    );
    assert_eq!(stale, cached);

    assert_eq!(host.drain().ran, 1);
    assert!(
        asker.revised().is_empty(),
        "an unchanged refresh is not an Answer"
    );

    let after = opened(&mut host, open("com.linvo.cinemeta", "movie", "tt0133093"));
    assert_eq!(after, cached, "the copy is kept and re-dated");
}

#[test]
fn a_refresh_that_failed_with_429_keeps_the_copy_and_delivers_nothing() {
    let fetcher = addon_fetcher();
    let clock = clock();
    let mut host = host_over(
        Arc::new(InMemoryStore::new()),
        fetcher.clone(),
        clock.clone(),
        false,
    );
    let asker = Arc::new(FixtureRevisions::new());

    let cached = opened(&mut host, open("com.linvo.cinemeta", "movie", "tt0133093"));
    let asked = fetcher.asked().len();
    clock.tick(30 * DAY + 1);
    fetcher.update(CINEMETA_MOVIE, Err(FetchError::Status { status: 429 }));

    let stale = opened_asking(
        &mut host,
        open("com.linvo.cinemeta", "movie", "tt0133093"),
        &asker,
    );
    assert_eq!(stale, cached);

    assert_eq!(host.drain().ran, 1);
    assert_eq!(
        fetcher.asked().len(),
        asked + 1,
        "the refresh was attempted"
    );
    assert!(
        asker.revised().is_empty(),
        "a failed refresh changes nothing a client sees"
    );

    let kept = opened(&mut host, open("com.linvo.cinemeta", "movie", "tt0133093"));
    assert_eq!(kept, cached, "the cached copy is what opens");
}

// --- A look hint reads a Title ahead, with no answer at all -------------------

#[test]
fn a_look_hint_reads_an_uncached_title_ahead_and_the_next_open_fetches_nothing() {
    let fetcher = addon_fetcher();
    let mut host = host_over(
        Arc::new(InMemoryStore::new()),
        fetcher.clone(),
        clock(),
        false,
    );
    let before = host.snapshot().revision;
    let asked_before = fetcher.asked().len();

    let hinted = host
        .dispatch(look_hint(Some("com.linvo.cinemeta"), "movie", "tt0133093"))
        .expect("a look hint is taken");
    assert!(hinted.answer.is_none(), "a hint answers nothing");
    assert!(hinted.snapshots.is_empty(), "a hint publishes no Snapshot");
    assert_eq!(host.snapshot().revision, before, "a hint moves no revision");
    assert_eq!(
        fetcher.asked().len(),
        asked_before,
        "the hint queued the read rather than making it"
    );

    assert_eq!(host.drain().ran, 1, "the read-ahead is one job");
    let asked = fetcher.asked().len();
    assert!(asked > 0, "draining read the Title");

    let opened = opened(&mut host, open("com.linvo.cinemeta", "movie", "tt0133093"));
    assert_eq!(opened.name, "The Matrix");
    assert_eq!(
        fetcher.asked().len(),
        asked,
        "the next open is answered from the read-ahead: {:?}",
        fetcher.asked()
    );
}

#[test]
fn a_look_hint_for_a_discovered_title_reads_it_ahead_too() {
    let fetcher = Arc::new(
        FixtureFetcher::new()
            .serving(CINEMETA, CINEMETA_MANIFEST)
            .serving(TMDB_TV_200001, TMDB_TV_DETAILS_MAKING),
    );
    let mut host = host_over(
        Arc::new(InMemoryStore::new()),
        fetcher.clone(),
        clock(),
        true,
    );

    host.dispatch(look_hint(None, "series", "tmdb:200001"))
        .expect("a look hint is taken");
    let drained = host.drain();
    assert_eq!(drained.ran, 1);
    assert!(
        drained.snapshot.is_none(),
        "a Title no Continue watching card is drawn from moves nothing a client sees"
    );
    let asked = fetcher.asked().len();

    let opened = opened(&mut host, open_discovered(200001, "series"));
    assert_eq!(opened.name, "Still Making");
    assert_eq!(
        fetcher.asked().len(),
        asked,
        "the next open is answered from the read-ahead: {:?}",
        fetcher.asked()
    );
}

#[test]
fn repeated_look_hints_for_one_title_queue_one_job() {
    let fetcher = addon_fetcher();
    let mut host = host_over(
        Arc::new(InMemoryStore::new()),
        fetcher.clone(),
        clock(),
        false,
    );

    for _ in 0..2 {
        host.dispatch(look_hint(Some("com.linvo.cinemeta"), "movie", "tt0133093"))
            .expect("a look hint is taken");
    }

    assert_eq!(host.drain().ran, 1, "one Title is one read-ahead");
    assert_eq!(
        fetcher
            .asked()
            .iter()
            .filter(|url| *url == CINEMETA_MOVIE)
            .count(),
        1,
        "the Title was read once: {:?}",
        fetcher.asked()
    );
}

#[test]
fn a_look_hint_for_a_fresh_title_queues_nothing() {
    let fetcher = addon_fetcher();
    let mut host = host_over(
        Arc::new(InMemoryStore::new()),
        fetcher.clone(),
        clock(),
        false,
    );
    opened(&mut host, open("com.linvo.cinemeta", "movie", "tt0133093"));
    let asked = fetcher.asked().len();

    host.dispatch(look_hint(Some("com.linvo.cinemeta"), "movie", "tt0133093"))
        .expect("a look hint is taken");

    assert_eq!(host.drain().ran, 0, "a fresh Title is not read again");
    assert_eq!(fetcher.asked().len(), asked, "and nothing was fetched");
}

#[test]
fn a_look_hint_for_a_stale_title_refreshes_it_without_asking_anyone() {
    let fetcher = addon_fetcher();
    let clock = clock();
    let mut host = host_over(
        Arc::new(InMemoryStore::new()),
        fetcher.clone(),
        clock.clone(),
        false,
    );

    let cached = opened(&mut host, open("com.linvo.cinemeta", "movie", "tt0133093"));
    clock.tick(30 * DAY + 1);
    fetcher.update(CINEMETA_MOVIE, Ok(MOVIE_CHANGED.to_owned()));

    host.dispatch(look_hint(Some("com.linvo.cinemeta"), "movie", "tt0133093"))
        .expect("a look hint is taken");
    assert_eq!(host.drain().ran, 1);

    let refreshed = opened(&mut host, open("com.linvo.cinemeta", "movie", "tt0133093"));
    assert_eq!(refreshed.name, "The Matrix Resurrections");
    assert_ne!(refreshed, cached, "the read-ahead replaced the stale copy");
}
