//! The door, driven the way its two clients drive it: questions on several
//! threads and changes beside them.
//!
//! Every fetch is a gate rather than a sleep, so "two questions overlap" and "a
//! question finishes while a change holds the lock" are facts the test waits for
//! rather than timings it hopes for. The one timing in the file is the ignored
//! measurement at the bottom, which is not run by CI.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use host_core::{
    Action, Addon, AddonProvider, DeviceToken, FetchError, Fetcher, FixtureClock, FixturePlayer,
    Host, HostDoor, InMemorySecretStore, InMemoryStore, Manifest, ManifestUrl, Response,
    ACTION_VERSION,
};

/// How long a test waits for something a correct door reaches in microseconds.
/// It is a failure guard, not an assertion about speed.
const REACHED: Duration = Duration::from_secs(5);

const PAGE: &str = r#"{"metas":[{"id":"tt0133093","type":"movie","name":"The Matrix","genres":[]}],"cacheMaxAge":3600}"#;
const CHANGE_MANIFEST: &str = r#"{"id":"org.example.change","name":"Change","version":"1.0.0","resources":["catalog"],"types":["movie"],"catalogs":[]}"#;

/// A place a fetch parks until the test says otherwise.
///
/// `open_at` is how many fetches must enter before any of them may leave: two
/// for the overlap test, `usize::MAX` for a gate the test opens by hand.
struct Gate {
    state: Mutex<GateState>,
    cv: Condvar,
    what: &'static str,
}

struct GateState {
    entered: usize,
    open: bool,
    open_at: usize,
}

impl Gate {
    fn closed_at(open_at: usize, what: &'static str) -> Arc<Self> {
        Arc::new(Self {
            state: Mutex::new(GateState {
                entered: 0,
                open: false,
                open_at,
            }),
            cv: Condvar::new(),
            what,
        })
    }

    fn manual(what: &'static str) -> Arc<Self> {
        Self::closed_at(usize::MAX, what)
    }

    /// Called inside a fetch: say it arrived, then wait for the gate to open.
    fn enter(&self) {
        let mut state = self.state.lock().expect("the gate is not poisoned");
        state.entered += 1;
        self.cv.notify_all();
        while !state.open && state.entered < state.open_at {
            state = self.cv.wait(state).expect("the gate is not poisoned");
        }
    }

    /// Wait until `count` fetches have entered, or fail rather than hang.
    fn wait_entered(&self, count: usize) {
        let deadline = Instant::now() + REACHED;
        let mut state = self.state.lock().expect("the gate is not poisoned");
        while state.entered < count {
            let now = Instant::now();
            if now >= deadline {
                drop(state);
                self.release();
                panic!(
                    "{} fetch(es) entered {}, not {count}: the door serialized them",
                    state_entered(self),
                    self.what
                );
            }
            let (next, _) = self
                .cv
                .wait_timeout(state, deadline - now)
                .expect("the gate is not poisoned");
            state = next;
        }
    }

    fn release(&self) {
        let mut state = self.state.lock().expect("the gate is not poisoned");
        state.open = true;
        self.cv.notify_all();
    }
}

fn state_entered(gate: &Gate) -> usize {
    gate.state.lock().expect("the gate is not poisoned").entered
}

/// A fetcher whose manifest and catalog answers can each be gated, and which
/// counts the catalog asks so a cache test can see them.
struct TestFetcher {
    manifest_gate: Option<Arc<Gate>>,
    catalog_gate: Option<Arc<Gate>>,
    delay: Option<Duration>,
    catalog_body: String,
    catalogs: AtomicUsize,
}

impl TestFetcher {
    fn new() -> Self {
        Self {
            manifest_gate: None,
            catalog_gate: None,
            delay: None,
            catalog_body: PAGE.to_owned(),
            catalogs: AtomicUsize::new(0),
        }
    }

    fn gating_manifest(mut self, gate: Arc<Gate>) -> Self {
        self.manifest_gate = Some(gate);
        self
    }

    fn gating_catalog(mut self, gate: Arc<Gate>) -> Self {
        self.catalog_gate = Some(gate);
        self
    }

    fn slow(mut self, delay: Duration) -> Self {
        self.delay = Some(delay);
        self
    }

    fn catalogs(&self) -> usize {
        self.catalogs.load(Ordering::SeqCst)
    }
}

