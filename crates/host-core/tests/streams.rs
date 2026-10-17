//! Choosing a Stream, driven the way a client drives it: an Action in, an
//! Answer out. Nothing below the Action surface is named here, and nothing in
//! this file reaches the network: every fetch is a recorded fixture, and every
//! rule the fixtures cannot carry is driven through a fake Provider.

use std::sync::Arc;

use host_core::{
    Action, ActionError, AddonProvider, AddonStreams, FetchError, FixtureClock, FixtureFetcher,
    FixturePlayer, FixtureProvider, Host, InMemorySecretStore, InMemoryStore, Playback, Provider,
    Response, SecretBackend, Store, Stream, Warning, ACTION_VERSION,
};

/// A Player a test drives by hand: nothing plays unless a test says so, and
/// every telling is remembered.
fn player() -> Arc<FixturePlayer> {
    Arc::new(FixturePlayer::new())
}

/// A clock a test drives by hand, for the Watch progress a play records (#29).
fn clock() -> Arc<FixtureClock> {
    Arc::new(FixtureClock::new())
}

/// The recorded Addons. Cinemeta and Stremboxd answer metadata; Torrentio and
/// WatchHub answer `stream`.
const CINEMETA: &str = "https://v3-cinemeta.strem.io/manifest.json";
const STREMBOXD: &str = "https://api.stremboxd.com/manifest.json";
const TORRENTIO: &str = "https://torrentio.strem.fun/manifest.json";
const WATCHHUB: &str = "https://watchhub.strem.io/manifest.json";
const AIOSTREAMS: &str = "https://aiostreams.example.com/manifest.json";

const TORRENTIO_MOVIE: &str = "https://torrentio.strem.fun/stream/movie/tt0133093.json";
const TORRENTIO_EPISODE: &str = "https://torrentio.strem.fun/stream/series/tt0903747%3A1%3A1.json";
const WATCHHUB_MOVIE: &str = "https://watchhub.strem.io/stream/movie/tt0133093.json";
const WATCHHUB_EPISODE: &str = "https://watchhub.strem.io/stream/series/tt0903747%3A1%3A1.json";
const AIOSTREAMS_MOVIE: &str = "https://aiostreams.example.com/stream/movie/tt0133093.json";

/// The Addons the per-Addon id bridge is driven with: one that declares `tt`,
/// one that declares `tmdb:` beside it, and one that declares neither — the
/// three outcomes ADR-0020 names.
const MEDIAFUSION: &str = "https://mediafusion.example.com/manifest.json";
const ANIMESCRAPER: &str = "https://animescraper.example.org/manifest.json";

const MEDIAFUSION_MOVIE: &str = "https://mediafusion.example.com/stream/movie/tmdb%3A603.json";
const MEDIAFUSION_EPISODE: &str =
    "https://mediafusion.example.com/stream/series/tmdb%3A1396%3A1%3A2.json";
const AIOSTREAMS_EPISODE: &str =
    "https://aiostreams.example.com/stream/series/tt0903747%3A1%3A2.json";

/// The owner's TMDB credential, as the v3 api-key shape the Host takes.
const TMDB_KEY: &str = "0123456789abcdef0123456789abcdef";
const TMDB_EXTERNAL_IDS_MATRIX: &str =
    "https://api.themoviedb.org/3/movie/603/external_ids?api_key=0123456789abcdef0123456789abcdef";
const TMDB_EXTERNAL_IDS_BB: &str =
    "https://api.themoviedb.org/3/tv/1396/external_ids?api_key=0123456789abcdef0123456789abcdef";

const CINEMETA_MANIFEST: &str = include_str!("fixtures/cinemeta-manifest.json");
const STREMBOXD_MANIFEST: &str = include_str!("fixtures/stremboxd-manifest.json");
const TORRENTIO_MANIFEST: &str = include_str!("fixtures/torrentio-manifest.json");
const WATCHHUB_MANIFEST: &str = include_str!("fixtures/watchhub-manifest.json");
const AIOSTREAMS_MANIFEST: &str = include_str!("fixtures/aiostreams-manifest.json");
const MEDIAFUSION_MANIFEST: &str = include_str!("fixtures/mediafusion-manifest.json");
const ANIMESCRAPER_MANIFEST: &str = include_str!("fixtures/animescraper-manifest.json");

