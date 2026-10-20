//! Previous episode, driven the way a client drives it: an Action in, published
//! Snapshots out, and the URL the Player was asked to open. The previous Video
//! is the Addon's own, not an id the Host works out by arithmetic — it stands
//! before the one playing in the Addon's whole-list order, crossing a season
//! boundary — and the release the one playing came from is preferred (ADR-0021).
//! Nothing below the Action surface is named here, and no test reaches the
//! network.

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
    // The Video before episode 1 of season 2 is the *last listed* episode of
    // season 1: the Addon's whole list is what defines order, and a season
    // boundary would be arithmetic the Addon never stated (ADR-0021).
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
fn the_addons_own_order_decides_what_precedes_even_where_the_numbers_do_not() {
    // S1E1 reads as the series' first numbered episode, and the Addon's list
    // still puts a special before it. The Host does not decide by the numbers —
    // the list decides — which is exactly why the client's S1E1 rule is a greyed
    // control and the press is what answers (ADR-0021).
    let specials = "https://stream.example.org/v/tt0903747-0-1.mkv";
    let player = Arc::new(FixturePlayer::new());
    let provider = Arc::new(
        FixtureProvider::new().offering(SERIES_ID, vec![candidate("1080p", specials, None)]),
    );
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
        "tt0903747:1:1",
        PLAYING,
        None,
    );
    host.dispatch(previous_episode())
        .expect("the Addon's own list has a Video before its first numbered episode");

    assert_eq!(
        player.opened(),
        vec![PLAYING.to_owned(), specials.to_owned()],
        "the order the Addon listed is the order the Host steps through"
    );
}

#[test]
fn when_the_release_is_gone_the_same_addons_first_playable_candidate_plays() {
    let player = Arc::new(FixturePlayer::new());
    let provider = Arc::new(FixtureProvider::new().offering(
        SERIES_ID,
        vec![
            torrent(
                "a torrent",
                "61065ea115b7cc3e8db9fb5ab1f6f327f08bd1c9",
                Some("the-release"),
            ),
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
fn the_first_listed_episode_is_refused_and_the_playing_stream_carries_on() {
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

    // The Addon's own list begins with its special, so nothing precedes it.
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
        "the Addon's order has nothing before the first episode, and the Host invents nothing"
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
    host.sample().expect("reaching the end is a change");

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
