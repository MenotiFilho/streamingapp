//! A torrent Stream played the way a client plays any Stream, driven through
//! the Action surface and the fakes at the Host's seams: `FixtureTorrentEngine`
//! for the engine, `FixturePlayer` for mpv, `FixturePreviewer` for the Seek
//! preview, `FixtureClock` for time (ADR-0042 §2, §6). No swarm is ever joined.
//!
//! What is decided here is when the Host asks the engine to `serve` a torrent
//! (before the Player is told to open, on every path that opens a Stream, and
//! never to list one), when it lets a torrent go, and that no loopback URL is
//! ever published.

use std::sync::Arc;

use host_core::{
    Action, ActionError, Chapter, ChapterStep, FailureKind, FixtureClock, FixtureFetcher,
    FixturePlayer, FixturePreviewer, FixtureProvider, FixtureTorrentEngine, Host,
    InMemorySecretStore, InMemoryStore, InfoHash, Observation, Playback, PlaybackError,
    PlaybackState, Previewer, SecretBackend, ServeHints, ServeRequest, Store, Stream, Telling,
    TorrentEngine, TorrentReport, Track, TrackId, TrackKind, ACTION_VERSION,
};

const SERIES: &str = "https://series.example.org/manifest.json";
const SERIES_ID: &str = "org.example.series";
const META_URL: &str = "https://series.example.org/meta/series/tt0903747.json";
const SERIES_META: &str = include_str!("fixtures/cinemeta-meta-series.json");

const HASH: &str = "61065ea115b7cc3e8db9fb5ab1f6f327f08bd1c9";
const OTHER_HASH: &str = "c12fe1c06bba254a9dc9f519b335aa7c1367a88a";
const DIRECT: &str = "https://stream.example.org/v/tt0903747-1-1.mkv";

/// 2026-11-17 00:00:00 UTC: after every air date the fixture lists.
const NOW: i64 = 1_794_873_600_000;

/// The loopback URL a fixture engine answers with, whatever it is: the tests
/// look for this prefix, never for a particular token.
const LOOPBACK: &str = "http://127.0.0.1:9/fixture-token/";

fn action(body: &serde_json::Value) -> Action {
    let envelope = format!(r#"{{"version":{ACTION_VERSION},"action":{body}}}"#);
    Action::parse(&envelope).unwrap_or_else(|error| panic!("{envelope} should parse: {error}"))
}

fn direct(name: &str, url: &str) -> Stream {
    Stream {
        name: Some(name.to_owned()),
        description: None,
        playback: Playback::Direct {
            url: url.to_owned(),
        },
        warnings: Vec::new(),
        filename: None,
        binge_group: None,
    }
}

fn torrent(name: &str, info_hash: &str, file_idx: Option<u32>, filename: Option<&str>) -> Stream {
    Stream {
        playback: Playback::Torrent {
            info_hash: InfoHash::parse(info_hash).expect("a valid infoHash"),
            file_idx,
            sources: vec!["tracker:udp://tracker.example.org:1337".to_owned()],
        },
        filename: filename.map(str::to_owned),
        ..direct(name, DIRECT)
    }
}

struct Fixture {
    host: Host,
    player: Arc<FixturePlayer>,
    previewer: Arc<FixturePreviewer>,
    engine: Arc<FixtureTorrentEngine>,
    clock: Arc<FixtureClock>,
    store: Arc<InMemoryStore>,
}

fn fixture_with(engine: FixtureTorrentEngine, candidates: Vec<Stream>) -> Fixture {
    let player = Arc::new(FixturePlayer::new());
    let previewer = Arc::new(FixturePreviewer::new());
    let engine = Arc::new(engine);
    let clock = Arc::new(FixtureClock::new().at(NOW));
    let store = Arc::new(InMemoryStore::new());
    let fetcher = FixtureFetcher::new()
        .serving(
            SERIES,
            format!(
                r#"{{"id":"{SERIES_ID}","name":"{SERIES_ID}","version":"1.0.0",
                     "resources":["meta","stream"],"types":["movie","series"],"catalogs":[]}}"#
            ),
        )
        .serving(META_URL, SERIES_META);
    let mut host = Host::new(
        store.clone() as Arc<dyn Store>,
        Arc::new(fetcher),
        Arc::new(InMemorySecretStore::backed_by(SecretBackend::Keyring)),
        Arc::new(FixtureProvider::new().offering(SERIES_ID, candidates)),
        player.clone(),
        clock.clone(),
    )
    .expect("a Host over a store starts")
    .with_previewer(previewer.clone() as Arc<dyn Previewer>)
    .with_torrent_engine(engine.clone());
    host.dispatch(action(
        &serde_json::json!({ "type": "add_addon", "url": SERIES }),
    ))
    .expect("configuring the Addon should work");

    Fixture {
        host,
        player,
        previewer,
        engine,
        clock,
        store,
    }
}

fn fixture() -> Fixture {
    fixture_with(FixtureTorrentEngine::new(), vec![torrent_of(HASH)])
}

/// The Addon's one torrent for every Video of the series, a season pack that
/// `fileIdx` points into.
fn torrent_of(info_hash: &str) -> Stream {
    torrent("Torrentio\n1080p", info_hash, Some(3), None)
}

fn stream_json(stream: &Stream) -> serde_json::Value {
    serde_json::to_value(stream).expect("a Stream is JSON")
}

fn play_json(video: &str, stream: &Stream) -> serde_json::Value {
    serde_json::json!({
        "type": "play_stream",
        "video": { "type": "series", "id": video },
        "addon": SERIES_ID,
        "title": {
            "addon": SERIES_ID,
            "id": "tt0903747",
            "type": "series",
            "name": "Breaking Bad",
            "poster": null,
        },
        "stream": stream_json(stream),
    })
}

fn play(
    fixture: &mut Fixture,
    video: &str,
    stream: &Stream,
) -> Result<host_core::Response, ActionError> {
    fixture.host.dispatch(action(&play_json(video, stream)))
}

fn dispatch(fixture: &mut Fixture, body: serde_json::Value) -> host_core::Response {
    fixture
        .host
        .dispatch(action(&body))
        .unwrap_or_else(|error| panic!("{body} should work: {error}"))
}

fn hash(raw: &str) -> InfoHash {
    InfoHash::parse(raw).expect("a valid infoHash")
}