const TORRENTIO_STREAMS: &str = include_str!("fixtures/torrentio-streams-matrix.json");
const TORRENTIO_EPISODE_STREAMS: &str = include_str!("fixtures/torrentio-streams-bb-s1e1.json");
const WATCHHUB_STREAMS: &str = include_str!("fixtures/watchhub-streams-matrix.json");
const WATCHHUB_EPISODE_STREAMS: &str = include_str!("fixtures/watchhub-streams-bb-s1e1.json");
const DIRECT_STREAMS: &str = include_str!("fixtures/streams-direct-url.json");
const HOSTILE_STREAMS: &str = include_str!("fixtures/hostile-streams.json");
const EXTERNAL_MATRIX: &str = include_str!("fixtures/tmdb-external-ids-matrix.json");
const EXTERNAL_BB: &str = include_str!("fixtures/tmdb-external-ids-bb.json");

/// A body a `tmdb:`-declaring Addon answers with. Written by hand: what the
/// tests assert about is the spelling the request travelled in.
const MEDIAFUSION_STREAMS: &str = r#"{"streams":[
    {"name":"MediaFusion\ntmdb","url":"https://stream.example.org/v/tmdb.mkv"}
]}"#;

/// An Action as a client sends it: the versioned envelope, as JSON text.
fn action(body: &serde_json::Value) -> Action {
    let envelope = format!(r#"{{"version":{ACTION_VERSION},"action":{body}}}"#);
    Action::parse(&envelope).unwrap_or_else(|error| panic!("{envelope} should parse: {error}"))
}

/// Find a Video's Streams, the way pressing play on one does.
fn find(r#type: &str, id: &str) -> Action {
    action(&serde_json::json!({
        "type": "find_streams",
        "video": { "type": r#type, "id": id },
    }))
}

fn streams(response: &Response) -> &[AddonStreams] {
    response.streams().unwrap_or_else(|| {
        panic!("an Action that asked for Streams answers with them: {response:?}")
    })
}

/// The candidates of one group, by the Addon's own name for them.
fn names(group: &AddonStreams) -> Vec<&str> {
    group
        .streams
        .iter()
        .filter_map(|stream| stream.name.as_deref())
        .collect()
}

/// A Host needs somewhere to look a credential up; tests hold theirs here.
fn secrets() -> Arc<InMemorySecretStore> {
    Arc::new(InMemorySecretStore::backed_by(SecretBackend::Keyring))
}

/// A Host over an empty store, this fetcher and this Provider.
fn host_over(fetcher: Arc<FixtureFetcher>, provider: Arc<dyn Provider>) -> Host {
    Host::new(
        Arc::new(InMemoryStore::new()) as Arc<dyn Store>,
        fetcher,
        secrets(),
        provider,
        player(),
        clock(),
    )
    .expect("a Host over a store starts")
}

/// The real Provider over this fetcher: the Stremio addon protocol.
fn addon_provider(fetcher: &Arc<FixtureFetcher>) -> Arc<dyn Provider> {
    Arc::new(AddonProvider::new(fetcher.clone()))
}

/// Everything the recorded Addons answer, under the URLs they answer on.
fn recorded_fetcher() -> FixtureFetcher {
    FixtureFetcher::new()
        .serving(CINEMETA, CINEMETA_MANIFEST)
        .serving(STREMBOXD, STREMBOXD_MANIFEST)
        .serving(TORRENTIO, TORRENTIO_MANIFEST)
        .serving(WATCHHUB, WATCHHUB_MANIFEST)
        .serving(AIOSTREAMS, AIOSTREAMS_MANIFEST)
        .serving(TORRENTIO_MOVIE, TORRENTIO_STREAMS)
        .serving(TORRENTIO_EPISODE, TORRENTIO_EPISODE_STREAMS)
        .serving(WATCHHUB_MOVIE, WATCHHUB_STREAMS)
        .serving(WATCHHUB_EPISODE, WATCHHUB_EPISODE_STREAMS)
        .serving(AIOSTREAMS_MOVIE, DIRECT_STREAMS)
}

fn configure(host: &mut Host, url: &str) {
    host.dispatch(action(
        &serde_json::json!({ "type": "add_addon", "url": url }),
    ))
    .unwrap_or_else(|error| panic!("configuring {url} should work: {error}"));
}

/// A Host with the recorded Addons configured, the way their owner would have.
fn host_with_recorded_addons() -> (Host, Arc<FixtureFetcher>) {
    let fetcher = Arc::new(recorded_fetcher());
    let mut host = host_over(fetcher.clone(), addon_provider(&fetcher));
    configure(&mut host, CINEMETA);
    configure(&mut host, STREMBOXD);
    configure(&mut host, TORRENTIO);
    configure(&mut host, WATCHHUB);
    (host, fetcher)
}

/// Enter a TMDB key the way the window's form does.
fn set_tmdb_key(host: &mut Host, key: &str) {
    host.dispatch(action(
        &serde_json::json!({ "type": "set_tmdb_key", "key": key }),
    ))
    .unwrap_or_else(|error| panic!("entering a TMDB key should work: {error}"));
}

#[test]
fn asking_for_a_films_streams_asks_every_addon_that_answers_and_no_other() {
    let (mut host, fetcher) = host_with_recorded_addons();
    let asked_before = fetcher.asked().len();

    let response = host
        .dispatch(find("movie", "tt0133093"))
        .expect("finding a recorded film's Streams should work");

    assert_eq!(
        fetcher.asked()[asked_before..].to_vec(),
        vec![TORRENTIO_MOVIE, WATCHHUB_MOVIE],
        "the Addons that answer `stream` are asked at the item's own path, in the \
         configured order; the metadata Addons are not asked at all"
    );
    assert_eq!(
        streams(&response)
            .iter()
            .map(|group| group.addon.as_str())
            .collect::<Vec<_>>(),
        vec!["com.stremio.torrentio.addon", "org.stremio.watchhub"],
    );
}

#[test]
fn a_recorded_answers_candidates_arrive_in_the_addons_own_order() {
    let (mut host, _fetcher) = host_with_recorded_addons();

    let response = host
        .dispatch(find("movie", "tt0133093"))
        .expect("finding a recorded film's Streams should work");
    let group = &streams(&response)[0];

    assert_eq!(group.failure, None);
    assert_eq!(
        names(group),
        vec![
            "Torrentio\n4k DV | HDR",
            "Torrentio\n4k HDR",
            "Torrentio\n4k HDR",
            "Torrentio\n4k HDR",
            "Torrentio\n4k HDR",
        ],
        "no Host-side re-ranking: the Addon's order is the order, badges and all"
    );
    assert_eq!(
        group.streams[0].filename.as_deref(),
        Some("Матрица.1999.WEB-DL.2160p.mkv"),
        "the filename comes from the candidate's own behaviourHints"
    );
    assert!(
        group
            .streams
            .iter()
            .all(|stream| matches!(stream.playback, Playback::InfoHash { .. })),
        "a torrent is a candidate this Host cannot open yet"
    );
}

#[test]
fn a_candidate_the_host_can_play_comes_through_with_its_badges_and_filename() {
    // A debrid answer: direct URLs. Written by hand rather than recorded,
    // because a recorded one would carry someone's debrid session in it.
    let fetcher = Arc::new(recorded_fetcher());
    let mut host = host_over(fetcher.clone(), addon_provider(&fetcher));
    configure(&mut host, AIOSTREAMS);

    let response = host
        .dispatch(find("movie", "tt0133093"))
        .expect("finding a recorded film's Streams should work");
    let group = &streams(&response)[0];

    assert_eq!(group.addon.as_str(), "community.aiostreams");
    assert_eq!(group.streams.len(), 2);
    assert_eq!(
        group.streams[0].playback,
        Playback::Direct {
            url: "https://stream.example.org/v/tt0133093-1080p-abc123.mkv".to_owned(),
        },
        "a direct URL is playable as itself"
    );
    assert_eq!(group.streams[0].name.as_deref(), Some("AIOStreams\n1080p"));
    assert_eq!(
        group.streams[0].filename.as_deref(),
        Some("The.Matrix.1999.1080p.BluRay.x265-GROUP.mkv")
    );
    assert_eq!(
        group.streams[1].warnings,
        vec![Warning::NotWebReady, Warning::ProxyHeaders],
        "hints are surfaced beside the candidate, and the candidate stays"
    );
}

#[test]
fn a_series_asks_for_the_episodes_own_id() {
    let (mut host, fetcher) = host_with_recorded_addons();
    let asked_before = fetcher.asked().len();

    let response = host
        .dispatch(find("series", "tt0903747:1:1"))
        .expect("finding a recorded episode's Streams should work");

    assert_eq!(
        fetcher.asked()[asked_before..].to_vec(),
        vec![TORRENTIO_EPISODE, WATCHHUB_EPISODE],
        "an episode is asked for by its own id, season and episode and all"
    );
    let torrentio = &streams(&response)[0];
    assert_eq!(torrentio.addon.as_str(), "com.stremio.torrentio.addon");
    assert_eq!(
        torrentio.streams[0].filename.as_deref(),
        Some("Breaking Bad  S01E01  Pilot.mkv")
    );
}

#[test]
fn one_addons_failing_answer_still_shows_what_the_others_returned() {
    let fetcher =
        Arc::new(recorded_fetcher().failing(WATCHHUB_MOVIE, FetchError::Status { status: 503 }));
    let mut host = host_over(fetcher.clone(), addon_provider(&fetcher));
    configure(&mut host, TORRENTIO);
    configure(&mut host, WATCHHUB);

    let response = host
        .dispatch(find("movie", "tt0133093"))
        .expect("one Addon being down is not a failed question");
    let groups = streams(&response);

    assert_eq!(groups.len(), 2);
    assert_eq!(groups[0].addon.as_str(), "com.stremio.torrentio.addon");
    assert_eq!(names(&groups[0])[0], "Torrentio\n4k DV | HDR");
    assert_eq!(
        groups[0].streams.len(),
        5,
        "the Addon that answered keeps its candidates: {groups:?}"
    );
    assert_eq!(groups[0].failure, None);
    assert!(groups[1].streams.is_empty());
    assert!(
        matches!(&groups[1].failure, Some(ActionError::Fetch { detail }) if detail.contains("503")),
        "the Addon that did not answer says why, in its own group: {groups:?}"
    );
}

#[test]
fn an_answer_that_lies_is_that_addons_failure_rather_than_the_answers() {
    let fetcher = Arc::new(recorded_fetcher().serving(TORRENTIO_MOVIE, HOSTILE_STREAMS));
    let mut host = host_over(fetcher.clone(), addon_provider(&fetcher));
    configure(&mut host, TORRENTIO);
    configure(&mut host, WATCHHUB);

    let response = host
        .dispatch(find("movie", "tt0133093"))
        .expect("a body that is not a stream response is one Addon's trouble");
    let groups = streams(&response);

    assert!(groups[0].streams.is_empty());
    assert!(
        matches!(
            &groups[0].failure,
            Some(ActionError::Stream { detail }) if detail.contains("streams should be an array")
        ),
        "the group says the answer could not be read: {groups:?}"
    );
    assert_eq!(
        groups[1].addon.as_str(),
        "org.stremio.watchhub",
        "the other Addon's answer is unaffected"
    );
}

#[test]
fn finding_streams_publishes_no_snapshot_and_moves_no_revision() {
    // Which Streams a client is being offered is that client's own business
    // (ADR-0005), so finding them is a question like browsing: no Snapshot, and
    // the revision stands still.
    let (mut host, _fetcher) = host_with_recorded_addons();
    let before = host.snapshot();

    let response = host
        .dispatch(find("movie", "tt0133093"))
        .expect("finding a recorded film's Streams should work");

    assert!(
        response.snapshots.is_empty(),
        "a question publishes nothing: {:?}",
        response.snapshots
    );
    assert_eq!(host.snapshot(), before);
}

#[test]
fn finding_streams_for_a_tmdb_film_asks_every_addon_in_its_own_spelling() {
    let fetcher = Arc::new(
        recorded_fetcher()
            .serving(MEDIAFUSION, MEDIAFUSION_MANIFEST)
            .serving(ANIMESCRAPER, ANIMESCRAPER_MANIFEST)
            .serving(TMDB_EXTERNAL_IDS_MATRIX, EXTERNAL_MATRIX)
            .serving(MEDIAFUSION_MOVIE, MEDIAFUSION_STREAMS),
    );
    let mut host = host_over(fetcher.clone(), addon_provider(&fetcher));
    configure(&mut host, AIOSTREAMS);
    configure(&mut host, MEDIAFUSION);
    configure(&mut host, ANIMESCRAPER);
    set_tmdb_key(&mut host, TMDB_KEY);
    let asked_before = fetcher.asked().len();

    let response = host
        .dispatch(find("movie", "tmdb:603"))
        .expect("a TMDB-keyed film's Streams are a question like any other");

    assert_eq!(
        fetcher.asked()[asked_before..].to_vec(),
        vec![
            TMDB_EXTERNAL_IDS_MATRIX.to_owned(),
            AIOSTREAMS_MOVIE.to_owned(),
            MEDIAFUSION_MOVIE.to_owned(),
        ],
        "the IMDb id is resolved once, then each Addon is asked in the spelling its own \
         manifest declares; the Addon that declares neither is not asked"
    );
    let groups = streams(&response);
    assert_eq!(
        groups
            .iter()
            .map(|group| group.addon.as_str())
            .collect::<Vec<_>>(),
        vec![
            "community.aiostreams",
            "community.mediafusion",
            "community.animescraper",
        ],
        "every Addon that offers the resource has a group, in configuration order"
    );
    assert_eq!(names(&groups[0])[0], "AIOStreams\n1080p");
    assert_eq!(groups[0].failure, None);
    assert_eq!(
        names(&groups[1])[0],
        "MediaFusion\ntmdb",
        "the Addon that declares `tmdb:` is asked with `tmdb:603`, not resolved through anywhere"
    );
    assert_eq!(groups[1].failure, None);
    assert!(
        groups[2].streams.is_empty() && groups[2].failure.is_none(),
        "an Addon that declares neither is considered and its group is empty: {groups:?}"
    );
}

#[test]
fn finding_streams_for_a_tmdb_episode_carries_the_season_to_each_spelling() {
    let fetcher = Arc::new(
        recorded_fetcher()
            .serving(MEDIAFUSION, MEDIAFUSION_MANIFEST)
            .serving(TMDB_EXTERNAL_IDS_BB, EXTERNAL_BB)
            .serving(MEDIAFUSION_EPISODE, MEDIAFUSION_STREAMS)
            .serving(AIOSTREAMS_EPISODE, DIRECT_STREAMS),
    );
    let mut host = host_over(fetcher.clone(), addon_provider(&fetcher));
    configure(&mut host, AIOSTREAMS);
    configure(&mut host, MEDIAFUSION);
    set_tmdb_key(&mut host, TMDB_KEY);
    let asked_before = fetcher.asked().len();

    host.dispatch(find("series", "tmdb:1396:1:2"))
        .expect("a TMDB-keyed episode's Streams are a question like any other");

    assert_eq!(
        fetcher.asked()[asked_before..].to_vec(),
        vec![
            TMDB_EXTERNAL_IDS_BB.to_owned(),
            AIOSTREAMS_EPISODE.to_owned(),
            MEDIAFUSION_EPISODE.to_owned(),
        ],
        "the episode's season and number are carried into both spellings"
    );
}

#[test]
fn a_tmdb_video_is_never_resolved_for_an_addon_without_a_key() {
    // The `tt` spelling is a hop only a credential can make. Without one the
    // Addon that needs it is not asked, and the Addon that takes `tmdb:`
    // straight is asked anyway — the question is not lost to one Addon's
    // missing spelling.
    let fetcher = Arc::new(
        recorded_fetcher()
            .serving(MEDIAFUSION, MEDIAFUSION_MANIFEST)
            .failing(TMDB_EXTERNAL_IDS_MATRIX, FetchError::Status { status: 401 })
            .serving(MEDIAFUSION_MOVIE, MEDIAFUSION_STREAMS),
    );
    let mut host = host_over(fetcher.clone(), addon_provider(&fetcher));
    configure(&mut host, AIOSTREAMS);
    configure(&mut host, MEDIAFUSION);
    let asked_before = fetcher.asked().len();

    let response = host
        .dispatch(find("movie", "tmdb:603"))
        .expect("a TMDB-keyed film's Streams are a question like any other");

    assert_eq!(
        fetcher.asked()[asked_before..].to_vec(),
        vec![MEDIAFUSION_MOVIE.to_owned()],
        "no credential means no `/external_ids` ask, and no asked Addon that needed one"
    );
    let groups = streams(&response);
    assert_eq!(groups[0].addon.as_str(), "community.aiostreams");
    assert!(groups[0].streams.is_empty() && groups[0].failure.is_none());
    assert_eq!(groups[1].addon.as_str(), "community.mediafusion");
    assert_eq!(names(&groups[1])[0], "MediaFusion\ntmdb");
}

#[test]
fn one_addon_failing_a_tmdb_ask_still_shows_what_the_others_returned() {
    let fetcher = Arc::new(
        recorded_fetcher()
            .serving(MEDIAFUSION, MEDIAFUSION_MANIFEST)
            .serving(TMDB_EXTERNAL_IDS_MATRIX, EXTERNAL_MATRIX)
            .failing(AIOSTREAMS_MOVIE, FetchError::Status { status: 503 })
            .serving(MEDIAFUSION_MOVIE, MEDIAFUSION_STREAMS),
    );
    let mut host = host_over(fetcher.clone(), addon_provider(&fetcher));
    configure(&mut host, AIOSTREAMS);
    configure(&mut host, MEDIAFUSION);
    set_tmdb_key(&mut host, TMDB_KEY);

    let response = host
        .dispatch(find("movie", "tmdb:603"))
        .expect("one Addon being down is not a failed question");
    let groups = streams(&response);

    assert!(
        matches!(&groups[0].failure, Some(ActionError::Fetch { detail }) if detail.contains("503")),
        "the Addon that did not answer says why: {groups:?}"
    );
    assert_eq!(
        names(&groups[1]),
        vec!["MediaFusion\ntmdb"],
        "the other Addon's answer is unaffected"
    );
}

#[test]
fn a_video_no_addon_answers_for_answers_with_no_groups() {
    // Cinemeta and Stremboxd answer metadata, not `stream`: nothing here has a
    // candidate, and that is an answer with nothing in it rather than a
    // refusal — the client can say so without being told off.
    let fetcher = Arc::new(recorded_fetcher());
    let mut host = host_over(fetcher.clone(), addon_provider(&fetcher));
    configure(&mut host, CINEMETA);
    configure(&mut host, STREMBOXD);
    let asked_before = fetcher.asked().len();

    let response = host
        .dispatch(find("movie", "tt0133093"))
        .expect("a question no Addon answers is still answered");

    assert!(streams(&response).is_empty());
    assert_eq!(
        fetcher.asked().len(),
        asked_before,
        "no Addon that does not answer for the resource is asked"
    );
}

#[test]
fn a_video_that_is_not_one_is_refused_before_any_addon_is_asked() {
    let (mut host, fetcher) = host_with_recorded_addons();
    let asked_before = fetcher.asked().len();

    let refused = host.dispatch(action(&serde_json::json!({
        "type": "find_streams",
        "video": { "type": "ser ies", "id": "tt0903747:1:1" },
    })));

    assert!(matches!(refused, Err(ActionError::InvalidVideoRef(_))));
    assert_eq!(fetcher.asked().len(), asked_before);
}

// --- the Host's own rules, driven through the Provider seam ------------------

/// A candidate a fake Provider can hand out: what a test asserts about is the
/// Host's handling of an answer, not the answer itself.
fn candidate(name: &str) -> Stream {
    Stream {
        name: Some(name.to_owned()),
        description: None,
        playback: Playback::Direct {
            url: format!("https://example.org/{name}.mkv"),
        },
        warnings: Vec::new(),
        filename: None,
        binge_group: None,
    }
}

#[test]
fn the_host_asks_every_answering_addon_in_configuration_order_and_re_ranks_nothing() {
    let fetcher = Arc::new(recorded_fetcher());
    let provider = Arc::new(
        FixtureProvider::new()
            .offering(
                "org.stremio.watchhub",
                vec![candidate("first"), candidate("second")],
            )
            .offering("com.stremio.torrentio.addon", vec![candidate("third")]),
    );
    let mut host = host_over(fetcher, provider.clone());
    configure(&mut host, CINEMETA);
    configure(&mut host, WATCHHUB);
    configure(&mut host, STREMBOXD);
    configure(&mut host, TORRENTIO);

    let response = host
        .dispatch(find("movie", "tt0133093"))
        .expect("finding a film's Streams should work");
    let groups = streams(&response);

    assert_eq!(
        groups
            .iter()
            .map(|group| group.addon.as_str())
            .collect::<Vec<_>>(),
        vec!["org.stremio.watchhub", "com.stremio.torrentio.addon"],
        "the configured order is the order of the list"
    );
    assert_eq!(names(&groups[0]), vec!["first", "second"]);
    assert_eq!(names(&groups[1]), vec!["third"]);
    assert_eq!(
        provider.asked(),
        vec![
            "org.stremio.watchhub".to_owned(),
            "com.stremio.torrentio.addon".to_owned(),
        ],
        "an Addon whose manifest does not answer for the resource is never asked"
    );
}

#[test]
fn a_providers_failure_is_that_groups_failure_and_the_others_candidates_stand() {
    let fetcher = Arc::new(recorded_fetcher());
    let provider = Arc::new(
        FixtureProvider::new()
            .failing(
                "com.stremio.torrentio.addon",
                ActionError::Fetch {
                    detail: "the Addon answered with status 503".to_owned(),
                },
            )
            .offering("org.stremio.watchhub", vec![candidate("kept")]),
    );
    let mut host = host_over(fetcher, provider);
    configure(&mut host, TORRENTIO);
    configure(&mut host, WATCHHUB);

    let response = host
        .dispatch(find("movie", "tt0133093"))
        .expect("one Addon failing is not a failed question");
    let groups = streams(&response);

    assert!(groups[0].streams.is_empty());
    assert!(matches!(
        &groups[0].failure,
        Some(ActionError::Fetch { detail }) if detail.contains("503")
    ));
    assert_eq!(groups[1].failure, None);
    assert_eq!(names(&groups[1]), vec!["kept"]);
}

// --- the wire ----------------------------------------------------------------

#[test]
fn the_answer_is_the_declared_wire_shape() {
    // The window reads this by hand, so the shape it declares is the shape that
    // arrives — one group per Addon, its candidates camelCased, and a playback
    // whose kind says whether this Host can open it.
    let (mut host, _fetcher) = host_with_recorded_addons();

    let response = host
        .dispatch(find("movie", "tt0133093"))
        .expect("finding a recorded film's Streams should work");
    let published = serde_json::to_value(&response).expect("a Response serializes");

    assert_eq!(published["snapshots"], serde_json::json!([]));
    let groups = &published["answer"]["streams"];
    assert_eq!(groups[0]["addon"], "com.stremio.torrentio.addon");
    assert_eq!(groups[0]["failure"], serde_json::Value::Null);
    assert_eq!(groups[0]["streams"][0]["name"], "Torrentio\n4k DV | HDR");
    assert_eq!(
        groups[0]["streams"][0]["playback"],
        serde_json::json!({
            "kind": "info_hash",
            "infoHash": "61065ea115b7cc3e8db9fb5ab1f6f327f08bd1c9",
        })
    );
    assert_eq!(groups[1]["addon"], "org.stremio.watchhub");
    assert_eq!(
        groups[1]["streams"],
        serde_json::json!([]),
        "WatchHub answers places to watch, and a web page is not a candidate this Host can play"
    );
}
