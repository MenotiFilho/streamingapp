//! The SQLite store, as the Host uses it: preferences in, preferences out.

use std::path::{Path, PathBuf};

use host_core::{Preferences, Store, StoreError, SubtitleLanguage};
use host_sqlite::SqliteStore;
use rusqlite::Connection;

fn language(tag: &str) -> SubtitleLanguage {
    SubtitleLanguage::parse(tag).unwrap_or_else(|error| panic!("{tag} is a language tag: {error}"))
}

fn store() -> SqliteStore {
    SqliteStore::open_in_memory().expect("an in-memory store opens")
}

/// A store on a file, for the tests that need to get at the database behind it.
fn store_on_disk() -> (tempfile::TempDir, PathBuf) {
    let directory = tempfile::tempdir().expect("a temporary directory is available");
    let path = directory.path().join("host.sqlite3");
    (directory, path)
}

fn stored_rows(path: &Path, key: &str) -> i64 {
    Connection::open(path)
        .expect("the database opens")
        .query_row(
            "SELECT count(*) FROM preferences WHERE key = ?1",
            [key],
            |row| row.get(0),
        )
        .expect("the row count works")
}

#[test]
fn a_preference_that_was_never_written_reads_back_as_no_preference() {
    let store = store();

    assert_eq!(store.read_preferences(), Ok(Preferences::new()));
}

#[test]
fn a_subtitle_language_round_trips() {
    let store = store();
    let written = Preferences::with_subtitle_language(Some(language("pt-BR")));

    store
        .write_preferences(&written)
        .expect("the store takes a preference");

    assert_eq!(store.read_preferences(), Ok(written));
}

#[test]
fn writing_a_preference_again_replaces_the_one_before_it() {
    let store = store();

    store
        .write_preferences(&Preferences::with_subtitle_language(Some(language(
            "pt-BR",
        ))))
        .expect("the store takes a preference");
    store
        .write_preferences(&Preferences::with_subtitle_language(Some(language("en"))))
        .expect("the store takes a replacement");
    let replaced = store.read_preferences().expect("preferences read back");
    assert_eq!(
        replaced.subtitle_language().map(SubtitleLanguage::as_str),
        Some("en")
    );

    store
        .write_preferences(&Preferences::new())
        .expect("the store takes a cleared preference");
    assert_eq!(
        store
            .read_preferences()
            .expect("preferences read back")
            .subtitle_language(),
        None,
        "clearing the preference leaves nothing behind"
    );
}

#[test]
fn clearing_the_subtitle_language_removes_the_row_rather_than_blanking_it() {
    let (_directory, path) = store_on_disk();
    let store = SqliteStore::open(&path).expect("the store opens");
    store
        .write_preferences(&Preferences::with_subtitle_language(Some(language(
            "pt-BR",
        ))))
        .expect("the store takes a preference");

    store
        .write_preferences(&Preferences::new())
        .expect("the store takes a cleared preference");

    assert_eq!(stored_rows(&path, "subtitle_language"), 0);
}

#[test]
fn a_preference_a_newer_host_wrote_is_left_where_it_is() {
    let (_directory, path) = store_on_disk();
    let store = SqliteStore::open(&path).expect("the store opens");
    Connection::open(&path)
        .expect("the database opens behind the store")
        .execute(
            "INSERT INTO preferences (key, value) VALUES ('playback_speed', '1.25')",
            [],
        )
        .expect("a preference this Host does not know about lands in the table");

    store
        .write_preferences(&Preferences::with_subtitle_language(Some(language(
            "pt-BR",
        ))))
        .expect("the store takes a preference");

    assert_eq!(
        stored_rows(&path, "playback_speed"),
        1,
        "it was not dropped"
    );
    assert_eq!(stored_rows(&path, "subtitle_language"), 1);
}

#[test]
fn a_stored_subtitle_language_that_is_not_a_tag_is_reported_and_not_a_panic() {
    let (_directory, path) = store_on_disk();
    SqliteStore::open(&path)
        .expect("the store opens")
        .write_preferences(&Preferences::with_subtitle_language(Some(language(
            "pt-BR",
        ))))
        .expect("the store takes a preference");
    Connection::open(&path)
        .expect("the database opens")
        .execute("UPDATE preferences SET value = 'pt BR'", [])
        .expect("the stored value is made unusable");

    let read = SqliteStore::open(&path)
        .expect("the store opens")
        .read_preferences();

    assert!(
        matches!(read, Err(StoreError::Read { .. })),
        "an unusable stored value is a read failure, not a crash: {read:?}"
    );
}

#[test]
fn a_database_that_cannot_be_opened_is_a_store_error() {
    let (_directory, path) = store_on_disk();
    std::fs::create_dir(&path).expect("a directory stands where the database should be");

    let open = SqliteStore::open(&path);

    assert!(
        matches!(open, Err(StoreError::Prepare { .. })),
        "a database that will not open is reported, not panicked on"
    );
}
