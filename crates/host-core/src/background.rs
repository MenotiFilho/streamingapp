//! The Host's background queue: work that runs outside the change lock, and
//! the revised Answer owed to the client whose open queued it (ADR-0038 §2).
//!
//! Opening a stale Title answers the cached copy at once and queues a refresh.
//! The shell drains the queue on a worker thread, a bounded fan-out at a time;
//! tests drain it inline. The queue takes its own lock for one push or one
//! take, and a job's fetch runs with no lock held — the same scope a question's
//! fetches have (ADR-0022, ADR-0023).
//!
//! A job is keyed by the Title the cache keys it by, so two opens of one stale
//! Title collapse into one refresh and two hints for one uncached Title collapse
//! into one read-ahead. A refresh job carries the Answer it was answered with: a
//! refresh that lands equal answers nobody, and one that differs sends a revised
//! Answer to the clients that asked, never a Snapshot (ADR-0005). A read-ahead
//! has no Answer to answer with and no askers, and only fills the cache
//! (ADR-0038 §3, #278).

use std::sync::{Arc, Mutex};

use crate::addon::AddonId;
use crate::meta::{Title, TitleKey};
use crate::request::TitleRef;
use crate::response::Answer;
use crate::title_cache::TitleSource;
use crate::tmdb::{Kind, TmdbId};

/// Where a revised Answer goes: the client whose open queued the refresh, and
/// nobody else.
///
/// The app shell's window emits it to its one window; the wire sends it on the
/// asking device's socket; a test records it. `host-core` never names a
/// transport, so this is the seam every adapter implements.
pub trait RevisionSink: Send + Sync + 'static {
    /// Deliver an Answer that follows the Response which opened its Title.
    fn revise(&self, answer: Answer);
}

/// A [`RevisionSink`] that keeps what it was handed, for tests.
#[derive(Debug, Default)]
pub struct FixtureRevisions {
    answers: Mutex<Vec<Answer>>,
}

impl FixtureRevisions {
    pub fn new() -> Self {
        Self::default()
    }

    /// Every Answer the Host revised this sink with, in the order it did.
    pub fn revised(&self) -> Vec<Answer> {
        self.answers
            .lock()
            .expect("the fixture revisions are not poisoned")
            .clone()
    }
}

impl RevisionSink for FixtureRevisions {
    fn revise(&self, answer: Answer) {
        self.answers
            .lock()
            .expect("the fixture revisions are not poisoned")
            .push(answer);
    }
}

/// What one background job will read.
#[derive(Debug, Clone)]
pub(crate) enum Work {
    /// A Title opened through an Addon: ask the Addon, and TMDB where it meets
    /// — or TMDB alone once the Addon is gone and the copy is keyed by a
    /// record (ADR-0038 §2).
    Addon { addon: AddonId, asked: TitleRef },
    /// A Discovered Title: TMDB's record is the whole of it.
    Discovered { id: TmdbId, kind: Kind },
    /// A caught-up series: TMDB's record with one season appended, because the
    /// record's hint says which season is worth reading and the rest are not
    /// (ADR-0038 §5, #277). `source` is the cached copy's own source, kept
    /// because the record describes that copy rather than replacing it whole.
    CatchUp {
        id: TmdbId,
        season: u32,
        source: TitleSource,
    },
}

impl Work {
    /// Whether this reads the whole Title rather than the one season a
    /// caught-up check asked about.
    ///
    /// A stale open is the whole Title's business — its metadata as well as its
    /// Videos — and when it meets a queued caught-up check for the same Title,
    /// the full read is the one that runs (#266).
    fn whole(&self) -> bool {
        !matches!(self, Self::CatchUp { .. })
    }
}

/// One Title to read again, the copy it was answered with, and who asked.
pub(crate) struct Job {
    /// The Title as the cache keys it: what a duplicate job collapses on.
    pub(crate) key: TitleKey,
    /// The Title the client was answered with, where a client was answered with
    /// one. A refresh equal to this one is no news and answers nobody; a
    /// read-ahead queued for an uncached Title has no copy and no answer to
    /// judge against.
    pub(crate) answered: Option<Title>,
    pub(crate) work: Work,
    /// The clients whose opens queued this job, owed a revised Answer if the
    /// refresh differs. Empty for a job no client asked for (a read-ahead).
    pub(crate) askers: Vec<Arc<dyn RevisionSink>>,
}

/// The work waiting to run, oldest first. One Title is one job.
#[derive(Default)]
pub(crate) struct BackgroundQueue {
    jobs: Vec<Job>,
}

