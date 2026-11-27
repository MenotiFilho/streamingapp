//! The Host's SQLite store.
//!
//! One database, in the platform data directory, holding everything the Host owns
//! that is not a credential. It implements [`host_core::Store`], so no SQL — and no
//! schema — is visible above this crate.

mod migrations;

use std::path::Path;
use std::sync::Mutex;

use host_core::{
    Addon, AddonId, CachedTitle, CatalogRef, Device, DeviceId, DeviceName, FeaturedCatalog,
    InvalidUpNextPlayback, LanguageList, Manifest, ManifestUrl, NextEpisode, Preferences,
    SeriesStatus, Store, StoreError, StreamBuffer, SubtitleColor, SubtitleScale, Title, TitleCard,
    TitleKey, TitleSource, TitleStub, TokenDigest, TorrentCache, UpNextPlayback, VideoRef,
    WatchProgress,
};
use rusqlite::{params, Connection, Transaction};

pub use migrations::{latest_version, migrate, schema_version, Migration, MIGRATIONS};

/// The key the Subtitle languages are stored under: a JSON array of tags.
const SUBTITLE_LANGUAGES: &str = "subtitle_languages";

/// The key the Audio languages are stored under: a JSON array of tags.
const AUDIO_LANGUAGES: &str = "audio_languages";

/// The key the subtitle colour preference is stored under.
const SUBTITLE_COLOR: &str = "subtitle_color";

/// The key the subtitle size preference is stored under.
const SUBTITLE_SCALE: &str = "subtitle_scale";

/// The key the Stream buffer preference is stored under.
const STREAM_BUFFER: &str = "stream_buffer";

/// The key the Torrent cache preference is stored under.
const TORRENT_CACHE: &str = "torrent_cache";

/// The key the Up next playback preference is stored under.
const UP_NEXT_PLAYBACK: &str = "up_next_playback";

/// The key the Autoplay preference is stored under.
const AUTOPLAY: &str = "autoplay";

/// The key the Featured catalog preference is stored under.
const FEATURED_CATALOG: &str = "featured_catalog";

