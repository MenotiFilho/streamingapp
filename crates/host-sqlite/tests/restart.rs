//! A preference outlives the process that set it — the promise the store makes to
//! the Host, and the one the Host makes to its owner.

use std::path::Path;
use std::sync::Arc;

use host_core::{
    Action, AddonId, AddonProvider, CatalogRef, FeaturedCatalog, FixtureClock, FixtureFetcher,
    FixturePlayer, Host, InMemorySecretStore, Snapshot, SubtitleLanguage,
};
use host_sqlite::SqliteStore;

/// A Player a test drives by hand: nothing plays unless a test says so, and
/// every telling is remembered.
fn player() -> Arc<FixturePlayer> {
    Arc::new(FixturePlayer::new())
}

/// A clock a test drives by hand, for the Watch progress a play records (#29).
fn clock() -> Arc<FixtureClock> {
    Arc::new(FixtureClock::new())
}

/// The in-memory stand-in for the OS keyring.
fn secrets() -> Arc<InMemorySecretStore> {
    Arc::new(InMemorySecretStore::new())
}

const MANIFEST_URL: &str = "https://api.stremboxd.com/manifest.json";
const MANIFEST: &str = r#"{
    "id": "community.stremboxd",
    "name": "Stremboxd",
    "version": "2.0.0",
    "resources": ["catalog", { "name": "meta", "types": ["movie"], "idPrefixes": ["tt"] }],
    "types": ["movie"],
    "catalogs": [{ "type": "movie", "id": "letterboxd-popular", "name": "Popular This Week" }]
}"#;

/// A second Addon, so a test can watch an *order* survive a restart.
const SECOND_URL: &str = "https://v3-cinemeta.strem.io/manifest.json";
const SECOND_MANIFEST: &str = r#"{
    "id": "com.linvo.cinemeta",
    "name": "Cinemeta",
    "version": "3.0.0",
    "resources": ["catalog", { "name": "meta", "types": ["movie"], "idPrefixes": ["tt"] }],
    "types": ["movie"],
    "catalogs": [{ "type": "movie", "id": "top", "name": "Popular" }]
}"#;

fn preference(snapshot: &Snapshot) -> Option<&str> {
    snapshot
        .preferences
        .subtitle_language
        .as_ref()
        .map(SubtitleLanguage::as_str)
}

/// The subtitle appearance a Snapshot carries, as a client reads it.
fn appearance(snapshot: &Snapshot) -> (&str, f64) {
    (
        snapshot.preferences.subtitle_color.as_str(),
        snapshot.preferences.subtitle_scale.value(),
    )
}

