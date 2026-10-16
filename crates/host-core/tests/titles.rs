//! Opening a Title, driven the way a client drives it: an Action in, an Answer
//! out. Nothing below the Action surface is named here, and nothing in this file
//! reaches the network: every fetch is a recorded fixture.

use std::sync::Arc;

use host_core::{
    Action, ActionError, FetchError, FixtureFetcher, Host, InMemoryStore, Store, Title, TitleRef,
    ACTION_VERSION,
};

const CINEMETA: &str = "https://v3-cinemeta.strem.io/manifest.json";
const CINEMETA_MOVIE: &str = "https://v3-cinemeta.strem.io/meta/movie/tt0133093.json";
const CINEMETA_SERIES: &str = "https://v3-cinemeta.strem.io/meta/series/tt0903747.json";
const STREMBOXD: &str = "https://api.stremboxd.com/manifest.json";

const CINEMETA_MANIFEST: &str = include_str!("fixtures/cinemeta-manifest.json");
const STREMBOXD_MANIFEST: &str = include_str!("fixtures/stremboxd-manifest.json");
const MOVIE_BODY: &str = include_str!("fixtures/cinemeta-meta-movie.json");
const SERIES_BODY: &str = include_str!("fixtures/cinemeta-meta-series.json");
const SPARSE_BODY: &str = include_str!("fixtures/sparse-meta.json");
const HOSTILE_BODY: &str = include_str!("fixtures/hostile-meta.json");

