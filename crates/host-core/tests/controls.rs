//! The full control set, driven the way a client drives it: an Action in, a
//! Snapshot out, and the telling the Player was given. Every control has to
//! move the Host's own record at once (ADR-0013's rule for pause and seek,
//! applied to all of them), reach the Player as one telling, and reopen
//! nothing.

use std::sync::Arc;

use host_core::{
    Action, ActionError, AddonProvider, Aspect, Chapter, ChapterStep, Control, Crop, CropRectangle,
    FixtureFetcher, FixturePlayer, Host, InMemorySecretStore, InMemoryStore, Observation,
    PlaybackError, PlaybackState, SecretBackend, Snapshot, Statistics, Store, Telling, Track,
    TrackId, TrackKind, VideoSize, ACTION_VERSION,
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
    Fixture {
        host: host_over(player.clone()),
        player,
    }
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
        tracks: vec![
            track(1, TrackKind::Audio, "eng", true),
            track(3, TrackKind::Audio, "por", false),
            track(2, TrackKind::Subtitle, "por", false),
        ],
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
        serde_json::json!({ "type": "set_aspect", "aspect": { "kind": "ratio", "value": 1.7778 } }),
        serde_json::json!({ "type": "set_aspect", "aspect": { "kind": "source" } }),
    ]
}

/// The control tellings the Player was given: everything but the subtitle
/// language the Host tells it once, at startup, from the stored preference.
fn controls(player: &FixturePlayer) -> Vec<Telling> {
    player
        .tellings()
        .into_iter()
        .filter(|telling| !matches!(telling, Telling::SubtitleLanguage(_)))
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
fn the_subtitle_language_preference_is_told_to_the_player_and_survives_a_refusal() {
    let mut fixture = fixture();

    let published = published(
        &mut fixture,
        &serde_json::json!({ "type": "set_subtitle_language", "language": "pt-BR" }),
    );
    assert_eq!(
        published[0]
            .preferences
            .subtitle_language
            .as_ref()
            .map(host_core::SubtitleLanguage::as_str),
        Some("pt-BR")
    );
    assert!(
        matches!(
            fixture.player.tellings().last(),
            Some(Telling::SubtitleLanguage(Some(_)))
        ),
        "the Player is told the preference, so mpv selects the right subtitle track"
    );

    // A Player that refuses every telling is not a reason the Host cannot hold
    // a preference: it is Host state, and it persists either way.
    let player = Arc::new(FixturePlayer::new().refusing(PlaybackError::Command {
        detail: "mpv is gone".to_owned(),
    }));
    let mut host = host_over(player);
    let published = host
        .dispatch(action(
            &serde_json::json!({ "type": "set_subtitle_language", "language": "en" }),
        ))
        .expect("a refused telling is not a refused preference");
    assert_eq!(
        published.snapshots[0]
            .preferences
            .subtitle_language
            .as_ref()
            .map(host_core::SubtitleLanguage::as_str),
        Some("en")
    );
}
