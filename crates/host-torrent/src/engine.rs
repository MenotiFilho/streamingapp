//! The real [`TorrentEngine`]: the bundled Go program as a child process.
//!
//! The child is started lazily, on the first [`serve`](TorrentEngine::serve), and
//! lives as long as the Host holds its stdin: a Host that exits, crashes or is
//! killed closes the pipe, and the engine drops everything and exits (ADR-0042
//! §1). Three OS threads serve one child — one reads its stdout, one forwards its
//! stderr to the Host's log — and the caller's own waits on the answer to its
//! serve. No `tokio`, no `unsafe`.
//!
//! The decisions here are small and are tested against the scripted stand-in in
//! `tests/`, never the Go engine: it is spawned only when asked to serve, it is
//! told the latest limits as it starts and live afterwards, a serve it does not
//! answer in [`SERVE_ANSWER_BOUND`] fails, and its exit is a report.

use std::collections::HashMap;
use std::ffi::OsString;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, Weak};
use std::time::Duration;

use host_core::{
    InfoHash, ServeRequest, StreamUrl, TorrentEngine, TorrentError, TorrentLimits, TorrentReport,
};

use crate::codec::{Event, Op};

/// How long a serve may wait for the engine's answer: the engine answers at once,
/// before metadata, so a silence this long is an engine that is not working
/// (ADR-0042 §2). A failed serve is the Host's failed open.
pub const SERVE_ANSWER_BOUND: Duration = Duration::from_secs(5);

/// Where a line of the engine's stderr goes.
type StderrSink = Arc<dyn Fn(&str) + Send + Sync>;

/// How to start the engine.
#[derive(Clone)]
pub struct Launch {
    program: PathBuf,
    torrents_dir: PathBuf,
    extra_arguments: Vec<OsString>,
    stderr_sink: StderrSink,
    answer_bound: Duration,
}

impl Launch {
    /// Start `program` — the engine's binary, as [`launch::locate`](crate::launch::locate)
    /// finds it — keeping its torrents in `torrents_dir`, which it is passed as
    /// `--torrents-dir <dir>`. Its stderr goes to the Host's log.
    pub fn new(program: impl Into<PathBuf>, torrents_dir: impl Into<PathBuf>) -> Self {
        Self {
            program: program.into(),
            torrents_dir: torrents_dir.into(),
            extra_arguments: Vec::new(),
            stderr_sink: Arc::new(|line| tracing::info!(target: "torrent_engine", "{line}")),
            answer_bound: SERVE_ANSWER_BOUND,
        }
    }

    /// One more argument after `--torrents-dir`: how a test tells its stand-in
    /// what to do.
    #[must_use]
    pub fn with_argument(mut self, argument: impl Into<OsString>) -> Self {
        self.extra_arguments.push(argument.into());
        self
    }

    /// Send the engine's stderr lines to `sink` in place of the Host's log.
    #[must_use]
    pub fn with_stderr_sink(mut self, sink: impl Fn(&str) + Send + Sync + 'static) -> Self {
        self.stderr_sink = Arc::new(sink);
        self
    }

    /// Wait this long for a serve's answer in place of [`SERVE_ANSWER_BOUND`], so
    /// a test of the bound does not take five seconds.
    #[must_use]
    pub fn with_answer_bound(mut self, bound: Duration) -> Self {
        self.answer_bound = bound;
        self
    }
}

/// What the engine answers a serve with.
enum Answer {
    Served(StreamUrl),
    Refused(String),
}

/// The serves a child has not answered yet, by id.
type Pending = Arc<Mutex<HashMap<u64, Sender<Answer>>>>;

/// A child that is running, as far as the Host knows.
struct Running {
    /// Which child this is, so a late end of an old one never clears a new one.
    generation: u64,
    /// Held for as long as the child should live: dropping it closes the pipe.
    stdin: ChildStdin,
    pending: Pending,
}

#[derive(Default)]
struct State {
    /// The latest limits, remembered for a child that has not started yet.
    limits: Option<TorrentLimits>,
    running: Option<Running>,
    next_id: u64,
    generation: u64,
}

