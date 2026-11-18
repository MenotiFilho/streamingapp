//! The Host chooses the soundtrack (ADR-0041): on the first report of a Stream's
//! Tracks it ranks the audio Tracks against Audio languages and tells the Player
//! only where its choice differs from mpv's. Driven the way a client drives the
//! Host, with a fake Player and a fake Clock; the pure ranking is tested where
//! it lives, in `tracks.rs`.

use std::sync::Arc;

use host_core::{
    Action, AddonProvider, FixtureClock, FixtureFetcher, FixturePlayer, Host, InMemorySecretStore,
    InMemoryStore, Observation, PlaybackState, SecretBackend, Snapshot, Store, Telling, Track,
    TrackId, TrackKind, ACTION_VERSION,
};

const CHOSEN: &str = "https://stream.example.org/v/tt0133093-1080p.mkv";

fn action(body: &serde_json::Value) -> Action {
    let envelope = format!(r#"{{"version":{ACTION_VERSION},"action":{body}}}"#);
    Action::parse(&envelope).unwrap_or_else(|error| panic!("{envelope} should parse: {error}"))
}

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
            "poster": null,
        },
        "stream": {
            "name": "1080p",
            "playback": { "kind": "direct", "url": CHOSEN },
            "warnings": [],
        },
    })
}

struct Fixture {
    host: Host,
    player: Arc<FixturePlayer>,
}

fn fixture() -> Fixture {
    let player = Arc::new(FixturePlayer::new());
    let fetcher = Arc::new(FixtureFetcher::new());
    let provider = Arc::new(AddonProvider::new(fetcher.clone()));
    let host = Host::new(
        Arc::new(InMemoryStore::new()) as Arc<dyn Store>,
        fetcher,
        Arc::new(InMemorySecretStore::backed_by(SecretBackend::Keyring)),
        provider,
        player.clone(),
        Arc::new(FixtureClock::new()),
    )
    .expect("a Host over a store starts");
    Fixture { host, player }
}

impl Fixture {
    fn set_audio_languages(&mut self, languages: &[&str]) {
        self.host
            .dispatch(action(
                &serde_json::json!({"type": "set_audio_languages", "languages": languages}),
            ))
            .expect("setting Audio languages works");
    }

    fn play(&mut self) {
        self.host
            .dispatch(action(&a_chosen_stream()))
            .expect("choosing a playable candidate works");
    }

    /// The Player reports these Tracks on a Stream that is `state`, and the Host
    /// looks at it.
    fn report(&mut self, state: PlaybackState, tracks: Option<Vec<Track>>) -> Option<Snapshot> {
        self.player.now_reporting(Observation {
            state,
            position: Some(12.5),
            duration: Some(600.0),
            tracks,
            ..Observation::idle()
        });
        self.host.sample()
    }

    /// The soundtracks the Host told the Player to play, in order.
    fn told_audio(&self) -> Vec<i64> {
        self.player
            .tellings()
            .into_iter()
            .filter_map(|telling| match telling {
                Telling::AudioTrack(id) => Some(id.0),
                _ => None,
            })
            .collect()
    }
}

fn audio(id: i64, language: &str, default: bool, selected: bool) -> Track {
    Track {
        id: TrackId(id),
        kind: TrackKind::Audio,
        language: Some(language.to_owned()),
        title: None,
        codec: Some("aac".to_owned()),
        embedded: true,
        selected,
        default,
        forced: false,
        hearing_impaired: false,
    }
}

/// The file the owner described: a Portuguese dub in a file whose default, and
/// so mpv's pick, is English.
fn english_default_with_a_dub() -> Vec<Track> {
    vec![
        audio(1, "eng", true, true),
        audio(2, "pob", false, false),
        audio(3, "jpn", false, false),
    ]
}

fn selected_audio(snapshot: &Snapshot) -> Option<i64> {
    snapshot
        .playback
        .tracks
        .iter()
        .find(|track| track.kind == TrackKind::Audio && track.selected)
        .map(|track| track.id.0)
}

#[test]
fn a_dub_the_file_does_not_mark_default_starts_for_pt_br() {
    let mut fixture = fixture();
    fixture.set_audio_languages(&["pt-BR"]);
    fixture.play();

    let published = fixture
        .report(PlaybackState::Playing, Some(english_default_with_a_dub()))
        .expect("a track list is news");

    assert_eq!(fixture.told_audio(), [2]);
    assert_eq!(
        selected_audio(&published),
        Some(2),
        "the Host's record moves at the moment of the choice (ADR-0014)"
    );
}