fn is_playing(fixture: &Fixture, position: f64) {
    fixture
        .player
        .now_reporting(Observation::playing(position, 2820.0));
}

fn reach_the_end(fixture: &mut Fixture) {
    fixture.player.now_reporting(Observation {
        state: PlaybackState::Ended,
        position: Some(2820.0),
        duration: Some(2820.0),
        ..Observation::idle()
    });
    fixture.host.sample();
}

fn open_series(fixture: &mut Fixture) {
    dispatch(
        fixture,
        serde_json::json!({
            "type": "open_title",
            "addon": SERIES_ID,
            "title": { "type": "series", "id": "tt0903747" },
        }),
    );
}

// ── Serving ─────────────────────────────────────────────────────────────────

#[test]
fn a_torrent_is_served_and_the_player_opens_what_the_engine_answered() {
    let mut fixture = fixture();

    let response = play(&mut fixture, "tt0903747:2:5", &torrent_of(HASH)).expect("a torrent plays");

    assert_eq!(
        fixture.engine.serves(),
        vec![ServeRequest {
            info_hash: hash(HASH),
            file_idx: Some(3),
            sources: vec!["tracker:udp://tracker.example.org:1337".to_owned()],
            hints: ServeHints {
                filename: None,
                season: Some(2),
                episode: Some(5),
            },
        }]
    );
    let opened = fixture.player.opened();
    assert_eq!(opened.len(), 1, "the Player opens one thing");
    assert!(
        opened[0].starts_with(LOOPBACK) && opened[0].contains(HASH),
        "what the Player opens is what the engine answered, not the infoHash: {opened:?}"
    );
    assert_eq!(
        response.snapshots[0].playback.state,
        PlaybackState::Opening,
        "the open is in flight, as for any Stream"
    );
}

#[test]
fn the_addons_filename_is_a_hint_and_a_film_has_no_season_or_episode() {
    let mut fixture = fixture();
    let stream = torrent("Torrentio", HASH, None, Some("The.Matrix.1999.1080p.mkv"));
    let body = serde_json::json!({
        "type": "play_stream",
        "video": { "type": "movie", "id": "tt0133093" },
        "addon": SERIES_ID,
        "title": {
            "addon": SERIES_ID, "id": "tt0133093", "type": "movie",
            "name": "The Matrix", "poster": null,
        },
        "stream": stream_json(&stream),
    });

    dispatch(&mut fixture, body);

    assert_eq!(
        fixture.engine.serves()[0].hints,
        ServeHints {
            filename: Some("The.Matrix.1999.1080p.mkv".to_owned()),
            season: None,
            episode: None,
        }
    );
    assert_eq!(fixture.engine.serves()[0].file_idx, None);
}

#[test]
fn a_direct_stream_never_asks_the_engine() {
    let mut fixture = fixture();

    play(&mut fixture, "tt0903747:1:1", &direct("1080p", DIRECT)).expect("a direct Stream plays");

    assert!(fixture.engine.serves().is_empty());
    assert_eq!(fixture.player.opened(), vec![DIRECT.to_owned()]);
}

#[test]
fn a_refused_serve_is_a_playback_error_in_the_engines_own_words_and_nothing_is_opened() {
    let mut fixture = fixture_with(
        FixtureTorrentEngine::new().refusing("The torrent engine did not answer."),
        vec![torrent_of(HASH)],
    );
    let before = fixture.host.snapshot();

    let refused = play(&mut fixture, "tt0903747:1:1", &torrent_of(HASH));

    assert_eq!(
        refused.expect_err("the serve was refused"),
        ActionError::Playback {
            detail: "The torrent engine did not answer.".to_owned()
        }
    );
    assert!(
        fixture.player.opened().is_empty(),
        "the Player is never told"
    );
    assert_eq!(fixture.host.snapshot(), before, "and nothing changed");
    assert_eq!(fixture.previewer.armings(), Vec::<String>::new());
}

#[test]
fn a_host_without_an_engine_refuses_a_torrent_with_the_builds_sentence() {
    let player = Arc::new(FixturePlayer::new());
    // A Host the shell built without an engine keeps `NoTorrentEngine`.
    let mut bare = Host::new(
        Arc::new(InMemoryStore::new()) as Arc<dyn Store>,
        Arc::new(FixtureFetcher::new()),
        Arc::new(InMemorySecretStore::backed_by(SecretBackend::Keyring)),
        Arc::new(FixtureProvider::new()),
        player.clone(),
        Arc::new(FixtureClock::new()),
    )
    .expect("a Host starts");

    let refused = bare.dispatch(action(&play_json("tt0903747:1:1", &torrent_of(HASH))));

    assert_eq!(
        refused.expect_err("refused"),
        ActionError::Playback {
            detail: "The torrent engine is not part of this build.".to_owned()
        }
    );
    assert!(player.opened().is_empty());
}

#[test]
fn a_refused_serve_leaves_the_stream_that_was_playing_alone() {
    let mut fixture = fixture();
    play(&mut fixture, "tt0903747:1:1", &torrent_of(HASH)).expect("a torrent plays");
    fixture.engine.refuse("No.");
    let before = fixture.host.snapshot();

    let refused = play(&mut fixture, "tt0903747:1:2", &torrent_of(OTHER_HASH));

    assert!(matches!(refused, Err(ActionError::Playback { .. })));
    assert_eq!(
        fixture.host.snapshot(),
        before,
        "the Stream playing plays on"
    );
    assert!(
        fixture.engine.let_gos().is_empty(),
        "and its torrent is not let go of for a Stream that never opened"
    );
}

#[test]
fn listing_streams_and_a_look_hint_never_serve_a_torrent() {
    let mut fixture = fixture();
    open_series(&mut fixture);

    dispatch(
        &mut fixture,
        serde_json::json!({
            "type": "find_streams",
            "video": { "type": "series", "id": "tt0903747:1:1" },
        }),
    );
    dispatch(
        &mut fixture,
        serde_json::json!({
            "type": "look_hint",
            "addon": SERIES_ID,
            "title": { "type": "series", "id": "tt0903747" },
        }),
    );

    assert!(fixture.engine.serves().is_empty());
}

