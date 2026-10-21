//! The two questions that ask several Addons inside one Action: the asks overlap,
//! no more than eight are in flight, and the Answer is in configured order however
//! the asks finish (ADR-0023).
//!
//! Every gate here is a condvar the test waits on, never a sleep used as
//! synchronization: a fan-out that serialized its asks trips the gate's timeout
//! and fails the assertion rather than hanging the suite. The one short wait that
//! is a timing rather than a gate — waiting to see whether a ninth ask arrives —
//! is named and bounded where it is used.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use host_core::{
    Action, ActionError, Addon, AddonProvider, AddonStreams, FetchError, Fetcher, FixtureClock,
    FixtureFetcher, FixturePlayer, FixtureProvider, Host, InMemorySecretStore, InMemoryStore,
    Playback, Provider, ResourceRequest, Response, Store, Stream, Subtitle, ACTION_VERSION,
};

/// The fan-out bound ADR-0023 records.
const CAP: usize = 8;

/// How long a test waits for something a correct fan-out reaches in microseconds.
/// It is a failure guard, not an assertion about speed.
const REACHED: Duration = Duration::from_secs(5);

/// How long the cap tests watch for an ask beyond the bound. An unbounded fan-out
/// spawns the ninth thread at once, so this is long enough to see it and short
/// enough not to slow a passing suite.
const SETTLED: Duration = Duration::from_millis(250);

// --- the Action surface ------------------------------------------------------

