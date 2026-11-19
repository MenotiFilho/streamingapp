//! The Host's side of the pipe, against the scripted stand-in this crate ships for
//! its tests — never the Go engine, never a swarm.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use host_core::{
    FailureKind, InfoHash, ServeHints, ServeRequest, TorrentEngine, TorrentLimits, TorrentPhase,
    TorrentReport,
};
use host_torrent::codec::Op;
use host_torrent::{Launch, ProcessTorrentEngine, SERVE_ANSWER_BOUND};

const HASH: &str = "c12fe1c06bba254a9dc9f519b335aa7c1367a88a";

/// A directory the stand-in records into, and an engine over it.
struct Rig {
    dir: tempfile::TempDir,
}

impl Rig {
    fn new() -> Self {
        Self {
            dir: tempfile::tempdir().unwrap(),
        }
    }

    fn record(&self) -> PathBuf {
        self.dir.path().join("record.log")
    }

    fn torrents(&self) -> PathBuf {
        self.dir.path().join("torrents")
    }

    fn launch(&self, mode: &str) -> Launch {
        Launch::new(env!("CARGO_BIN_EXE_fake-torrent-engine"), self.torrents())
            .with_argument("--mode")
            .with_argument(mode)
            .with_argument("--record")
            .with_argument(self.record())
    }

    fn engine(&self, mode: &str) -> ProcessTorrentEngine {
        ProcessTorrentEngine::new(self.launch(mode))
    }

    /// What the stand-in has recorded so far, one entry per line.
    fn recorded(&self) -> Vec<String> {
        std::fs::read_to_string(self.record())
            .unwrap_or_default()
            .lines()
            .map(str::to_owned)
            .collect()
    }

    /// The ops the stand-in was sent, in order.
    fn ops(&self) -> Vec<Op> {
        self.recorded()
            .iter()
            .filter(|line| !line.starts_with("ARGS "))
            .map(|line| Op::from_line(line).expect("the Host wrote an op"))
            .collect()
    }

    fn starts(&self) -> usize {
        self.recorded()
            .iter()
            .filter(|line| line.starts_with("ARGS "))
            .count()
    }
}

fn hash() -> InfoHash {
    InfoHash::parse(HASH).unwrap()
}

fn request() -> ServeRequest {
    ServeRequest {
        info_hash: hash(),
        file_idx: Some(1),
        sources: vec!["tracker:udp://tracker.example.org:1337".to_owned()],
        hints: ServeHints {
            filename: Some("Show.S01E03.mkv".to_owned()),
            season: Some(1),
            episode: Some(3),
        },
    }
}

fn limits(readahead_bytes: u64) -> TorrentLimits {
    TorrentLimits {
        readahead_bytes,
        cache_bytes: 2_000_000_000,
    }
}

/// Wait for something another thread does, which has no event to wait on.
fn eventually(what: &str, mut done: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while !done() {
        assert!(Instant::now() < deadline, "timed out waiting for {what}");
        std::thread::sleep(Duration::from_millis(10));
    }
}

fn reports_until(
    engine: &ProcessTorrentEngine,
    enough: impl Fn(&[TorrentReport]) -> bool,
) -> Vec<TorrentReport> {
    let mut all = Vec::new();
    eventually("the engine's reports", || {
        all.extend(engine.reports());
        enough(&all)
    });
    all
}

#[test]
fn the_engine_is_not_started_until_the_first_serve() {
    let rig = Rig::new();
    let engine = rig.engine("serve");

    engine.set_limits(limits(100));
    engine.let_go(&hash());
    assert!(engine.reports().is_empty());
    std::thread::sleep(Duration::from_millis(100));
    assert_eq!(rig.starts(), 0, "nothing but a serve starts it");

    engine.serve(&request()).expect("served");

    assert_eq!(rig.starts(), 1);
}

#[test]
fn it_is_started_once_for_many_serves() {
    let rig = Rig::new();
    let engine = rig.engine("serve");

    let first = engine.serve(&request()).expect("served");
    let second = engine.serve(&request()).expect("served");

    assert_eq!(rig.starts(), 1);
    assert_ne!(first, second, "each serve has its own URL");
}

#[test]
fn the_torrents_directory_is_passed_as_an_argument() {
    let rig = Rig::new();
    let engine = rig.engine("serve");

    engine.serve(&request()).expect("served");

    let started = &rig.recorded()[0];
    assert!(
        started.starts_with(&format!("ARGS --torrents-dir {}", rig.torrents().display())),
        "{started}"
    );
}

