//! Configuring Addons, driven the way a client drives it: an Action in,
//! published Snapshots out. Nothing below the Action surface is named here, and
//! nothing in this file reaches the network: every fetch is a recorded fixture.

use std::sync::Arc;

use host_core::{
    Action, ActionError, AddonProvider, FetchError, FixtureClock, FixtureFetcher, FixturePlayer,
    Host, InMemorySecretStore, InMemoryStore, Manifest, Snapshot, Store, ACTION_VERSION,
};

/// Recorded manifests, and the URLs they answer on.
const STREMBOXD: &str = "https://api.stremboxd.com/manifest.json";
const CINEMETA: &str = "https://v3-cinemeta.strem.io/manifest.json";
/// A URL shaped like the ones that carry a debrid key inside them, which is the
/// shape the Host must never publish.
const AIOSTREAMS: &str =
    "https://aiostreams.example.com/stremio/eyJkZWJyaWQiOiJTRUNSRVQifQ/manifest.json";

const STREMBOXD_MANIFEST: &str = include_str!("fixtures/stremboxd-manifest.json");
const CINEMETA_MANIFEST: &str = include_str!("fixtures/cinemeta-manifest.json");
const HOSTILE_MANIFEST: &str = include_str!("fixtures/hostile-manifest.json");
const NOT_A_MANIFEST: &str = include_str!("fixtures/not-a-manifest.html");

