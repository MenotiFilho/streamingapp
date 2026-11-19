//! Previous episode, driven the way a client drives it: an Action in, published
//! Snapshots out, and the URL the Player was asked to open. The previous Video
//! is the source's own, walked in the Host's series order — numbered seasons
//! ascending, specials last, and never a step across the line between them
//! (ADR-0039 §2) — not an id the Host works out by arithmetic, and the release
//! the one playing came from is preferred (ADR-0021). Nothing below the Action
//! surface is named here, and no test reaches the network.

use std::sync::Arc;

use host_core::{
    Action, ActionError, Control, Episode, FixtureClock, FixtureFetcher, FixturePlayer,
    FixtureProvider, Host, InMemorySecretStore, InMemoryStore, Observation, Playback,
    PlaybackState, SecretBackend, Store, Stream, ACTION_VERSION,
};

/// The Addon that answers both `meta` and `stream` for a series.
const SERIES: &str = "https://series.example.org/manifest.json";
const SERIES_ID: &str = "org.example.series";
const META_URL: &str = "https://series.example.org/meta/series/tt0903747.json";

/// An Addon that answers only `stream`: nothing here can say what precedes.
const STREAM_ONLY: &str = "https://streams.example.org/manifest.json";
const STREAM_ONLY_ID: &str = "org.example.streamonly";

const SERIES_META: &str = include_str!("fixtures/cinemeta-meta-series.json");

/// The URL the episode playing was chosen from, and two candidates for the one
/// before it: a different release first, the same release second.
/// A candidate's URL this Host will not open: not `http`, so it is listed and
/// never played.
const UNOPENABLE: &str = "ftp://stream.example.org/v/unopenable.mkv";

const PLAYING: &str = "https://stream.example.org/v/tt0903747-2-1.mkv";
const OTHER_RELEASE: &str = "https://stream.example.org/v/tt0903747-1-3-720p.mkv";
const SAME_RELEASE: &str = "https://stream.example.org/v/tt0903747-1-3-1080p.mkv";

/// A manifest that answers these resources for films and series.
fn manifest(id: &str, resources: &str) -> String {
    format!(
        r#"{{"id":"{id}","name":"{id}","version":"1.0.0",
             "resources":[{resources}],"types":["movie","series"],"catalogs":[]}}"#
    )
}