fn action(body: &serde_json::Value) -> Action {
    let envelope = format!(r#"{{"version":{ACTION_VERSION},"action":{body}}}"#);
    Action::parse(&envelope).unwrap_or_else(|error| panic!("{envelope} should parse: {error}"))
}

fn find() -> Action {
    action(&serde_json::json!({
        "type": "find_streams",
        "video": { "type": "movie", "id": "tt0133093" },
    }))
}

fn search(query: &str) -> Action {
    action(&serde_json::json!({ "type": "search_catalogs", "query": query }))
}

fn streams(response: &Response) -> &[AddonStreams] {
    response.streams().unwrap_or_else(|| {
        panic!("an Action that asked for Streams answers with them: {response:?}")
    })
}

fn rows(response: &Response) -> &[host_core::CatalogRow] {
    response.catalogs().unwrap_or_else(|| {
        panic!("an Action that asked for catalogs answers with rows: {response:?}")
    })
}

fn configure(host: &mut Host, url: &str) {
    host.dispatch(action(
        &serde_json::json!({ "type": "add_addon", "url": url }),
    ))
    .unwrap_or_else(|error| panic!("configuring {url} should work: {error}"));
}

fn host_over(fetcher: Arc<dyn Fetcher>, provider: Arc<dyn Provider>) -> Host {
    Host::new(
        Arc::new(InMemoryStore::new()) as Arc<dyn Store>,
        fetcher,
        Arc::new(InMemorySecretStore::new()),
        provider,
        Arc::new(FixturePlayer::new()),
        Arc::new(FixtureClock::new()),
    )
    .expect("a Host over a store starts")
}

// --- the Addons these tests build --------------------------------------------

fn addon_id(index: usize) -> String {
    format!("org.example.{index}")
}

fn manifest_url(index: usize) -> String {
    format!("https://addon{index}.example.com/manifest.json")
}

fn catalog_url(index: usize) -> String {
    format!("https://addon{index}.example.com/catalog/movie/top/search=matrix.json")
}

fn stream_manifest(index: usize) -> String {
    serde_json::json!({
        "id": addon_id(index),
        "name": addon_id(index),
        "version": "1.0.0",
        "resources": ["stream"],
        "types": ["movie"],
        "catalogs": [],
    })
    .to_string()
}

fn searchable_manifest(index: usize) -> String {
    serde_json::json!({
        "id": addon_id(index),
        "name": addon_id(index),
        "version": "1.0.0",
        "resources": ["catalog"],
        "types": ["movie"],
        "catalogs": [{
            "type": "movie",
            "id": "top",
            "name": "Top",
            "extra": [{ "name": "search" }],
        }],
    })
    .to_string()
}

fn page(index: usize) -> String {
    serde_json::json!({
        "metas": [{
            "id": format!("tt{}", index + 1),
            "type": "movie",
            "name": format!("Row {index}"),
        }],
    })
    .to_string()
}

/// A candidate a gated Provider hands out, named after its Addon so a group's
/// ownership is visible.
fn candidate(addon: &str) -> Stream {
    Stream {
        name: Some(addon.to_owned()),
        description: None,
        playback: Playback::Direct {
            url: format!("https://stream.example.org/{addon}.mkv"),
        },
        warnings: Vec::new(),
        filename: None,
        binge_group: None,
    }
}

// --- the gates ---------------------------------------------------------------

/// A gate every ask parks on until the test opens it, counting how many are
/// inside at once.
///
/// `peak` is the evidence for the bound; `completed` lets a test wait for a
/// chunk to finish; `timed_out` is the guard that turns an ask left parked by a
/// serialized fan-out into a failed assertion instead of a hung suite.
struct HoldGate {
    state: Mutex<HoldState>,
    cv: Condvar,
}

#[derive(Default)]
struct HoldState {
    arrived: usize,
    in_flight: usize,
    peak: usize,
    completed: usize,
    open: bool,
    timed_out: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Counts {
    arrived: usize,
    peak: usize,
    completed: usize,
    timed_out: bool,
}

impl HoldGate {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            state: Mutex::new(HoldState::default()),
            cv: Condvar::new(),
        })
    }

    /// Called inside an ask: say it arrived, then wait for the test to open the
    /// gate. On a timeout it opens the gate itself, so a failure is an assertion
    /// rather than a deadlock.
    fn enter(&self) {
        let mut state = self.state.lock().expect("the gate is not poisoned");
        state.arrived += 1;
        state.in_flight += 1;
        state.peak = state.peak.max(state.in_flight);
        self.cv.notify_all();

        let deadline = Instant::now() + REACHED;
        while !state.open {
            let now = Instant::now();
            if now >= deadline {
                state.timed_out = true;
                state.open = true;
                self.cv.notify_all();
                break;
            }
            let (next, _) = self
                .cv
                .wait_timeout(state, deadline - now)
                .expect("the gate is not poisoned");
            state = next;
        }

        state.in_flight -= 1;
        state.completed += 1;
        self.cv.notify_all();
    }

    fn open(&self) {
        let mut state = self.state.lock().expect("the gate is not poisoned");
        state.open = true;
        self.cv.notify_all();
    }

    /// Wait until `predicate` holds, or the timeout passes.
    fn wait_until(&self, predicate: impl Fn(&HoldState) -> bool, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        let mut state = self.state.lock().expect("the gate is not poisoned");
        while !predicate(&state) {
            let now = Instant::now();
            if now >= deadline {
                return false;
            }
            let (next, _) = self
                .cv
                .wait_timeout(state, deadline - now)
                .expect("the gate is not poisoned");
            state = next;
        }
        true
    }

    fn wait_for_arrivals(&self, count: usize, timeout: Duration) -> bool {
        self.wait_until(|state| state.arrived >= count, timeout)
    }

    fn wait_for_completed(&self, count: usize, timeout: Duration) -> bool {
        self.wait_until(|state| state.completed >= count, timeout)
    }

    fn counts(&self) -> Counts {
        let state = self.state.lock().expect("the gate is not poisoned");
        Counts {
            arrived: state.arrived,
            peak: state.peak,
            completed: state.completed,
            timed_out: state.timed_out,
        }
    }
}

/// A Provider whose `streams` ask parks on the gate.
struct HoldProvider {
    gate: Arc<HoldGate>,
}

impl Provider for HoldProvider {
    fn streams(
        &self,
        addon: &Addon,
        _requested: &ResourceRequest,
    ) -> Result<Vec<Stream>, ActionError> {
        self.gate.enter();
        Ok(vec![candidate(addon.id().as_str())])
    }

    fn subtitles(
        &self,
        _addon: &Addon,
        _requested: &ResourceRequest,
    ) -> Result<Vec<Subtitle>, ActionError> {
        Ok(Vec::new())
    }
}

/// A Fetcher that serves recorded bodies, and parks every ask made while `armed`
/// on the gate. Manifests are configured before arming, so only the fan-out under
/// test is gated.
struct HoldFetcher {
    bodies: HashMap<String, String>,
    gate: Arc<HoldGate>,
    armed: AtomicBool,
}

impl HoldFetcher {
    fn new(bodies: HashMap<String, String>, gate: Arc<HoldGate>) -> Self {
        Self {
            bodies,
            gate,
            armed: AtomicBool::new(false),
        }
    }

    fn arm(&self) {
        self.armed.store(true, Ordering::SeqCst);
    }
}

