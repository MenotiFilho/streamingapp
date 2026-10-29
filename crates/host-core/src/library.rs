//! The owner's Stremio account Library, as a read-only room.
//!
//! The account keeps the Library and its own Continue watching in one
//! `libraryItem` collection (research note `stremio-account-api.md`). This
//! module is the pure part of reading it: the diff against the account's
//! `datastoreMeta` index, the `removed` filter, the `_mtime` order, and the
//! entry a client draws. The transport is [`crate::StremioApi`]; the HTTP
//! implementation lives in `host-addon`.
//!
//! Two rules that are easy to get wrong and are therefore here, tested:
//!
//! - **A tombstone is a document, not a deletion.** A `removed: true` item stays
//!   in the cache with every field the account owns; it is simply not shown. A
//!   later write has to put the document back whole.
//! - **`state.lastWatched` is not the order.** Marking an episode writes the
//!   episode's release date; playback writes now. `_mtime` is the only field
//!   that answers "when was this item last touched".

use std::collections::{HashMap, HashSet};

use serde::Serialize;
use serde_json::Value;

use crate::action::ActionError;
use crate::stremio::LibraryMeta;
use crate::sync::RemoteItem;

/// One Title in the account's Library, as the room draws it.
///
/// The item carries the name and poster, so the card needs no Addon round-trip.
/// `position` and `duration` are seconds; `mtime` is milliseconds since the Unix
/// epoch, from the item's `_mtime` where it has one.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LibraryEntry {
    /// The Title's `_id`, which is also the item's id.
    pub id: String,
    /// The name the account saved with the item.
    pub name: String,
    /// The item's content type: `movie`, `series`, …
    #[serde(rename = "type")]
    pub r#type: String,
    /// The poster the account saved with the item.
    pub poster: Option<String>,
    /// The poster's shape, as the account recorded it.
    pub poster_shape: Option<String>,
    /// When the item was last modified, in milliseconds since the Unix epoch.
    pub mtime: i64,
    /// The Video the account last played in this Title, where it has one.
    pub video_id: Option<String>,
    /// How far into that Video, in seconds, where it is past the start.
    pub position: Option<f64>,
    /// How long that Video is, in seconds, where the account knows.
    pub duration: Option<f64>,
    /// Whether the room draws the Continue mark: `timeOffset > 0`.
    pub continue_watching: bool,
}

/// The answer to `Action::Library`.
///
/// `failure` is what tells an empty account from an account that could not be
/// read. The room must never draw the second as the first.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Library {
    pub entries: Vec<LibraryEntry>,
    pub failure: Option<ActionError>,
}

/// The ids whose documents a read has to fetch, or a cold full read.
///
/// The account's `datastoreMeta` is `[id, mtime_ms]`, so a cached item whose
/// mtime still matches needs no document fetch. `all` is a cold cache: the first
/// read asks `datastoreGet {all:true}`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct LibraryPlan {
    pub(crate) all: bool,
    pub(crate) ids: Vec<String>,
}

/// The raw documents the Host has read, keyed by `_id`, and the index they were
/// read against.
///
/// A memo, not state: it is shared by questions like the catalog cache, never
/// serialized into a Snapshot, and lost with the process. A cold start reads the
/// full collection again.
#[derive(Debug, Default)]
pub(crate) struct LibraryCache {
    items: HashMap<String, CachedItem>,
    meta: Vec<LibraryMeta>,
}

#[derive(Debug, Clone)]
struct CachedItem {
    /// The index mtime the document was read at, used for the diff.
    mtime: i64,
    /// The document exactly as Stremio sent it, tombstones included.
    raw: Value,
}

impl LibraryCache {
    /// What to fetch for this account index: the full collection on a cold
    /// cache, otherwise only ids whose mtime moved or that the cache lacks.
    ///
    /// An empty index means there is nothing to fetch — the account's Library is
    /// empty — rather than a reason to ask for `all:true` on every visit.
    pub(crate) fn plan(&self, meta: &[LibraryMeta]) -> LibraryPlan {
        if self.items.is_empty() && !meta.is_empty() {
            return LibraryPlan {
                all: true,
                ids: Vec::new(),
            };
        }

        LibraryPlan {
            all: false,
            ids: meta
                .iter()
                .filter(|entry| {
                    self.items
                        .get(&entry.id)
                        .is_none_or(|cached| cached.mtime != entry.mtime)
                })
                .map(|entry| entry.id.clone())
                .collect(),
        }
    }

