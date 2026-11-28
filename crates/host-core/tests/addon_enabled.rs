//! Enabling and disabling configured Addons (ADR-0044 §2, #355), driven the
//! way a client drives the Host: an Action in, published Snapshots and Answers
//! out, with zero real network calls.

use std::sync::Arc;

use host_core::{
    Action, ActionError, Addon, AddonId, AutoplayPhase, CachedTitle, ClientFrame, FixtureClock,
    FixtureFetcher, FixturePlayer, FixtureProvider, FixtureStremio, Host, InMemorySecretStore,
    InMemoryStore, Manifest, ManifestUrl, Observation, Playback, PlaybackState, SecretBackend,
    SeriesStatus, Snapshot, Store, Stream, StreamUrl, Subtitle, Telling, Title, TitleCard,
    TitleKey, TitleSource, TitleStub, Track, TrackId, TrackKind, UnplayableReason, Video, VideoRef,
    WatchProgress, ACTION_VERSION, AUTOPLAY_COUNTDOWN_MS, WIRE_VERSION,
};

const ADDON_A_URL: &str = "https://addon-a.example.org/token/eyJzZWNyZXQiOiJLRVkifQ/manifest.json";
const ADDON_A_ID: &str = "org.example.addonA";
const ADDON_A_CATALOG_URL: &str =
    "https://addon-a.example.org/token/eyJzZWNyZXQiOiJLRVkifQ/catalog/movie/top.json";
const ADDON_A_SEARCH_URL: &str =
    "https://addon-a.example.org/token/eyJzZWNyZXQiOiJLRVkifQ/catalog/movie/top/search=matrix.json";
const ADDON_A_MOVIE_META_URL: &str =
    "https://addon-a.example.org/token/eyJzZWNyZXQiOiJLRVkifQ/meta/movie/tt0133093.json";
const ADDON_A_SERIES_META_URL: &str =
    "https://addon-a.example.org/token/eyJzZWNyZXQiOiJLRVkifQ/meta/series/tt0903747.json";

const ADDON_B_URL: &str = "https://addon-b.example.org/manifest.json";
const ADDON_B_ID: &str = "org.example.addonB";
const ADDON_B_SEARCH_URL: &str =
    "https://addon-b.example.org/catalog/movie/popular/search=matrix.json";
const ADDON_B_SERIES_META_URL: &str = "https://addon-b.example.org/meta/series/tt0903747.json";

const SERIES_META: &str = include_str!("fixtures/cinemeta-meta-series.json");
const MOVIE_META: &str = r#"{"meta":{"id":"tt0133093","type":"movie","name":"The Matrix"}}"#;
const CATALOG_PAGE: &str = r#"{"metas":[{"id":"tt0133093","type":"movie","name":"The Matrix"}]}"#;

const STREAM_A_EP1: &str = "https://stream-a.example.org/v/tt0903747-1-1.mkv";
const STREAM_A_EP2: &str = "https://stream-a.example.org/v/tt0903747-1-2.mkv";
const STREAM_B_EP1: &str = "https://stream-b.example.org/v/tt0903747-1-1.mkv";
const STREAM_B_EP2: &str = "https://stream-b.example.org/v/tt0903747-1-2.mkv";
const STREAM_B_MOVIE: &str = "https://stream-b.example.org/v/tt0133093.mkv";

fn action(body: &serde_json::Value) -> Action {
    let envelope = format!(r#"{{"version":{ACTION_VERSION},"action":{body}}}"#);
    Action::parse(&envelope).unwrap_or_else(|error| panic!("{envelope} should parse: {error}"))
}

fn manifest(id: &str, version: &str, catalog: &str, resources: &str) -> String {
    format!(
        r#"{{
            "id": "{id}",
            "name": "{id}",
            "version": "{version}",
            "resources": [{resources}],
            "types": ["movie", "series"],
            "catalogs": [
                {{
                    "type": "movie",
                    "id": "{catalog}",
                    "name": "Movies",
                    "extra": [{{ "name": "search", "isRequired": false }}]
                }}
            ],
            "idPrefixes": ["tt"]
        }}"#
    )
}

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

