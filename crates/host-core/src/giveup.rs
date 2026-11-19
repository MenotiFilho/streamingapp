//! When the Host gives up on a torrent that is still opening (ADR-0042 §5): the
//! pure decision, measured with the Host's `Clock`.
//!
//! A torrent nobody is sharing never starts, and mpv would wait on it far longer
//! than an owner will (it is told 90 s, so that this rule is what ends the wait,
//! not its timeout). From the moment a torrent is served, while its Stream is
//! still opening, the Host gives up when the engine has not reported `Fetching`
//! within 60 s, or has reported `Fetching` with no peers for 60 s straight. Once
//! a Stream has played the Host never gives up on it again, direct or torrent.
//! This module holds only the clock arithmetic — what the Host does about it is
//! in `host.rs`.

use crate::torrent::TorrentPhase;

/// How long a torrent may take to open — to show bytes arriving, or to show a
/// peer — before the Host gives up on it.
pub(crate) const GIVE_UP_MILLIS: i64 = 60 * 1000;

/// What the Host knows of how an opening torrent has fared since it was served.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct GiveUp {
    /// When the torrent was served; `None` where nothing is being measured: no
    /// torrent held, or one whose Stream has opened.
    served_at: Option<i64>,
    /// Bytes have been reported arriving: the wait for a first `Fetching` is over.
    fetching: bool,
    /// Since when the engine has reported `Fetching` with no peers, unbroken.
    peerless_since: Option<i64>,
}

impl GiveUp {
    /// Begin measuring a torrent served at `now`.
    pub(crate) fn begin(&mut self, now: i64) {
        *self = Self {
            served_at: Some(now),
            ..Self::default()
        };
    }

    /// Stop measuring: the torrent is gone, or its Stream has opened.
    pub(crate) fn clear(&mut self) {
        *self = Self::default();
    }

    /// Take a reading of the torrent at `now`. A `Finding` reading says nothing
    /// is fetched yet, so it changes nothing; `Fetching` ends the wait for a
    /// first one, and starts or resets the minute without peers.
    pub(crate) fn note(&mut self, phase: TorrentPhase, peers: u32, now: i64) {
        if self.served_at.is_none() || phase != TorrentPhase::Fetching {
            return;
        }
        self.fetching = true;
        self.peerless_since = match (peers, self.peerless_since) {
            (0, Some(since)) => Some(since),
            (0, None) => Some(now),
            _ => None,
        };
    }

    /// Whether the Host gives up at `now`.
    pub(crate) fn due(&self, now: i64) -> bool {
        let Some(served_at) = self.served_at else {
            return false;
        };
        let waited = |since: i64| now.saturating_sub(since) >= GIVE_UP_MILLIS;
        (!self.fetching && waited(served_at)) || self.peerless_since.is_some_and(waited)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const START: i64 = 1_000_000;

    fn seconds(count: i64) -> i64 {
        count * 1000
    }

    fn begun() -> GiveUp {
        let mut give_up = GiveUp::default();
        give_up.begin(START);
        give_up
    }

    #[test]
    fn nothing_is_given_up_on_before_a_torrent_is_served() {
        assert!(!GiveUp::default().due(START + seconds(600)));
    }

    #[test]
    fn no_fetching_report_for_sixty_seconds_is_a_give_up_and_fifty_nine_is_not() {
        let give_up = begun();

        assert!(!give_up.due(START + seconds(59)));
        assert!(give_up.due(START + seconds(60)));
    }

    #[test]
    fn finding_readings_do_not_end_the_wait_for_a_fetching_one() {
        let mut give_up = begun();
        give_up.note(TorrentPhase::Finding, 8, START + seconds(10));

        assert!(give_up.due(START + seconds(60)));
    }

    #[test]
    fn fetching_with_peers_ends_the_wait_for_good() {
        let mut give_up = begun();
        give_up.note(TorrentPhase::Fetching, 2, START + seconds(10));

        assert!(!give_up.due(START + seconds(6000)));
    }

    #[test]
    fn fetching_with_no_peers_is_a_give_up_sixty_seconds_after_the_first_such_reading() {
        let mut give_up = begun();
        give_up.note(TorrentPhase::Fetching, 0, START + seconds(10));
        give_up.note(TorrentPhase::Fetching, 0, START + seconds(40));

        assert!(!give_up.due(START + seconds(69)));
        assert!(give_up.due(START + seconds(70)));
    }

    #[test]
    fn a_peer_resets_the_minute_without_peers() {
        let mut give_up = begun();
        give_up.note(TorrentPhase::Fetching, 0, START);
        give_up.note(TorrentPhase::Fetching, 1, START + seconds(50));
        give_up.note(TorrentPhase::Fetching, 0, START + seconds(60));

        assert!(!give_up.due(START + seconds(119)));
        assert!(give_up.due(START + seconds(120)));
    }

    #[test]
    fn a_finding_reading_does_not_reset_the_minute_without_peers() {
        let mut give_up = begun();
        give_up.note(TorrentPhase::Fetching, 0, START);
        give_up.note(TorrentPhase::Finding, 5, START + seconds(30));

        assert!(give_up.due(START + seconds(60)));
    }

    #[test]
    fn a_cleared_measure_never_gives_up_and_a_reading_before_a_serve_is_ignored() {
        let mut give_up = begun();
        give_up.clear();
        assert!(!give_up.due(START + seconds(6000)));

        give_up.note(TorrentPhase::Fetching, 0, START);
        give_up.begin(START + seconds(100));
        assert!(
            !give_up.due(START + seconds(159)),
            "the old reading is gone"
        );
        assert!(give_up.due(START + seconds(160)));
    }
}