#[test]
fn resume_takes_the_first_playable_candidate_even_a_torrent_and_serves_it_at_the_position() {
    let mut fixture = fixture_with(
        FixtureTorrentEngine::new(),
        vec![torrent_of(HASH), direct("1080p", DIRECT)],
    );
    play(&mut fixture, "tt0903747:1:1", &torrent_of(HASH)).expect("a torrent plays");
    is_playing(&fixture, 600.0);
    fixture.clock.tick(10_000);
    fixture.host.sample();
    dispatch(&mut fixture, serde_json::json!({ "type": "stop_playback" }));

    dispatch(
        &mut fixture,
        serde_json::json!({
            "type": "resume",
            "video": { "type": "series", "id": "tt0903747:1:1" },
        }),
    );

    assert_eq!(
        fixture.engine.serves().len(),
        2,
        "served again after the stop"
    );
    assert_eq!(fixture.engine.serves()[1].hints.season, Some(1));
    let (opened, start) = fixture.player.openings().pop().expect("opened");
    assert!(
        opened.starts_with(LOOPBACK),
        "the first candidate is the torrent"
    );
    assert_eq!(start, Some(600.0), "where the Watch progress left it");
}

#[test]
fn an_up_next_that_is_a_torrent_is_served_with_the_next_episodes_hints() {
    let mut fixture = fixture();
    open_series(&mut fixture);
    play(&mut fixture, "tt0903747:1:1", &torrent_of(HASH)).expect("a torrent plays");
    reach_the_end(&mut fixture);

    dispatch(
        &mut fixture,
        serde_json::json!({
            "type": "play_up_next",
            "title": { "type": "series", "id": "tt0903747" },
        }),
    );

    let serves = fixture.engine.serves();
    assert_eq!(serves.len(), 2);
    assert_eq!(
        (serves[1].hints.season, serves[1].hints.episode),
        (Some(1), Some(2))
    );
    assert_eq!(fixture.player.opened().len(), 2);
}

#[test]
fn both_episode_steps_serve_the_neighbouring_episode() {
    let mut fixture = fixture();
    open_series(&mut fixture);
    play(&mut fixture, "tt0903747:1:2", &torrent_of(HASH)).expect("a torrent plays");
    is_playing(&fixture, 10.0);
    fixture.host.sample();

    dispatch(&mut fixture, serde_json::json!({ "type": "next_episode" }));
    dispatch(
        &mut fixture,
        serde_json::json!({ "type": "previous_episode" }),
    );

    let episodes: Vec<_> = fixture
        .engine
        .serves()
        .iter()
        .map(|serve| (serve.hints.season, serve.hints.episode))
        .collect();
    assert_eq!(
        episodes,
        vec![(Some(1), Some(2)), (Some(1), Some(3)), (Some(1), Some(2))]
    );
}

#[test]
fn autoplay_serves_the_next_episode_when_its_countdown_runs_out() {
    let mut fixture = fixture();
    open_series(&mut fixture);
    play(&mut fixture, "tt0903747:1:1", &torrent_of(HASH)).expect("a torrent plays");
    reach_the_end(&mut fixture);

    fixture.clock.tick(5_000);
    fixture.host.sample().expect("the countdown ran out");

    let serves = fixture.engine.serves();
    assert_eq!(serves.len(), 2, "the next episode was served");
    assert_eq!(
        (serves[1].hints.season, serves[1].hints.episode),
        (Some(1), Some(2))
    );
    assert!(
        fixture.engine.let_gos().is_empty(),
        "the same torrent carries the next episode, so it is kept"
    );
}

#[test]
fn autoplay_whose_serve_is_refused_stays_on_the_ended_state_and_says_so() {
    let mut fixture = fixture_with(
        FixtureTorrentEngine::new().refusing("The torrent engine did not answer."),
        vec![torrent_of(HASH)],
    );
    open_series(&mut fixture);
    // The first episode is a direct Stream, so the refusing engine is only
    // asked for the next one, which Autoplay's continuity finds a torrent.
    play(&mut fixture, "tt0903747:1:1", &direct("1080p", DIRECT)).expect("a direct Stream plays");
    reach_the_end(&mut fixture);

    fixture.clock.tick(5_000);
    let published = fixture.host.sample().expect("the failure is published");

    assert_eq!(published.playback.state, PlaybackState::Ended);
    assert_eq!(fixture.player.opened(), vec![DIRECT.to_owned()]);
}

// ── Letting go ──────────────────────────────────────────────────────────────

#[test]
fn a_stop_lets_the_torrent_go_when_the_previewer_is_disarmed() {
    let mut fixture = fixture();
    play(&mut fixture, "tt0903747:1:1", &torrent_of(HASH)).expect("a torrent plays");
    assert!(fixture.engine.let_gos().is_empty());

    dispatch(&mut fixture, serde_json::json!({ "type": "stop_playback" }));

    assert_eq!(fixture.engine.let_gos(), vec![hash(HASH)]);
    assert_eq!(fixture.host.snapshot().playback.state, PlaybackState::Idle);
}

#[test]
fn a_stop_of_a_direct_stream_lets_nothing_go() {
    let mut fixture = fixture();
    play(&mut fixture, "tt0903747:1:1", &direct("1080p", DIRECT)).expect("plays");

    dispatch(&mut fixture, serde_json::json!({ "type": "stop_playback" }));

    assert!(fixture.engine.let_gos().is_empty());
}

#[test]
fn a_second_stop_does_not_let_go_twice() {
    let mut fixture = fixture();
    play(&mut fixture, "tt0903747:1:1", &torrent_of(HASH)).expect("a torrent plays");
    dispatch(&mut fixture, serde_json::json!({ "type": "stop_playback" }));

    let again = fixture
        .host
        .dispatch(action(&serde_json::json!({ "type": "stop_playback" })));

    assert!(again.is_err(), "nothing is playing to stop");
    assert_eq!(fixture.engine.let_gos(), vec![hash(HASH)]);
}

#[test]
fn a_stream_of_a_different_info_hash_lets_the_first_torrent_go_once_the_new_one_opens() {
    let mut fixture = fixture();
    play(&mut fixture, "tt0903747:1:1", &torrent_of(HASH)).expect("a torrent plays");

    play(&mut fixture, "tt0903747:1:2", &torrent_of(OTHER_HASH)).expect("another plays");

    assert_eq!(fixture.engine.let_gos(), vec![hash(HASH)]);
    assert_eq!(
        fixture.engine.serves().len(),
        2,
        "the new one was served as well"
    );
}

