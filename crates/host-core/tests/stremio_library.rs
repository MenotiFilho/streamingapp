//! Reading the Stremio account Library through the Host's own Action surface
//! (#165, ADR-0029). The account is `FixtureStremio`; nothing here reaches a
//! network.

use std::sync::Arc;

use host_core::{
    Action, ActionError, Answer, FixtureClock, FixtureFetcher, FixturePlayer, FixtureProvider,
    FixtureStremio, Host, InMemorySecretStore, InMemoryStore, Library, SecretBackend, Store,
    ACTION_VERSION,
};
use serde_json::{json, Value};

const AUTH_KEY: &str = "AUTHKEY";

fn action(body: &Value) -> Action {
    let envelope = format!(r#"{{"version":{ACTION_VERSION},"action":{body}}}"#);
    Action::parse(&envelope).unwrap_or_else(|error| panic!("{envelope}: {error}"))
}

fn account() -> FixtureStremio {
    FixtureStremio::new().with_account("me@example.org", "hunter2", AUTH_KEY)
}

fn host_with(stremio: Arc<FixtureStremio>) -> Host {
    Host::new(
        Arc::new(InMemoryStore::new()) as Arc<dyn Store>,
        Arc::new(FixtureFetcher::new()),
        Arc::new(InMemorySecretStore::backed_by(SecretBackend::Keyring)),
        Arc::new(FixtureProvider::new()),
        Arc::new(FixturePlayer::new()),
        Arc::new(FixtureClock::new().at(1_700_000_000_000)),
    )
    .expect("a Host starts")
    .with_stremio(stremio)
}

fn sign_in(host: &mut Host) {
    host.dispatch(action(&json!({
        "type": "sign_in_stremio",
        "email": "me@example.org",
        "password": "hunter2"
    })))
    .expect("signing in");
}

fn read(host: &mut Host) -> Library {
    match host
        .dispatch(Action::Library)
        .expect("the Library question")
        .answer
    {
        Some(Answer::Library(library)) => library,
        other => panic!("expected a Library answer, got {other:?}"),
    }
}

fn item(id: &str, name: &str, mtime: &str, removed: bool, offset_ms: i64) -> Value {
    json!({
        "_id": id,
        "name": name,
        "type": "movie",
        "poster": format!("https://images.example.org/{id}.jpg"),
        "posterShape": "poster",
        "removed": removed,
        "temp": false,
        "_mtime": mtime,
        "state": {
            "timeOffset": offset_ms,
            "duration": 3_600_000,
            "lastWatched": "2030-01-01T00:00:00.000Z"
        }
    })
}

fn series(id: &str, name: &str, mtime: &str, removed: bool, offset_ms: i64) -> Value {
    json!({
        "_id": id,
        "name": name,
        "type": "series",
        "poster": format!("https://images.example.org/{id}.jpg"),
        "posterShape": "poster",
        "removed": removed,
        "temp": false,
        "_mtime": mtime,
        "state": {
            "video_id": format!("{id}:5:14"),
            "timeOffset": offset_ms,
            "duration": 2_820_000,
            "lastWatched": "2030-01-01T00:00:00.000Z",
            "watched": format!("{id}:5:14:62:AAAA")
        }
    })
}

#[test]
fn the_room_reads_the_index_and_draws_live_items_by_mtime() {
    let stremio = Arc::new(account().holding(vec![
        item("old", "Old", "2020-01-01T00:00:00.000Z", false, 0),
        series("new", "New", "2020-01-03T00:00:00.000Z", false, 612_000),
        item("gone", "Gone", "2020-01-02T00:00:00.000Z", true, 0),
    ]));
    let mut host = host_with(stremio);
    sign_in(&mut host);

    let library = read(&mut host);
    assert!(library.failure.is_none());
    let ids: Vec<&str> = library
        .entries
        .iter()
        .map(|entry| entry.id.as_str())
        .collect();
    assert_eq!(
        ids,
        vec!["new", "old"],
        "the room is ordered by _mtime, not lastWatched"
    );

    let new = &library.entries[0];
    assert_eq!(new.name, "New");
    assert_eq!(new.r#type, "series");
    assert_eq!(
        new.poster.as_deref(),
        Some("https://images.example.org/new.jpg")
    );
    assert_eq!(new.video_id.as_deref(), Some("new:5:14"));
    assert!(new.continue_watching);
    assert_eq!(new.position, Some(612.0));
    assert_eq!(new.duration, Some(2820.0));

    let old = &library.entries[1];
    assert_eq!(old.name, "Old");
    assert!(!old.continue_watching);
    assert_eq!(old.position, None);

    assert!(
        library.entries.iter().all(|entry| entry.id != "gone"),
        "a removed tombstone is not a room row"
    );
    assert!(
        host.snapshot().protection.stremio_held,
        "the account fact is still in the Snapshot"
    );
    let snapshot = serde_json::to_value(host.snapshot()).expect("a Snapshot serializes");
    assert!(
        snapshot.get("library").is_none() && snapshot.get("entries").is_none(),
        "no library rows travel in a Snapshot"
    );
}

#[test]
fn a_warm_read_asks_the_index_only_and_a_changed_item_is_the_only_document_fetched() {
    let first = item("first", "First", "2020-01-01T00:00:00.000Z", false, 0);
    let second = item("second", "Second", "2020-01-02T00:00:00.000Z", false, 0);
    let stremio = Arc::new(account().holding(vec![first.clone(), second]));
    let mut host = host_with(stremio.clone());
    sign_in(&mut host);

    let _ = read(&mut host);
    let cold = stremio.library_ids().len();
    assert_eq!(
        cold, 2,
        "the sign-in pull and the cold Library read each fetched documents"
    );
    let _ = read(&mut host);
    assert_eq!(
        stremio.library_ids().len(),
        cold,
        "an unchanged index fetches no document"
    );
    assert_eq!(
        stremio.calls().last().map(String::as_str),
        Some("library_meta"),
        "a warm read is the index alone"
    );

    let moved = item("second", "Second", "2020-01-03T00:00:00.000Z", false, 0);
    stremio.replace_library(vec![first, moved]);
    let library = read(&mut host);
    assert_eq!(
        stremio.library_ids().last(),
        Some(&Some(vec!["second".to_owned()])),
        "only the changed id is fetched"
    );
    assert_eq!(
        library.entries[0].id, "second",
        "the changed item is the newest row"
    );
}

#[test]
fn an_expired_session_is_a_failure_not_an_empty_library() {
    let stremio = Arc::new(account().holding(vec![item(
        "one",
        "One",
        "2020-01-01T00:00:00.000Z",
        false,
        0,
    )]));
    let mut host = host_with(stremio.clone());
    sign_in(&mut host);
    stremio.expiring_session();

    let library = read(&mut host);
    let failure = library.failure.expect("an expired session is a failure");
    assert!(matches!(failure, ActionError::Library { .. }));
    assert!(
        failure.to_string().contains("Session does not exist"),
        "the account's own refusal is what the room reads: {failure}"
    );
}

#[test]
fn a_host_without_sync_refuses_the_library_question() {
    let mut host = Host::new(
        Arc::new(InMemoryStore::new()),
        Arc::new(FixtureFetcher::new()),
        Arc::new(InMemorySecretStore::new()),
        Arc::new(FixtureProvider::new()),
        Arc::new(FixturePlayer::new()),
        Arc::new(FixtureClock::new()),
    )
    .expect("a Host starts");

    assert_eq!(
        host.dispatch(Action::Library).expect_err("no seam"),
        ActionError::SyncUnavailable
    );
}
