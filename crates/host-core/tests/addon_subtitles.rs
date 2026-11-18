//! Addon subtitles for the languages the file lacks (ADR-0041): with Subtitle
//! languages set, the Host asks the Addons once per Stream and only for the
//! listed languages the file does not carry, adds at most three of each, and
//! switches to the best of them once the added Tracks appear in a report. Driven
//! the way a client drives the Host, with a fake Player, a fake Clock and the
//! in-memory Provider; the ranking and the quota are tested where they live.

use std::sync::Arc;

use host_core::{
    Action, FixtureClock, FixtureFetcher, FixturePlayer, FixtureProvider, Host,
    InMemorySecretStore, InMemoryStore, Observation, PlaybackState, SecretBackend, Store,
    StreamUrl, Subtitle, Telling, Track, TrackId, TrackKind, ACTION_VERSION,
    MAX_FALLBACK_SUBTITLES,
};

const SUBS_A: &str = "https://subs-a.example.org/manifest.json";
const SUBS_B: &str = "https://subs-b.example.org/manifest.json";
const ADDON_A: &str = "org.example.subsA";
const ADDON_B: &str = "org.example.subsB";

fn manifest(id: &str) -> String {
    format!(
        r#"{{"id":"{id}","name":"{id}","version":"1.0.0",
             "resources":["stream","subtitles"],"types":["movie","series"],"catalogs":[]}}"#
    )
}

