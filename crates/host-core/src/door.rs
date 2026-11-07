//! The one door, and the lock scope that makes a slow Addon a slow row rather
//! than a slow Host.
//!
//! Every client — the window and the wire — reaches the Host through one Action
//! surface (ADR-0002, ADR-0008). This is that surface's lock: a question clones a
//! [`crate::HostView`] under a short lock and resolves outside it, while a change
//! keeps the exclusive lock for the whole of its I/O. The distinction is
//! [`ValidatedAction::is_question`](crate::ValidatedAction::is_question),
//! written down once in `host-core`; no client classifies (ADR-0022). The
//! read-only `live_check` run is not a client here: it composes the addon path
//! directly and never builds a `Host`.
//!
//! The Action's timing lines live here too, because this is the only place that
//! knows when an Action started and whether it was a question. They carry the
//! Action's stable kind — the spelling the wire already claimed — the Addon id
//! where the question names one, the duration and the outcome — never a payload,
//! a URL, a query or an error's detail. A fan-out adds one line per Addon ask
//! (ADR-0023); this one stays the Action's total.

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::action::{Action, ActionError};
use crate::addon::AddonId;
use crate::background::RevisionSink;
use crate::device::{DeviceSummary, DeviceToken};
use crate::host::{Drained, Host};
use crate::log::millis;
use crate::response::Response;
use crate::snapshot::Snapshot;

/// A question slower than this is logged at `warn`: the owner is waiting on
/// somebody else's server, and the line is worth finding.
const SLOW_QUESTION: Duration = Duration::from_secs(2);

/// The sentence every lock failure carries: nothing in this Host panics while
/// holding the Host, so a poisoned mutex is a bug and not a state to recover.
const POISONED: &str = "nothing panics while holding the Host";

/// The Host behind one mutex, with the lock scope each kind of Action deserves.
///
/// A question never holds the lock across its fetch; a change always does. The
/// same door is used by the app shell's IPC bridge and the wire server's
/// `Surface` implementation, so there is one lock policy in the repository
/// rather than one per adapter.
pub struct HostDoor {
    host: Mutex<Host>,
}

impl HostDoor {
    /// Wrap a Host in the one lock every client reaches it through.
    pub fn new(host: Host) -> Self {
        Self {
            host: Mutex::new(host),
        }
    }

    /// Take an Action: validate it, then resolve it as the question or the
    /// change its one classification says it is.
    pub fn dispatch(&self, action: Action) -> Result<Response, ActionError> {
        self.dispatch_asking(action, None)
    }

    /// The same, saying where an Answer that arrives after the Response goes.
    ///
    /// The window's bridge and the wire pass the client that asked — one window,
    /// or one device's socket — so a stale Title's background refresh can answer
    /// that client alone (ADR-0038 §2). The client is a [`RevisionSink`] and not
    /// a name `host-core` knows: the transport decides who it is.
    pub fn dispatch_asking(
        &self,
        action: Action,
        revisions: Option<Arc<dyn RevisionSink>>,
    ) -> Result<Response, ActionError> {
        let started = Instant::now();
        let claimed = action.spelling();

        let validated = match action.validate() {
            Ok(validated) => validated,
            Err(error) => {
                // A malformed Action never became a question or a change, so
                // there is no kind to carry but the spelling it claimed. The
                // refusal's own kind is safe; its detail is not logged.
                refused_log(claimed, started.elapsed(), error.kind());
                return Err(error);
            }
        };
        if validated.is_question() {
            // The Addon id is safe to name; the rest of the question is not.
            // Cloned because resolution consumes the Action and the line is
            // written after it, when the view has already answered.
            let addon = validated.question_addon().cloned();

            // The view is cloned and the lock released before the question
            // reaches the network. This is the whole decision: everything after
            // the closing brace runs without the change lock (ADR-0022).
            let view = {
                let host = self.host.lock().expect(POISONED);
                host.view()
            };

            let result = view.ask(validated, revisions.as_ref());
            question_log(
                claimed,
                addon.as_ref(),
                started.elapsed(),
                outcome(&result, "answered"),
            );
            result.map(Response::answered)
        } else {
            // A change is serialized, I/O included. Two changes must not
            // interleave into a state neither client asked for, and a change
            // never waits for a question because no question holds this lock.
            let result = self.host.lock().expect(POISONED).apply(validated);
            change_log(claimed, started.elapsed(), outcome(&result, "applied"));
            result
        }
    }

