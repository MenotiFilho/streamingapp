//! Watch progress and the library, driven the way a client drives it: an Action
//! in, published Snapshots out, and the URL the Player was asked to open. The
//! store is the in-memory one, so a "restart" is a second Host over the same
//! store — which is the whole of what "survives a restart" means here. Nothing
//! below the Action surface is named, and no test reaches the network.

use std::sync::Arc;

use host_core::{
    Action, ActionError, FixtureClock, FixtureFetcher, FixturePlayer, FixtureProvider, Host,
    InMemorySecretStore, InMemoryStore, Observation, Playback, PlaybackState, SecretBackend, Store,
    Stream, UnplayableReason, ACTION_VERSION,
};

/// The one Addon these tests configure: it answers `meta` and `stream` for a
/// series, which is what a Title card and a resume are both read from.
const SERIES: &str = "https://series.example.org/manifest.json";
const SERIES_ID: &str = "org.example.series";
const META_URL: &str = "https://series.example.org/meta/series/tt0903747.json";
const SERIES_META: &str = include_str!("fixtures/cinemeta-meta-series.json");

/// The candidate every Video is offered.
const EPISODE: &str = "https://stream.example.org/v/tt0903747.mkv";
const FILM: &str = "https://stream.example.org/v/tt0133093.mkv";

/// An Action as a client sends it: the versioned envelope, as JSON text.
fn action(body: &serde_json::Value) -> Action {
    let envelope = format!(r#"{{"version":{ACTION_VERSION},"action":{body}}}"#);
    Action::parse(&envelope).unwrap_or_else(|error| panic!("{envelope} should parse: {error}"))
}

/// A manifest that answers `meta` and `stream` for films and series.
fn manifest() -> String {
    format!(
        r#"{{"id":"{SERIES_ID}","name":"Series","version":"1.0.0",
             "resources":["meta","stream"],"types":["movie","series"],"catalogs":[]}}"#
    )
}

/// A candidate a direct URL is played as.
fn candidate(url: &str) -> Stream {
    Stream {
        name: Some("1080p".to_owned()),
        description: None,
        playback: Playback::Direct {
            url: url.to_owned(),
        },
        warnings: Vec::new(),
        filename: None,
        binge_group: None,
    }
}

/// A Host over an in-memory store, with the one Addon configured, and the ends
/// a test holds: the Player, the Provider, the store (to restart over) and the
/// clock (to order writes by).
struct Fixture {
    host: Host,
    player: Arc<FixturePlayer>,
    provider: Arc<FixtureProvider>,
    store: Arc<InMemoryStore>,
    clock: Arc<FixtureClock>,
}

fn fixture() -> Fixture {
    fixture_over(Arc::new(InMemoryStore::new()))
}

fn fixture_over(store: Arc<InMemoryStore>) -> Fixture {
    let player = Arc::new(FixturePlayer::new());
    let provider = Arc::new(
        FixtureProvider::new().offering(SERIES_ID, vec![candidate(EPISODE), candidate(FILM)]),
    );
    let fetcher = FixtureFetcher::new()
        .serving(SERIES, manifest())
        .serving(META_URL, SERIES_META);
    let clock = Arc::new(FixtureClock::new().at(1_000));

    let mut host = Host::new(
        store.clone() as Arc<dyn Store>,
        Arc::new(fetcher),
        Arc::new(InMemorySecretStore::backed_by(SecretBackend::Keyring)),
        provider.clone(),
        player.clone(),
        clock.clone(),
    )
    .expect("a Host over a store starts");

    host.dispatch(action(
        &serde_json::json!({ "type": "add_addon", "url": SERIES }),
    ))
    .expect("configuring the Addon should work");

    Fixture {
        host,
        player,
        provider,
        store,
        clock,
    }
}

/// Choose a candidate for a Video of the configured Addon, with the Title card
/// a client that was reading it would send.
fn play(fixture: &mut Fixture, r#type: &str, video: &str) {
    let title_id = if r#type == "series" {
        "tt0903747"
    } else {
        "tt0133093"
    };

    fixture
        .host
        .dispatch(action(&serde_json::json!({
            "type": "play_stream",
            "video": { "type": r#type, "id": video },
            "addon": SERIES_ID,
            "title": {
                "addon": SERIES_ID,
                "id": title_id,
                "type": r#type,
                "name": "Breaking Bad",
                "poster": "https://images.example.org/bb.jpg",
            },
            "stream": {
                "name": "1080p",
                "playback": { "kind": "direct", "url": EPISODE },
                "warnings": [],
            },
        })))
        .unwrap_or_else(|error| panic!("playing a direct candidate should work: {error}"));
}

/// Report where playback is, and let the Host read it: the tick that records
/// Watch progress.
fn watching(fixture: &mut Fixture, position: f64, duration: f64, at: i64) {
    fixture
        .player
        .now_reporting(Observation::playing(position, duration));
    fixture.clock.set(at);
    fixture
        .host
        .sample()
        .expect("the Player says something new about what is playing");
}

