//! Read ahead at startup, and caught-up series coming back (#277, ADR-0038 §3
//! and §5).
//!
//! The Host is driven the way the app shell drives it: a Host over a store that
//! survives a restart, a queue of work it owns, and a drain that runs it. Nothing
//! below names the cache or its table; a Title is proved read ahead by the
//! fixture fetcher seeing one request and the next open asking nothing.

use std::sync::Arc;

use host_core::{
    Addon, AddonId, AddonProvider, CachedTitle, FixtureClock, FixtureFetcher, FixturePlayer,
    FixtureStremio, Host, InMemorySecretStore, InMemoryStore, Manifest, ManifestUrl, NextEpisode,
    Provider, SecretBackend, SeriesStatus, Store, Title, TitleCard, TitleKey, TitleSource,
    TitleStub, Video, VideoRef, WatchProgress,
};
use serde_json::{json, Value};

const CINEMETA: &str = "https://v3-cinemeta.strem.io/manifest.json";
const CINEMETA_SERIES: &str = "https://v3-cinemeta.strem.io/meta/series/tt0903747.json";

const TMDB_KEY: &str = "0123456789abcdef0123456789abcdef";
/// A caught-up series' record read with one season appended: the announced one,
/// or the newest the cached list knows (#277).
const TMDB_TV_300001_SEASON_2: &str = concat!(
    "https://api.themoviedb.org/3/tv/300001?append_to_response=season/2",
    "&api_key=0123456789abcdef0123456789abcdef",
);
/// The same record read whole, as an open reads it.
const TMDB_TV_300001: &str = concat!(
    "https://api.themoviedb.org/3/tv/300001?append_to_response=",
    "season/0,season/1,season/2,season/3,season/4,season/5,season/6,season/7,",
    "season/8,season/9,season/10,season/11,season/12,season/13,season/14,season/15,",
    "season/16,season/17,season/18,season/19",
    "&api_key=0123456789abcdef0123456789abcdef",
);

const CINEMETA_MANIFEST: &str = include_str!("fixtures/cinemeta-manifest.json");
const SERIES_BODY: &str = include_str!("fixtures/cinemeta-meta-series.json");

/// The season the announced branch reads: one episode, announced by the record.
const ANNOUNCED_SEASON: &str = r#"{
  "id": 300001,
  "name": "Weekly",
  "status": "Returning Series",
  "seasons": [{ "season_number": 0 }, { "season_number": 1 }, { "season_number": 2 }],
  "next_episode_to_air": {
    "season_number": 2,
    "episode_number": 1,
    "name": "The Return",
    "air_date": "2026-11-01"
  },
  "season/2": {
    "season_number": 2,
    "episodes": [
      { "episode_number": 1, "name": "The Return", "air_date": "2026-11-01" }
    ]
  }
}"#;

/// The season the weekly branch reads: nothing announced, one more episode listed.
const RUNNING_SEASON: &str = r#"{
  "id": 300001,
  "name": "Weekly",
  "status": "Returning Series",
  "seasons": [{ "season_number": 0 }, { "season_number": 1 }, { "season_number": 2 }],
  "next_episode_to_air": null,
  "season/2": {
    "season_number": 2,
    "episodes": [
      { "episode_number": 1, "name": "One", "air_date": "2026-10-25" },
      { "episode_number": 2, "name": "Two", "air_date": "2026-11-01" }
    ]
  }
}"#;

/// The record read whole when an ended series is opened past its month.
const WHOLE_SERIES: &str = r#"{
  "id": 300001,
  "name": "Weekly",
  "status": "Ended",
  "seasons": [{ "season_number": 0 }, { "season_number": 1 }, { "season_number": 2 }],
  "season/0": { "season_number": 0, "episodes": [] },
  "season/1": {
    "season_number": 1,
    "episodes": [
      { "episode_number": 1, "name": "One", "air_date": "2026-10-18" },
      { "episode_number": 2, "name": "Two", "air_date": "2026-10-25" }
    ]
  },
  "season/2": {
    "season_number": 2,
    "episodes": [
      { "episode_number": 1, "name": "Last", "air_date": "2026-11-01" }
    ]
  }
}"#;

