//! The full control set, driven the way a client drives it: an Action in, a
//! Snapshot out, and the telling the Player was given. Every control has to
//! move the Host's own record at once (ADR-0013's rule for pause and seek,
//! applied to all of them), reach the Player as one telling, and reopen
//! nothing.

use std::sync::Arc;

use host_core::{
    Action, ActionError, AddonProvider, Aspect, Chapter, ChapterStep, Control, Crop, CropRectangle,
    FixtureClock, FixtureFetcher, FixturePlayer, Host, InMemorySecretStore, InMemoryStore,
    LanguageList, Observation, PlaybackError, PlaybackState, Preferences, SecretBackend, Snapshot,
    Statistics, Store, StreamBuffer, SubtitleColor, SubtitleScale, Telling, Track, TrackId,
    TrackKind, VideoSize, ACTION_VERSION,
};

/// The URL a recorded debrid answer would carry, with a session in it.
const CHOSEN: &str = "https://stream.example.org/v/tt0133093-1080p?token=SECRETSESSION";

/// A Host over an empty store, with a Player whose other end the test holds.
struct Fixture {
    host: Host,
    player: Arc<FixturePlayer>,
}

fn fixture() -> Fixture {
    let player = Arc::new(FixturePlayer::new());
    let host = host_over(player.clone());
    // The Host states its preferences before any Stream is opened; a control
    // test watches what its own Action added.
    player.forget();
    Fixture { host, player }
}

fn host_over(player: Arc<FixturePlayer>) -> Host {
    let fetcher = Arc::new(FixtureFetcher::new());
    let provider = Arc::new(AddonProvider::new(fetcher.clone()));
    Host::new(
        Arc::new(InMemoryStore::new()) as Arc<dyn Store>,
        fetcher,
        Arc::new(InMemorySecretStore::backed_by(SecretBackend::Keyring)),
        provider,
        player,
        Arc::new(FixtureClock::new()),
    )
    .expect("a Host over a store starts")
}