struct Shared {
    launch: Launch,
    state: Mutex<State>,
    reports: Arc<Mutex<Vec<TorrentReport>>>,
}

/// The Torrent engine as a child process. See the module's documentation.
pub struct ProcessTorrentEngine {
    shared: Arc<Shared>,
}

impl ProcessTorrentEngine {
    /// An engine that is started when the first torrent is served, and not
    /// before.
    pub fn new(launch: Launch) -> Self {
        Self {
            shared: Arc::new(Shared {
                launch,
                state: Mutex::new(State::default()),
                reports: Arc::new(Mutex::new(Vec::new())),
            }),
        }
    }
}

impl Shared {
    fn lock_state(&self) -> std::sync::MutexGuard<'_, State> {
        self.state
            .lock()
            .expect("the engine's state is not poisoned")
    }

    /// Start the child and its two readers, and tell it the limits it has been
    /// given so far.
    fn spawn(shared: &Arc<Shared>, state: &mut State) -> Result<(), TorrentError> {
        let launch = &shared.launch;
        let mut command = Command::new(&launch.program);
        command
            .arg("--torrents-dir")
            .arg(&launch.torrents_dir)
            .args(&launch.extra_arguments)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        // The Host has no console, and a console program started from one opens a
        // window of its own: `CREATE_NO_WINDOW`.
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000);
        }

        let mut child = command.spawn().map_err(|error| {
            tracing::error!(%error, program = %launch.program.display(), "the torrent engine did not start");
            TorrentError::new(format!("The torrent engine could not be started: {error}."))
        })?;
        let stdin = child.stdin.take().expect("the child's stdin is piped");
        let stdout = child.stdout.take().expect("the child's stdout is piped");
        let stderr = child.stderr.take().expect("the child's stderr is piped");

        state.generation += 1;
        let generation = state.generation;
        let pending: Pending = Arc::default();
        tracing::info!(generation, pid = child.id(), "the torrent engine started");

        let sink = launch.stderr_sink.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                sink(&line);
            }
        });
        let reader = Reader {
            shared: Arc::downgrade(shared),
            reports: shared.reports.clone(),
            pending: pending.clone(),
            generation,
        };
        std::thread::spawn(move || reader.run(stdout, child));

        state.running = Some(Running {
            generation,
            stdin,
            pending,
        });
        if let Some(limits) = state.limits {
            // The child is new: if even this write fails, the reader reports its
            // end, and the serve that follows says so.
            shared.write(state, &Op::Limits(limits));
        }
        Ok(())
    }

    /// Write one op to the running child. A failed write means the child is gone:
    /// forget it, so the next serve starts another, and report whether it was
    /// written.
    fn write(&self, state: &mut State, op: &Op) -> bool {
        let Some(running) = state.running.as_mut() else {
            return false;
        };
        let line = op.to_line();
        let written = writeln!(running.stdin, "{line}").and_then(|()| running.stdin.flush());
        if let Err(error) = written {
            tracing::warn!(%error, "the torrent engine's pipe is closed");
            state.running = None;
            return false;
        }
        true
    }
}

/// What the stdout reader needs of the engine, without keeping it alive: the
/// engine's owner dropping it is what closes the child's stdin.
struct Reader {
    shared: Weak<Shared>,
    reports: Arc<Mutex<Vec<TorrentReport>>>,
    pending: Pending,
    generation: u64,
}

impl Reader {
    fn run(self, stdout: impl std::io::Read, mut child: Child) {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            self.handle(&line);
        }

        // Stdout ended: the engine is gone, or has closed its end. Forget the
        // child first, which drops its stdin, then let every serve still waiting
        // know it will not be answered, then say so.
        if let Some(shared) = self.shared.upgrade() {
            let mut state = shared.lock_state();
            if state
                .running
                .as_ref()
                .is_some_and(|running| running.generation == self.generation)
            {
                state.running = None;
            }
        }
        self.pending
            .lock()
            .expect("the pending serves are not poisoned")
            .clear();
        tracing::warn!(
            generation = self.generation,
            "the torrent engine's output ended"
        );
        self.reports
            .lock()
            .expect("the reports are not poisoned")
            .push(TorrentReport::Exited);

