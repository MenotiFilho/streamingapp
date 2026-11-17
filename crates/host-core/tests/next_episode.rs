//! Next episode, driven the way a client drives it: an Action in, published
//! Snapshots out, and the URL the Player was asked to open. The next Video is
//! the source's own, walked in the Host's series order — numbered seasons
//! ascending, specials last, and never a step across the line between them
//! (ADR-0039) — not an id the Host works out by arithmetic, and the release the
//! one playing came from is preferred (ADR-0014). Nothing below the Action
//! surface is named here, and no test reaches the network.

use std::sync::Arc;

use host_core::{
    Action, ActionError, AutoplayPhase, Control, FixtureClock, FixtureFetcher, FixturePlayer,
    FixtureProvider, Host, InMemorySecretStore, InMemoryStore, Observation, Playback,
    PlaybackState, SecretBackend, Store, Stream, ACTION_VERSION,
};

/// The Addon that answers both `meta` and `stream` for a series.
const SERIES: &str = "https://series.example.org/manifest.json";
const SERIES_ID: &str = "org.example.series";
const META_URL: &str = "https://series.example.org/meta/series/tt0903747.json";

/// An Addon that answers only `stream`: nothing here can say what comes next.
const STREAM_ONLY: &str = "https://streams.example.org/manifest.json";
const STREAM_ONLY_ID: &str = "org.example.streamonly";

const SERIES_META: &str = include_str!("fixtures/cinemeta-meta-series.json");

/// The URL the episode playing was chosen from, and two candidates for the one
/// after it: a different release first, the same release second.
const PLAYING: &str = "https://stream.example.org/v/tt0903747-1-1.mkv";
const OTHER_RELEASE: &str = "https://stream.example.org/v/tt0903747-1-2-720p.mkv";
const SAME_RELEASE: &str = "https://stream.example.org/v/tt0903747-1-2-1080p.mkv";

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
            "id": id,
            "type": r#type,
            "name": id,
            "poster": null,
        },
        "stream": stream,
    })))
    .unwrap_or_else(|error| panic!("playing a direct candidate should work: {error}"));
}

fn next_episode() -> Action {
    action(&serde_json::json!({ "type": "next_episode" }))
}

/// Enter a TMDB key the way the window's form does.
fn set_key(host: &mut Host, key: &str) {
    host.dispatch(action(
        &serde_json::json!({ "type": "set_tmdb_key", "key": key }),
    ))
    .unwrap_or_else(|error| panic!("entering a TMDB key should work: {error}"));
}

#[test]
fn the_next_episode_of_the_same_title_plays_from_the_same_addon_and_release() {
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
        "tt0903747:1:1",
        PLAYING,
        Some("the-release"),
    );

    let published = host
        .dispatch(next_episode())
        .expect("a recorded series has a next episode");
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
        Some(("tt0903747:1:2", SERIES_ID, Some("the-release"))),
        "every client is told of the new Now playing, and no URL is in it"
    );
    assert_eq!(
        provider.asked(),
        vec![SERIES_ID.to_owned()],
        "the Addon already playing is the one asked for the next episode's Streams"
    );
}

#[test]
fn a_stream_that_reached_its_end_can_still_step_to_the_next_episode() {
    // #68: the after-end Next is a real step from the Video that finished, not
    // a button the Host would refuse. The Stream is over, but its position in
    // the Addon's list is exactly what the next one is read from.
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
        "tt0903747:1:1",
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
    assert_eq!(
        ended
            .playback
            .autoplay
            .as_ref()
            .map(|autoplay| (autoplay.next.video.id.as_str(), &autoplay.phase)),
        Some((
            "tt0903747:1:2",
            &AutoplayPhase::Countdown {
                remaining: 5.0,
                duration: 5.0
            }
        )),
        "Autoplay is on by default: the end counts down to the very episode Next would play"
    );

    let stepped = host
        .dispatch(next_episode())
        .expect("a finished episode still has the one after it");

    assert_eq!(
        player.opened(),
        vec![PLAYING.to_owned(), SAME_RELEASE.to_owned()]
    );
    assert!(
        stepped.snapshots[0].playback.autoplay.is_none(),
        "pressing Next is the play the countdown was waiting for"
    );
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
        Some("the-release"),
    );
    host.dispatch(next_episode())
        .expect("the same Addon's first playable candidate is the fallback");

    assert_eq!(
        player.opened(),
        vec![PLAYING.to_owned(), OTHER_RELEASE.to_owned()],
        "an unplayable candidate for the same release is skipped, and the next playable one plays"
    );
}

