//! The Host's SQLite store.
//!
//! One database, in the platform data directory, holding everything the Host owns
//! that is not a credential. It implements [`host_core::Store`], so no SQL — and no
//! schema — is visible above this crate.

mod migrations;

use std::path::Path;
use std::sync::Mutex;

use host_core::{Preferences, Store, StoreError, SubtitleLanguage};
use rusqlite::{params, Connection};

pub use migrations::{latest_version, migrate, schema_version, Migration, MIGRATIONS};

/// The key the subtitle language preference is stored under.
const SUBTITLE_LANGUAGE: &str = "subtitle_language";

/// The Host's database.
pub struct SqliteStore {
    connection: Mutex<Connection>,
}

impl SqliteStore {
    /// Open the Host's database, creating it and running any migration it is
    /// missing. The parent directory must exist; the app shell resolves it.
    pub fn open(path: impl AsRef<Path>) -> Result<Self, StoreError> {
        let connection = Connection::open(path).map_err(StoreError::prepare)?;
        Self::prepare(connection)
    }

    /// The same store, in memory: what the store's own tests run against.
    pub fn open_in_memory() -> Result<Self, StoreError> {
        let connection = Connection::open_in_memory().map_err(StoreError::prepare)?;
        Self::prepare(connection)
    }

    /// The version of the schema this database is at, for the Host to log at
    /// startup.
    pub fn schema_version(&self) -> Result<u32, StoreError> {
        let connection = self.locked()?;
        migrations::schema_version(&connection)
    }

    fn prepare(mut connection: Connection) -> Result<Self, StoreError> {
        connection
            .execute_batch(
                "PRAGMA journal_mode = WAL;
                 PRAGMA foreign_keys = ON;
                 PRAGMA busy_timeout = 5000;",
            )
            .map_err(StoreError::prepare)?;
        migrations::migrate(&mut connection, MIGRATIONS)?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    fn locked(&self) -> Result<std::sync::MutexGuard<'_, Connection>, StoreError> {
        self.connection.lock().map_err(|_| StoreError::Read {
            detail: "another thread panicked while holding the database".to_owned(),
        })
    }
}

impl Store for SqliteStore {
    fn read_preferences(&self) -> Result<Preferences, StoreError> {
        let connection = self.locked()?;
        let mut statement = connection
            .prepare("SELECT key, value FROM preferences")
            .map_err(StoreError::read)?;
        let rows = statement
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(StoreError::read)?;

        let mut subtitle_language = None;
        for row in rows {
            let (key, value) = row.map_err(StoreError::read)?;
            match key.as_str() {
                SUBTITLE_LANGUAGE => {
                    subtitle_language = Some(SubtitleLanguage::parse(&value).map_err(|error| {
                        StoreError::Read {
                            detail: format!("the stored subtitle language is unusable: {error}"),
                        }
                    })?);
                }
                // A preference written by a newer Host than this one: leaving it
                // alone keeps it for the Host that understands it.
                _ => continue,
            }
        }

        Ok(Preferences::with_subtitle_language(subtitle_language))
    }

    fn write_preferences(&self, preferences: &Preferences) -> Result<(), StoreError> {
        let mut connection = self.locked()?;
        let transaction = connection.transaction().map_err(StoreError::write)?;

        match preferences.subtitle_language() {
            Some(language) => {
                transaction
                    .execute(
                        "INSERT INTO preferences (key, value) VALUES (?1, ?2)
                         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                        params![SUBTITLE_LANGUAGE, language.as_str()],
                    )
                    .map_err(StoreError::write)?;
            }
            None => {
                transaction
                    .execute(
                        "DELETE FROM preferences WHERE key = ?1",
                        params![SUBTITLE_LANGUAGE],
                    )
                    .map_err(StoreError::write)?;
            }
        }

        transaction.commit().map_err(StoreError::write)
    }
}