#[test]
fn another_file_of_the_same_info_hash_keeps_the_torrent() {
    let mut fixture = fixture();
    play(&mut fixture, "tt0903747:1:1", &torrent_of(HASH)).expect("a torrent plays");

    let pack = torrent("Torrentio\n1080p", HASH, Some(4), None);
    play(&mut fixture, "tt0903747:1:2", &pack).expect("the next file of the pack plays");

    assert!(
        fixture.engine.let_gos().is_empty(),
        "a season pack is one torrent"
    );
    assert_eq!(fixture.engine.serves().len(), 2);
}

#[test]
fn a_direct_stream_replacing_a_torrent_lets_it_go() {
    let mut fixture = fixture();
    play(&mut fixture, "tt0903747:1:1", &torrent_of(HASH)).expect("a torrent plays");

    play(&mut fixture, "tt0903747:1:2", &direct("1080p", DIRECT)).expect("a direct Stream plays");

    assert_eq!(fixture.engine.let_gos(), vec![hash(HASH)]);
}

#[test]
fn a_torrent_replacing_a_direct_stream_lets_nothing_go() {
    let mut fixture = fixture();
    play(&mut fixture, "tt0903747:1:1", &direct("1080p", DIRECT)).expect("plays");

    play(&mut fixture, "tt0903747:1:2", &torrent_of(HASH)).expect("a torrent plays");

    assert!(fixture.engine.let_gos().is_empty());
}

#[test]
fn the_torrent_is_kept_across_the_end_of_its_stream() {
    let mut fixture = fixture();
    play(&mut fixture, "tt0903747:1:1", &torrent_of(HASH)).expect("a torrent plays");

    reach_the_end(&mut fixture);

    assert!(fixture.engine.let_gos().is_empty(), "Ended is not a let go");
}

#[test]
fn a_torrent_whose_open_the_player_refuses_is_let_go_unless_it_was_already_held() {
    let mut fixture = fixture();
    play(&mut fixture, "tt0903747:1:1", &torrent_of(HASH)).expect("a torrent plays");
    fixture.player.now_refusing(PlaybackError::Open {
        detail: "no mpv".to_owned(),
    });

    // The same torrent: it is held, and stays held.
    let same = play(&mut fixture, "tt0903747:1:2", &torrent_of(HASH));
    assert!(matches!(same, Err(ActionError::Playback { .. })));
    assert!(fixture.engine.let_gos().is_empty());

    // Another torrent that never opened is no one's: it goes, the held one stays.
    let other = play(&mut fixture, "tt0903747:1:2", &torrent_of(OTHER_HASH));
    assert!(matches!(other, Err(ActionError::Playback { .. })));
    assert_eq!(fixture.engine.let_gos(), vec![hash(OTHER_HASH)]);
}

// ── The Seek preview ────────────────────────────────────────────────────────

#[test]
fn the_previewer_is_never_armed_for_a_torrent_and_a_preview_is_absent() {
    let mut fixture = fixture();
    play(&mut fixture, "tt0903747:1:1", &torrent_of(HASH)).expect("a torrent plays");
    is_playing(&fixture, 10.0);
    fixture.host.sample();

    let response = dispatch(
        &mut fixture,
        serde_json::json!({ "type": "preview", "at": 42.0 }),
    );

    assert!(fixture.previewer.armings().is_empty(), "never armed");
    assert_eq!(response.preview(), Some((42.0, None)), "absent");
    assert_eq!(fixture.previewer.asks(), 0, "and no worker is asked");
}

#[test]
fn a_torrent_replacing_a_direct_stream_lets_the_previewer_go_of_the_old_url() {
    let mut fixture = fixture();
    play(&mut fixture, "tt0903747:1:1", &direct("1080p", DIRECT)).expect("plays");
    assert_eq!(fixture.previewer.armed().as_deref(), Some(DIRECT));

    play(&mut fixture, "tt0903747:1:2", &torrent_of(HASH)).expect("a torrent plays");

    assert_eq!(fixture.previewer.armed(), None);
}

#[test]
fn a_direct_stream_arms_the_previewer_as_before() {
    let mut fixture = fixture();

    play(&mut fixture, "tt0903747:1:1", &direct("1080p", DIRECT)).expect("plays");

    assert_eq!(fixture.previewer.armings(), vec![DIRECT.to_owned()]);
}

// ── What a client is told ───────────────────────────────────────────────────

#[test]
fn the_loopback_url_is_in_no_snapshot() {
    let mut fixture = fixture();

    let response = play(&mut fixture, "tt0903747:1:1", &torrent_of(HASH)).expect("a torrent plays");
    is_playing(&fixture, 10.0);
    let sampled = fixture.host.sample();

    let published = serde_json::to_string(&(response.snapshots, sampled, fixture.host.snapshot()))
        .expect("Snapshots are JSON");
    assert!(
        !published.contains("127.0.0.1") && !published.contains("fixture-token"),
        "the loopback URL and its token never travel outward: {published}"
    );
    let now_playing = fixture
        .host
        .snapshot()
        .playback
        .now_playing
        .expect("something is playing");
    assert_eq!(now_playing.name.as_deref(), Some("Torrentio\n1080p"));
}

// ── The reports ─────────────────────────────────────────────────────────────

#[test]
fn a_chosen_report_is_drained_on_the_tick_and_publishes_nothing() {
    let mut fixture = fixture();
    play(&mut fixture, "tt0903747:1:1", &torrent_of(HASH)).expect("a torrent plays");
    is_playing(&fixture, 10.0);
    fixture.host.sample();
    fixture.engine.report(TorrentReport::Chosen {
        info_hash: hash(HASH),
        file_idx: 3,
        name: "Show.S01E01.mkv".to_owned(),
    });
    let before = fixture.host.snapshot();

    let published = fixture.host.sample();

    assert_eq!(
        published, None,
        "a Chosen report is logged and goes nowhere else"
    );
    assert_eq!(fixture.host.snapshot(), before);
    assert!(
        fixture.engine.reports().is_empty(),
        "the tick took what was reported"
    );
}

// ── The idle let go ─────────────────────────────────────────────────────────

const MINUTE: i64 = 60 * 1000;

fn paused_at(fixture: &mut Fixture, position: f64) {
    dispatch(
        fixture,
        serde_json::json!({ "type": "set_paused", "paused": true }),
    );
    fixture.player.now_reporting(Observation {
        state: PlaybackState::Paused,
        position: Some(position),
        duration: Some(2820.0),
        ..Observation::idle()
    });
    fixture.host.sample();
}

