//! Optional Stremio account sync (#30), driven the way a client drives it. The
//! account is `FixtureStremio`; nothing here reaches a network.

use std::sync::Arc;

use host_core::{
    Action, ActionError, CredentialKind, FixtureClock, FixtureFetcher, FixturePlayer,
    FixtureProvider, FixtureStremio, Host, InMemorySecretStore, InMemoryStore, Observation,
    Playback, RemoteItem, SecretBackend, Store, Stream, WatchedField, ACTION_VERSION,
};
use serde_json::{json, Value};

const SERIES: &str = "https://series.example.org/manifest.json";
const SERIES_ID: &str = "org.example.series";
const META_URL: &str = "https://series.example.org/meta/series/tt0903747.json";
const SERIES_META: &str = include_str!("fixtures/cinemeta-meta-series.json");
const EPISODE: &str = "https://stream.example.org/v/tt0903747.mkv";

/// 2020-01-01T00:00:00.000Z — the account's write time in these tests.
const REMOTE_AT: i64 = 1_577_836_800_000;
const REMOTE_ISO: &str = "2020-01-01T00:00:00.000Z";
const OLDER: i64 = REMOTE_AT - 1_000_000;
const NEWER: i64 = REMOTE_AT + 1_000_000;

fn order() -> Vec<String> {
    ["0:1", "1:1", "1:2", "1:3", "2:1"]
        .iter()
        .map(|n| format!("tt0903747:{n}"))
        .collect()
}

fn action(body: &Value) -> Action {
    let envelope = format!(r#"{{"version":{ACTION_VERSION},"action":{body}}}"#);
    Action::parse(&envelope).unwrap_or_else(|error| panic!("{envelope}: {error}"))
}

/// The `kind` a refusal travels as — what the window's `HOST_ERROR_KINDS` lists
/// and its `explain` reads, so a rename here that no one mirrors there is a
/// refusal a person reads as the wrong sentence.
fn wire_kind(error: ActionError) -> Value {
    serde_json::to_value(&error).expect("an ActionError serializes")["kind"].clone()
}

struct Fixture {
    host: Host,
    player: Arc<FixturePlayer>,
    clock: Arc<FixtureClock>,
    secrets: Arc<InMemorySecretStore>,
    stremio: Arc<FixtureStremio>,
}

fn fixture(stremio: FixtureStremio, at: i64) -> Fixture {
    let player = Arc::new(FixturePlayer::new());
    let clock = Arc::new(FixtureClock::new().at(at));
    let secrets = Arc::new(InMemorySecretStore::backed_by(SecretBackend::Keyring));
    let stremio = Arc::new(stremio);
    let manifest = format!(
        r#"{{"id":"{SERIES_ID}","name":"Series","version":"1.0.0",
             "resources":["meta","stream"],"types":["movie","series"],"catalogs":[]}}"#
    );
    let mut host = Host::new(
        Arc::new(InMemoryStore::new()) as Arc<dyn Store>,
        Arc::new(
            FixtureFetcher::new()
                .serving(SERIES, manifest)
                .serving(META_URL, SERIES_META),
        ),
        secrets.clone(),
        Arc::new(FixtureProvider::new().offering(
            SERIES_ID,
            vec![Stream {
                name: None,
                description: None,
                playback: Playback::Direct {
                    url: EPISODE.to_owned(),
                },
                warnings: Vec::new(),
                filename: None,
                binge_group: None,
            }],
        )),
        player.clone(),
        clock.clone(),
    )
    .expect("a Host starts")
    .with_stremio(stremio.clone());
    host.dispatch(action(&json!({ "type": "add_addon", "url": SERIES })))
        .expect("configuring the Addon");

    Fixture {
        host,
        player,
        clock,
        secrets,
        stremio,
    }
}

fn sign_in(fixture: &mut Fixture) -> Result<(), ActionError> {
    fixture
        .host
        .dispatch(action(&json!({
            "type": "sign_in_stremio", "email": "me@example.org", "password": "hunter2"
        })))
        .map(|_| ())
}

fn account() -> FixtureStremio {
    FixtureStremio::new().with_account("me@example.org", "hunter2", "AUTHKEY")
}

fn play(fixture: &mut Fixture, video: &str) {
    fixture
        .host
        .dispatch(action(&json!({
            "type": "play_stream",
            "video": { "type": "series", "id": video },
            "addon": SERIES_ID,
            "title": { "addon": SERIES_ID, "id": "tt0903747", "type": "series",
                       "name": "Breaking Bad", "poster": null },
            "stream": { "name": "1080p",
                        "playback": { "kind": "direct", "url": EPISODE }, "warnings": [] },
        })))
        .expect("playing");
}

fn watching(fixture: &mut Fixture, position: f64, at: i64) {
    fixture
        .player
        .now_reporting(Observation::playing(position, 2820.0));
    fixture.clock.set(at);
    fixture.host.sample().expect("a new report");
}

