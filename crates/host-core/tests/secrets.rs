//! The credentials the owner gives the Host, driven the way a client drives
//! them: an Action in, published Snapshots out. The secret store is the
//! in-memory stand-in for the OS keyring; the wire is tested for what it may
//! and may not carry.

use std::sync::Arc;

use host_core::{
    Action, ActionError, AddonProvider, CredentialKind, FixtureFetcher, FixturePlayer, Host,
    InMemorySecretStore, InMemoryStore, SecretBackend, Store, ACTION_VERSION,
};

const STREMBOXD: &str = "https://api.stremboxd.com/manifest.json";
const STREMBOXD_MANIFEST: &str = include_str!("fixtures/stremboxd-manifest.json");
const MANIFEST_URL_COULD_HIDE_A_KEY: &str =
    "https://aiostreams.example.com/stremio/eyJkZWJyaWQiOiJTRUNSRVQifQ/manifest.json";

/// An Action as a client sends it: the versioned envelope, as JSON text.
fn action(body: &serde_json::Value) -> Action {
    let envelope = format!(r#"{{"version":{ACTION_VERSION},"action":{body}}}"#);
    Action::parse(&envelope).unwrap_or_else(|error| panic!("{envelope} should parse: {error}"))
}

/// A Player a test drives by hand: nothing plays unless a test says so, and
/// every telling is remembered.
fn player() -> Arc<FixturePlayer> {
    Arc::new(FixturePlayer::new())
}

/// The in-memory stand-in for the OS keyring, with the hooks tests read it by.
fn secrets() -> Arc<InMemorySecretStore> {
    Arc::new(InMemorySecretStore::backed_by(SecretBackend::Keyring))
}

fn host_over(secrets: Arc<InMemorySecretStore>) -> Host {
    let fetcher = Arc::new(
        FixtureFetcher::new()
            .serving(STREMBOXD, STREMBOXD_MANIFEST)
            .serving(MANIFEST_URL_COULD_HIDE_A_KEY, STREMBOXD_MANIFEST),
    );
    let provider = Arc::new(AddonProvider::new(fetcher.clone()));
    Host::new(
        Arc::new(InMemoryStore::new()) as Arc<dyn Store>,
        fetcher,
        secrets,
        provider,
        player(),
    )
    .expect("a Host over a store starts")
}

/// A snapshot that knows the Addon it carries has a URL that could carry a
/// credential in it: the tests that walk the wire want everything in it.
fn host_with_addons_and_a_key(secrets: Arc<InMemorySecretStore>) -> Host {
    let mut host = host_over(secrets.clone());
    host.dispatch(action(
        &serde_json::json!({ "type": "add_addon", "url": MANIFEST_URL_COULD_HIDE_A_KEY }),
    ))
    .expect("configuring the recorded Addon should work");
    host.dispatch(action(
        &serde_json::json!({ "type": "set_subtitle_language", "language": "pt-BR" }),
    ))
    .expect("setting the preference should work");
    host.dispatch(action(
        &serde_json::json!({ "type": "set_tmdb_key", "key": "SECRET-KEY-VALUE" }),
    ))
    .expect("entering the key should work");
    host
}

#[test]
fn entering_a_key_stores_it_through_the_secret_store_and_says_so() {
    let secrets = secrets();
    let mut host = host_over(secrets.clone());

    let published = host
        .dispatch(action(
            &serde_json::json!({ "type": "set_tmdb_key", "key": "0123456789abcdef" }),
        ))
        .expect("entering a TMDB key should work")
        .snapshots;

    assert!(
        secrets.holds(CredentialKind::TmdbKey),
        "the credential left the Action surface on the only road out: the store"
    );
    let snapshot = published[0].clone();
    assert_eq!(
        snapshot.protection,
        host_core::ProtectionSnapshot {
            backend: SecretBackend::Keyring,
            tmdb_held: true,
        },
        "the Snapshot says a key is held, and where — never the key"
    );
}

#[test]
fn clearing_the_key_takes_it_out_the_same_way_it_went_in() {
    let secrets = secrets();
    let mut host = host_over(secrets.clone());
    host.dispatch(action(
        &serde_json::json!({ "type": "set_tmdb_key", "key": "0123456789abcdef" }),
    ))
    .expect("entering a TMDB key should work");

    let published = host
        .dispatch(action(&serde_json::json!({ "type": "clear_tmdb_key" })))
        .expect("clearing a TMDB key should work")
        .snapshots;

    assert!(
        !secrets.holds(CredentialKind::TmdbKey),
        "taken out is taken out: nothing of the credential stays in the store"
    );
    assert!(!published[0].protection.tmdb_held);
}

#[test]
fn clearing_a_key_that_was_never_there_is_not_an_error() {
    let secrets = secrets();
    let mut host = host_over(secrets.clone());
    let before = host.snapshot();

    let published = host
        .dispatch(action(&serde_json::json!({ "type": "clear_tmdb_key" })))
        .expect("clearing nothing should do nothing loudly")
        .snapshots;

    assert_eq!(
        published[0].protection.tmdb_held, before.protection.tmdb_held,
        "the end state of nothing held is nothing held"
    );
    assert!(!secrets.holds(CredentialKind::TmdbKey));
}

#[test]
fn a_key_shaped_unlike_any_credential_is_refused_before_the_store_hears_of_it() {
    let secrets = secrets();
    let mut host = host_over(secrets.clone());
    let before = host.snapshot();

    for key in ["", "   ", "the key", "with\nnewline"] {
        let refused = host
            .dispatch(action(
                &serde_json::json!({ "type": "set_tmdb_key", "key": key }),
            ))
            .expect_err("a key with a space in it is refused");

        assert!(
            matches!(refused, ActionError::InvalidTmdbKey(_)),
            "{key:?} is not a credential: {refused:?}"
        );
    }

    assert!(
        !secrets.holds(CredentialKind::TmdbKey),
        "a refused Action leaves the store the way state left it"
    );
    assert_eq!(host.snapshot(), before);
}

#[test]
fn a_secret_store_that_cannot_keep_leaves_the_state_alone() {
    let secrets = secrets();
    let mut host = host_over(secrets.clone());
    secrets.failing();

    let refused = host
        .dispatch(action(
            &serde_json::json!({ "type": "set_tmdb_key", "key": "0123456789abcdef" }),
        ))
        .expect_err("a store that refuses a credential is reported");

    assert!(
        matches!(refused, ActionError::Secret { .. }),
        "the secret store's own kind of failure: {refused:?}"
    );
    let published = host.snapshot();
    assert!(
        !published.protection.tmdb_held,
        "a credential the store did not take is a credential the Host does not claim"
    );
}

#[test]
fn a_credential_value_reaches_nothing_the_wire_can_carry() {
    // Every credential the tests speak is carried into this walk, fully populated:
    // Addons with a manifest URL that could hide a key inside it, a preference,
    // and a TMDB key. A Snapshot is built from it, and the whole host of them
    // serialized — and the serialized shape is searched for the key's own
    // value, and for the Addon's URL where a key could live, because both are
    // what pairing a device would open to.
    let secrets = secrets();
    let host = host_with_addons_and_a_key(secrets);

    let published = serde_json::to_value(host.snapshot()).expect("a Snapshot serializes");
    let text = published.to_string();

    assert!(
        !text.contains("SECRET-KEY-VALUE"),
        "the credential's own value has no place on the wire: {text}"
    );
    assert!(
        !text.contains(MANIFEST_URL_COULD_HIDE_A_KEY),
        "an Addon's manifest URL can carry a credential inside it (ADR-0009): {text}"
    );
    assert_eq!(
        published["protection"],
        serde_json::json!({ "backend": "keyring", "tmdbHeld": true }),
        "what the wire carries about credentials is which backend is holding them"
    );
}

#[test]
fn a_snapshot_of_a_host_with_no_key_says_what_it_has_rather_than_guessed() {
    let mut host = host_over(secrets());
    host.dispatch(action(
        &serde_json::json!({ "type": "add_addon", "url": MANIFEST_URL_COULD_HIDE_A_KEY }),
    ))
    .expect("configuring the recorded Addon should work");

    let published = host.snapshot();

    assert_eq!(
        published.protection,
        host_core::ProtectionSnapshot {
            backend: SecretBackend::Keyring,
            tmdb_held: false,
        },
        "no key has been entered, and the Snapshot says so rather than staying quiet"
    );
}

#[test]
fn the_store_answers_its_backend_when_the_host_loads_its_state() {
    // The fallback is real: where no keyring exists the store is the 0600 file,
    // and "which one am I using" is read off the store, not decided by the UI.
    // The Host at startup reads it once, as protection.
    let secrets = secrets();
    let mut host = host_over(secrets);
    let before = host.snapshot();

    host.dispatch(action(&serde_json::json!({ "type": "clear_tmdb_key" })))
        .expect("a clear is a change to what is held, not to where it lives");

    assert_eq!(
        host.snapshot().protection.backend,
        before.protection.backend,
        "the backend is what the store is made of, and a key going in or out does not change it"
    );
    assert_eq!(
        host.snapshot().protection.backend,
        SecretBackend::Keyring,
        "the in-memory stand-in presents as the keyring, the way the real one does"
    );
}
