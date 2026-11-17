//! Playing a Title's Up next, driven the way a client drives it: an Action in,
//! published Snapshots out, and the URL the Player was asked to open. The Video
//! is the Host's own Continue watching entry, and the Stream continues the
//! Addon and release of the Video before it (ADR-0012, ADR-0014, ADR-0039).
//! Nothing below the Action surface is named here, and no test reaches the
//! network.

use std::sync::Arc;

use host_core::{
    Action, ActionError, FixtureClock, FixtureFetcher, FixturePlayer, FixtureProvider, Host,
    InMemorySecretStore, InMemoryStore, Observation, Playback, PlaybackState, SecretBackend,
    Snapshot, Store, Stream, UpNextPlayback, ACTION_VERSION,
};

/// The Addon that answers both `meta` and `stream` for the series.
const SERIES: &str = "https://series.example.org/manifest.json";
const SERIES_ID: &str = "org.example.series";
const META_URL: &str = "https://series.example.org/meta/series/tt0903747.json";
const SERIES_META: &str = include_str!("fixtures/cinemeta-meta-series.json");

/// The URL the finished episode was played from, and two candidates for its Up
/// next: a different release first, the same release second.
const PLAYING: &str = "https://stream.example.org/v/tt0903747-1-1.mkv";
const OTHER_RELEASE: &str = "https://stream.example.org/v/tt0903747-1-2-720p.mkv";
const SAME_RELEASE: &str = "https://stream.example.org/v/tt0903747-1-2-1080p.mkv";

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

/// A candidate an Addon answers with: a direct URL, a name and a release group.
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

/// A candidate whose bytes are a torrent: listed, and not one this Host plays.
fn torrent(name: &str, info_hash: &str, binge_group: Option<&str>) -> Stream {
    Stream {
        name: Some(name.to_owned()),
        description: None,
        playback: Playback::InfoHash {
            info_hash: info_hash.to_owned(),
        },
        warnings: Vec::new(),
        filename: None,
        binge_group: binge_group.map(str::to_owned),
    }
}

struct Fixture {
    host: Host,
    player: Arc<FixturePlayer>,
    provider: Arc<FixtureProvider>,
    store: Arc<InMemoryStore>,
}

/// A Host over the store, with the one Addon configured and these candidates
/// offered for every Video.
fn fixture_over(store: Arc<InMemoryStore>, candidates: Vec<Stream>) -> Fixture {
    let player = Arc::new(FixturePlayer::new());
    let provider = Arc::new(FixtureProvider::new().offering(SERIES_ID, candidates));
    let fetcher = FixtureFetcher::new()
        .serving(SERIES, manifest())
        .serving(META_URL, SERIES_META);
    let clock = Arc::new(FixtureClock::new());

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
    }
}

fn fixture() -> Fixture {
    fixture_over(
        Arc::new(InMemoryStore::new()),
        vec![
            candidate("720p", OTHER_RELEASE, Some("another-release")),
            candidate("1080p", SAME_RELEASE, Some("the-release")),
        ],
    )
}

/// A Host restarted over the same store, with the same candidates: a restart is
/// a second Host over the store the first one wrote.
fn restarted(store: Arc<InMemoryStore>) -> Fixture {
    let player = Arc::new(FixturePlayer::new());
    let provider = Arc::new(FixtureProvider::new().offering(
        SERIES_ID,
        vec![
            candidate("720p", OTHER_RELEASE, Some("another-release")),
            candidate("1080p", SAME_RELEASE, Some("the-release")),
        ],
    ));
    let fetcher = FixtureFetcher::new()
        .serving(SERIES, manifest())
        .serving(META_URL, SERIES_META);

    let host = Host::new(
        store.clone() as Arc<dyn Store>,
        Arc::new(fetcher),
        Arc::new(InMemorySecretStore::backed_by(SecretBackend::Keyring)),
        provider.clone(),
        player.clone(),
        Arc::new(FixtureClock::new().at(FixtureClock::TODAY + 1_000)),
    )
    .expect("a Host over the same store starts again");

    Fixture {
        host,
        player,
        provider,
        store,
    }
}

