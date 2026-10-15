//! The migration machinery, exercised with a schema of its own — the Host's list
//! has one step today, and an upgrade needs two to be an upgrade at all.

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
