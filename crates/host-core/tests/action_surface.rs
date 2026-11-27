//! The Host's behaviour, driven the way a client drives it: an Action in,
//! published Snapshots out. Nothing below the Action surface is named here.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use host_core::{
    Action, ActionError, AddonProvider, FixtureClock, FixtureFetcher, FixturePlayer, Host,
    InMemorySecretStore, InMemoryStore, Language, LanguageList, Preferences, SecretBackend,
    Snapshot, Store, StoreError, StreamBuffer, SubtitleColor, SubtitleScale, TorrentCache,
    ACTION_VERSION,
};

/// A Player a test drives by hand: nothing plays unless a test says so, and
/// every telling is remembered.
fn player() -> Arc<FixturePlayer> {
    Arc::new(FixturePlayer::new())
}

/// A clock a test drives by hand, so that the order two Watch progress writes
/// happened in is the order the test says (#29).
fn clock() -> Arc<FixtureClock> {
    Arc::new(FixtureClock::new())
}

/// An Action as a client sends it: the versioned envelope, as JSON text.
fn action(body: &str) -> Action {
    let envelope = format!(r#"{{"version":{ACTION_VERSION},"action":{body}}}"#);
    Action::parse(&envelope).unwrap_or_else(|error| panic!("{envelope} should parse: {error}"))
}

fn action_in_a_foreign_version(version: u64, body: &str) -> String {
    format!(r#"{{"version":{version},"action":{body}}}"#)
}

/// The in-memory stand-in for the OS keyring: tests enter a credential into it
/// the way the owner's window does, and read the Snapshot's protection out.
fn secrets() -> Arc<InMemorySecretStore> {
    Arc::new(InMemorySecretStore::backed_by(SecretBackend::Keyring))
}

/// A Host over a store, with a fetcher that has no fixtures: an Action that asks
/// the network for anything fails the test that took it. The Provider is the
/// real one over that same fetcher, so a stream ask fails the same way.
fn host_over(store: Arc<dyn Store>) -> Host {
    let fetcher = Arc::new(FixtureFetcher::new());
    let provider = Arc::new(AddonProvider::new(fetcher.clone()));
    Host::new(store, fetcher, secrets(), provider, player(), clock())
        .expect("a Host over a store starts")
}

fn host() -> Host {
    host_over(Arc::new(InMemoryStore::new()))
}

fn subtitle_languages(snapshot: &Snapshot) -> Vec<&str> {
    snapshot
        .preferences
        .subtitle_languages
        .iter()
        .map(Language::as_str)
        .collect()
}

fn audio_languages(snapshot: &Snapshot) -> Vec<&str> {
    snapshot
        .preferences
        .audio_languages
        .iter()
        .map(Language::as_str)
        .collect()
}

fn list(tags: &[&str]) -> LanguageList {
    LanguageList::parse(tags).expect("these are a language list")
}

/// The Snapshots an Action published.
fn published(host: &mut Host, action: Action) -> Vec<Snapshot> {
    host.dispatch(action)
        .unwrap_or_else(|error| panic!("the Action should have been taken: {error}"))
        .snapshots
}

fn set_subtitle_languages(host: &mut Host, languages: &[&str]) -> Vec<Snapshot> {
    published(
        host,
        action(
            &serde_json::json!({"type": "set_subtitle_languages", "languages": languages})
                .to_string(),
        ),
    )
}

fn set_audio_languages(host: &mut Host, languages: &[&str]) -> Vec<Snapshot> {
    published(
        host,
        action(
            &serde_json::json!({"type": "set_audio_languages", "languages": languages}).to_string(),
        ),
    )
}

#[test]
fn a_fresh_host_follows_the_file_for_both_languages() {
    let snapshot = host().snapshot();

    assert_eq!(snapshot.revision, 0);
    assert!(subtitle_languages(&snapshot).is_empty());
    assert!(audio_languages(&snapshot).is_empty());
}

#[test]
fn a_host_starts_from_the_preferences_its_store_holds() {
    let stored = Preferences::with_subtitle_languages(list(&["pt-BR", "en"]));
    let store = Arc::new(InMemoryStore::holding(stored));
    let host = host_over(store);

    assert_eq!(subtitle_languages(&host.snapshot()), ["pt-BR", "en"]);
    assert!(audio_languages(&host.snapshot()).is_empty());
}

#[test]
fn choosing_subtitle_languages_publishes_a_snapshot_that_carries_the_list() {
    let mut host = host();

    let published = set_subtitle_languages(&mut host, &["pt-BR", "en"]);

    assert_eq!(published.len(), 1, "one change publishes one Snapshot");
    assert_eq!(subtitle_languages(&published[0]), ["pt-BR", "en"]);
    assert_eq!(subtitle_languages(&host.snapshot()), ["pt-BR", "en"]);
    assert!(
        audio_languages(&published[0]).is_empty(),
        "the two lists are independent"
    );
}

#[test]
fn choosing_audio_languages_leaves_the_subtitle_languages_alone() {
    let mut host = host();
    set_subtitle_languages(&mut host, &["en"]);

    let published = set_audio_languages(&mut host, &["pt-BR", "en", "fr"]);

    assert_eq!(audio_languages(&published[0]), ["pt-BR", "en", "fr"]);
    assert_eq!(subtitle_languages(&published[0]), ["en"]);
}

#[test]
fn an_empty_list_clears_a_list_and_follows_the_file() {
    let mut host = host();
    set_subtitle_languages(&mut host, &["pt-BR"]);
    set_audio_languages(&mut host, &["en"]);

    let subtitles = set_subtitle_languages(&mut host, &[]);
    let audio = set_audio_languages(&mut host, &[]);

    assert!(subtitle_languages(&subtitles[0]).is_empty());
    assert!(audio_languages(&audio[0]).is_empty());
}

#[test]
fn changing_a_preference_twice_publishes_a_snapshot_each_time_and_moves_the_revision_on() {
    let mut host = host();

    let first = set_subtitle_languages(&mut host, &["pt-BR"]);
    let second = set_subtitle_languages(&mut host, &["en", "pt-BR"]);

    assert_eq!(first[0].revision, 1);
    assert_eq!(second[0].revision, 2);
    assert_eq!(
        subtitle_languages(&second[0]),
        ["en", "pt-BR"],
        "the list carried is the whole next list, in the owner's order"
    );
}

#[test]
fn a_fresh_host_draws_subtitles_white_at_full_size() {
    let snapshot = host().snapshot();

    assert_eq!(snapshot.preferences.subtitle_color.as_str(), "#FFFFFF");
    assert_eq!(snapshot.preferences.subtitle_scale.value(), 1.0);
}

#[test]
fn a_host_starts_from_the_appearance_its_store_holds() {
    let mut stored = Preferences::new();
    stored.set_subtitle_color(SubtitleColor::parse("#ffff00").expect("a colour"));
    stored.set_subtitle_scale(SubtitleScale::parse(1.25).expect("a size"));
    let host = host_over(Arc::new(InMemoryStore::holding(stored)));

    assert_eq!(
        host.snapshot().preferences.subtitle_color.as_str(),
        "#FFFF00"
    );
    assert_eq!(host.snapshot().preferences.subtitle_scale.value(), 1.25);
}

#[test]
fn choosing_a_subtitle_colour_publishes_a_snapshot_that_carries_it_normalized() {
    let mut host = host();

    let published = host
        .dispatch(action(
            r##"{"type":"set_subtitle_color","color":"#00ff00"}"##,
        ))
        .expect("a colour should be taken")
        .snapshots;

    assert_eq!(published.len(), 1, "one change publishes one Snapshot");
    assert_eq!(published[0].preferences.subtitle_color.as_str(), "#00FF00");
    assert_eq!(
        host.snapshot().preferences.subtitle_color.as_str(),
        "#00FF00"
    );
}

#[test]
fn choosing_a_subtitle_size_publishes_a_snapshot_that_carries_it() {
    let mut host = host();

    for scale in [0.25, 1.5, 3.0] {
        let published = host
            .dispatch(action(&format!(
                r#"{{"type":"set_subtitle_scale","scale":{scale}}}"#
            )))
            .expect("a size in 0.25..=3.0 should be taken")
            .snapshots;

        assert_eq!(published.len(), 1, "one change publishes one Snapshot");
        assert_eq!(published[0].preferences.subtitle_scale.value(), scale);
        assert_eq!(host.snapshot().preferences.subtitle_scale.value(), scale);
    }
}

#[test]
fn an_appearance_the_host_refuses_leaves_the_state_and_the_store_alone() {
    let store = Arc::new(CountingStore::default());
    let mut host = host_over(store.clone());
    let before = host.snapshot();

    for body in [
        r##"{"type":"set_subtitle_color","color":"#GGGGGG"}"##,
        r#"{"type":"set_subtitle_scale","scale":3.05}"#,
        r#"{"type":"set_subtitle_scale","scale":0.2}"#,
    ] {
        let refused = host.dispatch(action(body));
        assert!(
            refused.is_err(),
            "{body} is not an appearance the Host takes"
        );
    }
    let refused = host
        .dispatch(Action::SetSubtitleScale { scale: f64::NAN })
        .expect_err("a NaN is not a size");
    assert_eq!(refused.kind(), "invalid_subtitle_scale");

    assert_eq!(host.snapshot(), before, "nothing was written");
    assert_eq!(store.writes(), 0, "nothing reached the store");
}

#[test]
fn a_fresh_host_buffers_five_minutes_up_to_half_a_gigabyte() {
    let snapshot = host().snapshot();

    assert_eq!(snapshot.preferences.stream_buffer.seconds(), 300);
    assert_eq!(snapshot.preferences.stream_buffer.megabytes(), 512);
}

#[test]
fn a_host_starts_from_the_buffer_its_store_holds() {
    let mut stored = Preferences::new();
    stored.set_stream_buffer(StreamBuffer::parse(600, 1024).expect("a buffer"));
    let host = host_over(Arc::new(InMemoryStore::holding(stored)));

    let buffer = host.snapshot().preferences.stream_buffer;
    assert_eq!((buffer.seconds(), buffer.megabytes()), (600, 1024));
}

#[test]
fn choosing_a_stream_buffer_publishes_a_snapshot_that_carries_it() {
    let mut host = host();

    let published = host
        .dispatch(action(
            r#"{"type":"set_stream_buffer","seconds":180,"megabytes":256}"#,
        ))
        .expect("a buffer should be taken")
        .snapshots;

    assert_eq!(published.len(), 1, "one change publishes one Snapshot");
    assert_eq!(published[0].preferences.stream_buffer.seconds(), 180);
    assert_eq!(published[0].preferences.stream_buffer.megabytes(), 256);
    assert_eq!(host.snapshot().preferences.stream_buffer.seconds(), 180);
}

#[test]
fn a_buffer_the_host_refuses_leaves_the_state_and_the_store_alone() {
    let store = Arc::new(CountingStore::default());
    let mut host = host_over(store.clone());
    let before = host.snapshot();

    for body in [
        r#"{"type":"set_stream_buffer","seconds":4,"megabytes":512}"#,
        r#"{"type":"set_stream_buffer","seconds":3601,"megabytes":512}"#,
        r#"{"type":"set_stream_buffer","seconds":300,"megabytes":63}"#,
        r#"{"type":"set_stream_buffer","seconds":300,"megabytes":4097}"#,
    ] {
        let refused = host.dispatch(action(body));
        assert!(refused.is_err(), "{body} is not a buffer the Host takes");
    }
    let refused = host
        .dispatch(action(
            r#"{"type":"set_stream_buffer","seconds":300,"megabytes":0}"#,
        ))
        .expect_err("a buffer with no memory is not one");
    assert_eq!(refused.kind(), "invalid_stream_buffer");

    assert_eq!(host.snapshot(), before, "nothing was written");
    assert_eq!(store.writes(), 0, "nothing reached the store");
}

#[test]
fn a_fresh_host_lets_a_torrent_take_two_gigabytes() {
    assert_eq!(
        host().snapshot().preferences.torrent_cache.megabytes(),
        2000
    );
}

#[test]
fn a_host_starts_from_the_torrent_cache_its_store_holds() {
    let mut stored = Preferences::new();
    stored.set_torrent_cache(TorrentCache::parse(8000).expect("a cache"));
    let host = host_over(Arc::new(InMemoryStore::holding(stored)));

    assert_eq!(host.snapshot().preferences.torrent_cache.megabytes(), 8000);
}

#[test]
fn choosing_a_torrent_cache_publishes_a_snapshot_that_carries_it() {
    let mut host = host();

    let published = host
        .dispatch(action(r#"{"type":"set_torrent_cache","megabytes":8000}"#))
        .expect("a cache should be taken")
        .snapshots;

    assert_eq!(published.len(), 1, "one change publishes one Snapshot");
    assert_eq!(published[0].preferences.torrent_cache.megabytes(), 8000);
    assert_eq!(host.snapshot().preferences.torrent_cache.megabytes(), 8000);
    assert_eq!(
        host.snapshot().preferences.stream_buffer.megabytes(),
        512,
        "the Stream buffer is not moved by it"
    );
}

#[test]
fn a_torrent_cache_the_host_refuses_leaves_the_state_and_the_store_alone() {
    let store = Arc::new(CountingStore::default());
    let mut host = host_over(store.clone());
    let before = host.snapshot();

    for megabytes in [0, 255, 32001] {
        let refused = host
            .dispatch(action(&format!(
                r#"{{"type":"set_torrent_cache","megabytes":{megabytes}}}"#
            )))
            .expect_err("a size outside 256 to 32000 is not a cache");
        assert_eq!(refused.kind(), "invalid_torrent_cache");
    }

    assert_eq!(host.snapshot(), before, "nothing was written");
    assert_eq!(store.writes(), 0, "nothing reached the store");
}

#[test]
fn an_unknown_action_is_rejected_and_leaves_the_state_exactly_as_it_was() {
    let mut host = host();
    set_subtitle_languages(&mut host, &["pt-BR"]);
    let before = host.snapshot();

    let rejected = Action::parse(&format!(
        r#"{{"version":{ACTION_VERSION},"action":{{"type":"offer_to_mow_the_lawn"}}}}"#
    ));

    assert!(matches!(rejected, Err(ActionError::Malformed { .. })));
    assert_eq!(host.snapshot(), before);
}

#[test]
fn an_action_from_a_version_the_host_does_not_speak_is_rejected_before_its_shape_is_judged() {
    let foreign =
        action_in_a_foreign_version(2, r#"{"type":"something_this_host_has_never_heard_of"}"#);

    let rejected = Action::parse(&foreign);

    assert_eq!(
        rejected,
        Err(ActionError::UnsupportedVersion {
            got: 2,
            supported: ACTION_VERSION,
        })
    );
}

#[test]
fn a_version_far_beyond_this_host_is_reported_as_it_was_sent() {
    let foreign = action_in_a_foreign_version(
        70_000,
        r#"{"type":"set_subtitle_languages","languages":[]}"#,
    );

    let rejected = Action::parse(&foreign);

    assert_eq!(
        rejected,
        Err(ActionError::UnsupportedVersion {
            got: 70_000,
            supported: ACTION_VERSION,
        })
    );
}

#[test]
fn a_version_that_is_not_a_version_is_rejected() {
    for not_a_version in [r#""1""#, "1.5", "-1", "null", "70000000000000000000000"] {
        let envelope = format!(
            r#"{{"version":{not_a_version},"action":{{"type":"set_audio_languages","languages":[]}}}}"#
        );

        assert!(
            matches!(Action::parse(&envelope), Err(ActionError::Malformed { .. })),
            "a version of {not_a_version} is not a version"
        );
    }
}

#[test]
fn an_envelope_without_a_version_is_rejected() {
    let rejected = Action::parse(r#"{"action":{"type":"set_audio_languages","languages":[]}}"#);

    assert!(matches!(rejected, Err(ActionError::Malformed { .. })));
}

#[test]
fn an_action_that_is_not_an_action_at_all_is_rejected() {
    for not_an_envelope in [
        r#"{"version":1}"#,
        r#"{"version":1,"action":"set_subtitle_languages"}"#,
        r#"{"version":1,"action":{"type":"set_subtitle_languages"}}"#,
        r#"{"version":1,"action":{"type":"set_audio_languages","languages":"en"}}"#,
        r#""an action""#,
        r#"not json at all"#,
    ] {
        assert!(
            Action::parse(not_an_envelope).is_err(),
            "{not_an_envelope} is not an Action"
        );
    }
}

#[test]
fn the_single_language_actions_are_refused_as_unknown() {
    // Removed with no alias (ADR-0041): an old client gets the codec's ordinary
    // refusal for an Action it does not know.
    for old in [
        r#"{"version":1,"action":{"type":"set_subtitle_language","language":"pt-BR"}}"#,
        r#"{"version":1,"action":{"type":"clear_subtitle_language"}}"#,
    ] {
        assert!(
            matches!(Action::parse(old), Err(ActionError::Malformed { .. })),
            "{old} is no longer an Action"
        );
    }
}

#[test]
fn a_language_list_that_is_not_one_is_refused_and_changes_nothing() {
    let mut host = host();
    set_audio_languages(&mut host, &["en"]);
    let before = host.snapshot();

    for (languages, kind) in [
        (&["en", "pt-BR", "fr", "de"][..], "too_many_languages"),
        (&["pt-BR", "PT-br"][..], "duplicate_language"),
        (&["en", "not a tag"][..], "invalid_language"),
    ] {
        for kind_of_action in ["set_subtitle_languages", "set_audio_languages"] {
            let refused = host
                .dispatch(action(
                    &serde_json::json!({"type": kind_of_action, "languages": languages})
                        .to_string(),
                ))
                .expect_err("that is not a language list");

            assert_eq!(refused.kind(), kind, "{kind_of_action} {languages:?}");
        }
    }
    assert_eq!(host.snapshot(), before, "a rejected Action changes nothing");
}

#[test]
fn a_subtitle_language_that_is_not_a_language_tag_is_rejected() {
    let mut host = host();
    let before = host.snapshot();

    let rejected = host.dispatch(action(
        r#"{"type":"set_subtitle_languages","languages":["Brazilian Portuguese"]}"#,
    ));

    let refused = rejected.expect_err("a bad tag is refused");
    assert_eq!(refused.kind(), "invalid_language");
    assert_eq!(
        refused,
        ActionError::InvalidLanguage(host_core::InvalidLanguage {
            language: "Brazilian Portuguese".to_owned(),
        })
    );
    assert_eq!(host.snapshot(), before, "a rejected Action changes nothing");
}

#[test]
fn the_host_writes_a_persisted_preference_through_the_store() {
    let store = Arc::new(InMemoryStore::new());
    let mut host = host_over(store.clone());

    set_subtitle_languages(&mut host, &["pt-BR"]);

    assert_eq!(
        store
            .persisted()
            .subtitle_languages()
            .iter()
            .map(Language::as_str)
            .collect::<Vec<_>>(),
        ["pt-BR"]
    );
    set_audio_languages(&mut host, &["en", "fr"]);
    assert_eq!(
        store
            .persisted()
            .audio_languages()
            .iter()
            .map(Language::as_str)
            .collect::<Vec<_>>(),
        ["en", "fr"]
    );
}

#[test]
fn a_rejected_action_never_reaches_the_store() {
    let store = Arc::new(CountingStore::default());
    let mut host = host_over(store.clone());

    assert!(host
        .dispatch(action(
            r#"{"type":"set_subtitle_languages","languages":["not a tag"]}"#
        ))
        .is_err());
    assert!(Action::parse(r#"{"version":1,"action":{"type":"nope"}}"#).is_err());

    assert_eq!(store.writes(), 0, "nothing was written");
}

#[test]
fn a_store_that_cannot_write_leaves_the_state_alone() {
    let store = Arc::new(InMemoryStore::new());
    let mut host = host_over(store.clone());
    set_subtitle_languages(&mut host, &["pt-BR"]);
    let before = host.snapshot();
    store.failing_writes();

    let refused = host.dispatch(action(
        r#"{"type":"set_subtitle_languages","languages":["en"]}"#,
    ));

    assert!(
        matches!(refused, Err(ActionError::Store { .. })),
        "a store that refuses the write is reported as a store failure: {refused:?}"
    );
    assert_eq!(
        host.snapshot(),
        before,
        "state the store did not accept is not state the Host holds"
    );
}

#[test]
fn the_snapshot_declares_only_fields_it_can_safely_carry() {
    let mut host = host();
    set_subtitle_languages(&mut host, &["pt-BR"]);

    let snapshot = host.snapshot();
    let published = serde_json::to_value(&snapshot).expect("a Snapshot serializes");

    assert_eq!(
        published,
        serde_json::json!({
            "revision": 1,
            "playback": {
                "state": "idle",
                "picture": "in_window",
                "failure": serde_json::Value::Null,
                "nowPlaying": serde_json::Value::Null,
                "episode": serde_json::Value::Null,
                "position": serde_json::Value::Null,
                "duration": serde_json::Value::Null,
                "buffered": serde_json::Value::Null,
                "stalled": false,
                "torrent": serde_json::Value::Null,
                "tracks": [],
                "chapters": [],
                "chapter": serde_json::Value::Null,
                "speed": serde_json::Value::Null,
                "volume": serde_json::Value::Null,
                "muted": serde_json::Value::Null,
                "subtitleDelay": serde_json::Value::Null,
                "crop": serde_json::Value::Null,
                "aspect": serde_json::Value::Null,
                "resolution": serde_json::Value::Null,
                "statistics": serde_json::Value::Null,
                "autoplay": serde_json::Value::Null,
            },
            "preferences": {
                "subtitleLanguages": ["pt-BR"],
                "audioLanguages": [],
                "subtitleColor": "#FFFFFF",
                "subtitleScale": 1.0,
                "streamBuffer": { "seconds": 300, "megabytes": 512 },
                "torrentCache": { "megabytes": 2000 },
                "upNextPlayback": "direct",
                "autoplay": true,
            },
            "addons": [],
            "featuredCatalog": serde_json::Value::Null,
            "protection": { "backend": "keyring", "tmdbHeld": false, "stremioHeld": false },
            "continueWatching": [],
            "watchProgress": [],
            // A freshly opened Host has no devices but the one it has always had
            // — nobody — and the code it is showing. The code is drawn, so it is
            // pinned here to the one the Host drew rather than to a literal.
            "devices": [],
            "pairingCode": snapshot.pairing_code.as_str(),
            "address": serde_json::Value::Null,
        }),
        "the wire shape is the declared one, camelCased for a JavaScript client"
    );
}

#[test]
fn no_field_a_snapshot_carries_could_hold_a_credential() {
    // Ahead of the Addon, then the Addon: every field a Snapshot can carry is in
    // this walk, including the ones an Addon brought with it.
    let url = "https://api.stremboxd.com/manifest.json";
    let fetcher =
        FixtureFetcher::new().serving(url, include_str!("fixtures/stremboxd-manifest.json"));
    let fetcher = Arc::new(fetcher);
    let provider = Arc::new(AddonProvider::new(fetcher.clone()));
    let mut host = Host::new(
        Arc::new(InMemoryStore::new()),
        fetcher,
        secrets(),
        provider,
        player(),
        clock(),
    )
    .expect("a Host over a store starts");
    host.dispatch(action(&format!(r#"{{"type":"add_addon","url":"{url}"}}"#)))
        .expect("adding the recorded Addon should work");
    set_subtitle_languages(&mut host, &["pt-BR"]);

    let published = serde_json::to_value(host.snapshot()).expect("a Snapshot serializes");
    let credentialish = [
        "key",
        "token",
        "secret",
        "password",
        "credential",
        "auth",
        "url",
    ];

    fn field_names(value: &serde_json::Value, into: &mut Vec<String>) {
        match value {
            serde_json::Value::Object(fields) => {
                for (name, field) in fields {
                    into.push(name.to_lowercase());
                    field_names(field, into);
                }
            }
            serde_json::Value::Array(items) => {
                for item in items {
                    field_names(item, into);
                }
            }
            _ => {}
        }
    }

    let mut names = Vec::new();
    field_names(&published, &mut names);

    for name in names {
        assert!(
            !credentialish.iter().any(|word| name.contains(word)),
            "a Snapshot field named {name:?} is where a credential would end up living"
        );
    }
}

/// A store that remembers how often it was written to.
#[derive(Default)]
struct CountingStore {
    inner: InMemoryStore,
    writes: AtomicUsize,
}

impl CountingStore {
    fn writes(&self) -> usize {
        self.writes.load(Ordering::SeqCst)
    }
}

impl Store for CountingStore {
    fn read_preferences(&self) -> Result<Preferences, StoreError> {
        self.inner.read_preferences()
    }

    fn write_preferences(&self, preferences: &Preferences) -> Result<(), StoreError> {
        self.writes.fetch_add(1, Ordering::SeqCst);
        self.inner.write_preferences(preferences)
    }

    fn read_addons(&self) -> Result<Vec<host_core::Addon>, StoreError> {
        self.inner.read_addons()
    }

    fn write_addons(&self, addons: &[host_core::Addon]) -> Result<(), StoreError> {
        self.writes.fetch_add(1, Ordering::SeqCst);
        self.inner.write_addons(addons)
    }

    fn read_watch_progress(&self) -> Result<Vec<host_core::WatchProgress>, StoreError> {
        self.inner.read_watch_progress()
    }

    fn write_watch_progress(&self, progress: &host_core::WatchProgress) -> Result<(), StoreError> {
        self.writes.fetch_add(1, Ordering::SeqCst);
        self.inner.write_watch_progress(progress)
    }

    fn read_titles(&self) -> Result<Vec<host_core::CachedTitle>, StoreError> {
        self.inner.read_titles()
    }

    fn write_title(&self, title: &host_core::CachedTitle) -> Result<(), StoreError> {
        self.inner.write_title(title)
    }

    fn remove_title(&self, key: &host_core::TitleKey) -> Result<(), StoreError> {
        self.inner.remove_title(key)
    }

    fn read_devices(&self) -> Result<Vec<host_core::Device>, StoreError> {
        self.inner.read_devices()
    }

    fn write_device(&self, device: &host_core::Device) -> Result<(), StoreError> {
        self.writes.fetch_add(1, Ordering::SeqCst);
        self.inner.write_device(device)
    }

    fn remove_device(&self, id: &host_core::DeviceId) -> Result<(), StoreError> {
        self.writes.fetch_add(1, Ordering::SeqCst);
        self.inner.remove_device(id)
    }
}