impl Fetcher for HoldFetcher {
    fn fetch_with_headers(
        &self,
        url: &str,
        _headers: &[(&str, &str)],
    ) -> Result<String, FetchError> {
        if self.armed.load(Ordering::SeqCst) {
            self.gate.enter();
        }
        Ok(self
            .bodies
            .get(url)
            .cloned()
            .unwrap_or_else(|| panic!("no recorded body for {url}")))
    }
}

/// A Provider whose first ask finishes after the others, so completion order is
/// the reverse of the configured order.
struct ReversingProvider {
    completed: Mutex<usize>,
    order: Mutex<Vec<String>>,
    cv: Condvar,
    timed_out: AtomicBool,
}

impl ReversingProvider {
    fn new() -> Self {
        Self {
            completed: Mutex::new(0),
            order: Mutex::new(Vec::new()),
            cv: Condvar::new(),
            timed_out: AtomicBool::new(false),
        }
    }

    fn completion_order(&self) -> Vec<String> {
        self.order
            .lock()
            .expect("the provider is not poisoned")
            .clone()
    }

    fn timed_out(&self) -> bool {
        self.timed_out.load(Ordering::SeqCst)
    }
}

impl Provider for ReversingProvider {
    fn streams(
        &self,
        addon: &Addon,
        _requested: &ResourceRequest,
    ) -> Result<Vec<Stream>, ActionError> {
        // Addon 2 finishes first, then Addon 1, then Addon 0: a completion order
        // that is the reverse of the configured list.
        let waiting_for = match addon.id().as_str() {
            id if id == addon_id(0) => 2,
            id if id == addon_id(1) => 1,
            _ => 0,
        };
        if waiting_for > 0 {
            let deadline = Instant::now() + REACHED;
            let mut completed = self.completed.lock().expect("the provider is not poisoned");
            while *completed < waiting_for {
                let now = Instant::now();
                if now >= deadline {
                    self.timed_out.store(true, Ordering::SeqCst);
                    break;
                }
                let (next, _) = self
                    .cv
                    .wait_timeout(completed, deadline - now)
                    .expect("the provider is not poisoned");
                completed = next;
            }
        }

        {
            let mut completed = self.completed.lock().expect("the provider is not poisoned");
            *completed += 1;
            self.order
                .lock()
                .expect("the provider is not poisoned")
                .push(addon.id().as_str().to_owned());
            self.cv.notify_all();
        }

        Ok(vec![candidate(addon.id().as_str())])
    }

    fn subtitles(
        &self,
        _addon: &Addon,
        _requested: &ResourceRequest,
    ) -> Result<Vec<Subtitle>, ActionError> {
        Ok(Vec::new())
    }
}

/// A Fetcher whose third catalog finishes first, then the second, then the
/// first — the reverse of the configured order.
struct ReversingCatalogFetcher {
    bodies: HashMap<String, String>,
    completed: Mutex<usize>,
    order: Mutex<Vec<String>>,
    cv: Condvar,
    timed_out: AtomicBool,
}

impl ReversingCatalogFetcher {
    fn new(count: usize) -> Self {
        let mut bodies = HashMap::new();
        for index in 0..count {
            bodies.insert(manifest_url(index), searchable_manifest(index));
            bodies.insert(catalog_url(index), page(index));
        }
        Self {
            bodies,
            completed: Mutex::new(0),
            order: Mutex::new(Vec::new()),
            cv: Condvar::new(),
            timed_out: AtomicBool::new(false),
        }
    }

    fn completion_order(&self) -> Vec<String> {
        self.order
            .lock()
            .expect("the fetcher is not poisoned")
            .clone()
    }

    fn timed_out(&self) -> bool {
        self.timed_out.load(Ordering::SeqCst)
    }
}

