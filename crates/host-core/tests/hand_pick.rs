//! The Hand pick (ADR-0041): a Track a client selected during playback is kept
//! as a language, or as "off", for the rest of the Title. It is carried into the
//! next episode — by Up next, by autoplay, by a step, or by another Stream of the
//! same Video — and honoured ahead of the lists; it ends on stop, on another
//! Title and on a Host restart; it never changes the lists. Driven the way a
//! client drives the Host, with a fake Player, a fake Clock and the in-memory
//! Provider; the ranking is tested where it lives, in `tracks.rs`.

use std::sync::Arc;

use host_core::{
    Action, FixtureClock, FixtureFetcher, FixturePlayer, FixtureProvider, Host,
    InMemorySecretStore, InMemoryStore, Observation, Playback, PlaybackState, SecretBackend,
    Snapshot, Store, Stream, StreamUrl, Subtitle, Telling, Track, TrackId, TrackKind,
    ACTION_VERSION,
};

const SERIES: &str = "https://series.example.org/manifest.json";
const SERIES_ID: &str = "org.example.series";
const META_URL: &str = "https://series.example.org/meta/series/tt0903747.json";
const SERIES_META: &str = include_str!("fixtures/cinemeta-meta-series.json");

/// After every air date the fixture lists, so the next episode has aired.
const NOW: i64 = FixtureClock::TODAY;

fn episode_url(episode: u32) -> String {
    format!("https://stream.example.org/v/tt0903747-1-{episode}.mkv")
}

fn action(body: &serde_json::Value) -> Action {
    let envelope = format!(r#"{{"version":{ACTION_VERSION},"action":{body}}}"#);
    Action::parse(&envelope).unwrap_or_else(|error| panic!("{envelope} should parse: {error}"))
}

fn manifest() -> String {
    format!(
        r#"{{"id":"{SERIES_ID}","name":"Series","version":"1.0.0",
             "resources":["meta","stream","subtitles"],"types":["movie","series"],
             "catalogs":[]}}"#
    )
}

fn candidates() -> Vec<Stream> {
    vec![Stream {
        name: Some("1080p".to_owned()),
        description: None,
        playback: Playback::Direct {
            url: episode_url(2),
        },
        warnings: Vec::new(),
        filename: None,
        binge_group: Some("the-release".to_owned()),
    }]
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
    clock: Arc<FixtureClock>,
    provider: Arc<FixtureProvider>,
}