fn audio_track(id: i64, language: &str, selected: bool) -> Track {
    Track {
        id: TrackId(id),
        kind: TrackKind::Audio,
        language: Some(language.to_owned()),
        title: None,
        codec: Some("aac".to_owned()),
        embedded: true,
        selected,
        default: selected,
        forced: false,
        hearing_impaired: false,
    }
}

/// A torrent whose Stream was paused at `position`, then left for `minutes`, and
/// let go by the tick that found it idle long enough.
fn released_while_paused(position: f64) -> Fixture {
    let mut fixture = fixture();
    play(&mut fixture, "tt0903747:1:1", &torrent_of(HASH)).expect("a torrent plays");
    is_playing(&fixture, position);
    fixture.host.sample();
    paused_at(&mut fixture, position);
    fixture.clock.tick(30 * MINUTE);
    fixture.host.sample();
    fixture
}

#[test]
fn a_torrent_paused_for_thirty_minutes_is_let_go_and_the_stream_stays_paused() {
    let mut fixture = fixture();
    play(&mut fixture, "tt0903747:1:1", &torrent_of(HASH)).expect("a torrent plays");
    is_playing(&fixture, 600.0);
    fixture.host.sample();
    paused_at(&mut fixture, 600.0);
    let before = fixture.host.snapshot();

    fixture.clock.tick(30 * MINUTE);
    let published = fixture.host.sample();

    assert_eq!(fixture.engine.let_gos(), vec![hash(HASH)]);
    assert_eq!(published, None, "nothing a client draws moved");
    assert_eq!(
        fixture.host.snapshot().playback,
        before.playback,
        "the Stream is still Now playing, still paused, at the same position"
    );
}

#[test]
fn a_torrent_paused_for_under_thirty_minutes_is_kept() {
    let mut fixture = fixture();
    play(&mut fixture, "tt0903747:1:1", &torrent_of(HASH)).expect("a torrent plays");
    is_playing(&fixture, 600.0);
    fixture.host.sample();
    paused_at(&mut fixture, 600.0);

    fixture.clock.tick(30 * MINUTE - 1);
    fixture.host.sample();

    assert!(fixture.engine.let_gos().is_empty());
}

#[test]
fn ten_minutes_paused_is_not_enough() {
    let mut fixture = fixture();
    play(&mut fixture, "tt0903747:1:1", &torrent_of(HASH)).expect("a torrent plays");
    is_playing(&fixture, 600.0);
    fixture.host.sample();
    paused_at(&mut fixture, 600.0);

    fixture.clock.tick(10 * MINUTE);
    fixture.host.sample();

    assert!(
        fixture.engine.let_gos().is_empty(),
        "ten minutes is Ended's"
    );
}

#[test]
fn a_torrent_ended_for_ten_minutes_is_let_go_and_the_stream_stays_ended() {
    let mut fixture = fixture();
    // No countdown to a next episode is running: the Stream is idle, not leaving.
    dispatch(
        &mut fixture,
        serde_json::json!({ "type": "set_autoplay", "autoplay": false }),
    );
    play(&mut fixture, "tt0903747:1:1", &torrent_of(HASH)).expect("a torrent plays");
    reach_the_end(&mut fixture);
    let before = fixture.host.snapshot();

    fixture.clock.tick(10 * MINUTE);
    fixture.host.sample();

    assert_eq!(fixture.engine.let_gos(), vec![hash(HASH)]);
    assert_eq!(fixture.host.snapshot().playback, before.playback);
    assert_eq!(fixture.host.snapshot().playback.state, PlaybackState::Ended);
}

#[test]
fn a_torrent_ended_for_under_ten_minutes_is_kept() {
    let mut fixture = fixture();
    play(&mut fixture, "tt0903747:1:1", &torrent_of(HASH)).expect("a torrent plays");
    reach_the_end(&mut fixture);

    fixture.clock.tick(10 * MINUTE - 1);
    fixture.host.sample();

    assert!(fixture.engine.let_gos().is_empty());
}

#[test]
fn a_torrent_that_plays_is_never_let_go_however_long_it_takes() {
    let mut fixture = fixture();
    play(&mut fixture, "tt0903747:1:1", &torrent_of(HASH)).expect("a torrent plays");
    is_playing(&fixture, 600.0);
    fixture.host.sample();

    fixture.clock.tick(300 * MINUTE);
    fixture.host.sample();

    assert!(fixture.engine.let_gos().is_empty());
}

#[test]
fn playing_again_starts_the_pause_measure_over() {
    let mut fixture = fixture();
    play(&mut fixture, "tt0903747:1:1", &torrent_of(HASH)).expect("a torrent plays");
    is_playing(&fixture, 600.0);
    fixture.host.sample();
    paused_at(&mut fixture, 600.0);
    fixture.clock.tick(29 * MINUTE);
    fixture.host.sample();
    dispatch(
        &mut fixture,
        serde_json::json!({ "type": "set_paused", "paused": false }),
    );
    is_playing(&fixture, 600.0);
    fixture.host.sample();
    paused_at(&mut fixture, 640.0);

    fixture.clock.tick(29 * MINUTE);
    fixture.host.sample();

    assert!(
        fixture.engine.let_gos().is_empty(),
        "29 minutes since the second pause"
    );
}

#[test]
fn a_direct_stream_left_idle_lets_nothing_go() {
    let mut fixture = fixture();
    play(&mut fixture, "tt0903747:1:1", &direct("1080p", DIRECT)).expect("plays");
    is_playing(&fixture, 600.0);
    fixture.host.sample();
    paused_at(&mut fixture, 600.0);

    fixture.clock.tick(300 * MINUTE);
    fixture.host.sample();

    assert!(fixture.engine.let_gos().is_empty());
    assert!(fixture.player.stopped() == 0, "nothing was stopped either");
}

#[test]
fn a_released_torrent_is_let_go_only_once_and_the_stream_is_not_read_again() {
    let mut fixture = released_while_paused(600.0);
    let before = fixture.host.snapshot();

    // The Player still holds a URL nobody serves: whatever it now says about it
    // is not about the Stream the owner left.
    fixture.player.now_reporting(Observation::idle());
    fixture.clock.tick(300 * MINUTE);
    let published = fixture.host.sample();

    assert_eq!(fixture.engine.let_gos(), vec![hash(HASH)]);
    assert_eq!(published, None);
    assert_eq!(fixture.host.snapshot().playback, before.playback);
}