#[test]
fn a_serve_is_answered_with_the_engines_url_and_sends_the_whole_request() {
    let rig = Rig::new();
    let engine = rig.engine("serve");

    let url = engine.serve(&request()).expect("served");

    assert!(
        url.as_str().starts_with("http://127.0.0.1:1/token/"),
        "{url}"
    );
    assert!(url.as_str().contains(HASH));
    let serves: Vec<_> = rig
        .ops()
        .into_iter()
        .filter_map(|op| match op {
            Op::Serve { request, .. } => Some(request),
            _ => None,
        })
        .collect();
    assert_eq!(serves, vec![request()]);
}

#[test]
fn a_refused_serve_is_the_engines_own_sentence() {
    let rig = Rig::new();
    let engine = rig.engine("refuse");

    let refused = engine.serve(&request()).expect_err("refused");

    assert_eq!(
        refused.to_string(),
        "That torrent is not one this engine can fetch."
    );
}

#[test]
fn the_latest_limits_are_sent_as_soon_as_the_engine_starts() {
    let rig = Rig::new();
    let engine = rig.engine("serve");
    engine.set_limits(limits(100));
    engine.set_limits(limits(200));

    engine.serve(&request()).expect("served");

    let ops = rig.ops();
    assert_eq!(ops.len(), 2, "{ops:?}");
    assert_eq!(
        ops[0],
        Op::Limits(limits(200)),
        "the latest, before the serve"
    );
    assert!(matches!(ops[1], Op::Serve { .. }));
}

#[test]
fn limits_set_while_it_runs_reach_it_live() {
    let rig = Rig::new();
    let engine = rig.engine("serve");
    engine.serve(&request()).expect("served");
    assert!(
        !rig.ops().iter().any(|op| matches!(op, Op::Limits(_))),
        "no limits were set, so none are sent"
    );

    engine.set_limits(limits(300));

    eventually("the live limits", || {
        rig.ops().contains(&Op::Limits(limits(300)))
    });
}

#[test]
fn a_restarted_engine_is_told_the_limits_again() {
    let rig = Rig::new();
    let engine = rig.engine("exit-on-serve");
    engine.set_limits(limits(400));

    engine.serve(&request()).expect_err("the engine ended");
    engine.serve(&request()).expect_err("and again");

    let told = rig
        .ops()
        .into_iter()
        .filter(|op| *op == Op::Limits(limits(400)))
        .count();
    assert_eq!(told, 2, "once for each child that started");
    assert_eq!(rig.starts(), 2);
}

#[test]
fn a_torrent_let_go_is_told_to_the_running_engine_only() {
    let rig = Rig::new();
    let engine = rig.engine("serve");
    engine.serve(&request()).expect("served");

    engine.let_go(&hash());

    eventually("the let go", || rig.ops().contains(&Op::LetGo(hash())));
}

#[test]
fn a_serve_the_engine_never_answers_fails_within_the_bound() {
    let rig = Rig::new();
    let bound = Duration::from_millis(300);
    let engine = ProcessTorrentEngine::new(rig.launch("silent").with_answer_bound(bound));

    let started = Instant::now();
    let failed = engine.serve(&request()).expect_err("no answer");

    let waited = started.elapsed();
    assert!(
        waited >= bound,
        "gave up after {waited:?}, before the bound"
    );
    assert!(
        waited < bound * 10,
        "gave up after {waited:?}, long after the bound"
    );
    assert_eq!(
        failed.to_string(),
        "The torrent engine did not answer in time."
    );
}

#[test]
fn the_bound_is_about_five_seconds() {
    assert_eq!(SERVE_ANSWER_BOUND, Duration::from_secs(5));
}

#[test]
fn an_engine_that_is_slow_once_serves_the_next_request() {
    let rig = Rig::new();
    let engine = ProcessTorrentEngine::new(
        rig.launch("silent")
            .with_answer_bound(Duration::from_millis(100)),
    );
    engine.serve(&request()).expect_err("no answer");

    // The child is still there: a failed serve does not start another.
    engine.serve(&request()).expect_err("no answer");

    assert_eq!(rig.starts(), 1);
}

