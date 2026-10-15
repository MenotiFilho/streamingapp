//! The schema, and the only code that changes it.
//!
//! Migrations are forward-only steps, each one a version and the SQL that takes
//! the database to it. A database records how far it has come in `PRAGMA
//! user_version`, so opening an existing database applies exactly what it is
//! missing and nothing twice.

use host_core::StoreError;
use rusqlite::Connection;

/// One forward step of the schema.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Migration {
    /// Strictly increasing across the list; lands in `PRAGMA user_version` once applied.
    pub version: u32,
    pub sql: &'static str,
}

/// Every step the Host's schema has taken.
pub const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        sql: "CREATE TABLE preferences (
                 key   TEXT PRIMARY KEY NOT NULL,
                 value TEXT NOT NULL
             );",
    },
    Migration {
        // An Addon is an id, where its manifest lives, and the manifest itself,
        // in the order they were configured. The manifest URL is a column of its
        // own because it is the Addon's address; the manifest is a document,
        // because nothing here queries inside one (ADR-0009).
        version: 2,
        sql: "CREATE TABLE addons (
                 id       TEXT PRIMARY KEY NOT NULL,
                 position INTEGER NOT NULL,
                 url      TEXT NOT NULL,
                 manifest TEXT NOT NULL
             );",
    },
];

/// The version a database is at once every migration in `migrations` has run.
pub fn latest_version(migrations: &[Migration]) -> u32 {
    migrations
        .iter()
        .map(|migration| migration.version)
        .max()
        .unwrap_or(0)
}

/// The version a database is at now.
pub fn schema_version(connection: &Connection) -> Result<u32, StoreError> {
    let version: i64 = connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(StoreError::read)?;
    Ok(u32::try_from(version).unwrap_or(0))
}

/// Bring the database up to the newest version in `migrations`, applying only the
/// steps it has not taken — each in its own transaction, so a failed migration
/// leaves the version where it was rather than half-applied.
pub fn migrate(connection: &mut Connection, migrations: &[Migration]) -> Result<u32, StoreError> {
    let mut version = schema_version(connection)?;
    let mut previous = 0;

    for migration in migrations {
        if migration.version <= previous {
            return Err(StoreError::Prepare {
                detail: format!(
                    "migration {} is not newer than the migration before it ({})",
                    migration.version, previous
                ),
            });
        }
        previous = migration.version;

        if migration.version <= version {
            continue;
        }

        let transaction = connection.transaction().map_err(StoreError::prepare)?;
        transaction
            .execute_batch(migration.sql)
            .map_err(StoreError::prepare)?;
        transaction
            .pragma_update(None, "user_version", migration.version)
            .map_err(StoreError::prepare)?;
        transaction.commit().map_err(StoreError::prepare)?;
        version = migration.version;
    }

    Ok(version)
}
