//! The Addon `subtitles` fallback, driven the way the Host drives it: a Stream
//! playing with no embedded subtitle track, and the Addons asked about once.
//! Nothing below the Action surface is named here, and no test reaches the
//! network: every Addon answer is a fixture or a fake Provider.

use std::sync::Arc;

use host_core::{
    Action, ActionError, FixtureClock, FixtureFetcher, FixturePlayer, FixtureProvider, Host,
    InMemorySecretStore, InMemoryStore, Observation, PlaybackState, SecretBackend, Store,
    StreamUrl, Subtitle, Telling, Track, TrackId, TrackKind, ACTION_VERSION,
};

/// The Addons a fallback test configures, and the manifests they answer with.
const SUBS_A: &str = "https://subs-a.example.org/manifest.json";
const SUBS_B: &str = "https://subs-b.example.org/manifest.json";

/// A manifest for an Addon that answers `subtitles` for films and series.
fn manifest(id: &str) -> String {
    format!(
        r#"{{"id":"{id}","name":"{id}","version":"1.0.0",
             "resources":["stream","subtitles"],"types":["movie","series"],"catalogs":[]}}"#
    )
}

/// An Action as a client sends it: the versioned envelope, as JSON text.
fn action(body: &serde_json::Value) -> Action {
    let envelope = format!(r#"{{"version":{ACTION_VERSION},"action":{body}}}"#);
    Action::parse(&envelope).unwrap_or_else(|error| panic!("{envelope} should parse: {error}"))
}

/// A subtitle an Addon offers: its own id, a URL, and a language tag.
fn subtitle(id: &str, url: &str, language: &str) -> Subtitle {
    Subtitle {
        id: Some(id.to_owned()),
        url: StreamUrl::parse(url).unwrap_or_else(|error| panic!("{url} should be a URL: {error}")),
        language: Some(language.to_owned()),
    }
}

fn audio_track() -> Track {
    Track {
        id: TrackId(1),
        kind: TrackKind::Audio,
        language: Some("eng".to_owned()),
        title: None,
        codec: Some("aac".to_owned()),
        embedded: true,
        selected: true,
        default: true,
        forced: false,
        hearing_impaired: false,
    }
}

/// A report from a Player on a Stream that carries no embedded subtitle track.
fn without_subtitles() -> Observation {
    Observation {
        state: PlaybackState::Playing,
        position: Some(12.5),
        duration: Some(600.0),
        tracks: Some(vec![audio_track()]),
        ..Observation::idle()
    }
}

/// A Host over an empty store, this Player and this Provider, with these Addons
/// (a URL and its manifest) configured in the order given.
fn host_with(
    player: Arc<FixturePlayer>,
    provider: Arc<FixtureProvider>,
    addons: &[(&str, String)],
) -> Host {
    let mut fetcher = FixtureFetcher::new();
    for (url, manifest) in addons {
        fetcher = fetcher.serving(url, manifest.clone());
    }
    let mut host = Host::new(
        Arc::new(InMemoryStore::new()) as Arc<dyn Store>,
        Arc::new(fetcher),
        Arc::new(InMemorySecretStore::backed_by(SecretBackend::Keyring)),
        provider,
        player,
        Arc::new(FixtureClock::new()),
    )
    .expect("a Host over a store starts");

    for (url, _) in addons {
        host.dispatch(action(
            &serde_json::json!({ "type": "add_addon", "url": url }),
        ))
        .unwrap_or_else(|error| panic!("configuring {url} should work: {error}"));
    }
    host
}

/// Choose a playable candidate for a Video.
fn play(host: &mut Host, addon: &str, r#type: &str, id: &str) {
    host.dispatch(action(&serde_json::json!({
        "type": "play_stream",
        "video": { "type": r#type, "id": id },
        "addon": addon,
        "title": {
            "addon": addon,
            "id": id,
            "type": r#type,
            "name": id,
            "poster": null,
        },
        "stream": {
            "name": "1080p",
            "playback": { "kind": "direct", "url": "https://stream.example.org/v/x.mkv" },
            "warnings": [],
        },
    })))
    .unwrap_or_else(|error| panic!("playing a direct candidate should work: {error}"));
}

/// The external subtitles the Player was told to load, as (url, title, language).
fn added(player: &FixturePlayer) -> Vec<(String, Option<String>, Option<String>)> {
    player
        .tellings()
        .into_iter()
        .filter_map(|telling| match telling {
            Telling::AddSubtitle {
                url,
                title,
                language,
            } => Some((url.as_str().to_owned(), title, language)),
            _ => None,
        })
        .collect()
}

#[test]
fn a_stream_with_no_embedded_subtitles_is_asked_about_once() {
    let player = Arc::new(FixturePlayer::new());
    let provider = Arc::new(
        FixtureProvider::new()
            .offering_subtitles(
                "org.example.subsA",
                vec![subtitle("a-por", "https://subs.example.org/a.srt", "por")],
            )
            .offering_subtitles(
                "org.example.subsB",
                vec![subtitle("b-eng", "https://subs.example.org/b.srt", "eng")],
            ),
    );
    let mut host = host_with(
        player.clone(),
        provider.clone(),
        &[
            (SUBS_A, manifest("org.example.subsA")),
            (SUBS_B, manifest("org.example.subsB")),
        ],
    );

    play(&mut host, "org.example.subsA", "series", "tt0903747:1:1");
    player.now_reporting(without_subtitles());
    host.sample()
        .expect("the Player's first report is a change");

    assert_eq!(
        provider.asked(),
        vec![
            "org.example.subsA".to_owned(),
            "org.example.subsB".to_owned()
        ],
        "every Addon that answers `subtitles`, in configuration order"
    );
    assert_eq!(
        added(&player),
        vec![
            (
                "https://subs.example.org/a.srt".to_owned(),
                Some("a-por".to_owned()),
                Some("por".to_owned()),
            ),
            (
                "https://subs.example.org/b.srt".to_owned(),
                Some("b-eng".to_owned()),
                Some("eng".to_owned()),
            ),
        ],
        "the Player is told to load each one, under the Addon's own word for it"
    );

    // A report that says what the Host already holds must not re-ask.
    player.now_reporting(without_subtitles());
    assert_eq!(
        host.sample(),
        None,
        "a tick that reports the same Stream publishes nothing"
    );
    assert_eq!(provider.asked().len(), 2, "the fallback is attempted once");
    assert_eq!(added(&player).len(), 2, "and adds nothing more");
}

#[test]
fn a_stream_that_carries_an_embedded_subtitle_is_never_asked_about() {
    let player = Arc::new(FixturePlayer::new());
    let provider = Arc::new(
        FixtureProvider::new()
            .offering_subtitles(
                "org.example.subsA",
                vec![subtitle("a-por", "https://subs.example.org/a.srt", "por")],
            )
            .offering_subtitles(
                "org.example.subsB",
                vec![subtitle("b-eng", "https://subs.example.org/b.srt", "eng")],
            ),
    );
    let mut host = host_with(
        player.clone(),
        provider.clone(),
        &[
            (SUBS_A, manifest("org.example.subsA")),
            (SUBS_B, manifest("org.example.subsB")),
        ],
    );

    play(&mut host, "org.example.subsA", "movie", "tt0133093");
    player.now_reporting(Observation {
        tracks: Some(vec![
            audio_track(),
            Track {
                id: TrackId(2),
                kind: TrackKind::Subtitle,
                language: Some("por".to_owned()),
                title: None,
                codec: Some("subrip".to_owned()),
                embedded: true,
                selected: false,
                default: false,
                forced: false,
                hearing_impaired: false,
            },
        ]),
        ..without_subtitles()
    });
    host.sample().expect("the Player's report is a change");

    assert!(
        provider.asked().is_empty(),
        "embedded subtitles always win: an Addon is never asked about a Stream that has one"
    );
    assert!(added(&player).is_empty());
}

#[test]
fn an_addon_that_fails_does_not_stop_the_others() {
    let player = Arc::new(FixturePlayer::new());
    let provider = Arc::new(
        FixtureProvider::new()
            .failing_subtitles(
                "org.example.subsA",
                ActionError::Fetch {
                    detail: "the Addon answered with status 503".to_owned(),
                },
            )
            .offering_subtitles(
                "org.example.subsB",
                vec![subtitle("b-eng", "https://subs.example.org/b.srt", "eng")],
            ),
    );
    let mut host = host_with(
        player.clone(),
        provider.clone(),
        &[
            (SUBS_A, manifest("org.example.subsA")),
            (SUBS_B, manifest("org.example.subsB")),
        ],
    );

    play(&mut host, "org.example.subsA", "series", "tt0903747:1:1");
    player.now_reporting(without_subtitles());
    host.sample()
        .expect("the Player's first report is a change");

    assert_eq!(
        provider.asked(),
        vec![
            "org.example.subsA".to_owned(),
            "org.example.subsB".to_owned()
        ],
        "the Addon that failed was asked, and so was the one after it"
    );
    assert_eq!(
        added(&player),
        vec![(
            "https://subs.example.org/b.srt".to_owned(),
            Some("b-eng".to_owned()),
            Some("eng".to_owned()),
        )],
        "one Addon failing is one Addon with nothing, not a failed fallback"
    );
}

#[test]
fn the_subtitle_url_reaches_the_player_and_never_a_snapshot() {
    let player = Arc::new(FixturePlayer::new());
    let provider = Arc::new(FixtureProvider::new().offering_subtitles(
        "org.example.subsA",
        vec![subtitle("a-por", "https://subs.example.org/a.srt", "por")],
    ));
    let mut host = host_with(
        player.clone(),
        provider.clone(),
        &[(SUBS_A, manifest("org.example.subsA"))],
    );

    play(&mut host, "org.example.subsA", "movie", "tt0133093");
    player.now_reporting(without_subtitles());
    host.sample()
        .expect("the Player's first report is a change");

    assert_eq!(
        added(&player),
        vec![(
            "https://subs.example.org/a.srt".to_owned(),
            Some("a-por".to_owned()),
            Some("por".to_owned()),
        )],
        "the Player is handed the URL, and that is the only place it goes"
    );

    // Once the file is loaded, the Player reports it as an external track, and
    // the track — not the URL it came from — is what every client is told.
    player.now_reporting(Observation {
        tracks: Some(vec![
            audio_track(),
            Track {
                id: TrackId(3),
                kind: TrackKind::Subtitle,
                language: Some("por".to_owned()),
                title: Some("a-por".to_owned()),
                codec: Some("subrip".to_owned()),
                embedded: false,
                selected: true,
                default: false,
                forced: false,
                hearing_impaired: false,
            },
        ]),
        ..without_subtitles()
    });
    let published = host.sample().expect("the external track is a change");

    assert_eq!(published.playback.tracks.len(), 2);
    assert!(
        !published.playback.tracks[1].embedded,
        "the track came from the fallback, not the file"
    );

    let wire = serde_json::to_string(&published).expect("a Snapshot serializes");
    assert!(
        !wire.contains("subs.example.org") && !wire.contains("a.srt"),
        "a subtitle URL can carry a session token and a Snapshot reaches every client: {wire}"
    );
}

#[test]
fn a_player_that_cannot_say_what_the_stream_carries_does_not_spend_the_attempt() {
    // A track list that could not be read is not a Stream with no subtitles in
    // it. The attempt is the Host's one ask per Stream, and spending it on the
    // wrong answer would load an Addon's subtitles over a file that already
    // carries its own — the wrong half of "embedded always wins".
    let player = Arc::new(FixturePlayer::new());
    let provider = Arc::new(FixtureProvider::new().offering_subtitles(
        "org.example.subsA",
        vec![subtitle("a-por", "https://subs.example.org/a.srt", "por")],
    ));
    let mut host = host_with(
        player.clone(),
        provider.clone(),
        &[(SUBS_A, manifest("org.example.subsA"))],
    );
    play(&mut host, "org.example.subsA", "movie", "tt0133093");

    // Live, but the Player has not said what the Stream carries.
    player.now_reporting(Observation {
        tracks: None,
        ..without_subtitles()
    });
    host.sample();

    assert!(
        provider.asked().is_empty() && added(&player).is_empty(),
        "a Player that could not read the track list has not said the Stream lacks \
         subtitles, so no Addon is asked"
    );

    // The next report *does* say what the file carries, and the attempt is made.
    player.now_reporting(without_subtitles());
    host.sample();

    assert_eq!(
        added(&player).len(),
        1,
        "the report the Host can act on is the one the attempt is spent on"
    );
}

// --- the fallback for a Video TMDB keys --------------------------------------

/// An Addon that answers `subtitles` in the one namespace a TMDB-keyed Video
/// reaches it by, declaring it the way a real subtitles Addon does.
const SUBS_TT: &str = "https://subs-tt.example.org/manifest.json";
const SUBS_TT_ID: &str = "org.example.subsTT";
const SUBS_TT_MANIFEST: &str = r#"{
    "id": "org.example.subsTT",
    "name": "Subs TT",
    "version": "1.0.0",
    "resources": [
        { "name": "stream", "types": ["movie", "series"], "idPrefixes": ["tt"] },
        { "name": "subtitles", "types": ["movie", "series"], "idPrefixes": ["tt"] }
    ],
    "types": ["movie", "series"],
    "catalogs": []
}"#;

const SUBS_TT_EPISODE: &str = "https://subs-tt.example.org/subtitles/series/tt0903747%3A1%3A1.json";
const SUBS_TT_BODY: &str = r#"{"subtitles":[
    {"id":"tt-ep-eng","url":"https://subs.example.org/tt-ep.srt","lang":"eng"}
]}"#;

