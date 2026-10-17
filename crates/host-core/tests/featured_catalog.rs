//! The Featured catalog: the one Catalog the owner has marked as the Host's
//! featured feed (#74), driven the way a client drives it — an Action in,
//! published Snapshots out. Nothing below the Action surface is named here, and
//! nothing in this file reaches the network: every fetch is a recorded fixture.

use std::sync::Arc;

use host_core::{
    Action, ActionError, Addon, AddonId, AddonProvider, CatalogRef, FeaturedCatalog, FixtureClock,
    FixtureFetcher, FixturePlayer, Host, InMemorySecretStore, InMemoryStore, Manifest, ManifestUrl,
    Preferences, Snapshot, ACTION_VERSION,
};

const STREMBOXD: &str = "https://api.stremboxd.com/manifest.json";
const CINEMETA: &str = "https://v3-cinemeta.strem.io/manifest.json";

const STREMBOXD_MANIFEST: &str = include_str!("fixtures/stremboxd-manifest.json");
const CINEMETA_MANIFEST: &str = include_str!("fixtures/cinemeta-manifest.json");

/// An Action as a client sends it: the versioned envelope, as JSON text.
fn action(body: &str) -> Action {
    let envelope = format!(r#"{{"version":{ACTION_VERSION},"action":{body}}}"#);
    Action::parse(&envelope).unwrap_or_else(|error| panic!("{envelope} should parse: {error}"))
}

/// A Player a test drives by hand: nothing plays unless a test says so.
fn player() -> Arc<FixturePlayer> {
    Arc::new(FixturePlayer::new())
}

/// A clock a test drives by hand, for the Watch progress a play records (#29).
fn clock() -> Arc<FixtureClock> {
    Arc::new(FixtureClock::new())
}

/// The in-memory stand-in for the OS keyring.
fn secrets() -> Arc<InMemorySecretStore> {
    Arc::new(InMemorySecretStore::backed_by(
        host_core::SecretBackend::Keyring,
    ))
}

/// A Host over a store, with everything the recorded Addons answer.
fn host_over(store: Arc<InMemoryStore>) -> Host {
    let fetcher = Arc::new(
        FixtureFetcher::new()
            .serving(STREMBOXD, STREMBOXD_MANIFEST)
            .serving(CINEMETA, CINEMETA_MANIFEST),
    );
    let provider = Arc::new(AddonProvider::new(fetcher.clone()));
    Host::new(store, fetcher, secrets(), provider, player(), clock())
        .expect("a Host over a store starts")
}

/// A Host over an empty store, and the store it reads back from.
fn host_with_recorded_addons() -> (Host, Arc<InMemoryStore>) {
    let store = Arc::new(InMemoryStore::new());
    (host_over(store.clone()), store)
}

/// A Featured catalog as the Host would hold it, for a test to compare against.
fn featured(addon: &str, r#type: &str, id: &str) -> FeaturedCatalog {
    FeaturedCatalog {
        addon: AddonId::parse(addon).expect("an Addon id"),
        catalog: CatalogRef::parse(r#type, id).expect("a Catalog reference"),
    }
}

/// One Addon as a store would have read it back, for a restart.
fn stored_addon(url: &str, manifest: &str) -> Addon {
    Addon::new(
        ManifestUrl::parse(url).expect("a manifest URL"),
        Manifest::parse(manifest).expect("the fixture is a manifest"),
    )
}

fn added(host: &mut Host, url: &str) {
    host.dispatch(action(&format!(r#"{{"type":"add_addon","url":{url:?}}}"#)))
        .unwrap_or_else(|error| panic!("adding {url} should work: {error}"));
}

fn removed(host: &mut Host, id: &str) -> Result<Vec<Snapshot>, ActionError> {
    host.dispatch(action(&format!(r#"{{"type":"remove_addon","id":{id:?}}}"#)))
        .map(|response| response.snapshots)
}

fn set_featured(
    host: &mut Host,
    addon: &str,
    kind: &str,
    id: &str,
) -> Result<Vec<Snapshot>, ActionError> {
    host.dispatch(action(&format!(
        r#"{{"type":"set_featured_catalog","addon":{addon:?},"catalog":{{"type":{kind:?},"id":{id:?}}}}}"#
    )))
    .map(|response| response.snapshots)
}

fn clear_featured(host: &mut Host) -> Result<Vec<Snapshot>, ActionError> {
    host.dispatch(action(r#"{"type":"clear_featured_catalog"}"#))
        .map(|response| response.snapshots)
}

/// The ids of the Addons a Snapshot publishes, in the order it publishes them.
fn ids(snapshot: &Snapshot) -> Vec<&str> {
    snapshot
        .addons
        .iter()
        .map(|manifest| manifest.id.as_str())
        .collect()
}

#[test]
fn setting_a_featured_catalog_publishes_it_on_the_snapshot() {
    let (mut host, store) = host_with_recorded_addons();
    added(&mut host, STREMBOXD);

    let published = set_featured(
        &mut host,
        "community.stremboxd",
        "movie",
        "letterboxd-popular",
    )
    .expect("a Catalog the Addon offers can be featured");

    assert_eq!(published.len(), 1, "one change publishes one Snapshot");
    assert_eq!(
        published[0].featured_catalog,
        Some(featured(
            "community.stremboxd",
            "movie",
            "letterboxd-popular"
        ))
    );
    assert_eq!(
        store.persisted().featured_catalog(),
        Some(&featured(
            "community.stremboxd",
            "movie",
            "letterboxd-popular"
        )),
        "the preference was kept"
    );
}

#[test]
fn the_featured_catalog_travels_as_the_window_reads_it() {
    let (mut host, _store) = host_with_recorded_addons();
    added(&mut host, STREMBOXD);
    set_featured(
        &mut host,
        "community.stremboxd",
        "movie",
        "letterboxd-popular",
    )
    .expect("a Catalog the Addon offers can be featured");

    let published = serde_json::to_value(host.snapshot()).expect("a Snapshot serializes");

    assert_eq!(
        published["featuredCatalog"],
        serde_json::json!({
            "addon": "community.stremboxd",
            "catalog": { "type": "movie", "id": "letterboxd-popular" },
        }),
        "the Addon and the Catalog it offers, camelCased for a JavaScript client"
    );
}

#[test]
fn a_host_starts_with_the_featured_catalog_its_store_holds() {
    let mut preferences = Preferences::new();
    preferences.set_featured_catalog(Some(featured(
        "community.stremboxd",
        "movie",
        "letterboxd-popular",
    )));
    let store = Arc::new(
        InMemoryStore::holding(preferences)
            .holding_addons(vec![stored_addon(STREMBOXD, STREMBOXD_MANIFEST)]),
    );

    let host = host_over(store);

    assert_eq!(
        host.snapshot().featured_catalog,
        Some(featured(
            "community.stremboxd",
            "movie",
            "letterboxd-popular"
        ))
    );
}

#[test]
fn clearing_the_featured_catalog_publishes_a_snapshot_without_one() {
    let (mut host, store) = host_with_recorded_addons();
    added(&mut host, STREMBOXD);
    set_featured(
        &mut host,
        "community.stremboxd",
        "movie",
        "letterboxd-popular",
    )
    .expect("a Catalog the Addon offers can be featured");

    let published = clear_featured(&mut host).expect("taking the marking away should work");

    assert_eq!(published[0].featured_catalog, None);
    assert_eq!(host.snapshot().featured_catalog, None);
    assert_eq!(
        store.persisted().featured_catalog(),
        None,
        "the store lost the marking too"
    );
}

#[test]
fn clearing_a_featured_catalog_that_was_never_set_publishes_an_empty_hero() {
    let (mut host, _store) = host_with_recorded_addons();

    let published =
        clear_featured(&mut host).expect("taking away a marking that is not there is a change");

    assert_eq!(published[0].featured_catalog, None);
    assert_eq!(published[0].revision, 1, "it is a change like any other");
}

#[test]
fn a_featured_catalog_whose_addon_the_host_does_not_have_is_refused() {
    let (mut host, store) = host_with_recorded_addons();
    let before = host.snapshot();

    let refused = set_featured(&mut host, "org.example.nowhere", "movie", "top");

    assert_eq!(
        refused,
        Err(ActionError::UnknownAddon {
            id: "org.example.nowhere".to_owned()
        })
    );
    assert_eq!(host.snapshot(), before);
    assert_eq!(
        store.persisted().featured_catalog(),
        None,
        "a refused marking is not a preference the Host holds"
    );
}

#[test]
fn a_featured_catalog_the_addon_does_not_offer_is_refused() {
    let (mut host, store) = host_with_recorded_addons();
    added(&mut host, STREMBOXD);
    let before = host.snapshot();

    let refused = set_featured(&mut host, "community.stremboxd", "movie", "nowhere");

    assert_eq!(
        refused,
        Err(ActionError::UnknownCatalog {
            addon: AddonId::parse("community.stremboxd").expect("an Addon id"),
            catalog: CatalogRef::parse("movie", "nowhere").expect("a Catalog reference"),
        }),
        "a Catalog the manifest never declared is one the Host could never ask for"
    );
    assert_eq!(host.snapshot(), before);
    assert_eq!(store.persisted().featured_catalog(), None);
}

#[test]
fn removing_the_addon_that_owns_the_featured_catalog_clears_it_in_the_same_change() {
    let (mut host, store) = host_with_recorded_addons();
    added(&mut host, STREMBOXD);
    added(&mut host, CINEMETA);
    set_featured(
        &mut host,
        "community.stremboxd",
        "movie",
        "letterboxd-popular",
    )
    .expect("a Catalog the Addon offers can be featured");

    let published =
        removed(&mut host, "community.stremboxd").expect("removing a configured Addon works");

    assert_eq!(
        ids(&published[0]),
        vec!["com.linvo.cinemeta"],
        "the Addon is gone"
    );
    assert_eq!(
        published[0].featured_catalog, None,
        "and the hero it was drawn from is gone with it, in the one Snapshot"
    );
    assert_eq!(host.snapshot().featured_catalog, None);
    assert_eq!(
        store.persisted().featured_catalog(),
        None,
        "the store lost both in the same change"
    );
    assert_eq!(
        store
            .persisted_addons()
            .iter()
            .map(|addon| addon.id().as_str().to_owned())
            .collect::<Vec<_>>(),
        vec!["com.linvo.cinemeta".to_owned()]
    );
}

/// The same Addon, re-added from another configuration URL, with a manifest
/// that no longer offers the Catalog the marking named: an Addon's catalogs are
/// its configuration's, and reconfiguring it is how they change.
fn stremboxd_without_the_featured_catalog() -> String {
    serde_json::json!({
        "id": "community.stremboxd",
        "name": "Stremboxd",
        "version": "2.0.0",
        "resources": ["catalog"],
        "types": ["movie"],
        "catalogs": [{ "type": "movie", "id": "letterboxd-top250", "name": "Top 250" }],
    })
    .to_string()
}

/// A second URL the same Addon can be configured from.
const STREMBOXD_AGAIN: &str = "https://api.stremboxd.com/configured/manifest.json";

#[test]
fn reconfiguring_the_addon_without_the_featured_catalog_clears_it() {
    let store = Arc::new(InMemoryStore::new());
    let fetcher = Arc::new(
        FixtureFetcher::new()
            .serving(STREMBOXD, STREMBOXD_MANIFEST)
            .serving(STREMBOXD_AGAIN, stremboxd_without_the_featured_catalog()),
    );
    let provider = Arc::new(AddonProvider::new(fetcher.clone()));
    let mut host = Host::new(
        store.clone(),
        fetcher,
        secrets(),
        provider,
        player(),
        clock(),
    )
    .expect("a Host over a store starts");
    added(&mut host, STREMBOXD);
    set_featured(
        &mut host,
        "community.stremboxd",
        "movie",
        "letterboxd-popular",
    )
    .expect("a Catalog the Addon offers can be featured");

    let published = host
        .dispatch(action(&format!(
            r#"{{"type":"add_addon","url":{STREMBOXD_AGAIN:?}}}"#
        )))
        .expect("re-configuring the Addon should work")
        .snapshots;

    assert_eq!(
        published[0].featured_catalog, None,
        "the reconfiguration took the Catalog away, and the marking with it"
    );
    assert_eq!(ids(&published[0]), vec!["community.stremboxd"]);
    assert_eq!(
        store.persisted().featured_catalog(),
        None,
        "the store holds what the Host does"
    );
}

#[test]
fn a_marking_whose_addon_the_store_does_not_have_is_not_one_the_host_holds() {
    // The store says a Catalog is featured and does not say the Addon exists: a
    // store written by another Host, or a write that only half landed. The Host
    // publishes only what it can honour, so Home is drawn without a hero rather
    // than from an Addon that is not configured (#74).
    let mut preferences = Preferences::new();
    preferences.set_featured_catalog(Some(featured(
        "community.stremboxd",
        "movie",
        "letterboxd-popular",
    )));
    let store = Arc::new(InMemoryStore::holding(preferences));

    let host = host_over(store);

    assert_eq!(host.snapshot().featured_catalog, None);
}

#[test]
fn removing_another_addon_leaves_the_featured_catalog_alone() {
    let (mut host, store) = host_with_recorded_addons();
    added(&mut host, STREMBOXD);
    added(&mut host, CINEMETA);
    set_featured(
        &mut host,
        "community.stremboxd",
        "movie",
        "letterboxd-popular",
    )
    .expect("a Catalog the Addon offers can be featured");

    let published = removed(&mut host, "com.linvo.cinemeta").expect("removing a configured Addon");

    assert_eq!(
        published[0].featured_catalog,
        Some(featured(
            "community.stremboxd",
            "movie",
            "letterboxd-popular"
        )),
        "the marking names an Addon the Host still has: nothing to clear"
    );
    assert_eq!(
        store.persisted().featured_catalog(),
        Some(&featured(
            "community.stremboxd",
            "movie",
            "letterboxd-popular"
        )),
        "the store was not told to clear anything either"
    );
}

#[test]
fn the_marking_a_change_left_is_the_marking_a_restarted_host_reads() {
    let (mut host, store) = host_with_recorded_addons();
    added(&mut host, STREMBOXD);
    set_featured(
        &mut host,
        "community.stremboxd",
        "movie",
        "letterboxd-popular",
    )
    .expect("a Catalog the Addon offers can be featured");

    let restarted = host_over(store);

    assert_eq!(
        restarted.snapshot().featured_catalog,
        Some(featured(
            "community.stremboxd",
            "movie",
            "letterboxd-popular"
        ))
    );
}

#[test]
fn a_store_that_refuses_the_write_leaves_the_marking_alone() {
    let (mut host, store) = host_with_recorded_addons();
    added(&mut host, STREMBOXD);
    set_featured(
        &mut host,
        "community.stremboxd",
        "movie",
        "letterboxd-popular",
    )
    .expect("a Catalog the Addon offers can be featured");
    let before = host.snapshot();
    store.failing_writes();

    let refused = clear_featured(&mut host);

    assert!(
        matches!(refused, Err(ActionError::Store { .. })),
        "a store that refuses the write is reported as a store failure: {refused:?}"
    );
    assert_eq!(
        host.snapshot(),
        before,
        "a marking the store did not accept is not a marking the Host holds"
    );
}