impl Fetcher for ReversingCatalogFetcher {
    fn fetch_with_headers(
        &self,
        url: &str,
        _headers: &[(&str, &str)],
    ) -> Result<String, FetchError> {
        if url.ends_with("/manifest.json") {
            return Ok(self
                .bodies
                .get(url)
                .cloned()
                .unwrap_or_else(|| panic!("no recorded manifest for {url}")));
        }

        let index = (0..3)
            .find(|at| catalog_url(*at) == url)
            .unwrap_or_else(|| panic!("no recorded catalog for {url}"));
        let waiting_for = match index {
            0 => 2,
            1 => 1,
            _ => 0,
        };
        if waiting_for > 0 {
            let deadline = Instant::now() + REACHED;
            let mut completed = self.completed.lock().expect("the fetcher is not poisoned");
            while *completed < waiting_for {
                let now = Instant::now();
                if now >= deadline {
                    self.timed_out.store(true, Ordering::SeqCst);
                    break;
                }
                let (next, _) = self
                    .cv
                    .wait_timeout(completed, deadline - now)
                    .expect("the fetcher is not poisoned");
                completed = next;
            }
        }

        {
            let mut completed = self.completed.lock().expect("the fetcher is not poisoned");
            *completed += 1;
            self.order
                .lock()
                .expect("the fetcher is not poisoned")
                .push(url.to_owned());
            self.cv.notify_all();
        }

        Ok(self
            .bodies
            .get(url)
            .cloned()
            .unwrap_or_else(|| panic!("no recorded body for {url}")))
    }
}

/// A Provider that panics for one Addon, to prove the fan-out re-raises it on
/// the caller's thread rather than swallowing it in a scoped one.
struct PanickingProvider;

impl Provider for PanickingProvider {
    fn streams(
        &self,
        addon: &Addon,
        _requested: &ResourceRequest,
    ) -> Result<Vec<Stream>, ActionError> {
        if addon.id().as_str() == addon_id(1) {
            panic!("one fake Addon panicked");
        }
        Ok(vec![candidate(addon.id().as_str())])
    }

    fn subtitles(
        &self,
        _addon: &Addon,
        _requested: &ResourceRequest,
    ) -> Result<Vec<Subtitle>, ActionError> {
        Ok(Vec::new())
    }
}

// --- find_streams ------------------------------------------------------------

#[test]
fn find_streams_asks_addons_at_once_and_answers_in_configured_order() {
    let gate = HoldGate::new();
    let provider = Arc::new(HoldProvider { gate: gate.clone() });
    let fetcher = Arc::new(
        FixtureFetcher::new()
            .serving(&manifest_url(0), stream_manifest(0))
            .serving(&manifest_url(1), stream_manifest(1)),
    );
    let mut host = host_over(fetcher, provider);
    configure(&mut host, &manifest_url(0));
    configure(&mut host, &manifest_url(1));

    thread::scope(|scope| {
        let answered = scope.spawn(|| host.dispatch(find()));

        let overlapped = gate.wait_for_arrivals(2, REACHED);
        gate.open();
        assert!(
            overlapped,
            "both Addon asks reached the gate together; a serialized fan-out \
             would leave the second one waiting for the first to finish"
        );

        let response = answered
            .join()
            .expect("the finding thread does not panic")
            .expect("finding Streams is answered");
        let groups = streams(&response);
        assert_eq!(
            groups
                .iter()
                .map(|group| group.addon.as_str())
                .collect::<Vec<_>>(),
            vec![addon_id(0), addon_id(1)],
            "the configured order is the Answer's order, not the asks'"
        );
        assert_eq!(
            groups[0].streams[0].name.as_deref(),
            Some(addon_id(0).as_str())
        );
        assert_eq!(
            groups[1].streams[0].name.as_deref(),
            Some(addon_id(1).as_str())
        );
    });

    assert!(!gate.counts().timed_out);
}

#[test]
fn find_streams_never_has_more_than_eight_addons_in_flight() {
    let gate = HoldGate::new();
    let provider = Arc::new(HoldProvider { gate: gate.clone() });
    let mut fetcher = FixtureFetcher::new();
    for index in 0..16 {
        fetcher = fetcher.serving(&manifest_url(index), stream_manifest(index));
    }
    let mut host = host_over(Arc::new(fetcher), provider);
    for index in 0..16 {
        configure(&mut host, &manifest_url(index));
    }

    thread::scope(|scope| {
        let answered = scope.spawn(|| host.dispatch(find()));

        let eight = gate.wait_for_arrivals(CAP, REACHED);
        // A window, not a sleep as synchronization: the bound is proved if no
        // ninth ask joins the eight the gate is holding.
        let ninth = gate.wait_for_arrivals(CAP + 1, SETTLED);
        let held = gate.counts();
        gate.open();

        assert!(eight, "eight asks are in flight together");
        assert!(
            !ninth,
            "no ninth ask starts while eight are held: {:?}",
            held
        );
        assert_eq!(
            held,
            Counts {
                arrived: CAP,
                peak: CAP,
                completed: 0,
                timed_out: false,
            },
            "the peak in flight is exactly the bound"
        );

        assert!(
            gate.wait_for_completed(16, REACHED),
            "the second chunk runs once the first is joined: {:?}",
            gate.counts()
        );
        let response = answered
            .join()
            .expect("the finding thread does not panic")
            .expect("finding Streams is answered");
        let groups = streams(&response);
        assert_eq!(groups.len(), 16);
        assert_eq!(
            groups
                .iter()
                .map(|group| group.addon.as_str())
                .collect::<Vec<_>>(),
            (0..16).map(addon_id).collect::<Vec<_>>(),
            "every group is in configured order, across both chunks"
        );
        assert_eq!(
            gate.counts(),
            Counts {
                arrived: 16,
                peak: CAP,
                completed: 16,
                timed_out: false,
            }
        );
    });
}

