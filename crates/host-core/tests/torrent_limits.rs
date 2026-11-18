//! What the Host tells the Torrent engine about how far to read ahead and how
//! much disk to take (ADR-0042 §3): at startup, and on every change of either
//! preference, through the fixture engine a test holds.

use std::sync::Arc;

use host_core::{
    Action, AddonProvider, FixtureClock, FixtureFetcher, FixturePlayer, FixtureTorrentEngine, Host,
    InMemorySecretStore, InMemoryStore, Preferences, SecretBackend, Store, StreamBuffer,
    TorrentCache, TorrentLimits, ACTION_VERSION,
};

fn host_over(store: Arc<dyn Store>, engine: Arc<FixtureTorrentEngine>) -> Host {
    let fetcher = Arc::new(FixtureFetcher::new());
    let provider = Arc::new(AddonProvider::new(fetcher.clone()));
    Host::new(
        store,
        fetcher,
        Arc::new(InMemorySecretStore::backed_by(SecretBackend::Keyring)),
        provider,
        Arc::new(FixturePlayer::new()),
        Arc::new(FixtureClock::new()),
    )
    .expect("a Host over a store starts")
    .with_torrent_engine(engine)
}

fn dispatch(host: &mut Host, body: &str) {
    let envelope = format!(r#"{{"version":{ACTION_VERSION},"action":{body}}}"#);
    let action = Action::parse(&envelope).expect("an Action");
    host.dispatch(action).expect("the Host takes it");
}

fn limits(buffer_megabytes: u64, cache_megabytes: u64) -> TorrentLimits {
    TorrentLimits {
        readahead_bytes: buffer_megabytes * 1_000_000 / 4 * 3,
        cache_bytes: cache_megabytes * 1_000_000,
    }
}

#[test]
fn a_host_given_an_engine_tells_it_the_default_limits_at_once() {
    let engine = Arc::new(FixtureTorrentEngine::new());
    let _host = host_over(Arc::new(InMemoryStore::new()), engine.clone());

    assert_eq!(engine.limits(), vec![limits(512, 2000)]);
}

#[test]
fn a_host_tells_the_engine_the_limits_its_store_holds() {
    let mut stored = Preferences::new();
    stored.set_stream_buffer(StreamBuffer::parse(600, 1024).expect("a buffer"));
    stored.set_torrent_cache(TorrentCache::parse(8000).expect("a cache"));
    let engine = Arc::new(FixtureTorrentEngine::new());
    let _host = host_over(Arc::new(InMemoryStore::holding(stored)), engine.clone());

    assert_eq!(engine.limits(), vec![limits(1024, 8000)]);
}

#[test]
fn a_new_torrent_cache_is_told_to_the_engine() {
    let engine = Arc::new(FixtureTorrentEngine::new());
    let mut host = host_over(Arc::new(InMemoryStore::new()), engine.clone());

    dispatch(
        &mut host,
        r#"{"type":"set_torrent_cache","megabytes":8000}"#,
    );

    assert_eq!(
        engine.limits(),
        vec![limits(512, 2000), limits(512, 8000)],
        "the startup limits, then the change"
    );
}

#[test]
fn a_new_stream_buffer_is_told_to_the_engine_too() {
    let engine = Arc::new(FixtureTorrentEngine::new());
    let mut host = host_over(Arc::new(InMemoryStore::new()), engine.clone());

    dispatch(
        &mut host,
        r#"{"type":"set_stream_buffer","seconds":600,"megabytes":1024}"#,
    );

    assert_eq!(engine.limits(), vec![limits(512, 2000), limits(1024, 2000)]);
}

#[test]
fn a_refused_preference_tells_the_engine_nothing() {
    let engine = Arc::new(FixtureTorrentEngine::new());
    let mut host = host_over(Arc::new(InMemoryStore::new()), engine.clone());

    let envelope = format!(
        r#"{{"version":{ACTION_VERSION},"action":{{"type":"set_torrent_cache","megabytes":1}}}}"#
    );
    assert!(host
        .dispatch(Action::parse(&envelope).expect("an Action"))
        .is_err());

    assert_eq!(engine.limits(), vec![limits(512, 2000)], "only the startup");
}

#[test]
fn the_limits_follow_the_arithmetic_of_the_two_preferences() {
    let engine = Arc::new(FixtureTorrentEngine::new());
    let mut host = host_over(Arc::new(InMemoryStore::new()), engine.clone());

    dispatch(&mut host, r#"{"type":"set_torrent_cache","megabytes":256}"#);
    dispatch(
        &mut host,
        r#"{"type":"set_stream_buffer","seconds":300,"megabytes":4096}"#,
    );

    let told = engine.limits();
    assert_eq!(
        told.last().copied(),
        Some(TorrentLimits::from_preferences(
            StreamBuffer::parse(300, 4096).expect("a buffer"),
            TorrentCache::parse(256).expect("a cache"),
        ))
    );
    assert_eq!(
        told.last().map(|limits| limits.cache_bytes),
        Some(256_000_000)
    );
}
