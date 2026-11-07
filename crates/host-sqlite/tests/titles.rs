//! The kept Titles through the store: a round trip of every fact the cache
//! decides on, one row per identity, and a removal. Driven through the `Store`
//! seam, so nothing here names a table or a column.

use host_core::{
    AddonId, CachedTitle, NextEpisode, SeriesStatus, Store, Title, TitleKey, TitleRef, TitleSource,
};
use host_sqlite::SqliteStore;

const SERIES: &str = include_str!("../../host-core/tests/fixtures/cinemeta-meta-series.json");

fn title() -> Title {
    Title::parse(
        SERIES,
        AddonId::parse("com.linvo.cinemeta").expect("an Addon id"),
        &TitleRef::parse("series", "tt0903747").expect("a Title"),
    )
    .expect("the recorded series parses")
}

fn kept(read_at: i64) -> CachedTitle {
    CachedTitle {
        title: title(),
        read_at,
        source: TitleSource::Addon,
        status: None,
        next_episode: None,
    }
}

#[test]
fn a_kept_title_round_trips_with_its_moment_source_and_series_status() {
    let store = SqliteStore::open_in_memory().expect("an in-memory store opens");
    let mut written = kept(5_000);
    written.title.key = TitleKey::Tmdb { id: 1396 };
    written.source = TitleSource::Both;
    written.status = Some(SeriesStatus::Running);
    written.next_episode = Some(NextEpisode {
        season: 2,
        episode: 7,
    });

    store
        .write_title(&written)
        .expect("the store takes a Title");

    assert_eq!(
        store.read_titles().expect("the store reads back"),
        vec![written],
        "every fact the freshness rule turns on is the fact read back"
    );
}

#[test]
fn a_film_kept_from_an_addon_reads_back_with_no_series_status() {
    let store = SqliteStore::open_in_memory().expect("an in-memory store opens");
    let written = kept(1_000);

    store
        .write_title(&written)
        .expect("the store takes a Title");
    let read = store.read_titles().expect("the store reads back");

    assert_eq!(read[0].title.name, "Breaking Bad");
    assert_eq!(read[0].source, TitleSource::Addon);
    assert_eq!(read[0].status, None, "an Addon does not speak for TMDB");
    assert_eq!(
        read[0].title.videos.len(),
        title().videos.len(),
        "the Videos travel with the Title, because Up next is drawn from them"
    );
}

#[test]
fn a_title_read_again_replaces_its_row_rather_than_adding_one() {
    let store = SqliteStore::open_in_memory().expect("an in-memory store opens");
    store
        .write_title(&kept(1_000))
        .expect("the first write lands");
    let mut newer = kept(2_000);
    newer.title.name = "Breaking Bad Again".to_owned();
    newer.status = Some(SeriesStatus::Ended);

    store.write_title(&newer).expect("the second write lands");
    let read = store.read_titles().expect("the store reads back");

    assert_eq!(read.len(), 1, "a Title is one row per identity");
    assert_eq!(read[0].title.name, "Breaking Bad Again");
    assert_eq!(read[0].status, Some(SeriesStatus::Ended));
    assert_eq!(read[0].read_at, 2_000);
}

#[test]
fn a_title_dropped_from_the_cache_is_gone_from_the_store() {
    let store = SqliteStore::open_in_memory().expect("an in-memory store opens");
    let written = kept(1_000);
    store
        .write_title(&written)
        .expect("the store takes a Title");

    store
        .remove_title(&written.title.key)
        .expect("the store drops a Title");

    assert_eq!(
        store.read_titles().expect("the store reads back"),
        Vec::new()
    );
}

#[test]
fn the_store_reads_the_titles_oldest_read_first() {
    let store = SqliteStore::open_in_memory().expect("an in-memory store opens");
    for (id, at) in [(2, 2_000), (1, 1_000)] {
        let mut written = kept(at);
        written.title.key = TitleKey::Tmdb { id };
        store
            .write_title(&written)
            .expect("the store takes a Title");
    }

    let read = store.read_titles().expect("the store reads back");

    assert_eq!(
        read.iter().map(|title| title.read_at).collect::<Vec<_>>(),
        vec![1_000, 2_000],
        "what the Host evicts first is what it reads first"
    );
}

#[test]
fn a_fresh_database_keeps_no_titles() {
    let store = SqliteStore::open_in_memory().expect("an in-memory store opens");

    assert_eq!(
        store.read_titles().expect("the store reads back"),
        Vec::new()
    );
}