#[test]
fn the_engines_stderr_goes_to_the_sink() {
    let rig = Rig::new();
    let lines = Arc::new(Mutex::new(Vec::<String>::new()));
    let sink = lines.clone();
    let launch = rig
        .launch("serve")
        .with_argument("--stderr")
        .with_argument("engine: listening on 127.0.0.1")
        .with_stderr_sink(move |line| sink.lock().unwrap().push(line.to_owned()));
    let engine = ProcessTorrentEngine::new(launch);

    engine.serve(&request()).expect("served");

    eventually("the stderr line", || {
        lines
            .lock()
            .unwrap()
            .contains(&"engine: listening on 127.0.0.1".to_owned())
    });
}

#[test]
fn status_chosen_and_failed_are_reports_and_unknown_lines_are_ignored() {
    let rig = Rig::new();
    let engine = rig.engine("chatty");

    engine.serve(&request()).expect("served");

    let reports = reports_until(&engine, |all| {
        all.iter()
            .any(|r| matches!(r, TorrentReport::Failed { .. }))
    });
    assert_eq!(
        reports,
        vec![
            TorrentReport::Status {
                info_hash: hash(),
                phase: TorrentPhase::Fetching,
                peers: 3,
                rate: 1500,
            },
            TorrentReport::Chosen {
                info_hash: hash(),
                file_idx: 1,
                name: "Show.S01E03.mkv".to_owned(),
            },
            // Two lines no Host knows sat between these and did no harm.
            TorrentReport::Failed {
                info_hash: hash(),
                kind: FailureKind::NoFile,
                sentence: "This torrent holds 24 videos and none is S01E03.".to_owned(),
            },
        ]
    );
    assert!(engine.reports().is_empty(), "what was reported is gone");
}

#[test]
fn the_end_of_the_engines_output_is_reported_as_exited() {
    let rig = Rig::new();
    let engine = rig.engine("exit-on-serve");

    let failed = engine.serve(&request()).expect_err("the engine ended");

    assert_eq!(failed.to_string(), "The torrent engine stopped.");
    let reports = reports_until(&engine, |all| all.contains(&TorrentReport::Exited));
    assert_eq!(reports, vec![TorrentReport::Exited]);
}

#[test]
fn an_engine_that_exited_is_started_again_by_the_next_serve() {
    let rig = Rig::new();
    let engine = rig.engine("exit-after-ready");
    reports_until_started(&engine);
    // Nothing is held, so nothing is noticed until the next serve starts it.
    assert_eq!(rig.starts(), 1);

    engine.serve(&request()).expect_err("it exits again");

    assert_eq!(rig.starts(), 2, "started again, as on first use");
}

/// An engine that exits as soon as it is ready has to be started by a serve to
/// exit at all: start it and let its end be seen.
fn reports_until_started(engine: &ProcessTorrentEngine) {
    let _ = engine.serve(&request());
    reports_until(engine, |all| all.contains(&TorrentReport::Exited));
}

#[test]
fn a_serve_waiting_when_the_engine_ends_fails_at_once_and_not_at_the_bound() {
    let rig = Rig::new();
    let engine = ProcessTorrentEngine::new(
        rig.launch("exit-on-serve")
            .with_answer_bound(Duration::from_secs(30)),
    );

    let started = Instant::now();
    engine.serve(&request()).expect_err("the engine ended");

    assert!(started.elapsed() < Duration::from_secs(10));
}

#[test]
fn the_engine_that_cannot_be_started_is_a_sentence_and_not_a_panic() {
    let rig = Rig::new();
    let engine = ProcessTorrentEngine::new(Launch::new(
        Path::new("/nowhere/streamingapp-torrent"),
        rig.torrents(),
    ));

    let failed = engine.serve(&request()).expect_err("no engine");

    assert!(
        failed
            .to_string()
            .starts_with("The torrent engine could not be started"),
        "{failed}"
    );
    assert!(engine.reports().is_empty());
}

#[test]
fn dropping_the_engine_closes_the_pipe_the_child_holds() {
    let rig = Rig::new();
    let marker = rig.dir.path().join("closed");
    let engine = ProcessTorrentEngine::new(
        rig.launch("serve")
            .with_argument("--closed-marker")
            .with_argument(&marker),
    );
    engine.serve(&request()).expect("served");
    assert!(!marker.exists(), "it runs for as long as the pipe is held");

    drop(engine);

    eventually("the child to see its stdin close", || marker.exists());
}
