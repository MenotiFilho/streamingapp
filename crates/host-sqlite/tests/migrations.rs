//! The migration machinery, exercised with a schema of its own — the Host's own
//! list is an upgrade path, and an upgrade path is only believable if it is walked.

use host_sqlite::{latest_version, migrate, schema_version, Migration, MIGRATIONS};
use rusqlite::Connection;

const TEST_MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        sql: "CREATE TABLE notes (
                  id   INTEGER PRIMARY KEY NOT NULL,
                  body TEXT NOT NULL
              );",
    },
    Migration {
        version: 2,
        sql: "ALTER TABLE notes ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;",
    },
];

fn connection() -> Connection {
    Connection::open_in_memory().expect("an in-memory database opens")
}

#[test]
fn a_new_database_is_brought_to_the_newest_schema() {
    let mut connection = connection();

    let version = migrate(&mut connection, MIGRATIONS).expect("a fresh database migrates");

    assert_eq!(version, latest_version(MIGRATIONS));
    assert_eq!(schema_version(&connection), Ok(version));
}

#[test]
fn an_older_schema_is_upgraded_and_keeps_its_rows() {
    let mut connection = connection();
    migrate(&mut connection, &TEST_MIGRATIONS[..1]).expect("the old schema applies");
    connection
        .execute("INSERT INTO notes (id, body) VALUES (1, 'kept')", [])
        .expect("the old schema takes a row");
    assert_eq!(schema_version(&connection), Ok(1));

    let version = migrate(&mut connection, TEST_MIGRATIONS).expect("the older database upgrades");

    assert_eq!(version, 2);
    assert_eq!(schema_version(&connection), Ok(2));
    let (body, pinned): (String, i64) = connection
        .query_row("SELECT body, pinned FROM notes WHERE id = 1", [], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .expect("the row written before the upgrade is still there");
    assert_eq!(body, "kept");
    assert_eq!(pinned, 0, "the new column takes its default");
}

#[test]
fn a_database_already_at_the_newest_schema_is_left_alone() {
    let mut connection = connection();
    migrate(&mut connection, TEST_MIGRATIONS).expect("the schema applies");
    connection
        .execute("INSERT INTO notes (id, body) VALUES (1, 'kept')", [])
        .expect("the schema takes a row");

    let version = migrate(&mut connection, TEST_MIGRATIONS).expect("migrating again is a no-op");

    assert_eq!(version, 2);
    let rows: i64 = connection
        .query_row("SELECT count(*) FROM notes", [], |row| row.get(0))
        .expect("counting the rows works");
    assert_eq!(rows, 1, "nothing was re-applied");
}

#[test]
fn a_migration_list_that_has_gone_backwards_is_refused() {
    let mut connection = connection();
    let out_of_order = &[TEST_MIGRATIONS[1], TEST_MIGRATIONS[0]];

    let refused = migrate(&mut connection, out_of_order);

    assert!(
        matches!(refused, Err(host_core::StoreError::Prepare { .. })),
        "a list that is not strictly increasing is not a migration list: {refused:?}"
    );
}

#[test]
fn a_migration_that_fails_leaves_the_database_where_it_was() {
    let mut connection = connection();
    let broken = &[
        TEST_MIGRATIONS[0],
        Migration {
            version: 2,
            sql: "ALTER TABLE notes ADD COLUMN this is not sql;",
        },
    ];

    let refused = migrate(&mut connection, broken);

    assert!(refused.is_err());
    assert_eq!(
        schema_version(&connection),
        Ok(1),
        "a migration that failed did not claim to have happened"
    );
}

#[test]
fn a_database_at_the_first_schema_upgrades_without_losing_what_it_held() {
    let mut connection = connection();
    migrate(&mut connection, &MIGRATIONS[..1]).expect("the first schema applies");
    connection
        .execute(
            "INSERT INTO preferences (key, value) VALUES ('subtitle_language', 'pt-BR')",
            [],
        )
        .expect("the first schema takes a preference");
    assert_eq!(schema_version(&connection), Ok(1));

    let version = migrate(&mut connection, MIGRATIONS).expect("the database upgrades");

    assert_eq!(version, latest_version(MIGRATIONS));
    let kept: String = connection
        .query_row(
            "SELECT value FROM preferences WHERE key = 'subtitle_languages'",
            [],
            |row| row.get(0),
        )
        .expect("the preference written before the upgrade is still there, as a list");
    assert_eq!(kept, r#"["pt-BR"]"#);
    let addons: i64 = connection
        .query_row("SELECT count(*) FROM addons", [], |row| row.get(0))
        .expect("the table the upgrade added is there");
    assert_eq!(addons, 0);
}

#[test]
fn a_database_at_the_sixth_schema_gains_the_title_cache_with_its_rows_intact() {
    // The Title cache is the seventh schema (ADR-0038). An owner who ran the
    // Host before this ticket keeps every Addon, preference and Watch progress
    // entry they had, and gains an empty cache rather than a broken one.
    let mut connection = connection();
    migrate(&mut connection, &MIGRATIONS[..6]).expect("the sixth schema applies");
    connection
        .execute(
            "INSERT INTO watch_progress
                 (video_id, video_type, title_addon, title_id, title_type, title_name,
                  title_poster, title_background, position, duration, watched, updated_at)
             VALUES ('tt0903747:1:2', 'series', 'com.linvo.cinemeta', 'tt0903747', 'series',
                     'Breaking Bad', NULL, NULL, 402.0, 2820.0, 0, 1000)",
            [],
        )
        .expect("the sixth schema takes a progress entry");
    assert_eq!(schema_version(&connection), Ok(6));

    let version = migrate(&mut connection, MIGRATIONS).expect("the database upgrades");

    assert_eq!(version, latest_version(MIGRATIONS));
    let kept: String = connection
        .query_row("SELECT video_id FROM watch_progress", [], |row| row.get(0))
        .expect("the entry written before the upgrade is still there");
    assert_eq!(kept, "tt0903747:1:2");
    let titles: i64 = connection
        .query_row("SELECT count(*) FROM titles", [], |row| row.get(0))
        .expect("the table the upgrade added is there");
    assert_eq!(titles, 0, "an upgraded Host starts with an empty cache");
}

#[test]
fn a_database_at_the_seventh_schema_gains_the_caught_up_hint_with_its_titles_intact() {
    // #277 adds the announced next episode to a kept Title. An owner who ran the
    // Host before it keeps every cached Title, and the hint is null for the rows
    // written before this step — a copy with no hint, not a broken one.
    let mut connection = connection();
    migrate(&mut connection, &MIGRATIONS[..7]).expect("the seventh schema applies");
    connection
        .execute(
            "INSERT INTO titles (key, title, source, status, read_at)
             VALUES (?1, ?2, 'both', 'running', 1000)",
            rusqlite::params![
                r#"{"kind":"tmdb","id":1396}"#,
                r#"{"addon":null,"id":"tmdb:1396","key":{"kind":"tmdb","id":1396},"type":"series","name":"Breaking Bad","poster":null,"background":null,"logo":null,"description":null,"releaseInfo":null,"runtime":null,"imdbRating":null,"genres":[],"videos":[]}"#
            ],
        )
        .expect("the seventh schema takes a Title");
    assert_eq!(schema_version(&connection), Ok(7));

    let version = migrate(&mut connection, MIGRATIONS).expect("the database upgrades");

    assert_eq!(version, latest_version(MIGRATIONS));
    let (name, next_season, next_episode): (String, Option<i64>, Option<i64>) = connection
        .query_row(
            "SELECT title, next_season, next_episode FROM titles",
            [],
            |row| {
                let title: String = row.get(0)?;
                let name: String = serde_json::from_str::<serde_json::Value>(&title)
                    .expect("the kept Title is a document")
                    .get("name")
                    .and_then(|name| name.as_str())
                    .expect("the kept Title has a name")
                    .to_owned();
                Ok((name, row.get(1)?, row.get(2)?))
            },
        )
        .expect("the Title written before the upgrade is still there");
    assert_eq!(name, "Breaking Bad");
    assert_eq!(
        (next_season, next_episode),
        (None, None),
        "a copy written before the hint existed has none"
    );
}

#[test]
fn a_database_at_the_eighth_schema_gains_the_stream_continuity_columns_with_its_rows_intact() {
    // The eighth schema is the caught-up hint (#277); the step after it adds the
    // Addon and `bingeGroup` a Video's Stream came from, which Playing its Up
    // next continues (#276). An owner who ran the Host before this keeps every
    // Watch progress entry, gaining two null columns.
    let mut connection = connection();
    migrate(&mut connection, &MIGRATIONS[..8]).expect("the eighth schema applies");
    connection
        .execute(
            "INSERT INTO watch_progress
                 (video_id, video_type, title_addon, title_id, title_type, title_name,
                  title_poster, title_background, position, duration, watched, updated_at)
             VALUES ('tt0903747:1:2', 'series', 'com.linvo.cinemeta', 'tt0903747', 'series',
                     'Breaking Bad', NULL, NULL, 402.0, 2820.0, 0, 1000)",
            [],
        )
        .expect("the eighth schema takes a progress entry");
    assert_eq!(schema_version(&connection), Ok(8));

    let version = migrate(&mut connection, MIGRATIONS).expect("the database upgrades");

    assert_eq!(version, latest_version(MIGRATIONS));
    let kept: (String, Option<String>, Option<String>) = connection
        .query_row(
            "SELECT video_id, stream_addon, binge_group FROM watch_progress",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .expect("the entry written before the upgrade is still there");
    assert_eq!(
        kept,
        ("tt0903747:1:2".to_owned(), None, None),
        "the columns are null for a row written before a Stream was recorded"
    );
}

#[test]
fn a_library_written_before_the_addon_became_optional_upgrades_with_its_rows_intact() {
    // The fifth schema is the one that lets a Watch progress entry name no
    // Addon, because a Discovered Title has none (ADR-0020). A row written
    // before that step keeps everything it had.
    let mut connection = connection();
    migrate(&mut connection, &MIGRATIONS[..4]).expect("the fourth schema applies");
    connection
        .execute(
            "INSERT INTO watch_progress
                 (video_id, video_type, title_addon, title_id, title_type, title_name,
                  title_poster, position, duration, watched, updated_at)
             VALUES ('tt0903747:1:2', 'series', 'com.linvo.cinemeta', 'tt0903747', 'series',
                     'Breaking Bad', NULL, 402.0, 2820.0, 0, 1000)",
            [],
        )
        .expect("the fourth schema takes a progress entry");
    assert_eq!(schema_version(&connection), Ok(4));

    let version = migrate(&mut connection, MIGRATIONS).expect("the database upgrades");

    assert_eq!(version, latest_version(MIGRATIONS));
    let kept: (String, String) = connection
        .query_row(
            "SELECT video_id, title_addon FROM watch_progress",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("the entry written before the upgrade is still there");
    assert_eq!(
        kept,
        ("tt0903747:1:2".to_owned(), "com.linvo.cinemeta".to_owned())
    );

    // And the rebuilt table takes the row this step exists for: one with no
    // Addon at all.
    connection
        .execute(
            "INSERT INTO watch_progress
                 (video_id, video_type, title_addon, title_id, title_type, title_name,
                  title_poster, position, duration, watched, updated_at)
             VALUES ('tmdb:1396:1:1', 'series', NULL, 'tmdb:1396', 'series',
                     'Breaking Bad', NULL, NULL, NULL, 0, 2000)",
            [],
        )
        .expect("the fifth schema takes an entry with no Addon");
}

#[test]
fn a_stored_subtitle_language_becomes_a_one_entry_list_and_the_old_key_is_dropped() {
    // The tenth schema (ADR-0041): the single subtitle language is the first
    // entry of the Subtitle languages. Nothing the owner set is lost.
    let mut connection = connection();
    migrate(&mut connection, &MIGRATIONS[..9]).expect("the ninth schema applies");
    connection
        .execute_batch(
            "INSERT INTO preferences (key, value) VALUES ('subtitle_language', 'pt-BR');
             INSERT INTO preferences (key, value) VALUES ('subtitle_color', '#FFFF00');",
        )
        .expect("the ninth schema takes preferences");
    assert_eq!(schema_version(&connection), Ok(9));

    let version = migrate(&mut connection, MIGRATIONS).expect("the database upgrades");

    assert_eq!(version, latest_version(MIGRATIONS));
    let rows = |key: &str| -> Vec<String> {
        connection
            .prepare("SELECT value FROM preferences WHERE key = ?1")
            .expect("a query")
            .query_map([key], |row| row.get(0))
            .expect("the rows read")
            .collect::<Result<_, _>>()
            .expect("every row is text")
    };
    assert_eq!(rows("subtitle_languages"), [r#"["pt-BR"]"#]);
    assert!(rows("subtitle_language").is_empty(), "the old key is gone");
    assert!(
        rows("audio_languages").is_empty(),
        "there was no audio language to carry"
    );
    assert_eq!(rows("subtitle_color"), ["#FFFF00"], "nothing else moved");
}

#[test]
fn a_database_with_no_subtitle_language_gains_no_language_rows() {
    let mut connection = connection();
    migrate(&mut connection, &MIGRATIONS[..9]).expect("the ninth schema applies");

    migrate(&mut connection, MIGRATIONS).expect("the database upgrades");

    let languages: i64 = connection
        .query_row(
            "SELECT count(*) FROM preferences WHERE key LIKE '%language%'",
            [],
            |row| row.get(0),
        )
        .expect("the table reads");
    assert_eq!(languages, 0, "no row reads as two empty lists");
}

#[test]
fn a_database_at_the_tenth_schema_gains_title_logo_with_its_rows_intact() {
    // ADR-0044 §7 adds `title_logo` to `watch_progress` so Continue watching
    // Wide cards and the Opening surface have the Title's wordmark offline.
    let mut connection = connection();
    migrate(&mut connection, &MIGRATIONS[..10]).expect("the tenth schema applies");
    connection
        .execute(
            "INSERT INTO watch_progress
                 (video_id, video_type, title_addon, title_id, title_type, title_name,
                  title_poster, title_background, position, duration, watched, updated_at,
                  stream_addon, binge_group)
             VALUES ('tt0903747:1:2', 'series', 'com.linvo.cinemeta', 'tt0903747', 'series',
                     'Breaking Bad', NULL, 'https://images.example.org/bb-backdrop.jpg',
                     402.0, 2820.0, 0, 1000, NULL, NULL)",
            [],
        )
        .expect("the tenth schema takes a progress entry");
    assert_eq!(schema_version(&connection), Ok(10));

    let version = migrate(&mut connection, MIGRATIONS).expect("the database upgrades");

    assert_eq!(version, latest_version(MIGRATIONS));
    let kept: (String, Option<String>) = connection
        .query_row(
            "SELECT video_id, title_logo FROM watch_progress",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("the entry written before the upgrade is still there");
    assert_eq!(
        kept,
        ("tt0903747:1:2".to_owned(), None),
        "title_logo is null for rows written before migration 11"
    );

    connection
        .execute(
            "INSERT INTO watch_progress
                 (video_id, video_type, title_addon, title_id, title_type, title_name,
                  title_poster, title_background, title_logo, position, duration, watched,
                  updated_at, stream_addon, binge_group)
             VALUES ('tt0133093', 'movie', 'com.linvo.cinemeta', 'tt0133093', 'movie',
                     'The Matrix', NULL, NULL, 'https://images.example.org/matrix-logo.png',
                     600.0, 8160.0, 0, 2000, NULL, NULL)",
            [],
        )
        .expect("migration 11 accepts a non-null title_logo");
    let logo: Option<String> = connection
        .query_row(
            "SELECT title_logo FROM watch_progress WHERE video_id = 'tt0133093'",
            [],
            |row| row.get(0),
        )
        .expect("the new row reads back");
    assert_eq!(
        logo.as_deref(),
        Some("https://images.example.org/matrix-logo.png")
    );
}

#[test]
fn a_database_at_the_eleventh_schema_upgrades_existing_addons_as_enabled() {
    // Migration 12 (ADR-0044 §2): every Addon configured before `enabled`
    // existed upgrades as enabled (`1`).
    let mut connection = connection();
    migrate(&mut connection, &MIGRATIONS[..11]).expect("the eleventh schema applies");
    connection
        .execute(
            "INSERT INTO addons (id, position, url, manifest)
             VALUES ('com.linvo.cinemeta', 0, 'https://v3-cinemeta.strem.io/manifest.json', '{}')",
            [],
        )
        .expect("the eleventh schema takes an Addon");
    assert_eq!(schema_version(&connection), Ok(11));

    let version = migrate(&mut connection, MIGRATIONS).expect("the database upgrades");

    assert_eq!(version, latest_version(MIGRATIONS));
    let (id, enabled): (String, i64) = connection
        .query_row("SELECT id, enabled FROM addons", [], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .expect("the Addon written before the upgrade is still there");
    assert_eq!(id, "com.linvo.cinemeta");
    assert_eq!(enabled, 1, "existing Addons upgrade as enabled");
}
