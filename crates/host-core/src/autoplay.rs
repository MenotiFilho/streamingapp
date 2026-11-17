//! Autoplay: the Host advancing on its own to a Title's Up next when an
//! episode's Stream ends (ADR-0040).
//!
//! The decisions live here and are pure: whether an ended episode has anything
//! to advance to ([`on_ended`]), how much of a countdown is left ([`Pending`]),
//! and the shapes a Snapshot carries. The I/O — asking the Addons for the next
//! Video and its Stream — stays in [`crate::Host`], behind the seams every other
//! Host rule reads through.

use serde::{Deserialize, Serialize};

use crate::action::ValidatedAction;
use crate::meta::Video;
use crate::playback::Episode;
use crate::request::{TitleRef, VideoRef};

/// How long the countdown runs before the Host plays the next episode, in
/// milliseconds. A constant of the Host, not a preference (spec #302, "Out of
/// Scope").
pub const AUTOPLAY_COUNTDOWN_MS: i64 = 5_000;

/// How many episodes in a row Autoplay starts with nobody touching anything
/// before it holds and asks "Still watching?": one episode a person started or
/// touched, then this many that played on their own. A constant of the Host, not
/// a preference (spec #302, "Out of Scope").
pub const UNATTENDED_LIMIT: u32 = 3;

/// The episode Autoplay is about to play, as every client is told it: enough to
/// draw "Up next · S1E4" with its name and its still, and to open the Streams
/// picker for it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpNextEpisode {
    /// The Title the episode belongs to, by type and id.
    pub title: TitleRef,
    /// The episode's Video, by the type its Title carries and the id its Addon
    /// indexes it by.
    pub video: VideoRef,
    /// Which season and episode it is.
    pub episode: Episode,
    /// The episode's name, where the source gave one.
    pub name: Option<String>,
    /// The episode's still, where the source gave one.
    pub still: Option<String>,
}

/// What Autoplay is doing about the episode that ended, as a Snapshot says it.
///
/// The phase is flattened onto the Snapshot, so the wire reads
/// `{ next, phase: "countdown", remaining, duration }` and a client switches on
/// one `phase` tag instead of unwrapping a nested object.
///
/// serde cannot combine `deny_unknown_fields` with `flatten` on one struct, so
/// this struct does not carry it. Unknown fields are still refused: whatever
/// `next` does not take is handed to [`AutoplayPhase`], and that enum denies
/// unknown fields itself.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoplaySnapshot {
    /// The episode Autoplay is about to play.
    pub next: UpNextEpisode,
    #[serde(flatten)]
    pub phase: AutoplayPhase,
}

/// Where Autoplay stands. Tagged `phase`, in snake_case.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "phase", rename_all = "snake_case", deny_unknown_fields)]
pub enum AutoplayPhase {
    /// The countdown is running. Both numbers are relative seconds, so a client
    /// projects the digit on its own monotonic clock from the Snapshot's arrival
    /// and never compares wall clocks with the Host (ADR-0033).
    Countdown { remaining: f64, duration: f64 },
    /// Autoplay has advanced [`UNATTENDED_LIMIT`] episodes with nobody touching
    /// anything and holds on "Still watching?": there is no countdown, and only
    /// a play moves on.
    UnattendedLimit {},
    /// The countdown ran out and continuity found no Stream for `next`: the
    /// Addon is gone, it errored, or it has no playable candidate. The Host
    /// stays on the ended state, and clients offer the Streams picker for the
    /// episode. `detail` is the reason, as the refusal reported it.
    NoStream { detail: String },
}

/// What Autoplay is waiting on: a countdown the Host is running, or the hold at
/// the unattended limit.
///
/// The Host's own record, beside its state. The countdown is where it leads and
/// when it started on the Host's own `Clock`; the hold is only where it leads.
///
/// Host state and never persisted: a restarted Host comes back with none
/// (ADR-0040). It holds a moment and not a number of seconds that ticks, so
/// nothing has to run it — `host-core` holds no timers (ADR-0013) — and the
/// time that is left is read off the clock whenever a Snapshot is built.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Pending {
    next: UpNextEpisode,
    stage: Stage,
}