const TMDB_KEY: &str = "0123456789abcdef0123456789abcdef";
const TMDB_EXTERNAL_IDS_BB: &str =
    "https://api.themoviedb.org/3/tv/1396/external_ids?api_key=0123456789abcdef0123456789abcdef";
const TMDB_EXTERNAL_BB: &str = include_str!("fixtures/tmdb-external-ids-bb.json");

#[test]
fn a_tmdb_keyed_videos_subtitles_are_asked_in_the_addons_own_spelling() {
    // The Stream's Video is TMDB's (`tmdb:1396:1:1`), so the fallback travels
    // in the spelling the Addon declares — `tt`, resolved through TMDB — the
    // same per-Addon bridge the Stream ask uses (ADR-0020). Without it a
    // TMDB-first Stream would quietly lose the subtitles an Addon-keyed one
    // gets.
    let player = Arc::new(FixturePlayer::new());
    let fetcher = Arc::new(
        FixtureFetcher::new()
            .serving(SUBS_TT, SUBS_TT_MANIFEST)
            .serving(SUBS_TT_EPISODE, SUBS_TT_BODY)
            .serving(TMDB_EXTERNAL_IDS_BB, TMDB_EXTERNAL_BB),
    );
    let mut host = Host::new(
        Arc::new(InMemoryStore::new()) as Arc<dyn Store>,
        fetcher.clone(),
        Arc::new(InMemorySecretStore::backed_by(SecretBackend::Keyring)),
        Arc::new(host_core::AddonProvider::new(fetcher.clone())),
        player.clone(),
        Arc::new(FixtureClock::new()),
    )
    .expect("a Host over a store starts");
    host.dispatch(action(
        &serde_json::json!({ "type": "add_addon", "url": SUBS_TT }),
    ))
    .expect("configuring the Addon should work");
    host.dispatch(action(
        &serde_json::json!({ "type": "set_tmdb_key", "key": TMDB_KEY }),
    ))
    .expect("entering a TMDB key should work");

    play(&mut host, SUBS_TT_ID, "series", "tmdb:1396:1:1");
    player.now_reporting(without_subtitles());
    host.sample()
        .expect("the Player's first report is a change");

    assert_eq!(
        added(&player),
        vec![(
            "https://subs.example.org/tt-ep.srt".to_owned(),
            Some("tt-ep-eng".to_owned()),
            Some("eng".to_owned()),
        )],
        "the subtitles arrive from the Addon the Video was asked of in its own spelling"
    );
    assert!(
        fetcher.asked().contains(&SUBS_TT_EPISODE.to_owned()),
        "the ask travelled as `tt0903747:1:1`: {:?}",
        fetcher.asked()
    );
}