    /// Run the background queue, a bounded fan-out at a time, and answer what a
    /// client is owed.
    ///
    /// The jobs are taken and the view cloned under the lock, and then every
    /// fetch runs with it released: a refresh is not a change, and a slow
    /// source must not keep every client waiting (ADR-0022, ADR-0038 §3). The
    /// shell drains this on a worker thread; a test drains it inline. A cache
    /// write that moved Continue watching publishes one Snapshot, under the
    /// lock again — the fetch itself never held it (#277).
    pub fn drain(&self) -> Drained {
        let (jobs, view) = {
            let mut host = self.host.lock().expect(POISONED);
            host.begin_drain()
        };
        if jobs.is_empty() {
            return Drained::nothing();
        }
        let (ran, changed) = view.drain(jobs);
        let snapshot = changed.then(|| self.host.lock().expect(POISONED).cache_changed());
        Drained { ran, snapshot }
    }

    /// The state as it stands — what a client that has just connected, or just
    /// reconnected, is owed.
    ///
    /// Under the change lock, deliberately: a Snapshot is built from the whole
    /// state, and a half-applied change is not a state any client may see.
    pub fn snapshot(&self) -> Snapshot {
        self.host.lock().expect(POISONED).snapshot()
    }

    /// Read the Player and fold what it reports into state. Serialized with
    /// changes for the same reason they are.
    pub fn sample(&self) -> Option<Snapshot> {
        self.host.lock().expect(POISONED).sample()
    }

    /// Merge newer remote Watch progress from the Stremio account (#30).
    pub fn pull_remote(&self) -> Option<Snapshot> {
        self.host.lock().expect(POISONED).pull_remote()
    }

    /// The Host is going away: write down where the Stream got to, and tell the
    /// account where one is signed in. Answers whether an account was told.
    pub fn shutdown(&self) -> bool {
        self.host.lock().expect(POISONED).shutdown()
    }

    /// Tell the Host where its wire server answers, once it has bound.
    pub fn set_serving(&self, address: &str) {
        self.host
            .lock()
            .expect(POISONED)
            .set_serving(address.to_owned());
    }

    /// The device a presented token belongs to, or nothing (#31).
    pub fn device(&self, token: &DeviceToken) -> Option<DeviceSummary> {
        self.host.lock().expect(POISONED).device(token)
    }
}

/// One `info` line per question, `warn` above [`SLOW_QUESTION`].
///
/// The helper takes only the stable kind, the safe Addon id where there is one,
/// the duration and the outcome. There is no slot for an Action, a
/// `ValidatedAction`, a URL, a query or an error, so a later caller cannot
/// accidentally widen the line (ADR-0022).
fn question_log(
    kind: &'static str,
    addon: Option<&AddonId>,
    duration: Duration,
    outcome: &'static str,
) {
    let addon = addon.map(AddonId::as_str);
    let duration_ms = millis(duration);
    if duration > SLOW_QUESTION {
        match addon {
            Some(addon) => tracing::warn!(
                action = kind,
                addon,
                duration_ms,
                outcome,
                "a question was slow"
            ),
            None => tracing::warn!(action = kind, duration_ms, outcome, "a question was slow"),
        }
    } else {
        match addon {
            Some(addon) => tracing::info!(
                action = kind,
                addon,
                duration_ms,
                outcome,
                "a question was answered"
            ),
            None => tracing::info!(
                action = kind,
                duration_ms,
                outcome,
                "a question was answered"
            ),
        }
    }
}

/// One `debug` line per change.
fn change_log(kind: &'static str, duration: Duration, outcome: &'static str) {
    tracing::debug!(
        action = kind,
        duration_ms = millis(duration),
        outcome,
        "a change was taken"
    );
}

/// One `debug` line for an Action refused before it became either kind.
fn refused_log(kind: &'static str, duration: Duration, outcome: &'static str) {
    tracing::debug!(
        action = kind,
        duration_ms = millis(duration),
        outcome,
        "an Action was refused before it was taken"
    );
}

/// The outcome a log may carry: a stable word for success or the refusal's own
/// kind. Never the error, whose detail can quote a URL or a query.
fn outcome<T>(result: &Result<T, ActionError>, success: &'static str) -> &'static str {
    match result {
        Ok(_) => success,
        Err(error) => error.kind(),
    }
}