impl Fetcher for TestFetcher {
    fn fetch_with_headers(
        &self,
        url: &str,
        _headers: &[(&str, &str)],
    ) -> Result<String, FetchError> {
        if url.ends_with("/manifest.json") {
            if let Some(gate) = &self.manifest_gate {
                gate.enter();
            }
            return Ok(CHANGE_MANIFEST.to_owned());
        }

        self.catalogs.fetch_add(1, Ordering::SeqCst);
        if let Some(delay) = self.delay {
            thread::sleep(delay);
        }
        if let Some(gate) = &self.catalog_gate {
            gate.enter();
        }
        Ok(self.catalog_body.clone())
    }
}

/// One Addon as the store would have read it back, declaring `catalog` for a
/// movie.
fn addon(id: &str, catalog: &str) -> Addon {
    let manifest = serde_json::json!({
        "id": id,
        "name": id,
        "version": "1.0.0",
        "resources": ["catalog"],
        "types": ["movie"],
        "catalogs": [{ "type": "movie", "id": catalog, "name": "Top" }],
    })
    .to_string();

    Addon::new(
        ManifestUrl::parse(&format!("https://{id}/manifest.json"))
            .expect("an Addon id makes a URL"),
        Manifest::parse(&manifest).expect("a manifest"),
    )
}

fn door_with(addons: Vec<Addon>, fetcher: Arc<TestFetcher>) -> Arc<HostDoor> {
    let store = Arc::new(InMemoryStore::new().holding_addons(addons));
    let fetcher: Arc<dyn Fetcher> = fetcher;
    let provider = Arc::new(AddonProvider::new(fetcher.clone()));
    let host = Host::new(
        store,
        fetcher,
        Arc::new(InMemorySecretStore::new()),
        provider,
        Arc::new(FixturePlayer::new()),
        Arc::new(FixtureClock::new()),
    )
    .expect("a Host over in-memory seams starts");

    Arc::new(HostDoor::new(host))
}