fn subtitle(id: &str, url: &str, language: &str) -> Subtitle {
    Subtitle {
        id: Some(id.to_owned()),
        url: StreamUrl::parse(url).expect("valid subtitle URL"),
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

fn without_subtitles() -> Observation {
    Observation {
        state: PlaybackState::Playing,
        position: Some(12.5),
        duration: Some(600.0),
        tracks: Some(vec![audio_track()]),
        ..Observation::idle()
    }
}

struct Fixture {
    host: Host,
    store: Arc<InMemoryStore>,
    fetcher: Arc<FixtureFetcher>,
    provider: Arc<FixtureProvider>,
    player: Arc<FixturePlayer>,
    clock: Arc<FixtureClock>,
}

fn two_addon_fixture() -> Fixture {
    let store = Arc::new(InMemoryStore::new());
    let fetcher = Arc::new(
        FixtureFetcher::new()
            .serving(
                ADDON_A_URL,
                manifest(
                    ADDON_A_ID,
                    "1.0.0",
                    "top",
                    r#""catalog","meta","stream","subtitles""#,
                ),
            )
            .serving(ADDON_A_CATALOG_URL, CATALOG_PAGE)
            .serving(ADDON_A_SEARCH_URL, CATALOG_PAGE)
            .serving(ADDON_A_MOVIE_META_URL, MOVIE_META)
            .serving(ADDON_A_SERIES_META_URL, SERIES_META)
            .serving(
                ADDON_B_URL,
                manifest(
                    ADDON_B_ID,
                    "1.0.0",
                    "popular",
                    r#""catalog","meta","stream","subtitles""#,
                ),
            )
            .serving(ADDON_B_SEARCH_URL, CATALOG_PAGE)
            .serving(ADDON_B_SERIES_META_URL, SERIES_META),
    );
    let provider = Arc::new(
        FixtureProvider::new()
            .offering(
                ADDON_A_ID,
                vec![candidate("A-1080p", STREAM_A_EP1, Some("rel-a"))],
            )
            .offering_for_video(
                ADDON_A_ID,
                "tt0903747:1:2",
                vec![candidate("A-ep2", STREAM_A_EP2, Some("rel-a"))],
            )
            .offering_subtitles(
                ADDON_A_ID,
                vec![subtitle("a-por", "https://subs.example.org/a.srt", "por")],
            )
            .offering(
                ADDON_B_ID,
                vec![candidate("B-1080p", STREAM_B_MOVIE, Some("rel-b"))],
            )
            .offering_for_video(
                ADDON_B_ID,
                "tt0903747:1:1",
                vec![candidate("B-ep1", STREAM_B_EP1, Some("rel-b"))],
            )
            .offering_for_video(
                ADDON_B_ID,
                "tt0903747:1:2",
                vec![candidate("B-ep2", STREAM_B_EP2, Some("rel-b"))],
            )
            .offering_subtitles(
                ADDON_B_ID,
                vec![subtitle("b-eng", "https://subs.example.org/b.srt", "eng")],
            ),
    );
    let player = Arc::new(FixturePlayer::new());
    let clock = Arc::new(FixtureClock::new());

    let mut host = Host::new(
        store.clone() as Arc<dyn Store>,
        fetcher.clone(),
        Arc::new(InMemorySecretStore::backed_by(SecretBackend::Keyring)),
        provider.clone(),
        player.clone(),
        clock.clone(),
    )
    .expect("a Host over an in-memory store starts");

    for url in [ADDON_A_URL, ADDON_B_URL] {
        host.dispatch(action(
            &serde_json::json!({ "type": "add_addon", "url": url }),
        ))
        .expect("adding the Addon should work");
    }

    Fixture {
        host,
        store,
        fetcher,
        provider,
        player,
        clock,
    }
}

fn set_enabled(host: &mut Host, addon: &str, enabled: bool) -> Result<Vec<Snapshot>, ActionError> {
    host.dispatch(action(&serde_json::json!({
        "type": "set_addon_enabled",
        "addon": addon,
        "enabled": enabled,
    })))
    .map(|response| response.snapshots)
}

fn play_episode(
    fixture: &mut Fixture,
    title_addon: Option<&str>,
    stream_addon: &str,
    video_id: &str,
    url: &str,
    binge_group: Option<&str>,
) {
    fixture
        .host
        .dispatch(action(&serde_json::json!({
            "type": "play_stream",
            "video": { "type": "series", "id": video_id },
            "addon": stream_addon,
            "title": {
                "addon": title_addon,
                "id": "tt0903747",
                "type": "series",
                "name": "Breaking Bad",
                "poster": null,
            },
            "stream": {
                "name": "1080p",
                "playback": { "kind": "direct", "url": url },
                "warnings": [],
                "bingeGroup": binge_group,
            },
        })))
        .expect("playing the episode should succeed");
}

fn sample_position(fixture: &mut Fixture, position: f64, duration: f64, advance_ms: i64) {
    fixture.clock.tick(advance_ms);
    fixture.player.now_reporting(Observation {
        state: PlaybackState::Playing,
        position: Some(position),
        duration: Some(duration),
        ..Observation::idle()
    });
    fixture
        .host
        .sample()
        .expect("sampling playback should succeed");
}

#[test]
fn new_addons_default_to_enabled_and_never_leak_manifest_urls_into_snapshot() {
    let fixture = two_addon_fixture();
    let snapshot = fixture.host.snapshot();

    assert_eq!(snapshot.addons.len(), 2);
    assert!(snapshot.addons[0].enabled);
    assert!(snapshot.addons[1].enabled);

    let wire = serde_json::to_string(&snapshot).expect("Snapshot serializes");
    assert!(wire.contains(r#""enabled":true"#));
    assert!(
        !wire.contains("addon-a.example.org") && !wire.contains("eyJzZWNyZXQiOiJLRVkifQ"),
        "manifest URLs and embedded credentials must never appear in a Snapshot (ADR-0009)"
    );
}

#[test]
fn set_addon_enabled_toggles_state_preserves_order_and_validates_errors() {
    let mut fixture = two_addon_fixture();
    let before = fixture.host.snapshot().revision;

    let disabled = set_enabled(&mut fixture.host, ADDON_A_ID, false).expect("disable works");
    assert_eq!(disabled.len(), 1);
    assert_eq!(disabled[0].revision, before + 1);
    assert_eq!(disabled[0].addons[0].id.as_str(), ADDON_A_ID);
    assert!(!disabled[0].addons[0].enabled);
    assert_eq!(disabled[0].addons[1].id.as_str(), ADDON_B_ID);
    assert!(disabled[0].addons[1].enabled);

    // Reordering a disabled Addon keeps it disabled.
    let moved = fixture
        .host
        .dispatch(action(&serde_json::json!({
            "type": "reorder_addon",
            "id": ADDON_A_ID,
            "position": 1,
        })))
        .expect("reordering a disabled Addon works");
    assert_eq!(moved.snapshots[0].addons[1].id.as_str(), ADDON_A_ID);
    assert!(!moved.snapshots[0].addons[1].enabled);

    // Unknown and invalid Addon ids are refused cleanly without moving state.
    let revision_before_error = fixture.host.snapshot().revision;
    let unknown = set_enabled(&mut fixture.host, "org.example.missing", false);
    assert!(matches!(unknown, Err(ActionError::UnknownAddon { .. })));

    let invalid = set_enabled(&mut fixture.host, "not an id", false);
    assert!(matches!(invalid, Err(ActionError::InvalidAddonId(_))));
    assert_eq!(fixture.host.snapshot().revision, revision_before_error);

    // A store write failure leaves in-memory state untouched.
    fixture.store.failing_writes();
    let failed = set_enabled(&mut fixture.host, ADDON_A_ID, true);
    assert!(matches!(failed, Err(ActionError::Store { .. })));
    assert!(!fixture.host.snapshot().addons[1].enabled);
}

#[test]
fn reconfiguring_a_disabled_addon_preserves_its_disabled_state() {
    let mut fixture = two_addon_fixture();
    set_enabled(&mut fixture.host, ADDON_A_ID, false).expect("disable works");

    // Re-adding the same Addon id with a new manifest version keeps it disabled.
    fixture.fetcher.update(
        ADDON_A_URL,
        Ok(manifest(
            ADDON_A_ID,
            "2.0.0",
            "top",
            r#""catalog","meta","stream","subtitles""#,
        )),
    );
    let reconfigured = fixture
        .host
        .dispatch(action(&serde_json::json!({
            "type": "add_addon",
            "url": ADDON_A_URL,
        })))
        .expect("reconfiguring a disabled Addon succeeds");

    let addon = &reconfigured.snapshots[0].addons[0];
    assert_eq!(addon.version, "2.0.0");
    assert!(
        !addon.enabled,
        "reconfiguration must preserve an Addon's disabled state (ADR-0044 §2)"
    );
    assert!(!fixture.store.persisted_addons()[0].is_enabled());
}

#[test]
fn disabling_the_featured_addon_hides_it_in_snapshot_and_restores_it_on_reenable() {
    let mut fixture = two_addon_fixture();

    let marked = fixture
        .host
        .dispatch(action(&serde_json::json!({
            "type": "set_featured_catalog",
            "addon": ADDON_A_ID,
            "catalog": { "type": "movie", "id": "top" },
        })))
        .expect("setting featured catalog works");
    assert!(marked.snapshots[0].featured_catalog.is_some());

    // Disabling another Addon leaves the Featured catalog published.
    let other_off = set_enabled(&mut fixture.host, ADDON_B_ID, false).expect("disable B");
    assert!(other_off[0].featured_catalog.is_some());

    // Disabling the featured Addon hides Snapshot.featured_catalog while
    // keeping the persisted preference intact.
    let disabled = set_enabled(&mut fixture.host, ADDON_A_ID, false).expect("disable A");
    assert!(disabled[0].featured_catalog.is_none());
    assert!(
        fixture.store.persisted().featured_catalog().is_some(),
        "disabling an Addon keeps the featured_catalog preference stored"
    );

    // Setting featured_catalog against a disabled Addon is refused.
    let refused = fixture.host.dispatch(action(&serde_json::json!({
        "type": "set_featured_catalog",
        "addon": ADDON_A_ID,
        "catalog": { "type": "movie", "id": "top" },
    })));
    assert!(matches!(
        refused,
        Err(ActionError::AddonDisabled { ref id }) if id == ADDON_A_ID
    ));

    // A restart while disabled keeps the preference stored and Snapshot suppressed.
    let mut restarted = Host::new(
        fixture.store.clone() as Arc<dyn Store>,
        fixture.fetcher.clone(),
        Arc::new(InMemorySecretStore::backed_by(SecretBackend::Keyring)),
        fixture.provider.clone(),
        Arc::new(FixturePlayer::new()),
        Arc::new(FixtureClock::new()),
    )
    .expect("restarted Host starts");
    assert!(restarted.snapshot().featured_catalog.is_none());
    assert!(fixture.store.persisted().featured_catalog().is_some());

    // Re-enabling restores the Featured catalog automatically.
    let restored = set_enabled(&mut restarted, ADDON_A_ID, true).expect("re-enable A");
    let featured = restored[0]
        .featured_catalog
        .as_ref()
        .expect("featured catalog returns when its Addon is re-enabled");
    assert_eq!(featured.addon.as_str(), ADDON_A_ID);
    assert_eq!(featured.catalog.id, "top");
}

#[test]
fn disabled_addons_are_skipped_by_search_streams_and_external_subtitles() {
    let mut fixture = two_addon_fixture();
    set_enabled(&mut fixture.host, ADDON_A_ID, false).expect("disable A");

    let asked_urls_before = fixture.fetcher.asked().len();
    let search = fixture
        .host
        .dispatch(action(&serde_json::json!({
            "type": "search_catalogs",
            "query": "matrix",
        })))
        .expect("search_catalogs succeeds with only enabled Addons");
    let rows = search.catalogs().expect("catalog rows answer");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].addon.as_str(), ADDON_B_ID);
    assert!(
        !fixture.fetcher.asked()[asked_urls_before..]
            .iter()
            .any(|url| url.contains("addon-a.example.org")),
        "search_catalogs must not fetch from a disabled Addon"
    );

    let asked_provider_before = fixture.provider.asked().len();
    let streams = fixture
        .host
        .dispatch(action(&serde_json::json!({
            "type": "find_streams",
            "video": { "type": "movie", "id": "tt0133093" },
        })))
        .expect("find_streams succeeds with only enabled Addons");
    let groups = streams.streams().expect("stream groups answer");
    assert_eq!(groups.len(), 1);
    assert_eq!(groups[0].addon.as_str(), ADDON_B_ID);
    assert_eq!(
        fixture.provider.asked()[asked_provider_before..],
        vec![ADDON_B_ID.to_owned()]
    );

    // External subtitles fallback asks only enabled Addons.
    let asked_subs_before = fixture.provider.asked().len();
    play_episode(
        &mut fixture,
        Some(ADDON_B_ID),
        ADDON_B_ID,
        "tt0903747:1:1",
        STREAM_B_EP1,
        Some("rel-b"),
    );
    fixture.player.now_reporting(without_subtitles());
    fixture
        .host
        .sample()
        .expect("sampling triggers subtitles fallback");
    assert_eq!(
        fixture.provider.asked()[asked_subs_before..],
        vec![ADDON_B_ID.to_owned()]
    );
    let added_subtitles: Vec<String> = fixture
        .player
        .tellings()
        .into_iter()
        .filter_map(|telling| match telling {
            Telling::AddSubtitle { url, .. } => Some(url.as_str().to_owned()),
            _ => None,
        })
        .collect();
    assert_eq!(added_subtitles, vec!["https://subs.example.org/b.srt"]);
}

#[test]
fn direct_targeting_of_a_disabled_addon_is_refused_without_fetching() {
    let mut fixture = two_addon_fixture();

    // Prime the Title cache for Addon A before disabling it.
    let opened = fixture
        .host
        .dispatch(action(&serde_json::json!({
            "type": "open_title",
            "addon": ADDON_A_ID,
            "title": { "type": "movie", "id": "tt0133093" },
        })))
        .expect("opening before disabling caches the Title");
    assert_eq!(opened.title().expect("title").name, "The Matrix");

    set_enabled(&mut fixture.host, ADDON_A_ID, false).expect("disable A");
    let asked_before = fixture.fetcher.asked().len();

    let browse = fixture.host.dispatch(action(&serde_json::json!({
        "type": "browse_catalog",
        "addon": ADDON_A_ID,
        "catalog": { "type": "movie", "id": "top" },
    })));
    assert!(matches!(
        browse,
        Err(ActionError::AddonDisabled { ref id }) if id == ADDON_A_ID
    ));

    // Even a cached Title owned by a disabled Addon is refused cleanly.
    let open = fixture.host.dispatch(action(&serde_json::json!({
        "type": "open_title",
        "addon": ADDON_A_ID,
        "title": { "type": "movie", "id": "tt0133093" },
    })));
    assert!(matches!(
        open,
        Err(ActionError::AddonDisabled { ref id }) if id == ADDON_A_ID
    ));

    assert_eq!(
        fixture.fetcher.asked().len(),
        asked_before,
        "refused browse_catalog and open_title must perform zero fetches"
    );

    // Re-enabling makes both work again.
    set_enabled(&mut fixture.host, ADDON_A_ID, true).expect("re-enable A");
    let reopened = fixture
        .host
        .dispatch(action(&serde_json::json!({
            "type": "open_title",
            "addon": ADDON_A_ID,
            "title": { "type": "movie", "id": "tt0133093" },
        })))
        .expect("open_title succeeds once re-enabled");
    assert_eq!(reopened.title().expect("title").name, "The Matrix");
}

#[test]
fn continue_watching_and_watch_progress_mark_disabled_addons_distinct_from_removed() {
    let mut fixture = two_addon_fixture();

    // Play an Addon-supplied Title and a Discovered Title (addon: null).
    play_episode(
        &mut fixture,
        Some(ADDON_A_ID),
        ADDON_A_ID,
        "tt0903747:1:1",
        STREAM_A_EP1,
        Some("rel-a"),
    );
    sample_position(&mut fixture, 400.0, 2800.0, 2_000);

    fixture
        .host
        .dispatch(action(&serde_json::json!({
            "type": "play_stream",
            "video": { "type": "movie", "id": "tt0133093" },
            "addon": ADDON_A_ID,
            "title": {
                "addon": null,
                "id": "tt0133093",
                "type": "movie",
                "name": "The Matrix",
                "poster": null,
            },
            "stream": {
                "name": "1080p",
                "playback": { "kind": "direct", "url": STREAM_B_MOVIE },
                "warnings": [],
            },
        })))
        .expect("playing discovered title succeeds");
    sample_position(&mut fixture, 600.0, 7200.0, 3_000);

    // Disabling Addon A marks the Addon-supplied Title as AddonDisabled on both
    // Continue watching and Watch progress, while leaving the Discovered Title playable.
    let disabled = set_enabled(&mut fixture.host, ADDON_A_ID, false).expect("disable A");
    let snapshot = &disabled[0];

    let series_cw = snapshot
        .continue_watching
        .iter()
        .find(|entry| entry.title.id() == "tt0903747")
        .expect("disabled Addon's Title remains listed in Continue watching");
    assert_eq!(
        series_cw.unplayable.as_ref().map(|entry| entry.reason),
        Some(UnplayableReason::AddonDisabled)
    );

    let series_wp = snapshot
        .watch_progress
        .iter()
        .find(|entry| entry.video.id == "tt0903747:1:1")
        .expect("disabled Addon's Video remains listed in Watch progress");
    assert_eq!(
        series_wp.unplayable.as_ref().map(|entry| entry.reason),
        Some(UnplayableReason::AddonDisabled)
    );

    let discovered_cw = snapshot
        .continue_watching
        .iter()
        .find(|entry| entry.title.id() == "tt0133093")
        .expect("Discovered Title remains listed");
    assert_eq!(
        discovered_cw.unplayable, None,
        "a Discovered Title has no supplying Addon and is never marked AddonDisabled"
    );

    // Wire spelling is snake_case "addon_disabled".
    let wire = serde_json::to_string(snapshot).expect("Snapshot serializes");
    assert!(wire.contains(r#""reason":"addon_disabled""#));

    // Resuming the Addon-supplied Title is refused with AddonDisabled,
    // while resuming the Discovered Title skips Addon A and resolves from Addon B.
    let asked_before = fixture.provider.asked().len();
    let refused_resume = fixture.host.dispatch(action(&serde_json::json!({
        "type": "resume",
        "video": { "type": "series", "id": "tt0903747:1:1" },
    })));
    assert!(matches!(
        refused_resume,
        Err(ActionError::AddonDisabled { ref id }) if id == ADDON_A_ID
    ));
    assert_eq!(fixture.provider.asked().len(), asked_before);

    fixture
        .host
        .dispatch(action(&serde_json::json!({
            "type": "resume",
            "video": { "type": "movie", "id": "tt0133093" },
        })))
        .expect("resuming a Discovered Title falls through to enabled Addon B");
    assert_eq!(
        fixture.provider.asked()[asked_before..],
        vec![ADDON_B_ID.to_owned()]
    );

    // Re-enabling Addon A clears the unplayable mark on both lists.
    let reenabled = set_enabled(&mut fixture.host, ADDON_A_ID, true).expect("re-enable A");
    let series_cw = reenabled[0]
        .continue_watching
        .iter()
        .find(|entry| entry.title.id() == "tt0903747")
        .expect("series entry present");
    assert_eq!(series_cw.unplayable, None);
    let series_wp = reenabled[0]
        .watch_progress
        .iter()
        .find(|entry| entry.video.id == "tt0903747:1:1")
        .expect("watch progress entry present");
    assert_eq!(series_wp.unplayable, None);

    // Disabling then removing transitions AddonDisabled -> AddonRemoved.
    set_enabled(&mut fixture.host, ADDON_A_ID, false).expect("disable A again");
    let removed = fixture
        .host
        .dispatch(action(&serde_json::json!({
            "type": "remove_addon",
            "id": ADDON_A_ID,
        })))
        .expect("removing a disabled Addon works");
    let series_cw = removed.snapshots[0]
        .continue_watching
        .iter()
        .find(|entry| entry.title.id() == "tt0903747")
        .expect("series entry still listed after removal");
    assert_eq!(
        series_cw.unplayable.as_ref().map(|entry| entry.reason),
        Some(UnplayableReason::AddonRemoved)
    );
}

#[test]
fn next_episode_and_previous_episode_refuse_disabled_addons() {
    let mut fixture = two_addon_fixture();

    // Play episode 2 from Addon A, then disable Addon A while playing.
    play_episode(
        &mut fixture,
        Some(ADDON_A_ID),
        ADDON_A_ID,
        "tt0903747:1:2",
        STREAM_A_EP2,
        Some("rel-a"),
    );
    sample_position(&mut fixture, 120.0, 2800.0, 2_000);
    set_enabled(&mut fixture.host, ADDON_A_ID, false).expect("disable A");

    let asked_provider_before = fixture.provider.asked().len();
    let next = fixture
        .host
        .dispatch(action(&serde_json::json!({ "type": "next_episode" })));
    assert!(
        matches!(next, Err(ActionError::AddonDisabled { ref id }) if id == ADDON_A_ID),
        "next_episode should refuse disabled Addon A: {next:?}"
    );

    let prev = fixture
        .host
        .dispatch(action(&serde_json::json!({ "type": "previous_episode" })));
    assert!(
        matches!(prev, Err(ActionError::AddonDisabled { ref id }) if id == ADDON_A_ID),
        "previous_episode should refuse disabled Addon A: {prev:?}"
    );
    assert_eq!(
        fixture.provider.asked().len(),
        asked_provider_before,
        "disabled next/previous episode must not ask streams"
    );
}

#[test]
fn play_up_next_refuses_when_title_or_stream_addon_is_disabled() {
    let mut fixture = two_addon_fixture();

    // Open the series meta from B so the Title cache knows episode 2 comes after episode 1.
    fixture
        .host
        .dispatch(action(&serde_json::json!({
            "type": "open_title",
            "addon": ADDON_B_ID,
            "title": { "type": "series", "id": "tt0903747" },
        })))
        .expect("opening series from B caches episodes");

    play_episode(
        &mut fixture,
        Some(ADDON_B_ID),
        ADDON_A_ID,
        "tt0903747:1:1",
        STREAM_A_EP1,
        Some("rel-a"),
    );
    // Report episode 1 ended so Continue watching promotes to Up next (1:2).
    fixture.clock.tick(5_000);
    fixture.player.now_reporting(Observation {
        state: PlaybackState::Ended,
        position: Some(2820.0),
        duration: Some(2820.0),
        ..Observation::idle()
    });
    fixture
        .host
        .sample()
        .expect("ending episode 1 promotes Up next");

    set_enabled(&mut fixture.host, ADDON_A_ID, false).expect("disable stream Addon A");
    let asked_before_up_next = fixture.provider.asked().len();
    let up_next = fixture.host.dispatch(action(&serde_json::json!({
        "type": "play_up_next",
        "title": { "type": "series", "id": "tt0903747" },
    })));
    assert!(
        matches!(up_next, Err(ActionError::AddonDisabled { ref id }) if id == ADDON_A_ID),
        "play_up_next should refuse disabled stream Addon A: {up_next:?}"
    );
    assert_eq!(fixture.provider.asked().len(), asked_before_up_next);

    // Re-enable A and disable Title's supplying Addon B: play_up_next refuses on B too.
    set_enabled(&mut fixture.host, ADDON_A_ID, true).expect("re-enable A");
    set_enabled(&mut fixture.host, ADDON_B_ID, false).expect("disable Title Addon B");
    let up_next_title_disabled = fixture.host.dispatch(action(&serde_json::json!({
        "type": "play_up_next",
        "title": { "type": "series", "id": "tt0903747" },
    })));
    assert!(
        matches!(
            up_next_title_disabled,
            Err(ActionError::AddonDisabled { ref id }) if id == ADDON_B_ID
        ),
        "play_up_next should refuse disabled Title Addon B: {up_next_title_disabled:?}"
    );
}

fn asked_of_addon_a(fetcher: &FixtureFetcher, since: usize) -> Vec<String> {
    fetcher.asked()[since..]
        .iter()
        .filter(|url| url.contains("addon-a.example.org"))
        .cloned()
        .collect()
}

#[test]
fn resume_resolves_a_stream_from_enabled_addons_only() {
    let mut fixture = two_addon_fixture();

    // Addon B supplies the Title; Addon A, configured first, streamed it.
    play_episode(
        &mut fixture,
        Some(ADDON_B_ID),
        ADDON_A_ID,
        "tt0903747:1:2",
        STREAM_A_EP2,
        Some("rel-a"),
    );
    sample_position(&mut fixture, 400.0, 2800.0, 2_000);
    set_enabled(&mut fixture.host, ADDON_A_ID, false).expect("disable A");

    let asked_before = fixture.provider.asked().len();
    fixture
        .host
        .dispatch(action(&serde_json::json!({
            "type": "resume",
            "video": { "type": "series", "id": "tt0903747:1:2" },
        })))
        .expect("resume falls through to an enabled Addon");

    assert_eq!(
        fixture.provider.asked()[asked_before..],
        vec![ADDON_B_ID.to_owned()]
    );
}

#[test]
fn episode_steps_read_the_series_list_only_from_enabled_addons() {
    let mut fixture = two_addon_fixture();
    set_enabled(&mut fixture.host, ADDON_A_ID, false).expect("disable A");
    play_episode(
        &mut fixture,
        Some(ADDON_B_ID),
        ADDON_B_ID,
        "tt0903747:1:1",
        STREAM_B_EP1,
        Some("rel-b"),
    );
    sample_position(&mut fixture, 120.0, 2800.0, 2_000);

    let fetched_before = fixture.fetcher.asked().len();
    fixture
        .host
        .dispatch(action(&serde_json::json!({ "type": "next_episode" })))
        .expect("Addon B lists the next episode and streams it");

    assert_eq!(
        asked_of_addon_a(&fixture.fetcher, fetched_before),
        Vec::<String>::new(),
        "Addon A is configured first and answers meta, but it is switched off"
    );
    assert!(fixture.fetcher.asked()[fetched_before..].contains(&ADDON_B_SERIES_META_URL.to_owned()));
}

#[test]
fn episode_steps_refuse_a_disabled_title_addon_even_when_the_stream_addon_is_on() {
    let mut fixture = two_addon_fixture();
    play_episode(
        &mut fixture,
        Some(ADDON_B_ID),
        ADDON_A_ID,
        "tt0903747:1:2",
        STREAM_A_EP2,
        Some("rel-a"),
    );
    sample_position(&mut fixture, 120.0, 2800.0, 2_000);
    set_enabled(&mut fixture.host, ADDON_B_ID, false).expect("disable Title Addon B");
    let asked_before = fixture.provider.asked().len();

    for step in ["next_episode", "previous_episode"] {
        let refused = fixture
            .host
            .dispatch(action(&serde_json::json!({ "type": step })));
        assert!(
            matches!(refused, Err(ActionError::AddonDisabled { ref id }) if id == ADDON_B_ID),
            "{step} should refuse the disabled Title Addon: {refused:?}"
        );
    }
    assert_eq!(fixture.provider.asked().len(), asked_before);
}

#[test]
fn autoplay_over_a_disabled_stream_addon_opens_nothing_and_says_why() {
    let mut fixture = two_addon_fixture();
    play_episode(
        &mut fixture,
        Some(ADDON_B_ID),
        ADDON_A_ID,
        "tt0903747:1:1",
        STREAM_A_EP1,
        Some("rel-a"),
    );
    set_enabled(&mut fixture.host, ADDON_A_ID, false).expect("disable stream Addon A");
    let asked_before = fixture.provider.asked().len();
    let opened_before = fixture.player.opened().len();

    fixture.clock.tick(5_000);
    fixture.player.now_reporting(Observation {
        state: PlaybackState::Ended,
        position: Some(2820.0),
        duration: Some(2820.0),
        ..Observation::idle()
    });
    fixture.host.sample().expect("the episode ends");
    fixture.clock.tick(AUTOPLAY_COUNTDOWN_MS);
    let expired = fixture.host.sample().expect("the countdown runs out");

    let autoplay = expired
        .playback
        .autoplay
        .expect("the Host says what happened");
    assert!(
        matches!(autoplay.phase, AutoplayPhase::NoStream { ref detail } if detail.contains("disabled")),
        "continuity from a disabled Addon finds nothing: {autoplay:?}"
    );
    assert_eq!(fixture.provider.asked().len(), asked_before);
    assert_eq!(fixture.player.opened().len(), opened_before);
}

/// An Addon as a store holds one, offering `meta` and Streams.
fn stored_addon(url: &str, id: &str) -> Addon {
    Addon::new(
        ManifestUrl::parse(url).expect("a manifest URL"),
        Manifest::parse(&manifest(
            id,
            "1.0.0",
            "top",
            r#""catalog","meta","stream""#,
        ))
        .expect("a manifest"),
    )
}

/// A Host over a store whose one Addon is already switched off.
fn host_with_a_disabled_addon(
    store: InMemoryStore,
    fetcher: Arc<FixtureFetcher>,
    clock: Arc<FixtureClock>,
) -> Host {
    let addon = stored_addon(ADDON_A_URL, ADDON_A_ID).with_enabled(false);

    Host::new(
        Arc::new(store.holding_addons(vec![addon])) as Arc<dyn Store>,
        fetcher,
        Arc::new(InMemorySecretStore::backed_by(SecretBackend::Keyring)),
        Arc::new(FixtureProvider::new()),
        Arc::new(FixturePlayer::new()),
        clock,
    )
    .expect("a Host over a store starts")
}

#[test]
fn a_disabled_addon_is_not_read_in_the_background() {
    let watched = WatchProgress {
        video: VideoRef::parse("movie", "tt0133093").expect("a Video"),
        title: TitleStub::parse(&TitleCard {
            addon: Some(AddonId::parse(ADDON_A_ID).expect("an Addon id")),
            id: "tt0133093".to_owned(),
            r#type: "movie".to_owned(),
            name: "The Matrix".to_owned(),
            poster: None,
            background: None,
            logo: None,
        })
        .expect("a card the Host keeps"),
        position: Some(100.0),
        duration: Some(7200.0),
        watched: false,
        stream_addon: None,
        binge_group: None,
        updated_at: 1_000,
    };
    let fetcher = Arc::new(FixtureFetcher::new().serving(ADDON_A_MOVIE_META_URL, MOVIE_META));
    let mut host = host_with_a_disabled_addon(
        InMemoryStore::new().holding_watch(vec![watched]),
        fetcher.clone(),
        Arc::new(FixtureClock::new()),
    );

    // The read-ahead a started Host owes its Continue watching row, and the one
    // a card's look hint asks for, are both asks of the Addon.
    host.drain();
    host.dispatch(action(&serde_json::json!({
        "type": "look_hint",
        "addon": ADDON_A_ID,
        "title": { "type": "movie", "id": "tt0133093" },
    })))
    .expect("a hint is fire-and-forget");
    host.drain();
    assert_eq!(fetcher.asked(), Vec::<String>::new());

    set_enabled(&mut host, ADDON_A_ID, true).expect("re-enable A");
    host.dispatch(action(&serde_json::json!({
        "type": "look_hint",
        "addon": ADDON_A_ID,
        "title": { "type": "movie", "id": "tt0133093" },
    })))
    .expect("a hint is fire-and-forget");
    host.drain();
    assert_eq!(fetcher.asked(), vec![ADDON_A_MOVIE_META_URL.to_owned()]);
}

#[test]
fn a_refresh_queued_before_the_disable_does_not_reach_the_addon() {
    let mut fixture = two_addon_fixture();
    let open = serde_json::json!({
        "type": "open_title",
        "addon": ADDON_A_ID,
        "title": { "type": "movie", "id": "tt0133093" },
    });
    fixture
        .host
        .dispatch(action(&open))
        .expect("opening caches");
    fixture.clock.tick(31 * 24 * 60 * 60 * 1000);
    fixture
        .host
        .dispatch(action(&open))
        .expect("a stale open answers the cached copy and queues a refresh");

    set_enabled(&mut fixture.host, ADDON_A_ID, false).expect("disable A");
    let fetched_before = fixture.fetcher.asked().len();
    fixture.host.drain();

    assert_eq!(
        asked_of_addon_a(&fixture.fetcher, fetched_before),
        Vec::<String>::new()
    );
}

#[test]
fn a_tmdb_keyed_video_is_not_resolved_for_a_disabled_addon() {
    const TMDB_ONLY_URL: &str = "https://tmdb-only.example.org/manifest.json";
    const TMDB_ONLY_ID: &str = "org.example.tmdbOnly";
    let spelled = |id: &str, prefix: &str| {
        format!(
            r#"{{"id":"{id}","name":"{id}","version":"1.0.0","resources":["stream"],
                 "types":["movie"],"catalogs":[],"idPrefixes":["{prefix}"]}}"#
        )
    };
    // The `/external_ids` URL is not recorded: asking TMDB for the spelling only
    // a disabled Addon wants would fail the test.
    let fetcher = Arc::new(
        FixtureFetcher::new()
            .serving(ADDON_A_URL, spelled(ADDON_A_ID, "tt"))
            .serving(TMDB_ONLY_URL, spelled(TMDB_ONLY_ID, "tmdb:")),
    );
    let provider = Arc::new(FixtureProvider::new().offering(TMDB_ONLY_ID, Vec::new()));
    let mut host = Host::new(
        Arc::new(InMemoryStore::new()) as Arc<dyn Store>,
        fetcher.clone(),
        Arc::new(InMemorySecretStore::backed_by(SecretBackend::Keyring)),
        provider.clone(),
        Arc::new(FixturePlayer::new()),
        Arc::new(FixtureClock::new()),
    )
    .expect("a Host starts");
    for url in [ADDON_A_URL, TMDB_ONLY_URL] {
        host.dispatch(action(
            &serde_json::json!({ "type": "add_addon", "url": url }),
        ))
        .expect("adding the Addon works");
    }
    host.dispatch(action(&serde_json::json!({
        "type": "set_tmdb_key",
        "key": "0123456789abcdef0123456789abcdef",
    })))
    .expect("a key is entered");
    set_enabled(&mut host, ADDON_A_ID, false).expect("disable A");
    let fetched_before = fetcher.asked().len();

    host.dispatch(action(&serde_json::json!({
        "type": "find_streams",
        "video": { "type": "movie", "id": "tmdb:603" },
    })))
    .expect("find_streams succeeds");

    assert_eq!(fetcher.asked().len(), fetched_before);
    assert_eq!(provider.asked(), vec![TMDB_ONLY_ID.to_owned()]);
}

const DAY: i64 = 24 * 60 * 60 * 1000;
const TMDB_KEY: &str = "0123456789abcdef0123456789abcdef";
const TMDB_SERIES_URL: &str = concat!(
    "https://api.themoviedb.org/3/tv/300001?append_to_response=season/1",
    "&api_key=0123456789abcdef0123456789abcdef",
);
const TMDB_SERIES_BODY: &str = r#"{
  "id": 300001,
  "name": "Renamed by TMDB",
  "status": "Returning Series",
  "seasons": [{ "season_number": 1 }],
  "season/1": {
    "season_number": 1,
    "episodes": [
      { "episode_number": 1, "name": "One" },
      { "episode_number": 2, "name": "Two" }
    ]
  }
}"#;

/// A series as the cache holds it after Addon A supplied it, under `key`.
fn series_cached_from_addon_a(key: TitleKey, source: TitleSource) -> CachedTitle {
    CachedTitle {
        title: Title {
            addon: Some(AddonId::parse(ADDON_A_ID).expect("an Addon id")),
            id: "tt0903747".to_owned(),
            key,
            r#type: "series".to_owned(),
            name: "Breaking Bad".to_owned(),
            poster: None,
            background: None,
            logo: None,
            description: None,
            release_info: None,
            runtime: None,
            imdb_rating: None,
            genres: Vec::new(),
            videos: vec![Video {
                id: "tmdb:300001:1:1".to_owned(),
                name: Some("One".to_owned()),
                season: Some(1),
                episode: Some(1),
                thumbnail: None,
                air_date: None,
                description: None,
            }],
        },
        read_at: 0,
        source,
        status: Some(SeriesStatus::Running),
        next_episode: None,
    }
}

fn unmapped_series_cached_from_addon_a() -> CachedTitle {
    series_cached_from_addon_a(
        TitleKey::Addon {
            addon: AddonId::parse(ADDON_A_ID).expect("an Addon id"),
            id: "tt0903747".to_owned(),
        },
        TitleSource::Addon,
    )
}

/// An episode of the series Addon A supplied, in Watch progress.
fn progress_from_addon_a(video: &str, watched: bool) -> WatchProgress {
    WatchProgress {
        video: VideoRef::parse("series", video).expect("a Video"),
        title: TitleStub::parse(&TitleCard {
            addon: Some(AddonId::parse(ADDON_A_ID).expect("an Addon id")),
            id: "tt0903747".to_owned(),
            r#type: "series".to_owned(),
            name: "Breaking Bad".to_owned(),
            poster: None,
            background: None,
            logo: None,
        })
        .expect("a card the Host keeps"),
        position: Some(100.0),
        duration: Some(2800.0),
        watched,
        stream_addon: None,
        binge_group: None,
        updated_at: 1_000,
    }
}

/// A signed-in Host over `store`, whose account's Library holds the series.
fn host_with_the_series_in_the_library(
    store: Arc<InMemoryStore>,
    fetcher: Arc<FixtureFetcher>,
    clock: Arc<FixtureClock>,
) -> Host {
    let stremio = Arc::new(
        FixtureStremio::new()
            .with_account("me@example.org", "hunter2", "AUTHKEY")
            .holding(vec![serde_json::json!({
                "_id": "tt0903747",
                "name": "Breaking Bad",
                "type": "series",
                "removed": false,
                "temp": false,
                "_mtime": "2020-01-01T00:00:00.000Z",
                "state": { "timeOffset": 0 },
            })]),
    );
    let mut host = Host::new(
        store as Arc<dyn Store>,
        fetcher,
        Arc::new(InMemorySecretStore::backed_by(SecretBackend::Keyring)),
        Arc::new(FixtureProvider::new()),
        Arc::new(FixturePlayer::new()),
        clock,
    )
    .expect("a Host over a store starts")
    .with_stremio(stremio);
    host.dispatch(action(&serde_json::json!({
        "type": "sign_in_stremio",
        "email": "me@example.org",
        "password": "hunter2",
    })))
    .expect("signing in");
    host
}

fn addon_a_off_and_addon_b_on() -> InMemoryStore {
    InMemoryStore::new().holding_addons(vec![
        stored_addon(ADDON_A_URL, ADDON_A_ID).with_enabled(false),
        stored_addon(ADDON_B_URL, ADDON_B_ID),
    ])
}

#[test]
fn a_disabled_addon_does_not_stop_tmdb_reading_ahead_a_title_it_supplied() {
    let store = Arc::new(
        InMemoryStore::new()
            .holding_addons(vec![
                stored_addon(ADDON_A_URL, ADDON_A_ID).with_enabled(false)
            ])
            .holding_titles(vec![series_cached_from_addon_a(
                TitleKey::Tmdb { id: 300001 },
                TitleSource::Both,
            )])
            .holding_watch(vec![progress_from_addon_a("tmdb:300001:1:1", false)]),
    );
    let fetcher = Arc::new(FixtureFetcher::new().serving(TMDB_SERIES_URL, TMDB_SERIES_BODY));
    let mut host = Host::new(
        store as Arc<dyn Store>,
        fetcher.clone(),
        Arc::new(InMemorySecretStore::backed_by(SecretBackend::Keyring)),
        Arc::new(FixtureProvider::new()),
        Arc::new(FixturePlayer::new()),
        Arc::new(FixtureClock::new().at(2 * DAY)),
    )
    .expect("a Host over a store starts");
    host.dispatch(action(&serde_json::json!({
        "type": "set_tmdb_key",
        "key": TMDB_KEY,
    })))
    .expect("a key is entered");

    host.drain();
    assert_eq!(fetcher.asked(), vec![TMDB_SERIES_URL.to_owned()]);

    // TMDB only described the Title: it is still the one Addon A supplied, so
    // switching A back on finds the refreshed copy under A's own id.
    set_enabled(&mut host, ADDON_A_ID, true).expect("re-enable A");
    let response = host
        .dispatch(action(&serde_json::json!({
            "type": "open_title",
            "addon": ADDON_A_ID,
            "title": { "type": "series", "id": "tt0903747" },
        })))
        .expect("the refreshed copy opens");
    let title = response.title().expect("a Title Answer");
    assert_eq!(title.name, "Renamed by TMDB");
    assert_eq!(title.videos.len(), 2);
    assert_eq!(fetcher.asked(), vec![TMDB_SERIES_URL.to_owned()]);
}

#[test]
fn a_library_title_kept_from_a_disabled_addon_is_read_ahead_from_an_enabled_one() {
    let store = Arc::new(
        addon_a_off_and_addon_b_on().holding_titles(vec![unmapped_series_cached_from_addon_a()]),
    );
    let fetcher = Arc::new(FixtureFetcher::new().serving(ADDON_B_SERIES_META_URL, SERIES_META));
    let mut host = host_with_the_series_in_the_library(
        store.clone(),
        fetcher.clone(),
        Arc::new(FixtureClock::new().at(8 * DAY)),
    );

    host.drain();

    assert_eq!(fetcher.asked(), vec![ADDON_B_SERIES_META_URL.to_owned()]);
    assert!(
        store
            .persisted_titles()
            .contains(&unmapped_series_cached_from_addon_a()),
        "the disabled Addon's copy stays for when it is back"
    );
}

#[test]
fn a_library_title_is_read_ahead_from_the_first_enabled_addon() {
    let fetcher = Arc::new(FixtureFetcher::new().serving(ADDON_B_SERIES_META_URL, SERIES_META));
    let mut host = host_with_the_series_in_the_library(
        Arc::new(addon_a_off_and_addon_b_on()),
        fetcher.clone(),
        Arc::new(FixtureClock::new()),
    );

    host.drain();

    assert_eq!(fetcher.asked(), vec![ADDON_B_SERIES_META_URL.to_owned()]);
}

#[test]
fn account_sync_does_not_ask_a_disabled_addon_for_a_series_episode_order() {
    // A watched episode is what makes the merge want the Videos' order.
    let store = Arc::new(
        InMemoryStore::new()
            .holding_addons(vec![
                stored_addon(ADDON_A_URL, ADDON_A_ID).with_enabled(false)
            ])
            .holding_watch(vec![progress_from_addon_a("tt0903747:1:1", true)]),
    );
    let fetcher = Arc::new(FixtureFetcher::new().serving(ADDON_A_SERIES_META_URL, SERIES_META));

    let mut host =
        host_with_the_series_in_the_library(store, fetcher.clone(), Arc::new(FixtureClock::new()));
    host.drain();

    assert_eq!(fetcher.asked(), Vec::<String>::new());
}

#[test]
fn a_stream_of_a_disabled_addon_still_opens_and_asks_it_nothing() {
    let mut fixture = two_addon_fixture();
    set_enabled(&mut fixture.host, ADDON_A_ID, false).expect("disable A");
    let fetched_before = fixture.fetcher.asked().len();
    let asked_before = fixture.provider.asked().len();

    play_episode(
        &mut fixture,
        Some(ADDON_B_ID),
        ADDON_A_ID,
        "tt0903747:1:1",
        STREAM_A_EP1,
        None,
    );
    fixture
        .host
        .dispatch(action(&serde_json::json!({
            "type": "switch_stream",
            "addon": ADDON_A_ID,
            "stream": {
                "name": "720p",
                "playback": { "kind": "direct", "url": STREAM_A_EP2 },
                "warnings": [],
            },
        })))
        .expect("the Stream itself was handed to the Host");

    assert_eq!(fixture.player.opened().len(), 2);
    assert_eq!(fixture.fetcher.asked().len(), fetched_before);
    assert_eq!(fixture.provider.asked().len(), asked_before);
}

#[test]
fn set_addon_enabled_is_on_the_action_surface_and_wire_codec() {
    assert!(Action::SPELLINGS.contains(&"set_addon_enabled"));

    let wire = format!(
        r#"{{"version":{WIRE_VERSION},"id":9,"command":{{"type":"set_addon_enabled","addon":"{ADDON_A_ID}","enabled":false}}}}"#
    );
    let parsed = ClientFrame::parse(&wire).expect("set_addon_enabled frame parses");
    assert_eq!(
        parsed,
        ClientFrame::Command {
            id: 9,
            action: Action::SetAddonEnabled {
                addon: ADDON_A_ID.to_owned(),
                enabled: false,
            },
        }
    );
}
