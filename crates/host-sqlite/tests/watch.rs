//! Watch progress through the store: a round trip, the library's order, and one
//! entry per Video. Driven through the `Store` seam, so nothing here names a
//! table or a column.

use host_core::{AddonId, Store, TitleCard, TitleStub, VideoRef, WatchProgress};
use host_sqlite::SqliteStore;

fn video(id: &str) -> VideoRef {
    VideoRef::parse("series", id).expect("a Video a request could name")
}

fn title(name: &str) -> TitleStub {
    TitleStub::parse(&TitleCard {
        addon: AddonId::parse("com.linvo.cinemeta").expect("an Addon id"),
        id: "tt0903747".to_owned(),
        r#type: "series".to_owned(),
        name: name.to_owned(),
        poster: Some("https://images.example.org/bb.jpg".to_owned()),
    })
    .expect("a Title a request could name")
}

fn entry(id: &str, position: f64, at: i64) -> WatchProgress {
    WatchProgress {
        video: video(id),
        title: title("Breaking Bad"),
        position: Some(position),
        duration: Some(2820.0),
        watched: false,
        updated_at: at,
    }
}

#[test]
fn watch_progress_round_trips_through_the_store() {
    let store = SqliteStore::open_in_memory().expect("an in-memory store opens");
    let written = WatchProgress {
        watched: true,
        position: Some(2810.0),
        ..entry("tt0903747:1:2", 0.0, 5_000)
    };

    store
        .write_watch_progress(&written)
        .expect("the store takes a progress entry");

    assert_eq!(
        store.read_watch_progress().expect("the store reads back"),
        vec![written],
        "every field the Host wrote is the field it reads"
    );
}

#[test]
fn a_title_read_back_keeps_the_addon_a_removal_is_judged_against() {
    let store = SqliteStore::open_in_memory().expect("an in-memory store opens");
    store
        .write_watch_progress(&entry("tt0903747:1:2", 402.0, 1_000))
        .expect("the store takes a progress entry");

    let read = store.read_watch_progress().expect("the store reads back");

    assert_eq!(read[0].title.addon().as_str(), "com.linvo.cinemeta");
    assert_eq!(read[0].title.name(), "Breaking Bad");
    assert_eq!(read[0].position, Some(402.0));
    assert_eq!(read[0].duration, Some(2820.0));
}

#[test]
fn the_library_comes_back_most_recently_played_first() {
    let store = SqliteStore::open_in_memory().expect("an in-memory store opens");
    store
        .write_watch_progress(&entry("tt0903747:1:1", 100.0, 1_000))
        .expect("the older entry is written");
    store
        .write_watch_progress(&entry("tt0903747:1:2", 200.0, 2_000))
        .expect("the newer entry is written");

    let read = store.read_watch_progress().expect("the store reads back");

    assert_eq!(
        read.iter()
            .map(|entry| entry.video.id.as_str())
            .collect::<Vec<_>>(),
        vec!["tt0903747:1:2", "tt0903747:1:1"],
        "the Continue watching row reads the newest first"
    );
}

#[test]
fn writing_the_same_video_again_replaces_the_entry_rather_than_adding_one() {
    let store = SqliteStore::open_in_memory().expect("an in-memory store opens");
    store
        .write_watch_progress(&entry("tt0903747:1:2", 100.0, 1_000))
        .expect("the first write lands");
    store
        .write_watch_progress(&entry("tt0903747:1:2", 700.0, 2_000))
        .expect("the second write lands");

    let read = store.read_watch_progress().expect("the store reads back");

    assert_eq!(read.len(), 1, "there is one entry per Video");
    assert_eq!(read[0].position, Some(700.0));
    assert_eq!(read[0].updated_at, 2_000);
}

#[test]
fn a_fresh_database_has_no_library() {
    let store = SqliteStore::open_in_memory().expect("an in-memory store opens");

    assert_eq!(
        store.read_watch_progress().expect("the store reads back"),
        Vec::new()
    );
}
