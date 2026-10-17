//! The Host's SQLite store.
//!
//! One database, in the platform data directory, holding everything the Host owns
//! that is not a credential. It implements [`host_core::Store`], so no SQL — and no
//! schema — is visible above this crate.

mod migrations;

use std::path::Path;
use std::sync::Mutex;

use host_core::{
    Addon, AddonId, Device, DeviceId, DeviceName, Manifest, ManifestUrl, Preferences, Store,
    StoreError, SubtitleLanguage, TitleCard, TitleStub, TokenDigest, VideoRef, WatchProgress,
};
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

    fn read_addons(&self) -> Result<Vec<Addon>, StoreError> {
        let connection = self.locked()?;
        let mut statement = connection
            .prepare("SELECT url, manifest FROM addons ORDER BY position")
            .map_err(StoreError::read)?;
        let rows = statement
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(StoreError::read)?;

        let mut addons = Vec::new();
        for row in rows {
            let (url, manifest) = row.map_err(StoreError::read)?;
            // Nothing stored here is named in the message: an Addon's manifest URL
            // can carry its credentials, and a read failure ends up in a log or in
            // an error a client sees.
            let url = ManifestUrl::parse(&url).map_err(|_| StoreError::Read {
                detail: "a stored Addon is at a URL that is not one".to_owned(),
            })?;
            // The manifest is the Host's own reading of what the Addon served, and
            // reading it back is judged exactly as parsing it was — the types say
            // so, rather than this function remembering to check.
            let manifest: Manifest =
                serde_json::from_str(&manifest).map_err(|error| StoreError::Read {
                    detail: format!("a stored Addon's manifest is unusable: {error}"),
                })?;
            addons.push(Addon::new(url, manifest));
        }

        Ok(addons)
    }

    fn write_addons(&self, addons: &[Addon]) -> Result<(), StoreError> {
        let mut connection = self.locked()?;
        let transaction = connection.transaction().map_err(StoreError::write)?;

        transaction
            .execute("DELETE FROM addons", [])
            .map_err(StoreError::write)?;
        for (position, addon) in addons.iter().enumerate() {
            let manifest = serde_json::to_string(addon.manifest()).map_err(StoreError::write)?;
            transaction
                .execute(
                    "INSERT INTO addons (id, position, url, manifest) VALUES (?1, ?2, ?3, ?4)",
                    params![
                        addon.id().as_str(),
                        i64::try_from(position).map_err(StoreError::write)?,
                        addon.manifest_url().as_str(),
                        manifest,
                    ],
                )
                .map_err(StoreError::write)?;
        }

        transaction.commit().map_err(StoreError::write)
    }

    fn read_watch_progress(&self) -> Result<Vec<WatchProgress>, StoreError> {
        let connection = self.locked()?;
        let mut statement = connection
            .prepare(
                "SELECT video_type, video_id, title_addon, title_id, title_type, title_name,
                        title_poster, title_background, position, duration, watched, updated_at
                 FROM watch_progress ORDER BY updated_at DESC",
            )
            .map_err(StoreError::read)?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, Option<String>>(7)?,
                    row.get::<_, Option<f64>>(8)?,
                    row.get::<_, Option<f64>>(9)?,
                    row.get::<_, i64>(10)?,
                    row.get::<_, i64>(11)?,
                ))
            })
            .map_err(StoreError::read)?;

        let mut watch = Vec::new();
        for row in rows {
            // Nothing here is named in the message: a Title's addon and id are
            // the owner's library, and a read failure ends up in a log or in an
            // error a client sees.
            let (
                video_type,
                video_id,
                title_addon,
                title_id,
                title_type,
                title_name,
                title_poster,
                title_background,
                position,
                duration,
                watched,
                updated_at,
            ) = row.map_err(StoreError::read)?;

            let video = VideoRef::parse(&video_type, &video_id).map_err(|_| StoreError::Read {
                detail: "a stored Watch progress entry names no Video".to_owned(),
            })?;
            let addon = AddonId::parse(&title_addon).map_err(|_| StoreError::Read {
                detail: "a stored Watch progress entry names no Addon".to_owned(),
            })?;
            // The Title is read back through the same judgement it was written
            // with, so a row that somehow drifted cannot reach a Snapshot.
            let title = TitleStub::parse(&TitleCard {
                addon,
                id: title_id,
                r#type: title_type,
                name: title_name,
                poster: title_poster,
                background: title_background,
            })
            .map_err(|_| StoreError::Read {
                detail: "a stored Watch progress entry names no Title".to_owned(),
            })?;

            watch.push(WatchProgress {
                video,
                title,
                position,
                duration,
                watched: watched != 0,
                updated_at,
            });
        }

        Ok(watch)
    }

    fn write_watch_progress(&self, progress: &WatchProgress) -> Result<(), StoreError> {
        let mut connection = self.locked()?;
        let transaction = connection.transaction().map_err(StoreError::write)?;

        transaction
            .execute(
                "INSERT INTO watch_progress
                     (video_id, video_type, title_addon, title_id, title_type, title_name,
                      title_poster, title_background, position, duration, watched, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
                 ON CONFLICT(video_id) DO UPDATE SET
                     video_type       = excluded.video_type,
                     title_addon      = excluded.title_addon,
                     title_id         = excluded.title_id,
                     title_type       = excluded.title_type,
                     title_name       = excluded.title_name,
                     title_poster     = excluded.title_poster,
                     title_background = excluded.title_background,
                     position         = excluded.position,
                     duration         = excluded.duration,
                     watched          = excluded.watched,
                     updated_at       = excluded.updated_at",
                params![
                    progress.video.id,
                    progress.video.r#type,
                    progress.title.addon().as_str(),
                    progress.title.id(),
                    progress.title.r#type(),
                    progress.title.name(),
                    progress.title.poster(),
                    progress.title.background(),
                    progress.position,
                    progress.duration,
                    i64::from(progress.watched),
                    progress.updated_at,
                ],
            )
            .map_err(StoreError::write)?;

        transaction.commit().map_err(StoreError::write)
    }

    fn read_devices(&self) -> Result<Vec<Device>, StoreError> {
        let connection = self.locked()?;
        // Read in `rowid` order, which is the order the devices paired: the list
        // a Snapshot carries, and nothing a query has to sort.
        let mut statement = connection
            .prepare("SELECT id, name, token_digest, paired_at FROM devices ORDER BY rowid")
            .map_err(StoreError::read)?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            })
            .map_err(StoreError::read)?;

        let mut devices = Vec::new();
        for row in rows {
            // Nothing here is named in the message: a device's name is the
            // owner's, and a read failure ends up in a log or in an error a
            // client sees.
            let (id, name, digest, paired_at) = row.map_err(StoreError::read)?;

            let id = DeviceId::parse(&id).map_err(|_| StoreError::Read {
                detail: "a stored device names no device id".to_owned(),
            })?;
            let name = DeviceName::parse(&name).map_err(|_| StoreError::Read {
                detail: "a stored device has a name this Host would not have taken".to_owned(),
            })?;
            // What is stored is the digest of a token, never the token: a row
            // that somehow drifted is not a device that can be matched, and is
            // reported rather than paired.
            let digest = TokenDigest::parse(&digest).map_err(|_| StoreError::Read {
                detail: "a stored device's token digest is unusable".to_owned(),
            })?;

            devices.push(Device::read(id, name, digest, paired_at));
        }

        Ok(devices)
    }

    fn write_device(&self, device: &Device) -> Result<(), StoreError> {
        let connection = self.locked()?;

        connection
            .execute(
                "INSERT INTO devices (id, name, token_digest, paired_at)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(id) DO UPDATE SET
                     name         = excluded.name,
                     token_digest = excluded.token_digest,
                     paired_at    = excluded.paired_at",
                params![
                    device.id().as_str(),
                    device.name().as_str(),
                    device.digest().as_str(),
                    device.paired_at(),
                ],
            )
            .map_err(StoreError::write)?;

        Ok(())
    }

    fn remove_device(&self, id: &DeviceId) -> Result<(), StoreError> {
        let connection = self.locked()?;

        connection
            .execute("DELETE FROM devices WHERE id = ?1", params![id.as_str()])
            .map_err(StoreError::write)?;

        Ok(())
    }
}