#[test]
fn a_seasons_finale_steps_into_the_next_seasons_first_episode() {
    let player = Arc::new(FixturePlayer::new());
    let provider = Arc::new(FixtureProvider::new().offering(
        SERIES_ID,
        vec![candidate(
            "1080p",
            "https://stream.example.org/v/tt0903747-2-1.mkv",
            Some("the-release"),
        )],
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
        "tt0903747:1:3",
        "https://stream.example.org/v/tt0903747-1-3.mkv",
        Some("the-release"),
    );
    let published = host
        .dispatch(next_episode())
        .expect("a season finale is followed by the next season's first episode");

    assert_eq!(
        published.snapshots[0]
            .playback
            .now_playing
            .as_ref()
            .map(|now| now.video.id.as_str()),
        Some("tt0903747:2:1"),
        "the numbered seasons are one run, walked in ascending order"
    );
}

#[test]
fn the_series_last_numbered_episode_has_no_next_and_the_stream_keeps_playing() {
    let player = Arc::new(FixturePlayer::new());
    let provider = Arc::new(FixtureProvider::new().offering(
        SERIES_ID,
        vec![candidate(
            "1080p",
            "https://stream.example.org/v/tt0903747-0-1.mkv",
            Some("the-release"),
        )],
    ));
    let mut host = host_with(
        player.clone(),
        provider.clone(),
        &[
            Configured::answering(SERIES, SERIES_ID, r#""meta","stream""#)
                .with_meta(META_URL, SERIES_META),
        ],
    );

    // The last numbered Video. The Addon's list carries a special too, and the
    // step must not cross into it (ADR-0039 §2).
    play(
        &mut host,
        SERIES_ID,
        "series",
        "tt0903747:2:1",
        PLAYING,
        Some("the-release"),
    );
    player.now_reporting(Observation::playing(30.0, 2820.0));
    host.sample()
        .expect("the Player reporting where it is is a change");

    assert!(
        matches!(
            host.dispatch(next_episode()),
            Err(ActionError::NoNextEpisode { .. })
        ),
        "the series' last numbered episode has no next, and the Host will not step into the specials"
    );
    assert_eq!(
        player.opened(),
        vec![PLAYING.to_owned()],
        "a refusal opens nothing"
    );
    assert_eq!(player.stopped(), 0, "a refusal stops nothing");
    assert_eq!(
        host.snapshot().playback.state,
        PlaybackState::Playing,
        "the Stream that was playing keeps playing"
    );
    assert_eq!(
        host.snapshot().playback.position,
        Some(30.0),
        "the Stream that was playing is still where it was"
    );
    assert!(provider.asked().is_empty(), "no candidate is asked for");
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
fn inside_the_specials_next_steps_from_special_to_special_and_stops_at_their_end() {
    let player = Arc::new(FixturePlayer::new());
    let provider = Arc::new(FixtureProvider::new().offering(
        SERIES_ID,
        vec![candidate("1080p", SPECIAL_TWO, Some("the-release"))],
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
        "tt0903747:0:1",
        SPECIAL_ONE,
        Some("the-release"),
    );
    host.dispatch(next_episode())
        .expect("the first special is followed by the second");
    assert_eq!(
        player.opened(),
        vec![SPECIAL_ONE.to_owned(), SPECIAL_TWO.to_owned()]
    );

    assert!(
        matches!(
            host.dispatch(next_episode()),
            Err(ActionError::NoNextEpisode { .. })
        ),
        "the specials' last Video has no next"
    );
    assert_eq!(
        player.opened(),
        vec![SPECIAL_ONE.to_owned(), SPECIAL_TWO.to_owned()],
        "a refusal at the specials' end opens nothing"
    );
}

#[test]
fn the_numbered_seasons_never_step_into_the_specials() {
    let player = Arc::new(FixturePlayer::new());
    let provider = Arc::new(FixtureProvider::new());
    let mut host = host_with(
        player.clone(),
        provider.clone(),
        &[
            Configured::answering(SERIES, SERIES_ID, r#""meta","stream""#)
                .with_meta(META_URL, SPECIALS_META),
        ],
    );

    // The Addon listed the specials first; the Host's order puts this Video as
    // the last numbered one, and the special after it is not a next episode.
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
            host.dispatch(next_episode()),
            Err(ActionError::NoNextEpisode { .. })
        ),
        "a finale of the numbered seasons is refused rather than dropped into extras"
    );
    assert_eq!(player.opened(), vec![PLAYING.to_owned()]);
    assert!(provider.asked().is_empty());
}

#[test]
fn a_film_is_refused_because_it_has_no_next_episode() {
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
        "movie",
        "tt0133093",
        PLAYING,
        Some("the-release"),
    );

    assert!(
        matches!(
            host.dispatch(next_episode()),
            Err(ActionError::NoNextEpisode { .. })
        ),
        "a film is not an episode, and there is no next episode of it"
    );
}

#[test]
fn a_series_last_numbered_episode_is_refused() {
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

    // The recorded series' last numbered Video; the special the Addon also
    // lists stands apart, so the step is refused rather than crossing into it.
    play(
        &mut host,
        SERIES_ID,
        "series",
        "tt0903747:2:1",
        PLAYING,
        Some("the-release"),
    );

    assert!(
        matches!(
            host.dispatch(next_episode()),
            Err(ActionError::NoNextEpisode { .. })
        ),
        "the last numbered episode has no next, and the Host invents nothing"
    );
}

/// A second Addon that answers `meta` for the same Title with its own list:
/// the numbering hazard ADR-0020 recorded, made explicit.
const OTHER_SERIES: &str = "https://other.example.org/manifest.json";
const OTHER_SERIES_ID: &str = "org.example.other-series";
const OTHER_META_URL: &str = "https://other.example.org/meta/series/tt0903747.json";
const OTHER_META: &str = r#"{"meta":{"id":"tt0903747","type":"series","name":"Breaking Bad",
    "videos":[
        {"id":"tt0903747:1:1","name":"Pilot","season":1,"episode":1},
        {"id":"tt0903747:1:2","name":"Cat's in the Bag...","season":1,"episode":2}
    ]}}"#;