/// What a [`Pending`] is waiting on.
#[derive(Debug, Clone, PartialEq)]
enum Stage {
    /// Counting down, since this moment on the Host's `Clock`.
    Counting { started_at: i64 },
    /// The unattended limit: nothing runs, and the Host holds on "Still
    /// watching?" until a play, a cancel, a stop or switching Autoplay off.
    Holding,
    /// The countdown ran out and no Stream was found: nothing runs any more,
    /// and the Host holds the fact until something ends it.
    NoStream { detail: String },
}

impl Pending {
    /// A countdown to `next` that started at `now`.
    pub(crate) fn starting(next: UpNextEpisode, now: i64) -> Self {
        Self {
            next,
            stage: Stage::Counting { started_at: now },
        }
    }

    /// The hold at the unattended limit, on its way to `next`.
    pub(crate) fn holding(next: UpNextEpisode) -> Self {
        Self {
            next,
            stage: Stage::Holding,
        }
    }

    /// The same episode, after continuity found no Stream for it.
    pub(crate) fn without_stream(self, detail: String) -> Self {
        Self {
            next: self.next,
            stage: Stage::NoStream { detail },
        }
    }

    /// Whether the countdown has run out at `now`. A hold, or a countdown that
    /// already ended in a missing Stream, does not run out: only a play, a
    /// cancel, a stop or switching Autoplay off ends them.
    pub(crate) fn expired(&self, now: i64) -> bool {
        matches!(self.stage, Stage::Counting { .. }) && self.remaining_millis(now) == 0
    }

    fn remaining_millis(&self, now: i64) -> i64 {
        let Stage::Counting { started_at } = self.stage else {
            return 0;
        };
        let elapsed = now.saturating_sub(started_at).max(0);
        AUTOPLAY_COUNTDOWN_MS.saturating_sub(elapsed).max(0)
    }

    /// What a Snapshot built at `now` says: the time left is the one true at
    /// this moment, so a client that connects mid-countdown draws the right digit.
    pub(crate) fn snapshot(&self, now: i64) -> AutoplaySnapshot {
        AutoplaySnapshot {
            next: self.next.clone(),
            phase: match &self.stage {
                Stage::Counting { .. } => AutoplayPhase::Countdown {
                    remaining: self.remaining_millis(now) as f64 / 1_000.0,
                    duration: AUTOPLAY_COUNTDOWN_MS as f64 / 1_000.0,
                },
                Stage::Holding => AutoplayPhase::UnattendedLimit {},
                Stage::NoStream { detail } => AutoplayPhase::NoStream {
                    detail: detail.clone(),
                },
            },
        }
    }
}

/// What the Host does about an episode that ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Outcome {
    /// Nothing is offered: the Host stays on the plain ended state.
    None,
    /// Start the countdown to this Video.
    Start(Video),
    /// Hold on "Still watching?" at this Video: the unattended limit is reached,
    /// so there is no countdown, and only a play moves on.
    Hold(Video),
}

/// Decide what happens when an episode's Stream ends, given the Video that
/// stands after it in its Title's own list (or none), and now.
///
/// There is no countdown where there is no next Video — the series' last
/// numbered episode, or the last special — and none where the next Video has not
/// aired yet: its `air_date` is after today in UTC. An absent date, or one that
/// is today or earlier, is eligible. Seasons are crossed, and the line between
/// the numbered seasons and the specials is not: that is the neighbour's own
/// rule ([`crate::meta::next_video`], ADR-0039), already applied by whoever
/// found `next`.
///
/// Where there is a next Video that has aired, `unattended` — how many episodes
/// in a row Autoplay has started with nobody touching anything — decides between
/// a countdown and the hold: at [`UNATTENDED_LIMIT`] the answer is `Hold`.
pub fn on_ended(next: Option<Video>, now_millis: i64, unattended: u32) -> Outcome {
    let Some(next) = next else {
        return Outcome::None;
    };
    let aired = next
        .air_date
        .as_deref()
        .is_none_or(|day| day <= utc_day(now_millis).as_str());

    if !aired {
        Outcome::None
    } else if unattended >= UNATTENDED_LIMIT {
        Outcome::Hold(next)
    } else {
        Outcome::Start(next)
    }
}

