//! "Still watching?": Autoplay holding after three episodes in a row that
//! nobody touched, driven the way a shell and its clients drive it — through the
//! Player's reports, the Host's `sample()` and its `Clock` (ADR-0040). Nothing
//! below the Action surface is named here, and no test reaches the network.

use std::sync::Arc;

use host_core::{
    Action, AutoplayPhase, FixtureClock, FixtureFetcher, FixturePlayer, FixtureProvider, Host,
    InMemorySecretStore, InMemoryStore, Observation, Playback, PlaybackState, SecretBackend,
    Snapshot, Store, Stream, ACTION_VERSION, AUTOPLAY_COUNTDOWN_MS,
};

const SERIES: &str = "https://series.example.org/manifest.json";
const SERIES_ID: &str = "org.example.series";
const META_URL: &str = "https://series.example.org/meta/series/tt0903747.json";
const RELEASE: &str = "https://stream.example.org/v/tt0903747-1080p.mkv";

/// 2026-11-17 00:00:00 UTC: after every air date the series lists.
const NOW: i64 = 1_794_873_600_000;

/// One season of six episodes, all aired: enough for a hold in the middle of it.
fn series_meta() -> String {
    let videos: Vec<String> = (1..=6)
        .map(|episode| {
            format!(
                r#"{{"id":"tt0903747:1:{episode}","season":1,"episode":{episode},
                    "name":"Episode {episode}","released":"2008-01-2{episode}T00:00:00.000Z"}}"#
            )
        })
        .collect();
    format!(
        r#"{{"meta":{{"id":"tt0903747","type":"series","name":"Breaking Bad","videos":[{}]}}}}"#,
        videos.join(",")
    )
}

fn action(body: &serde_json::Value) -> Action {
    let envelope = format!(r#"{{"version":{ACTION_VERSION},"action":{body}}}"#);
    Action::parse(&envelope).unwrap_or_else(|error| panic!("{envelope} should parse: {error}"))
}

struct Fixture {
    host: Host,
    player: Arc<FixturePlayer>,
    clock: Arc<FixtureClock>,
}

fn a_host() -> Fixture {
    let player = Arc::new(FixturePlayer::new());
    let candidate = Stream {
        name: Some("1080p".to_owned()),
        description: None,
        playback: Playback::Direct {
            url: RELEASE.to_owned(),
        },
        warnings: Vec::new(),
        filename: None,
        binge_group: Some("the-release".to_owned()),
    };
    let provider = Arc::new(FixtureProvider::new().offering(SERIES_ID, vec![candidate]));
    let clock = Arc::new(FixtureClock::new().at(NOW));
    let fetcher = FixtureFetcher::new()
        .serving(
            SERIES,
            format!(
                r#"{{"id":"{SERIES_ID}","name":"{SERIES_ID}","version":"1.0.0",
                     "resources":["meta","stream"],"types":["movie","series"],"catalogs":[]}}"#
            ),
        )
        .serving(META_URL, series_meta());

    let mut host = Host::new(
        Arc::new(InMemoryStore::new()) as Arc<dyn Store>,
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
    }
}

fn dispatch(fixture: &mut Fixture, body: serde_json::Value) -> host_core::Response {
    fixture
        .host
        .dispatch(action(&body))
        .unwrap_or_else(|error| panic!("{body} should work: {error}"))
}

/// The owner starts an episode.
fn start(fixture: &mut Fixture, episode: u32) {
    let id = format!("tt0903747:1:{episode}");
    dispatch(
        fixture,
        serde_json::json!({
            "type": "play_stream",
            "video": { "type": "series", "id": id },
            "addon": SERIES_ID,
            "title": {
                "addon": SERIES_ID, "id": id, "type": "series", "name": id, "poster": null,
            },
            "stream": {
                "name": "1080p",
                "playback": { "kind": "direct", "url": RELEASE },
                "warnings": [],
                "bingeGroup": "the-release",
            },
        }),
    );
    fixture
        .player
        .now_reporting(Observation::playing(0.0, 2820.0));
}