/// Write one preference row, or drop it when the value is `None`: setting and
/// clearing are one decision, so the two preferences cannot drift apart.
fn put_preference(
    transaction: &Transaction<'_>,
    key: &str,
    value: Option<&str>,
) -> Result<(), StoreError> {
    let written = match value {
        Some(value) => transaction.execute(
            "INSERT INTO preferences (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        ),
        None => transaction.execute("DELETE FROM preferences WHERE key = ?1", params![key]),
    };

    written.map(|_| ()).map_err(StoreError::write)
}

/// A language list as its row holds it: a JSON array of tags, or no row at all
/// for an empty list, so that "follow the file" is the absence of a choice.
fn language_list_row(list: &LanguageList) -> Result<Option<String>, StoreError> {
    if list.is_empty() {
        return Ok(None);
    }

    serde_json::to_string(list)
        .map(Some)
        .map_err(StoreError::write)
}

/// A language list read back from its row, judged as it was written: a row that
/// drifted is a read failure, never a list no client chose.
fn read_language_list(value: &str, what: &str) -> Result<LanguageList, StoreError> {
    let unusable = |error: String| StoreError::Read {
        detail: format!("the stored {what} are unusable: {error}"),
    };
    let tags: Vec<String> =
        serde_json::from_str(value).map_err(|error| unusable(error.to_string()))?;

    LanguageList::parse(&tags).map_err(|error| unusable(format!("{error:?}")))
}

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

        let mut subtitle_languages = LanguageList::empty();
        let mut audio_languages = LanguageList::empty();
        let mut subtitle_color = SubtitleColor::default();
        let mut subtitle_scale = SubtitleScale::default();
        let mut stream_buffer = StreamBuffer::default();
        let mut torrent_cache = TorrentCache::default();
        let mut up_next_playback = UpNextPlayback::default();
        let mut autoplay = true;
        let mut featured_catalog = None;
        for row in rows {
            let (key, value) = row.map_err(StoreError::read)?;
            match key.as_str() {
                SUBTITLE_LANGUAGES => {
                    subtitle_languages = read_language_list(&value, "Subtitle languages")?;
                }
                AUDIO_LANGUAGES => {
                    audio_languages = read_language_list(&value, "Audio languages")?;
                }
                SUBTITLE_COLOR => {
                    subtitle_color =
                        SubtitleColor::parse(&value).map_err(|error| StoreError::Read {
                            detail: format!("the stored subtitle colour is unusable: {error}"),
                        })?;
                }
                SUBTITLE_SCALE => {
                    // A number read back as a number: a row that is not one, or
                    // one outside the range the Host sets, is a read failure
                    // rather than a size no client chose (#126, ADR-0024).
                    let scale = value.parse::<f64>().map_err(|error| StoreError::Read {
                        detail: format!("the stored subtitle size is unusable: {error}"),
                    })?;
                    subtitle_scale =
                        SubtitleScale::parse(scale).map_err(|error| StoreError::Read {
                            detail: format!("the stored subtitle size is unusable: {error}"),
                        })?;
                }
                FEATURED_CATALOG => {
                    // The document is read back, and the Catalog inside it is
                    // judged as it was written: a row that somehow drifted is a
                    // read failure and never a Catalog a Snapshot points Home at.
                    let unusable = |error: String| StoreError::Read {
                        detail: format!("the stored featured catalog is unusable: {error}"),
                    };
                    let featured: FeaturedCatalog = serde_json::from_str(&value)
                        .map_err(|error| unusable(error.to_string()))?;
                    CatalogRef::parse(&featured.catalog.r#type, &featured.catalog.id)
                        .map_err(|error| unusable(error.to_string()))?;
                    featured_catalog = Some(featured);
                }
                STREAM_BUFFER => {
                    // The pair is read back as one document and judged as it
                    // was written: a row that drifted is a read failure, never
                    // a buffer no client chose (ADR-0026).
                    let unusable = |error: String| StoreError::Read {
                        detail: format!("the stored stream buffer is unusable: {error}"),
                    };
                    let stored: StreamBuffer = serde_json::from_str(&value)
                        .map_err(|error| unusable(error.to_string()))?;
                    stream_buffer = StreamBuffer::parse(stored.seconds(), stored.megabytes())
                        .map_err(|error| unusable(error.to_string()))?;
                }
                TORRENT_CACHE => {
                    // One whole number of megabytes, judged as it was written:
                    // a row that drifted is a read failure, never a ceiling no
                    // client chose (ADR-0042 §3).
                    let unusable = |error: String| StoreError::Read {
                        detail: format!("the stored torrent cache is unusable: {error}"),
                    };
                    let megabytes: u64 = value
                        .parse()
                        .map_err(|error: std::num::ParseIntError| unusable(error.to_string()))?;
                    torrent_cache = TorrentCache::parse(megabytes)
                        .map_err(|error| unusable(error.to_string()))?;
                }
                UP_NEXT_PLAYBACK => {
                    // One word from a closed set, judged as it was written: a
                    // row that drifted is a read failure, never a choice no
                    // client offered (#276).
                    up_next_playback =
                        value
                            .parse()
                            .map_err(|error: InvalidUpNextPlayback| StoreError::Read {
                                detail: format!("the stored Up next playback is unusable: {error}"),
                            })?;
                }
                AUTOPLAY => {
                    autoplay = value.parse::<bool>().map_err(|error| StoreError::Read {
                        detail: format!("the stored Autoplay is unusable: {error}"),
                    })?;
                }
                // A preference written by a newer Host than this one: leaving it
                // alone keeps it for the Host that understands it.
                _ => continue,
            }
        }

        Ok(Preferences::from_stored(
            subtitle_languages,
            audio_languages,
            subtitle_color,
            subtitle_scale,
            stream_buffer,
            torrent_cache,
            up_next_playback,
            autoplay,
            featured_catalog,
        ))
    }

    fn write_preferences(&self, preferences: &Preferences) -> Result<(), StoreError> {
        let mut connection = self.locked()?;
        let transaction = connection.transaction().map_err(StoreError::write)?;

        put_preference(
            &transaction,
            SUBTITLE_LANGUAGES,
            language_list_row(preferences.subtitle_languages())?.as_deref(),
        )?;
        put_preference(
            &transaction,
            AUDIO_LANGUAGES,
            language_list_row(preferences.audio_languages())?.as_deref(),
        )?;
        // The appearance is always a value — white and 1.0 are answers, not the
        // absence of one — so both rows are written with every preference
        // write, in the same transaction (#126, ADR-0024).
        put_preference(
            &transaction,
            SUBTITLE_COLOR,
            Some(preferences.subtitle_color().as_str()),
        )?;
        let scale = preferences.subtitle_scale().value().to_string();
        put_preference(&transaction, SUBTITLE_SCALE, Some(&scale))?;
        // The buffer's two numbers are one preference and one row, for the same
        // reason the Featured catalog is one document: a pair written apart can
        // disagree, and a half-read pair is a buffer nobody chose (ADR-0026).
        let buffer =
            serde_json::to_string(&preferences.stream_buffer()).map_err(StoreError::write)?;
        put_preference(&transaction, STREAM_BUFFER, Some(&buffer))?;
        // The Torrent cache is one whole number of megabytes, written with every
        // preference write like the buffer beside it (ADR-0042 §3).
        let cache = preferences.torrent_cache().megabytes().to_string();
        put_preference(&transaction, TORRENT_CACHE, Some(&cache))?;
        // One word from a closed set, written with every preference write like
        // the appearance and the buffer (#276).
        put_preference(
            &transaction,
            UP_NEXT_PLAYBACK,
            Some(preferences.up_next_playback().as_str()),
        )?;
        let autoplay = if preferences.autoplay() {
            "true"
        } else {
            "false"
        };
        put_preference(&transaction, AUTOPLAY, Some(autoplay))?;
        // The whole pair as one document: an id is only half of what an Addon's
        // Catalog is, and two rows could disagree.
        let featured = match preferences.featured_catalog() {
            Some(featured) => Some(serde_json::to_string(featured).map_err(StoreError::write)?),
            None => None,
        };
        put_preference(&transaction, FEATURED_CATALOG, featured.as_deref())?;

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
                        title_poster, title_background, title_logo, position, duration, watched,
                        updated_at, stream_addon, binge_group
                 FROM watch_progress ORDER BY updated_at DESC",
            )
            .map_err(StoreError::read)?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, Option<String>>(7)?,
                    row.get::<_, Option<String>>(8)?,
                    row.get::<_, Option<f64>>(9)?,
                    row.get::<_, Option<f64>>(10)?,
                    row.get::<_, i64>(11)?,
                    row.get::<_, i64>(12)?,
                    row.get::<_, Option<String>>(13)?,
                    row.get::<_, Option<String>>(14)?,
                ))
            })
            .map_err(StoreError::read)?;

        let mut watch = Vec::new();
        for row in rows {
            // Nothing here is named in the message: a Title's addon and id are
            // the owner's Watch progress, and a read failure ends up in a log or
            // in an error a client sees.
            let (
                video_type,
                video_id,
                title_addon,
                title_id,
                title_type,
                title_name,
                title_poster,
                title_background,
                title_logo,
                position,
                duration,
                watched,
                updated_at,
                stream_addon,
                binge_group,
            ) = row.map_err(StoreError::read)?;

            let video = VideoRef::parse(&video_type, &video_id).map_err(|_| StoreError::Read {
                detail: "a stored Watch progress entry names no Video".to_owned(),
            })?;
            // No Addon is a Discovered Title rather than a broken row: a Title
            // TMDB named before any Addon did has none (ADR-0020). What is one is
            // an Addon id that cannot be read at all.
            let addon = title_addon
                .as_deref()
                .map(|addon| {
                    AddonId::parse(addon).map_err(|_| StoreError::Read {
                        detail: "a stored Watch progress entry names no Addon".to_owned(),
                    })
                })
                .transpose()?;
            // The Title is read back through the same judgement it was written
            // with, so a row that somehow drifted cannot reach a Snapshot.
            let title = TitleStub::parse(&TitleCard {
                addon,
                id: title_id,
                r#type: title_type,
                name: title_name,
                poster: title_poster,
                background: title_background,
                logo: title_logo,
            })
            .map_err(|_| StoreError::Read {
                detail: "a stored Watch progress entry names no Title".to_owned(),
            })?;

            // The Stream's Addon is judged as an Addon id, and a row written
            // before this field existed simply has none — the continuity of an
            // Up next is then unknown, and Playing it refuses for the picker.
            let stream_addon = stream_addon
                .as_deref()
                .map(|addon| {
                    AddonId::parse(addon).map_err(|_| StoreError::Read {
                        detail: "a stored Watch progress entry names no Stream Addon".to_owned(),
                    })
                })
                .transpose()?;

            watch.push(WatchProgress {
                video,
                title,
                position,
                duration,
                watched: watched != 0,
                stream_addon,
                binge_group,
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
                      title_poster, title_background, title_logo, position, duration, watched,
                      updated_at, stream_addon, binge_group)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
                 ON CONFLICT(video_id) DO UPDATE SET
                     video_type       = excluded.video_type,
                     title_addon      = excluded.title_addon,
                     title_id         = excluded.title_id,
                     title_type       = excluded.title_type,
                     title_name       = excluded.title_name,
                     title_poster     = excluded.title_poster,
                     title_background = excluded.title_background,
                     title_logo       = excluded.title_logo,
                     position         = excluded.position,
                     duration         = excluded.duration,
                     watched          = excluded.watched,
                     updated_at       = excluded.updated_at,
                     stream_addon     = excluded.stream_addon,
                     binge_group      = excluded.binge_group",
                params![
                    progress.video.id,
                    progress.video.r#type,
                    progress.title.addon().map(|addon| addon.as_str()),
                    progress.title.id(),
                    progress.title.r#type(),
                    progress.title.name(),
                    progress.title.poster(),
                    progress.title.background(),
                    progress.title.logo(),
                    progress.position,
                    progress.duration,
                    i64::from(progress.watched),
                    progress.updated_at,
                    progress.stream_addon.as_ref().map(AddonId::as_str),
                    progress.binge_group,
                ],
            )
            .map_err(StoreError::write)?;

        transaction.commit().map_err(StoreError::write)
    }

    fn read_titles(&self) -> Result<Vec<CachedTitle>, StoreError> {
        let connection = self.locked()?;
        let mut statement = connection
            .prepare(
                "SELECT key, title, source, status, read_at, next_season, next_episode
                 FROM titles ORDER BY read_at, key",
            )
            .map_err(StoreError::read)?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, Option<u32>>(5)?,
                    row.get::<_, Option<u32>>(6)?,
                ))
            })
            .map_err(StoreError::read)?;

        let mut titles = Vec::new();
        for row in rows {
            // Nothing here is named in the message: a Title's id is the owner's
            // browsing, and a read failure ends up in a log or a client's error.
            let (key, title, source, status, read_at, next_season, next_episode) =
                row.map_err(StoreError::read)?;

            let key: TitleKey = serde_json::from_str(&key).map_err(|error| StoreError::Read {
                detail: format!("a kept Title's key is unusable: {error}"),
            })?;
            let title: Title = serde_json::from_str(&title).map_err(|error| StoreError::Read {
                detail: format!("a kept Title is unusable: {error}"),
            })?;
            if title.key != key {
                return Err(StoreError::Read {
                    detail: "a kept Title's key and title disagree".to_owned(),
                });
            }
            let source = TitleSource::parse(&source).ok_or_else(|| StoreError::Read {
                detail: "a kept Title's source is unusable".to_owned(),
            })?;
            let status = status
                .as_deref()
                .map(|status| {
                    SeriesStatus::from_stored(status).ok_or_else(|| StoreError::Read {
                        detail: "a kept Title's series status is unusable".to_owned(),
                    })
                })
                .transpose()?;
            let next_episode = match (next_season, next_episode) {
                (Some(season), Some(episode)) => Some(NextEpisode { season, episode }),
                (None, None) => None,
                _ => {
                    return Err(StoreError::Read {
                        detail: "a kept Title's next episode is incomplete".to_owned(),
                    })
                }
            };

            titles.push(CachedTitle {
                title,
                read_at,
                source,
                status,
                next_episode,
            });
        }

        Ok(titles)
    }

    fn write_title(&self, cached: &CachedTitle) -> Result<(), StoreError> {
        let connection = self.locked()?;
        let key = serde_json::to_string(&cached.title.key).map_err(StoreError::write)?;
        let title = serde_json::to_string(&cached.title).map_err(StoreError::write)?;
        let next_season = cached.next_episode.map(|next| next.season);
        let next_episode = cached.next_episode.map(|next| next.episode);

        connection
            .execute(
                "INSERT INTO titles (key, title, source, status, read_at, next_season, next_episode)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                 ON CONFLICT(key) DO UPDATE SET
                     title        = excluded.title,
                     source       = excluded.source,
                     status       = excluded.status,
                     read_at      = excluded.read_at,
                     next_season  = excluded.next_season,
                     next_episode = excluded.next_episode",
                params![
                    key,
                    title,
                    cached.source.as_str(),
                    cached.status.map(SeriesStatus::as_str),
                    cached.read_at,
                    next_season,
                    next_episode,
                ],
            )
            .map_err(StoreError::write)?;

        Ok(())
    }

    fn remove_title(&self, key: &TitleKey) -> Result<(), StoreError> {
        let connection = self.locked()?;
        let key = serde_json::to_string(key).map_err(StoreError::write)?;

        connection
            .execute("DELETE FROM titles WHERE key = ?1", params![key])
            .map_err(StoreError::write)?;

        Ok(())
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