/// The library as every client is told it.
fn library(fixture: &Host) -> Vec<host_core::ResumeEntry> {
    fixture.snapshot().watch_progress
}

#[test]
fn playing_a_video_records_where_it_got_to_and_the_snapshot_carries_it() {
    let mut fixture = fixture();

    play(&mut fixture, "series", "tt0903747:1:2");
    assert!(
        library(&fixture.host).len() == 1,
        "a play is a library entry from the moment it is chosen"
    );
    watching(&mut fixture, 402.0, 2820.0, 10_000);

    let entry = &library(&fixture.host)[0];
    assert_eq!(entry.video.id, "tt0903747:1:2");
    assert_eq!(entry.video.season, Some(1));
    assert_eq!(entry.video.episode, Some(2));
    assert_eq!(entry.title.name(), "Breaking Bad");
    assert_eq!(entry.position, Some(402.0));
    assert_eq!(entry.duration, Some(2820.0));
    assert!(!entry.watched, "a Stream at 402 seconds is not finished");
    assert_eq!(entry.unplayable, None);
}

#[test]
fn watch_progress_survives_a_host_that_was_killed_without_a_stop() {
    // The point of #29: the position is written *while* playback runs, so a
    // Host that never gets to stop is not a Host that forgot where it was.
    let mut fixture = fixture();
    play(&mut fixture, "series", "tt0903747:1:2");
    watching(&mut fixture, 900.0, 2820.0, 10_000);

    let restarted = fixture_over(fixture.store.clone());

    let entry = &library(&restarted.host)[0];
    assert_eq!(entry.video.id, "tt0903747:1:2");
    assert_eq!(
        entry.position,
        Some(900.0),
        "the store held the last position the Player reported"
    );
    assert_eq!(
        restarted.host.snapshot().playback.state,
        PlaybackState::Idle,
        "playback itself does not survive; only the progress does"
    );
}

#[test]
fn every_episode_of_a_series_keeps_its_own_progress() {
    let mut fixture = fixture();

    play(&mut fixture, "series", "tt0903747:1:3");
    watching(&mut fixture, 100.0, 2820.0, 10_000);
    play(&mut fixture, "series", "tt0903747:1:4");
    watching(&mut fixture, 200.0, 2820.0, 20_000);

    let mut held: Vec<(String, Option<f64>)> = library(&fixture.host)
        .iter()
        .map(|entry| (entry.video.id.clone(), entry.position))
        .collect();
    held.sort_by(|one, other| one.0.cmp(&other.0));

    assert_eq!(
        held,
        vec![
            ("tt0903747:1:3".to_owned(), Some(100.0)),
            ("tt0903747:1:4".to_owned(), Some(200.0)),
        ],
        "watching episode 4 did not overwrite episode 3"
    );
}

#[test]
fn the_library_comes_back_most_recently_played_first() {
    let mut fixture = fixture();

    play(&mut fixture, "series", "tt0903747:1:1");
    watching(&mut fixture, 100.0, 2820.0, 10_000);
    play(&mut fixture, "series", "tt0903747:1:2");
    watching(&mut fixture, 200.0, 2820.0, 20_000);

    assert_eq!(
        library(&fixture.host)
            .iter()
            .map(|entry| entry.video.id.as_str())
            .collect::<Vec<_>>(),
        vec!["tt0903747:1:2", "tt0903747:1:1"]
    );
}

#[test]
fn a_video_that_finishes_or_stops_within_its_last_moments_is_marked_watched() {
    let mut fixture = fixture();
    play(&mut fixture, "series", "tt0903747:1:1");
    watching(&mut fixture, 2800.0, 2820.0, 10_000);

    assert!(
        library(&fixture.host)[0].watched,
        "the last thirty seconds of a Stream are the end of it"
    );
}

#[test]
fn a_video_that_reaches_its_end_is_watched_and_paused_in_the_wrong_place_is_not() {
    let mut fixture = fixture();
    play(&mut fixture, "series", "tt0903747:1:1");
    watching(&mut fixture, 600.0, 2820.0, 10_000);
    assert!(
        !library(&fixture.host)[0].watched,
        "ten minutes into a forty-seven minute episode is not watched"
    );

    fixture.player.now_reporting(Observation {
        state: PlaybackState::Ended,
        position: Some(2820.0),
        duration: Some(2820.0),
        ..Observation::idle()
    });
    fixture.clock.set(20_000);
    fixture.host.sample().expect("reaching the end is a change");

    assert!(library(&fixture.host)[0].watched);
}