fn action(body: &str) -> Action {
    Action::parse(&format!(r#"{{"version":1,"action":{body}}}"#))
        .unwrap_or_else(|error| panic!("{body} should parse: {error}"))
}

/// The recorded Addons a test's Host is configured with, when it needs one.
fn fetcher() -> Arc<FixtureFetcher> {
    Arc::new(
        FixtureFetcher::new()
            .serving(MANIFEST_URL, MANIFEST)
            .serving(SECOND_URL, SECOND_MANIFEST),
    )
}

/// Start a Host on this database, as launching the app does.
fn start(path: &Path) -> Host {
    let store = SqliteStore::open(path).expect("the database opens");
    let fetcher = fetcher();
    let provider = Arc::new(AddonProvider::new(fetcher.clone()));
    Host::new(
        Arc::new(store),
        fetcher,
        secrets(),
        provider,
        player(),
        clock(),
    )
    .expect("the Host starts")
}

fn take(host: &mut Host, body: &str) {
    host.dispatch(action(body))
        .unwrap_or_else(|error| panic!("{body} should be taken: {error}"));
}

fn addons(snapshot: &Snapshot) -> Vec<&str> {
    snapshot
        .addons
        .iter()
        .map(|manifest| manifest.id.as_str())
        .collect()
}

#[test]
fn the_host_remembers_the_subtitle_language_across_a_restart() {
    let directory = tempfile::tempdir().expect("a temporary directory is available");
    let database = directory.path().join("host.sqlite3");

    let mut host = start(&database);
    take(
        &mut host,
        r#"{"type":"set_subtitle_language","language":"pt-BR"}"#,
    );
    drop(host);

    let restarted = start(&database);

    assert_eq!(preference(&restarted.snapshot()), Some("pt-BR"));
}

#[test]
fn the_host_remembers_the_subtitle_appearance_across_a_restart() {
    let directory = tempfile::tempdir().expect("a temporary directory is available");
    let database = directory.path().join("host.sqlite3");

    let mut host = start(&database);
    assert_eq!(
        appearance(&host.snapshot()),
        ("#FFFFFF", 1.0),
        "a Host that has never been told draws subtitles white at full size"
    );
    take(
        &mut host,
        r##"{"type":"set_subtitle_color","color":"#00ff00"}"##,
    );
    take(&mut host, r#"{"type":"set_subtitle_scale","scale":1.5}"#);
    drop(host);

    let restarted = start(&database);

    assert_eq!(
        appearance(&restarted.snapshot()),
        ("#00FF00", 1.5),
        "the appearance a Stream is drawn with outlives the process"
    );
}

#[test]
fn a_preference_changed_twice_is_remembered_as_the_last_one() {
    let directory = tempfile::tempdir().expect("a temporary directory is available");
    let database = directory.path().join("host.sqlite3");

    let mut host = start(&database);
    take(
        &mut host,
        r#"{"type":"set_subtitle_language","language":"pt-BR"}"#,
    );
    take(
        &mut host,
        r#"{"type":"set_subtitle_language","language":"en"}"#,
    );
    drop(host);

    assert_eq!(preference(&start(&database).snapshot()), Some("en"));
}

#[test]
fn a_cleared_preference_stays_cleared_across_a_restart() {
    let directory = tempfile::tempdir().expect("a temporary directory is available");
    let database = directory.path().join("host.sqlite3");

    let mut host = start(&database);
    take(
        &mut host,
        r#"{"type":"set_subtitle_language","language":"pt-BR"}"#,
    );
    take(&mut host, r#"{"type":"clear_subtitle_language"}"#);
    drop(host);

    assert_eq!(preference(&start(&database).snapshot()), None);
}

#[test]
fn the_host_remembers_a_configured_addon_across_a_restart() {
    let directory = tempfile::tempdir().expect("a temporary directory is available");
    let database = directory.path().join("host.sqlite3");

    let mut host = start(&database);
    take(
        &mut host,
        &format!(r#"{{"type":"add_addon","url":"{MANIFEST_URL}"}}"#),
    );
    drop(host);

    let restarted = start(&database);

    assert_eq!(addons(&restarted.snapshot()), vec!["community.stremboxd"]);
    let restored = &restarted.snapshot().addons[0];
    assert_eq!(restored.name, "Stremboxd");
    assert_eq!(restored.version, "2.0.0");
    assert_eq!(restored.catalogs[0].id, "letterboxd-popular");
    assert_eq!(
        restored.resources[1].id_prefixes,
        Some(vec!["tt".to_owned()]),
        "what it offers survives, not just its name"
    );
}

#[test]
fn a_removed_addon_stays_removed_across_a_restart() {
    let directory = tempfile::tempdir().expect("a temporary directory is available");
    let database = directory.path().join("host.sqlite3");

    let mut host = start(&database);
    take(
        &mut host,
        &format!(r#"{{"type":"add_addon","url":"{MANIFEST_URL}"}}"#),
    );
    take(
        &mut host,
        r#"{"type":"remove_addon","id":"community.stremboxd"}"#,
    );
    drop(host);

    assert_eq!(addons(&start(&database).snapshot()), Vec::<&str>::new());
}

#[test]
fn the_host_remembers_the_addon_order_across_a_restart() {
    let directory = tempfile::tempdir().expect("a temporary directory is available");
    let database = directory.path().join("host.sqlite3");

    let mut host = start(&database);
    take(
        &mut host,
        &format!(r#"{{"type":"add_addon","url":"{MANIFEST_URL}"}}"#),
    );
    take(
        &mut host,
        &format!(r#"{{"type":"add_addon","url":"{SECOND_URL}"}}"#),
    );
    take(
        &mut host,
        r#"{"type":"reorder_addon","id":"com.linvo.cinemeta","position":0}"#,
    );
    drop(host);

    assert_eq!(
        addons(&start(&database).snapshot()),
        vec!["com.linvo.cinemeta", "community.stremboxd"],
        "the order the owner chose is the order the next run reads"
    );
}

#[test]
fn the_host_remembers_the_featured_catalog_across_a_restart() {
    let directory = tempfile::tempdir().expect("a temporary directory is available");
    let database = directory.path().join("host.sqlite3");

    let mut host = start(&database);
    take(
        &mut host,
        &format!(r#"{{"type":"add_addon","url":"{MANIFEST_URL}"}}"#),
    );
    take(
        &mut host,
        r#"{"type":"set_featured_catalog","addon":"community.stremboxd",
            "catalog":{"type":"movie","id":"letterboxd-popular"}}"#,
    );
    drop(host);

    assert_eq!(
        start(&database).snapshot().featured_catalog,
        Some(FeaturedCatalog {
            addon: AddonId::parse("community.stremboxd").expect("an Addon id"),
            catalog: CatalogRef::parse("movie", "letterboxd-popular").expect("a Catalog reference"),
        })
    );
}

#[test]
fn removing_the_featured_addon_leaves_no_marking_across_a_restart() {
    let directory = tempfile::tempdir().expect("a temporary directory is available");
    let database = directory.path().join("host.sqlite3");

    let mut host = start(&database);
    take(
        &mut host,
        &format!(r#"{{"type":"add_addon","url":"{MANIFEST_URL}"}}"#),
    );
    take(
        &mut host,
        r#"{"type":"set_featured_catalog","addon":"community.stremboxd",
            "catalog":{"type":"movie","id":"letterboxd-popular"}}"#,
    );
    take(
        &mut host,
        r#"{"type":"remove_addon","id":"community.stremboxd"}"#,
    );
    drop(host);

    assert_eq!(
        start(&database).snapshot().featured_catalog,
        None,
        "the marking went with the Addon, and stays gone"
    );
}
