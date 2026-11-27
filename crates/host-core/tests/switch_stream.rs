//! Switching Streams mid-playback (`switch_stream`, ADR-0044 §3).
//!
//! Driven through the Action surface and the Host's fakes: `FixturePlayer`,
//! `FixturePreviewer`, `FixtureTorrentEngine`, `FixtureClock`, and
//! `InMemoryStore`. Covers the happy path, resuming from paused, `HandPick`
//! preservation, synchronous refusals leaving Now playing untouched, and
//! asynchronous open failures preserving `now_playing` and `WatchProgress` at
//! the saved Playback position.

use std::sync::Arc;

use host_core::{
    Action, ActionError, AddonProvider, Control, FixtureClock, FixtureFetcher, FixturePlayer,
    FixturePreviewer, FixtureTorrentEngine, Host, InMemorySecretStore, InMemoryStore, InfoHash,
    Observation, Playback, PlaybackError, PlaybackState, Previewer, SecretBackend, Store, Stream,
    Telling, Track, TrackId, TrackKind, ACTION_VERSION,
};

const SERIES_ID: &str = "org.example.series";
const OTHER_ADDON: &str = "org.example.other";
const FIRST_URL: &str = "https://stream.example.org/v/tt0903747-1-1-1080p?token=SECRET1";
const SECOND_URL: &str = "https://stream.example.org/v/tt0903747-1-1-4k?token=SECRET2";
const HASH_ONE: &str = "61065ea115b7cc3e8db9fb5ab1f6f327f08bd1c9";
const HASH_TWO: &str = "c12fe1c06bba254a9dc9f519b335aa7c1367a88a";