    /// Keep the documents a read brought, keyed by the index mtime.
    ///
    /// A document is not deleted for being a tombstone or for being absent from
    /// the index: it is the account's document, and a later write has to put it
    /// back whole.
    pub(crate) fn keep(&mut self, items: Vec<Value>, meta: &[LibraryMeta]) {
        let indexed: HashMap<&str, i64> = meta
            .iter()
            .map(|entry| (entry.id.as_str(), entry.mtime))
            .collect();

        for raw in items {
            let Ok(item) = RemoteItem::parse(raw.clone()) else {
                continue;
            };
            let id = item.id().to_owned();
            let mtime = indexed
                .get(id.as_str())
                .copied()
                .or_else(|| item.mtime())
                .unwrap_or(0);
            self.items.insert(id, CachedItem { mtime, raw });
        }
    }

    /// Record the index the cache was just read against.
    pub(crate) fn set_meta(&mut self, meta: &[LibraryMeta]) {
        self.meta = meta.to_vec();
    }

    /// Empty the memo: a different account must not inherit this one's Library.
    pub(crate) fn clear(&mut self) {
        self.items.clear();
        self.meta.clear();
    }

    /// The room's rows: indexed, not removed, ordered by `_mtime` descending.
    pub(crate) fn entries(&self) -> Vec<LibraryEntry> {
        let indexed: HashSet<&str> = self.meta.iter().map(|entry| entry.id.as_str()).collect();
        let mut entries: Vec<LibraryEntry> = self
            .items
            .iter()
            .filter_map(|(id, cached)| {
                if !indexed.contains(id.as_str()) {
                    return None;
                }
                let item = RemoteItem::parse(cached.raw.clone()).ok()?;
                if item.removed() {
                    return None;
                }
                let position = item.offset_seconds();
                let duration = item.duration_seconds();
                Some(LibraryEntry {
                    id: id.clone(),
                    name: item.name().unwrap_or(id.as_str()).to_owned(),
                    r#type: item.r#type().unwrap_or("other").to_owned(),
                    poster: item.poster().map(str::to_owned),
                    poster_shape: item.poster_shape().map(str::to_owned),
                    mtime: item.mtime().unwrap_or(cached.mtime),
                    video_id: item.video_id().map(str::to_owned),
                    position,
                    duration,
                    continue_watching: position.is_some_and(|at| at > 0.0),
                })
            })
            .collect();

        entries.sort_by(|one, other| {
            other
                .mtime
                .cmp(&one.mtime)
                .then_with(|| one.name.cmp(&other.name))
                .then_with(|| one.id.cmp(&other.id))
        });
        entries
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const JAN_1: i64 = 1_704_067_200_000;
    const JAN_2: i64 = JAN_1 + 86_400_000;
    const JAN_3: i64 = JAN_2 + 86_400_000;

    fn iso(millis: i64) -> String {
        crate::sync::iso_from_millis(millis)
    }

    fn item(id: &str, name: &str, mtime: i64, removed: bool, offset_ms: i64) -> Value {
        json!({
            "_id": id,
            "name": name,
            "type": "movie",
            "poster": format!("https://images.example.org/{id}.jpg"),
            "posterShape": "poster",
            "removed": removed,
            "temp": false,
            "_mtime": iso(mtime),
            "state": { "timeOffset": offset_ms, "duration": 3_600_000, "lastWatched": iso(mtime + 86_400_000) }
        })
    }

    fn meta(items: &[Value]) -> Vec<LibraryMeta> {
        items
            .iter()
            .filter_map(|item| {
                Some(LibraryMeta {
                    id: item.get("_id")?.as_str()?.to_owned(),
                    mtime: item
                        .get("_mtime")?
                        .as_str()
                        .and_then(crate::sync::millis_from_iso)?,
                })
            })
            .collect()
    }

    #[test]
    fn a_cold_cache_reads_everything_and_a_warm_one_reads_only_what_moved() {
        let one = item("one", "One", JAN_1, false, 0);
        let two = item("two", "Two", JAN_2, false, 0);
        let mut cache = LibraryCache::default();

        let cold = cache.plan(&meta(&[one.clone(), two.clone()]));
        assert!(cold.all, "a cold cache takes the full collection");
        assert!(cold.ids.is_empty());

        cache.keep(
            vec![one.clone(), two.clone()],
            &meta(&[one.clone(), two.clone()]),
        );
        cache.set_meta(&meta(&[one.clone(), two.clone()]));

        let warm = cache.plan(&meta(&[one.clone(), two.clone()]));
        assert!(!warm.all);
        assert!(
            warm.ids.is_empty(),
            "an unchanged index fetches no document"
        );

        let moved = item("two", "Two", JAN_3, false, 0);
        let changed = cache.plan(&meta(&[one.clone(), moved.clone()]));
        assert!(!changed.all);
        assert_eq!(changed.ids, vec!["two".to_owned()]);

        let added = item("three", "Three", JAN_3, false, 0);
        let fresh = cache.plan(&meta(&[moved, added]));
        assert_eq!(fresh.ids, vec!["two".to_owned(), "three".to_owned()]);
    }

    #[test]
    fn an_empty_index_needs_no_full_read() {
        let cache = LibraryCache::default();
        let plan = cache.plan(&[]);
        assert!(!plan.all);
        assert!(plan.ids.is_empty());
    }

    #[test]
    fn the_room_hides_removed_items_but_the_cache_keeps_the_document() {
        let live = item("live", "Live", JAN_2, false, 0);
        let tombstone = item("gone", "Gone", JAN_3, true, 0);
        let index = meta(&[live.clone(), tombstone.clone()]);
        let mut cache = LibraryCache::default();
        cache.keep(vec![live.clone(), tombstone.clone()], &index);
        cache.set_meta(&index);

        let entries = cache.entries();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].id, "live");
        assert!(
            cache.items.contains_key("gone"),
            "a tombstone stays in the cache; only the room hides it"
        );
        assert_eq!(cache.items["gone"].raw, tombstone);
    }

    #[test]
    fn rows_are_ordered_by_mtime_descending_not_by_last_watched() {
        let old = item("old", "Old", JAN_1, false, 0);
        let new = item("new", "New", JAN_3, false, 0);
        let middle = item("middle", "Middle", JAN_2, false, 0);
        let index = meta(&[old.clone(), new.clone(), middle.clone()]);
        let mut cache = LibraryCache::default();
        cache.keep(vec![old, new, middle], &index);
        cache.set_meta(&index);

        let ids: Vec<String> = cache.entries().into_iter().map(|entry| entry.id).collect();
        assert_eq!(ids, vec!["new", "middle", "old"]);
    }

    #[test]
    fn the_continue_mark_is_a_position_past_the_start() {
        let untouched = item("untouched", "Untouched", JAN_2, false, 0);
        let started = item("started", "Started", JAN_1, false, 612_000);
        let index = meta(&[untouched.clone(), started.clone()]);
        let mut cache = LibraryCache::default();
        cache.keep(vec![untouched, started], &index);
        cache.set_meta(&index);

        let entries = cache.entries();
        let started = entries
            .iter()
            .find(|entry| entry.id == "started")
            .expect("started");
        let untouched = entries
            .iter()
            .find(|entry| entry.id == "untouched")
            .expect("untouched");
        assert!(started.continue_watching);
        assert_eq!(started.position, Some(612.0));
        assert_eq!(started.duration, Some(3600.0));
        assert!(!untouched.continue_watching);
        assert_eq!(untouched.position, None);
    }

    #[test]
    fn a_series_is_one_row_with_its_current_episode() {
        let series = json!({
            "_id": "tt0903747",
            "name": "Breaking Bad",
            "type": "series",
            "poster": "https://images.example.org/bb.jpg",
            "posterShape": "poster",
            "removed": false,
            "temp": false,
            "_mtime": iso(JAN_3),
            "state": {
                "video_id": "tt0903747:5:14",
                "timeOffset": 612_000,
                "duration": 2_820_000,
                "watched": "tt0903747:5:14:62:AAAA"
            }
        });
        let index = meta(std::slice::from_ref(&series));
        let mut cache = LibraryCache::default();
        cache.keep(vec![series], &index);
        cache.set_meta(&index);

        let entries = cache.entries();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].video_id.as_deref(), Some("tt0903747:5:14"));
        assert!(entries[0].continue_watching);
    }

    #[test]
    fn an_item_outside_the_index_is_not_drawn_and_a_name_falls_back_to_the_id() {
        let unnamed = json!({
            "_id": "tt0000001",
            "type": "movie",
            "removed": false,
            "_mtime": iso(JAN_1),
            "state": { "timeOffset": 0 }
        });
        let index = meta(std::slice::from_ref(&unnamed));
        let mut cache = LibraryCache::default();
        cache.keep(vec![unnamed], &index);
        cache.set_meta(&index);
        assert_eq!(cache.entries()[0].name, "tt0000001");

        cache.set_meta(&[]);
        assert!(
            cache.entries().is_empty(),
            "an item the index does not list is not drawn"
        );
    }

    #[test]
    fn clearing_the_cache_drops_the_documents_and_the_index() {
        let one = item("one", "One", JAN_1, false, 0);
        let index = meta(std::slice::from_ref(&one));
        let mut cache = LibraryCache::default();
        cache.keep(vec![one], &index);
        cache.set_meta(&index);
        cache.clear();
        assert!(cache.entries().is_empty());
        assert!(cache.plan(&index).all, "a cleared cache is cold again");
    }
}