/// Open the series the way a client does, so the Host caches its Videos: Up
/// next is worked out from the cache (ADR-0038).
fn open_series(fixture: &mut Fixture) {
    fixture
        .host
        .dispatch(action(&serde_json::json!({
            "type": "open_title",
            "addon": SERIES_ID,
            "title": { "type": "series", "id": "tt0903747" },
        })))
        .expect("the recorded series opens");
}

/// Choose a direct candidate to be playing, with the release its Addon grouped
/// it by.
fn play(fixture: &mut Fixture, video: &str, url: &str, binge_group: Option<&str>) {
    let mut stream = serde_json::json!({
        "name": "1080p",
        "playback": { "kind": "direct", "url": url },
        "warnings": [],
    });
    if let Some(binge_group) = binge_group {
        stream["bingeGroup"] = serde_json::Value::String(binge_group.to_owned());
    }

    fixture
        .host
        .dispatch(action(&serde_json::json!({
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
            "stream": stream,
        })))
        .unwrap_or_else(|error| panic!("playing a direct candidate should work: {error}"));
}

/// The Player reports the Video at its end, and the Host folds that into Watch
/// progress: the card has an Up next afterwards.
fn finished(fixture: &mut Fixture) -> Snapshot {
    fixture.player.now_reporting(Observation {
        state: PlaybackState::Ended,
        position: Some(2820.0),
        duration: Some(2820.0),
        ..Observation::idle()
    });
    fixture.host.sample().expect("reaching the end is a change")
}

fn play_up_next() -> Action {
    action(&serde_json::json!({
        "type": "play_up_next",
        "title": { "type": "series", "id": "tt0903747" },
    }))
}

#[test]
fn playing_an_up_next_continues_the_addon_and_release_of_the_video_before_it() {
    let mut fixture = fixture();
    open_series(&mut fixture);
    play(&mut fixture, "tt0903747:1:1", PLAYING, Some("the-release"));
    let ended = finished(&mut fixture);
    assert!(
        ended.playback.autoplay.is_some(),
        "Autoplay is on by default: the finished episode is counting down to its Up next"
    );
    let asked_before = fixture.provider.asked().len();

    let published = fixture
        .host
        .dispatch(play_up_next())
        .expect("a finished episode has an Up next to play");

    assert_eq!(
        fixture.player.opened(),
        vec![PLAYING.to_owned(), SAME_RELEASE.to_owned()],
        "the same release is preferred over an earlier candidate, so the binge continues"
    );
    assert_eq!(
        fixture.provider.asked()[asked_before..].to_vec(),
        vec![SERIES_ID.to_owned()],
        "the Addon that streamed the previous Video is the one asked"
    );
    assert_eq!(
        published.snapshots[0]
            .playback
            .now_playing
            .as_ref()
            .map(|now| (
                now.video.id.as_str(),
                now.addon.as_str(),
                now.binge_group.as_deref()
            )),
        Some(("tt0903747:1:2", SERIES_ID, Some("the-release"))),
        "every client is told of the new Now playing, and no URL is in it"
    );
    assert!(
        published.snapshots[0].playback.autoplay.is_none(),
        "playing the Up next by hand is the play the countdown was waiting for"
    );
}

#[test]
fn when_the_release_is_gone_the_same_addons_first_playable_candidate_plays() {
    let mut fixture = fixture_over(
        Arc::new(InMemoryStore::new()),
        vec![
            torrent(
                "a torrent",
                "61065ea115b7cc3e8db9fb5ab1f6f327f08bd1c9",
                Some("the-release"),
            ),
            candidate("720p", OTHER_RELEASE, Some("another-release")),
        ],
    );
    open_series(&mut fixture);
    play(&mut fixture, "tt0903747:1:1", PLAYING, Some("the-release"));
    finished(&mut fixture);

    fixture
        .host
        .dispatch(play_up_next())
        .expect("the same Addon's first playable candidate is the fallback");

    assert_eq!(
        fixture.player.opened(),
        vec![PLAYING.to_owned(), OTHER_RELEASE.to_owned()],
        "an unplayable candidate for the same release is skipped, and the next playable one plays"
    );
}