fn remote(video: &str, offset_ms: i64, watched: &[usize]) -> Value {
    let flags: Vec<bool> = (0..5).map(|i| watched.contains(&i)).collect();
    json!({
        "_id": "tt0903747", "name": "Breaking Bad", "type": "series",
        "removed": false, "temp": false, "_mtime": REMOTE_ISO,
        "state": { "video_id": video, "timeOffset": offset_ms, "duration": 2_820_000,
                   "watched": WatchedField::from_flags(&flags, &order()).encode() }
    })
}

fn position(host: &Host, video: &str) -> Option<f64> {
    host.snapshot()
        .watch_progress
        .iter()
        .find(|entry| entry.video.id == video)
        .and_then(|entry| entry.position)
}

fn pause(fixture: &mut Fixture) {
    fixture
        .host
        .dispatch(action(&json!({ "type": "set_paused", "paused": true })))
        .expect("pausing");
}

fn held(fixture: &Fixture) -> RemoteItem {
    let item = fixture
        .stremio
        .stored()
        .into_iter()
        .next()
        .expect("an item");
    RemoteItem::parse(item).expect("a library item")
}

#[test]
fn with_sync_off_the_host_works_and_asks_stremio_nothing() {
    let mut f = fixture(account(), OLDER);

    play(&mut f, "tt0903747:1:2");
    watching(&mut f, 400.0, OLDER + 10_000);
    pause(&mut f);
    f.host
        .dispatch(action(&json!({ "type": "stop_playback" })))
        .expect("stopping");
    f.host.shutdown();
    assert!(f.host.pull_remote().is_none());

    assert_eq!(f.stremio.calls(), Vec::<String>::new());
    assert_eq!(position(&f.host, "tt0903747:1:2"), Some(400.0));
}

#[test]
fn a_host_built_without_sync_refuses_to_sign_in() {
    let mut host = Host::new(
        Arc::new(InMemoryStore::new()),
        Arc::new(FixtureFetcher::new()),
        Arc::new(InMemorySecretStore::new()),
        Arc::new(FixtureProvider::new()),
        Arc::new(FixturePlayer::new()),
        Arc::new(FixtureClock::new()),
    )
    .expect("a Host starts");

    let refused = host.dispatch(action(&json!({
        "type": "sign_in_stremio", "email": "me@example.org", "password": "x"
    })));

    let refused = refused.expect_err("a Host without sync refuses to sign in");
    assert_eq!(refused, ActionError::SyncUnavailable);
    assert_eq!(wire_kind(refused), json!("sync_unavailable"));
}

#[test]
fn signing_in_keeps_the_key_in_the_secret_store_and_no_credential_travels() {
    let mut f = fixture(account(), OLDER);

    let response = f
        .host
        .dispatch(action(&json!({
            "type": "sign_in_stremio", "email": "me@example.org", "password": "hunter2"
        })))
        .expect("signing in");

    assert!(f.secrets.holds(CredentialKind::StremioAuthKey));
    let snapshot = &response.snapshots[0];
    assert!(snapshot.protection.stremio_held);
    let published = serde_json::to_string(snapshot).expect("serializes");
    for secret in ["AUTHKEY", "hunter2"] {
        assert!(!published.contains(secret), "{secret} reached a Snapshot");
        assert!(!format!("{response:?}").contains(secret));
    }
    let action = action(&json!({
        "type": "sign_in_stremio", "email": "me@example.org", "password": "hunter2"
    }));
    assert!(!format!("{action:?}").contains("hunter2"), "Debug leaks it");
}

#[test]
fn a_refused_sign_in_holds_nothing_and_says_why_without_the_password() {
    let mut f = fixture(account(), OLDER);

    let refused = f
        .host
        .dispatch(action(&json!({
            "type": "sign_in_stremio", "email": "me@example.org", "password": "wrong"
        })))
        .unwrap_err();

    assert!(matches!(refused, ActionError::Sync { .. }));
    assert_eq!(wire_kind(refused.clone()), json!("sync"));
    assert!(!refused.to_string().contains("wrong"));
    assert!(!f.secrets.holds(CredentialKind::StremioAuthKey));
    assert!(!f.host.snapshot().protection.stremio_held);
}

#[test]
fn a_sign_in_that_is_not_shaped_like_one_is_refused_before_anything_is_asked() {
    let mut f = fixture(account(), OLDER);

    let refused = f.host.dispatch(action(&json!({
        "type": "sign_in_stremio", "email": "nope", "password": "x"
    })));

    let refused = refused.expect_err("a sign-in that is not shaped like one is refused");
    assert!(matches!(refused, ActionError::InvalidStremioLogin(_)));
    assert_eq!(wire_kind(refused), json!("invalid_stremio_login"));
    assert_eq!(f.stremio.calls(), Vec::<String>::new());
}

#[test]
fn signing_out_takes_the_key_out_and_stops_all_calls() {
    let mut f = fixture(account(), OLDER);
    sign_in(&mut f).expect("signing in");
    let before = f.stremio.calls().len();

    f.host
        .dispatch(action(&json!({ "type": "sign_out_stremio" })))
        .expect("signing out");
    play(&mut f, "tt0903747:1:2");
    pause(&mut f);

    assert!(!f.secrets.holds(CredentialKind::StremioAuthKey));
    assert!(!f.host.snapshot().protection.stremio_held);
    assert_eq!(f.stremio.calls().len(), before);
}