/// Whether a client's Action counts as somebody being there, which resets the
/// unattended count.
///
/// Any Change does — a pause, a seek, a volume, a play — and the questions a
/// client asks to draw a screen are not Changes. The one exception is the look
/// hint: it is a client warming a Title it is about to draw, whether or not
/// anybody is looking, so it does not say a person is there (ADR-0038 §3).
pub(crate) fn attends(action: &ValidatedAction) -> bool {
    !action.is_question() && !matches!(action, ValidatedAction::LookHint { .. })
}

/// The calendar day, in UTC, that this many milliseconds since the Unix epoch
/// fall on, as `YYYY-MM-DD`.
pub(crate) fn utc_day(millis: i64) -> String {
    // The civil-from-days conversion: days since 1970-01-01 to a proleptic
    // Gregorian date, with no calendar crate for one comparison.
    let days = millis.div_euclid(86_400_000) + 719_468;
    let era = days.div_euclid(146_097);
    let day_of_era = days.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let shifted_month = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * shifted_month + 2) / 5 + 1;
    let month = if shifted_month < 10 {
        shifted_month + 3
    } else {
        shifted_month - 9
    };
    let year = year_of_era + era * 400 + i64::from(month <= 2);

    format!("{year:04}-{month:02}-{day:02}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::action::{Action, ACTION_VERSION};

    /// 2026-11-17 00:00:00 UTC, and the last second of that day.
    const MIDNIGHT: i64 = 1_794_873_600_000;
    const LAST_SECOND: i64 = 1_794_959_999_000;

    fn video(id: &str, air_date: Option<&str>) -> Video {
        Video {
            air_date: air_date.map(str::to_owned),
            ..Video::keyed(id)
        }
    }

    #[test]
    fn utc_day_names_the_calendar_day_in_utc() {
        assert_eq!(utc_day(0), "1970-01-01");
        assert_eq!(utc_day(MIDNIGHT), "2026-11-17");
        assert_eq!(utc_day(LAST_SECOND), "2026-11-17");
        assert_eq!(utc_day(LAST_SECOND + 1_000), "2026-11-18");
        assert_eq!(utc_day(1_709_164_800_000), "2024-02-29");
        assert_eq!(utc_day(951_868_800_000), "2000-03-01");
    }

    fn episode() -> UpNextEpisode {
        UpNextEpisode {
            title: TitleRef::parse("series", "tt1").expect("a Title"),
            video: VideoRef::parse("series", "tt1:1:4").expect("a Video"),
            episode: Episode {
                season: 1,
                episode: 4,
            },
            name: None,
            still: None,
        }
    }

    #[test]
    fn a_countdown_has_five_seconds_and_runs_out_on_the_clock() {
        let pending = Pending::starting(episode(), 10_000);
        let left = |now| match pending.snapshot(now).phase {
            AutoplayPhase::Countdown { remaining, .. } => remaining,
            other => panic!("a countdown, not {other:?}"),
        };

        assert_eq!(left(10_000), 5.0);
        assert_eq!(left(12_500), 2.5);
        assert_eq!(left(14_999), 0.001);
        assert!(!pending.expired(14_999));
        assert!(pending.expired(15_000));
        assert_eq!(left(60_000), 0.0, "never below zero");
        assert_eq!(left(9_000), 5.0, "a clock that went back is the start");
    }

    #[test]
    fn the_snapshot_says_how_long_the_countdown_is_in_seconds() {
        let wire = serde_json::to_value(Pending::starting(episode(), 0).snapshot(2_000))
            .expect("a Snapshot serializes");

        assert_eq!(
            (&wire["phase"], &wire["remaining"], &wire["duration"]),
            (
                &serde_json::json!("countdown"),
                &serde_json::json!(3.0),
                &serde_json::json!(5.0)
            ),
            "the phase is flat on the Snapshot, tagged `phase`, not a nested object"
        );
        assert_eq!(
            wire["next"]["episode"],
            serde_json::json!({ "season": 1, "episode": 4 })
        );
        assert_eq!(wire["next"]["video"]["id"], "tt1:1:4");
    }

    #[test]
    fn a_snapshot_with_a_field_nobody_declared_is_refused() {
        let mut wire = serde_json::to_value(Pending::starting(episode(), 0).snapshot(1_000))
            .expect("a Snapshot serializes");
        wire["surprise"] = serde_json::json!(true);

        assert!(
            serde_json::from_value::<AutoplaySnapshot>(wire).is_err(),
            "flattening the phase must not open the Snapshot to unknown fields"
        );
    }

    #[test]
    fn the_snapshot_round_trips_the_wire() {
        let snapshot = Pending::starting(episode(), 0).snapshot(1_500);
        let wire = serde_json::to_string(&snapshot).expect("a Snapshot serializes");

        assert_eq!(
            serde_json::from_str::<AutoplaySnapshot>(&wire).expect("and reads back"),
            snapshot
        );
    }

    #[test]
    fn a_missing_stream_is_flat_on_the_wire_and_never_runs_out_again() {
        let pending = Pending::starting(episode(), 0).without_stream("no Stream".to_owned());
        let wire = serde_json::to_value(pending.snapshot(60_000)).expect("a Snapshot serializes");

        assert_eq!(wire["phase"], "no_stream");
        assert_eq!(wire["detail"], "no Stream");
        assert_eq!(wire["next"]["video"]["id"], "tt1:1:4");
        assert!(wire.get("remaining").is_none());
        assert!(
            !pending.expired(60_000),
            "there is nothing left to wait for"
        );
        assert_eq!(
            serde_json::from_value::<AutoplaySnapshot>(wire).expect("and reads back"),
            pending.snapshot(60_000)
        );
    }

    #[test]
    fn no_next_video_starts_nothing() {
        // The series' last numbered episode, or the last special.
        assert_eq!(on_ended(None, MIDNIGHT, 0), Outcome::None);
    }

    #[test]
    fn an_episode_that_has_not_aired_yet_starts_nothing() {
        let tomorrow = video("tt1:1:4", Some("2026-11-18"));
        assert_eq!(on_ended(Some(tomorrow), MIDNIGHT, 0), Outcome::None);
        // Even in the last second of today, tomorrow is tomorrow.
        let tomorrow = video("tt1:1:4", Some("2026-11-18"));
        assert_eq!(on_ended(Some(tomorrow), LAST_SECOND, 0), Outcome::None);
    }

    #[test]
    fn an_episode_aired_today_or_before_or_undated_starts() {
        for air_date in [Some("2026-11-17"), Some("2008-01-20"), None] {
            let next = video("tt1:1:4", air_date);
            assert_eq!(
                on_ended(Some(next.clone()), MIDNIGHT, 0),
                Outcome::Start(next),
                "air date {air_date:?}"
            );
        }
    }

    #[test]
    fn a_finale_leads_into_the_next_seasons_first_episode() {
        let premiere = video("tt1:2:1", Some("2026-11-17"));
        assert_eq!(
            on_ended(Some(premiere.clone()), MIDNIGHT, 0),
            Outcome::Start(premiere)
        );
    }

    #[test]
    fn three_unattended_advances_hold_the_next_one() {
        let next = video("tt1:1:5", Some("2008-01-20"));
        for before in 0..UNATTENDED_LIMIT {
            assert_eq!(
                on_ended(Some(next.clone()), MIDNIGHT, before),
                Outcome::Start(next.clone()),
                "after {before} unattended advances"
            );
        }
        assert_eq!(
            on_ended(Some(next.clone()), MIDNIGHT, UNATTENDED_LIMIT),
            Outcome::Hold(next.clone())
        );
        assert_eq!(
            on_ended(Some(next.clone()), MIDNIGHT, UNATTENDED_LIMIT + 5),
            Outcome::Hold(next)
        );
    }

    #[test]
    fn nothing_to_advance_to_is_not_a_question_about_being_there() {
        // The last episode and one that has not aired offer no countdown, so
        // there is nothing to ask "Still watching?" about either.
        assert_eq!(on_ended(None, MIDNIGHT, UNATTENDED_LIMIT), Outcome::None);
        let tomorrow = video("tt1:1:5", Some("2026-11-18"));
        assert_eq!(
            on_ended(Some(tomorrow), MIDNIGHT, UNATTENDED_LIMIT),
            Outcome::None
        );
    }

    #[test]
    fn a_hold_has_no_countdown_and_never_runs_out() {
        let hold = Pending::holding(episode());

        assert!(!hold.expired(0));
        assert!(!hold.expired(i64::MAX));
        assert_eq!(
            hold.snapshot(60_000).phase,
            AutoplayPhase::UnattendedLimit {}
        );
    }

    #[test]
    fn the_hold_is_flat_on_the_wire_and_round_trips() {
        let snapshot = Pending::holding(episode()).snapshot(0);
        let wire = serde_json::to_value(&snapshot).expect("a Snapshot serializes");

        assert_eq!(wire["phase"], "unattended_limit");
        assert!(wire.get("remaining").is_none() && wire.get("duration").is_none());
        assert_eq!(wire["next"]["video"]["id"], "tt1:1:4");
        assert_eq!(
            serde_json::from_value::<AutoplaySnapshot>(wire).expect("and reads back"),
            snapshot
        );
    }

    #[test]
    fn a_hold_with_a_field_nobody_declared_is_refused() {
        let mut wire = serde_json::to_value(Pending::holding(episode()).snapshot(0))
            .expect("a Snapshot serializes");
        wire["remaining"] = serde_json::json!(3.0);

        assert!(serde_json::from_value::<AutoplaySnapshot>(wire).is_err());
    }

    fn change(body: &str) -> ValidatedAction {
        Action::parse(&format!(
            r#"{{"version":{ACTION_VERSION},"action":{body}}}"#
        ))
        .expect("an Action")
        .validate()
        .expect("a valid Action")
    }

    #[test]
    fn any_change_counts_as_somebody_being_there_but_a_look_hint() {
        for body in [
            r#"{"type":"seek","target":{"kind":"to","seconds":1.0}}"#,
            r#"{"type":"set_paused","paused":true}"#,
            r#"{"type":"set_volume","level":40.0}"#,
            r#"{"type":"next_episode"}"#,
            r#"{"type":"cancel_autoplay"}"#,
            r#"{"type":"set_autoplay","autoplay":true}"#,
            r#"{"type":"stop_playback"}"#,
        ] {
            assert!(attends(&change(body)), "{body}");
        }

        assert!(
            !attends(&change(
                r#"{"type":"search","query":"matrix","kind":"movie","page":1}"#
            )),
            "a question is a client drawing a screen"
        );

        let hint = change(
            r#"{"type":"look_hint","addon":null,"title":{"type":"series","id":"tt0903747"}}"#,
        );
        assert!(
            !attends(&hint),
            "a look hint is a client being busy, not a person being there"
        );
    }
}
