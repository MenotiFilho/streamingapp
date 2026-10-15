//! A preference outlives the process that set it — the promise the store makes to
//! the Host, and the one the Host makes to its owner.

use std::path::Path;
use std::sync::Arc;

use host_core::{Action, Host, Snapshot, SubtitleLanguage};
use host_sqlite::SqliteStore;

fn preference(snapshot: &Snapshot) -> Option<&str> {
    snapshot
        .preferences
        .subtitle_language
        .as_ref()
        .map(SubtitleLanguage::as_str)
}

fn subtitle_language(action: &str) -> Action {
    Action::parse(&format!(r#"{{"version":1,"action":{action}}}"#))
        .unwrap_or_else(|error| panic!("{action} should parse: {error}"))
}

/// Start a Host on this database, as launching the app does.
fn start(path: &Path) -> Host {
    let store = SqliteStore::open(path).expect("the database opens");
    Host::new(Arc::new(store)).expect("the Host starts")
}

fn take(host: &mut Host, action: &str) {
    host.dispatch(subtitle_language(action))
        .unwrap_or_else(|error| panic!("{action} should be taken: {error}"));
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