#[test]
fn on_open_remote_progress_newer_than_the_local_record_is_merged_in() {
    let mut f = fixture(
        account().holding(vec![remote("tt0903747:1:2", 900_000, &[])]),
        OLDER,
    );
    play(&mut f, "tt0903747:1:2");
    watching(&mut f, 300.0, OLDER + 10);
    f.host
        .dispatch(action(&json!({ "type": "stop_playback" })))
        .expect("stopping");

    sign_in(&mut f).expect("signing in pulls");

    assert_eq!(position(&f.host, "tt0903747:1:2"), Some(900.0));
}

#[test]
fn synced_watch_progress_groups_into_continue_watching_like_local_progress() {
    // The Host finished 1:1; the account played on to 1:2 afterwards. The pull
    // makes 1:2 the Title's card exactly as a local play would (#273).
    let mut f = fixture(
        account().holding(vec![remote("tt0903747:1:2", 900_000, &[1])]),
        OLDER,
    );
    play(&mut f, "tt0903747:1:1");
    watching(&mut f, 2_810.0, OLDER + 10);
    f.host
        .dispatch(action(&json!({ "type": "stop_playback" })))
        .expect("stopping");

    sign_in(&mut f).expect("signing in pulls");

    let snapshot = f.host.snapshot();
    assert_eq!(
        snapshot.continue_watching.len(),
        1,
        "synced progress is grouped by Title like local progress: {:?}",
        snapshot.continue_watching
    );
    let card = &snapshot.continue_watching[0];
    assert_eq!(card.video.id, "tt0903747:1:2");
    assert_eq!(card.position, Some(900.0));
    assert_eq!(card.duration, Some(2_820.0));
    assert!(
        snapshot.watch_progress.len() >= 2,
        "both Videos keep their Watch progress: {:?}",
        snapshot.watch_progress
    );
}

#[test]
fn on_open_remote_progress_older_than_the_local_record_is_not_taken() {
    let mut f = fixture(
        account().holding(vec![remote("tt0903747:1:2", 900_000, &[])]),
        NEWER,
    );
    play(&mut f, "tt0903747:1:2");
    watching(&mut f, 300.0, NEWER + 10);

    sign_in(&mut f).expect("signing in pulls");

    assert_eq!(position(&f.host, "tt0903747:1:2"), Some(300.0));
}

#[test]
fn on_pause_local_progress_newer_than_the_account_is_pushed() {
    let mut f = fixture(
        account().holding(vec![remote("tt0903747:1:2", 900_000, &[])]),
        NEWER,
    );
    sign_in(&mut f).expect("signing in");
    play(&mut f, "tt0903747:1:2");
    watching(&mut f, 1500.0, NEWER + 10);

    pause(&mut f);

    assert_eq!(held(&f).offset_seconds(), Some(1500.0));
}

#[test]
fn on_stop_and_on_exit_local_progress_is_pushed() {
    let mut f = fixture(account(), NEWER);
    sign_in(&mut f).expect("signing in");
    play(&mut f, "tt0903747:1:2");
    watching(&mut f, 700.0, NEWER + 10);
    f.host
        .dispatch(action(&json!({ "type": "stop_playback" })))
        .expect("stopping");
    assert_eq!(held(&f).offset_seconds(), Some(700.0), "stop pushes");

    play(&mut f, "tt0903747:1:3");
    watching(&mut f, 50.0, NEWER + 20);
    f.host.shutdown();
    assert_eq!(held(&f).video_id(), Some("tt0903747:1:3"), "exit pushes");
}

#[test]
fn the_watched_bitfield_is_merged_not_overwritten_by_a_position() {
    // The account has episode 1:1 watched; the Host finishes 1:3. Both end up
    // watched, and the Host's newer write does not erase the account's.
    let mut f = fixture(
        account().holding(vec![remote("tt0903747:1:1", 0, &[1])]),
        NEWER,
    );
    sign_in(&mut f).expect("signing in");
    play(&mut f, "tt0903747:1:3");
    watching(&mut f, 2810.0, NEWER + 10);

    pause(&mut f);

    let flags = held(&f).watched().expect("a field").resolve(&order());
    assert_eq!(flags, vec![false, true, false, true, false]);
}

#[test]
fn a_stremio_that_is_down_never_stops_playback_or_local_progress() {
    let mut f = fixture(account(), NEWER);
    sign_in(&mut f).expect("signing in");
    f.stremio.failing_library();
    play(&mut f, "tt0903747:1:2");
    watching(&mut f, 400.0, NEWER + 10);

    pause(&mut f);
    f.host.shutdown();
    assert!(f.host.pull_remote().is_none());

    assert_eq!(position(&f.host, "tt0903747:1:2"), Some(400.0));
}