#[test]
fn a_stop_after_the_let_go_lets_nothing_go_again() {
    let mut fixture = released_while_paused(600.0);

    dispatch(&mut fixture, serde_json::json!({ "type": "stop_playback" }));

    assert_eq!(fixture.engine.let_gos(), vec![hash(HASH)]);
    assert_eq!(fixture.host.snapshot().playback.state, PlaybackState::Idle);
}

#[test]
fn another_stream_replacing_a_released_one_lets_nothing_go_again_and_wakes_nothing() {
    let mut fixture = released_while_paused(600.0);

    play(&mut fixture, "tt0903747:1:2", &torrent_of(OTHER_HASH)).expect("another plays");

    assert_eq!(fixture.engine.let_gos(), vec![hash(HASH)]);
    assert_eq!(
        fixture.engine.serves().len(),
        2,
        "only the new one was served"
    );
    assert_eq!(fixture.engine.serves()[1].info_hash, hash(OTHER_HASH));
}

#[test]
fn play_on_a_released_torrent_serves_again_and_reopens_at_the_held_position() {
    let mut fixture = released_while_paused(600.0);
    assert_eq!(fixture.engine.serves().len(), 1);

    let response = dispatch(
        &mut fixture,
        serde_json::json!({ "type": "set_paused", "paused": false }),
    );

    assert_eq!(fixture.engine.serves().len(), 2, "served again");
    assert_eq!(fixture.engine.serves()[1], fixture.engine.serves()[0]);
    let openings = fixture.player.openings();
    assert_eq!(openings.len(), 2);
    assert!(openings[1].0.starts_with(LOOPBACK));
    assert_eq!(openings[1].1, Some(600.0), "at the held position");
    let playback = &response.snapshots.last().expect("a Snapshot").playback;
    assert_eq!(playback.state, PlaybackState::Opening, "opening meanwhile");
    assert_eq!(
        playback
            .now_playing
            .as_ref()
            .map(|now| now.video.id.as_str()),
        Some("tt0903747:1:1"),
        "the same Stream"
    );
}

#[test]
fn a_woken_torrent_is_held_again_and_goes_idle_again() {
    let mut fixture = released_while_paused(600.0);
    dispatch(
        &mut fixture,
        serde_json::json!({ "type": "set_paused", "paused": false }),
    );
    is_playing(&fixture, 600.0);
    fixture.host.sample();
    paused_at(&mut fixture, 700.0);

    fixture.clock.tick(30 * MINUTE);
    fixture.host.sample();

    assert_eq!(fixture.engine.let_gos(), vec![hash(HASH), hash(HASH)]);
}

#[test]
fn a_woken_torrent_is_let_go_at_a_stop() {
    let mut fixture = released_while_paused(600.0);
    dispatch(
        &mut fixture,
        serde_json::json!({ "type": "set_paused", "paused": false }),
    );
    is_playing(&fixture, 601.0);
    fixture.host.sample();

    dispatch(&mut fixture, serde_json::json!({ "type": "stop_playback" }));

    assert_eq!(fixture.engine.let_gos(), vec![hash(HASH), hash(HASH)]);
}

#[test]
fn play_on_an_ended_released_torrent_serves_again_and_starts_the_stream_over() {
    let mut fixture = fixture();
    dispatch(
        &mut fixture,
        serde_json::json!({ "type": "set_autoplay", "autoplay": false }),
    );
    play(&mut fixture, "tt0903747:1:1", &torrent_of(HASH)).expect("a torrent plays");
    reach_the_end(&mut fixture);
    fixture.clock.tick(10 * MINUTE);
    fixture.host.sample();

    dispatch(
        &mut fixture,
        serde_json::json!({ "type": "set_paused", "paused": false }),
    );

    assert_eq!(fixture.engine.serves().len(), 2);
    let (_, start) = fixture.player.openings().pop().expect("opened");
    assert_eq!(
        start, None,
        "a finished Stream has no position left to hold"
    );
    assert_eq!(
        fixture.host.snapshot().playback.state,
        PlaybackState::Opening
    );
}

#[test]
fn play_on_an_ended_torrent_that_is_still_held_is_refused_as_before() {
    let mut fixture = fixture();
    play(&mut fixture, "tt0903747:1:1", &torrent_of(HASH)).expect("a torrent plays");
    reach_the_end(&mut fixture);

    let refused = fixture.host.dispatch(action(
        &serde_json::json!({ "type": "set_paused", "paused": false }),
    ));

    assert!(matches!(refused, Err(ActionError::NothingPlaying { .. })));
    assert_eq!(fixture.engine.serves().len(), 1);
}

#[test]
fn pausing_a_released_torrent_does_not_wake_it() {
    let mut fixture = released_while_paused(600.0);

    dispatch(
        &mut fixture,
        serde_json::json!({ "type": "set_paused", "paused": true }),
    );

    assert_eq!(fixture.engine.serves().len(), 1);
    assert_eq!(fixture.player.openings().len(), 1);
}

#[test]
fn a_refused_serve_on_wake_leaves_the_stream_released_and_a_second_play_wakes_it() {
    let mut fixture = released_while_paused(600.0);
    fixture.engine.refuse("Nobody answers.");

    let refused = fixture.host.dispatch(action(
        &serde_json::json!({ "type": "set_paused", "paused": false }),
    ));

    match refused {
        Err(ActionError::Playback { detail }) => assert_eq!(detail, "Nobody answers."),
        other => panic!("a refused serve is a playback error: {other:?}"),
    }
    assert_eq!(fixture.player.openings().len(), 1, "nothing was opened");
    assert_eq!(
        fixture.host.snapshot().playback.state,
        PlaybackState::Paused,
        "the Stream is as it was"
    );
    assert_eq!(
        fixture.engine.let_gos(),
        vec![hash(HASH)],
        "nothing more to let go"
    );

    fixture.engine.allow();
    dispatch(
        &mut fixture,
        serde_json::json!({ "type": "set_paused", "paused": false }),
    );
    assert_eq!(fixture.player.openings().len(), 2);
}