fn fixture_over(store: Arc<InMemoryStore>, provider: FixtureProvider) -> Fixture {
    let player = Arc::new(FixturePlayer::new());
    let provider = Arc::new(provider);
    let clock = Arc::new(FixtureClock::new().at(NOW));
    let fetcher = FixtureFetcher::new()
        .serving(SERIES, manifest())
        .serving(META_URL, SERIES_META);
    let mut host = Host::new(
        store as Arc<dyn Store>,
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
    .expect("configuring the Addon works");
    Fixture {
        host,
        player,
        clock,
        provider,
    }
}

fn provider() -> FixtureProvider {
    FixtureProvider::new().offering(SERIES_ID, candidates())
}

fn fixture() -> Fixture {
    fixture_over(Arc::new(InMemoryStore::new()), provider())
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

/// What an episode of this release carries: English and Japanese soundtracks, an
/// English subtitle the file marks default (and mpv selects), a French one and
/// one that names no language.
fn tracks() -> Vec<Track> {
    vec![
        track(1, TrackKind::Audio, Some("eng"), true),
        track(2, TrackKind::Audio, Some("jpn"), false),
        Track {
            default: true,
            ..track(3, TrackKind::Subtitle, Some("eng"), true)
        },
        track(4, TrackKind::Subtitle, Some("fra"), false),
        track(5, TrackKind::Subtitle, None, false),
    ]
}

impl Fixture {
    fn dispatch(&mut self, body: serde_json::Value) {
        self.host
            .dispatch(action(&body))
            .unwrap_or_else(|error| panic!("{body} should work: {error}"));
    }

    fn set_subtitle_languages(&mut self, languages: &[&str]) {
        self.dispatch(serde_json::json!({
            "type": "set_subtitle_languages", "languages": languages
        }));
    }

    /// Play this Video of a Title the owner chose.
    fn play_video(&mut self, title: &str, video: &str, url: &str) {
        self.dispatch(serde_json::json!({
            "type": "play_stream",
            "video": { "type": "series", "id": video },
            "addon": SERIES_ID,
            "title": {
                "addon": SERIES_ID, "id": title, "type": "series",
                "name": title, "poster": null,
            },
            "stream": {
                "name": "1080p",
                "playback": { "kind": "direct", "url": url },
                "warnings": [],
                "bingeGroup": "the-release",
            },
        }));
    }

    fn play_episode(&mut self, episode: u32) {
        let video = format!("tt0903747:1:{episode}");
        self.play_video("tt0903747", &video, &episode_url(episode));
    }

    fn report(&mut self, state: PlaybackState, tracks: Vec<Track>) -> Option<Snapshot> {
        self.player.now_reporting(Observation {
            state,
            position: Some(12.5),
            duration: Some(2820.0),
            tracks: Some(tracks),
            ..Observation::idle()
        });
        self.host.sample()
    }

    /// The owner opens the series, so the Host knows the Videos of it, and
    /// watches an episode with these Tracks.
    fn watching(&mut self, episode: u32) {
        self.watching_with(episode, tracks());
    }

    fn watching_with(&mut self, episode: u32, tracks: Vec<Track>) {
        self.dispatch(serde_json::json!({
            "type": "open_title",
            "addon": SERIES_ID,
            "title": { "type": "series", "id": "tt0903747" },
        }));
        self.play_episode(episode);
        self.report(PlaybackState::Playing, tracks);
    }

    fn pick_subtitle(&mut self, track: Option<i64>) {
        self.dispatch(serde_json::json!({ "type": "set_subtitle_track", "track": track }));
    }

    fn pick_audio(&mut self, track: i64) {
        self.dispatch(serde_json::json!({ "type": "set_audio_track", "track": track }));
    }

    /// The episode reaches its end.
    fn finish(&mut self) {
        self.player.now_reporting(Observation {
            state: PlaybackState::Ended,
            position: Some(2820.0),
            duration: Some(2820.0),
            tracks: Some(tracks()),
            ..Observation::idle()
        });
        self.host.sample().expect("reaching the end is a change");
    }

    /// What the Host told the Player about Tracks from here on: `a<id>`, `s<id>`,
    /// `s-` for no subtitle, `+<id>` for an Addon subtitle added.
    fn told(&self) -> Vec<String> {
        self.player
            .tellings()
            .into_iter()
            .filter_map(|telling| match telling {
                Telling::AudioTrack(id) => Some(format!("a{}", id.0)),
                Telling::SubtitleTrack(Some(id)) => Some(format!("s{}", id.0)),
                Telling::SubtitleTrack(None) => Some("s-".to_owned()),
                Telling::AddSubtitle { title, .. } => {
                    Some(format!("+{}", title.unwrap_or_default()))
                }
                _ => None,
            })
            .collect()
    }

    /// Start counting what the Host tells the Player from this point.
    fn count_from_here(&self) {
        self.player.forget();
    }
}

#[test]
fn a_subtitle_picked_by_hand_starts_the_next_episode_by_up_next() {
    let mut fixture = fixture();
    fixture.watching(1);
    fixture.pick_subtitle(Some(4));
    fixture.finish();
    fixture.count_from_here();

    fixture.dispatch(serde_json::json!({
        "type": "play_up_next",
        "title": { "type": "series", "id": "tt0903747" },
    }));
    fixture.report(PlaybackState::Playing, tracks());

    assert_eq!(
        fixture.told(),
        ["s4"],
        "the French the owner picked, over the English mpv selected"
    );
}

#[test]
fn a_subtitle_picked_by_hand_starts_the_next_episode_by_autoplay() {
    let mut fixture = fixture();
    fixture.watching(1);
    fixture.pick_subtitle(Some(4));
    fixture.finish();
    fixture.count_from_here();

    fixture.clock.tick(5_000);
    fixture
        .host
        .sample()
        .expect("the countdown running out is news");
    assert_eq!(
        fixture.player.opened(),
        [episode_url(2)],
        "the next episode started by itself"
    );
    fixture.report(PlaybackState::Playing, tracks());

    assert_eq!(fixture.told(), ["s4"]);
}

#[test]
fn a_subtitle_picked_by_hand_starts_the_next_episode_by_a_step() {
    let mut fixture = fixture();
    fixture.watching(1);
    fixture.pick_subtitle(Some(4));
    fixture.count_from_here();

    fixture.dispatch(serde_json::json!({ "type": "next_episode" }));
    fixture.report(PlaybackState::Playing, tracks());

    assert_eq!(fixture.told(), ["s4"]);
}

#[test]
fn a_subtitle_picked_by_hand_survives_another_stream_of_the_same_video() {
    let mut fixture = fixture();
    fixture.watching(1);
    fixture.pick_subtitle(Some(4));
    fixture.count_from_here();

    fixture.play_episode(1);
    fixture.report(PlaybackState::Playing, tracks());

    assert_eq!(fixture.told(), ["s4"]);
}

#[test]
fn a_soundtrack_picked_by_hand_starts_the_next_episode() {
    let mut fixture = fixture();
    fixture.watching(1);
    fixture.pick_audio(2);
    fixture.count_from_here();

    fixture.dispatch(serde_json::json!({ "type": "next_episode" }));
    fixture.report(PlaybackState::Playing, tracks());

    assert_eq!(
        fixture.told(),
        ["a2"],
        "the Japanese the owner picked, over the English mpv selected"
    );
}

#[test]
fn a_hand_pick_beats_the_lists() {
    let mut fixture = fixture();
    fixture.set_subtitle_languages(&["en"]);
    fixture.watching(1);
    fixture.pick_subtitle(Some(4));
    fixture.count_from_here();

    fixture.dispatch(serde_json::json!({ "type": "next_episode" }));
    fixture.report(PlaybackState::Playing, tracks());

    assert_eq!(fixture.told(), ["s4"]);
}

#[test]
fn turning_subtitles_off_keeps_them_off_forced_included() {
    let mut fixture = fixture();
    fixture.watching(1);
    fixture.pick_subtitle(None);
    fixture.count_from_here();

    // The next file marks a forced English Track, which a followed file would
    // show; mpv has selected it.
    let mut next = tracks();
    next[2].forced = true;
    fixture.dispatch(serde_json::json!({ "type": "next_episode" }));
    fixture.report(PlaybackState::Playing, next);

    assert_eq!(fixture.told(), ["s-"]);
}

#[test]
fn an_episode_without_the_language_falls_back_to_the_lists_and_the_pick_stays() {
    let mut fixture = fixture_over(
        Arc::new(InMemoryStore::new()),
        provider().offering_subtitles(SERIES_ID, Vec::new()),
    );
    fixture.set_subtitle_languages(&["en"]);
    fixture.watching(1);
    fixture.pick_subtitle(Some(4));

    // Episode 2 has no French; mpv selected nothing.
    fixture.dispatch(serde_json::json!({ "type": "next_episode" }));
    fixture.count_from_here();
    let mut without_french = tracks();
    without_french.remove(3);
    without_french[2].selected = false;
    fixture.report(PlaybackState::Playing, without_french);
    assert_eq!(fixture.told(), ["s3"], "the list's English");

    // Episode 3 has it again.
    fixture.dispatch(serde_json::json!({ "type": "next_episode" }));
    fixture.count_from_here();
    fixture.report(PlaybackState::Playing, tracks());
    assert_eq!(
        fixture.told(),
        ["s4"],
        "the pick was kept for later episodes"
    );
}

#[test]
fn a_pick_of_a_track_with_no_language_carries_nothing() {
    let mut fixture = fixture();
    fixture.watching(1);
    fixture.pick_subtitle(Some(5));
    fixture.count_from_here();

    fixture.dispatch(serde_json::json!({ "type": "next_episode" }));
    fixture.report(PlaybackState::Playing, tracks());

    assert_eq!(
        fixture.told(),
        Vec::<String>::new(),
        "the file's own choice"
    );
}

#[test]
fn a_pick_of_a_tagless_track_the_title_calls_brazilian_carries_nothing() {
    // The title fills a region for a Track that has a language tag; it never
    // supplies the language, so there is nothing to carry.
    let mut fixture = fixture();
    let mut here = tracks();
    here[4].title = Some("Brazilian".to_owned());
    fixture.watching_with(1, here);
    fixture.pick_subtitle(Some(5));
    fixture.count_from_here();

    let mut next = tracks();
    next.push(track(6, TrackKind::Subtitle, Some("pob"), false));
    fixture.dispatch(serde_json::json!({ "type": "next_episode" }));
    fixture.report(PlaybackState::Playing, next);

    assert_eq!(
        fixture.told(),
        Vec::<String>::new(),
        "the file's own choice, not the pt-BR Track"
    );
}

#[test]
fn a_pick_on_a_regional_tag_outside_the_list_carries_to_the_curated_entry() {
    let mut fixture = fixture_over(
        Arc::new(InMemoryStore::new()),
        provider().offering_subtitles(SERIES_ID, Vec::new()),
    );
    let mut here = tracks();
    here[3].language = Some("fr-CA".to_owned());
    fixture.watching_with(1, here);
    fixture.pick_subtitle(Some(4));
    fixture.count_from_here();

    // Episode 2 tags its French `fra`.
    fixture.dispatch(serde_json::json!({ "type": "next_episode" }));
    fixture.report(PlaybackState::Playing, tracks());

    assert_eq!(fixture.told(), ["s4"]);
}

#[test]
fn a_pick_with_no_language_leaves_an_earlier_pick_where_it_was() {
    let mut fixture = fixture();
    fixture.watching(1);
    fixture.pick_subtitle(Some(4));
    fixture.pick_subtitle(Some(5));
    fixture.count_from_here();

    fixture.dispatch(serde_json::json!({ "type": "next_episode" }));
    fixture.report(PlaybackState::Playing, tracks());

    assert_eq!(fixture.told(), ["s4"]);
}

#[test]
fn stopping_ends_the_pick() {
    let mut fixture = fixture();
    fixture.watching(1);
    fixture.pick_subtitle(Some(4));
    fixture.dispatch(serde_json::json!({ "type": "stop_playback" }));
    fixture.count_from_here();

    fixture.play_episode(2);
    fixture.report(PlaybackState::Playing, tracks());

    assert_eq!(fixture.told(), Vec::<String>::new());
}

#[test]
fn another_title_ends_the_pick() {
    let mut fixture = fixture();
    fixture.watching(1);
    fixture.pick_subtitle(Some(4));

    fixture.play_video("tt0111161", "tt0111161:1:1", &episode_url(9));
    fixture.report(PlaybackState::Playing, tracks());
    fixture.count_from_here();

    // Back on the first Title: the pick did not wait for it.
    fixture.play_episode(2);
    fixture.report(PlaybackState::Playing, tracks());

    assert_eq!(fixture.told(), Vec::<String>::new());
}

#[test]
fn a_restarted_host_has_no_pick() {
    let store = Arc::new(InMemoryStore::new());
    let mut first = fixture_over(store.clone(), provider());
    first.watching(1);
    first.pick_subtitle(Some(4));

    let mut second = fixture_over(store, provider());
    second.play_episode(2);
    second.count_from_here();
    second.report(PlaybackState::Playing, tracks());

    assert_eq!(second.told(), Vec::<String>::new());
}

#[test]
fn a_hand_pick_never_changes_the_lists() {
    let mut fixture = fixture();
    fixture.set_subtitle_languages(&["en"]);
    fixture.watching(1);
    let before = fixture.host.snapshot().preferences;

    fixture.pick_subtitle(Some(4));
    fixture.pick_audio(2);

    let after = fixture.host.snapshot().preferences;
    assert_eq!(
        (after.subtitle_languages, after.audio_languages),
        (before.subtitle_languages, before.audio_languages)
    );
}

#[test]
fn a_pick_before_the_addon_tracks_arrive_means_no_switch() {
    let mut fixture = fixture_over(
        Arc::new(InMemoryStore::new()),
        provider().offering_subtitles(SERIES_ID, vec![offered("a-pob", "pob")]),
    );
    fixture.set_subtitle_languages(&["pt-BR", "en"]);
    fixture.watching(1);
    assert_eq!(fixture.told(), ["+a-pob"], "the Addon was asked for pt-BR");

    // The owner picks a subtitle before the Addon's arrives.
    fixture.pick_subtitle(Some(4));

    let mut with_added = tracks();
    with_added.push(Track {
        embedded: false,
        selected: false,
        ..track(6, TrackKind::Subtitle, Some("pob"), false)
    });
    fixture.report(PlaybackState::Playing, with_added);

    assert_eq!(
        fixture.told(),
        ["+a-pob", "s4"],
        "the Host's one switch is not made over a track the owner picked"
    );
}

#[test]
fn a_pick_of_a_language_the_file_lacks_asks_the_addons_on_the_next_stream() {
    let mut fixture = fixture_over(
        Arc::new(InMemoryStore::new()),
        provider().offering_subtitles(
            SERIES_ID,
            vec![offered("a-ja", "jpn"), offered("a-fra", "fra")],
        ),
    );
    fixture.watching(1);
    fixture.pick_subtitle(Some(4));
    fixture.count_from_here();

    // Episode 2 carries no French.
    fixture.dispatch(serde_json::json!({ "type": "next_episode" }));
    let mut without_french = tracks();
    without_french.remove(3);
    fixture.report(PlaybackState::Playing, without_french.clone());
    assert_eq!(
        fixture.told(),
        ["+a-fra"],
        "only the picked language is asked for, with no list at all"
    );

    // Once it is reported, the Host switches to it, once.
    without_french.push(Track {
        embedded: false,
        ..track(6, TrackKind::Subtitle, Some("fra"), false)
    });
    fixture.report(PlaybackState::Playing, without_french);
    assert_eq!(fixture.told(), ["+a-fra", "s6"]);
}

#[test]
fn a_pick_of_off_asks_no_addon_for_anything() {
    let mut fixture = fixture_over(
        Arc::new(InMemoryStore::new()),
        provider().offering_subtitles(SERIES_ID, vec![offered("a-ja", "jpn")]),
    );
    fixture.watching(1);
    fixture.pick_subtitle(None);
    fixture.count_from_here();
    let asked = fixture.provider.asked().len();

    fixture.dispatch(serde_json::json!({ "type": "next_episode" }));
    let mut bare = tracks();
    bare.retain(|track| track.kind == TrackKind::Audio);
    fixture.report(PlaybackState::Playing, bare);

    assert_eq!(
        fixture.provider.asked()[asked..].to_vec(),
        [SERIES_ID.to_owned()],
        "the next episode's own streams, and no subtitles"
    );
    assert_eq!(fixture.told(), Vec::<String>::new());
}