/// The Stream reaches its end, and the Host's tick notices.
fn reach_the_end(fixture: &mut Fixture) -> Snapshot {
    fixture.player.now_reporting(Observation {
        state: PlaybackState::Ended,
        position: Some(2820.0),
        duration: Some(2820.0),
        ..Observation::idle()
    });
    fixture.host.sample().expect("reaching the end is a change")
}

/// The countdown runs out and the next episode plays on its own.
fn let_it_run_out(fixture: &mut Fixture) -> Snapshot {
    fixture.clock.tick(AUTOPLAY_COUNTDOWN_MS);
    let published = fixture
        .host
        .sample()
        .expect("the countdown ran out and played");
    fixture
        .player
        .now_reporting(Observation::playing(0.0, 2820.0));
    published
}

fn playing(snapshot: &Snapshot) -> Option<&str> {
    snapshot
        .playback
        .now_playing
        .as_ref()
        .map(|now| now.video.id.as_str())
}

fn phase(snapshot: &Snapshot) -> Option<&AutoplayPhase> {
    snapshot
        .playback
        .autoplay
        .as_ref()
        .map(|autoplay| &autoplay.phase)
}

fn is_counting_down(snapshot: &Snapshot) -> bool {
    matches!(phase(snapshot), Some(AutoplayPhase::Countdown { .. }))
}

/// Episodes 1, 2 and 3 end and play the next on their own, and episode 4 — the
/// third auto-advance's — ends with nobody having touched anything.
fn three_unattended_advances(fixture: &mut Fixture) -> Snapshot {
    start(fixture, 1);
    for episode in 1..=3 {
        let ended = reach_the_end(fixture);
        assert!(is_counting_down(&ended), "episode {episode} counts down");
        let played = let_it_run_out(fixture);
        assert_eq!(
            playing(&played),
            Some(&*format!("tt0903747:1:{}", episode + 1))
        );
    }
    reach_the_end(fixture)
}

#[test]
fn three_unattended_advances_then_the_next_ending_holds_on_still_watching() {
    let mut fixture = a_host();

    let held = three_unattended_advances(&mut fixture);

    let autoplay = held
        .playback
        .autoplay
        .as_ref()
        .expect("the hold is published");
    assert_eq!(autoplay.phase, AutoplayPhase::UnattendedLimit {});
    assert_eq!(
        autoplay.next.video.id, "tt0903747:1:5",
        "it holds on the episode it would have played"
    );
    assert_eq!(held.playback.state, PlaybackState::Ended);

    fixture.clock.tick(60_000);
    assert_eq!(fixture.host.sample(), None, "a hold never runs out");
    assert_eq!(fixture.player.opened().len(), 4, "and nothing else plays");
}

#[test]
fn the_hold_is_flat_on_the_wire() {
    let mut fixture = a_host();
    three_unattended_advances(&mut fixture);

    let wire = serde_json::to_value(fixture.host.snapshot()).expect("a Snapshot serializes");

    assert_eq!(wire["playback"]["autoplay"]["phase"], "unattended_limit");
    assert_eq!(
        wire["playback"]["autoplay"]["next"]["video"]["id"],
        "tt0903747:1:5"
    );
    assert!(wire["playback"]["autoplay"].get("remaining").is_none());
}

#[test]
fn a_seek_in_between_resets_the_count_and_a_fourth_countdown_arms() {
    let mut fixture = a_host();
    start(&mut fixture, 1);
    for _ in 1..=3 {
        reach_the_end(&mut fixture);
        let_it_run_out(&mut fixture);
    }

    // The owner is there for the fourth episode: they seek in it.
    dispatch(
        &mut fixture,
        serde_json::json!({ "type": "seek", "target": { "kind": "to", "seconds": 600.0 } }),
    );
    let ended = reach_the_end(&mut fixture);

    assert!(
        is_counting_down(&ended),
        "a seek counts as being there: {:?}",
        phase(&ended)
    );
}