/// An Action as a client sends it: the versioned envelope, as JSON text.
fn action(body: &str) -> Action {
    let envelope = format!(r#"{{"version":{ACTION_VERSION},"action":{body}}}"#);
    Action::parse(&envelope).unwrap_or_else(|error| panic!("{envelope} should parse: {error}"))
}

/// A Player a test drives by hand: nothing plays unless a test says so, and
/// every telling is remembered.
fn player() -> Arc<FixturePlayer> {
    Arc::new(FixturePlayer::new())
}

/// A clock a test drives by hand, for the Watch progress a play records (#29).
fn clock() -> Arc<FixtureClock> {
    Arc::new(FixtureClock::new())
}

fn host_over(store: Arc<dyn Store>, fetcher: FixtureFetcher) -> Host {
    let fetcher = Arc::new(fetcher);
    let provider = Arc::new(AddonProvider::new(fetcher.clone()));
    Host::new(store, fetcher, secrets(), provider, player(), clock())
        .expect("a Host over a store starts")
}

/// The in-memory stand-in for the OS keyring: tests speak a credential into it
/// the way the owner's window does, and read the Snapshot's protection out.
fn secrets() -> Arc<InMemorySecretStore> {
    Arc::new(InMemorySecretStore::backed_by(
        host_core::SecretBackend::Keyring,
    ))
}

/// A Host over an empty store, with everything the recorded Addons answer.
fn host_with_recorded_addons() -> (Host, Arc<InMemoryStore>, Arc<FixtureFetcher>) {
    let store = Arc::new(InMemoryStore::new());
    let fetcher = Arc::new(
        FixtureFetcher::new()
            .serving(STREMBOXD, STREMBOXD_MANIFEST)
            .serving(CINEMETA, CINEMETA_MANIFEST)
            .serving(AIOSTREAMS, STREMBOXD_MANIFEST),
    );
    let provider = Arc::new(AddonProvider::new(fetcher.clone()));
    let host = Host::new(
        store.clone(),
        fetcher.clone(),
        secrets(),
        provider,
        player(),
        clock(),
    )
    .expect("a Host over a store starts");
    (host, store, fetcher)
}

fn add(host: &mut Host, url: &str) -> Result<Vec<Snapshot>, ActionError> {
    host.dispatch(action(&format!(r#"{{"type":"add_addon","url":{url:?}}}"#)))
        .map(|response| response.snapshots)
}

fn remove(host: &mut Host, id: &str) -> Result<Vec<Snapshot>, ActionError> {
    host.dispatch(action(&format!(r#"{{"type":"remove_addon","id":{id:?}}}"#)))
        .map(|response| response.snapshots)
}

fn reorder(host: &mut Host, id: &str, position: i64) -> Result<Vec<Snapshot>, ActionError> {
    host.dispatch(action(&format!(
        r#"{{"type":"reorder_addon","id":{id:?},"position":{position}}}"#
    )))
    .map(|response| response.snapshots)
}

fn added(host: &mut Host, url: &str) -> Vec<Snapshot> {
    add(host, url).unwrap_or_else(|error| panic!("adding {url} should work: {error}"))
}

fn addons(snapshot: &Snapshot) -> &[Manifest] {
    &snapshot.addons
}

fn ids(snapshot: &Snapshot) -> Vec<&str> {
    addons(snapshot)
        .iter()
        .map(|manifest| manifest.id.as_str())
        .collect()
}

#[test]
fn adding_an_addon_from_its_manifest_url_publishes_what_it_offers() {
    let (mut host, store, fetcher) = host_with_recorded_addons();

    let published = added(&mut host, STREMBOXD);

    assert_eq!(published.len(), 1, "one change publishes one Snapshot");
    let addon = &addons(&published[0])[0];
    assert_eq!(addon.id.as_str(), "community.stremboxd");
    assert_eq!(addon.name, "Stremboxd");
    assert_eq!(addon.version, "2.0.0");
    assert!(
        addon
            .resources
            .iter()
            .any(|resource| resource.name == "catalog"),
        "the resources it offers are published: {:?}",
        addon.resources
    );
    assert!(
        addon
            .resources
            .iter()
            .any(|resource| resource.name == "meta"
                && resource.types.as_deref() == Some(&["movie".to_owned()])),
        "a resource carries the types it covers: {:?}",
        addon.resources
    );
    assert_eq!(addon.types, vec!["movie".to_owned()]);
    assert!(
        addon
            .catalogs
            .iter()
            .any(|catalog| catalog.id == "letterboxd-popular"),
        "the catalogs it offers are published: {:?}",
        addon.catalogs
    );
    assert_eq!(
        addon.behavior_hints,
        Manifest::parse(STREMBOXD_MANIFEST)
            .expect("the fixture is a manifest")
            .behavior_hints
    );

    assert_eq!(
        fetcher.asked(),
        vec![STREMBOXD.to_owned()],
        "the Host asked for the URL the owner pasted, and nothing else"
    );
    assert_eq!(store.persisted_addons().len(), 1, "it was stored");
}

#[test]
fn an_addon_that_knows_more_than_this_host_does_still_works() {
    let (mut host, _store, _fetcher) = host_with_recorded_addons();

    let published = added(&mut host, CINEMETA);

    let addon = &addons(&published[0])[0];
    assert_eq!(addon.id.as_str(), "com.linvo.cinemeta");
    assert_eq!(addon.types, vec!["movie".to_owned(), "series".to_owned()]);
    assert!(
        addon
            .resources
            .iter()
            .any(|resource| resource.name == "addon_catalog"),
        "a resource this Host has no use for is still reported: {:?}",
        addon.resources
    );
    assert!(
        addon
            .catalogs
            .iter()
            .any(|catalog| catalog.id == "top" && catalog.name == "Popular"),
        "catalogs carrying extras this Host does not read are still reported: {:?}",
        addon.catalogs
    );
}

#[test]
fn the_manifest_url_never_reaches_a_snapshot() {
    let (mut host, _store, _fetcher) = host_with_recorded_addons();
    added(&mut host, AIOSTREAMS);

    let published = serde_json::to_string(&host.snapshot()).expect("a Snapshot serializes");

    assert!(
        !published.contains(AIOSTREAMS) && !published.contains("SECRET"),
        "an Addon's manifest URL is a credential's hiding place, and a Snapshot \
         reaches every paired client: {published}"
    );
}

#[test]
fn addons_are_listed_in_the_order_they_were_configured() {
    let (mut host, _store, _fetcher) = host_with_recorded_addons();

    added(&mut host, STREMBOXD);
    let published = added(&mut host, CINEMETA);

    assert_eq!(
        ids(&published[0]),
        vec!["community.stremboxd", "com.linvo.cinemeta"]
    );
}

#[test]
fn reordering_an_addon_moves_it_to_that_position_in_the_order() {
    let (mut host, store) = host_holding_three_addons();

    let published =
        reorder(&mut host, "org.example.third", 0).expect("moving a configured Addon should work");

    assert_eq!(
        ids(&published[0]),
        vec![
            "org.example.third",
            "org.example.first",
            "org.example.second"
        ]
    );
    assert_eq!(
        ids(&host.snapshot()),
        ids(&published[0]),
        "the state followed the published order"
    );
    assert_eq!(
        stored_ids(&store),
        vec![
            "org.example.third",
            "org.example.first",
            "org.example.second"
        ],
        "the store kept the new order, not just the state"
    );
}

#[test]
fn moving_an_addon_to_the_last_position_leaves_the_others_in_their_order() {
    let (mut host, store) = host_holding_three_addons();

    let published =
        reorder(&mut host, "org.example.first", 2).expect("the last configured position is one");

    assert_eq!(
        ids(&published[0]),
        vec![
            "org.example.second",
            "org.example.third",
            "org.example.first"
        ]
    );
    assert_eq!(
        stored_ids(&store),
        vec![
            "org.example.second",
            "org.example.third",
            "org.example.first"
        ]
    );
}

#[test]
fn moving_an_addon_onto_the_position_it_already_stands_at_publishes_the_order_it_had() {
    let (mut host, _store) = host_holding_three_addons();

    let published =
        reorder(&mut host, "org.example.second", 1).expect("moving an Addon onto itself is a move");

    assert_eq!(
        published[0].revision, 1,
        "it is still a change, and every client hears of it"
    );
    assert_eq!(
        ids(&published[0]),
        vec![
            "org.example.first",
            "org.example.second",
            "org.example.third"
        ]
    );
}

#[test]
fn reordering_an_addon_the_host_does_not_have_is_refused() {
    let (mut host, store) = host_holding_three_addons();
    let before = host.snapshot();

    let refused = reorder(&mut host, "org.example.nowhere", 0);

    assert_eq!(
        refused,
        Err(ActionError::UnknownAddon {
            id: "org.example.nowhere".to_owned()
        })
    );
    assert_eq!(host.snapshot(), before);
    assert_eq!(
        stored_ids(&store).len(),
        3,
        "a refused move touches neither the state nor the store"
    );
}

#[test]
fn a_position_the_configured_addons_do_not_have_is_refused_in_the_hosts_own_terms() {
    let (mut host, store) = host_holding_three_addons();
    let before = host.snapshot();

    // Every place the list does not have is the same refusal: the last Addon
    // stands at 2, and a negative is a position no list can have.
    for position in [-1, 3, i64::from(i32::MAX)] {
        let refused = reorder(&mut host, "org.example.first", position);

        assert_eq!(
            refused,
            Err(ActionError::InvalidPosition {
                id: "org.example.first".to_owned(),
                position,
                count: 3,
            }),
            "position {position} is not a place this Host has"
        );
        assert_eq!(host.snapshot(), before);
    }

    assert_eq!(
        stored_ids(&store),
        vec![
            "org.example.first",
            "org.example.second",
            "org.example.third"
        ],
        "nothing was written"
    );
}

#[test]
fn the_order_a_reorder_left_is_the_order_a_restarted_host_reads() {
    let (mut host, store) = host_holding_three_addons();
    reorder(&mut host, "org.example.third", 0).expect("moving a configured Addon should work");

    let restarted = host_over(store, FixtureFetcher::new());

    assert_eq!(
        ids(&restarted.snapshot()),
        vec![
            "org.example.third",
            "org.example.first",
            "org.example.second"
        ]
    );
}

#[test]
fn a_store_that_refuses_the_write_leaves_the_order_alone() {
    let (mut host, store) = host_holding_three_addons();
    let before = host.snapshot();
    store.failing_writes();

    let refused = reorder(&mut host, "org.example.third", 0);

    assert!(
        matches!(refused, Err(ActionError::Store { .. })),
        "a store that refuses the write is reported as a store failure: {refused:?}"
    );
    assert_eq!(
        host.snapshot(),
        before,
        "an order the store did not accept is not the Host's"
    );
}

#[test]
fn removing_an_addon_leaves_the_others_configured() {
    let (mut host, store, _fetcher) = host_with_recorded_addons();
    added(&mut host, STREMBOXD);
    added(&mut host, CINEMETA);

    let published =
        remove(&mut host, "community.stremboxd").expect("removing a configured Addon should work");

    assert_eq!(ids(&published[0]), vec!["com.linvo.cinemeta"]);
    assert_eq!(ids(&host.snapshot()), vec!["com.linvo.cinemeta"]);
    assert_eq!(
        store
            .persisted_addons()
            .iter()
            .map(|addon| addon.id().as_str().to_owned())
            .collect::<Vec<_>>(),
        vec!["com.linvo.cinemeta".to_owned()],
        "the store lost it too"
    );
}

#[test]
fn removing_an_addon_the_host_does_not_have_is_refused() {
    let (mut host, _store, _fetcher) = host_with_recorded_addons();
    added(&mut host, STREMBOXD);
    let before = host.snapshot();

    let refused = remove(&mut host, "org.example.nowhere");

    assert_eq!(
        refused,
        Err(ActionError::UnknownAddon {
            id: "org.example.nowhere".to_owned()
        })
    );
    assert_eq!(host.snapshot(), before);
}

#[test]
fn a_manifest_that_is_not_json_is_refused_and_leaves_the_state_alone() {
    let store = Arc::new(InMemoryStore::new());
    let fetcher = FixtureFetcher::new().serving(STREMBOXD, NOT_A_MANIFEST);
    let mut host = host_over(store.clone(), fetcher);
    let before = host.snapshot();

    let refused = add(&mut host, STREMBOXD);

    assert!(
        matches!(refused, Err(ActionError::Manifest { ref detail }) if detail.contains("not a manifest")),
        "an Addon that answers a web page is reported, not crashed on: {refused:?}"
    );
    assert_eq!(host.snapshot(), before);
    assert_eq!(store.persisted_addons().len(), 0, "nothing was stored");
}

#[test]
fn a_manifest_that_lies_about_its_shape_is_refused_with_what_is_wrong_where() {
    let store = Arc::new(InMemoryStore::new());
    let fetcher = FixtureFetcher::new().serving(STREMBOXD, HOSTILE_MANIFEST);
    let mut host = host_over(store.clone(), fetcher);
    let before = host.snapshot();

    let refused = add(&mut host, STREMBOXD);

    assert_eq!(
        refused,
        Err(ActionError::Manifest {
            detail: "types should be an array of strings".to_owned()
        }),
        "the refusal names the field that lies, in the Host's own words"
    );
    assert_eq!(host.snapshot(), before);
    assert_eq!(store.persisted_addons().len(), 0, "nothing was stored");
}

#[test]
fn a_url_the_addon_does_not_answer_is_reported_without_state_changing() {
    let store = Arc::new(InMemoryStore::new());
    let fetcher =
        FixtureFetcher::new().failing(MANIFEST_NOT_FOUND, FetchError::Status { status: 404 });
    let mut host = host_over(store.clone(), fetcher);
    let before = host.snapshot();

    let refused = add(&mut host, MANIFEST_NOT_FOUND);

    assert!(
        matches!(refused, Err(ActionError::Fetch { ref detail }) if detail.contains("404")),
        "an Addon that is not there is reported: {refused:?}"
    );
    assert_eq!(host.snapshot(), before);
    assert_eq!(store.persisted_addons().len(), 0);
}

const MANIFEST_NOT_FOUND: &str = "https://api.stremboxd.com/nowhere/manifest.json";

#[test]
fn a_url_that_is_not_a_manifest_url_is_refused_before_anything_is_fetched() {
    let (mut host, store, fetcher) = host_with_recorded_addons();
    let before = host.snapshot();

    let refused = add(&mut host, "not a url");

    assert!(
        matches!(refused, Err(ActionError::InvalidManifestUrl(_))),
        "it is not a URL, let alone a manifest: {refused:?}"
    );
    assert_eq!(host.snapshot(), before);
    assert_eq!(
        fetcher.asked(),
        Vec::<String>::new(),
        "a URL that is not one is never fetched"
    );
    assert_eq!(store.persisted_addons().len(), 0);
}

#[test]
fn reconfiguring_an_addon_replaces_the_configuration_it_had() {
    let store = Arc::new(InMemoryStore::new());
    let fetcher = FixtureFetcher::new()
        .serving(STREMBOXD, addon_manifest("community.example", "1.0.0"))
        .serving(AIOSTREAMS, addon_manifest("community.example", "2.0.0"));
    let mut host = host_over(store.clone(), fetcher);
    added(&mut host, STREMBOXD);

    let published = added(&mut host, AIOSTREAMS);

    assert_eq!(ids(&published[0]), vec!["community.example"]);
    assert_eq!(addons(&published[0])[0].version, "2.0.0");
    assert_eq!(
        store.persisted_addons().len(),
        1,
        "one Addon, configured once, however many URLs it has been configured from"
    );
}

#[test]
fn a_reconfiguration_that_fails_leaves_the_addon_configured_before_it_alone() {
    let store = Arc::new(InMemoryStore::new());
    let fetcher = FixtureFetcher::new()
        .serving(STREMBOXD, addon_manifest("community.example", "1.0.0"))
        .serving(AIOSTREAMS, HOSTILE_MANIFEST);
    let mut host = host_over(store.clone(), fetcher);
    added(&mut host, STREMBOXD);

    let refused = add(&mut host, AIOSTREAMS);

    assert!(matches!(refused, Err(ActionError::Manifest { .. })));
    assert_eq!(ids(&host.snapshot()), vec!["community.example"]);
    assert_eq!(
        addons(&host.snapshot())[0].version,
        "1.0.0",
        "the Addon that was working is still the one configured"
    );
    assert_eq!(store.persisted_addons().len(), 1);
}

#[test]
fn a_host_starts_with_the_addons_its_store_holds() {
    let stored = Manifest::parse(STREMBOXD_MANIFEST).expect("the fixture is a manifest");
    let store = Arc::new(
        InMemoryStore::new().holding_addons(vec![host_core::Addon::new(
            host_core::ManifestUrl::parse(STREMBOXD).expect("the fixture URL is a URL"),
            stored,
        )]),
    );

    let host = host_over(store, FixtureFetcher::new());

    assert_eq!(ids(&host.snapshot()), vec!["community.stremboxd"]);
}

#[test]
fn a_store_that_refuses_the_write_leaves_the_addon_out() {
    let (mut host, store, _fetcher) = host_with_recorded_addons();
    added(&mut host, STREMBOXD);
    let before = host.snapshot();
    store.failing_writes();

    let refused = add(&mut host, CINEMETA);

    assert!(
        matches!(refused, Err(ActionError::Store { .. })),
        "a store that refuses the write is reported as a store failure: {refused:?}"
    );
    assert_eq!(
        host.snapshot(),
        before,
        "an Addon the store did not accept is not an Addon the Host holds"
    );
}

#[test]
fn adding_an_addon_moves_the_revision_on() {
    let (mut host, _store, _fetcher) = host_with_recorded_addons();

    let published = added(&mut host, STREMBOXD);

    assert_eq!(published[0].revision, 1);
}

/// A Host configured with three Addons, in the order the store read them: no
/// fetch is needed, because the store already holds the manifests.
fn host_holding_three_addons() -> (Host, Arc<InMemoryStore>) {
    let store = Arc::new(InMemoryStore::new().holding_addons(vec![
        stored_addon("org.example.first"),
        stored_addon("org.example.second"),
        stored_addon("org.example.third"),
    ]));
    (host_over(store.clone(), FixtureFetcher::new()), store)
}

/// One Addon as a store would have read it back.
fn stored_addon(id: &str) -> host_core::Addon {
    host_core::Addon::new(
        host_core::ManifestUrl::parse(&format!("https://{id}/manifest.json"))
            .expect("an Addon id makes a URL"),
        Manifest::parse(&addon_manifest(id, "1.0.0")).expect("the fixture is a manifest"),
    )
}

/// The ids the store holds, in the order it holds them.
fn stored_ids(store: &InMemoryStore) -> Vec<String> {
    store
        .persisted_addons()
        .iter()
        .map(|addon| addon.id().as_str().to_owned())
        .collect()
}

/// The smallest manifest an Addon could publish, for the tests that care about
/// identity rather than about content.
fn addon_manifest(id: &str, version: &str) -> String {
    serde_json::json!({
        "id": id,
        "name": "Example",
        "version": version,
        "resources": ["catalog"],
        "types": ["movie"],
        "catalogs": [],
    })
    .to_string()
}