/// An Action as a client sends it: the versioned envelope, as JSON text.
fn action(body: &serde_json::Value) -> Action {
    let envelope = format!(r#"{{"version":{ACTION_VERSION},"action":{body}}}"#);
    Action::parse(&envelope).unwrap_or_else(|error| panic!("{envelope} should parse: {error}"))
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

/// One Addon a test configures: where its manifest lives, the manifest itself,
/// and the meta answer it serves, if any.
struct Configured<'a> {
    url: &'a str,
    manifest: String,
    meta: Option<(&'a str, &'a str)>,
}

impl<'a> Configured<'a> {
    /// An Addon answering these resources, with no meta answer.
    fn answering(url: &'a str, id: &str, resources: &str) -> Self {
        Self {
            url,
            manifest: manifest(id, resources),
            meta: None,
        }
    }

    /// The same, serving this meta answer at this URL.
    fn with_meta(mut self, meta_url: &'a str, body: &'a str) -> Self {
        self.meta = Some((meta_url, body));
        self
    }
}

/// A Host over an empty store, this Player and this Provider, with these Addons
/// configured in the order given.
fn host_with(
    player: Arc<FixturePlayer>,
    provider: Arc<FixtureProvider>,
    addons: &[Configured],
) -> Host {
    let mut fetcher = FixtureFetcher::new();
    for addon in addons {
        fetcher = fetcher.serving(addon.url, addon.manifest.clone());
        if let Some((meta_url, body)) = addon.meta {
            fetcher = fetcher.serving(meta_url, body.to_string());
        }
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

    for addon in addons {
        host.dispatch(action(
            &serde_json::json!({ "type": "add_addon", "url": addon.url }),
        ))
        .unwrap_or_else(|error| panic!("configuring {} should work: {error}", addon.url));
    }
    host
}

/// Choose a playable candidate to be playing.
fn play(host: &mut Host, addon: &str, r#type: &str, id: &str, url: &str, binge: Option<&str>) {
    let mut stream = serde_json::json!({
        "name": "1080p",
        "playback": { "kind": "direct", "url": url },
        "warnings": [],
    });
    if let Some(binge) = binge {
        stream["bingeGroup"] = serde_json::Value::String(binge.to_owned());
    }

    host.dispatch(action(&serde_json::json!({
        "type": "play_stream",
        "video": { "type": r#type, "id": id },
        "addon": addon,
        "title": {
            "addon": addon,
            "id": if r#type == "series" { "tt0903747" } else { id },
            "type": r#type,
            "name": id,
            "poster": null,
        },
        "stream": stream,
    })))
    .unwrap_or_else(|error| panic!("playing a direct candidate should work: {error}"));
}

fn previous_episode() -> Action {
    action(&serde_json::json!({ "type": "previous_episode" }))
}

#[test]
fn the_previous_episode_plays_from_the_same_addon_and_release_across_a_season_boundary() {
    // The Video before episode 1 of season 2 is the *last* episode of season
    // 1: the numbered seasons are one run, ascending, with each season's own
    // order kept (ADR-0039 §1).
    let player = Arc::new(FixturePlayer::new());
    let provider = Arc::new(FixtureProvider::new().offering(
        SERIES_ID,
        vec![
            candidate("720p", OTHER_RELEASE, Some("another-release")),
            candidate("1080p", SAME_RELEASE, Some("the-release")),
        ],
    ));
    let mut host = host_with(
        player.clone(),
        provider.clone(),
        &[
            Configured::answering(SERIES, SERIES_ID, r#""meta","stream""#)
                .with_meta(META_URL, SERIES_META),
        ],
    );

    play(
        &mut host,
        SERIES_ID,
        "series",
        "tt0903747:2:1",
        PLAYING,
        Some("the-release"),
    );

    let published = host
        .dispatch(previous_episode())
        .expect("a recorded series has a previous episode");
    assert_eq!(
        player.opened(),
        vec![PLAYING.to_owned(), SAME_RELEASE.to_owned()],
        "the same release is preferred over an earlier candidate, so the binge continues"
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
        Some(("tt0903747:1:3", SERIES_ID, Some("the-release"))),
        "the Video before S2E1 in the Addon's own order is S1E3"
    );
    assert_eq!(
        provider.asked(),
        vec![SERIES_ID.to_owned()],
        "the Addon already playing is the one asked for the previous episode's Streams"
    );
}

/// The Addon's own list, which the fixture records, begins with a special:
/// `tt0903747:0:1`, then season 1 from its first episode.
#[test]
fn the_pilot_is_refused_although_the_addon_listed_a_special_before_it() {
    // S1E1 is a series' first numbered episode, and the Addon's list puts a
    // special before it. The Host's order moves the specials after the numbered
    // seasons, and a step never crosses that line — the specials are entered
    // only by pressing one (ADR-0039 §2).
    let specials = "https://stream.example.org/v/tt0903747-0-1.mkv";
    let player = Arc::new(FixturePlayer::new());
    let provider = Arc::new(
        FixtureProvider::new().offering(SERIES_ID, vec![candidate("1080p", specials, None)]),
    );
    let mut host = host_with(
        player.clone(),
        provider.clone(),
        &[
            Configured::answering(SERIES, SERIES_ID, r#""meta","stream""#)
                .with_meta(META_URL, SERIES_META),
        ],
    );

    play(
        &mut host,
        SERIES_ID,
        "series",
        "tt0903747:1:1",
        PLAYING,
        None,
    );
    player.now_reporting(Observation::playing(30.0, 2820.0));
    host.sample()
        .expect("the Player reporting where it is is a change");

    assert!(
        matches!(
            host.dispatch(previous_episode()),
            Err(ActionError::NoPreviousEpisode { .. })
        ),
        "the first numbered episode has no previous, and the specials are not it"
    );
    assert_eq!(
        player.opened(),
        vec![PLAYING.to_owned()],
        "a refusal opens nothing"
    );
    assert_eq!(player.stopped(), 0, "a refusal stops nothing");
    assert_eq!(
        host.snapshot().playback.position,
        Some(30.0),
        "the Stream that was playing is still where it was"
    );
    assert!(
        provider.asked().is_empty(),
        "no candidate is asked for when the step is refused"
    );
}

/// A series whose Addon lists the specials first, then one numbered season:
/// the order ADR-0039 exists for.
const SPECIALS_META: &str = r#"{"meta":{"id":"tt0903747","type":"series","name":"Breaking Bad",
    "videos":[
        {"id":"tt0903747:0:1","name":"Special One","season":0,"episode":1},
        {"id":"tt0903747:0:2","name":"Special Two","season":0,"episode":2},
        {"id":"tt0903747:1:1","name":"Pilot","season":1,"episode":1}
    ]}}"#;

const SPECIAL_ONE: &str = "https://stream.example.org/v/tt0903747-0-1.mkv";
const SPECIAL_TWO: &str = "https://stream.example.org/v/tt0903747-0-2.mkv";

#[test]
fn inside_the_specials_previous_steps_from_special_to_special_and_stops_at_their_start() {
    let player = Arc::new(FixturePlayer::new());
    let provider = Arc::new(FixtureProvider::new().offering(
        SERIES_ID,
        vec![candidate("1080p", SPECIAL_ONE, Some("the-release"))],
    ));
    let mut host = host_with(
        player.clone(),
        provider.clone(),
        &[
            Configured::answering(SERIES, SERIES_ID, r#""meta","stream""#)
                .with_meta(META_URL, SPECIALS_META),
        ],
    );

    play(
        &mut host,
        SERIES_ID,
        "series",
        "tt0903747:0:2",
        SPECIAL_TWO,
        Some("the-release"),
    );
    host.dispatch(previous_episode())
        .expect("the second special is preceded by the first");
    assert_eq!(
        player.opened(),
        vec![SPECIAL_TWO.to_owned(), SPECIAL_ONE.to_owned()]
    );

    assert!(
        matches!(
            host.dispatch(previous_episode()),
            Err(ActionError::NoPreviousEpisode { .. })
        ),
        "the specials' first Video has no previous"
    );
    assert_eq!(
        player.opened(),
        vec![SPECIAL_TWO.to_owned(), SPECIAL_ONE.to_owned()],
        "a refusal at the specials' start opens nothing"
    );
}

#[test]
fn when_the_release_is_gone_the_same_addons_first_playable_candidate_plays() {
    let player = Arc::new(FixturePlayer::new());
    let provider = Arc::new(FixtureProvider::new().offering(
        SERIES_ID,
        vec![
            candidate("a Stream no Player opens", UNOPENABLE, Some("the-release")),
            candidate("720p", OTHER_RELEASE, Some("another-release")),
        ],
    ));
    let mut host = host_with(
        player.clone(),
        provider,
        &[
            Configured::answering(SERIES, SERIES_ID, r#""meta","stream""#)
                .with_meta(META_URL, SERIES_META),
        ],
    );

    play(
        &mut host,
        SERIES_ID,
        "series",
        "tt0903747:2:1",
        PLAYING,
        Some("the-release"),
    );
    host.dispatch(previous_episode())
        .expect("the same Addon's first playable candidate is the fallback");

    assert_eq!(
        player.opened(),
        vec![PLAYING.to_owned(), OTHER_RELEASE.to_owned()],
        "an unplayable candidate for the same release is skipped, and the next playable one plays"
    );
}

#[test]
fn a_film_is_refused_because_it_has_no_previous_episode() {
    let player = Arc::new(FixturePlayer::new());
    let provider = Arc::new(FixtureProvider::new());
    let mut host = host_with(
        player.clone(),
        provider,
        &[
            Configured::answering(SERIES, SERIES_ID, r#""meta","stream""#)
                .with_meta(META_URL, SERIES_META),
        ],
    );

    play(
        &mut host,
        SERIES_ID,
        "movie",
        "tt0133093",
        PLAYING,
        Some("the-release"),
    );
    // The film is where a test can read it: a refusal must not disturb it
    // either, and not only the series' first listed episode is refused.
    player.now_reporting(host_core::Observation::playing(30.0, 8100.0));
    host.sample()
        .expect("the Player reporting where it is is a change");

    assert!(
        matches!(
            host.dispatch(previous_episode()),
            Err(ActionError::NoPreviousEpisode { .. })
        ),
        "a film is not an episode, and there is no previous episode of it"
    );
    assert_eq!(
        player.opened(),
        vec![PLAYING.to_owned()],
        "a refusal opens nothing"
    );
    assert_eq!(player.stopped(), 0, "a refusal stops nothing");
    assert_eq!(
        host.snapshot().playback.position,
        Some(30.0),
        "the Stream that was playing is still where it was"
    );
}

#[test]
fn the_first_special_has_no_previous_because_specials_stand_apart() {
    let player = Arc::new(FixturePlayer::new());
    let provider = Arc::new(FixtureProvider::new());
    let mut host = host_with(
        player.clone(),
        provider,
        &[
            Configured::answering(SERIES, SERIES_ID, r#""meta","stream""#)
                .with_meta(META_URL, SERIES_META),
        ],
    );

    // The fixture lists one special ahead of the numbered seasons; the Host's
    // order puts it last, and it does not step back into the numbered run.
    play(
        &mut host,
        SERIES_ID,
        "series",
        "tt0903747:0:1",
        PLAYING,
        Some("the-release"),
    );
    // The Player reports where it is, so that "keeps playing" is a state a test
    // can read rather than an open still in flight.
    player.now_reporting(host_core::Observation::playing(30.0, 2820.0));
    host.sample()
        .expect("the Player reporting where it is is a change");

    assert!(
        matches!(
            host.dispatch(previous_episode()),
            Err(ActionError::NoPreviousEpisode { .. })
        ),
        "the specials' first Video has no previous, and the numbered seasons are not it"
    );
    assert_eq!(
        player.opened(),
        vec![PLAYING.to_owned()],
        "a refusal opens nothing"
    );
    assert_eq!(player.stopped(), 0, "a refusal stops nothing");

    let playing = host.snapshot().playback;
    assert_eq!(playing.state, PlaybackState::Playing);
    assert_eq!(
        playing.position,
        Some(30.0),
        "the Stream that was playing is still where it was"
    );
    assert_eq!(
        playing
            .now_playing
            .as_ref()
            .map(|now| now.video.id.as_str()),
        Some("tt0903747:0:1"),
        "the Stream that was playing keeps playing"
    );
}

#[test]
fn a_setup_where_no_addon_answers_meta_is_refused() {
    let player = Arc::new(FixturePlayer::new());
    let provider = Arc::new(FixtureProvider::new().offering(
        STREAM_ONLY_ID,
        vec![candidate("1080p", OTHER_RELEASE, Some("the-release"))],
    ));
    let mut host = host_with(
        player,
        provider,
        &[Configured::answering(
            STREAM_ONLY,
            STREAM_ONLY_ID,
            r#""stream""#,
        )],
    );

    play(
        &mut host,
        STREAM_ONLY_ID,
        "series",
        "tt0903747:2:1",
        PLAYING,
        Some("the-release"),
    );

    assert!(
        matches!(
            host.dispatch(previous_episode()),
            Err(ActionError::NoPreviousEpisode { .. })
        ),
        "no Addon can say what precedes, so the Host will not guess"
    );
}

#[test]
fn a_previous_episode_with_nothing_playing_is_refused_as_a_control() {
    let player = Arc::new(FixturePlayer::new());
    let provider = Arc::new(FixtureProvider::new());
    let mut host = host_with(player, provider, &[]);

    assert!(
        matches!(
            host.dispatch(previous_episode()),
            Err(ActionError::NothingPlaying {
                control: Control::PreviousEpisode,
            })
        ),
        "a control with nothing live names itself, like every other control"
    );
}

#[test]
fn a_stream_that_reached_its_end_can_still_step_to_the_previous_episode() {
    // #68's mirror: a finished episode is still a position in its Title, so
    // stepping back from it is not a control on a Stream that is over.
    let player = Arc::new(FixturePlayer::new());
    let provider = Arc::new(FixtureProvider::new().offering(
        SERIES_ID,
        vec![candidate("1080p", SAME_RELEASE, Some("the-release"))],
    ));
    let mut host = host_with(
        player.clone(),
        provider,
        &[
            Configured::answering(SERIES, SERIES_ID, r#""meta","stream""#)
                .with_meta(META_URL, SERIES_META),
        ],
    );

    play(
        &mut host,
        SERIES_ID,
        "series",
        "tt0903747:2:1",
        PLAYING,
        Some("the-release"),
    );
    player.now_reporting(Observation {
        state: PlaybackState::Ended,
        position: Some(2820.0),
        duration: Some(2820.0),
        ..Observation::idle()
    });
    let ended = host.sample().expect("reaching the end is a change");
    assert!(
        ended.playback.autoplay.is_none(),
        "the series' last numbered episode has nothing to count down to, so Previous is all it offers"
    );

    host.dispatch(previous_episode())
        .expect("a finished episode still has the one before it");

    assert_eq!(
        player.opened(),
        vec![PLAYING.to_owned(), SAME_RELEASE.to_owned()]
    );
}

/// A second Addon that answers `meta` for the same Title with its own list:
/// the numbering hazard ADR-0020 recorded, made explicit.
const OTHER_SERIES: &str = "https://other.example.org/manifest.json";
const OTHER_SERIES_ID: &str = "org.example.other-series";
const OTHER_META_URL: &str = "https://other.example.org/meta/series/tt0903747.json";
const OTHER_META: &str = r#"{"meta":{"id":"tt0903747","type":"series","name":"Breaking Bad",
    "videos":[
        {"id":"tt0903747:0:1","name":"Special","season":0,"episode":1},
        {"id":"tt0903747:1:1","name":"Pilot","season":1,"episode":1}
    ]}}"#;

/// The same Title with nothing before its first episode, as the Addon already
/// playing lists it.
const SERIES_FIRST_META: &str = r#"{"meta":{"id":"tt0903747","type":"series","name":"Breaking Bad",
    "videos":[{"id":"tt0903747:1:1","name":"Pilot","season":1,"episode":1}]}}"#;

#[test]
fn the_first_addons_own_order_decides_even_where_another_lists_an_earlier_episode() {
    // Two Addons answer `meta`. The first lists the Video playing as its first
    // listed one, so *its* order decides and the Action is refused — a second
    // Addon listing a special before it does not get to move the viewer into a
    // list whose order the Host never chose for what is playing (ADR-0020,
    // ADR-0021).
    let player = Arc::new(FixturePlayer::new());
    let provider = Arc::new(FixtureProvider::new());
    let mut host = host_with(
        player.clone(),
        provider.clone(),
        &[
            Configured::answering(SERIES, SERIES_ID, r#""meta","stream""#)
                .with_meta(META_URL, SERIES_FIRST_META),
            Configured::answering(OTHER_SERIES, OTHER_SERIES_ID, r#""meta","stream""#)
                .with_meta(OTHER_META_URL, OTHER_META),
        ],
    );

    play(
        &mut host,
        SERIES_ID,
        "series",
        "tt0903747:1:1",
        PLAYING,
        Some("the-release"),
    );

    assert!(
        matches!(
            host.dispatch(previous_episode()),
            Err(ActionError::NoPreviousEpisode { .. })
        ),
        "the first answering Addon's list begins at the Video playing"
    );
    assert_eq!(
        player.opened(),
        vec![PLAYING.to_owned()],
        "a refusal opens nothing, from any Addon"
    );
    assert!(
        provider.asked().is_empty(),
        "no candidate is asked for when the deciding list has no episode before the one playing"
    );
}

/// A Title whose own id carries a namespace: real Addons key one this way
/// (`kitsu:12345`), and its episodes are then `kitsu:12345:1:1` — four parts,
/// not three.
const NAMESPACED_ID: &str = "org.example.namespaced";
const NAMESPACED: &str = "https://namespaced.example.org/manifest.json";
const NAMESPACED_META_URL: &str = "https://namespaced.example.org/meta/series/kitsu%3A12345.json";
const NAMESPACED_META: &str = r#"{"meta":{"id":"kitsu:12345","type":"series","name":"A Series",
    "videos":[
        {"id":"kitsu:12345:1:1","name":"First","season":1,"episode":1},
        {"id":"kitsu:12345:1:2","name":"Second","season":1,"episode":2}
    ]}}"#;
const NAMESPACED_PREVIOUS: &str = "https://stream.example.org/v/kitsu-12345-1-1.mkv";

#[test]
fn a_title_whose_id_carries_a_namespace_still_has_a_previous_episode() {
    // The Title id is whatever stands before the season and the episode, which
    // is not always one part: an Addon keyed by `kitsu:12345` indexes its
    // episodes as `kitsu:12345:1:1`, and reading only the first colon would
    // refuse every one of them.
    let player = Arc::new(FixturePlayer::new());
    let provider = Arc::new(FixtureProvider::new().offering(
        NAMESPACED_ID,
        vec![candidate("1080p", NAMESPACED_PREVIOUS, Some("the-release"))],
    ));
    let mut host = host_with(
        player.clone(),
        provider,
        &[
            Configured::answering(NAMESPACED, NAMESPACED_ID, r#""meta","stream""#)
                .with_meta(NAMESPACED_META_URL, NAMESPACED_META),
        ],
    );

    play(
        &mut host,
        NAMESPACED_ID,
        "series",
        "kitsu:12345:1:2",
        PLAYING,
        Some("the-release"),
    );
    let published = host
        .dispatch(previous_episode())
        .expect("a namespaced series has a previous episode too");

    assert_eq!(
        published.snapshots[0]
            .playback
            .now_playing
            .as_ref()
            .map(|now| now.video.id.as_str()),
        Some("kitsu:12345:1:1"),
        "the previous Video is the Addon's own, from the same Title the namespace names"
    );
}

#[test]
fn the_reading_publishes_which_episode_is_playing_and_a_film_has_none() {
    let player = Arc::new(FixturePlayer::new());
    let provider = Arc::new(FixtureProvider::new());
    let mut host = host_with(
        player,
        provider,
        &[
            Configured::answering(SERIES, SERIES_ID, r#""meta","stream""#)
                .with_meta(META_URL, SERIES_META),
        ],
    );

    play(
        &mut host,
        SERIES_ID,
        "series",
        "tt0903747:1:2",
        PLAYING,
        Some("the-release"),
    );
    let published = serde_json::to_value(host.snapshot().playback).expect("it serializes");
    assert_eq!(
        published["episode"],
        serde_json::json!({ "season": 1, "episode": 2 }),
        "the Host's own reading of the Video's id, beside Now playing and not inside it"
    );
    assert_eq!(
        host.snapshot().playback.episode,
        Some(Episode {
            season: 1,
            episode: 2
        })
    );

    play(
        &mut host,
        SERIES_ID,
        "movie",
        "tt0133093",
        PLAYING,
        Some("the-release"),
    );
    assert_eq!(
        host.snapshot().playback.episode,
        None,
        "a film's id is not an episode's shape, so there is no position to publish"
    );
}

// --- stepping a TMDB-keyed Video ---------------------------------------------

/// The Addon a TMDB-keyed episode is stepped and asked through. It answers
/// `stream` only: it is not the source of the order, TMDB is.
const TMDB_STREAM_ADDON: &str = "https://mediafusion.example.com/manifest.json";
const TMDB_STREAM_ADDON_ID: &str = "community.mediafusion";
const TMDB_STREAM_ADDON_MANIFEST: &str = r#"{
    "id": "community.mediafusion",
    "name": "MediaFusion",
    "version": "4.0.0",
    "resources": [
        { "name": "stream", "types": ["movie", "series"], "idPrefixes": ["tt"] }
    ],
    "types": ["movie", "series"],
    "catalogs": []
}"#;

/// The episode playing, the one before it, and the Addon's `tt` spelling the
/// Stream ask is resolved to through TMDB.
const PREVIOUS_EPISODE_STREAM: &str =
    "https://mediafusion.example.com/stream/series/tt0903747%3A1%3A1.json";
const PREVIOUS_EPISODE_PREV: &str = "https://stream.example.org/v/tt0903747-1-1-1080p.mkv";

const TMDB_KEY: &str = "0123456789abcdef0123456789abcdef";
/// The one request a series' details and its Videos are read with.
const TMDB_TV_1396: &str = concat!(
    "https://api.themoviedb.org/3/tv/1396?append_to_response=",
    "season/0,season/1,season/2,season/3,season/4,season/5,season/6,season/7,",
    "season/8,season/9,season/10,season/11,season/12,season/13,season/14,season/15,",
    "season/16,season/17,season/18,season/19",
    "&api_key=0123456789abcdef0123456789abcdef",
);
const TMDB_EXTERNAL_IDS_BB: &str =
    "https://api.themoviedb.org/3/tv/1396/external_ids?api_key=0123456789abcdef0123456789abcdef";

const TMDB_TV_DETAILS_APPENDED: &str = include_str!("fixtures/tmdb-tv-details-appended.json");
const TMDB_EXTERNAL_BB: &str = include_str!("fixtures/tmdb-external-ids-bb.json");

#[test]
fn a_tmdb_keyed_episode_steps_to_tmdbs_own_previous_with_the_batched_read() {
    // The Video is TMDB's, so the list is TMDB's: the Addon answers no `meta`
    // at all, and the step still lands on the episode the client's own Title
    // screen was showing. The list is read with the same batched details
    // request the Title screen uses (ADR-0038 §4).
    let player = Arc::new(FixturePlayer::new());
    let fetcher = Arc::new(
        FixtureFetcher::new()
            .serving(TMDB_STREAM_ADDON, TMDB_STREAM_ADDON_MANIFEST)
            .serving(
                PREVIOUS_EPISODE_STREAM,
                format!(r#"{{"streams":[{{"name":"1080p","url":"{PREVIOUS_EPISODE_PREV}"}}]}}"#),
            )
            .serving(TMDB_TV_1396, TMDB_TV_DETAILS_APPENDED)
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
    host.dispatch(action(&serde_json::json!({
        "type": "add_addon",
        "url": TMDB_STREAM_ADDON,
    })))
    .expect("the Addon's manifest is recorded");
    host.dispatch(action(
        &serde_json::json!({ "type": "set_tmdb_key", "key": TMDB_KEY }),
    ))
    .expect("entering a TMDB key should work");
    play(
        &mut host,
        TMDB_STREAM_ADDON_ID,
        "series",
        "tmdb:1396:1:2",
        PLAYING,
        Some("the-release"),
    );

    let published = host
        .dispatch(previous_episode())
        .expect("TMDB lists an episode before the one playing");

    assert_eq!(
        published.snapshots[0]
            .playback
            .now_playing
            .as_ref()
            .map(|now| now.video.id.as_str()),
        Some("tmdb:1396:1:1"),
        "the previous Video is TMDB's own, keyed the way the one playing was"
    );
    assert_eq!(
        player.opened(),
        vec![PLAYING.to_owned(), PREVIOUS_EPISODE_PREV.to_owned()],
        "the release the one playing came from continues"
    );
    let asked = fetcher.asked();
    assert!(
        asked.contains(&PREVIOUS_EPISODE_STREAM.to_owned()),
        "the playing Addon was asked in the `tt` spelling it declares, resolved from TMDB: {asked:?}"
    );
    assert_eq!(
        asked
            .iter()
            .filter(|url| url.starts_with("https://api.themoviedb.org/3/tv/1396?"))
            .count(),
        1,
        "the step reads TMDB's list with one batched details request: {asked:?}"
    );
}