fn action(body: &serde_json::Value) -> Action {
    let envelope = format!(r#"{{"version":{ACTION_VERSION},"action":{body}}}"#);
    Action::parse(&envelope).unwrap_or_else(|error| panic!("{envelope} should parse: {error}"))
}

fn offered(id: &str, language: &str) -> Subtitle {
    Subtitle {
        id: Some(id.to_owned()),
        url: StreamUrl::parse(&format!("https://subs.example.org/{id}.srt"))
            .expect("a subtitle URL"),
        language: Some(language.to_owned()),
    }
}

struct Fixture {
    host: Host,
    player: Arc<FixturePlayer>,
    provider: Arc<FixtureProvider>,
}

fn fixture(provider: FixtureProvider) -> Fixture {
    let player = Arc::new(FixturePlayer::new());
    let provider = Arc::new(provider);
    let fetcher = FixtureFetcher::new()
        .serving(SUBS_A, manifest(ADDON_A))
        .serving(SUBS_B, manifest(ADDON_B));
    let mut host = Host::new(
        Arc::new(InMemoryStore::new()) as Arc<dyn Store>,
        Arc::new(fetcher),
        Arc::new(InMemorySecretStore::backed_by(SecretBackend::Keyring)),
        provider.clone(),
        player.clone(),
        Arc::new(FixtureClock::new()),
    )
    .expect("a Host over a store starts");
    for url in [SUBS_A, SUBS_B] {
        host.dispatch(action(
            &serde_json::json!({ "type": "add_addon", "url": url }),
        ))
        .expect("configuring an Addon works");
    }
    Fixture {
        host,
        player,
        provider,
    }
}

impl Fixture {
    fn set_subtitle_languages(&mut self, languages: &[&str]) {
        self.host
            .dispatch(action(
                &serde_json::json!({"type": "set_subtitle_languages", "languages": languages}),
            ))
            .expect("setting Subtitle languages works");
    }

    fn play(&mut self) {
        self.host
            .dispatch(action(&serde_json::json!({
                "type": "play_stream",
                "video": { "type": "movie", "id": "tt0133093" },
                "addon": ADDON_A,
                "title": {
                    "addon": ADDON_A,
                    "id": "tt0133093",
                    "type": "movie",
                    "name": "The Matrix",
                    "poster": null,
                },
                "stream": {
                    "name": "1080p",
                    "playback": { "kind": "direct", "url": "https://stream.example.org/v/x.mkv" },
                    "warnings": [],
                },
            })))
            .expect("playing a direct candidate works");
    }

    fn report(&mut self, state: PlaybackState, tracks: Option<Vec<Track>>) {
        self.player.now_reporting(Observation {
            state,
            position: Some(12.5),
            duration: Some(600.0),
            tracks,
            ..Observation::idle()
        });
        self.host.sample();
    }

    /// What the Host told the Player about subtitles, in order: `+<id>` for a
    /// file added (by the Addon's own word for it), `s<id>` for a Track
    /// selected, `s-` for none.
    fn told(&self) -> Vec<String> {
        self.player
            .tellings()
            .into_iter()
            .filter_map(|telling| match telling {
                Telling::AddSubtitle { title, .. } => {
                    Some(format!("+{}", title.unwrap_or_default()))
                }
                Telling::SubtitleTrack(Some(id)) => Some(format!("s{}", id.0)),
                Telling::SubtitleTrack(None) => Some("s-".to_owned()),
                _ => None,
            })
            .collect()
    }
}

fn track(id: i64, kind: TrackKind, language: &str, embedded: bool, selected: bool) -> Track {
    Track {
        id: TrackId(id),
        kind,
        language: Some(language.to_owned()),
        title: None,
        codec: Some("x".to_owned()),
        embedded,
        selected,
        default: false,
        forced: false,
        hearing_impaired: false,
    }
}

fn audio(id: i64, language: &str) -> Track {
    track(id, TrackKind::Audio, language, true, true)
}

fn embedded_subtitle(id: i64, language: &str, selected: bool) -> Track {
    track(id, TrackKind::Subtitle, language, true, selected)
}

fn added_subtitle(id: i64, language: &str) -> Track {
    track(id, TrackKind::Subtitle, language, false, false)
}

/// English audio, English subtitles embedded, and nothing selected.
fn only_english() -> Vec<Track> {
    vec![audio(1, "eng"), embedded_subtitle(2, "eng", false)]
}

fn both_addons() -> FixtureProvider {
    FixtureProvider::new()
        .offering_subtitles(
            ADDON_A,
            vec![
                offered("a-eng", "eng"),
                offered("a-pob", "pob"),
                offered("a-ja", "jpn"),
            ],
        )
        .offering_subtitles(
            ADDON_B,
            vec![offered("b-por", "por"), offered("b-eng", "eng")],
        )
}

#[test]
fn english_shows_at_once_and_only_the_missing_language_is_fetched() {
    let mut fixture = fixture(both_addons());
    fixture.set_subtitle_languages(&["pt-BR", "en"]);
    fixture.play();

    fixture.report(PlaybackState::Playing, Some(only_english()));

    assert_eq!(
        fixture.told(),
        ["s2", "+a-pob", "+b-por"],
        "English is chosen first, then only pt-BR files are added, in Addon order"
    );
    assert_eq!(
        fixture.provider.asked(),
        [ADDON_A, ADDON_B],
        "every Addon, once"
    );
}

#[test]
fn at_most_three_are_added_per_missing_language_in_addon_order() {
    let provider = FixtureProvider::new()
        .offering_subtitles(
            ADDON_A,
            vec![
                offered("a1", "pob"),
                offered("a2", "pob"),
                offered("a3", "eng"),
                offered("a4", "pob"),
            ],
        )
        .offering_subtitles(ADDON_B, vec![offered("b1", "pob"), offered("b2", "jpn")]);
    let mut fixture = fixture(provider);
    fixture.set_subtitle_languages(&["pt-BR"]);
    fixture.play();

    fixture.report(PlaybackState::Playing, Some(vec![audio(1, "eng")]));

    assert_eq!(fixture.told(), ["+a1", "+a2", "+a4"]);
}

#[test]
fn nothing_is_asked_when_the_file_carries_every_listed_language() {
    let mut fixture = fixture(both_addons());
    fixture.set_subtitle_languages(&["pt-BR", "en"]);
    fixture.play();

    fixture.report(
        PlaybackState::Playing,
        Some(vec![
            audio(1, "eng"),
            embedded_subtitle(2, "por", false),
            embedded_subtitle(3, "eng", false),
        ]),
    );

    assert!(fixture.provider.asked().is_empty());
}

#[test]
fn a_region_strict_miss_in_the_file_is_still_asked_for() {
    let mut fixture = fixture(both_addons());
    fixture.set_subtitle_languages(&["pt-BR"]);
    fixture.play();

    fixture.report(
        PlaybackState::Playing,
        Some(vec![audio(1, "eng"), embedded_subtitle(2, "pt-PT", false)]),
    );

    assert_eq!(fixture.provider.asked(), [ADDON_A, ADDON_B]);
}

#[test]
fn the_host_switches_once_to_the_addon_subtitle_when_the_added_tracks_appear() {
    let mut fixture = fixture(both_addons());
    fixture.set_subtitle_languages(&["pt-BR", "en"]);
    fixture.play();
    fixture.report(PlaybackState::Playing, Some(only_english()));
    assert_eq!(fixture.told(), ["s2", "+a-pob", "+b-por"]);

    // The Addon subtitles are in the report now: pt-BR (exact) and por.
    let mut with_added = only_english();
    with_added[1].selected = true;
    with_added.push(added_subtitle(3, "pob"));
    with_added.push(added_subtitle(4, "por"));
    fixture.report(PlaybackState::Playing, Some(with_added.clone()));
    assert_eq!(
        fixture.told(),
        ["s2", "+a-pob", "+b-por", "s3"],
        "the first Addon pt-BR, which the list ranks above English"
    );

    // Never again on this Stream, whatever the Player reports.
    with_added[1].selected = false;
    with_added[2].selected = false;
    fixture.report(PlaybackState::Playing, Some(with_added));
    assert_eq!(fixture.told().len(), 4);
}

#[test]
fn nothing_is_switched_when_the_addons_add_nothing() {
    let provider = FixtureProvider::new()
        .offering_subtitles(ADDON_A, vec![offered("a-ja", "jpn")])
        .offering_subtitles(ADDON_B, vec![]);
    let mut fixture = fixture(provider);
    fixture.set_subtitle_languages(&["pt-BR", "en"]);
    fixture.play();
    fixture.report(PlaybackState::Playing, Some(only_english()));
    assert_eq!(fixture.told(), ["s2"]);

    fixture.report(PlaybackState::Playing, Some(only_english()));
    let mut grown = only_english();
    grown.push(added_subtitle(9, "jpn"));
    fixture.report(PlaybackState::Playing, Some(grown));

    assert_eq!(fixture.told(), ["s2"], "no Addon subtitle, no switch");
}

#[test]
fn an_addon_subtitle_that_ranks_below_what_shows_changes_nothing() {
    // `[en, pt-BR]`: English is embedded and ranks first, and the Addon pt-BR
    // that arrives is asked for (the file lacks it) but is not the better one.
    let mut fixture = fixture(both_addons());
    fixture.set_subtitle_languages(&["en", "pt-BR"]);
    fixture.play();
    fixture.report(PlaybackState::Playing, Some(only_english()));
    assert_eq!(fixture.told(), ["s2", "+a-pob", "+b-por"]);

    let mut with_added = only_english();
    with_added[1].selected = true;
    with_added.push(added_subtitle(3, "pob"));
    fixture.report(PlaybackState::Playing, Some(with_added));

    assert_eq!(fixture.told().len(), 3, "the answer did not differ");
}

#[test]
fn a_report_without_the_added_tracks_does_not_spend_the_switch() {
    let mut fixture = fixture(both_addons());
    fixture.set_subtitle_languages(&["pt-BR", "en"]);
    fixture.play();
    fixture.report(PlaybackState::Playing, Some(only_english()));

    // Not there yet: the same report again, and one that could not be read.
    fixture.report(PlaybackState::Playing, Some(only_english()));
    fixture.report(PlaybackState::Playing, None);
    assert_eq!(fixture.told(), ["s2", "+a-pob", "+b-por"]);

    let mut with_added = only_english();
    with_added.push(added_subtitle(3, "pob"));
    with_added.push(added_subtitle(4, "por"));
    fixture.report(PlaybackState::Playing, Some(with_added));
    assert_eq!(fixture.told().last().map(String::as_str), Some("s3"));
}

#[test]
fn the_next_stream_is_asked_about_and_switched_afresh() {
    let mut fixture = fixture(both_addons());
    fixture.set_subtitle_languages(&["pt-BR", "en"]);
    let mut with_added = only_english();
    with_added.push(added_subtitle(3, "pob"));
    with_added.push(added_subtitle(4, "por"));

    fixture.play();
    fixture.report(PlaybackState::Playing, Some(only_english()));
    fixture.report(PlaybackState::Playing, Some(with_added.clone()));

    fixture.play();
    fixture.report(PlaybackState::Playing, Some(only_english()));
    fixture.report(PlaybackState::Playing, Some(with_added));

    assert_eq!(
        fixture.told(),
        ["s2", "+a-pob", "+b-por", "s3", "s2", "+a-pob", "+b-por", "s3"]
    );
    assert_eq!(fixture.provider.asked().len(), 4);
}

#[test]
fn a_track_list_that_could_not_be_read_leaves_the_attempt_unmade() {
    let mut fixture = fixture(both_addons());
    fixture.set_subtitle_languages(&["pt-BR"]);
    fixture.play();

    fixture.report(PlaybackState::Playing, None);
    assert!(fixture.provider.asked().is_empty());

    fixture.report(PlaybackState::Playing, Some(only_english()));
    assert_eq!(fixture.provider.asked(), [ADDON_A, ADDON_B]);
}

// --- follow the file ---------------------------------------------------------

fn many_offers() -> FixtureProvider {
    let spread = |prefix: &str| -> Vec<Subtitle> {
        ["eng", "por", "fre", "ger"]
            .iter()
            .map(|tag| offered(&format!("{prefix}-{tag}"), tag))
            .collect()
    };
    FixtureProvider::new()
        .offering_subtitles(ADDON_A, spread("a"))
        .offering_subtitles(ADDON_B, spread("b"))
}

#[test]
fn an_empty_list_asks_only_when_the_file_has_no_subtitle_and_adds_five_selecting_none() {
    let mut fixture = fixture(many_offers());
    fixture.play();

    fixture.report(PlaybackState::Playing, Some(vec![audio(1, "eng")]));

    assert_eq!(MAX_FALLBACK_SUBTITLES, 5);
    assert_eq!(
        fixture.told(),
        ["+a-eng", "+a-por", "+a-fre", "+a-ger", "+b-eng"],
        "five, in Addon order, whatever their language, and none selected"
    );

    // The added Tracks appearing is not a reason to select one.
    let mut with_added = vec![audio(1, "eng")];
    with_added.extend((0..5).map(|n| added_subtitle(2 + n, "eng")));
    fixture.report(PlaybackState::Playing, Some(with_added));
    assert_eq!(fixture.told().len(), 5);
}

#[test]
fn an_empty_list_never_asks_about_a_file_that_has_a_subtitle() {
    let mut fixture = fixture(many_offers());
    fixture.play();

    fixture.report(PlaybackState::Playing, Some(only_english()));

    assert!(fixture.provider.asked().is_empty());
}