fn action(body: &serde_json::Value) -> Action {
    let envelope = format!(r#"{{"version":{ACTION_VERSION},"action":{body}}}"#);
    Action::parse(&envelope).unwrap_or_else(|error| panic!("{envelope} should parse: {error}"))
}

fn direct_stream(name: &str, url: &str, binge_group: Option<&str>) -> serde_json::Value {
    serde_json::json!({
        "name": name,
        "description": format!("{name} release"),
        "playback": { "kind": "direct", "url": url },
        "warnings": [],
        "filename": format!("{name}.mkv"),
        "bingeGroup": binge_group,
    })
}

fn torrent_stream(name: &str, info_hash: &str, file_idx: Option<u32>) -> serde_json::Value {
    let stream = Stream {
        name: Some(name.to_owned()),
        description: Some(format!("{name} torrent")),
        playback: Playback::Torrent {
            info_hash: InfoHash::parse(info_hash).expect("a valid infoHash"),
            file_idx,
            sources: vec!["tracker:udp://tracker.example.org:1337".to_owned()],
        },
        warnings: Vec::new(),
        filename: Some(format!("{name}.mkv")),
        binge_group: Some(format!("bg|{name}")),
    };
    serde_json::to_value(stream).expect("a Stream serializes")
}

fn play_episode_action(stream: serde_json::Value) -> Action {
    action(&serde_json::json!({
        "type": "play_stream",
        "video": { "type": "series", "id": "tt0903747:1:1" },
        "addon": SERIES_ID,
        "title": {
            "addon": SERIES_ID,
            "id": "tt0903747",
            "type": "series",
            "name": "Breaking Bad",
            "poster": "https://images.example.org/bb.jpg",
        },
        "stream": stream,
    }))
}

fn switch_action(addon: &str, stream: serde_json::Value) -> Action {
    action(&serde_json::json!({
        "type": "switch_stream",
        "addon": addon,
        "stream": stream,
    }))
}

fn track(id: i64, kind: TrackKind, language: Option<&str>, selected: bool) -> Track {
    Track {
        id: TrackId(id),
        kind,
        language: language.map(str::to_owned),
        title: None,
        codec: Some("x".to_owned()),
        embedded: true,
        selected,
        default: false,
        forced: false,
        hearing_impaired: false,
    }
}

struct Fixture {
    host: Host,
    player: Arc<FixturePlayer>,
    previewer: Arc<FixturePreviewer>,
    engine: Arc<FixtureTorrentEngine>,
    store: Arc<InMemoryStore>,
    clock: Arc<FixtureClock>,
}

fn fixture_with_engine(engine: FixtureTorrentEngine) -> Fixture {
    let player = Arc::new(FixturePlayer::new());
    let previewer = Arc::new(FixturePreviewer::new());
    let engine = Arc::new(engine);
    let store = Arc::new(InMemoryStore::new());
    let clock = Arc::new(FixtureClock::new());
    let fetcher = Arc::new(FixtureFetcher::new());
    let provider = Arc::new(AddonProvider::new(fetcher.clone()));
    let host = Host::new(
        store.clone() as Arc<dyn Store>,
        fetcher,
        Arc::new(InMemorySecretStore::backed_by(SecretBackend::Keyring)),
        provider,
        player.clone(),
        clock.clone(),
    )
    .expect("a Host starts")
    .with_previewer(previewer.clone() as Arc<dyn Previewer>)
    .with_torrent_engine(engine.clone());

    Fixture {
        host,
        player,
        previewer,
        engine,
        store,
        clock,
    }
}

fn fixture() -> Fixture {
    fixture_with_engine(FixtureTorrentEngine::new())
}

fn start_playing(fixture: &mut Fixture, stream: serde_json::Value, position: f64) {
    fixture
        .host
        .dispatch(play_episode_action(stream))
        .expect("starting playback works");
    fixture
        .player
        .now_reporting(Observation::playing(position, 2820.0));
    fixture.host.sample().expect("first report is published");
}

#[test]
fn switching_a_stream_opens_the_replacement_at_the_current_position_and_updates_now_playing() {
    let mut fixture = fixture();
    start_playing(
        &mut fixture,
        direct_stream("1080p", FIRST_URL, Some("bg|1080p")),
        140.0,
    );

    // Move playback by 3.5 s — below PROGRESS_EVERY (5 s), so WatchProgress in
    // the store still holds 140.0 while the session's Playback position is 143.5.
    fixture
        .player
        .now_reporting(Observation::playing(143.5, 2820.0));
    assert_eq!(fixture.host.sample(), None);

    let published = fixture
        .host
        .dispatch(switch_action(
            OTHER_ADDON,
            direct_stream("4K HDR", SECOND_URL, Some("bg|4k")),
        ))
        .expect("switching Stream succeeds")
        .snapshots;

    assert_eq!(published.len(), 1);
    let snapshot = &published[0];
    assert_eq!(snapshot.playback.state, PlaybackState::Opening);
    assert_eq!(snapshot.playback.failure, None);

    let now_playing = snapshot
        .playback
        .now_playing
        .as_ref()
        .expect("Now playing carries the replacement candidate");
    assert_eq!(now_playing.video.r#type, "series");
    assert_eq!(now_playing.video.id, "tt0903747:1:1");
    assert_eq!(now_playing.addon.as_str(), OTHER_ADDON);
    assert_eq!(now_playing.name.as_deref(), Some("4K HDR"));
    assert_eq!(now_playing.binge_group.as_deref(), Some("bg|4k"));

    // The replacement opens at the active Playback position (143.5), not at 0
    // and not at the stale flushed WatchProgress (140.0).
    assert_eq!(
        fixture.player.openings(),
        vec![
            (FIRST_URL.to_owned(), None),
            (SECOND_URL.to_owned(), Some(143.5)),
        ]
    );

    // WatchProgress records the saved position and preserves the TitleStub & duration.
    let saved = fixture
        .store
        .read_watch_progress()
        .expect("store reads")
        .into_iter()
        .find(|entry| entry.video.id == "tt0903747:1:1")
        .expect("WatchProgress is recorded for the active Video");
    assert_eq!(saved.position, Some(143.5));
    assert_eq!(saved.duration, Some(2820.0));
    assert_eq!(saved.title.id(), "tt0903747");
    assert_eq!(saved.title.name(), "Breaking Bad");
    assert_eq!(
        saved.stream_addon.as_ref().map(|id| id.as_str()),
        Some(OTHER_ADDON)
    );
    assert_eq!(saved.binge_group.as_deref(), Some("bg|4k"));

    // Stream URLs never leak into Snapshots.
    let wire = serde_json::to_string(snapshot).expect("Snapshot serializes");
    assert!(!wire.contains("SECRET2") && !wire.contains(SECOND_URL));
}

#[test]
fn switching_while_paused_resumes_playback_at_the_paused_position() {
    let mut fixture = fixture();
    start_playing(
        &mut fixture,
        direct_stream("1080p", FIRST_URL, None),
        210.25,
    );

    fixture
        .host
        .dispatch(action(&serde_json::json!({
            "type": "set_paused",
            "paused": true,
        })))
        .expect("pausing works");
    assert_eq!(
        fixture.host.snapshot().playback.state,
        PlaybackState::Paused
    );
    fixture.player.forget();

    let switched = fixture
        .host
        .dispatch(switch_action(
            OTHER_ADDON,
            direct_stream("4K", SECOND_URL, None),
        ))
        .expect("switching while paused works");

    assert_eq!(
        switched.snapshots[0].playback.state,
        PlaybackState::Opening,
        "switching moves out of Paused into Opening"
    );
    assert_eq!(
        fixture.player.openings(),
        vec![(SECOND_URL.to_owned(), Some(210.25))]
    );
    assert!(
        !fixture.player.tellings().contains(&Telling::Pause(true)),
        "Host must not re-pause the replacement Stream"
    );

    fixture
        .player
        .now_reporting(Observation::playing(210.25, 2820.0));
    let playing = fixture.host.sample().expect("replacement starts playing");
    assert_eq!(playing.playback.state, PlaybackState::Playing);
    assert_eq!(playing.playback.position, Some(210.25));
}

#[test]
fn switching_preserves_the_titles_hand_pick_for_audio_and_subtitles() {
    let mut fixture = fixture();
    fixture
        .host
        .dispatch(play_episode_action(direct_stream("1080p", FIRST_URL, None)))
        .expect("play starts");

    // Stream 1 carries English (default) and Japanese audio, English (default)
    // and French subtitles.
    fixture.player.now_reporting(Observation {
        state: PlaybackState::Playing,
        position: Some(90.0),
        duration: Some(2820.0),
        tracks: Some(vec![
            track(1, TrackKind::Audio, Some("eng"), true),
            track(2, TrackKind::Audio, Some("jpn"), false),
            Track {
                default: true,
                ..track(3, TrackKind::Subtitle, Some("eng"), true)
            },
            track(4, TrackKind::Subtitle, Some("fra"), false),
        ]),
        ..Observation::idle()
    });
    fixture.host.sample().expect("tracks reported");

    // Owner picks Japanese audio and French subtitles by hand.
    fixture
        .host
        .dispatch(action(
            &serde_json::json!({ "type": "set_audio_track", "track": 2 }),
        ))
        .expect("audio pick works");
    fixture
        .host
        .dispatch(action(
            &serde_json::json!({ "type": "set_subtitle_track", "track": 4 }),
        ))
        .expect("subtitle pick works");
    fixture.player.forget();

    // Switch to Stream 2, whose tracks have completely different track IDs
    // (Japanese audio is #11, French subtitle is #22).
    fixture
        .host
        .dispatch(switch_action(
            OTHER_ADDON,
            direct_stream("4K", SECOND_URL, None),
        ))
        .expect("switch succeeds");

    fixture.player.now_reporting(Observation {
        state: PlaybackState::Playing,
        position: Some(90.0),
        duration: Some(2820.0),
        tracks: Some(vec![
            track(10, TrackKind::Audio, Some("eng"), true),
            track(11, TrackKind::Audio, Some("jpn"), false),
            Track {
                default: true,
                ..track(20, TrackKind::Subtitle, Some("eng"), true)
            },
            track(22, TrackKind::Subtitle, Some("fra"), false),
        ]),
        ..Observation::idle()
    });
    fixture.host.sample().expect("replacement tracks reported");

    assert_eq!(
        fixture.player.tellings(),
        vec![
            Telling::AudioTrack(TrackId(11)),
            Telling::SubtitleTrack(Some(TrackId(22))),
        ],
        "same-Title switch preserves HandPick and re-applies both audio and subtitle picks"
    );

    // Turning subtitles off by hand is also preserved across a second switch.
    fixture
        .host
        .dispatch(action(
            &serde_json::json!({ "type": "set_subtitle_track", "track": null }),
        ))
        .expect("turning subtitles off works");
    fixture.player.forget();

    fixture
        .host
        .dispatch(switch_action(
            SERIES_ID,
            direct_stream("720p", FIRST_URL, None),
        ))
        .expect("second switch succeeds");

    fixture.player.now_reporting(Observation {
        state: PlaybackState::Playing,
        position: Some(90.0),
        duration: Some(2820.0),
        tracks: Some(vec![
            track(1, TrackKind::Audio, Some("jpn"), true),
            Track {
                forced: true,
                ..track(3, TrackKind::Subtitle, Some("eng"), true)
            },
        ]),
        ..Observation::idle()
    });
    fixture.host.sample().expect("second replacement tracks");

    assert_eq!(
        fixture.player.tellings(),
        vec![Telling::SubtitleTrack(None)],
        "HandPick 'off' survives switch_stream too"
    );
}

#[test]
fn switching_with_nothing_playing_is_refused_and_leaves_state_untouched() {
    let mut fixture = fixture();
    let before = fixture.host.snapshot();

    // 1. Fresh Idle Host.
    let refused = fixture.host.dispatch(switch_action(
        OTHER_ADDON,
        direct_stream("4K", SECOND_URL, None),
    ));
    assert_eq!(
        refused,
        Err(ActionError::NothingPlaying {
            control: Control::SwitchStream
        })
    );
    assert_eq!(fixture.host.snapshot(), before);
    assert!(fixture.player.opened().is_empty());

    // 2. Stopped (Idle) Host.
    start_playing(&mut fixture, direct_stream("1080p", FIRST_URL, None), 50.0);
    fixture
        .host
        .dispatch(action(&serde_json::json!({ "type": "stop_playback" })))
        .expect("stop works");
    let after_stop = fixture.host.snapshot();
    let refused = fixture.host.dispatch(switch_action(
        OTHER_ADDON,
        direct_stream("4K", SECOND_URL, None),
    ));
    assert_eq!(
        refused,
        Err(ActionError::NothingPlaying {
            control: Control::SwitchStream
        })
    );
    assert_eq!(fixture.host.snapshot(), after_stop);

    // 3. Ended Stream.
    start_playing(&mut fixture, direct_stream("1080p", FIRST_URL, None), 50.0);
    fixture.player.now_reporting(Observation {
        state: PlaybackState::Ended,
        position: Some(2820.0),
        duration: Some(2820.0),
        ..Observation::idle()
    });
    fixture.host.sample().expect("ended");
    let after_end = fixture.host.snapshot();
    let refused = fixture.host.dispatch(switch_action(
        OTHER_ADDON,
        direct_stream("4K", SECOND_URL, None),
    ));
    assert_eq!(
        refused,
        Err(ActionError::NothingPlaying {
            control: Control::SwitchStream
        })
    );
    assert_eq!(fixture.host.snapshot(), after_end);
}

#[test]
fn switching_after_a_failed_open_opens_the_replacement_at_the_saved_position() {
    let mut fixture = fixture();
    start_playing(&mut fixture, direct_stream("1080p", FIRST_URL, None), 50.0);
    fixture.player.now_reporting(Observation {
        state: PlaybackState::Idle,
        failure: Some("That Stream could not be opened — mpv could not load it.".to_owned()),
        ..Observation::idle()
    });
    fixture.host.sample().expect("failed open");

    let switched = fixture
        .host
        .dispatch(switch_action(
            OTHER_ADDON,
            direct_stream("4K", SECOND_URL, None),
        ))
        .expect("picking another Stream after a failed open works");

    let playback = &switched.snapshots[0].playback;
    assert_eq!(playback.state, PlaybackState::Opening);
    assert_eq!(playback.failure, None);
    assert_eq!(
        fixture.player.openings().last(),
        Some(&(SECOND_URL.to_owned(), Some(50.0)))
    );
    let saved = fixture.store.read_watch_progress().expect("store reads");
    assert_eq!(saved[0].position, Some(50.0));
}

#[test]
fn switching_keeps_a_watched_video_watched_and_a_fresh_play_does_not() {
    let mut fixture = fixture();
    start_playing(
        &mut fixture,
        direct_stream("1080p", FIRST_URL, None),
        2815.0,
    );
    // Rewound after reaching the tail: the Video stays watched.
    fixture
        .player
        .now_reporting(Observation::playing(100.0, 2820.0));
    fixture.host.sample();

    let switched = fixture
        .host
        .dispatch(switch_action(
            OTHER_ADDON,
            direct_stream("4K", SECOND_URL, None),
        ))
        .expect("switch succeeds");

    assert!(switched.snapshots[0].watch_progress[0].watched);
    let saved = fixture.store.read_watch_progress().expect("store reads");
    assert!(saved[0].watched, "a switch carries the same viewing on");
    assert_eq!(saved[0].position, Some(100.0));

    fixture
        .host
        .dispatch(play_episode_action(direct_stream("1080p", FIRST_URL, None)))
        .expect("play starts");
    let saved = fixture.store.read_watch_progress().expect("store reads");
    assert!(!saved[0].watched, "a fresh play starts the Video over");
}

#[test]
fn synchronous_refusals_leave_now_playing_pause_state_torrent_and_watch_progress_untouched() {
    let mut fixture = fixture();
    start_playing(
        &mut fixture,
        torrent_stream("Torrent 1080p", HASH_ONE, Some(0)),
        320.0,
    );
    fixture
        .host
        .dispatch(action(&serde_json::json!({
            "type": "set_paused",
            "paused": true,
        })))
        .expect("pause works");
    let before = fixture.host.snapshot();
    let watch_before = fixture.store.read_watch_progress().expect("store reads");

    // 1. Validation refusal (invalid Stream URL).
    let bad_url = fixture.host.dispatch(switch_action(
        OTHER_ADDON,
        direct_stream("Bad", "file:///etc/passwd", None),
    ));
    assert!(matches!(bad_url, Err(ActionError::Unplayable(_))));
    assert_eq!(fixture.host.snapshot(), before);
    assert_eq!(
        fixture.store.read_watch_progress().expect("store reads"),
        watch_before
    );
    assert!(fixture.engine.let_gos().is_empty());

    // 2. Validation refusal (invalid Addon id).
    let bad_addon = fixture.host.dispatch(switch_action(
        "bad addon id",
        direct_stream("4K", SECOND_URL, None),
    ));
    assert!(matches!(bad_addon, Err(ActionError::InvalidAddonId(_))));
    assert_eq!(fixture.host.snapshot(), before);

    // 3. Synchronous TorrentEngine::serve refusal.
    fixture.engine.refuse("The torrent engine is busy.");
    let refused_serve = fixture.host.dispatch(switch_action(
        OTHER_ADDON,
        torrent_stream("Torrent 4K", HASH_TWO, Some(1)),
    ));
    assert_eq!(
        refused_serve,
        Err(ActionError::Playback {
            detail: "The torrent engine is busy.".to_owned()
        })
    );
    assert_eq!(
        fixture.host.snapshot(),
        before,
        "Now playing and Paused state stay untouched after sync serve refusal"
    );
    assert_eq!(
        fixture.store.read_watch_progress().expect("store reads"),
        watch_before,
        "WatchProgress stays untouched after sync serve refusal"
    );
    assert!(
        fixture.engine.let_gos().is_empty(),
        "held torrent is not let go when replacement serve fails"
    );

    // 4. Synchronous Player::open refusal.
    fixture.player.now_refusing(PlaybackError::Open {
        detail: "mpv refused replace".to_owned(),
    });
    let refused_open = fixture.host.dispatch(switch_action(
        OTHER_ADDON,
        direct_stream("4K", SECOND_URL, None),
    ));
    assert!(matches!(refused_open, Err(ActionError::Playback { .. })));
    assert_eq!(fixture.host.snapshot(), before);
    assert_eq!(
        fixture.store.read_watch_progress().expect("store reads"),
        watch_before
    );
    assert!(fixture.engine.let_gos().is_empty());
}

#[test]
fn asynchronous_open_failure_transitions_to_idle_with_failure_and_preserves_watch_progress_and_now_playing(
) {
    let mut fixture = fixture();
    start_playing(
        &mut fixture,
        direct_stream("1080p", FIRST_URL, Some("bg|1080p")),
        412.5,
    );
    // Advance slightly without triggering periodic write (delta < 5 s) so the
    // saved position must come from the session's current Playback position.
    fixture
        .player
        .now_reporting(Observation::playing(415.0, 2820.0));
    assert_eq!(fixture.host.sample(), None);

    // Switch succeeds synchronously (loadfile replace sent at 415.0).
    let opening = fixture
        .host
        .dispatch(switch_action(
            OTHER_ADDON,
            direct_stream("4K Broken", SECOND_URL, Some("bg|4k")),
        ))
        .expect("replacement open is accepted");
    assert_eq!(opening.snapshots[0].playback.state, PlaybackState::Opening);
    assert_eq!(
        fixture.player.openings().last(),
        Some(&(SECOND_URL.to_owned(), Some(415.0)))
    );

    // Replacement fails asynchronously in the Player.
    fixture.player.now_reporting(Observation {
        state: PlaybackState::Idle,
        failure: Some("That Stream could not be opened — mpv could not load it.".to_owned()),
        ..Observation::idle()
    });
    let failed = fixture
        .host
        .sample()
        .expect("async open failure publishes a Snapshot");

    assert_eq!(failed.playback.state, PlaybackState::Idle);
    assert_eq!(
        failed.playback.failure.as_deref(),
        Some("That Stream could not be opened — mpv could not load it.")
    );
    let now_playing = failed
        .playback
        .now_playing
        .as_ref()
        .expect("now_playing stays set after async open failure");
    assert_eq!(now_playing.addon.as_str(), OTHER_ADDON);
    assert_eq!(now_playing.name.as_deref(), Some("4K Broken"));
    assert_eq!(now_playing.video.id, "tt0903747:1:1");

    // WatchProgress preserves the owner's place (415.0) in both Snapshot and Store.
    let progress = failed
        .watch_progress
        .iter()
        .find(|entry| entry.video.id == "tt0903747:1:1")
        .expect("WatchProgress entry is present");
    assert_eq!(progress.position, Some(415.0));
    assert_eq!(progress.duration, Some(2820.0));

    let stored = fixture
        .store
        .read_watch_progress()
        .expect("store reads")
        .into_iter()
        .find(|entry| entry.video.id == "tt0903747:1:1")
        .expect("stored WatchProgress entry is present");
    assert_eq!(stored.position, Some(415.0));
    assert_eq!(stored.duration, Some(2820.0));

    // The owner picks another Stream without losing their place.
    let third = "https://stream.example.org/v/tt0903747-1-1-720p.mkv";
    let retried = fixture
        .host
        .dispatch(switch_action(SERIES_ID, direct_stream("720p", third, None)))
        .expect("switching after the failure works");

    assert_eq!(retried.snapshots[0].playback.state, PlaybackState::Opening);
    assert_eq!(retried.snapshots[0].playback.failure, None);
    assert_eq!(
        fixture.player.openings().last(),
        Some(&(third.to_owned(), Some(415.0)))
    );
    let stored = fixture.store.read_watch_progress().expect("store reads");
    assert_eq!(stored[0].position, Some(415.0));
    assert_eq!(stored[0].duration, Some(2820.0));
}

#[test]
fn switching_while_still_opening_after_another_switch_preserves_the_saved_position() {
    let mut fixture = fixture();
    start_playing(&mut fixture, direct_stream("1080p", FIRST_URL, None), 500.0);

    // First switch moves to Opening with position = None in session, 500.0 in WatchProgress.
    fixture
        .host
        .dispatch(switch_action(
            OTHER_ADDON,
            direct_stream("4K slow", SECOND_URL, None),
        ))
        .expect("first switch succeeds");
    assert_eq!(
        fixture.host.snapshot().playback.state,
        PlaybackState::Opening
    );
    assert_eq!(fixture.host.snapshot().playback.position, None);

    // Owner picks a third Stream before the second one finishes opening.
    let third = "https://stream.example.org/v/tt0903747-1-1-720p.mkv";
    fixture
        .host
        .dispatch(switch_action(
            SERIES_ID,
            direct_stream("720p fast", third, None),
        ))
        .expect("second switch while Opening succeeds");

    assert_eq!(
        fixture.player.openings().last(),
        Some(&(third.to_owned(), Some(500.0))),
        "switching while Opening keeps the saved start position instead of restarting at 0"
    );
}

#[test]
fn switching_between_torrent_and_direct_manages_held_torrents_and_preview() {
    let mut fixture = fixture();
    start_playing(&mut fixture, direct_stream("1080p", FIRST_URL, None), 100.0);
    assert_eq!(fixture.previewer.armings(), vec![FIRST_URL.to_owned()]);

    // Direct -> Torrent: serves torrent, disarms preview, opens loopback URL at 100.0.
    fixture
        .host
        .dispatch(switch_action(
            OTHER_ADDON,
            torrent_stream("Torrent 1080p", HASH_ONE, Some(0)),
        ))
        .expect("direct to torrent switch works");
    assert_eq!(fixture.engine.serves().len(), 1);
    assert_eq!(
        fixture.engine.serves()[0].info_hash,
        InfoHash::parse(HASH_ONE).unwrap()
    );
    assert_eq!(fixture.player.openings().last().unwrap().1, Some(100.0));
    assert_eq!(fixture.previewer.disarms(), 1);

    // Torrent -> Direct: lets go of HASH_ONE, arms preview for SECOND_URL.
    fixture.clock.tick(1_000);
    fixture
        .player
        .now_reporting(Observation::playing(125.0, 2820.0));
    fixture.host.sample();

    fixture
        .host
        .dispatch(switch_action(
            SERIES_ID,
            direct_stream("4K direct", SECOND_URL, None),
        ))
        .expect("torrent to direct switch works");
    assert_eq!(
        fixture.engine.let_gos(),
        vec![InfoHash::parse(HASH_ONE).unwrap()]
    );
    assert_eq!(
        fixture.player.openings().last(),
        Some(&(SECOND_URL.to_owned(), Some(125.0)))
    );
    assert_eq!(
        fixture.previewer.armings(),
        vec![FIRST_URL.to_owned(), SECOND_URL.to_owned()]
    );
}