/// The same Title ending at its first episode, as the Addon already playing
/// lists it.
const FIRST_ONLY_META: &str = r#"{"meta":{"id":"tt0903747","type":"series","name":"Breaking Bad",
    "videos":[{"id":"tt0903747:1:1","name":"Pilot","season":1,"episode":1}]}}"#;

#[test]
fn the_first_addons_own_order_decides_even_where_another_lists_a_later_episode() {
    // Two Addons answer `meta`. The first lists the Video playing as its last
    // listed one, so *its* order decides and the Action is refused — a second
    // Addon listing an episode after it does not get to move the viewer into a
    // list whose order the Host never chose for what is playing (ADR-0020,
    // ADR-0014).
    let player = Arc::new(FixturePlayer::new());
    let provider = Arc::new(FixtureProvider::new());
    let mut host = host_with(
        player.clone(),
        provider.clone(),
        &[
            Configured::answering(SERIES, SERIES_ID, r#""meta","stream""#)
                .with_meta(META_URL, FIRST_ONLY_META),
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
            host.dispatch(next_episode()),
            Err(ActionError::NoNextEpisode { .. })
        ),
        "the first answering Addon's list ends at the Video playing"
    );
    assert_eq!(
        player.opened(),
        vec![PLAYING.to_owned()],
        "a refusal opens nothing, from any Addon"
    );
    assert!(
        provider.asked().is_empty(),
        "no candidate is asked for when the deciding list has no episode after the one playing"
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
        "tt0903747:1:1",
        PLAYING,
        Some("the-release"),
    );

    assert!(
        matches!(
            host.dispatch(next_episode()),
            Err(ActionError::NoNextEpisode { .. })
        ),
        "no Addon can say what comes next, so the Host will not guess"
    );
}

#[test]
fn a_next_episode_with_nothing_playing_is_refused_as_a_control() {
    let player = Arc::new(FixturePlayer::new());
    let provider = Arc::new(FixtureProvider::new());
    let mut host = host_with(player, provider, &[]);

    assert!(
        matches!(
            host.dispatch(next_episode()),
            Err(ActionError::NothingPlaying {
                control: Control::NextEpisode,
            })
        ),
        "a control with nothing live names itself, like every other control"
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
const NAMESPACED_NEXT: &str = "https://stream.example.org/v/kitsu-12345-1-2.mkv";

#[test]
fn a_title_whose_id_carries_a_namespace_still_has_a_next_episode() {
    // The Title id is whatever stands before the season and the episode, which
    // is not always one part: an Addon keyed by `kitsu:12345` indexes its
    // episodes as `kitsu:12345:1:1`, and reading only the first colon would
    // refuse every one of them.
    let player = Arc::new(FixturePlayer::new());
    let provider = Arc::new(FixtureProvider::new().offering(
        NAMESPACED_ID,
        vec![candidate("1080p", NAMESPACED_NEXT, Some("the-release"))],
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
        "kitsu:12345:1:1",
        PLAYING,
        Some("the-release"),
    );
    let published = host
        .dispatch(next_episode())
        .expect("a namespaced series has a next episode too");

    assert_eq!(
        published.snapshots[0]
            .playback
            .now_playing
            .as_ref()
            .map(|now| now.video.id.as_str()),
        Some("kitsu:12345:1:2"),
        "the next Video is the Addon's own, from the same Title the namespace names"
    );
}

// --- stepping a TMDB-keyed Video ---------------------------------------------

/// The Addons a TMDB-keyed episode is stepped and asked through, and the TMDB
/// answers that say what comes next. The Addon answers `stream` only: it is not
/// the source of the order, TMDB is.
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

/// The playing episode, and TMDB's next one, asked for at the URL the playing
/// Addon's own declaration gives: `tt`, resolved from TMDB's `/external_ids`.
const NEXT_EPISODE_STREAM: &str =
    "https://mediafusion.example.com/stream/series/tt0903747%3A1%3A2.json";
const NEXT_EPISODE_NEXT: &str = "https://stream.example.org/v/tt0903747-1-2-1080p.mkv";
const SEASON_TWO_STREAM: &str =
    "https://mediafusion.example.com/stream/series/tt0903747%3A2%3A1.json";
const SEASON_TWO_OPENING: &str = "https://stream.example.org/v/tt0903747-2-1-1080p.mkv";

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
fn a_tmdb_keyed_episode_steps_to_tmdbs_own_next_and_is_asked_in_the_playing_addons_spelling() {
    // The Video is TMDB's, so the list is TMDB's: the Addon cannot say what
    // comes next — it answers no `meta` at all — and the step still lands on
    // the episode the client's own Title screen was showing. The Stream ask
    // then travels in the spelling the playing Addon declares (ADR-0020).
    let player = Arc::new(FixturePlayer::new());
    let fetcher = Arc::new(
        FixtureFetcher::new()
            .serving(TMDB_STREAM_ADDON, TMDB_STREAM_ADDON_MANIFEST)
            .serving(
                NEXT_EPISODE_STREAM,
                format!(r#"{{"streams":[{{"name":"1080p","url":"{NEXT_EPISODE_NEXT}"}}]}}"#),
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
    set_key(&mut host, TMDB_KEY);
    // The Title card the play carries is the Addon's stream card: the Watch
    // progress entry that unifies the two ways in is keyed by the Video, and
    // the Addon is only what a later removal is judged against.
    play(
        &mut host,
        TMDB_STREAM_ADDON_ID,
        "series",
        "tmdb:1396:1:1",
        PLAYING,
        Some("the-release"),
    );

    let published = host
        .dispatch(next_episode())
        .expect("TMDB lists an episode after the one playing");

    assert_eq!(
        published.snapshots[0]
            .playback
            .now_playing
            .as_ref()
            .map(|now| now.video.id.as_str()),
        Some("tmdb:1396:1:2"),
        "the next Video is TMDB's own, keyed the way the one playing was"
    );
    assert_eq!(
        player.opened(),
        vec![PLAYING.to_owned(), NEXT_EPISODE_NEXT.to_owned()],
        "the release the one playing came from continues"
    );
    assert!(
        fetcher.asked().contains(&NEXT_EPISODE_STREAM.to_owned()),
        "the playing Addon was asked in the `tt` spelling it declares, resolved from TMDB: {:?}",
        fetcher.asked()
    );
    let asked = fetcher.asked();
    assert_eq!(
        asked
            .iter()
            .filter(|url| url.starts_with("https://api.themoviedb.org/3/tv/1396?"))
            .count(),
        1,
        "the step reads TMDB's list with the same batched details request, not one ask per season: {asked:?}"
    );
}

#[test]
fn a_tmdb_keyed_series_walks_its_numbered_seasons_and_stops_before_the_specials() {
    let player = Arc::new(FixturePlayer::new());
    let fetcher = Arc::new(
        FixtureFetcher::new()
            .serving(TMDB_STREAM_ADDON, TMDB_STREAM_ADDON_MANIFEST)
            .serving(
                SEASON_TWO_STREAM,
                format!(r#"{{"streams":[{{"name":"1080p","url":"{SEASON_TWO_OPENING}"}}]}}"#),
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
    set_key(&mut host, TMDB_KEY);
    play(
        &mut host,
        TMDB_STREAM_ADDON_ID,
        "series",
        "tmdb:1396:1:3",
        PLAYING,
        Some("the-release"),
    );

    host.dispatch(next_episode())
        .expect("TMDB's first season is followed by its second");
    assert_eq!(
        player.opened(),
        vec![PLAYING.to_owned(), SEASON_TWO_OPENING.to_owned()]
    );

    assert!(
        matches!(
            host.dispatch(next_episode()),
            Err(ActionError::NoNextEpisode { .. })
        ),
        "TMDB lists a special after the last numbered episode, and the step does not take it"
    );
    assert_eq!(
        player.opened(),
        vec![PLAYING.to_owned(), SEASON_TWO_OPENING.to_owned()],
        "the refusal opens nothing"
    );
}

#[test]
fn a_tmdb_keyed_film_has_no_next_episode() {
    let player = Arc::new(FixturePlayer::new());
    let fetcher =
        Arc::new(FixtureFetcher::new().serving(TMDB_STREAM_ADDON, TMDB_STREAM_ADDON_MANIFEST));
    let mut host = Host::new(
        Arc::new(InMemoryStore::new()) as Arc<dyn Store>,
        fetcher.clone(),
        Arc::new(InMemorySecretStore::backed_by(SecretBackend::Keyring)),
        Arc::new(host_core::AddonProvider::new(fetcher.clone())),
        player,
        Arc::new(FixtureClock::new()),
    )
    .expect("a Host over a store starts");
    host.dispatch(action(&serde_json::json!({
        "type": "add_addon",
        "url": TMDB_STREAM_ADDON,
    })))
    .expect("the Addon's manifest is recorded");
    play(
        &mut host,
        TMDB_STREAM_ADDON_ID,
        "movie",
        "tmdb:603",
        PLAYING,
        Some("the-release"),
    );

    assert!(
        matches!(
            host.dispatch(next_episode()),
            Err(ActionError::NoNextEpisode { .. })
        ),
        "a TMDB record for a film is one Video, and there is no next episode of it"
    );
}
