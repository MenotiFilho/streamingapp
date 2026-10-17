//! Opening a Title, driven the way a client drives it: an Action in, an Answer
//! out. Nothing below the Action surface is named here, and nothing in this file
//! reaches the network: every fetch is a recorded fixture.

use std::sync::Arc;

use host_core::{
    Action, ActionError, AddonProvider, FetchError, FixtureClock, FixtureFetcher, FixturePlayer,
    Host, InMemorySecretStore, InMemoryStore, Provider, SecretBackend, Store, Title, TitleKey,
    TitleRef, ACTION_VERSION,
};

const CINEMETA: &str = "https://v3-cinemeta.strem.io/manifest.json";
const CINEMETA_MOVIE: &str = "https://v3-cinemeta.strem.io/meta/movie/tt0133093.json";
const CINEMETA_SERIES: &str = "https://v3-cinemeta.strem.io/meta/series/tt0903747.json";
const STREMBOXD: &str = "https://api.stremboxd.com/manifest.json";

/// The owner's TMDB credential, as the v3 api-key shape the Host takes.
const TMDB_KEY: &str = "0123456789abcdef0123456789abcdef";
const TMDB_FIND_MOVIE: &str =
    "https://api.themoviedb.org/3/find/tt0133093?external_source=imdb_id&api_key=0123456789abcdef0123456789abcdef";
const TMDB_FIND_SERIES: &str =
    "https://api.themoviedb.org/3/find/tt0903747?external_source=imdb_id&api_key=0123456789abcdef0123456789abcdef";
const TMDB_MOVIE_603: &str =
    "https://api.themoviedb.org/3/movie/603?api_key=0123456789abcdef0123456789abcdef";
const TMDB_TV_1396: &str =
    "https://api.themoviedb.org/3/tv/1396?api_key=0123456789abcdef0123456789abcdef";
const TMDB_TV_1396_SEASON_0: &str =
    "https://api.themoviedb.org/3/tv/1396/season/0?api_key=0123456789abcdef0123456789abcdef";
const TMDB_TV_1396_SEASON_1: &str =
    "https://api.themoviedb.org/3/tv/1396/season/1?api_key=0123456789abcdef0123456789abcdef";
const TMDB_TV_1396_SEASON_2: &str =
    "https://api.themoviedb.org/3/tv/1396/season/2?api_key=0123456789abcdef0123456789abcdef";

const CINEMETA_MANIFEST: &str = include_str!("fixtures/cinemeta-manifest.json");
const STREMBOXD_MANIFEST: &str = include_str!("fixtures/stremboxd-manifest.json");
const MOVIE_BODY: &str = include_str!("fixtures/cinemeta-meta-movie.json");
const SERIES_BODY: &str = include_str!("fixtures/cinemeta-meta-series.json");
const SPARSE_BODY: &str = include_str!("fixtures/sparse-meta.json");
const HOSTILE_BODY: &str = include_str!("fixtures/hostile-meta.json");

const TMDB_FIND_MOVIE_BODY: &str = include_str!("fixtures/tmdb-find-matrix.json");
const TMDB_FIND_SERIES_BODY: &str = include_str!("fixtures/tmdb-find-bb.json");
const TMDB_MOVIE_DETAILS: &str = include_str!("fixtures/tmdb-movie-details.json");
const TMDB_TV_DETAILS: &str = include_str!("fixtures/tmdb-tv-details.json");
const TMDB_TV_SEASON_0: &str = include_str!("fixtures/tmdb-tv-season-0.json");
const TMDB_TV_SEASON_1: &str = include_str!("fixtures/tmdb-tv-season-1.json");
const TMDB_TV_SEASON_2: &str = include_str!("fixtures/tmdb-tv-season-2.json");

/// A Player a test drives by hand: nothing plays unless a test says so, and
/// every telling is remembered.
fn player() -> Arc<FixturePlayer> {
    Arc::new(FixturePlayer::new())
}

/// A clock a test drives by hand, for the Watch progress a play records (#29).
fn clock() -> Arc<FixtureClock> {
    Arc::new(FixtureClock::new())
}

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
        secrets(),
        provider(&fetcher),
        player(),
        clock(),
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