const DAY: i64 = 24 * 60 * 60 * 1000;
const WEEK: i64 = 7 * DAY;

/// An Action as a client sends it: the versioned envelope, as JSON text.
fn action(body: &Value) -> host_core::Action {
    let envelope = format!(r#"{{"version":1,"action":{body}}}"#);
    host_core::Action::parse(&envelope)
        .unwrap_or_else(|error| panic!("{envelope} should parse: {error}"))
}

fn open(addon: &str, r#type: &str, id: &str) -> host_core::Action {
    action(&json!({
        "type": "open_title",
        "addon": addon,
        "title": { "type": r#type, "id": id },
    }))
}

fn opened(host: &mut Host, action: host_core::Action) -> Title {
    let response = host
        .dispatch(action)
        .unwrap_or_else(|error| panic!("opening a Title should work: {error}"));
    response
        .title()
        .unwrap_or_else(|| panic!("opening a Title should answer with one: {response:?}"))
        .clone()
}

fn clock() -> Arc<FixtureClock> {
    Arc::new(FixtureClock::new().at(0))
}

fn secrets() -> Arc<InMemorySecretStore> {
    Arc::new(InMemorySecretStore::backed_by(SecretBackend::Keyring))
}

fn cinemeta() -> Addon {
    Addon::new(
        ManifestUrl::parse(CINEMETA).expect("the fixture URL is a URL"),
        Manifest::parse(CINEMETA_MANIFEST).expect("the fixture is a manifest"),
    )
}

fn host_over(
    store: Arc<InMemoryStore>,
    fetcher: Arc<FixtureFetcher>,
    clock: Arc<FixtureClock>,
) -> Host {
    Host::new(
        store as Arc<dyn Store>,
        fetcher.clone(),
        secrets(),
        Arc::new(AddonProvider::new(fetcher.clone())) as Arc<dyn Provider>,
        Arc::new(FixturePlayer::new()),
        clock,
    )
    .expect("a Host over a store starts")
}

fn set_tmdb_key(host: &mut Host) {
    host.dispatch(action(&json!({ "type": "set_tmdb_key", "key": TMDB_KEY })))
        .expect("entering a TMDB key should work");
}

fn sign_in(host: &mut Host) {
    host.dispatch(action(&json!({
        "type": "sign_in_stremio",
        "email": "me@example.org",
        "password": "hunter2"
    })))
    .expect("signing in");
}

fn asked_for(fetcher: &FixtureFetcher, url: &str) -> usize {
    fetcher.asked().iter().filter(|asked| *asked == url).count()
}

fn episode(id: u32, season: u32, number: u32) -> Video {
    Video {
        id: host_core::video_spelling(host_core::TmdbId(id), Some((season, number))),
        name: Some(format!("S{season}E{number}")),
        season: Some(season),
        episode: Some(number),
        thumbnail: None,
        air_date: None,
    }
}

fn discovered_series(
    id: u32,
    videos: Vec<Video>,
    status: SeriesStatus,
    next_episode: Option<NextEpisode>,
    read_at: i64,
) -> CachedTitle {
    CachedTitle {
        title: Title {
            addon: None,
            id: host_core::video_spelling(host_core::TmdbId(id), None),
            key: TitleKey::Tmdb { id },
            r#type: "series".to_owned(),
            name: format!("Series {id}"),
            poster: None,
            background: None,
            logo: None,
            description: None,
            release_info: None,
            runtime: None,
            imdb_rating: None,
            genres: Vec::new(),
            videos,
        },
        read_at,
        source: TitleSource::Tmdb,
        status: Some(status),
        next_episode,
    }
}

fn addon_episode(id: &str, season: u32, number: u32) -> Video {
    Video {
        id: format!("{id}:{season}:{number}"),
        name: Some(format!("S{season}E{number}")),
        season: Some(season),
        episode: Some(number),
        thumbnail: None,
        air_date: None,
    }
}

/// A copy of a series read through its Addon and nothing else: an Unmapped
/// Title, keyed by the Addon's pair (CONTEXT.md, *Unmapped Title*).
fn addon_series(videos: Vec<Video>) -> CachedTitle {
    let addon = AddonId::parse("com.linvo.cinemeta").expect("an Addon id");
    CachedTitle {
        title: Title {
            addon: Some(addon.clone()),
            id: "tt0903747".to_owned(),
            key: TitleKey::Addon {
                addon,
                id: "tt0903747".to_owned(),
            },
            r#type: "series".to_owned(),
            name: "Breaking Bad".to_owned(),
            poster: None,
            background: None,
            logo: None,
            description: None,
            release_info: None,
            runtime: None,
            imdb_rating: None,
            genres: Vec::new(),
            videos,
        },
        read_at: 0,
        source: TitleSource::Addon,
        status: None,
        next_episode: None,
    }
}

fn open_discovered(id: u32) -> host_core::Action {
    action(&json!({
        "type": "open_discovered_title",
        "key": { "kind": "tmdb", "id": id },
        "kind": "series",
    }))
}

fn finished_episode(title_id: &str, video_id: &str, at: i64) -> WatchProgress {
    WatchProgress {
        video: VideoRef::parse("series", video_id).expect("a Video"),
        title: TitleStub::parse(&TitleCard {
            addon: None,
            id: title_id.to_owned(),
            r#type: "series".to_owned(),
            name: "Series".to_owned(),
            poster: None,
            background: None,
        })
        .expect("a Title"),
        position: Some(100.0),
        duration: Some(100.0),
        watched: true,
        updated_at: at,
    }
}

fn library_item(id: &str, r#type: &str) -> Value {
    json!({
        "_id": id,
        "name": "One",
        "type": r#type,
        "poster": null,
        "posterShape": "poster",
        "removed": false,
        "temp": false,
        "_mtime": "2026-01-01T00:00:00.000Z",
        "state": { "timeOffset": 0 }
    })
}

// --- A started Host reads ahead what the row and the Library hold -------------

#[test]
fn a_started_host_reads_ahead_a_finished_episode_and_publishes_the_up_next_card() {
    // Story 18 (#274 deferred it): the card is the finished episode, marked
    // Watched, until the Title behind it is read. The read-ahead is that read,
    // and the drain must publish the Snapshot that moves the card on.
    let store = Arc::new(
        InMemoryStore::new()
            .holding_addons(vec![cinemeta()])
            .holding_watch(vec![finished_episode("tt0903747", "tt0903747:1:1", 500)]),
    );
    let fetcher = Arc::new(
        FixtureFetcher::new()
            .serving(CINEMETA, CINEMETA_MANIFEST)
            .serving(CINEMETA_SERIES, SERIES_BODY),
    );
    let mut host = host_over(store, fetcher.clone(), clock());

    let before = host.snapshot().continue_watching;
    assert_eq!(before.len(), 1);
    assert!(
        !before[0].up_next,
        "nothing is cached yet, so the finished episode is the card"
    );

    let drained = host.drain();
    assert_eq!(drained.ran, 1, "one read-ahead for the one watched Title");
    assert_eq!(
        asked_for(&fetcher, CINEMETA_SERIES),
        1,
        "the Addon's meta was read once: {:?}",
        fetcher.asked()
    );
    let snapshot = drained
        .snapshot
        .expect("a cache write that lists the next episode publishes a Snapshot");
    assert_eq!(
        snapshot.continue_watching.len(),
        1,
        "the card comes back as Up next"
    );
    assert!(snapshot.continue_watching[0].up_next);
    assert_eq!(snapshot.continue_watching[0].video.id, "tt0903747:1:2");

    // And the read-ahead is what the next open finds: nothing is fetched again.
    let opened = opened(&mut host, open("com.linvo.cinemeta", "series", "tt0903747"));
    assert_eq!(opened.name, "Breaking Bad");
    assert_eq!(
        asked_for(&fetcher, CINEMETA_SERIES),
        1,
        "the read-ahead is the cache hit: {:?}",
        fetcher.asked()
    );
}

#[test]
fn a_started_host_reads_ahead_a_library_title() {
    // The Library is read at startup, and its Titles are the other half of what
    // the owner is likely to open (ADR-0038 §3, #277).
    let store = Arc::new(InMemoryStore::new().holding_addons(vec![cinemeta()]));
    let fetcher = Arc::new(
        FixtureFetcher::new()
            .serving(CINEMETA, CINEMETA_MANIFEST)
            .serving(CINEMETA_SERIES, SERIES_BODY),
    );
    let stremio = Arc::new(
        FixtureStremio::new()
            .with_account("me@example.org", "hunter2", "AUTHKEY")
            .holding(vec![library_item("tt0903747", "series")]),
    );
    let mut host = host_over(store, fetcher.clone(), clock()).with_stremio(stremio);
    sign_in(&mut host);

    let drained = host.drain();
    assert_eq!(drained.ran, 1, "one read-ahead for the one Library Title");
    assert_eq!(
        asked_for(&fetcher, CINEMETA_SERIES),
        1,
        "the Library Title's meta was read once: {:?}",
        fetcher.asked()
    );
    opened(&mut host, open("com.linvo.cinemeta", "series", "tt0903747"));
    assert_eq!(
        asked_for(&fetcher, CINEMETA_SERIES),
        1,
        "and the open is the cache hit: {:?}",
        fetcher.asked()
    );
}

// --- A caught-up series is watched by its TMDB record ------------------------

/// The store a caught-up announced series starts from: one copy at the moment
/// it was read, and the finished episode that left the row.
fn caught_up_store(
    next_episode: Option<NextEpisode>,
    status: SeriesStatus,
    read_at: i64,
) -> Arc<InMemoryStore> {
    let cached = discovered_series(
        300001,
        vec![episode(300001, 1, 1), episode(300001, 1, 2)],
        status,
        next_episode,
        read_at,
    );
    Arc::new(
        InMemoryStore::new()
            .holding_addons(vec![cinemeta()])
            .holding_titles(vec![cached])
            .holding_watch(vec![finished_episode(
                "tmdb:300001",
                "tmdb:300001:1:2",
                500,
            )]),
    )
}

#[test]
fn a_caught_up_series_with_an_announced_episode_returns_as_up_next_when_drained() {
    // The card left the row because nothing was listed after S1E2. TMDB says
    // S2E1 is next, so the record is read with that season appended, and once
    // the episode is listed the card is back — aired or not (ADR-0038 §5).
    let store = caught_up_store(
        Some(NextEpisode {
            season: 2,
            episode: 1,
        }),
        SeriesStatus::Running,
        0,
    );
    let fetcher = Arc::new(
        FixtureFetcher::new()
            .serving(CINEMETA, CINEMETA_MANIFEST)
            .serving(TMDB_TV_300001_SEASON_2, ANNOUNCED_SEASON),
    );
    let clock = clock();
    let mut host = host_over(store, fetcher.clone(), clock.clone());
    set_tmdb_key(&mut host);

    assert!(
        host.snapshot().continue_watching.is_empty(),
        "a caught-up series is not on the row while nothing follows it"
    );

    clock.tick(DAY);
    let drained = host.drain();
    assert_eq!(drained.ran, 1, "the announced record was re-read");
    assert_eq!(
        asked_for(&fetcher, TMDB_TV_300001_SEASON_2),
        1,
        "one request, one season appended: {:?}",
        fetcher.asked()
    );
    let snapshot = drained
        .snapshot
        .expect("the card coming back is what a Snapshot is for");
    assert_eq!(snapshot.continue_watching.len(), 1);
    assert!(snapshot.continue_watching[0].up_next);
    assert_eq!(
        snapshot.continue_watching[0].video.id, "tmdb:300001:2:1",
        "the announced episode is the Up next"
    );
}

#[test]
fn a_caught_up_running_series_is_checked_after_a_week_and_not_before() {
    // Nothing announced, and TMDB still says it is returning: the record is
    // read weekly, because a season break is months long (ADR-0038 §5).
    let store = Arc::new(
        InMemoryStore::new()
            .holding_addons(vec![cinemeta()])
            .holding_titles(vec![discovered_series(
                300001,
                vec![
                    episode(300001, 1, 1),
                    episode(300001, 1, 2),
                    episode(300001, 2, 1),
                ],
                SeriesStatus::Running,
                None,
                0,
            )])
            .holding_watch(vec![finished_episode(
                "tmdb:300001",
                "tmdb:300001:2:1",
                500,
            )]),
    );
    let fetcher = Arc::new(
        FixtureFetcher::new()
            .serving(CINEMETA, CINEMETA_MANIFEST)
            .serving(TMDB_TV_300001_SEASON_2, RUNNING_SEASON),
    );
    let clock = clock();
    let mut host = host_over(store, fetcher.clone(), clock.clone());
    set_tmdb_key(&mut host);

    clock.tick(WEEK - 1);
    assert_eq!(
        host.drain().ran,
        0,
        "not before a week on the fixture clock"
    );
    assert_eq!(asked_for(&fetcher, TMDB_TV_300001_SEASON_2), 0);

    clock.tick(DAY);
    let drained = host.drain();
    assert_eq!(drained.ran, 1, "after a week the record is re-read");
    assert_eq!(
        asked_for(&fetcher, TMDB_TV_300001_SEASON_2),
        1,
        "the newest season was appended: {:?}",
        fetcher.asked()
    );
    let snapshot = drained.snapshot.expect("the new episode moves the card");
    assert_eq!(snapshot.continue_watching[0].video.id, "tmdb:300001:2:2");
    assert!(snapshot.continue_watching[0].up_next);
}

#[test]
fn an_ended_series_is_never_read_ahead_and_opening_it_still_refreshes_it() {
    let store = Arc::new(
        InMemoryStore::new()
            .holding_addons(vec![cinemeta()])
            .holding_titles(vec![discovered_series(
                300001,
                vec![episode(300001, 1, 1), episode(300001, 1, 2)],
                SeriesStatus::Ended,
                None,
                0,
            )])
            .holding_watch(vec![finished_episode(
                "tmdb:300001",
                "tmdb:300001:1:2",
                500,
            )]),
    );
    let fetcher = Arc::new(
        FixtureFetcher::new()
            .serving(CINEMETA, CINEMETA_MANIFEST)
            .serving(TMDB_TV_300001, WHOLE_SERIES),
    );
    let clock = clock();
    let mut host = host_over(store, fetcher.clone(), clock.clone());
    set_tmdb_key(&mut host);

    clock.tick(100 * DAY);
    assert_eq!(
        host.drain().ran,
        0,
        "an Ended series is not checked by the queue, however stale"
    );
    assert_eq!(asked_for(&fetcher, TMDB_TV_300001), 0);

    // Opening it is the owner looking, and that still refreshes a stale copy.
    let cached = opened(&mut host, open_discovered(300001));
    assert_eq!(cached.name, "Series 300001", "the stale copy answers first");
    assert_eq!(host.drain().ran, 1, "opening queued the refresh");
    assert_eq!(asked_for(&fetcher, TMDB_TV_300001), 1);
}

#[test]
fn an_unmapped_title_is_read_ahead_from_its_addon_weekly() {
    let store = Arc::new(
        InMemoryStore::new()
            .holding_addons(vec![cinemeta()])
            .holding_titles(vec![addon_series(vec![
                addon_episode("tt0903747", 1, 1),
                addon_episode("tt0903747", 1, 2),
            ])])
            .holding_watch(vec![finished_episode("tt0903747", "tt0903747:1:2", 500)]),
    );
    let fetcher = Arc::new(
        FixtureFetcher::new()
            .serving(CINEMETA, CINEMETA_MANIFEST)
            .serving(CINEMETA_SERIES, SERIES_BODY),
    );
    let clock = clock();
    let mut host = host_over(store, fetcher.clone(), clock.clone());

    clock.tick(WEEK - 1);
    assert_eq!(host.drain().ran, 0, "not before a week");

    clock.tick(DAY);
    let drained = host.drain();
    assert_eq!(drained.ran, 1, "an Unmapped Title is read weekly");
    assert_eq!(
        asked_for(&fetcher, CINEMETA_SERIES),
        1,
        "its Addon's meta is the read: {:?}",
        fetcher.asked()
    );
    let snapshot = drained
        .snapshot
        .expect("the newly listed episode moves the card");
    assert_eq!(snapshot.continue_watching[0].video.id, "tt0903747:1:3");
    assert!(snapshot.continue_watching[0].up_next);
}

#[test]
fn a_read_ahead_reads_one_season_for_each_caught_up_series_and_no_more() {
    // The bound the spec asks for is per Title: a caught-up check is its record
    // with one season appended, however many seasons the series has (ADR-0038
    // §4, §5). Twelve of them are still twelve requests, drained by the same
    // bounded fan-out every question uses (ADR-0023).
    const TITLES: u32 = 12;
    let store = InMemoryStore::new().holding_addons(vec![cinemeta()]);
    let mut fetcher = FixtureFetcher::new().serving(CINEMETA, CINEMETA_MANIFEST);
    let mut titles = Vec::new();
    let mut watch = Vec::new();
    for step in 0..TITLES {
        let id = 310_000 + step;
        titles.push(discovered_series(
            id,
            vec![episode(id, 1, 1), episode(id, 1, 2)],
            SeriesStatus::Running,
            Some(NextEpisode {
                season: 2,
                episode: 1,
            }),
            0,
        ));
        watch.push(finished_episode(
            &format!("tmdb:{id}"),
            &format!("tmdb:{id}:1:2"),
            500 + i64::from(step),
        ));
        let url = format!(
            "https://api.themoviedb.org/3/tv/{id}?append_to_response=season/2&api_key={TMDB_KEY}"
        );
        fetcher = fetcher.serving(&url, ANNOUNCED_SEASON);
    }
    let store = Arc::new(store.holding_titles(titles).holding_watch(watch));
    let fetcher = Arc::new(fetcher);
    let clock = clock();
    let mut host = host_over(store, fetcher.clone(), clock.clone());
    set_tmdb_key(&mut host);

    clock.tick(DAY);
    let drained = host.drain();

    assert_eq!(drained.ran, TITLES as usize, "one job per caught-up series");
    assert_eq!(
        fetcher.asked().len(),
        TITLES as usize,
        "one season appended per series, and nothing else: {:?}",
        fetcher.asked()
    );
}

#[test]
fn a_read_ahead_that_meets_429_keeps_the_copy_and_publishes_nothing() {
    let cached = discovered_series(
        300001,
        vec![
            episode(300001, 1, 1),
            episode(300001, 1, 2),
            episode(300001, 2, 1),
        ],
        SeriesStatus::Running,
        None,
        0,
    );
    let store = Arc::new(
        InMemoryStore::new()
            .holding_addons(vec![cinemeta()])
            .holding_titles(vec![cached.clone()])
            .holding_watch(vec![finished_episode(
                "tmdb:300001",
                "tmdb:300001:2:1",
                500,
            )]),
    );
    let fetcher = Arc::new(
        FixtureFetcher::new()
            .serving(CINEMETA, CINEMETA_MANIFEST)
            .failing(
                TMDB_TV_300001_SEASON_2,
                host_core::FetchError::Status { status: 429 },
            ),
    );
    let clock = clock();
    let mut host = host_over(store.clone(), fetcher.clone(), clock.clone());
    set_tmdb_key(&mut host);

    clock.tick(WEEK);
    let drained = host.drain();
    assert_eq!(drained.ran, 1, "the check was attempted");
    assert!(
        drained.snapshot.is_none(),
        "a failed read changes nothing a client sees"
    );
    assert_eq!(
        store.persisted_titles()[0],
        cached,
        "the copy is kept, not blanked"
    );
}