#[test]
fn playing_an_up_next_records_watch_progress_like_any_other_play() {
    let mut fixture = fixture();
    open_series(&mut fixture);
    play(&mut fixture, "tt0903747:1:1", PLAYING, Some("the-release"));
    finished(&mut fixture);

    fixture
        .host
        .dispatch(play_up_next())
        .expect("a finished episode has an Up next to play");

    let entry = fixture
        .host
        .snapshot()
        .watch_progress
        .into_iter()
        .find(|entry| entry.video.id == "tt0903747:1:2")
        .expect("the Up next is recorded as a Video with progress");
    assert_eq!(entry.position, None, "a play starts at the beginning");
    assert!(!entry.watched);
}

#[test]
fn the_continuity_of_an_up_next_survives_a_restart() {
    let mut fixture = fixture();
    open_series(&mut fixture);
    play(&mut fixture, "tt0903747:1:1", PLAYING, Some("the-release"));
    finished(&mut fixture);

    // The Addon and the release are stored with the finished Video, so a Host
    // that comes back over the same store still knows what to continue.
    let mut after = restarted(fixture.store.clone());

    after
        .host
        .dispatch(play_up_next())
        .expect("a restarted Host still has an Up next to play");

    assert_eq!(
        after.player.opened(),
        vec![SAME_RELEASE.to_owned()],
        "the same Addon and bingeGroup are read back from the store"
    );
}

#[test]
fn a_title_with_no_up_next_is_refused() {
    let mut fixture = fixture();
    open_series(&mut fixture);

    let refused = fixture
        .host
        .dispatch(play_up_next())
        .expect_err("a Title with no Watch progress has no Up next");
    assert_eq!(refused.kind(), "no_up_next");

    // A Video still being watched is the card, not an Up next, and it has no Up
    // next to play until it finishes.
    play(&mut fixture, "tt0903747:1:1", PLAYING, Some("the-release"));
    fixture
        .player
        .now_reporting(Observation::playing(100.0, 2820.0));
    fixture.host.sample().expect("the position moved");

    let refused = fixture
        .host
        .dispatch(play_up_next())
        .expect_err("a Video still being watched has no Up next");
    assert_eq!(refused.kind(), "no_up_next");
}

#[test]
fn a_finished_last_numbered_episode_has_no_up_next_even_with_specials_listed() {
    let mut fixture = fixture();
    open_series(&mut fixture);
    // The recorded series lists a Special, and the last numbered episode still
    // has nothing after it (ADR-0039): the card leaves the row.
    play(&mut fixture, "tt0903747:2:1", PLAYING, Some("the-release"));
    finished(&mut fixture);

    let refused = fixture
        .host
        .dispatch(play_up_next())
        .expect_err("the last numbered episode has no Up next");
    assert_eq!(refused.kind(), "no_up_next");
}

#[test]
fn when_the_addon_is_gone_the_action_names_its_own_refusal() {
    let mut fixture = fixture();
    open_series(&mut fixture);
    play(&mut fixture, "tt0903747:1:1", PLAYING, Some("the-release"));
    finished(&mut fixture);
    fixture
        .host
        .dispatch(action(
            &serde_json::json!({ "type": "remove_addon", "id": SERIES_ID }),
        ))
        .expect("the Addon is removed");

    let refused = fixture
        .host
        .dispatch(play_up_next())
        .expect_err("the Addon that streamed the previous Video is gone");

    assert_eq!(
        refused.kind(),
        "no_up_next_stream",
        "the client opens the Streams picker for the Up next on this refusal"
    );
    assert!(
        fixture.player.opened().len() == 1,
        "nothing new was opened: {:?}",
        fixture.player.opened()
    );
}

#[test]
fn when_nothing_is_playable_the_action_names_its_own_refusal() {
    let mut fixture = fixture_over(
        Arc::new(InMemoryStore::new()),
        vec![torrent(
            "a torrent",
            "61065ea115b7cc3e8db9fb5ab1f6f327f08bd1c9",
            Some("the-release"),
        )],
    );
    open_series(&mut fixture);
    play(&mut fixture, "tt0903747:1:1", PLAYING, Some("the-release"));
    finished(&mut fixture);

    let refused = fixture
        .host
        .dispatch(play_up_next())
        .expect_err("the Addon offers nothing this Host can play");

    assert_eq!(refused.kind(), "no_up_next_stream");
    assert_eq!(
        fixture.player.opened(),
        vec![PLAYING.to_owned()],
        "the Up next never opened"
    );
}