/// A Host needs somewhere to look a credential up; tests hold theirs here.
fn secrets() -> Arc<InMemorySecretStore> {
    Arc::new(InMemorySecretStore::backed_by(SecretBackend::Keyring))
}

/// The real Provider over this fetcher: the addon protocol, so a `find_streams`
/// in a file that recorded no `stream` answer fails loudly rather than reaching
/// anywhere.
fn provider(fetcher: &Arc<FixtureFetcher>) -> Arc<dyn Provider> {
    Arc::new(AddonProvider::new(fetcher.clone()))
}

/// Enter a TMDB key the way the window's form does.
fn set_tmdb_key(host: &mut Host, key: &str) {
    host.dispatch(action(
        &serde_json::json!({ "type": "set_tmdb_key", "key": key }),
    ))
    .unwrap_or_else(|error| panic!("entering a TMDB key should work: {error}"));
}

#[test]
fn opening_a_film_answers_with_its_metadata_and_no_videos() {
    let (mut host, fetcher) = host_with_recorded_addons();

    let title = opened(&mut host, open("com.linvo.cinemeta", "movie", "tt0133093"));

    assert_eq!(
        title.addon.as_ref().map(host_core::AddonId::as_str),
        Some("com.linvo.cinemeta")
    );
    assert_eq!(title.id, "tt0133093");
    assert_eq!(title.r#type, "movie");
    assert_eq!(title.name, "The Matrix");
    assert_eq!(title.release_info.as_deref(), Some("1999"));
    assert_eq!(title.runtime.as_deref(), Some("136 min"));
    assert_eq!(title.imdb_rating.as_deref(), Some("8.7"));
    assert!(title.description.is_some());
    assert!(title.poster.is_some());
    assert_eq!(
        title.background.as_deref(),
        Some("https://images.metahub.space/background/medium/tt0133093/img"),
        "the backdrop a Title screen draws rides the Addon's answer through the Host"
    );
    assert_eq!(
        title.logo.as_deref(),
        Some("https://images.metahub.space/logo/medium/tt0133093/img"),
        "the wordmark overlays it"
    );
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
    let pilot = title
        .videos
        .iter()
        .find(|video| video.id == "tt0903747:1:1")
        .expect("the recorded series has a pilot");
    assert_eq!(
        pilot.thumbnail.as_deref(),
        Some("https://episodes.metahub.space/tt0903747/1/1/w780.jpg"),
        "the 16:9 still a series' episode row draws rides the Addon's answer"
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
    let mut host = Host::new(
        Arc::new(InMemoryStore::new()) as Arc<dyn Store>,
        fetcher.clone(),
        secrets(),
        provider(&fetcher),
        player(),
        clock(),
    )
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
    let mut host = Host::new(
        Arc::new(InMemoryStore::new()) as Arc<dyn Store>,
        fetcher.clone(),
        secrets(),
        provider(&fetcher),
        player(),
        clock(),
    )
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
    let mut host = Host::new(
        Arc::new(InMemoryStore::new()) as Arc<dyn Store>,
        fetcher.clone(),
        secrets(),
        provider(&fetcher),
        player(),
        clock(),
    )
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

// --- TMDB, where a Title maps when it can -------------------------------------

const CINEMETA_TMDB_603: &str = "https://v3-cinemeta.strem.io/meta/movie/tmdb%3A603.json";
const TMDB_FIND_MOVIE_NAKED: &str =
    "https://api.themoviedb.org/3/find/tt0133093?external_source=imdb_id";
const TMDB_MOVIE_603_NAKED: &str = "https://api.themoviedb.org/3/movie/603";
const TMDB_TOKEN: &str = "eyJhbGciOiJIUzI1NiJ9.eyJzY29wZSI6InJlYWQifQ.a-signature";

/// A Host over the fetcher a test recorded its answers on, with Cinemeta
/// configured and the key entered the way the window's form does it — or
/// none, for the tests without one. The fetcher is handed in by the Arc the
/// test made, so what is registered is what is read back.
fn host_over(fetcher: Arc<FixtureFetcher>, key: Option<&str>) -> Host {
    let mut host = Host::new(
        Arc::new(InMemoryStore::new()) as Arc<dyn Store>,
        fetcher.clone(),
        secrets(),
        provider(&fetcher),
        player(),
        clock(),
    )
    .expect("a Host over a store starts");
    configure(&mut host, CINEMETA);
    if let Some(key) = key {
        set_tmdb_key(&mut host, key);
    }
    host
}

/// The Breaking Bad mapping, recorded whole: the Addon's answer, the find, the
/// record, and each of the three seasons it lists.
fn breaking_bad_fetcher() -> Arc<FixtureFetcher> {
    Arc::new(
        FixtureFetcher::new()
            .serving(CINEMETA, CINEMETA_MANIFEST)
            .serving(CINEMETA_SERIES, SERIES_BODY)
            .serving(TMDB_FIND_SERIES, TMDB_FIND_SERIES_BODY)
            .serving(TMDB_TV_1396, TMDB_TV_DETAILS)
            .serving(TMDB_TV_1396_SEASON_0, TMDB_TV_SEASON_0)
            .serving(TMDB_TV_1396_SEASON_1, TMDB_TV_SEASON_1)
            .serving(TMDB_TV_1396_SEASON_2, TMDB_TV_SEASON_2),
    )
}

/// Open a Discovered Title the way a Discover card does.
fn open_discovered(key: serde_json::Value, kind: &str) -> Action {
    action(&serde_json::json!({
        "type": "open_discovered_title",
        "key": key,
        "kind": kind,
    }))
}

/// Where `url` happened in the asks a fetcher recorded, or a complaint.
fn position_of(asked: &[String], url: &str) -> usize {
    asked
        .iter()
        .position(|asked_for| asked_for == url)
        .unwrap_or_else(|| panic!("{url} was never asked for: {asked:?}"))
}

/// The unmapped key of a Title Cinemeta answered about `tt0133093`.
fn addon_key(movie: &Title) -> TitleKey {
    TitleKey::Addon {
        addon: movie
            .addon
            .clone()
            .expect("Cinemeta answered about this one"),
        id: movie.id.clone(),
    }
}

#[test]
fn a_title_with_an_imdb_id_maps_to_tmdb_and_its_record_supersedes_the_addons_word() {
    let fetcher = Arc::new(
        FixtureFetcher::new()
            .serving(CINEMETA, CINEMETA_MANIFEST)
            .serving(CINEMETA_MOVIE, MOVIE_BODY)
            .serving(TMDB_FIND_MOVIE, TMDB_FIND_MOVIE_BODY)
            .serving(TMDB_MOVIE_603, TMDB_MOVIE_DETAILS),
    );
    let mut host = host_over(fetcher.clone(), Some(TMDB_KEY));

    let title = opened(&mut host, open("com.linvo.cinemeta", "movie", "tt0133093"));

    assert_eq!(
        title.key,
        TitleKey::Tmdb { id: 603 },
        "the record the find named is what the Title is keyed by"
    );
    assert_eq!(title.name, "The Matrix");
    assert_eq!(title.release_info.as_deref(), Some("1999"));
    assert_eq!(
        title.genres,
        vec!["Action", "Science Fiction"],
        "TMDB's word is the one kept where the record answered"
    );
    assert!(
        title
            .poster
            .as_deref()
            .is_some_and(|poster| poster.starts_with("https://image.tmdb.org/t/p/w780")),
        "the poster is TMDB's, at the size a card draws: {:?}",
        title.poster
    );

    // The path, in order: the Addon's answer, then the identity, then the
    // record.
    let asked = fetcher.asked();
    assert!(
        position_of(&asked, CINEMETA_MOVIE) < position_of(&asked, TMDB_FIND_MOVIE)
            && position_of(&asked, TMDB_FIND_MOVIE) < position_of(&asked, TMDB_MOVIE_603),
        "the Addon answers first, then the identity is found, then the metadata read: {asked:?}"
    );
}

#[test]
fn without_a_key_nothing_maps_and_the_title_stays_the_addons() {
    let fetcher = Arc::new(
        FixtureFetcher::new()
            .serving(CINEMETA, CINEMETA_MANIFEST)
            .serving(CINEMETA_MOVIE, MOVIE_BODY),
    );
    let mut host = host_over(fetcher.clone(), None);

    let title = opened(&mut host, open("com.linvo.cinemeta", "movie", "tt0133093"));

    assert_eq!(title.key, addon_key(&title));
    assert_eq!(title.name, "The Matrix");
    assert_eq!(
        fetcher.asked().last().map(String::as_str),
        Some(CINEMETA_MOVIE),
        "no key entered, and no TMDB asked"
    );
}

#[test]
fn an_id_that_says_it_is_tmdbs_is_keyed_by_its_record_whether_a_key_is_held_or_not() {
    // The key is a fact about the identity, not of the credentials held: the
    // id names TMDB's record whatever the store carries. Cinemeta's meta
    // declares no id prefixes, so a `tmdb:603` ask is its to answer.
    let answerless = Arc::new(
        FixtureFetcher::new()
            .serving(CINEMETA, CINEMETA_MANIFEST)
            .serving(CINEMETA_TMDB_603, MOVIE_BODY),
    );
    let mut host = host_over(answerless.clone(), None);
    let asked_at_configure: usize = answerless.asked().len();

    let title = opened(&mut host, open("com.linvo.cinemeta", "movie", "tmdb:603"));

    assert_eq!(title.key, TitleKey::Tmdb { id: 603 });
    assert_eq!(
        answerless.asked().len(),
        asked_at_configure + 1,
        "only the Addon was asked, with no key to ask TMDB with: {:?}",
        answerless.asked()
    );

    // With a key, the record's metadata is asked for and arrives.
    let refined = Arc::new(
        FixtureFetcher::new()
            .serving(CINEMETA, CINEMETA_MANIFEST)
            .serving(CINEMETA_TMDB_603, MOVIE_BODY)
            .serving(TMDB_MOVIE_603, TMDB_MOVIE_DETAILS),
    );
    let mut host = host_over(refined.clone(), Some(TMDB_KEY));

    let title = opened(&mut host, open("com.linvo.cinemeta", "movie", "tmdb:603"));

    assert_eq!(title.key, TitleKey::Tmdb { id: 603 });
    assert!(
        title
            .poster
            .as_deref()
            .is_some_and(|poster| poster.starts_with("https://image.tmdb.org/t/p/w780")),
        "the record answered, and its poster is the word kept: {:?}",
        title.poster
    );
    assert!(
        refined.asked().contains(&TMDB_MOVIE_603.to_owned()),
        "the details were asked of TMDB: {:?}",
        refined.asked()
    );
}

#[test]
fn a_tmdb_outage_degrades_to_the_addon_metadata_instead_of_blanking_the_title() {
    let fetcher = Arc::new(
        FixtureFetcher::new()
            .serving(CINEMETA, CINEMETA_MANIFEST)
            .serving(CINEMETA_MOVIE, MOVIE_BODY)
            .failing(TMDB_FIND_MOVIE, FetchError::Status { status: 503 }),
    );
    let mut host = host_over(fetcher, Some(TMDB_KEY));

    let title = opened(&mut host, open("com.linvo.cinemeta", "movie", "tt0133093"));

    assert_eq!(title.key, addon_key(&title));
    assert_eq!(
        title.name, "The Matrix",
        "the Addon's answer, unblanked by a service that was down"
    );
    assert_eq!(title.release_info.as_deref(), Some("1999"));
    assert!(
        title.poster.is_some(),
        "the card the person already saw is not lost to an outage"
    );
}

#[test]
fn a_find_which_maps_nothing_leaves_the_title_keyed_by_its_addon() {
    // A find that answered is not always a find that mapped one: the kind's
    // own list empty is the answer no record was found.
    let fetcher = Arc::new(
        FixtureFetcher::new()
            .serving(CINEMETA, CINEMETA_MANIFEST)
            .serving(CINEMETA_MOVIE, MOVIE_BODY)
            .serving(
                TMDB_FIND_MOVIE,
                r#"{"movie_results":[],"tv_results":[],"person_results":[]}"#,
            ),
    );
    let mut host = host_over(fetcher, Some(TMDB_KEY));

    let title = opened(&mut host, open("com.linvo.cinemeta", "movie", "tt0133093"));

    assert_eq!(title.key, addon_key(&title));
    assert_eq!(title.name, "The Matrix");
}

#[test]
fn a_details_answer_that_was_not_one_keeps_the_key_and_the_addons_metadata() {
    // The find stood: the identity is TMDB's. What failed is the reading of
    // one answer — the metadata stays the Addon's sparse word, the identity
    // the client opened it by.
    let fetcher = Arc::new(
        FixtureFetcher::new()
            .serving(CINEMETA, CINEMETA_MANIFEST)
            .serving(CINEMETA_MOVIE, r#"{"meta":null}"#)
            .serving(TMDB_FIND_MOVIE, TMDB_FIND_MOVIE_BODY)
            .serving(TMDB_MOVIE_603, "[]"),
    );
    let mut host = host_over(fetcher, Some(TMDB_KEY));

    let title = opened(&mut host, open("com.linvo.cinemeta", "movie", "tt0133093"));

    assert_eq!(title.key, TitleKey::Tmdb { id: 603 });
    assert_eq!(
        title.runtime, None,
        "the sparse Addon's word — the name and nothing more — is what the Title keeps, \
         with no runtime a refused record could have given it"
    );
}

#[test]
fn a_series_maps_to_tmdb_and_its_record_supplies_its_videos() {
    let mut host = host_over(breaking_bad_fetcher(), Some(TMDB_KEY));

    let title = opened(&mut host, open("com.linvo.cinemeta", "series", "tt0903747"));

    assert_eq!(title.key, TitleKey::Tmdb { id: 1396 });
    assert_eq!(title.name, "Breaking Bad");
    assert_eq!(
        title.release_info.as_deref(),
        Some("2008–2013"),
        "the years are TMDB's"
    );
    assert_eq!(
        title.runtime.as_deref(),
        Some("45 min"),
        "the runtime is TMDB's, over the Addon's `49 min`"
    );
    assert_eq!(
        title
            .videos
            .iter()
            .map(|video| video.id.as_str())
            .collect::<Vec<_>>(),
        vec![
            "tmdb:1396:0:1",
            "tmdb:1396:1:1",
            "tmdb:1396:1:2",
            "tmdb:1396:1:3",
            "tmdb:1396:2:1",
        ],
        "the Videos are TMDB's, in TMDB's order, and keyed the way Streams are asked for"
    );
    assert_eq!(
        title.videos[1].thumbnail.as_deref(),
        Some("https://image.tmdb.org/t/p/w300/still-1396-1-1.jpg"),
        "an episode row draws TMDB's 16:9 still"
    );
    assert_eq!(
        title.videos[0].thumbnail, None,
        "a special TMDB kept no still for is one with none to draw"
    );
    assert!(
        title
            .background
            .as_deref()
            .is_some_and(|background| background.starts_with("https://image.tmdb.org/t/p/w780"))
            && title
                .logo
                .as_deref()
                .is_some_and(|logo| logo.starts_with("https://image.tmdb.org/t/p/w500")),
        "the art a Title hero draws is TMDB's: {:?}",
        (title.background.as_deref(), title.logo.as_deref())
    );
}

#[test]
fn a_series_whose_seasons_are_not_recorded_keeps_the_addons_episode_list() {
    // The record answered, and its seasons did not: TMDB's Videos were not
    // read, so the Addon's list stands rather than being replaced with the
    // emptiness of an outage (ADR-0011's amendment).
    let fetcher = Arc::new(
        FixtureFetcher::new()
            .serving(CINEMETA, CINEMETA_MANIFEST)
            .serving(CINEMETA_SERIES, SERIES_BODY)
            .serving(TMDB_FIND_SERIES, TMDB_FIND_SERIES_BODY)
            .serving(TMDB_TV_1396, TMDB_TV_DETAILS)
            .failing(TMDB_TV_1396_SEASON_0, FetchError::Status { status: 503 })
            .failing(TMDB_TV_1396_SEASON_1, FetchError::Status { status: 503 })
            .failing(TMDB_TV_1396_SEASON_2, FetchError::Status { status: 503 }),
    );
    let mut host = host_over(fetcher, Some(TMDB_KEY));

    let title = opened(&mut host, open("com.linvo.cinemeta", "series", "tt0903747"));

    assert_eq!(title.key, TitleKey::Tmdb { id: 1396 }, "the record met it");
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
        "the Addon's episodes stand where TMDB's could not be read"
    );
}

#[test]
fn a_token_travels_in_the_header_and_never_in_the_url() {
    // A v4 access token (a JWT) is the Bearer shape, asked for in a header.
    // The fixtures are recorded at the bare URLs — no `api_key` in them — so a
    // credential anywhere in a built URL is a missed fixture that panics the
    // test rather than a leaked key that passes it, and the recorded headers
    // prove the part of the road a URL is not in.
    let fetcher = Arc::new(
        FixtureFetcher::new()
            .serving(CINEMETA, CINEMETA_MANIFEST)
            .serving(CINEMETA_MOVIE, MOVIE_BODY)
            .serving(TMDB_FIND_MOVIE_NAKED, TMDB_FIND_MOVIE_BODY)
            .serving(TMDB_MOVIE_603_NAKED, TMDB_MOVIE_DETAILS),
    );
    let mut host = host_over(fetcher.clone(), Some(TMDB_TOKEN));

    let title = opened(&mut host, open("com.linvo.cinemeta", "movie", "tt0133093"));

    assert_eq!(title.key, TitleKey::Tmdb { id: 603 });
    assert_eq!(
        fetcher.headers_of(TMDB_FIND_MOVIE_NAKED),
        vec![("Authorization".to_owned(), format!("Bearer {TMDB_TOKEN}"))],
        "the token went in the header, where no URL could carry it"
    );
    assert_eq!(
        fetcher.headers_of(TMDB_MOVIE_603_NAKED),
        vec![("Authorization".to_owned(), format!("Bearer {TMDB_TOKEN}"))],
        "every ask carried it, and no URL carried it"
    );
    for url in fetcher.asked() {
        assert!(
            !url.contains("api_key") && !url.contains(TMDB_TOKEN),
            "the URL a token ask built carries none of the credential: {url}"
        );
    }
}

#[test]
fn the_wire_of_a_mapped_answer_declares_what_it_is_keyed_by() {
    // The window reads this by hand: the key is where unmapped is shown
    // from, so its shape is declared from the Addon's to TMDB's.
    let (mut host, _fetcher) = host_with_recorded_addons();
    let response = host
        .dispatch(open("com.linvo.cinemeta", "series", "tt0903747"))
        .expect("opening the recorded series should work");
    let published = serde_json::to_value(&response).expect("a Response serializes");
    assert_eq!(
        published["answer"]["title"]["key"],
        serde_json::json!({
            "kind": "addon",
            "addon": "com.linvo.cinemeta",
            "id": "tt0903747",
        })
    );

    let fetcher = Arc::new(
        FixtureFetcher::new()
            .serving(CINEMETA, CINEMETA_MANIFEST)
            .serving(CINEMETA_MOVIE, MOVIE_BODY)
            .serving(TMDB_FIND_MOVIE, TMDB_FIND_MOVIE_BODY)
            .serving(TMDB_MOVIE_603, TMDB_MOVIE_DETAILS),
    );
    let mut host = host_over(fetcher, Some(TMDB_KEY));
    let response = host
        .dispatch(open("com.linvo.cinemeta", "movie", "tt0133093"))
        .expect("a mapped Title opens");
    let published = serde_json::to_value(&response).expect("a Response serializes");

    assert_eq!(
        published["answer"]["title"]["key"],
        serde_json::json!({ "kind": "tmdb", "id": 603 })
    );
}

// --- Discovered Titles: TMDB's own, with no Addon behind them -----------------

#[test]
fn a_discovered_film_opens_from_tmdb_alone_with_no_addon() {
    let fetcher = Arc::new(
        FixtureFetcher::new()
            .serving(CINEMETA, CINEMETA_MANIFEST)
            .serving(TMDB_MOVIE_603, TMDB_MOVIE_DETAILS),
    );
    let mut host = host_over(fetcher.clone(), Some(TMDB_KEY));

    let title = opened(
        &mut host,
        open_discovered(serde_json::json!({ "kind": "tmdb", "id": 603 }), "movie"),
    );

    assert_eq!(title.addon, None, "no Addon named it, and none is asked");
    assert_eq!(title.id, "tmdb:603");
    assert_eq!(title.key, TitleKey::Tmdb { id: 603 });
    assert_eq!(title.r#type, "movie");
    assert_eq!(title.name, "The Matrix");
    assert_eq!(title.release_info.as_deref(), Some("1999"));
    assert_eq!(title.runtime.as_deref(), Some("136 min"));
    assert_eq!(title.imdb_rating.as_deref(), Some("8.2"));
    assert_eq!(title.genres, vec!["Action", "Science Fiction"]);
    assert!(title.description.is_some());
    assert!(
        title
            .background
            .as_deref()
            .is_some_and(|background| background.starts_with("https://image.tmdb.org/t/p/w780")),
        "the backdrop is drawn at a hero's size: {:?}",
        title.background
    );
    assert!(
        title
            .logo
            .as_deref()
            .is_some_and(|logo| logo.starts_with("https://image.tmdb.org/t/p/w500")),
        "the wordmark is TMDB's, over a text name: {:?}",
        title.logo
    );
    assert!(
        title.videos.is_empty(),
        "a film is one Video: itself: {:?}",
        title.videos
    );
    assert_eq!(
        fetcher.asked(),
        vec![CINEMETA.to_owned(), TMDB_MOVIE_603.to_owned()],
        "the record is the whole of it: no Addon is asked for a Title it never named"
    );
}

#[test]
fn a_discovered_series_opens_with_tmdbs_seasons_and_their_stills() {
    let fetcher = breaking_bad_fetcher();
    let mut host = host_over(fetcher.clone(), Some(TMDB_KEY));

    let title = opened(
        &mut host,
        open_discovered(serde_json::json!({ "kind": "tmdb", "id": 1396 }), "series"),
    );

    assert_eq!(title.addon, None);
    assert_eq!(title.id, "tmdb:1396");
    assert_eq!(title.r#type, "series");
    assert_eq!(
        title
            .videos
            .iter()
            .map(|video| video.id.as_str())
            .collect::<Vec<_>>(),
        vec![
            "tmdb:1396:0:1",
            "tmdb:1396:1:1",
            "tmdb:1396:1:2",
            "tmdb:1396:1:3",
            "tmdb:1396:2:1",
        ],
        "TMDB's seasons, in TMDB's order, specials included"
    );
    assert_eq!(
        title.videos[2].thumbnail.as_deref(),
        Some("https://image.tmdb.org/t/p/w300/still-1396-1-2.jpg")
    );
    assert!(
        title
            .logo
            .as_deref()
            .is_some_and(|logo| logo.starts_with("https://image.tmdb.org/t/p/w500")),
        "the wordmark is TMDB's: {:?}",
        title.logo
    );
    assert!(
        !fetcher
            .asked()
            .iter()
            .any(|url| url.contains("cinemeta") && url.contains("/meta/")),
        "no Addon's metadata is asked: a Discovered Title is TMDB's"
    );
}

#[test]
fn a_discovered_title_is_a_question_that_publishes_nothing() {
    let fetcher = Arc::new(
        FixtureFetcher::new()
            .serving(CINEMETA, CINEMETA_MANIFEST)
            .serving(TMDB_MOVIE_603, TMDB_MOVIE_DETAILS),
    );
    let mut host = host_over(fetcher, Some(TMDB_KEY));
    let before = host.snapshot();

    let response = host
        .dispatch(open_discovered(
            serde_json::json!({ "kind": "tmdb", "id": 603 }),
            "movie",
        ))
        .expect("a Discovered Title opens");

    assert!(response.snapshots.is_empty(), "it is a question");
    assert_eq!(host.snapshot(), before);
}

#[test]
fn a_discovered_title_without_a_key_is_refused_cleanly() {
    let fetcher = Arc::new(
        FixtureFetcher::new()
            .serving(CINEMETA, CINEMETA_MANIFEST)
            .serving(TMDB_MOVIE_603, TMDB_MOVIE_DETAILS),
    );
    let mut host = host_over(fetcher.clone(), None);
    let asked_before = fetcher.asked().len();

    let refused = host
        .dispatch(open_discovered(
            serde_json::json!({ "kind": "tmdb", "id": 603 }),
            "movie",
        ))
        .expect_err("a Discovered Title is TMDB's, and there is no key to ask with");

    assert_eq!(
        refused,
        ActionError::NoTmdbCredential,
        "the refusal says the credential is what is missing"
    );
    assert_eq!(
        serde_json::to_value(&refused).expect("a refusal serializes")["kind"],
        "no_tmdb_credential",
        "a client acts on the kind and a person reads the sentence"
    );
    assert_eq!(
        fetcher.asked().len(),
        asked_before,
        "nothing was asked: the Host knew before it left home"
    );
}

#[test]
fn a_key_that_names_an_addon_is_not_a_discovered_title() {
    let fetcher = Arc::new(
        FixtureFetcher::new()
            .serving(CINEMETA, CINEMETA_MANIFEST)
            .serving(TMDB_MOVIE_603, TMDB_MOVIE_DETAILS),
    );
    let mut host = host_over(fetcher, Some(TMDB_KEY));

    for (key, kind) in [
        (
            serde_json::json!({ "kind": "addon", "addon": "com.linvo.cinemeta", "id": "tt0133093" }),
            "movie",
        ),
        (serde_json::json!({ "kind": "tmdb", "id": 603 }), "channel"),
        (serde_json::json!({ "kind": "tmdb", "id": 0 }), "movie"),
    ] {
        let refused = host
            .dispatch(open_discovered(key.clone(), kind))
            .expect_err("that is not a Discovered Title");

        assert!(
            matches!(refused, ActionError::NotDiscoveredTitle { .. }),
            "{key} as {kind} is refused as a Title this question is not for: {refused:?}"
        );
        assert_eq!(
            serde_json::to_value(&refused).expect("a refusal serializes")["kind"],
            "not_discovered_title"
        );
    }
}

#[test]
fn opening_a_discovered_title_is_flat_enough_to_write_by_hand() {
    let value = serde_json::to_value(open_discovered(
        serde_json::json!({ "kind": "tmdb", "id": 1396 }),
        "series",
    ))
    .expect("an Action serializes");

    assert_eq!(
        value,
        serde_json::json!({
            "type": "open_discovered_title",
            "key": { "kind": "tmdb", "id": 1396 },
            "kind": "series",
        }),
        "the record is named inside the Action, because the Action already has a `type`"
    );
}

#[test]
fn a_discovered_answer_declares_a_title_with_no_addon_on_the_wire() {
    let fetcher = Arc::new(
        FixtureFetcher::new()
            .serving(CINEMETA, CINEMETA_MANIFEST)
            .serving(TMDB_MOVIE_603, TMDB_MOVIE_DETAILS),
    );
    let mut host = host_over(fetcher, Some(TMDB_KEY));
    let response = host
        .dispatch(open_discovered(
            serde_json::json!({ "kind": "tmdb", "id": 603 }),
            "movie",
        ))
        .expect("a Discovered Title opens");
    let published = serde_json::to_value(&response).expect("a Response serializes");

    assert_eq!(
        published["answer"]["title"]["addon"],
        serde_json::Value::Null
    );
    assert_eq!(published["answer"]["title"]["id"], "tmdb:603");
    assert_eq!(
        published["answer"]["title"]["key"],
        serde_json::json!({ "kind": "tmdb", "id": 603 })
    );
    assert!(
        published["answer"]["title"]["background"].is_string(),
        "the hero's art travels: {}",
        published["answer"]["title"]
    );
}