#[test]
fn the_answers_order_stays_configured_order_when_completion_order_reverses() {
    let provider = Arc::new(ReversingProvider::new());
    let fetcher = Arc::new(
        FixtureFetcher::new()
            .serving(&manifest_url(0), stream_manifest(0))
            .serving(&manifest_url(1), stream_manifest(1))
            .serving(&manifest_url(2), stream_manifest(2)),
    );
    let mut host = host_over(fetcher, provider.clone());
    for index in 0..3 {
        configure(&mut host, &manifest_url(index));
    }

    let response = host.dispatch(find()).expect("finding Streams is answered");
    let groups = streams(&response);

    assert!(
        !provider.timed_out(),
        "the first Addon was released by the other two finishing"
    );
    assert_eq!(
        provider.completion_order(),
        vec![addon_id(2), addon_id(1), addon_id(0)],
        "the Addons completed in reverse configured order"
    );
    assert_eq!(
        groups
            .iter()
            .map(|group| group.addon.as_str())
            .collect::<Vec<_>>(),
        vec![addon_id(0), addon_id(1), addon_id(2)],
        "the group list is still configured order, not completion order"
    );
}

#[test]
fn one_addons_failure_is_one_group_and_the_others_still_answer() {
    let fetcher = Arc::new(
        FixtureFetcher::new()
            .serving(&manifest_url(0), stream_manifest(0))
            .serving(&manifest_url(1), stream_manifest(1))
            .serving(&manifest_url(2), stream_manifest(2)),
    );
    let provider = Arc::new(
        FixtureProvider::new()
            .offering(&addon_id(0), vec![candidate("first")])
            .failing(
                &addon_id(1),
                ActionError::Fetch {
                    detail: "the Addon answered with status 503".to_owned(),
                },
            )
            .offering(&addon_id(2), vec![candidate("third")]),
    );
    let mut host = host_over(fetcher, provider);
    for index in 0..3 {
        configure(&mut host, &manifest_url(index));
    }

    let response = host
        .dispatch(find())
        .expect("one Addon being down is not a failed question");
    let groups = streams(&response);

    assert_eq!(groups.len(), 3);
    assert_eq!(groups[0].addon.as_str(), addon_id(0));
    assert_eq!(groups[0].failure, None);
    assert!(matches!(
        &groups[1].failure,
        Some(ActionError::Fetch { detail }) if detail.contains("503")
    ));
    assert!(groups[1].streams.is_empty());
    assert_eq!(groups[2].addon.as_str(), addon_id(2));
    assert_eq!(groups[2].failure, None);
    assert_eq!(
        groups[2]
            .streams
            .iter()
            .filter_map(|stream| stream.name.as_deref())
            .collect::<Vec<_>>(),
        vec!["third"],
        "the Addon after the failure still answered"
    );
}

// --- search_catalogs ---------------------------------------------------------

