//! The small helper the Host's timing lines share.
//!
//! The door logs one line per Action and the fan-out logs one per Addon ask; both
//! carry `duration_ms`, and both round it the same way so two lines about the same
//! ask cannot disagree about how long it took (ADR-0022, ADR-0023).

use std::time::Duration;

/// Milliseconds as an integer a structured log can carry.
pub(crate) fn millis(duration: Duration) -> u64 {
    u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
}