/// An Action as a client sends it: the versioned envelope, as JSON text.
fn action(body: &serde_json::Value) -> Action {
    let envelope = format!(r#"{{"version":{ACTION_VERSION},"action":{body}}}"#);
    Action::parse(&envelope).unwrap_or_else(|error| panic!("{envelope} should parse: {error}"))
}

/// Open a Title, the way a card the client is holding does.
fn open(addon: &str, r#type: &str, id: &str) -> Action {
    action(&serde_json::json!({
        "type": "open_title",
        "addon": addon,
        "title": { "type": r#type, "id": id },
    }))
}

fn title(response: &host_core::Response) -> &Title {
    response.title().unwrap_or_else(|| {
        panic!("an Action that asked to open a Title answers with one: {response:?}")
    })
}

fn opened(host: &mut Host, action: Action) -> Title {
    let response = host
        .dispatch(action)
        .unwrap_or_else(|error| panic!("opening a Title should work: {error}"));
    title(&response).clone()
}

/// A Host over a store and a fetcher, with the recorded Addons configured.
fn host_with_recorded_addons() -> (Host, Arc<FixtureFetcher>) {
    let fetcher = Arc::new(
        FixtureFetcher::new()
            .serving(CINEMETA, CINEMETA_MANIFEST)
            .serving(STREMBOXD, STREMBOXD_MANIFEST)
            .serving(CINEMETA_MOVIE, MOVIE_BODY)
            .serving(CINEMETA_SERIES, SERIES_BODY),
    );
    let mut host = Host::new(
        Arc::new(InMemoryStore::new()) as Arc<dyn Store>,
        fetcher.clone(),
    )
    .expect("a Host over a store starts");
    configure(&mut host, CINEMETA);
    configure(&mut host, STREMBOXD);
    (host, fetcher)
}

fn configure(host: &mut Host, url: &str) {
    host.dispatch(action(
        &serde_json::json!({ "type": "add_addon", "url": url }),
    ))
    .unwrap_or_else(|error| panic!("configuring {url} should work: {error}"));
}

#[test]
fn opening_a_film_answers_with_its_metadata_and_no_videos() {
    let (mut host, fetcher) = host_with_recorded_addons();

    let title = opened(&mut host, open("com.linvo.cinemeta", "movie", "tt0133093"));

    assert_eq!(title.addon.as_str(), "com.linvo.cinemeta");
    assert_eq!(title.id, "tt0133093");
    assert_eq!(title.r#type, "movie");
    assert_eq!(title.name, "The Matrix");
    assert_eq!(title.release_info.as_deref(), Some("1999"));
    assert_eq!(title.runtime.as_deref(), Some("136 min"));
    assert_eq!(title.imdb_rating.as_deref(), Some("8.7"));
    assert!(title.description.is_some());
    assert!(title.poster.is_some());
    assert!(
        title.videos.is_empty(),
        "a film is not broken into Videos unless its Addon does it: {:?}",
        title.videos
    );
    assert_eq!(
        fetcher.asked().last().map(String::as_str),
        Some(CINEMETA_MOVIE),
        "the item's metadata is asked for at the resource path the item names"
    );
}

#[test]
fn opening_a_series_answers_with_its_videos_in_the_addons_own_order() {
    let (mut host, fetcher) = host_with_recorded_addons();

    let title = opened(&mut host, open("com.linvo.cinemeta", "series", "tt0903747"));

    assert_eq!(title.name, "Breaking Bad");
    assert_eq!(title.r#type, "series");
    assert_eq!(
        title
            .videos
            .iter()
            .map(|video| video.id.as_str())
            .collect::<Vec<_>>(),
        vec![
            "tt0903747:0:1",
            "tt0903747:1:1",
            "tt0903747:1:2",
            "tt0903747:1:3",
            "tt0903747:2:1",
        ],
        "every episode is a Video, carrying the id its Addon indexes it by"
    );
    let last = title
        .videos
        .iter()
        .find(|video| video.id == "tt0903747:2:1")
        .expect("the recorded series has a second season");
    assert_eq!(
        (last.season, last.episode),
        (Some(2), Some(1)),
        "a Video says where it sits in its season, which is how a client names it"
    );
    assert_eq!(
        fetcher.asked().last().map(String::as_str),
        Some(CINEMETA_SERIES)
    );
}

#[test]
fn opening_a_title_publishes_no_snapshot_and_moves_no_revision() {
    // What one client opens is not state anybody else shares (ADR-0005), so it is
    // a question like browsing: no Snapshot, and the revision stands still.
    let (mut host, _fetcher) = host_with_recorded_addons();
    let before = host.snapshot();

    let response = host
        .dispatch(open("com.linvo.cinemeta", "series", "tt0903747"))
        .expect("opening the recorded series should work");

    assert!(
        response.snapshots.is_empty(),
        "a question publishes nothing: {:?}",
        response.snapshots
    );
    assert_eq!(host.snapshot(), before);
}

#[test]
fn a_sparse_meta_response_still_leaves_the_title_open() {
    // An Addon is allowed to answer with the least a meta response can be, and a
    // Title that is mostly the identity the client already had still opens.
    let fetcher = Arc::new(
        FixtureFetcher::new()
            .serving(CINEMETA, CINEMETA_MANIFEST)
            .serving(CINEMETA_MOVIE, SPARSE_BODY),
    );
    let mut host = Host::new(Arc::new(InMemoryStore::new()) as Arc<dyn Store>, fetcher)
        .expect("a Host over a store starts");
    configure(&mut host, CINEMETA);

    let title = opened(&mut host, open("com.linvo.cinemeta", "movie", "tt0133093"));

    assert_eq!(title.id, "tt0133093");
    assert_eq!(title.name, "The Matrix");
    assert_eq!(title.poster, None);
    assert_eq!(title.runtime, None);
    assert!(title.videos.is_empty());
}

#[test]
fn opening_a_title_the_addon_does_not_have_is_refused() {
    let (mut host, _fetcher) = host_with_recorded_addons();

    let refused = host.dispatch(open("org.example.nowhere", "movie", "tt0133093"));

    assert!(matches!(
        refused,
        Err(ActionError::UnknownAddon { ref id }) if id == "org.example.nowhere"
    ));
}

#[test]
fn opening_a_title_an_addon_does_not_answer_for_is_refused_without_asking_it() {
    // `idPrefixes` and the types a resource covers keep an Addon from being asked
    // about ids that are not its business (ADR-0010). Stremboxd's `meta` reaches
    // films only, so a series is not its to answer.
    let (mut host, fetcher) = host_with_recorded_addons();
    let asked_before = fetcher.asked().len();

    let refused = host.dispatch(open("community.stremboxd", "series", "tt0903747"));

    assert_eq!(
        refused.err(),
        Some(ActionError::UnknownTitle {
            addon: host_core::AddonId::parse("community.stremboxd").expect("an Addon id"),
            title: TitleRef::parse("series", "tt0903747").expect("a Title"),
        })
    );
    assert_eq!(
        fetcher.asked().len(),
        asked_before,
        "an Addon that does not answer for a resource is not asked for it"
    );
}

#[test]
fn opening_a_title_whose_addon_cannot_be_reached_is_reported_rather_than_answered_blankly() {
    let fetcher = Arc::new(
        FixtureFetcher::new()
            .serving(CINEMETA, CINEMETA_MANIFEST)
            .failing(CINEMETA_MOVIE, FetchError::Status { status: 503 }),
    );
    let mut host = Host::new(Arc::new(InMemoryStore::new()) as Arc<dyn Store>, fetcher)
        .expect("a Host over a store starts");
    configure(&mut host, CINEMETA);

    let refused = host.dispatch(open("com.linvo.cinemeta", "movie", "tt0133093"));

    assert!(
        matches!(refused, Err(ActionError::Fetch { ref detail }) if detail.contains("503")),
        "one Addon was asked for one Title, so its failure is the answer: {refused:?}"
    );
}

#[test]
fn a_meta_response_that_lies_is_reported_rather_than_opened() {
    let fetcher = Arc::new(
        FixtureFetcher::new()
            .serving(CINEMETA, CINEMETA_MANIFEST)
            .serving(CINEMETA_MOVIE, HOSTILE_BODY),
    );
    let mut host = Host::new(Arc::new(InMemoryStore::new()) as Arc<dyn Store>, fetcher)
        .expect("a Host over a store starts");
    configure(&mut host, CINEMETA);

    let refused = host.dispatch(open("com.linvo.cinemeta", "movie", "tt0133093"));

    assert!(
        matches!(refused, Err(ActionError::Meta { ref detail }) if detail.contains("meta should be an object")),
        "a response that is not about an item is a fact about the Addon: {refused:?}"
    );
}

#[test]
fn the_answer_is_the_declared_wire_shape() {
    // The window reads this by hand, so the shape it declares is the shape that
    // arrives — and a Video carries the id the Addon indexes it by.
    let (mut host, _fetcher) = host_with_recorded_addons();

    let response = host
        .dispatch(open("com.linvo.cinemeta", "series", "tt0903747"))
        .expect("opening the recorded series should work");
    let published = serde_json::to_value(&response).expect("a Response serializes");

    assert_eq!(published["snapshots"], serde_json::json!([]));
    let title = &published["answer"]["title"];
    assert_eq!(title["addon"], "com.linvo.cinemeta");
    assert_eq!(title["type"], "series");
    assert_eq!(title["name"], "Breaking Bad");
    assert_eq!(title["releaseInfo"], "2008–2013");
    assert_eq!(title["videos"][0]["id"], "tt0903747:0:1");
    assert_eq!(title["videos"][0]["season"], 0);
    assert_eq!(title["videos"][0]["episode"], 1);
}

#[test]
fn an_open_title_action_is_flat_enough_to_write_by_hand() {
    let value = serde_json::to_value(Action::OpenTitle {
        addon: "com.linvo.cinemeta".to_owned(),
        title: TitleRef::parse("series", "tt0903747").expect("a Title"),
    })
    .expect("an Action serializes");

    assert_eq!(
        value,
        serde_json::json!({
            "type": "open_title",
            "addon": "com.linvo.cinemeta",
            "title": { "type": "series", "id": "tt0903747" },
        }),
        "the Title is named inside the Action, because the Action already has a `type`"
    );
}