#[test]
fn a_look_hint_is_not_somebody_being_there() {
    let mut fixture = a_host();
    start(&mut fixture, 1);
    for _ in 1..=3 {
        reach_the_end(&mut fixture);
        let_it_run_out(&mut fixture);
    }

    dispatch(
        &mut fixture,
        serde_json::json!({
            "type": "look_hint",
            "addon": null,
            "title": { "type": "series", "id": "tt0903747" },
        }),
    );
    let ended = reach_the_end(&mut fixture);

    assert_eq!(phase(&ended), Some(&AutoplayPhase::UnattendedLimit {}));
}

#[test]
fn a_change_during_the_hold_resets_the_count_but_starts_no_countdown() {
    let mut fixture = a_host();
    three_unattended_advances(&mut fixture);

    let touched = dispatch(
        &mut fixture,
        serde_json::json!({ "type": "set_subtitle_scale", "scale": 1.25 }),
    );

    assert_eq!(
        phase(&touched.snapshots[0]),
        Some(&AutoplayPhase::UnattendedLimit {}),
        "the hold stays, with no countdown beside it"
    );
    fixture.clock.tick(60_000);
    assert_eq!(fixture.host.sample(), None);
    assert_eq!(fixture.player.opened().len(), 4);

    // The count was reset, so the next episode the owner plays counts down.
    let played = dispatch(&mut fixture, serde_json::json!({ "type": "next_episode" }));
    assert_eq!(playing(&played.snapshots[0]), Some("tt0903747:1:5"));
    fixture
        .player
        .now_reporting(Observation::playing(0.0, 2820.0));
    assert!(is_counting_down(&reach_the_end(&mut fixture)));
}

#[test]
fn next_episode_from_the_hold_plays_the_next_episode_and_clears_it() {
    let mut fixture = a_host();
    three_unattended_advances(&mut fixture);

    let played = dispatch(&mut fixture, serde_json::json!({ "type": "next_episode" }));

    let snapshot = &played.snapshots[0];
    assert_eq!(playing(snapshot), Some("tt0903747:1:5"));
    assert!(snapshot.playback.autoplay.is_none());
}

#[test]
fn cancel_autoplay_dismisses_the_hold_and_switching_autoplay_on_arms_a_countdown() {
    let mut fixture = a_host();
    three_unattended_advances(&mut fixture);

    let cancelled = dispatch(
        &mut fixture,
        serde_json::json!({ "type": "cancel_autoplay" }),
    );
    let snapshot = &cancelled.snapshots[0];
    assert!(
        snapshot.playback.autoplay.is_none(),
        "back to the plain ended state"
    );
    assert!(snapshot.preferences.autoplay, "the preference is kept");

    // The cancel was a Change, so the count is reset and this is not held again.
    let on = dispatch(
        &mut fixture,
        serde_json::json!({ "type": "set_autoplay", "autoplay": true }),
    );
    assert!(is_counting_down(&on.snapshots[0]));
}

#[test]
fn switching_autoplay_off_dismisses_the_hold() {
    let mut fixture = a_host();
    three_unattended_advances(&mut fixture);

    let off = dispatch(
        &mut fixture,
        serde_json::json!({ "type": "set_autoplay", "autoplay": false }),
    );

    assert!(off.snapshots[0].playback.autoplay.is_none());
    assert!(!off.snapshots[0].preferences.autoplay);
}

#[test]
fn stop_playback_dismisses_the_hold() {
    let mut fixture = a_host();
    three_unattended_advances(&mut fixture);

    let stopped = dispatch(&mut fixture, serde_json::json!({ "type": "stop_playback" }));

    assert!(stopped.snapshots[0].playback.autoplay.is_none());
}
