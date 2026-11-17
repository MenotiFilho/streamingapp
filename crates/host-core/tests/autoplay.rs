//! Autoplay, driven the way a shell and its clients drive it: an episode's
//! Stream reaches its end in the Player, the Host's `sample()` notices, and the
//! Host's own countdown — anchored to its `Clock` — plays the next episode by
//! the continuity `next_episode` uses (ADR-0040). Nothing below the Action
//! surface is named here, and no test reaches the network.

use std::sync::Arc;

use host_core::{
    Action, AutoplayPhase, FixtureClock, FixtureFetcher, FixturePlayer, FixtureProvider, Host,
    InMemorySecretStore, InMemoryStore, Observation, Playback, PlaybackState, SecretBackend,
    Snapshot, Store, Stream, ACTION_VERSION, AUTOPLAY_COUNTDOWN_MS,
};

const SERIES: &str = "https://series.example.org/manifest.json";
const SERIES_ID: &str = "org.example.series";
const META_URL: &str = "https://series.example.org/meta/series/tt0903747.json";
const SERIES_META: &str = include_str!("fixtures/cinemeta-meta-series.json");

const PLAYING: &str = "https://stream.example.org/v/tt0903747-1-1.mkv";
const OTHER_RELEASE: &str = "https://stream.example.org/v/tt0903747-1-2-720p.mkv";
const SAME_RELEASE: &str = "https://stream.example.org/v/tt0903747-1-2-1080p.mkv";

/// 2026-11-17 00:00:00 UTC: after every air date the fixture lists.
const NOW: i64 = 1_794_873_600_000;