#[test]
fn a_seek_on_a_released_torrent_reopens_it_at_where_the_seek_lands() {
    let mut fixture = released_while_paused(600.0);

    dispatch(
        &mut fixture,
        serde_json::json!({ "type": "seek", "target": { "kind": "to", "seconds": 1200.0 } }),
    );

    assert_eq!(fixture.engine.serves().len(), 2, "reopened first");
    let (url, start) = fixture.player.openings().pop().expect("opened");
    assert!(url.starts_with(LOOPBACK));
    assert_eq!(start, Some(1200.0));
    assert!(
        !fixture
            .player
            .tellings()
            .iter()
            .any(|telling| matches!(telling, Telling::Seek(_))),
        "the open is already there, so the Player is not told to seek"
    );
    assert_eq!(
        fixture.host.snapshot().playback.state,
        PlaybackState::Opening
    );
}

#[test]
fn a_relative_seek_on_a_released_torrent_lands_from_the_held_position() {
    let mut fixture = released_while_paused(600.0);

    dispatch(
        &mut fixture,
        serde_json::json!({ "type": "seek", "target": { "kind": "by", "seconds": -10.0 } }),
    );

    let (_, start) = fixture.player.openings().pop().expect("opened");
    assert_eq!(start, Some(590.0));
}

#[test]
fn an_audio_track_change_on_a_released_torrent_reopens_it_first_then_applies() {
    let mut fixture = fixture();
    play(&mut fixture, "tt0903747:1:1", &torrent_of(HASH)).expect("a torrent plays");
    fixture.player.now_reporting(Observation {
        tracks: Some(vec![
            audio_track(1, "eng", true),
            audio_track(2, "por", false),
        ]),
        ..Observation::playing(600.0, 2820.0)
    });
    fixture.host.sample();
    paused_at(&mut fixture, 600.0);
    fixture.clock.tick(30 * MINUTE);
    fixture.host.sample();
    fixture.player.forget();

    dispatch(
        &mut fixture,
        serde_json::json!({ "type": "set_audio_track", "track": 2 }),
    );

    assert_eq!(fixture.engine.serves().len(), 2, "reopened first");
    let (_, start) = fixture.player.openings().pop().expect("opened");
    assert_eq!(start, Some(600.0), "at the held position");
    assert!(
        fixture
            .player
            .tellings()
            .contains(&Telling::AudioTrack(TrackId(2))),
        "and the Player is told the choice once it is open"
    );
}

#[test]
fn an_unknown_track_on_a_released_torrent_is_refused_without_reopening() {
    let mut fixture = released_while_paused(600.0);

    let refused = fixture.host.dispatch(action(
        &serde_json::json!({ "type": "set_audio_track", "track": 9 }),
    ));

    assert!(matches!(refused, Err(ActionError::UnknownTrack { .. })));
    assert_eq!(fixture.engine.serves().len(), 1, "nothing was served");
}

#[test]
fn a_subtitle_track_change_on_a_released_torrent_reopens_it_first() {
    let mut fixture = released_while_paused(600.0);

    dispatch(
        &mut fixture,
        serde_json::json!({ "type": "set_subtitle_track", "track": null }),
    );

    assert_eq!(fixture.engine.serves().len(), 2);
    assert!(fixture
        .player
        .tellings()
        .contains(&Telling::SubtitleTrack(None)));
}

#[test]
fn a_seek_on_a_torrent_that_is_still_held_does_not_reopen() {
    let mut fixture = fixture();
    play(&mut fixture, "tt0903747:1:1", &torrent_of(HASH)).expect("a torrent plays");
    is_playing(&fixture, 600.0);
    fixture.host.sample();

    dispatch(
        &mut fixture,
        serde_json::json!({ "type": "seek", "target": { "kind": "to", "seconds": 1200.0 } }),
    );

    assert_eq!(fixture.engine.serves().len(), 1);
    assert_eq!(fixture.player.openings().len(), 1);
    assert!(fixture
        .player
        .tellings()
        .iter()
        .any(|telling| matches!(telling, Telling::Seek(_))));
}

fn chapters() -> Vec<Chapter> {
    [0.0, 300.0, 900.0, 1500.0]
        .into_iter()
        .enumerate()
        .map(|(index, time)| Chapter {
            index,
            title: None,
            time,
        })
        .collect()
}

/// A torrent paused in its second chapter, left for thirty minutes and let go.
fn released_in_the_second_chapter() -> Fixture {
    let mut fixture = fixture();
    play(&mut fixture, "tt0903747:1:1", &torrent_of(HASH)).expect("a torrent plays");
    fixture.player.now_reporting(Observation {
        chapters: chapters(),
        chapter: Some(1),
        ..Observation::playing(600.0, 2820.0)
    });
    fixture.host.sample();
    dispatch(
        &mut fixture,
        serde_json::json!({ "type": "set_paused", "paused": true }),
    );
    fixture.player.now_reporting(Observation {
        state: PlaybackState::Paused,
        chapters: chapters(),
        chapter: Some(1),
        ..Observation::playing(600.0, 2820.0)
    });
    fixture.host.sample();
    fixture.clock.tick(30 * MINUTE);
    fixture.host.sample();
    fixture.player.forget();
    fixture
}

fn a_chapter_action_on_a_released_torrent_reopens_at(body: serde_json::Value, start: f64) {
    let mut fixture = released_in_the_second_chapter();

    dispatch(&mut fixture, body);

    assert_eq!(fixture.engine.serves().len(), 2, "served again");
    let (url, opened_at) = fixture.player.openings().pop().expect("opened");
    assert!(url.starts_with(LOOPBACK));
    assert_eq!(opened_at, Some(start), "at the chapter's start");
    assert!(
        !fixture
            .player
            .tellings()
            .iter()
            .any(|telling| matches!(telling, Telling::Chapter(_))),
        "the open is already there, so the Player is not told to jump"
    );
    assert_eq!(
        fixture.host.snapshot().playback.state,
        PlaybackState::Opening
    );
}

#[test]
fn next_chapter_on_a_released_torrent_reopens_at_the_next_chapters_start() {
    a_chapter_action_on_a_released_torrent_reopens_at(
        serde_json::json!({ "type": "next_chapter" }),
        900.0,
    );
}

#[test]
fn previous_chapter_on_a_released_torrent_reopens_at_the_previous_chapters_start() {
    a_chapter_action_on_a_released_torrent_reopens_at(
        serde_json::json!({ "type": "previous_chapter" }),
        0.0,
    );
}

#[test]
fn set_chapter_on_a_released_torrent_reopens_at_that_chapters_start() {
    a_chapter_action_on_a_released_torrent_reopens_at(
        serde_json::json!({ "type": "set_chapter", "index": 3 }),
        1500.0,
    );
}

