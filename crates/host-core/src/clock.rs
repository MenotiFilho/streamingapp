//! The Host's clock: the one reading of time it makes, and the reason it is a
//! seam rather than a call.
//!
//! Watch progress is stamped with the moment it was written (#29), and that
//! stamp is what orders the Continue watching row now and what #30's merge
//! resolves two writes by later. `host-core` holds no threads and no timers
//! (ADR-0013), so the clock is not something the Host runs — it is something it
//! is handed, the way a Player and a Store are, and a test drives a
//! [`FixtureClock`] so that "most recent" is a fact a test decides rather than a
//! fact about how long two statements took.

use std::sync::atomic::{AtomicI64, Ordering};

/// Where the Host reads the time: milliseconds since the Unix epoch.
///
/// One method, because one moment is all the Host needs: when a Video's progress
/// was last written.
pub trait Clock: Send + Sync + 'static {
    /// Now, in milliseconds since the Unix epoch.
    fn now_millis(&self) -> i64;
}

/// The clock a real Host is built with: the machine's own wall clock.
#[derive(Debug, Default, Clone, Copy)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now_millis(&self) -> i64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|since| since.as_millis() as i64)
            // A clock set before 1970 is not a reason for a Host to stop: the
            // stamp is only ever compared to another stamp.
            .unwrap_or(0)
    }
}

/// A clock a test drives by hand, so that the order two writes happened in is
/// the order the test says rather than the order two statements ran in.
#[derive(Debug)]
pub struct FixtureClock(AtomicI64);

impl Default for FixtureClock {
    fn default() -> Self {
        Self::new()
    }
}

impl FixtureClock {
    /// 2026-11-17 00:00:00 UTC, where a new clock starts: a day after every air
    /// date the fixture Titles list, so a test that does not care what day it is
    /// finds its episodes aired — as they are in life, and as Autoplay's "has it
    /// aired" decision reads them. A test about time sets its own (`at`).
    pub const TODAY: i64 = 1_794_873_600_000;

    pub fn new() -> Self {
        Self(AtomicI64::new(Self::TODAY))
    }

    /// The same clock, set to this moment before it is handed over.
    pub fn at(self, millis: i64) -> Self {
        self.set(millis);
        self
    }

    /// Set the moment the Host reads next.
    pub fn set(&self, millis: i64) {
        self.0.store(millis, Ordering::SeqCst);
    }

    /// Move the clock on by this many milliseconds, and answer with the moment
    /// it now reads — one video's write, then the next's.
    pub fn tick(&self, by: i64) -> i64 {
        self.0.fetch_add(by, Ordering::SeqCst) + by
    }
}

impl Clock for FixtureClock {
    fn now_millis(&self) -> i64 {
        self.0.load(Ordering::SeqCst)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_fixture_clock_reads_what_a_test_set_and_moves_only_when_told() {
        let clock = FixtureClock::new().at(1_000);

        assert_eq!(clock.now_millis(), 1_000);
        assert_eq!(clock.now_millis(), 1_000, "reading does not move it");
        assert_eq!(clock.tick(250), 1_250);
        assert_eq!(clock.now_millis(), 1_250);
    }

    #[test]
    fn a_new_fixture_clock_reads_today_and_not_the_epoch() {
        assert_eq!(FixtureClock::new().now_millis(), FixtureClock::TODAY);
        assert_eq!(FixtureClock::default().now_millis(), FixtureClock::TODAY);
    }

    #[test]
    fn the_system_clock_reads_a_plausible_moment() {
        // Not an assertion about the machine's time, only that a real clock
        // answers something rather than panicking: the epoch is 1970, and every
        // moment this project is built at is well past it.
        assert!(SystemClock.now_millis() > 1_600_000_000_000);
    }
}
