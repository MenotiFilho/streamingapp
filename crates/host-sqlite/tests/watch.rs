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
        addon: Some(AddonId::parse("com.linvo.cinemeta").expect("an Addon id")),
        id: "tt0903747".to_owned(),
        r#type: "series".to_owned(),
        name: name.to_owned(),
        poster: Some("https://images.example.org/bb.jpg".to_owned()),
        background: Some("https://images.example.org/bb-backdrop.jpg".to_owned()),
    })
    .expect("a Title a request could name")
}

/// A Discovered Title: one TMDB named, with no Addon behind it (ADR-0020).
fn discovered() -> TitleStub {
    TitleStub::parse(&TitleCard {
        addon: None,
        id: "tmdb:1396".to_owned(),
        r#type: "series".to_owned(),
        name: "Breaking Bad".to_owned(),
        poster: None,
        background: None,
    })
    .expect("a Discovered Title is one the Host will key by its own id")
}

fn entry(id: &str, position: f64, at: i64) -> WatchProgress {
    WatchProgress {
        video: video(id),
        title: title("Breaking Bad"),
        position: Some(position),
        duration: Some(2820.0),
        watched: false,
        stream_addon: None,
        binge_group: None,
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

    assert_eq!(
        read[0].title.addon().map(AddonId::as_str),
        Some("com.linvo.cinemeta")
    );
    assert_eq!(read[0].title.name(), "Breaking Bad");
    assert_eq!(read[0].position, Some(402.0));
    assert_eq!(read[0].duration, Some(2820.0));
}

#[test]
fn a_title_with_no_addon_round_trips_as_one_with_none() {
    // A Discovered Title has no Addon to store: the column is absent rather
    // than a broken Addon id, and the row reads back whole (ADR-0020).
    let store = SqliteStore::open_in_memory().expect("an in-memory store opens");
    let written = WatchProgress {
        title: discovered(),
        ..entry("tmdb:1396:1:2", 402.0, 1_000)
    };
    store
        .write_watch_progress(&written)
        .expect("the store takes a progress entry");

    let read = store.read_watch_progress().expect("the store reads back");

    assert_eq!(read, vec![written.clone()], "the row is what was written");
    assert_eq!(read[0].title.addon(), None);
}

#[test]
fn the_backdrop_a_client_sent_round_trips_beside_the_poster() {
    // Continue watching draws 16:9 art (#62), so the backdrop is part of the
    // card a restart over this store must find again.
    let store = SqliteStore::open_in_memory().expect("an in-memory store opens");
    store
        .write_watch_progress(&entry("tt0903747:1:2", 402.0, 1_000))
        .expect("the store takes a progress entry");

    let read = store.read_watch_progress().expect("the store reads back");

    assert_eq!(
        read[0].title.background(),
        Some("https://images.example.org/bb-backdrop.jpg")
    );
    assert_eq!(
        read[0].title.poster(),
        Some("https://images.example.org/bb.jpg"),
        "the poster the backdrop falls back from is kept too"
    );
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
fn the_stream_a_video_was_played_from_round_trips_for_playing_its_up_next() {
    // #276: an Up next continues the Addon and release of the Video before it,
    // so both are part of what a restart over this store must find again.
    let store = SqliteStore::open_in_memory().expect("an in-memory store opens");
    let written = WatchProgress {
        stream_addon: Some(AddonId::parse("org.example.streams").expect("an Addon id")),
        binge_group: Some("the-release".to_owned()),
        ..entry("tt0903747:1:2", 402.0, 1_000)
    };

    store
        .write_watch_progress(&written)
        .expect("the store takes a progress entry");

    assert_eq!(
        store.read_watch_progress().expect("the store reads back"),
        vec![written],
        "the Addon and the release round-trip beside the position"
    );
}

#[test]
fn a_fresh_database_has_no_library() {
    let store = SqliteStore::open_in_memory().expect("an in-memory store opens");

    assert_eq!(
        store.read_watch_progress().expect("the store reads back"),
        Vec::new()
    );
}