#[test]
fn the_next_episode_is_a_new_entry_under_the_same_title_and_the_one_watched_stays() {
    let mut fixture = fixture();
    play(&mut fixture, "series", "tt0903747:1:1");
    watching(&mut fixture, 2810.0, 2820.0, 10_000);

    fixture.clock.set(20_000);
    fixture
        .host
        .dispatch(action(&serde_json::json!({ "type": "next_episode" })))
        .expect("the next episode of a series plays");

    let held = library(&fixture.host);
    assert_eq!(held.len(), 2);
    assert_eq!(held[0].video.id, "tt0903747:1:2", "the new episode leads");
    assert_eq!(
        held[0].title.id(),
        "tt0903747",
        "the next episode is recorded against the same Title"
    );
    assert!(held[1].watched, "the episode that finished stays watched");
}

#[test]
fn removing_the_addon_that_supplied_a_title_leaves_a_stub_that_is_still_listed() {
    let mut fixture = fixture();
    play(&mut fixture, "series", "tt0903747:1:2");
    watching(&mut fixture, 402.0, 2820.0, 10_000);

    fixture
        .host
        .dispatch(action(&serde_json::json!({
            "type": "remove_addon",
            "id": SERIES_ID,
        })))
        .expect("removing a configured Addon works");

    let published = fixture.host.snapshot();
    assert!(published.addons.is_empty());
    let entry = &published.watch_progress[0];
    assert_eq!(entry.video.id, "tt0903747:1:2");
    assert_eq!(
        entry.position,
        Some(402.0),
        "the progress it had is not thrown away with the Addon"
    );
    let unplayable = entry
        .unplayable
        .as_ref()
        .expect("the entry stays, marked unplayable");
    assert_eq!(unplayable.reason, UnplayableReason::AddonRemoved);
    assert_eq!(unplayable.addon.as_str(), SERIES_ID);
}

#[test]
fn resuming_a_video_opens_a_stream_at_the_position_that_was_recorded() {
    let mut fixture = fixture();
    play(&mut fixture, "series", "tt0903747:1:2");
    watching(&mut fixture, 402.0, 2820.0, 10_000);

    let published = fixture
        .host
        .dispatch(action(&serde_json::json!({
            "type": "resume",
            "video": { "type": "series", "id": "tt0903747:1:2" },
        })))
        .expect("a Video with Watch progress resumes");

    assert_eq!(
        fixture.player.openings(),
        vec![
            (EPISODE.to_owned(), None),
            (EPISODE.to_owned(), Some(402.0)),
        ],
        "a fresh play begins at the Stream's start; a resume begins where it was left"
    );
    assert_eq!(
        published.snapshots[0].playback.state,
        PlaybackState::Opening
    );
    assert_eq!(
        published.snapshots[0]
            .playback
            .now_playing
            .as_ref()
            .map(|now| now.video.id.as_str()),
        Some("tt0903747:1:2")
    );
}

#[test]
fn resuming_a_video_the_host_has_no_progress_for_is_refused() {
    let mut fixture = fixture();

    let refused = fixture.host.dispatch(action(&serde_json::json!({
        "type": "resume",
        "video": { "type": "series", "id": "tt0903747:1:9" },
    })));

    assert!(
        matches!(refused, Err(ActionError::NoProgress { .. })),
        "there is nothing to resume from: {refused:?}"
    );
    assert!(fixture.player.openings().is_empty());
}

#[test]
fn resuming_a_stub_whose_addon_is_gone_is_refused_rather_than_opened() {
    let mut fixture = fixture();
    play(&mut fixture, "series", "tt0903747:1:2");
    watching(&mut fixture, 402.0, 2820.0, 10_000);
    fixture
        .host
        .dispatch(action(&serde_json::json!({
            "type": "remove_addon",
            "id": SERIES_ID,
        })))
        .expect("removing a configured Addon works");

    let refused = fixture.host.dispatch(action(&serde_json::json!({
        "type": "resume",
        "video": { "type": "series", "id": "tt0903747:1:2" },
    })));

    assert!(
        matches!(refused, Err(ActionError::Unplayable(_))),
        "the Addon that supplied the Title is gone: {refused:?}"
    );
    assert_eq!(
        fixture.player.openings().len(),
        1,
        "the Player was asked to open only the Stream that was played"
    );
}

#[test]
fn resuming_asks_the_addons_that_answer_for_the_videos_streams() {
    let mut fixture = fixture();
    play(&mut fixture, "series", "tt0903747:1:2");
    watching(&mut fixture, 402.0, 2820.0, 10_000);
    let asked = fixture.provider.asked().len();

    fixture
        .host
        .dispatch(action(&serde_json::json!({
            "type": "resume",
            "video": { "type": "series", "id": "tt0903747:1:2" },
        })))
        .expect("a Video with Watch progress resumes");

    assert_eq!(
        fixture.provider.asked()[asked..].to_vec(),
        vec![SERIES_ID.to_owned()],
        "the Streams are asked of the Addons that answer, through the one Provider"
    );
}
