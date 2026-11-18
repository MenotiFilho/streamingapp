//! The Host chooses the subtitle (ADR-0041): on the first report of a Stream's
//! Tracks it ranks the subtitle Tracks against Subtitle languages, after the
//! soundtrack, and tells the Player only where its choice differs from mpv's.
//! Driven the way a client drives the Host, with a fake Player and a fake Clock;
//! the pure ranking is tested where it lives, in `tracks.rs`.

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

    fn set_subtitle_languages(&mut self, languages: &[&str]) {
        self.host
            .dispatch(action(
                &serde_json::json!({"type": "set_subtitle_languages", "languages": languages}),
            ))
            .expect("setting Subtitle languages works");
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

    /// What the Host told the Player to select, in order: `a<id>` for a
    /// soundtrack, `s<id>` for a subtitle, `s-` for none.
    fn told_choices(&self) -> Vec<String> {
        self.player
            .tellings()
            .into_iter()
            .filter_map(|telling| match telling {
                Telling::AudioTrack(id) => Some(format!("a{}", id.0)),
                Telling::SubtitleTrack(Some(id)) => Some(format!("s{}", id.0)),
                Telling::SubtitleTrack(None) => Some("s-".to_owned()),
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

fn subtitle(id: i64, language: &str, default: bool, selected: bool) -> Track {
    Track {
        kind: TrackKind::Subtitle,
        codec: Some("subrip".to_owned()),
        ..audio(id, language, default, selected)
    }
}

fn forced(mut track: Track) -> Track {
    track.forced = true;
    track
}

fn selected_subtitle(snapshot: &Snapshot) -> Option<i64> {
    snapshot
        .playback
        .tracks
        .iter()
        .find(|track| track.kind == TrackKind::Subtitle && track.selected)
        .map(|track| track.id.0)
}

/// English audio and subtitles only, mpv having selected both.
fn only_english() -> Vec<Track> {
    vec![audio(1, "eng", true, true), subtitle(2, "eng", false, true)]
}

#[test]
fn pt_br_then_en_on_a_file_with_only_english_shows_english() {
    let mut fixture = fixture();
    fixture.set_subtitle_languages(&["pt-BR", "en"]);
    fixture.play();

    // mpv selected nothing: its first guess missed and subs-fallback is off.
    let tracks = vec![
        audio(1, "eng", true, true),
        subtitle(2, "eng", false, false),
    ];
    let published = fixture
        .report(PlaybackState::Playing, Some(tracks))
        .expect("a track list is news");

    assert_eq!(fixture.told_choices(), ["s2"]);
    assert_eq!(
        selected_subtitle(&published),
        Some(2),
        "the Host's record moves at the moment of the choice (ADR-0014)"
    );
}

#[test]
fn the_audio_is_told_before_the_subtitle() {
    let mut fixture = fixture();
    fixture.set_audio_languages(&["pt-BR"]);
    fixture.set_subtitle_languages(&["en"]);
    fixture.play();

    let tracks = vec![
        audio(1, "eng", true, true),
        audio(2, "pob", false, false),
        subtitle(3, "eng", false, false),
    ];
    fixture.report(PlaybackState::Playing, Some(tracks));

    assert_eq!(fixture.told_choices(), ["a2", "s3"]);
}

#[test]
fn nothing_is_told_where_mpv_already_selected_the_choice() {
    let mut fixture = fixture();
    fixture.set_subtitle_languages(&["en"]);
    fixture.play();

    fixture.report(PlaybackState::Playing, Some(only_english()));

    assert_eq!(fixture.told_choices(), Vec::<String>::new());
}

#[test]
fn a_subtitle_mpv_selected_that_the_host_would_not_show_is_turned_off() {
    let mut fixture = fixture();
    fixture.set_subtitle_languages(&["pt-BR"]);
    fixture.play();

    // mpv selected the file's default French subtitle, which is not listed.
    let tracks = vec![audio(1, "eng", true, true), subtitle(2, "fre", true, true)];
    let published = fixture
        .report(PlaybackState::Playing, Some(tracks))
        .expect("a track list is news");

    assert_eq!(fixture.told_choices(), ["s-"]);
    assert_eq!(selected_subtitle(&published), None);
}

#[test]
fn an_empty_list_follows_the_file_and_tells_nothing_where_mpv_agrees() {
    let mut fixture = fixture();
    fixture.play();

    let tracks = vec![
        audio(1, "eng", true, true),
        subtitle(2, "eng", false, false),
        subtitle(3, "fre", true, true),
    ];
    fixture.report(PlaybackState::Playing, Some(tracks));

    assert_eq!(fixture.told_choices(), Vec::<String>::new());
}

#[test]
fn an_empty_list_turns_off_what_mpv_selected_that_the_file_does_not_flag() {
    let mut fixture = fixture();
    fixture.play();

    // mpv's own OS-language guess selected English; the file flags nothing.
    let tracks = vec![audio(1, "eng", true, true), subtitle(2, "eng", false, true)];
    fixture.report(PlaybackState::Playing, Some(tracks));

    assert_eq!(fixture.told_choices(), ["s-"]);
}

#[test]
fn the_forced_track_in_the_language_the_host_chose_to_play_shows() {
    let mut fixture = fixture();
    fixture.set_audio_languages(&["pt-BR"]);
    fixture.set_subtitle_languages(&["de"]);
    fixture.play();

    // The Host moves the soundtrack to the Portuguese dub, so the forced Track
    // that shows is the Portuguese one, not the English one mpv's audio was in.
    let tracks = vec![
        audio(1, "eng", true, true),
        audio(2, "pob", false, false),
        forced(subtitle(3, "eng", false, false)),
        forced(subtitle(4, "pob", false, false)),
    ];
    fixture.report(PlaybackState::Playing, Some(tracks));

    assert_eq!(fixture.told_choices(), ["a2", "s4"]);
}

#[test]
fn the_forced_rule_reads_the_soundtrack_mpv_kept_where_the_host_does_not_move_it() {
    let mut fixture = fixture();
    fixture.set_subtitle_languages(&["de"]);
    fixture.play();

    let tracks = vec![
        audio(1, "eng", true, true),
        audio(2, "pob", false, false),
        forced(subtitle(3, "eng", false, false)),
        forced(subtitle(4, "pob", false, false)),
    ];
    fixture.report(PlaybackState::Playing, Some(tracks));

    assert_eq!(fixture.told_choices(), ["s3"]);
}

#[test]
fn a_paused_stream_is_chosen_for_too() {
    let mut fixture = fixture();
    fixture.set_subtitle_languages(&["en"]);
    fixture.play();

    fixture.report(
        PlaybackState::Paused,
        Some(vec![
            audio(1, "eng", true, true),
            subtitle(2, "eng", false, false),
        ]),
    );

    assert_eq!(fixture.told_choices(), ["s2"]);
}

#[test]
fn a_stream_still_opening_or_with_no_track_list_is_not_chosen_for_yet() {
    let mut fixture = fixture();
    fixture.set_subtitle_languages(&["en"]);
    fixture.play();
    let tracks = || {
        vec![
            audio(1, "eng", true, true),
            subtitle(2, "eng", false, false),
        ]
    };

    fixture.report(PlaybackState::Opening, Some(tracks()));
    fixture.report(PlaybackState::Playing, None);
    assert_eq!(fixture.told_choices(), Vec::<String>::new());

    // The choice was not spent on either: the first usable report makes it.
    fixture.report(PlaybackState::Playing, Some(tracks()));
    assert_eq!(fixture.told_choices(), ["s2"]);
}

#[test]
fn the_choice_is_made_once_per_stream_and_a_later_report_re_chooses_nothing() {
    let mut fixture = fixture();
    fixture.set_subtitle_languages(&["en"]);
    fixture.play();
    let tracks = vec![
        audio(1, "eng", true, true),
        subtitle(2, "eng", false, false),
    ];
    fixture.report(PlaybackState::Playing, Some(tracks.clone()));
    assert_eq!(fixture.told_choices(), ["s2"]);

    // Later reports, even one that gains a Track, are not first reports.
    fixture.report(PlaybackState::Playing, Some(tracks.clone()));
    let mut grown = tracks;
    grown.push(subtitle(3, "eng", false, false));
    fixture.report(PlaybackState::Playing, Some(grown));

    assert_eq!(fixture.told_choices(), ["s2"]);
}

#[test]
fn the_next_stream_is_chosen_for_afresh() {
    let mut fixture = fixture();
    fixture.set_subtitle_languages(&["en"]);
    fixture.play();
    let tracks = vec![
        audio(1, "eng", true, true),
        subtitle(2, "eng", false, false),
    ];
    fixture.report(PlaybackState::Playing, Some(tracks.clone()));

    fixture.play();
    fixture.report(PlaybackState::Playing, Some(tracks));

    assert_eq!(fixture.told_choices(), ["s2", "s2"]);
}

#[test]
fn a_list_changed_mid_stream_is_told_as_the_first_guess_and_re_selects_nothing() {
    let mut fixture = fixture();
    fixture.set_subtitle_languages(&["en"]);
    fixture.play();
    let tracks = vec![
        audio(1, "eng", true, true),
        subtitle(2, "eng", false, false),
    ];
    fixture.report(PlaybackState::Playing, Some(tracks.clone()));
    assert_eq!(fixture.told_choices(), ["s2"]);

    fixture.set_subtitle_languages(&["ja"]);
    fixture.report(PlaybackState::Playing, Some(tracks.clone()));
    assert_eq!(
        fixture.told_choices(),
        ["s2"],
        "the playing Stream is left alone"
    );

    // The next Stream uses the new list: no Japanese subtitle, so none.
    fixture.play();
    fixture.report(
        PlaybackState::Playing,
        Some(vec![
            audio(1, "eng", true, true),
            subtitle(2, "eng", false, true),
        ]),
    );
    assert_eq!(fixture.told_choices(), ["s2", "s-"]);
}