#[test]
fn nothing_is_told_where_mpv_already_selected_the_choice() {
    let mut fixture = fixture();
    fixture.set_audio_languages(&["en"]);
    fixture.play();

    fixture.report(PlaybackState::Playing, Some(english_default_with_a_dub()));

    assert_eq!(fixture.told_audio(), Vec::<i64>::new());
}

#[test]
fn an_empty_list_follows_the_file_and_tells_nothing() {
    let mut fixture = fixture();
    fixture.play();

    fixture.report(PlaybackState::Playing, Some(english_default_with_a_dub()));

    assert_eq!(fixture.told_audio(), Vec::<i64>::new());
}

#[test]
fn a_paused_stream_is_chosen_for_too() {
    let mut fixture = fixture();
    fixture.set_audio_languages(&["ja"]);
    fixture.play();

    fixture.report(PlaybackState::Paused, Some(english_default_with_a_dub()));

    assert_eq!(fixture.told_audio(), [3]);
}

#[test]
fn a_stream_still_opening_or_with_no_track_list_is_not_chosen_for_yet() {
    let mut fixture = fixture();
    fixture.set_audio_languages(&["pt-BR"]);
    fixture.play();

    fixture.report(PlaybackState::Opening, Some(english_default_with_a_dub()));
    fixture.report(PlaybackState::Playing, None);
    assert_eq!(fixture.told_audio(), Vec::<i64>::new());

    // The choice was not spent on either: the first usable report makes it.
    fixture.report(PlaybackState::Playing, Some(english_default_with_a_dub()));
    assert_eq!(fixture.told_audio(), [2]);
}

#[test]
fn the_choice_is_made_once_per_stream_and_a_later_report_re_chooses_nothing() {
    let mut fixture = fixture();
    fixture.set_audio_languages(&["pt-BR"]);
    fixture.play();
    fixture.report(PlaybackState::Playing, Some(english_default_with_a_dub()));
    assert_eq!(fixture.told_audio(), [2]);

    // The owner goes back to English by hand, and the Player says so.
    let by_hand = vec![
        audio(1, "eng", true, true),
        audio(2, "pob", false, false),
        audio(3, "jpn", false, false),
    ];
    fixture.report(PlaybackState::Playing, Some(by_hand.clone()));
    // A track list that gains a Track is not a first report either.
    let mut grown = by_hand;
    grown.push(audio(4, "por", false, false));
    fixture.report(PlaybackState::Playing, Some(grown));

    assert_eq!(fixture.told_audio(), [2]);
}

#[test]
fn the_next_stream_is_chosen_for_afresh() {
    let mut fixture = fixture();
    fixture.set_audio_languages(&["pt-BR"]);
    fixture.play();
    fixture.report(PlaybackState::Playing, Some(english_default_with_a_dub()));

    fixture.play();
    fixture.report(PlaybackState::Playing, Some(english_default_with_a_dub()));

    assert_eq!(fixture.told_audio(), [2, 2]);
}

#[test]
fn a_list_changed_mid_stream_is_told_as_the_first_guess_and_re_selects_nothing() {
    let mut fixture = fixture();
    fixture.set_audio_languages(&["pt-BR"]);
    fixture.play();
    fixture.report(PlaybackState::Playing, Some(english_default_with_a_dub()));
    assert_eq!(fixture.told_audio(), [2]);

    fixture.set_audio_languages(&["ja"]);
    // mpv's answer on the playing Stream is not revisited, however it reports.
    fixture.report(PlaybackState::Playing, Some(english_default_with_a_dub()));

    let guesses: Vec<_> = fixture
        .player
        .tellings()
        .into_iter()
        .filter_map(|telling| match telling {
            Telling::AudioLanguages(list) => Some(list.to_vec()),
            _ => None,
        })
        .collect();
    assert_eq!(
        guesses.last().map(|list| list.len()),
        Some(1),
        "the changed list is told as the first guess"
    );
    assert_eq!(guesses.last().expect("a guess")[0].as_str(), "ja");
    assert_eq!(
        fixture.told_audio(),
        [2],
        "the playing Stream is left alone"
    );

    // The next Stream uses the new list.
    fixture.play();
    fixture.report(PlaybackState::Playing, Some(english_default_with_a_dub()));
    assert_eq!(fixture.told_audio(), [2, 3]);
}