#[test]
fn a_refused_serve_on_a_chapter_jump_leaves_the_stream_released() {
    for body in [
        serde_json::json!({ "type": "next_chapter" }),
        serde_json::json!({ "type": "previous_chapter" }),
        serde_json::json!({ "type": "set_chapter", "index": 2 }),
    ] {
        let mut fixture = released_in_the_second_chapter();
        fixture.engine.refuse("Nobody answers.");

        let refused = fixture.host.dispatch(action(&body));

        match refused {
            Err(ActionError::Playback { detail }) => assert_eq!(detail, "Nobody answers."),
            other => panic!("a refused serve is a playback error: {other:?}"),
        }
        assert_eq!(fixture.player.openings().len(), 0, "nothing was opened");
        assert_eq!(
            fixture.host.snapshot().playback.state,
            PlaybackState::Paused,
            "the Stream is as it was"
        );

        fixture.engine.allow();
        dispatch(&mut fixture, body);
        assert_eq!(fixture.player.openings().len(), 1, "a second try wakes it");
    }
}

#[test]
fn an_unknown_chapter_on_a_released_torrent_is_refused_without_reopening() {
    let mut fixture = released_in_the_second_chapter();

    let refused = fixture.host.dispatch(action(
        &serde_json::json!({ "type": "set_chapter", "index": 9 }),
    ));

    assert!(matches!(
        refused,
        Err(ActionError::UnknownChapter { index: 9 })
    ));
    assert_eq!(fixture.engine.serves().len(), 1, "nothing was served");
}

#[test]
fn the_chapter_actions_on_a_torrent_that_is_still_held_do_not_reopen() {
    let mut fixture = fixture();
    play(&mut fixture, "tt0903747:1:1", &torrent_of(HASH)).expect("a torrent plays");
    fixture.player.now_reporting(Observation {
        chapters: chapters(),
        chapter: Some(1),
        ..Observation::playing(600.0, 2820.0)
    });
    fixture.host.sample();

    for (body, step) in [
        (
            serde_json::json!({ "type": "next_chapter" }),
            ChapterStep::Next,
        ),
        (
            serde_json::json!({ "type": "previous_chapter" }),
            ChapterStep::Previous,
        ),
        (
            serde_json::json!({ "type": "set_chapter", "index": 2 }),
            ChapterStep::At { index: 2 },
        ),
    ] {
        dispatch(&mut fixture, body);
        assert!(
            fixture.player.tellings().contains(&Telling::Chapter(step)),
            "the Player is told {step:?}"
        );
    }

    assert_eq!(fixture.engine.serves().len(), 1);
    assert_eq!(fixture.player.openings().len(), 1);
}

// ── A torrent with no file to play ──────────────────────────────────────────

const NO_FILE: &str = "This torrent holds 24 videos and none is S01E03.";
const MPV_WORDS: &str = "That Stream could not be opened — mpv could not load it.";

fn mpv_could_not_open(fixture: &Fixture) {
    fixture.player.now_reporting(Observation {
        state: PlaybackState::Idle,
        failure: Some(MPV_WORDS.to_owned()),
        ..Observation::idle()
    });
}

fn no_file(info_hash: &str) -> TorrentReport {
    TorrentReport::Failed {
        info_hash: hash(info_hash),
        kind: FailureKind::NoFile,
        sentence: NO_FILE.to_owned(),
    }
}

#[test]
fn a_no_file_report_is_the_failed_opens_sentence_in_place_of_the_players() {
    let mut fixture = fixture();
    play(&mut fixture, "tt0903747:1:3", &torrent_of(HASH)).expect("a torrent plays");
    fixture.engine.report(no_file(HASH));
    mpv_could_not_open(&fixture);

    let published = fixture.host.sample().expect("a failed open is published");

    assert_eq!(published.playback.state, PlaybackState::Idle);
    assert_eq!(
        published.playback.failure.as_deref(),
        Some(NO_FILE),
        "the engine's words, not mpv's"
    );
}

#[test]
fn the_engines_sentence_wins_when_the_players_failure_was_published_first() {
    let mut fixture = fixture();
    play(&mut fixture, "tt0903747:1:3", &torrent_of(HASH)).expect("a torrent plays");
    mpv_could_not_open(&fixture);
    let first = fixture.host.sample().expect("a failed open is published");
    assert_eq!(first.playback.failure.as_deref(), Some(MPV_WORDS));

    fixture.engine.report(no_file(HASH));
    let second = fixture.host.sample().expect("the sentence replaces mpv's");

    assert_eq!(second.playback.failure.as_deref(), Some(NO_FILE));
    assert_eq!(second.playback.state, PlaybackState::Idle);
}

#[test]
fn a_no_file_failure_writes_no_watch_progress() {
    let mut fixture = fixture();
    play(&mut fixture, "tt0903747:1:3", &torrent_of(HASH)).expect("a torrent plays");
    let before = fixture.store.persisted_watch();
    fixture.engine.report(no_file(HASH));
    mpv_could_not_open(&fixture);

    fixture.host.sample();

    assert_eq!(
        fixture.store.persisted_watch(),
        before,
        "an open that failed is not progress"
    );
}

#[test]
fn a_no_file_report_for_a_torrent_that_is_not_held_changes_nothing() {
    let mut fixture = fixture();
    play(&mut fixture, "tt0903747:1:3", &torrent_of(HASH)).expect("a torrent plays");
    fixture.engine.report(no_file(OTHER_HASH));
    mpv_could_not_open(&fixture);

    let published = fixture.host.sample().expect("a failed open is published");

    assert_eq!(
        published.playback.failure.as_deref(),
        Some(MPV_WORDS),
        "the report was about another torrent"
    );
}

#[test]
fn the_sentence_of_one_open_is_not_the_failure_of_the_next() {
    let mut fixture = fixture();
    play(&mut fixture, "tt0903747:1:3", &torrent_of(HASH)).expect("a torrent plays");
    fixture.engine.report(no_file(HASH));
    mpv_could_not_open(&fixture);
    fixture.host.sample();

    play(&mut fixture, "tt0903747:1:4", &torrent_of(HASH)).expect("another episode plays");
    mpv_could_not_open(&fixture);
    let published = fixture.host.sample().expect("a failed open is published");

    assert_eq!(
        published.playback.failure.as_deref(),
        Some(MPV_WORDS),
        "a new open starts without the last one's sentence"
    );
}
