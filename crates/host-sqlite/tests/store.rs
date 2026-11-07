//! The SQLite store, as the Host uses it: preferences in, preferences out.

use std::path::{Path, PathBuf};

use host_core::{
    Addon, AddonId, CatalogRef, FeaturedCatalog, Manifest, ManifestUrl, Preferences, Store,
    StoreError, StreamBuffer, SubtitleColor, SubtitleLanguage, SubtitleScale, UpNextPlayback,
};
use host_sqlite::SqliteStore;
use rusqlite::Connection;

fn language(tag: &str) -> SubtitleLanguage {
    SubtitleLanguage::parse(tag).unwrap_or_else(|error| panic!("{tag} is a language tag: {error}"))
}

/// A Featured catalog as the Host would have written it.
fn featured(addon: &str, kind: &str, id: &str) -> FeaturedCatalog {
    FeaturedCatalog {
        addon: AddonId::parse(addon).expect("an Addon id"),
        catalog: CatalogRef::parse(kind, id).expect("a Catalog reference"),
    }
}

/// The preferences a store holding just this marking would hold.
fn featured_preferences(marking: FeaturedCatalog) -> Preferences {
    let mut preferences = Preferences::new();
    preferences.set_featured_catalog(Some(marking));
    preferences
}

/// An Addon as the Host would have parsed it, without needing a fixture file.
fn addon(id: &str, url: &str, version: &str, catalog: &str) -> Addon {
    let manifest = Manifest::parse(&format!(
        r#"{{
            "id": {id:?},
            "name": "Example {id}",
            "version": {version:?},
            "resources": ["catalog", {{ "name": "meta", "types": ["movie"], "idPrefixes": ["tt"] }}],
            "types": ["movie", "series"],
            "catalogs": [{{ "type": "movie", "id": {catalog:?}, "name": "Top" }}]
        }}"#
    ))
    .unwrap_or_else(|error| panic!("the fixture manifest should parse: {error}"));

    Addon::new(
        ManifestUrl::parse(url).unwrap_or_else(|error| panic!("{url} is a URL: {error}")),
        manifest,
    )
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
fn the_up_next_playback_preference_round_trips_and_defaults_to_direct() {
    // #276: direct until the owner chooses the picker, and a row of the
    // preferences table either way.
    let store = store();
    assert_eq!(
        store
            .read_preferences()
            .expect("the store reads back")
            .up_next_playback(),
        UpNextPlayback::Direct
    );

    let mut written = Preferences::new();
    written.set_up_next_playback(UpNextPlayback::Picker);
    store
        .write_preferences(&written)
        .expect("the store takes the preference");

    assert_eq!(
        store
            .read_preferences()
            .expect("the store reads back")
            .up_next_playback(),
        UpNextPlayback::Picker
    );
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
fn a_subtitle_appearance_round_trips() {
    let store = store();
    let mut written = Preferences::new();
    written.set_subtitle_color(SubtitleColor::parse("#ffff00").expect("a colour"));
    written.set_subtitle_scale(SubtitleScale::parse(1.25).expect("a size"));

    store
        .write_preferences(&written)
        .expect("the store takes the appearance");

    assert_eq!(store.read_preferences(), Ok(written));
}

#[test]
fn a_subtitle_appearance_that_was_never_written_reads_back_as_white_at_full_size() {
    let store = store();
    let read = store.read_preferences().expect("the store answers");

    assert_eq!(read.subtitle_color().as_str(), "#FFFFFF");
    assert_eq!(read.subtitle_scale().value(), 1.0);
}

#[test]
fn the_appearance_is_written_beside_the_language_in_one_preference_write() {
    let (_directory, path) = store_on_disk();
    let store = SqliteStore::open(&path).expect("the store opens");
    store
        .write_preferences(&Preferences::with_subtitle_language(Some(language(
            "pt-BR",
        ))))
        .expect("the store takes a preference");

    assert_eq!(stored_rows(&path, "subtitle_language"), 1);
    assert_eq!(
        stored_rows(&path, "subtitle_color"),
        1,
        "white is a value the Host holds, not an absent row"
    );
    assert_eq!(
        stored_rows(&path, "subtitle_scale"),
        1,
        "1.0 is a value the Host holds, not an absent row"
    );
}

#[test]
fn a_stored_subtitle_colour_that_is_not_a_colour_is_reported_and_not_a_panic() {
    let (_directory, path) = store_on_disk();
    let store = SqliteStore::open(&path).expect("the store opens");
    store
        .write_preferences(&Preferences::new())
        .expect("the store takes a preference");
    Connection::open(&path)
        .expect("the database opens")
        .execute(
            "UPDATE preferences SET value = 'red' WHERE key = 'subtitle_color'",
            [],
        )
        .expect("the stored colour is made unusable");

    let read = store.read_preferences();

    assert!(
        matches!(read, Err(StoreError::Read { .. })),
        "an unusable stored colour is a read failure, not a crash: {read:?}"
    );
}

#[test]
fn a_stored_subtitle_size_that_is_not_a_number_is_reported_and_not_a_panic() {
    for unusable in ["nonsense", "9", "NaN"] {
        let (_directory, path) = store_on_disk();
        let store = SqliteStore::open(&path).expect("the store opens");
        store
            .write_preferences(&Preferences::new())
            .expect("the store takes a preference");
        Connection::open(&path)
            .expect("the database opens")
            .execute(
                "UPDATE preferences SET value = ?1 WHERE key = 'subtitle_scale'",
                [unusable],
            )
            .expect("the stored size is made unusable");

        let read = store.read_preferences();

        assert!(
            matches!(read, Err(StoreError::Read { .. })),
            "a stored size of {unusable:?} is a read failure, not a crash: {read:?}"
        );
    }
}

#[test]
fn a_stream_buffer_round_trips() {
    let store = store();
    let mut written = Preferences::new();
    written.set_stream_buffer(StreamBuffer::parse(600, 1024).expect("a buffer"));

    store
        .write_preferences(&written)
        .expect("the store takes the buffer");

    assert_eq!(store.read_preferences(), Ok(written));
}

#[test]
fn a_stream_buffer_that_was_never_written_reads_back_as_the_default() {
    let store = store();
    let read = store.read_preferences().expect("the store answers");

    assert_eq!(read.stream_buffer().seconds(), 300);
    assert_eq!(read.stream_buffer().megabytes(), 512);
}

#[test]
fn the_buffer_is_written_beside_the_language_in_one_preference_write() {
    let (_directory, path) = store_on_disk();
    let store = SqliteStore::open(&path).expect("the store opens");
    store
        .write_preferences(&Preferences::with_subtitle_language(Some(language(
            "pt-BR",
        ))))
        .expect("the store takes a preference");

    assert_eq!(
        stored_rows(&path, "stream_buffer"),
        1,
        "the default pair is a value the Host holds, not an absent row"
    );
}

#[test]
fn a_stored_stream_buffer_that_is_out_of_range_is_reported_and_not_a_panic() {
    for unusable in [
        r#"{"seconds":0,"megabytes":512}"#,
        r#"{"seconds":300,"megabytes":4097}"#,
        r#"{"seconds":300}"#,
        "nonsense",
    ] {
        let (_directory, path) = store_on_disk();
        let store = SqliteStore::open(&path).expect("the store opens");
        store
            .write_preferences(&Preferences::new())
            .expect("the store takes a preference");
        Connection::open(&path)
            .expect("the database opens")
            .execute(
                "UPDATE preferences SET value = ?1 WHERE key = 'stream_buffer'",
                [unusable],
            )
            .expect("the stored buffer is made unusable");

        let read = store.read_preferences();

        assert!(
            matches!(read, Err(StoreError::Read { .. })),
            "a stored buffer of {unusable:?} is a read failure, not a crash: {read:?}"
        );
    }
}

#[test]
fn a_featured_catalog_round_trips() {
    let store = store();
    let written = featured_preferences(featured("org.example.first", "movie", "top"));

    store
        .write_preferences(&written)
        .expect("the store takes a preference");

    assert_eq!(store.read_preferences(), Ok(written));
}

#[test]
fn a_featured_catalog_round_trips_beside_the_subtitle_language() {
    let store = store();
    let mut written = Preferences::with_subtitle_language(Some(language("pt-BR")));
    written.set_featured_catalog(Some(featured("org.example.first", "movie", "top")));

    store
        .write_preferences(&written)
        .expect("the store takes both preferences");

    assert_eq!(store.read_preferences(), Ok(written));
}

#[test]
fn clearing_the_featured_catalog_removes_the_row_rather_than_blanking_it() {
    let (_directory, path) = store_on_disk();
    let store = SqliteStore::open(&path).expect("the store opens");
    store
        .write_preferences(&featured_preferences(featured(
            "org.example.first",
            "movie",
            "top",
        )))
        .expect("the store takes a preference");

    store
        .write_preferences(&Preferences::new())
        .expect("the store takes a cleared marking");

    assert_eq!(stored_rows(&path, "featured_catalog"), 0);
}

#[test]
fn a_stored_featured_catalog_that_is_not_a_document_is_reported_and_not_a_panic() {
    let (_directory, path) = store_on_disk();
    let store = SqliteStore::open(&path).expect("the store opens");
    store
        .write_preferences(&featured_preferences(featured(
            "org.example.first",
            "movie",
            "top",
        )))
        .expect("the store takes a preference");
    Connection::open(&path)
        .expect("the database opens")
        .execute(
            "UPDATE preferences SET value = 'not json at all' WHERE key = 'featured_catalog'",
            [],
        )
        .expect("the stored marking is made unusable");

    let read = store.read_preferences();

    assert!(
        matches!(read, Err(StoreError::Read { .. })),
        "an unusable stored marking is a read failure, not a crash: {read:?}"
    );
}

#[test]
fn a_stored_featured_catalog_naming_an_unusable_catalog_is_reported_and_not_a_panic() {
    let (_directory, path) = store_on_disk();
    let store = SqliteStore::open(&path).expect("the store opens");
    store
        .write_preferences(&featured_preferences(featured(
            "org.example.first",
            "movie",
            "top",
        )))
        .expect("the store takes a preference");
    Connection::open(&path)
        .expect("the database opens")
        .execute(
            "UPDATE preferences
             SET value = '{\"addon\":\"org.example.first\",\"catalog\":{\"type\":\"mov ie\",\"id\":\"top\"}}'
             WHERE key = 'featured_catalog'",
            [],
        )
        .expect("the stored Catalog is made unusable");

    let read = store.read_preferences();

    assert!(
        matches!(read, Err(StoreError::Read { .. })),
        "a Catalog the parser would refuse is refused however it arrives: {read:?}"
    );
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

#[test]
fn no_addons_configured_reads_back_as_none() {
    assert_eq!(store().read_addons(), Ok(Vec::new()));
}

#[test]
fn an_addon_round_trips_through_the_store() {
    let store = store();
    let written = vec![
        addon(
            "org.example.first",
            "https://first.example.com/manifest.json",
            "1.0.0",
            "top",
        ),
        addon(
            "org.example.second",
            "https://second.example.com/manifest.json",
            "2.0.0",
            "popular",
        ),
    ];

    store
        .write_addons(&written)
        .expect("the store takes Addons");

    assert_eq!(store.read_addons(), Ok(written));
}

#[test]
fn addons_come_back_in_the_order_they_were_configured() {
    let store = store();
    let first = addon(
        "org.example.first",
        "https://first.example.com/manifest.json",
        "1.0.0",
        "top",
    );
    let second = addon(
        "org.example.second",
        "https://second.example.com/manifest.json",
        "1.0.0",
        "top",
    );

    store
        .write_addons(&[first.clone(), second.clone()])
        .expect("the store takes Addons");
    store
        .write_addons(&[second.clone(), first.clone()])
        .expect("the store takes the order it is given");

    assert_eq!(store.read_addons(), Ok(vec![second, first]));
}

#[test]
fn writing_addons_again_replaces_the_ones_before_them() {
    let store = store();
    store
        .write_addons(&[addon(
            "org.example.first",
            "https://first.example.com/manifest.json",
            "1.0.0",
            "top",
        )])
        .expect("the store takes an Addon");

    store
        .write_addons(&[addon(
            "org.example.second",
            "https://second.example.com/manifest.json",
            "1.0.0",
            "popular",
        )])
        .expect("the store takes a replacement");

    let replaced = store.read_addons().expect("the Addons read back");
    assert_eq!(
        replaced
            .iter()
            .map(|addon| addon.id().as_str())
            .collect::<Vec<_>>(),
        vec!["org.example.second"],
        "the Addon that was not written again is not there any more"
    );
    store
        .write_addons(&[])
        .expect("the store takes an empty list");
    assert_eq!(store.read_addons(), Ok(Vec::new()));
}

#[test]
fn a_stored_manifest_that_is_unusable_is_reported_and_not_a_panic() {
    let (_directory, path) = store_on_disk();
    let store = SqliteStore::open(&path).expect("the store opens");
    store
        .write_addons(&[addon(
            "org.example.first",
            "https://first.example.com/manifest.json",
            "1.0.0",
            "top",
        )])
        .expect("the store takes an Addon");
    Connection::open(&path)
        .expect("the database opens")
        .execute("UPDATE addons SET manifest = 'not json at all'", [])
        .expect("the stored manifest is made unusable");

    let read = store.read_addons();

    let error = read.expect_err("an unusable stored manifest is a read failure, not a crash");
    assert!(
        matches!(error, StoreError::Read { .. }),
        "it is reported as a read failure: {error:?}"
    );
    assert!(
        !error.to_string().contains("first.example.com"),
        "an Addon's URL is not repeated into a message that may be logged: {error:?}"
    );
}

#[test]
fn a_stored_addon_url_that_is_not_a_url_is_reported_and_not_a_panic() {
    let (_directory, path) = store_on_disk();
    let store = SqliteStore::open(&path).expect("the store opens");
    store
        .write_addons(&[addon(
            "org.example.first",
            "https://first.example.com/manifest.json",
            "1.0.0",
            "top",
        )])
        .expect("the store takes an Addon");
    Connection::open(&path)
        .expect("the database opens")
        .execute("UPDATE addons SET url = 'not a url'", [])
        .expect("the stored URL is made unusable");

    let read = store.read_addons();

    assert!(
        matches!(read, Err(StoreError::Read { .. })),
        "an unusable stored URL is a read failure, not a crash: {read:?}"
    );
}

#[test]
fn a_stored_addon_id_that_is_not_an_id_is_reported_and_not_a_panic() {
    let (_directory, path) = store_on_disk();
    let store = SqliteStore::open(&path).expect("the store opens");
    store
        .write_addons(&[addon(
            "org.example.first",
            "https://first.example.com/manifest.json",
            "1.0.0",
            "top",
        )])
        .expect("the store takes an Addon");
    Connection::open(&path)
        .expect("the database opens")
        .execute(
            "UPDATE addons SET manifest = replace(manifest, 'org.example.first', 'not an id')",
            [],
        )
        .expect("the stored id is made unusable");

    let read = store.read_addons();

    assert!(
        matches!(read, Err(StoreError::Read { .. })),
        "an id the parser would refuse is refused however it arrives: {read:?}"
    );
}