        // Reap it, so a finished engine is not left a zombie.
        match child.wait() {
            Ok(status) => tracing::info!(%status, "the torrent engine exited"),
            Err(error) => tracing::warn!(%error, "the torrent engine's exit was not read"),
        }
    }

    fn handle(&self, line: &str) {
        match Event::from_line(line) {
            Ok(Event::Ready) => tracing::debug!("the torrent engine is ready"),
            Ok(Event::Served { id, url }) => self.answer(id, Answer::Served(url)),
            Ok(Event::Refused { id, sentence }) => self.answer(id, Answer::Refused(sentence)),
            Ok(event) => {
                if let Some(report) = event.into_report() {
                    self.reports
                        .lock()
                        .expect("the reports are not poisoned")
                        .push(report);
                }
            }
            // Never the line itself: a `served` one carries the URL's token.
            Err(error) => {
                tracing::warn!(%error, bytes = line.len(), "an unknown line from the torrent engine was ignored");
            }
        }
    }

    fn answer(&self, id: u64, answer: Answer) {
        let waiting = self
            .pending
            .lock()
            .expect("the pending serves are not poisoned")
            .remove(&id);
        match waiting {
            // The waiter may have given up already; that is no one's error.
            Some(waiting) => {
                let _ = waiting.send(answer);
            }
            None => tracing::debug!(id, "an answer arrived for a serve no one is waiting for"),
        }
    }
}

impl TorrentEngine for ProcessTorrentEngine {
    fn serve(&self, request: &ServeRequest) -> Result<StreamUrl, TorrentError> {
        let shared = &self.shared;
        let (answer_to, answered) = mpsc::channel();
        let (id, pending) = {
            let mut state = shared.lock_state();
            if state.running.is_none() {
                Shared::spawn(shared, &mut state)?;
            }
            state.next_id += 1;
            let id = state.next_id;
            let pending = state
                .running
                .as_ref()
                .map(|running| running.pending.clone())
                .ok_or_else(stopped)?;
            pending
                .lock()
                .expect("the pending serves are not poisoned")
                .insert(id, answer_to);
            let op = Op::Serve {
                id,
                request: request.clone(),
            };
            if !shared.write(&mut state, &op) {
                pending
                    .lock()
                    .expect("the pending serves are not poisoned")
                    .remove(&id);
                return Err(stopped());
            }
            (id, pending)
        };

        match answered.recv_timeout(shared.launch.answer_bound) {
            Ok(Answer::Served(url)) => Ok(url),
            Ok(Answer::Refused(sentence)) => Err(TorrentError::new(sentence)),
            Err(RecvTimeoutError::Timeout) => {
                pending
                    .lock()
                    .expect("the pending serves are not poisoned")
                    .remove(&id);
                tracing::warn!(id, "the torrent engine did not answer a serve in time");
                Err(TorrentError::new(
                    "The torrent engine did not answer in time.",
                ))
            }
            // The reader dropped the sender: the engine ended with this serve
            // unanswered.
            Err(RecvTimeoutError::Disconnected) => Err(stopped()),
        }
    }

    fn let_go(&self, info_hash: &InfoHash) {
        // An engine that is not running holds nothing: it removed its directories
        // as it exited, and the startup wipe takes what a killed one left.
        let mut state = self.shared.lock_state();
        self.shared.write(&mut state, &Op::LetGo(info_hash.clone()));
    }

    fn set_limits(&self, limits: TorrentLimits) {
        let mut state = self.shared.lock_state();
        state.limits = Some(limits);
        // Live to a running child, and at spawn to one that is not yet.
        self.shared.write(&mut state, &Op::Limits(limits));
    }

    fn reports(&self) -> Vec<TorrentReport> {
        std::mem::take(
            &mut *self
                .shared
                .reports
                .lock()
                .expect("the reports are not poisoned"),
        )
    }
}

fn stopped() -> TorrentError {
    TorrentError::new("The torrent engine stopped.")
}
