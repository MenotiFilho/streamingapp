//! The Host's behaviour, driven the way a client drives it: an Action in,
//! published Snapshots out. Nothing below the Action surface is named here.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use host_core::{
    Action, ActionError, AddonProvider, FixtureClock, FixtureFetcher, FixturePlayer, Host,
    InMemorySecretStore, InMemoryStore, Language, Preferences, SecretBackend, Snapshot, Store,
    StoreError, StreamBuffer, SubtitleColor, SubtitleScale, ACTION_VERSION,
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

fn subtitle_language(snapshot: &Snapshot) -> Option<&str> {
    snapshot
        .preferences
        .subtitle_language
        .as_ref()
        .map(Language::as_str)
}

/// The Snapshots an Action published.
fn published(host: &mut Host, action: Action) -> Vec<Snapshot> {
    host.dispatch(action)
        .unwrap_or_else(|error| panic!("the Action should have been taken: {error}"))
        .snapshots
}

fn set_subtitle_language(host: &mut Host, language: &str) -> Vec<Snapshot> {
    published(
        host,
        action(&format!(
            r#"{{"type":"set_subtitle_language","language":"{language}"}}"#
        )),
    )
}

#[test]
fn a_fresh_host_has_no_subtitle_language() {
    let snapshot = host().snapshot();

    assert_eq!(snapshot.revision, 0);
    assert_eq!(subtitle_language(&snapshot), None);
}

#[test]
fn a_host_starts_from_the_preferences_its_store_holds() {
    let stored = Preferences::with_subtitle_language(Some(
        Language::parse("pt-BR").expect("pt-BR is a language tag"),
    ));
    let store = Arc::new(InMemoryStore::holding(stored));
    let host = host_over(store);

    assert_eq!(subtitle_language(&host.snapshot()), Some("pt-BR"));
}

#[test]
fn choosing_a_subtitle_language_publishes_a_snapshot_that_carries_it() {
    let mut host = host();

    let published = set_subtitle_language(&mut host, "pt-BR");

    assert_eq!(published.len(), 1, "one change publishes one Snapshot");
    assert_eq!(subtitle_language(&published[0]), Some("pt-BR"));
    assert_eq!(subtitle_language(&host.snapshot()), Some("pt-BR"));
}

#[test]
fn clearing_the_subtitle_language_publishes_a_snapshot_without_one() {
    let mut host = host();
    set_subtitle_language(&mut host, "pt-BR");

    let published = host
        .dispatch(action(r#"{"type":"clear_subtitle_language"}"#))
        .expect("clearing the subtitle language should work")
        .snapshots;

    assert_eq!(subtitle_language(&published[0]), None);
}

#[test]
fn changing_a_preference_twice_publishes_a_snapshot_each_time_and_moves_the_revision_on() {
    let mut host = host();

    let first = set_subtitle_language(&mut host, "pt-BR");
    let second = set_subtitle_language(&mut host, "en");

    assert_eq!(first[0].revision, 1);
    assert_eq!(second[0].revision, 2);
    assert_eq!(subtitle_language(&second[0]), Some("en"));
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

    let published = host
        .dispatch(action(r#"{"type":"set_subtitle_scale","scale":1.5}"#))
        .expect("a size should be taken")
        .snapshots;

    assert_eq!(published.len(), 1, "one change publishes one Snapshot");
    assert_eq!(published[0].preferences.subtitle_scale.value(), 1.5);
    assert_eq!(host.snapshot().preferences.subtitle_scale.value(), 1.5);
}

#[test]
fn an_appearance_the_host_refuses_leaves_the_state_and_the_store_alone() {
    let store = Arc::new(CountingStore::default());
    let mut host = host_over(store.clone());
    let before = host.snapshot();

    for body in [
        r##"{"type":"set_subtitle_color","color":"#GGGGGG"}"##,
        r#"{"type":"set_subtitle_scale","scale":2.5}"#,
        r#"{"type":"set_subtitle_scale","scale":0.25}"#,
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
fn an_unknown_action_is_rejected_and_leaves_the_state_exactly_as_it_was() {
    let mut host = host();
    set_subtitle_language(&mut host, "pt-BR");
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
    let foreign = action_in_a_foreign_version(70_000, r#"{"type":"clear_subtitle_language"}"#);

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
            r#"{{"version":{not_a_version},"action":{{"type":"clear_subtitle_language"}}}}"#
        );

        assert!(
            matches!(Action::parse(&envelope), Err(ActionError::Malformed { .. })),
            "a version of {not_a_version} is not a version"
        );
    }
}

#[test]
fn an_envelope_without_a_version_is_rejected() {
    let rejected = Action::parse(r#"{"action":{"type":"clear_subtitle_language"}}"#);

    assert!(matches!(rejected, Err(ActionError::Malformed { .. })));
}

#[test]
fn an_action_that_is_not_an_action_at_all_is_rejected() {
    for not_an_envelope in [
        r#"{"version":1}"#,
        r#"{"version":1,"action":"clear_subtitle_language"}"#,
        r#"{"version":1,"action":{"type":"set_subtitle_language"}}"#,
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
fn a_subtitle_language_that_is_not_a_language_tag_is_rejected() {
    let mut host = host();
    let before = host.snapshot();

    let rejected = host.dispatch(action(
        r#"{"type":"set_subtitle_language","language":"Brazilian Portuguese"}"#,
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

    set_subtitle_language(&mut host, "pt-BR");

    assert_eq!(
        store.persisted().subtitle_language().map(Language::as_str),
        Some("pt-BR")
    );
}

#[test]
fn a_rejected_action_never_reaches_the_store() {
    let store = Arc::new(CountingStore::default());
    let mut host = host_over(store.clone());

    assert!(host
        .dispatch(action(
            r#"{"type":"set_subtitle_language","language":"not a tag"}"#
        ))
        .is_err());
    assert!(Action::parse(r#"{"version":1,"action":{"type":"nope"}}"#).is_err());

    assert_eq!(store.writes(), 0, "nothing was written");
}

#[test]
fn a_store_that_cannot_write_leaves_the_state_alone() {
    let store = Arc::new(InMemoryStore::new());
    let mut host = host_over(store.clone());
    set_subtitle_language(&mut host, "pt-BR");
    let before = host.snapshot();
    store.failing_writes();

    let refused = host.dispatch(action(
        r#"{"type":"set_subtitle_language","language":"en"}"#,
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
    set_subtitle_language(&mut host, "pt-BR");

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
                "subtitleLanguage": "pt-BR",
                "subtitleColor": "#FFFFFF",
                "subtitleScale": 1.0,
                "streamBuffer": { "seconds": 300, "megabytes": 512 },
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
    set_subtitle_language(&mut host, "pt-BR");

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