fn action(body: serde_json::Value) -> Action {
    let envelope = format!(r#"{{"version":{ACTION_VERSION},"action":{body}}}"#);
    Action::parse(&envelope).unwrap_or_else(|error| panic!("{envelope} should parse: {error}"))
}

fn browse(addon: &str) -> Action {
    action(serde_json::json!({
        "type": "browse_catalog",
        "addon": addon,
        "catalog": { "type": "movie", "id": "top" },
        "extra": [],
    }))
}

fn add_addon(url: &str) -> Action {
    action(serde_json::json!({ "type": "add_addon", "url": url }))
}

fn remove_addon(id: &str) -> Action {
    action(serde_json::json!({ "type": "remove_addon", "id": id }))
}

fn set_subtitle_languages(language: &str) -> Action {
    action(serde_json::json!({ "type": "set_subtitle_languages", "languages": [language] }))
}

#[test]
fn two_questions_are_in_flight_at_once() {
    // The gate opens only when both fetches have entered. A door that held one
    // lock across a question would let the first in and never the second.
    let gate = Gate::closed_at(2, "catalog");
    let fetcher = Arc::new(TestFetcher::new().gating_catalog(gate.clone()));
    let door = door_with(
        vec![
            addon("org.example.one", "top"),
            addon("org.example.two", "top"),
        ],
        fetcher,
    );

    let first = {
        let door = door.clone();
        thread::spawn(move || door.dispatch(browse("org.example.one")))
    };
    let second = {
        let door = door.clone();
        thread::spawn(move || door.dispatch(browse("org.example.two")))
    };

    gate.wait_entered(2);
    gate.release();

    let first = first
        .join()
        .expect("the question thread")
        .expect("an answer");
    let second = second
        .join()
        .expect("the question thread")
        .expect("an answer");

    assert_eq!(
        first.catalogs().expect("a catalog row").len(),
        1,
        "one row for the catalog asked"
    );
    assert_eq!(second.catalogs().expect("a catalog row").len(), 1);
}

#[test]
fn a_question_finishes_while_a_change_holds_the_lock() {
    let catalog = Gate::manual("catalog");
    let manifest = Gate::manual("manifest");
    let fetcher = Arc::new(
        TestFetcher::new()
            .gating_catalog(catalog.clone())
            .gating_manifest(manifest.clone()),
    );
    let door = door_with(vec![addon("org.example.one", "top")], fetcher);

    // The question reaches its fetch, which means it has already cloned its
    // view and released the door's lock.
    let question = {
        let door = door.clone();
        thread::spawn(move || door.dispatch(browse("org.example.one")))
    };
    catalog.wait_entered(1);

    // A change now takes the lock and parks inside its own manifest fetch.
    let change = {
        let door = door.clone();
        thread::spawn(move || door.dispatch(add_addon("https://org.example.change/manifest.json")))
    };
    manifest.wait_entered(1);

    // The question is released and answers while the change is still blocked.
    catalog.release();
    let answered = question
        .join()
        .expect("the question thread")
        .expect("an answer");
    assert_eq!(
        answered.catalogs().expect("a catalog row")[0].name,
        "Top",
        "the question answered from the view it cloned before the change"
    );
    assert!(
        !change.is_finished(),
        "the change is still inside the manifest fetch it holds the lock across"
    );

    manifest.release();
    let changed = change
        .join()
        .expect("the change thread")
        .expect("a Snapshot");
    assert_eq!(
        changed.snapshots.len(),
        1,
        "a change publishes its Snapshot"
    );
    assert!(
        changed.snapshots[0]
            .addons
            .iter()
            .any(|manifest| manifest.id.as_str() == "org.example.change"),
        "the change applied"
    );
}

#[test]
fn a_change_applies_while_a_question_is_blocked_on_a_fetch() {
    let catalog = Gate::manual("catalog");
    let fetcher = Arc::new(TestFetcher::new().gating_catalog(catalog.clone()));
    let door = door_with(vec![addon("org.example.one", "top")], fetcher);

    let question = {
        let door = door.clone();
        thread::spawn(move || door.dispatch(browse("org.example.one")))
    };
    catalog.wait_entered(1);

    let (sent, received) = mpsc::channel();
    let change_door = door.clone();
    thread::spawn(move || {
        let response = change_door.dispatch(set_subtitle_languages("pt-BR"));
        sent.send(response).expect("the test is still listening");
    });

    // The change finishes before the question is released. A door that held the
    // lock across the question's fetch would leave this channel empty until the
    // timeout, and the assertion would fail rather than hang.
    let changed: Result<Response, _> = received
        .recv_timeout(REACHED)
        .expect("a change was blocked behind a question's fetch");
    let changed = changed.expect("the change is taken");
    assert_eq!(
        changed.snapshots[0]
            .preferences
            .subtitle_languages
            .iter()
            .map(host_core::Language::as_str)
            .collect::<Vec<_>>(),
        ["pt-BR"],
        "the change published while the question was still fetching"
    );
    assert!(!question.is_finished(), "the question is still blocked");

    catalog.release();
    question
        .join()
        .expect("the question thread")
        .expect("an answer");
}

#[test]
fn a_question_answers_from_an_addon_removed_mid_flight() {
    // The view is as-of-dispatch: the question froze the Addon list before the
    // removal, so it answers from the Addon it was dispatched against, while the
    // state the next Snapshot is built from no longer has it (ADR-0022).
    let catalog = Gate::manual("catalog");
    let fetcher = Arc::new(TestFetcher::new().gating_catalog(catalog.clone()));
    let door = door_with(vec![addon("org.example.one", "top")], fetcher);

    let question = {
        let door = door.clone();
        thread::spawn(move || door.dispatch(browse("org.example.one")))
    };
    catalog.wait_entered(1);

    // The removal takes the lock and finishes while the question is parked in
    // its fetch. It cannot be waiting on that fetch: the view was frozen and the
    // lock released before the question reached the network.
    let (sent, received) = mpsc::channel();
    let change_door = door.clone();
    thread::spawn(move || {
        let response = change_door.dispatch(remove_addon("org.example.one"));
        sent.send(response).expect("the test is still listening");
    });
    let removed: Result<Response, _> = received
        .recv_timeout(REACHED)
        .expect("the removal was blocked behind a question's fetch");
    removed.expect("the removal is taken");
    assert!(
        door.snapshot().addons.is_empty(),
        "the removed Addon is gone from the state the Snapshot is built from"
    );

    catalog.release();
    let answered = question
        .join()
        .expect("the question thread")
        .expect("the question still answers");
    let rows = answered.catalogs().expect("a catalog row");
    assert_eq!(rows.len(), 1);
    assert_eq!(
        rows[0].addon.as_str(),
        "org.example.one",
        "the question answered from the view it cloned before the removal"
    );
}

#[test]
fn a_question_publishes_nothing_and_moves_no_revision() {
    let door = door_with(
        vec![addon("org.example.one", "top")],
        Arc::new(TestFetcher::new()),
    );
    let before = door.snapshot().revision;

    let response = door
        .dispatch(browse("org.example.one"))
        .expect("the catalog answers");

    assert!(
        response.snapshots.is_empty(),
        "a question is an answer, not a publication"
    );
    assert!(response.answer.is_some());
    assert_eq!(
        door.snapshot().revision,
        before,
        "a question moves no revision"
    );
}

#[test]
fn the_shared_cache_serves_a_second_browse_without_fetching() {
    let fetcher = Arc::new(TestFetcher::new());
    let door = door_with(vec![addon("org.example.one", "top")], fetcher.clone());

    let first = door
        .dispatch(browse("org.example.one"))
        .expect("the first browse answers");
    let second = door
        .dispatch(browse("org.example.one"))
        .expect("the second browse answers");

    assert_eq!(first.answer, second.answer, "the same page, twice");
    assert_eq!(
        fetcher.catalogs(),
        1,
        "the page was fetched once and served from the shared cache after that"
    );
}

#[test]
fn the_doors_beside_the_surface_still_work() {
    let door = door_with(
        vec![addon("org.example.one", "top")],
        Arc::new(TestFetcher::new()),
    );

    assert_eq!(
        door.snapshot().addons[0].id.as_str(),
        "org.example.one",
        "a Snapshot still builds from the whole state"
    );
    assert!(
        door.sample().is_none(),
        "nothing is playing, so the Player reports nothing new"
    );
    assert!(
        door.pull_remote().is_none(),
        "this Host has no Stremio account to pull from"
    );

    door.set_serving("127.0.0.1:8090");
    assert_eq!(
        door.snapshot().address.as_deref(),
        Some("127.0.0.1:8090"),
        "the address the wire server bound travels in the Snapshot"
    );

    let token = DeviceToken::parse(&"a".repeat(43)).expect("43 base64url characters");
    assert!(
        door.device(&token).is_none(),
        "a token this Host never issued names nothing"
    );
    assert!(
        !door.shutdown(),
        "no account was told, because there is none"
    );
}

/// A Host with 16 configured Addons, each declaring one catalog, and a fetcher
/// that takes ~300 ms per catalog URL.
fn sixteen_catalog_profile() -> Arc<HostDoor> {
    let addons: Vec<Addon> = (0..16)
        .map(|index| addon(&format!("org.example.catalog{index}"), "top"))
        .collect();
    let fetcher = Arc::new(TestFetcher::new().slow(Duration::from_millis(300)));
    door_with(addons, fetcher)
}

/// The measurement #111's before/after story is made from: 16 catalogs asked
/// through the door on 16 threads, each fetch costing ~300 ms.
///
/// With the split this is roughly one fetch; with the old one-lock door it is
/// roughly sixteen. It prints and asserts nothing about the clock, and is
/// `#[ignore]` so CI never pays for it.
#[test]
#[ignore = "measurement: 16-catalog profile baseline"]
fn sixteen_catalogs_through_the_door() {
    let door = sixteen_catalog_profile();

    let started = Instant::now();
    let handles: Vec<_> = (0..16)
        .map(|index| {
            let door = door.clone();
            thread::spawn(move || {
                let started = Instant::now();
                let response = door.dispatch(browse(&format!("org.example.catalog{index}")));
                (index, started.elapsed(), response)
            })
        })
        .collect();

    let mut answered = 0;
    for handle in handles {
        let (index, elapsed, response) = handle.join().expect("a catalog thread");
        let response = response.expect("a catalog answer");
        assert_eq!(
            response.catalogs().expect("a catalog row").len(),
            1,
            "one row each"
        );
        println!("catalog {index}: {elapsed:?}");
        answered += 1;
    }
    let elapsed = started.elapsed();

    println!("{answered} catalogs through the door, ~300 ms each: {elapsed:?} wall clock");
}