#[test]
fn search_catalogs_asks_addons_at_once_and_answers_in_configured_order() {
    let gate = HoldGate::new();
    let mut bodies = HashMap::new();
    for index in 0..2 {
        bodies.insert(manifest_url(index), searchable_manifest(index));
        bodies.insert(catalog_url(index), page(index));
    }
    let fetcher = Arc::new(HoldFetcher::new(bodies, gate.clone()));
    let provider = Arc::new(AddonProvider::new(fetcher.clone()));
    let mut host = host_over(fetcher.clone(), provider);
    configure(&mut host, &manifest_url(0));
    configure(&mut host, &manifest_url(1));
    fetcher.arm();

    thread::scope(|scope| {
        let answered = scope.spawn(|| host.dispatch(search("matrix")));

        let overlapped = gate.wait_for_arrivals(2, REACHED);
        gate.open();
        assert!(
            overlapped,
            "both catalog asks reached the gate together; a serialized fan-out \
             would leave the second one waiting for the first to finish"
        );

        let response = answered
            .join()
            .expect("the search thread does not panic")
            .expect("searching is answered");
        let rows = rows(&response);
        assert_eq!(
            rows.iter()
                .map(|row| row.addon.as_str())
                .collect::<Vec<_>>(),
            vec![addon_id(0), addon_id(1)],
            "the configured order is the Answer's order"
        );
        assert_eq!(rows[0].metas[0].name, "Row 0");
        assert_eq!(rows[1].metas[0].name, "Row 1");
    });

    assert!(!gate.counts().timed_out);
}

#[test]
fn search_catalogs_never_has_more_than_eight_catalogs_in_flight() {
    let gate = HoldGate::new();
    let mut bodies = HashMap::new();
    for index in 0..16 {
        bodies.insert(manifest_url(index), searchable_manifest(index));
        bodies.insert(catalog_url(index), page(index));
    }
    let fetcher = Arc::new(HoldFetcher::new(bodies, gate.clone()));
    let provider = Arc::new(AddonProvider::new(fetcher.clone()));
    let mut host = host_over(fetcher.clone(), provider);
    for index in 0..16 {
        configure(&mut host, &manifest_url(index));
    }
    fetcher.arm();

    thread::scope(|scope| {
        let answered = scope.spawn(|| host.dispatch(search("matrix")));

        let eight = gate.wait_for_arrivals(CAP, REACHED);
        let ninth = gate.wait_for_arrivals(CAP + 1, SETTLED);
        let held = gate.counts();
        gate.open();

        assert!(eight, "eight catalog asks are in flight together");
        assert!(!ninth, "no ninth catalog ask starts: {:?}", held);
        assert_eq!(
            held,
            Counts {
                arrived: CAP,
                peak: CAP,
                completed: 0,
                timed_out: false,
            }
        );

        assert!(gate.wait_for_completed(16, REACHED));
        let response = answered
            .join()
            .expect("the search thread does not panic")
            .expect("searching is answered");
        let rows = rows(&response);
        assert_eq!(rows.len(), 16);
        assert_eq!(
            rows.iter()
                .map(|row| row.addon.as_str())
                .collect::<Vec<_>>(),
            (0..16).map(addon_id).collect::<Vec<_>>(),
            "the rows keep configured order across both chunks"
        );
        assert_eq!(
            gate.counts(),
            Counts {
                arrived: 16,
                peak: CAP,
                completed: 16,
                timed_out: false,
            }
        );
    });
}

#[test]
fn the_rows_order_stays_configured_order_when_catalog_completion_reverses() {
    let fetcher = Arc::new(ReversingCatalogFetcher::new(3));
    let provider = Arc::new(AddonProvider::new(fetcher.clone()));
    let mut host = host_over(fetcher.clone(), provider);
    for index in 0..3 {
        configure(&mut host, &manifest_url(index));
    }

    let response = host
        .dispatch(search("matrix"))
        .expect("searching is answered");
    let rows = rows(&response);

    assert!(
        !fetcher.timed_out(),
        "the first catalog was released by the other two finishing"
    );
    assert_eq!(
        fetcher.completion_order(),
        vec![catalog_url(2), catalog_url(1), catalog_url(0)],
        "the catalogs completed in reverse configured order"
    );
    assert_eq!(
        rows.iter()
            .map(|row| row.addon.as_str())
            .collect::<Vec<_>>(),
        vec![addon_id(0), addon_id(1), addon_id(2)],
        "the rows are still configured order, not completion order"
    );
}

#[test]
#[should_panic(expected = "one fake Addon panicked")]
fn a_panicking_addon_is_re_raised_on_the_calling_thread() {
    let mut fetcher = FixtureFetcher::new();
    for index in 0..3 {
        fetcher = fetcher.serving(&manifest_url(index), stream_manifest(index));
    }
    let mut host = host_over(Arc::new(fetcher), Arc::new(PanickingProvider));
    for index in 0..3 {
        configure(&mut host, &manifest_url(index));
    }

    // The panic travels out of the scoped thread and out of `dispatch`, which is
    // what a test double that panics must do rather than vanish.
    let _ = host.dispatch(find());
}
