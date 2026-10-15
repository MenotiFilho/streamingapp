//! The Host's behaviour, driven the way a client drives it: an Action in,
//! published Snapshots out. Nothing below the Action surface is named here.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use host_core::{
    Action, ActionError, Host, InMemoryStore, Preferences, Snapshot, Store, StoreError,
    SubtitleLanguage, ACTION_VERSION,
};

/// An Action as a client sends it: the versioned envelope, as JSON text.
fn action(body: &str) -> Action {
    let envelope = format!(r#"{{"version":{ACTION_VERSION},"action":{body}}}"#);
    Action::parse(&envelope).unwrap_or_else(|error| panic!("{envelope} should parse: {error}"))
}

fn action_in_a_foreign_version(version: u64, body: &str) -> String {
    format!(r#"{{"version":{version},"action":{body}}}"#)
}

fn host() -> Host {
    Host::new(Arc::new(InMemoryStore::new())).expect("a Host over an empty store starts")
}

fn subtitle_language(snapshot: &Snapshot) -> Option<&str> {
    snapshot
        .preferences
        .subtitle_language
        .as_ref()
        .map(SubtitleLanguage::as_str)
}

fn set_subtitle_language(host: &mut Host, language: &str) -> Vec<Snapshot> {
    host.dispatch(action(&format!(
        r#"{{"type":"set_subtitle_language","language":"{language}"}}"#
    )))
    .unwrap_or_else(|error| {
        panic!("setting the subtitle language to {language} should work: {error}")
    })
}

#[test]
fn a_fresh_host_has_no_subtitle_language() {
    let snapshot = host().snapshot();

    assert_eq!(snapshot.revision, 0);
    assert_eq!(subtitle_language(&snapshot), None);
}

#[test]
fn a_host_starts_from_the_preferences_its_store_holds() {
    let stored = Preferences::with_subtitle_language(Some(
        SubtitleLanguage::parse("pt-BR").expect("pt-BR is a language tag"),
    ));
    let store = Arc::new(InMemoryStore::holding(stored));
    let host = Host::new(store).expect("a Host over a holding store starts");

    assert_eq!(subtitle_language(&host.snapshot()), Some("pt-BR"));
}

#[test]
fn choosing_a_subtitle_language_publishes_a_snapshot_that_carries_it() {
    let mut host = host();

    let published = set_subtitle_language(&mut host, "pt-BR");

    assert_eq!(published.len(), 1, "one change publishes one Snapshot");
    assert_eq!(subtitle_language(&published[0]), Some("pt-BR"));
    assert_eq!(subtitle_language(&host.snapshot()), Some("pt-BR"));
}

#[test]
fn clearing_the_subtitle_language_publishes_a_snapshot_without_one() {
    let mut host = host();
    set_subtitle_language(&mut host, "pt-BR");

    let published = host
        .dispatch(action(r#"{"type":"clear_subtitle_language"}"#))
        .expect("clearing the subtitle language should work");

    assert_eq!(subtitle_language(&published[0]), None);
}

#[test]
fn changing_a_preference_twice_publishes_a_snapshot_each_time_and_moves_the_revision_on() {
    let mut host = host();

    let first = set_subtitle_language(&mut host, "pt-BR");
    let second = set_subtitle_language(&mut host, "en");

    assert_eq!(first[0].revision, 1);
    assert_eq!(second[0].revision, 2);
    assert_eq!(subtitle_language(&second[0]), Some("en"));
}

#[test]
fn an_unknown_action_is_rejected_and_leaves_the_state_exactly_as_it_was() {
    let mut host = host();
    set_subtitle_language(&mut host, "pt-BR");
    let before = host.snapshot();

    let rejected = Action::parse(&format!(
        r#"{{"version":{ACTION_VERSION},"action":{{"type":"offer_to_mow_the_lawn"}}}}"#
    ));

    assert!(matches!(rejected, Err(ActionError::Malformed { .. })));
    assert_eq!(host.snapshot(), before);
}

#[test]
fn an_action_from_a_version_the_host_does_not_speak_is_rejected_before_its_shape_is_judged() {
    let foreign =
        action_in_a_foreign_version(2, r#"{"type":"something_this_host_has_never_heard_of"}"#);

    let rejected = Action::parse(&foreign);

    assert_eq!(
        rejected,
        Err(ActionError::UnsupportedVersion {
            got: 2,
            supported: ACTION_VERSION,
        })
    );
}

#[test]
fn a_version_far_beyond_this_host_is_reported_as_it_was_sent() {
    let foreign = action_in_a_foreign_version(70_000, r#"{"type":"clear_subtitle_language"}"#);

    let rejected = Action::parse(&foreign);

    assert_eq!(
        rejected,
        Err(ActionError::UnsupportedVersion {
            got: 70_000,
            supported: ACTION_VERSION,
        })
    );
}

#[test]
fn a_version_that_is_not_a_version_is_rejected() {
    for not_a_version in [r#""1""#, "1.5", "-1", "null", "70000000000000000000000"] {
        let envelope = format!(
            r#"{{"version":{not_a_version},"action":{{"type":"clear_subtitle_language"}}}}"#
        );

        assert!(
            matches!(Action::parse(&envelope), Err(ActionError::Malformed { .. })),
            "a version of {not_a_version} is not a version"
        );
    }
}

#[test]
fn an_envelope_without_a_version_is_rejected() {
    let rejected = Action::parse(r#"{"action":{"type":"clear_subtitle_language"}}"#);

    assert!(matches!(rejected, Err(ActionError::Malformed { .. })));
}

#[test]
fn an_action_that_is_not_an_action_at_all_is_rejected() {
    for not_an_envelope in [
        r#"{"version":1}"#,
        r#"{"version":1,"action":"clear_subtitle_language"}"#,
        r#"{"version":1,"action":{"type":"set_subtitle_language"}}"#,
        r#""an action""#,
        r#"not json at all"#,
    ] {
        assert!(
            Action::parse(not_an_envelope).is_err(),
            "{not_an_envelope} is not an Action"
        );
    }
}

#[test]
fn a_subtitle_language_that_is_not_a_language_tag_is_rejected() {
    let mut host = host();
    let before = host.snapshot();

    let rejected = host.dispatch(action(
        r#"{"type":"set_subtitle_language","language":"Brazilian Portuguese"}"#,
    ));

    assert_eq!(
        rejected,
        Err(ActionError::InvalidSubtitleLanguage(
            host_core::InvalidSubtitleLanguage {
                language: "Brazilian Portuguese".to_owned(),
            }
        ))
    );
    assert_eq!(host.snapshot(), before, "a rejected Action changes nothing");
}

#[test]
fn the_host_writes_a_persisted_preference_through_the_store() {
    let store = Arc::new(InMemoryStore::new());
    let mut host = Host::new(store.clone()).expect("a Host over an empty store starts");

    set_subtitle_language(&mut host, "pt-BR");

    assert_eq!(
        store
            .persisted()
            .subtitle_language()
            .map(SubtitleLanguage::as_str),
        Some("pt-BR")
    );
}

#[test]
fn a_rejected_action_never_reaches_the_store() {
    let store = Arc::new(CountingStore::default());
    let mut host = Host::new(store.clone()).expect("a Host over a counting store starts");

    assert!(host
        .dispatch(action(
            r#"{"type":"set_subtitle_language","language":"not a tag"}"#
        ))
        .is_err());
    assert!(Action::parse(r#"{"version":1,"action":{"type":"nope"}}"#).is_err());

    assert_eq!(store.writes(), 0, "nothing was written");
}

#[test]
fn a_store_that_cannot_write_leaves_the_state_alone() {
    let store = Arc::new(InMemoryStore::new());
    let mut host = Host::new(store.clone()).expect("a Host over an empty store starts");
    set_subtitle_language(&mut host, "pt-BR");
    let before = host.snapshot();
    store.failing_writes();

    let refused = host.dispatch(action(
        r#"{"type":"set_subtitle_language","language":"en"}"#,
    ));

    assert!(
        matches!(refused, Err(ActionError::Store { .. })),
        "a store that refuses the write is reported as a store failure: {refused:?}"
    );
    assert_eq!(
        host.snapshot(),
        before,
        "state the store did not accept is not state the Host holds"
    );
}

#[test]
fn the_snapshot_declares_only_fields_it_can_safely_carry() {
    let mut host = host();
    set_subtitle_language(&mut host, "pt-BR");

    let published = serde_json::to_value(host.snapshot()).expect("a Snapshot serializes");

    assert_eq!(
        published,
        serde_json::json!({
            "revision": 1,
            "preferences": { "subtitleLanguage": "pt-BR" },
        }),
        "the wire shape is the declared one, camelCased for a JavaScript client"
    );
}

#[test]
fn no_field_a_snapshot_carries_could_hold_a_credential() {
    let mut host = host();
    set_subtitle_language(&mut host, "pt-BR");
    let published = serde_json::to_value(host.snapshot()).expect("a Snapshot serializes");
    let credentialish = ["key", "token", "secret", "password", "credential", "auth"];

    fn field_names(value: &serde_json::Value, into: &mut Vec<String>) {
        match value {
            serde_json::Value::Object(fields) => {
                for (name, field) in fields {
                    into.push(name.to_lowercase());
                    field_names(field, into);
                }
            }
            serde_json::Value::Array(items) => {
                for item in items {
                    field_names(item, into);
                }
            }
            _ => {}
        }
    }

    let mut names = Vec::new();
    field_names(&published, &mut names);

    for name in names {
        assert!(
            !credentialish.iter().any(|word| name.contains(word)),
            "a Snapshot field named {name:?} is where a credential would end up living"
        );
    }
}

/// A store that remembers how often it was written to.
#[derive(Default)]
struct CountingStore {
    inner: InMemoryStore,
    writes: AtomicUsize,
}

impl CountingStore {
    fn writes(&self) -> usize {
        self.writes.load(Ordering::SeqCst)
    }
}

impl Store for CountingStore {
    fn read_preferences(&self) -> Result<Preferences, StoreError> {
        self.inner.read_preferences()
    }

    fn write_preferences(&self, preferences: &Preferences) -> Result<(), StoreError> {
        self.writes.fetch_add(1, Ordering::SeqCst);
        self.inner.write_preferences(preferences)
    }
}