fn action(body: &serde_json::Value) -> Action {
    let envelope = format!(r#"{{"version":{ACTION_VERSION},"action":{body}}}"#);
    Action::parse(&envelope).unwrap_or_else(|error| panic!("{envelope} should parse: {error}"))
}

fn candidate(name: &str, url: &str, binge_group: Option<&str>) -> Stream {
    Stream {
        name: Some(name.to_owned()),
        description: None,
        playback: Playback::Direct {
            url: url.to_owned(),
        },
        warnings: Vec::new(),
        filename: None,
        binge_group: binge_group.map(str::to_owned),
    }
}

fn torrent(name: &str, info_hash: &str, binge_group: Option<&str>) -> Stream {
    Stream {
        playback: Playback::InfoHash {
            info_hash: info_hash.to_owned(),
        },
        ..candidate(name, "", binge_group)
    }
}

struct Fixture {
    host: Host,
    player: Arc<FixturePlayer>,
    clock: Arc<FixtureClock>,
    store: Arc<InMemoryStore>,
}

fn fixture_offering(candidates: Vec<Stream>) -> Fixture {
    fixture_over(FixtureProvider::new().offering(SERIES_ID, candidates))
}

fn fixture_over(provider: FixtureProvider) -> Fixture {
    let player = Arc::new(FixturePlayer::new());
    let provider = Arc::new(provider);
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
        .serving(META_URL, SERIES_META.to_owned());

    let mut host = Host::new(
        store.clone() as Arc<dyn Store>,
        Arc::new(fetcher),
        Arc::new(InMemorySecretStore::backed_by(SecretBackend::Keyring)),
        provider,
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
        clock,
        store,
    }
}

fn a_host() -> Fixture {
    fixture_offering(vec![
        candidate("720p", OTHER_RELEASE, Some("another-release")),
        candidate("1080p", SAME_RELEASE, Some("the-release")),
    ])
}

fn play(fixture: &mut Fixture, r#type: &str, id: &str, url: &str, binge: Option<&str>) {
    let mut stream = serde_json::json!({
        "name": "1080p",
        "playback": { "kind": "direct", "url": url },
        "warnings": [],
    });
    if let Some(binge) = binge {
        stream["bingeGroup"] = serde_json::Value::String(binge.to_owned());
    }
    fixture
        .host
        .dispatch(action(&serde_json::json!({
            "type": "play_stream",
            "video": { "type": r#type, "id": id },
            "addon": SERIES_ID,
            "title": {
                "addon": SERIES_ID,
                "id": id,
                "type": r#type,
                "name": id,
                "poster": null,
            },
            "stream": stream,
        })))
        .unwrap_or_else(|error| panic!("playing a direct candidate should work: {error}"));
}

/// The Stream reaches its end, and the Host's tick notices.
fn reach_the_end(fixture: &mut Fixture) -> Option<Snapshot> {
    fixture.player.now_reporting(Observation {
        state: PlaybackState::Ended,
        position: Some(2820.0),
        duration: Some(2820.0),
        ..Observation::idle()
    });
    fixture.host.sample()
}

/// The first episode of the series, played and finished.
fn first_episode_ended(fixture: &mut Fixture) -> Snapshot {
    play(
        fixture,
        "series",
        "tt0903747:1:1",
        PLAYING,
        Some("the-release"),
    );
    reach_the_end(fixture).expect("reaching the end is a change")
}

/// The player is now on a Stream that plays, as it is once a new open lands.
fn is_playing_again(fixture: &Fixture) {
    fixture
        .player
        .now_reporting(Observation::playing(0.0, 2820.0));
}

fn dispatch(fixture: &mut Fixture, body: serde_json::Value) -> host_core::Response {
    fixture
        .host
        .dispatch(action(&body))
        .unwrap_or_else(|error| panic!("{body} should work: {error}"))
}

fn countdown(snapshot: &Snapshot) -> Option<(String, f64, f64)> {
    snapshot.playback.autoplay.as_ref().and_then(|autoplay| {
        let AutoplayPhase::Countdown {
            remaining,
            duration,
        } = autoplay.phase
        else {
            return None;
        };
        Some((autoplay.next.video.id.clone(), remaining, duration))
    })
}

/// What a `no_stream` Snapshot says: the Video it is about, and why.
fn no_stream(snapshot: &Snapshot) -> Option<(String, String)> {
    let autoplay = snapshot.playback.autoplay.as_ref()?;
    match &autoplay.phase {
        AutoplayPhase::NoStream { detail } => {
            Some((autoplay.next.video.id.clone(), detail.clone()))
        }
        _ => None,
    }
}

#[test]
fn an_episode_that_ends_publishes_a_countdown_to_the_next_one() {
    let mut fixture = a_host();

    let published = first_episode_ended(&mut fixture);

    let autoplay = published
        .playback
        .autoplay
        .as_ref()
        .expect("an episode with an Up next, Autoplay on: a countdown is published");
    assert_eq!(autoplay.next.title.r#type, "series");
    assert_eq!(autoplay.next.title.id, "tt0903747");
    assert_eq!(autoplay.next.video.r#type, "series");
    assert_eq!(autoplay.next.video.id, "tt0903747:1:2");
    assert_eq!(
        (autoplay.next.episode.season, autoplay.next.episode.episode),
        (1, 2)
    );
    assert_eq!(autoplay.next.name.as_deref(), Some("Cat's in the Bag..."));
    assert_eq!(
        autoplay.next.still.as_deref(),
        Some("https://episodes.metahub.space/tt0903747/1/2/w780.jpg")
    );
    assert_eq!(
        autoplay.phase,
        AutoplayPhase::Countdown {
            remaining: 5.0,
            duration: 5.0
        }
    );
    assert_eq!(AUTOPLAY_COUNTDOWN_MS, 5_000);
}

#[test]
fn the_published_countdown_is_flat_on_the_wire() {
    let mut fixture = a_host();

    let published = first_episode_ended(&mut fixture);

    let wire = serde_json::to_value(&published.playback.autoplay).expect("a Snapshot serializes");
    assert_eq!(
        (&wire["phase"], &wire["remaining"], &wire["duration"]),
        (
            &serde_json::json!("countdown"),
            &serde_json::json!(5.0),
            &serde_json::json!(5.0)
        ),
        "a client switches on one `phase` tag: {wire}"
    );
    assert_eq!(wire["next"]["video"]["id"], "tt0903747:1:2");
}

#[test]
fn a_snapshot_built_mid_countdown_carries_the_time_that_is_left() {
    let mut fixture = a_host();
    first_episode_ended(&mut fixture);

    fixture.clock.tick(2_000);

    assert_eq!(
        countdown(&fixture.host.snapshot()),
        Some(("tt0903747:1:2".to_owned(), 3.0, 5.0)),
        "a client that reconnects is owed the remaining time true now"
    );
}

#[test]
fn the_countdown_is_published_when_it_starts_and_not_on_every_tick() {
    let mut fixture = a_host();
    first_episode_ended(&mut fixture);

    fixture.clock.tick(4_900);

    assert!(
        fixture.host.sample().is_none(),
        "a tick inside the countdown, on an unchanged report, publishes nothing"
    );
}

#[test]
fn when_the_countdown_runs_out_the_next_episode_plays_from_the_same_release() {
    let mut fixture = a_host();
    first_episode_ended(&mut fixture);

    fixture.clock.tick(5_000);
    let published = fixture
        .host
        .sample()
        .expect("the expiry is checked before an unchanged report returns early");

    assert_eq!(
        fixture.player.opened(),
        vec![PLAYING.to_owned(), SAME_RELEASE.to_owned()],
        "the same bingeGroup from the same Addon, over an earlier candidate"
    );
    assert_eq!(
        published
            .playback
            .now_playing
            .as_ref()
            .map(|now| now.video.id.as_str()),
        Some("tt0903747:1:2")
    );
    assert!(
        published.playback.autoplay.is_none(),
        "the countdown ended with the play"
    );

    let entry = fixture
        .store
        .persisted_watch()
        .into_iter()
        .find(|entry| entry.video.id == "tt0903747:1:2")
        .expect("the next episode has a fresh Watch progress entry");
    assert_eq!(
        entry.stream_addon.as_ref().map(|a| a.as_str()),
        Some(SERIES_ID)
    );
    assert_eq!(entry.binge_group.as_deref(), Some("the-release"));
    assert_eq!(entry.position, None);
}

#[test]
fn when_the_release_is_gone_the_addons_first_playable_candidate_plays() {
    let mut fixture = fixture_offering(vec![
        torrent(
            "a torrent",
            "61065ea115b7cc3e8db9fb5ab1f6f327f08bd1c9",
            Some("the-release"),
        ),
        candidate("720p", OTHER_RELEASE, Some("another-release")),
    ]);
    first_episode_ended(&mut fixture);

    fixture.clock.tick(5_000);
    fixture.host.sample().expect("the countdown ran out");

    assert_eq!(
        fixture.player.opened(),
        vec![PLAYING.to_owned(), OTHER_RELEASE.to_owned()]
    );
}

#[test]
fn when_continuity_finds_nothing_the_host_stays_on_the_ended_state_and_says_so() {
    let mut fixture = fixture_offering(vec![torrent(
        "a torrent",
        "61065ea115b7cc3e8db9fb5ab1f6f327f08bd1c9",
        Some("the-release"),
    )]);
    first_episode_ended(&mut fixture);

    fixture.clock.tick(5_000);
    let published = fixture
        .host
        .sample()
        .expect("the missing Stream is published");

    assert_eq!(
        fixture.player.opened(),
        vec![PLAYING.to_owned()],
        "nothing is opened"
    );
    assert_eq!(published.playback.state, PlaybackState::Ended);
    let (video, detail) = no_stream(&published).expect("the Host says there is no Stream");
    assert_eq!(video, "tt0903747:1:2", "about the episode that was due");
    assert!(!detail.is_empty(), "with the reason");
    assert_eq!(
        fixture.host.sample(),
        None,
        "and nothing arms again on the next tick"
    );
    assert_eq!(
        no_stream(&fixture.host.snapshot()),
        no_stream(&published),
        "a client that connects afterwards is told the same"
    );
}

#[test]
fn an_addon_that_errors_at_expiry_is_a_missing_stream_too() {
    let mut fixture = fixture_over(FixtureProvider::new().failing(
        SERIES_ID,
        host_core::ActionError::Fetch {
            detail: "the Addon is down".to_owned(),
        },
    ));
    first_episode_ended(&mut fixture);

    fixture.clock.tick(5_000);
    let published = fixture.host.sample().expect("published");

    assert!(fixture.player.opened() == vec![PLAYING.to_owned()]);
    assert!(no_stream(&published).is_some());
}

#[test]
fn an_addon_that_is_gone_at_expiry_is_a_missing_stream_too() {
    let mut fixture = a_host();
    first_episode_ended(&mut fixture);
    dispatch(
        &mut fixture,
        serde_json::json!({ "type": "remove_addon", "id": SERIES_ID }),
    );

    fixture.clock.tick(5_000);
    let published = fixture
        .host
        .sample()
        .expect("the missing Stream is published");

    assert_eq!(fixture.player.opened(), vec![PLAYING.to_owned()]);
    let (video, _) = no_stream(&published).expect("no_stream");
    assert_eq!(video, "tt0903747:1:2");
}

#[test]
fn a_missing_stream_is_dismissed_like_a_countdown() {
    let mut fixture = fixture_offering(Vec::new());
    first_episode_ended(&mut fixture);
    fixture.clock.tick(5_000);
    fixture.host.sample().expect("no_stream is published");

    let cancelled = dispatch(
        &mut fixture,
        serde_json::json!({ "type": "cancel_autoplay" }),
    );
    assert!(cancelled.snapshots[0].playback.autoplay.is_none());
}

#[test]
fn a_missing_stream_is_left_by_playing_something_else() {
    let mut fixture = fixture_offering(Vec::new());
    first_episode_ended(&mut fixture);
    fixture.clock.tick(5_000);
    fixture.host.sample().expect("no_stream is published");

    dispatch(&mut fixture, serde_json::json!({ "type": "stop_playback" }));
    assert!(fixture.host.snapshot().playback.autoplay.is_none());
}

#[test]
fn cancel_autoplay_stops_this_countdown_and_keeps_the_preference() {
    let mut fixture = a_host();
    first_episode_ended(&mut fixture);

    let published = dispatch(
        &mut fixture,
        serde_json::json!({ "type": "cancel_autoplay" }),
    );

    let snapshot = &published.snapshots[0];
    assert!(snapshot.playback.autoplay.is_none());
    assert!(
        snapshot.preferences.autoplay,
        "tonight's stop is not a preference"
    );

    fixture.clock.tick(10_000);
    assert_eq!(fixture.host.sample(), None);
    assert_eq!(
        fixture.player.opened(),
        vec![PLAYING.to_owned()],
        "nothing plays on its own after a cancel"
    );
}

#[test]
fn cancel_autoplay_with_nothing_pending_publishes_nothing_and_moves_no_revision() {
    let mut fixture = a_host();
    play(
        &mut fixture,
        "series",
        "tt0903747:1:1",
        PLAYING,
        Some("the-release"),
    );
    let before = fixture.host.snapshot().revision;

    let published = dispatch(
        &mut fixture,
        serde_json::json!({ "type": "cancel_autoplay" }),
    );

    assert!(published.snapshots.is_empty());
    assert_eq!(fixture.host.snapshot().revision, before);
}

#[test]
fn turning_autoplay_off_clears_a_running_countdown_and_turning_it_on_arms_one() {
    let mut fixture = a_host();
    first_episode_ended(&mut fixture);

    let off = dispatch(
        &mut fixture,
        serde_json::json!({ "type": "set_autoplay", "autoplay": false }),
    );
    assert!(!off.snapshots[0].preferences.autoplay);
    assert!(off.snapshots[0].playback.autoplay.is_none());

    fixture.clock.tick(10_000);
    assert_eq!(fixture.host.sample(), None, "Wait means wait");

    let on = dispatch(
        &mut fixture,
        serde_json::json!({ "type": "set_autoplay", "autoplay": true }),
    );
    assert_eq!(
        countdown(&on.snapshots[0]),
        Some(("tt0903747:1:2".to_owned(), 5.0, 5.0)),
        "on a plain ended state, switching it on starts the countdown"
    );
}

#[test]
fn a_cancelled_countdown_is_started_again_by_switching_autoplay_on_again() {
    let mut fixture = a_host();
    first_episode_ended(&mut fixture);
    dispatch(
        &mut fixture,
        serde_json::json!({ "type": "cancel_autoplay" }),
    );

    let on = dispatch(
        &mut fixture,
        serde_json::json!({ "type": "set_autoplay", "autoplay": true }),
    );

    assert!(on.snapshots[0].playback.autoplay.is_some());
}

#[test]
fn turning_autoplay_on_while_an_episode_plays_arms_nothing() {
    let mut fixture = a_host();
    play(
        &mut fixture,
        "series",
        "tt0903747:1:1",
        PLAYING,
        Some("the-release"),
    );

    let on = dispatch(
        &mut fixture,
        serde_json::json!({ "type": "set_autoplay", "autoplay": true }),
    );

    assert!(on.snapshots[0].playback.autoplay.is_none());
}

#[test]
fn next_episode_skips_the_countdown() {
    let mut fixture = a_host();
    first_episode_ended(&mut fixture);

    let published = dispatch(&mut fixture, serde_json::json!({ "type": "next_episode" }));

    assert!(published.snapshots[0].playback.autoplay.is_none());
    assert_eq!(
        fixture.player.opened(),
        vec![PLAYING.to_owned(), SAME_RELEASE.to_owned()]
    );

    is_playing_again(&fixture);
    fixture.host.sample();
    fixture.clock.tick(10_000);
    assert_eq!(fixture.host.sample(), None);
    assert_eq!(
        fixture.player.opened().len(),
        2,
        "the countdown did not play it twice"
    );
}

#[test]
fn stop_playback_clears_the_countdown() {
    let mut fixture = a_host();
    first_episode_ended(&mut fixture);

    let published = dispatch(&mut fixture, serde_json::json!({ "type": "stop_playback" }));

    assert!(published.snapshots[0].playback.autoplay.is_none());
    fixture.clock.tick(10_000);
    assert_eq!(fixture.host.sample(), None);
    assert_eq!(fixture.player.opened(), vec![PLAYING.to_owned()]);
}

#[test]
fn any_play_replaces_the_countdown() {
    let mut fixture = a_host();
    first_episode_ended(&mut fixture);

    play(
        &mut fixture,
        "series",
        "tt0903747:1:3",
        PLAYING,
        Some("the-release"),
    );

    assert!(fixture.host.snapshot().playback.autoplay.is_none());
}

#[test]
fn a_season_finale_leads_into_the_next_seasons_first_episode() {
    let mut fixture = a_host();
    play(
        &mut fixture,
        "series",
        "tt0903747:1:3",
        PLAYING,
        Some("the-release"),
    );

    let published = reach_the_end(&mut fixture).expect("the end is a change");

    assert_eq!(
        countdown(&published).map(|(video, ..)| video),
        Some("tt0903747:2:1".to_owned())
    );
}

#[test]
fn the_last_numbered_episode_and_the_last_special_arm_nothing() {
    for last in ["tt0903747:2:1", "tt0903747:0:1"] {
        let mut fixture = a_host();
        play(&mut fixture, "series", last, PLAYING, Some("the-release"));

        let published = reach_the_end(&mut fixture).expect("the end is a change");

        assert!(published.playback.autoplay.is_none(), "after {last}");
    }
}

#[test]
fn an_up_next_that_has_not_aired_yet_arms_nothing() {
    // S1E2 airs 2008-01-28, and it is 2008-01-27 in UTC.
    let mut fixture = a_host();
    fixture.clock.set(1201478399000);
    let published = first_episode_ended(&mut fixture);
    assert!(published.playback.autoplay.is_none());

    // On the day it airs, it is eligible.
    let mut fixture = a_host();
    fixture.clock.set(1201478400000);
    let published = first_episode_ended(&mut fixture);
    assert!(published.playback.autoplay.is_some());
}

#[test]
fn a_film_that_ends_arms_nothing() {
    let mut fixture = a_host();
    play(&mut fixture, "movie", "tt0133093", PLAYING, None);

    let published = reach_the_end(&mut fixture).expect("the end is a change");

    assert!(published.playback.autoplay.is_none());
}

#[test]
fn with_autoplay_off_an_ending_arms_nothing() {
    let mut fixture = a_host();
    dispatch(
        &mut fixture,
        serde_json::json!({ "type": "set_autoplay", "autoplay": false }),
    );

    let published = first_episode_ended(&mut fixture);

    assert!(published.playback.autoplay.is_none());
    fixture.clock.tick(10_000);
    assert_eq!(fixture.host.sample(), None);
}

#[test]
fn a_countdown_is_not_persisted() {
    let mut fixture = a_host();
    first_episode_ended(&mut fixture);

    // A Host restarted over the same store holds no stream, so no countdown.
    let restarted = Host::new(
        fixture.store.clone() as Arc<dyn Store>,
        Arc::new(FixtureFetcher::new()),
        Arc::new(InMemorySecretStore::backed_by(SecretBackend::Keyring)),
        Arc::new(FixtureProvider::new()),
        Arc::new(FixturePlayer::new()),
        fixture.clock.clone(),
    )
    .expect("a Host over the same store starts again");

    assert!(restarted.snapshot().playback.autoplay.is_none());
}