/// An Action as a client sends it: the versioned envelope, as JSON text.
fn action(body: &serde_json::Value) -> Action {
    let envelope = format!(r#"{{"version":{ACTION_VERSION},"action":{body}}}"#);
    Action::parse(&envelope).unwrap_or_else(|error| panic!("{envelope} should parse: {error}"))
}

/// What a client sends when it chooses a candidate.
fn a_chosen_stream() -> serde_json::Value {
    serde_json::json!({
        "type": "play_stream",
        "video": { "type": "movie", "id": "tt0133093" },
        "addon": "community.aiostreams",
        "title": {
            "addon": "com.linvo.cinemeta",
            "id": "tt0133093",
            "type": "movie",
            "name": "The Matrix",
            "poster": "https://images.example.org/matrix.jpg",
        },
        "stream": {
            "name": "AIOStreams\n1080p",
            "playback": { "kind": "direct", "url": CHOSEN },
            "warnings": [],
        },
    })
}

/// The report a Player gives once a Stream is up: two audio tracks, one
/// subtitle track, two chapters, and every control's value as a baseline.
fn report() -> Observation {
    Observation {
        state: PlaybackState::Playing,
        position: Some(12.5),
        duration: Some(600.0),
        tracks: Some(vec![
            track(1, TrackKind::Audio, "eng", true),
            track(3, TrackKind::Audio, "por", false),
            track(2, TrackKind::Subtitle, "por", false),
        ]),
        chapters: vec![
            Chapter {
                index: 0,
                title: Some("Intro".to_owned()),
                time: 0.0,
            },
            Chapter {
                index: 1,
                title: Some("Main".to_owned()),
                time: 300.0,
            },
        ],
        chapter: Some(0),
        speed: Some(1.0),
        volume: Some(100.0),
        muted: Some(false),
        subtitle_delay: Some(0.0),
        crop: None,
        aspect: Some(Aspect::Source),
        resolution: Some(VideoSize {
            width: 128,
            height: 72,
        }),
        statistics: Some(Statistics {
            bitrate: None,
            dropped_frames: Some(0),
            hardware_decode: Some("no".to_owned()),
        }),
        ..Observation::idle()
    }
}

fn track(id: i64, kind: TrackKind, language: &str, selected: bool) -> Track {
    Track {
        id: TrackId(id),
        kind,
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

/// A Host with a Stream live and the Player having reported its full reading.
fn playing() -> Fixture {
    let mut fixture = fixture();
    fixture
        .host
        .dispatch(action(&a_chosen_stream()))
        .expect("choosing a playable candidate should work");
    fixture.player.now_reporting(report());
    fixture
        .host
        .sample()
        .expect("the Player's full report is a change");
    fixture
}

/// Every control that needs something live: one body each, as a client sends.
fn control_bodies() -> Vec<serde_json::Value> {
    vec![
        serde_json::json!({ "type": "set_paused", "paused": true }),
        serde_json::json!({ "type": "seek", "target": { "kind": "by", "seconds": 5.0 } }),
        serde_json::json!({ "type": "set_audio_track", "track": 3 }),
        serde_json::json!({ "type": "set_subtitle_track", "track": 2 }),
        serde_json::json!({ "type": "set_subtitle_track", "track": null }),
        serde_json::json!({ "type": "set_subtitle_delay", "seconds": 0.25 }),
        serde_json::json!({ "type": "set_speed", "rate": 2.0 }),
        serde_json::json!({ "type": "set_volume", "level": 50.0 }),
        serde_json::json!({ "type": "set_muted", "muted": true }),
        serde_json::json!({ "type": "next_chapter" }),
        serde_json::json!({ "type": "previous_chapter" }),
        serde_json::json!({ "type": "set_chapter", "index": 1 }),
        serde_json::json!({
            "type": "set_crop",
            "crop": { "kind": "rectangle", "width": 96, "height": 72, "x": 16, "y": 0 },
        }),
        serde_json::json!({ "type": "set_crop", "crop": { "kind": "off" } }),
        serde_json::json!({ "type": "autocrop" }),
        serde_json::json!({ "type": "set_aspect", "aspect": { "kind": "ratio", "value": 1.7778 } }),
        serde_json::json!({ "type": "set_aspect", "aspect": { "kind": "source" } }),
    ]
}

/// The control tellings the Player was given: everything but the preferences
/// the Host tells it once, at startup, from the store.
fn controls(player: &FixturePlayer) -> Vec<Telling> {
    player
        .tellings()
        .into_iter()
        .filter(|telling| {
            !matches!(
                telling,
                Telling::SubtitleLanguages(_)
                    | Telling::AudioLanguages(_)
                    | Telling::SubtitleColor(_)
                    | Telling::SubtitleScale(_)
            )
        })
        .collect()
}

/// The Snapshots one Action published.
fn published(fixture: &mut Fixture, body: &serde_json::Value) -> Vec<Snapshot> {
    fixture
        .host
        .dispatch(action(body))
        .unwrap_or_else(|error| panic!("{body} should have been taken: {error}"))
        .snapshots
}

/// Whether a track is the selected one in a published playback object.
fn selected(playback: &host_core::PlaybackSnapshot, id: i64) -> bool {
    playback
        .tracks
        .iter()
        .find(|track| track.id == TrackId(id))
        .expect("the report carried this track")
        .selected
}

#[test]
fn pausing_and_seeking_move_the_published_state_at_once() {
    let mut fixture = playing();

    let paused = published(
        &mut fixture,
        &serde_json::json!({ "type": "set_paused", "paused": true }),
    );
    assert_eq!(paused[0].playback.state, PlaybackState::Paused);

    let moved = published(
        &mut fixture,
        &serde_json::json!({ "type": "seek", "target": { "kind": "by", "seconds": 5.0 } }),
    );
    assert_eq!(moved[0].playback.position, Some(17.5));

    assert_eq!(
        controls(&fixture.player),
        vec![
            Telling::Pause(true),
            Telling::Seek(host_core::SeekTarget::By { seconds: 5.0 }),
        ]
    );
}

#[test]
fn selecting_a_track_moves_the_hosts_own_record_and_nothing_else() {
    let mut fixture = playing();

    let audio = published(
        &mut fixture,
        &serde_json::json!({ "type": "set_audio_track", "track": 3 }),
    );
    assert!(!selected(&audio[0].playback, 1), "the old track is off");
    assert!(selected(&audio[0].playback, 3), "the named track is on");

    let subtitles = published(
        &mut fixture,
        &serde_json::json!({ "type": "set_subtitle_track", "track": 2 }),
    );
    assert!(selected(&subtitles[0].playback, 2));

    let off = published(
        &mut fixture,
        &serde_json::json!({ "type": "set_subtitle_track", "track": null }),
    );
    assert!(
        !selected(&off[0].playback, 2),
        "null turns the subtitles off"
    );

    assert_eq!(
        controls(&fixture.player),
        vec![
            Telling::AudioTrack(TrackId(3)),
            Telling::SubtitleTrack(Some(TrackId(2))),
            Telling::SubtitleTrack(None),
        ]
    );
}

#[test]
fn the_players_numbers_move_the_hosts_own_record() {
    let mut fixture = playing();

    let sped = published(
        &mut fixture,
        &serde_json::json!({ "type": "set_speed", "rate": 2.0 }),
    );
    assert_eq!(sped[0].playback.speed, Some(2.0));

    let louder = published(
        &mut fixture,
        &serde_json::json!({ "type": "set_volume", "level": 50.0 }),
    );
    assert_eq!(louder[0].playback.volume, Some(50.0));

    let quiet = published(
        &mut fixture,
        &serde_json::json!({ "type": "set_muted", "muted": true }),
    );
    assert_eq!(quiet[0].playback.muted, Some(true));

    let shifted = published(
        &mut fixture,
        &serde_json::json!({ "type": "set_subtitle_delay", "seconds": 0.25 }),
    );
    assert_eq!(shifted[0].playback.subtitle_delay, Some(0.25));

    assert_eq!(
        controls(&fixture.player),
        vec![
            Telling::Speed { rate: 2.0 },
            Telling::Volume { level: 50.0 },
            Telling::Muted(true),
            Telling::SubtitleDelay { seconds: 0.25 },
        ]
    );
}

#[test]
fn chapter_moves_are_clamped_to_the_list_the_player_reported() {
    let mut fixture = playing();

    let next = published(&mut fixture, &serde_json::json!({ "type": "next_chapter" }));
    assert_eq!(next[0].playback.chapter, Some(1));

    let previous = published(
        &mut fixture,
        &serde_json::json!({ "type": "previous_chapter" }),
    );
    assert_eq!(previous[0].playback.chapter, Some(0));

    let at = published(
        &mut fixture,
        &serde_json::json!({ "type": "set_chapter", "index": 1 }),
    );
    assert_eq!(at[0].playback.chapter, Some(1));

    assert_eq!(
        controls(&fixture.player),
        vec![
            Telling::Chapter(ChapterStep::Next),
            Telling::Chapter(ChapterStep::Previous),
            Telling::Chapter(ChapterStep::At { index: 1 }),
        ]
    );
}

#[test]
fn crop_and_aspect_move_the_hosts_own_record() {
    let mut fixture = playing();

    let cropped = published(
        &mut fixture,
        &serde_json::json!({
            "type": "set_crop",
            "crop": { "kind": "rectangle", "width": 96, "height": 72, "x": 16, "y": 0 },
        }),
    );
    assert_eq!(
        cropped[0].playback.crop,
        Some(CropRectangle {
            width: 96,
            height: 72,
            x: 16,
            y: 0,
        })
    );

    let uncropped = published(
        &mut fixture,
        &serde_json::json!({ "type": "set_crop", "crop": { "kind": "off" } }),
    );
    assert_eq!(uncropped[0].playback.crop, None);

    let stretched = published(
        &mut fixture,
        &serde_json::json!({ "type": "set_aspect", "aspect": { "kind": "ratio", "value": 1.7778 } }),
    );
    assert_eq!(
        stretched[0].playback.aspect,
        Some(Aspect::Ratio { value: 1.7778 })
    );

    let source = published(
        &mut fixture,
        &serde_json::json!({ "type": "set_aspect", "aspect": { "kind": "source" } }),
    );
    assert_eq!(source[0].playback.aspect, Some(Aspect::Source));

    assert_eq!(
        controls(&fixture.player),
        vec![
            Telling::Crop(Crop::Rectangle {
                width: 96,
                height: 72,
                x: 16,
                y: 0,
            }),
            Telling::Crop(Crop::Off),
            Telling::Aspect(Aspect::Ratio { value: 1.7778 }),
            Telling::Aspect(Aspect::Source),
        ]
    );
}

#[test]
fn autocrop_tells_the_player_and_moves_nothing_of_the_hosts_own() {
    let mut fixture = playing();
    let before = fixture.host.snapshot();

    let published = published(&mut fixture, &serde_json::json!({ "type": "autocrop" }));

    assert_eq!(
        controls(&fixture.player),
        vec![Telling::Autocrop],
        "the toggle is the Player's own script binding, asked once"
    );
    assert_eq!(
        published[0].playback, before.playback,
        "the crop is the script's to find, and the Player's next report carries it"
    );
    assert_eq!(
        published[0].revision,
        before.revision + 1,
        "a control taken is still a change every client is told of"
    );
}

#[test]
fn every_control_with_nothing_live_is_refused_rather_than_silently_obeyed() {
    for body in control_bodies() {
        let mut fixture = fixture();
        let before = fixture.host.snapshot();

        assert!(
            matches!(
                fixture.host.dispatch(action(&body)),
                Err(ActionError::NothingPlaying { .. })
            ),
            "{body} does nothing when nothing is playing, and says so"
        );
        assert!(
            controls(&fixture.player).is_empty(),
            "a refused control never reaches the Player"
        );
        assert_eq!(fixture.host.snapshot(), before);
    }
}

#[test]
fn an_unknown_track_or_chapter_is_refused_before_the_player_hears_of_it() {
    let mut fixture = playing();
    let before = fixture.host.snapshot();

    let refused = fixture.host.dispatch(action(
        &serde_json::json!({ "type": "set_audio_track", "track": 9 }),
    ));
    assert!(
        matches!(
            refused,
            Err(ActionError::UnknownTrack {
                control: Control::AudioTrack,
                id: 9,
            })
        ),
        "a track the Stream does not carry is refused: {refused:?}"
    );

    let refused = fixture.host.dispatch(action(
        &serde_json::json!({ "type": "set_subtitle_track", "track": 9 }),
    ));
    assert!(
        matches!(
            refused,
            Err(ActionError::UnknownTrack {
                control: Control::SubtitleTrack,
                id: 9,
            })
        ),
        "and so is a subtitle track that is not there: {refused:?}"
    );

    let refused = fixture.host.dispatch(action(
        &serde_json::json!({ "type": "set_chapter", "index": 9 }),
    ));
    assert!(
        matches!(refused, Err(ActionError::UnknownChapter { index: 9 })),
        "a chapter past the list names nothing to move to: {refused:?}"
    );

    assert!(
        controls(&fixture.player).is_empty(),
        "the Player never heard of a track or chapter that is not there"
    );
    assert_eq!(
        fixture.host.snapshot(),
        before,
        "a refused control leaves the state exactly as it was"
    );
}

#[test]
fn no_control_reopens_the_stream() {
    for body in control_bodies() {
        let mut fixture = playing();
        let opened = fixture.player.opened();

        published(&mut fixture, &body);

        assert_eq!(
            fixture.player.opened(),
            opened,
            "{body} moves something about the Stream playing, and never reopens it"
        );
    }
}

#[test]
fn a_language_list_changed_mid_stream_leaves_the_stream_playing_alone() {
    // The new list applies from the next Stream (story 14): the Player is told
    // its first guess, and nothing about what is playing is selected or reopened.
    let mut fixture = playing();
    let opened = fixture.player.opened();
    let before = fixture.host.snapshot().playback;

    for body in [
        serde_json::json!({ "type": "set_subtitle_languages", "languages": ["fr", "en"] }),
        serde_json::json!({ "type": "set_audio_languages", "languages": ["fr"] }),
    ] {
        let after = published(&mut fixture, &body);

        assert_eq!(fixture.player.opened(), opened, "{body} never reopens");
        assert_eq!(
            after[0].playback.tracks, before.tracks,
            "{body} selects no other track"
        );
    }
    assert!(
        controls(&fixture.player)
            .iter()
            .all(|telling| !matches!(telling, Telling::SubtitleTrack(_) | Telling::AudioTrack(_))),
        "no track was told to the Player"
    );
}

#[test]
fn the_language_lists_are_told_to_the_player_and_survive_a_refusal() {
    let mut fixture = fixture();
    let list = |tags: &[&str]| LanguageList::parse(tags).expect("a language list");

    let first = published(
        &mut fixture,
        &serde_json::json!({ "type": "set_subtitle_languages", "languages": ["pt-BR", "en"] }),
    );
    assert_eq!(
        first[0]
            .preferences
            .subtitle_languages
            .iter()
            .map(host_core::Language::as_str)
            .collect::<Vec<_>>(),
        ["pt-BR", "en"]
    );
    assert_eq!(
        fixture.player.tellings().last(),
        Some(&Telling::SubtitleLanguages(list(&["pt-BR", "en"]))),
        "the Player is told the whole list, so mpv's first guess is right"
    );

    published(
        &mut fixture,
        &serde_json::json!({ "type": "set_audio_languages", "languages": ["fr"] }),
    );
    assert_eq!(
        fixture.player.tellings().last(),
        Some(&Telling::AudioLanguages(list(&["fr"]))),
        "the audio list is told on its own"
    );

    published(
        &mut fixture,
        &serde_json::json!({ "type": "set_subtitle_languages", "languages": [] }),
    );
    assert_eq!(
        fixture.player.tellings().last(),
        Some(&Telling::SubtitleLanguages(LanguageList::empty())),
        "an empty list is told as empty: follow the file"
    );

    // A Player that refuses every telling is not a reason the Host cannot hold
    // a preference: it is Host state, and it persists either way.
    let player = Arc::new(FixturePlayer::new().refusing(PlaybackError::Command {
        detail: "mpv is gone".to_owned(),
    }));
    let mut host = host_over(player);
    let published = host
        .dispatch(action(
            &serde_json::json!({ "type": "set_subtitle_languages", "languages": ["en"] }),
        ))
        .expect("a refused telling is not a refused preference");
    assert_eq!(
        published.snapshots[0]
            .preferences
            .subtitle_languages
            .iter()
            .map(host_core::Language::as_str)
            .collect::<Vec<_>>(),
        ["en"]
    );
}

#[test]
fn the_subtitle_appearance_is_told_to_the_player_and_survives_a_refusal() {
    let mut fixture = fixture();

    let colored = published(
        &mut fixture,
        &serde_json::json!({ "type": "set_subtitle_color", "color": "#00ff00" }),
    );
    assert_eq!(
        colored[0].preferences.subtitle_color.as_str(),
        "#00FF00",
        "the colour is normalized before it is published"
    );
    assert!(
        matches!(
            fixture.player.tellings().last(),
            Some(Telling::SubtitleColor(color)) if color.as_str() == "#00FF00"
        ),
        "the Player is told the colour"
    );

    let scaled = published(
        &mut fixture,
        &serde_json::json!({ "type": "set_subtitle_scale", "scale": 1.25 }),
    );
    assert_eq!(scaled[0].preferences.subtitle_scale.value(), 1.25);
    assert!(
        matches!(
            fixture.player.tellings().last(),
            Some(Telling::SubtitleScale(scale)) if (scale.value() - 1.25).abs() < 1e-9
        ),
        "the Player is told the size"
    );

    // A Player that refuses every telling is not a reason the Host cannot hold
    // a preference: it is Host state, and it persists either way (ADR-0024).
    let player = Arc::new(FixturePlayer::new().refusing(PlaybackError::Command {
        detail: "mpv is gone".to_owned(),
    }));
    let mut host = host_over(player);
    let response = host
        .dispatch(action(
            &serde_json::json!({ "type": "set_subtitle_color", "color": "#FFCC00" }),
        ))
        .expect("a refused telling is not a refused preference");
    assert_eq!(
        response.snapshots[0].preferences.subtitle_color.as_str(),
        "#FFCC00"
    );
    let response = host
        .dispatch(action(
            &serde_json::json!({ "type": "set_subtitle_scale", "scale": 1.5 }),
        ))
        .expect("a refused telling is not a refused preference");
    assert_eq!(
        response.snapshots[0].preferences.subtitle_scale.value(),
        1.5
    );
}

#[test]
fn the_stream_buffer_is_told_to_the_player_and_survives_a_refusal() {
    let mut fixture = fixture();

    let published = published(
        &mut fixture,
        &serde_json::json!({ "type": "set_stream_buffer", "seconds": 600, "megabytes": 1024 }),
    );
    assert_eq!(published[0].preferences.stream_buffer.seconds(), 600);
    assert_eq!(published[0].preferences.stream_buffer.megabytes(), 1024);
    assert!(
        matches!(
            fixture.player.tellings().last(),
            Some(Telling::StreamBuffer(buffer))
                if buffer.seconds() == 600 && buffer.megabytes() == 1024
        ),
        "the Player is told the look-ahead and the memory ceiling"
    );

    // The buffer is Host state like the appearance: a Player that refuses the
    // telling does not stop the Host holding it, and the next Stream still
    // starts from it (ADR-0026).
    let player = Arc::new(FixturePlayer::new().refusing(PlaybackError::Command {
        detail: "mpv is gone".to_owned(),
    }));
    let mut host = host_over(player);
    let response = host
        .dispatch(action(
            &serde_json::json!({ "type": "set_stream_buffer", "seconds": 60, "megabytes": 128 }),
        ))
        .expect("a refused telling is not a refused preference");
    assert_eq!(
        response.snapshots[0].preferences.stream_buffer.seconds(),
        60
    );
}

#[test]
fn a_host_tells_its_player_the_stored_appearance_at_startup() {
    let mut stored = Preferences::new();
    stored.set_subtitle_color(SubtitleColor::parse("#ffff00").expect("a colour"));
    stored.set_subtitle_scale(SubtitleScale::parse(1.25).expect("a size"));
    stored.set_stream_buffer(StreamBuffer::parse(600, 1024).expect("a buffer"));

    let player = Arc::new(FixturePlayer::new());
    let fetcher = Arc::new(FixtureFetcher::new());
    let provider = Arc::new(AddonProvider::new(fetcher.clone()));
    Host::new(
        Arc::new(InMemoryStore::holding(stored)) as Arc<dyn Store>,
        fetcher,
        Arc::new(InMemorySecretStore::backed_by(SecretBackend::Keyring)),
        provider,
        player.clone(),
        Arc::new(FixtureClock::new()),
    )
    .expect("a Host over a store starts");

    let told: Vec<Telling> = player.tellings();
    assert_eq!(
        told,
        vec![
            Telling::SubtitleLanguages(LanguageList::empty()),
            Telling::AudioLanguages(LanguageList::empty()),
            Telling::SubtitleColor(SubtitleColor::parse("#FFFF00").expect("a colour")),
            Telling::SubtitleScale(SubtitleScale::parse(1.25).expect("a size")),
            Telling::StreamBuffer(StreamBuffer::parse(600, 1024).expect("a buffer")),
        ],
        "both language lists, the appearance, and the buffer before any Stream is opened"
    );
}