impl BackgroundQueue {
    /// Queue one job, collapsing it into the job already waiting for the same
    /// Title: one stale Title is one refresh however many clients open it, and
    /// one Title a person rests on is one read-ahead however many hints it
    /// sends.
    pub(crate) fn enqueue(&mut self, mut job: Job) {
        if let Some(held) = self.jobs.iter_mut().find(|held| held.key == job.key) {
            held.askers.append(&mut job.askers);
            // The copy a client was answered with is what a revision is judged
            // against. A read-ahead queued before that open has none, so the
            // later job's copy replaces the absence; an earlier answered copy
            // is never replaced by a later hint's.
            if held.answered.is_none() {
                held.answered = job.answered;
            } else if !held.work.whole() && job.work.whole() {
                // The stale open's copy is what its revision is judged against,
                // and it is the same one the queued check read. A full read
                // meeting a one-season check replaces the check's work rather
                // than collapsing into it (#266).
                held.answered = job.answered;
            }
            if job.work.whole() && !held.work.whole() {
                held.work = job.work;
            }
            return;
        }
        self.jobs.push(job);
    }

    /// Take everything waiting, so the caller can run it with no queue lock
    /// held.
    pub(crate) fn take(&mut self) -> Vec<Job> {
        std::mem::take(&mut self.jobs)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn job(key: TitleKey, asker: Arc<dyn RevisionSink>) -> Job {
        Job {
            key,
            answered: Some(Title {
                addon: None,
                id: "tmdb:1".to_owned(),
                key: TitleKey::Tmdb { id: 1 },
                r#type: "movie".to_owned(),
                name: "One".to_owned(),
                poster: None,
                background: None,
                logo: None,
                description: None,
                release_info: None,
                runtime: None,
                imdb_rating: None,
                genres: Vec::new(),
                videos: Vec::new(),
            }),
            work: Work::Discovered {
                id: TmdbId(1),
                kind: Kind::Movie,
            },
            askers: vec![asker],
        }
    }

    #[test]
    fn two_jobs_for_one_title_are_one_job_with_both_askers() {
        let mut queue = BackgroundQueue::default();
        queue.enqueue(job(
            TitleKey::Tmdb { id: 1 },
            Arc::new(FixtureRevisions::new()),
        ));
        queue.enqueue(job(
            TitleKey::Tmdb { id: 1 },
            Arc::new(FixtureRevisions::new()),
        ));

        let jobs = queue.take();
        assert_eq!(jobs.len(), 1, "one Title is one job");
        assert_eq!(
            jobs[0].askers.len(),
            2,
            "and both clients are owed an answer"
        );
        assert!(queue.take().is_empty(), "taking the queue empties it");
    }

    #[test]
    fn a_read_ahead_and_a_stale_open_of_one_title_are_one_job() {
        let mut queue = BackgroundQueue::default();
        let mut ahead = job(TitleKey::Tmdb { id: 1 }, Arc::new(FixtureRevisions::new()));
        ahead.answered = None;
        ahead.askers.clear();
        queue.enqueue(ahead);
        queue.enqueue(job(
            TitleKey::Tmdb { id: 1 },
            Arc::new(FixtureRevisions::new()),
        ));

        let jobs = queue.take();
        assert_eq!(jobs.len(), 1, "a hint and an open of one Title are one job");
        assert!(
            jobs[0].answered.is_some(),
            "the copy a client was answered with is what a revision is judged against"
        );
        assert_eq!(
            jobs[0].askers.len(),
            1,
            "only the client that opened it is owed an answer"
        );
    }

    #[test]
    fn a_stale_open_that_meets_a_queued_caught_up_reads_the_whole_title() {
        // A queued caught-up check asks TMDB for one season; a stale open of the
        // same Title asks for the whole Title. Collapsing them into the check
        // would refresh the season and leave the metadata as it was.
        let mut queue = BackgroundQueue::default();
        let mut check = job(TitleKey::Tmdb { id: 1 }, Arc::new(FixtureRevisions::new()));
        check.work = Work::CatchUp {
            id: TmdbId(1),
            season: 2,
            source: TitleSource::Both,
        };
        check.askers.clear();
        queue.enqueue(check);
        queue.enqueue(job(
            TitleKey::Tmdb { id: 1 },
            Arc::new(FixtureRevisions::new()),
        ));

        let jobs = queue.take();
        assert_eq!(jobs.len(), 1, "one Title is one job");
        assert!(
            matches!(jobs[0].work, Work::Discovered { .. }),
            "the open's whole read is the one that runs"
        );
        assert_eq!(jobs[0].askers.len(), 1, "and the client is owed its answer");
    }
}