#[test]
fn the_up_next_preference_is_published_and_survives_a_restart() {
    let store = Arc::new(InMemoryStore::new());
    let mut fixture = fixture_over(store.clone(), Vec::new());

    assert_eq!(
        fixture.host.snapshot().preferences.up_next_playback,
        UpNextPlayback::Direct,
        "Play is direct until the owner chooses otherwise"
    );

    let published = fixture
        .host
        .dispatch(action(&serde_json::json!({
            "type": "set_up_next_playback",
            "playback": "picker",
        })))
        .expect("setting the Up next preference should work");
    assert_eq!(
        published.snapshots[0].preferences.up_next_playback,
        UpNextPlayback::Picker
    );

    let mut after = restarted(store);
    assert_eq!(
        after.host.snapshot().preferences.up_next_playback,
        UpNextPlayback::Picker,
        "the preference is a row in the preferences table, not a client's memory"
    );

    after
        .host
        .dispatch(action(&serde_json::json!({
            "type": "set_up_next_playback",
            "playback": "direct",
        })))
        .expect("the preference can be put back");
    assert_eq!(
        after.host.snapshot().preferences.up_next_playback,
        UpNextPlayback::Direct
    );
}

#[test]
fn the_autoplay_preference_defaults_to_on_is_published_and_survives_a_restart() {
    let store = Arc::new(InMemoryStore::new());
    let mut fixture = fixture_over(store.clone(), Vec::new());

    assert!(
        fixture.host.snapshot().preferences.autoplay,
        "Autoplay is on until the owner turns it off"
    );

    let published = fixture
        .host
        .dispatch(action(&serde_json::json!({
            "type": "set_autoplay",
            "autoplay": false,
        })))
        .expect("setting Autoplay off should work");
    assert!(!published.snapshots[0].preferences.autoplay);
    assert!(!fixture.host.snapshot().preferences.autoplay);

    let mut after = restarted(store);
    assert!(
        !after.host.snapshot().preferences.autoplay,
        "the preference survives a Host restart"
    );

    let republished = after
        .host
        .dispatch(action(&serde_json::json!({
            "type": "set_autoplay",
            "autoplay": true,
        })))
        .expect("the preference can be turned back on");
    assert!(republished.snapshots[0].preferences.autoplay);
}

#[test]
fn the_up_next_actions_and_refusals_round_trip_the_wire_codec() {
    let set = action(&serde_json::json!({
        "type": "set_up_next_playback",
        "playback": "picker",
    }));
    let json = serde_json::to_value(&set).expect("an Action serializes");
    assert_eq!(
        json,
        serde_json::json!({ "type": "set_up_next_playback", "playback": "picker" })
    );
    let back: Action = serde_json::from_value(json).expect("an Action round-trips");
    assert_eq!(back, set);

    let set_autoplay = action(&serde_json::json!({
        "type": "set_autoplay",
        "autoplay": false,
    }));
    let json = serde_json::to_value(&set_autoplay).expect("an Action serializes");
    assert_eq!(
        json,
        serde_json::json!({ "type": "set_autoplay", "autoplay": false })
    );
    let back: Action = serde_json::from_value(json).expect("an Action round-trips");
    assert_eq!(back, set_autoplay);

    let play = play_up_next();
    let json = serde_json::to_value(&play).expect("an Action serializes");
    assert_eq!(
        json,
        serde_json::json!({
            "type": "play_up_next",
            "title": { "type": "series", "id": "tt0903747" },
        })
    );
    let back: Action = serde_json::from_value(json).expect("an Action round-trips");
    assert_eq!(back, play);

    for (error, kind) in [
        (
            ActionError::NoUpNext {
                detail: "the Title has none".to_owned(),
            },
            "no_up_next",
        ),
        (
            ActionError::NoUpNextStream {
                detail: "nothing playable".to_owned(),
            },
            "no_up_next_stream",
        ),
    ] {
        let json = serde_json::to_value(&error).expect("a refusal serializes");
        assert_eq!(json["kind"], kind);
        assert_eq!(json["detail"], error.to_string());
    }
}
