//! Enabling and disabling configured Addons (ADR-0044 §2, #355), driven the
//! way a client drives the Host: an Action in, published Snapshots and Answers
//! out, with zero real network calls.

use std::sync::Arc;

use host_core::{
    Action, ActionError, ClientFrame, FixtureClock, FixtureFetcher, FixturePlayer, FixtureProvider,
    Host, InMemorySecretStore, InMemoryStore, Observation, Playback, PlaybackState, SecretBackend,
    Snapshot, Store, Stream, StreamUrl, Subtitle, Telling, Track, TrackId, TrackKind,
    UnplayableReason, ACTION_VERSION, WIRE_VERSION,
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
