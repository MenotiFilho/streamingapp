//! When an idle torrent is let go (ADR-0042 §3): the pure decision, measured
//! with the Host's `Clock`.
//!
//! An owner who paused and walked away, or left a finished Stream sitting, must
//! not keep a torrent uploading behind their back. A torrent held while the
//! Stream is `Ended` for 10 minutes, or `Paused` for 30, is let go; the Host then
//! keeps the Stream as Now playing and marks it released. This module holds only
//! the clock arithmetic — what the Host does about it is in `host.rs`.

use crate::playback::PlaybackState;

/// How long a torrent is held with its Stream `Ended` before it is let go.
pub(crate) const ENDED_LET_GO_MILLIS: i64 = 10 * 60 * 1000;

/// How long a torrent is held with its Stream `Paused` before it is let go.
pub(crate) const PAUSED_LET_GO_MILLIS: i64 = 30 * 60 * 1000;

/// The Host's record of how long its held torrent has been idle: which of the
/// two idle states the Stream is in, and since when.
///
/// Fed the state at every moment it can have changed (a committed change, a
/// folded report), so a test that moves the clock between two calls moves what
/// "since" measures from — never the other way round.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct Idle {
    since: Option<(PlaybackState, i64)>,
}

impl Idle {
    /// Note the state the Stream is in at `now`, and whether a torrent is held
    /// for it. Staying in the same idle state keeps the moment it began; any other
    /// state, or no torrent held, starts the measure over.
    pub(crate) fn note(&mut self, state: PlaybackState, held: bool, now: i64) {
        let idle = held && matches!(state, PlaybackState::Ended | PlaybackState::Paused);
        self.since = match (idle, self.since) {
            (false, _) => None,
            (true, Some((same, since))) if same == state => Some((same, since)),
            (true, _) => Some((state, now)),
        };
    }

    /// Forget the measure: the torrent is gone, or the Stream is.
    pub(crate) fn clear(&mut self) {
        self.since = None;
    }

    /// Whether the torrent has been idle long enough, at `now`, to be let go.
    pub(crate) fn due(&self, now: i64) -> bool {
        let Some((state, since)) = self.since else {
            return false;
        };
        let limit = match state {
            PlaybackState::Ended => ENDED_LET_GO_MILLIS,
            _ => PAUSED_LET_GO_MILLIS,
        };
        now.saturating_sub(since) >= limit
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const START: i64 = 1_000_000;

    fn minutes(count: i64) -> i64 {
        count * 60 * 1000
    }

    #[test]
    fn an_ended_stream_is_let_go_at_ten_minutes_and_not_before() {
        let mut idle = Idle::default();
        idle.note(PlaybackState::Ended, true, START);

        assert!(!idle.due(START + minutes(10) - 1));
        assert!(idle.due(START + minutes(10)));
    }

    #[test]
    fn a_paused_stream_is_let_go_at_thirty_minutes_and_not_before() {
        let mut idle = Idle::default();
        idle.note(PlaybackState::Paused, true, START);

        assert!(!idle.due(START + minutes(10)), "ten minutes is Ended's");
        assert!(!idle.due(START + minutes(30) - 1));
        assert!(idle.due(START + minutes(30)));
    }

    #[test]
    fn a_playing_or_opening_stream_is_never_idle() {
        for state in [
            PlaybackState::Idle,
            PlaybackState::Opening,
            PlaybackState::Playing,
        ] {
            let mut idle = Idle::default();
            idle.note(state, true, START);

            assert!(!idle.due(START + minutes(600)), "{state:?}");
        }
    }

    #[test]
    fn nothing_held_is_never_idle() {
        let mut idle = Idle::default();
        idle.note(PlaybackState::Paused, false, START);

        assert!(!idle.due(START + minutes(600)));
    }

    #[test]
    fn noting_the_same_state_again_keeps_when_it_began() {
        let mut idle = Idle::default();
        idle.note(PlaybackState::Paused, true, START);
        idle.note(PlaybackState::Paused, true, START + minutes(29));

        assert!(idle.due(START + minutes(30)));
    }

    #[test]
    fn playing_again_starts_the_measure_over() {
        let mut idle = Idle::default();
        idle.note(PlaybackState::Paused, true, START);
        idle.note(PlaybackState::Playing, true, START + minutes(29));
        idle.note(PlaybackState::Paused, true, START + minutes(29) + 1);

        assert!(!idle.due(START + minutes(30)));
        assert!(idle.due(START + minutes(59) + 1));
    }

    #[test]
    fn a_change_between_the_two_idle_states_is_measured_from_the_change() {
        let mut idle = Idle::default();
        idle.note(PlaybackState::Paused, true, START);
        idle.note(PlaybackState::Ended, true, START + minutes(25));

        assert!(!idle.due(START + minutes(30)));
        assert!(idle.due(START + minutes(35)));
    }

    #[test]
    fn clearing_forgets_the_measure() {
        let mut idle = Idle::default();
        idle.note(PlaybackState::Ended, true, START);
        idle.clear();

        assert!(!idle.due(START + minutes(600)));
    }
}
