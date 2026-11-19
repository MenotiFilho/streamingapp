//! The Host's side of Autoplay: arming the countdown when an episode ends,
//! playing the next one when it runs out, and what every change does to it
//! (ADR-0040).
//!
//! A child of [`super`] so it reads the Host's private state without widening
//! anything: the decisions are the pure ones in [`crate::autoplay`], and what
//! happens here is the Host's own I/O through the seams `next_episode` uses — the
//! same `stepped` path, with the same continuity and the same commit.

use crate::action::ActionError;
use crate::autoplay::{self, Outcome, Pending, UpNextEpisode};
use crate::meta::{self, Video};
use crate::playback::Episode;
use crate::request::{TitleRef, VideoRef};
use crate::snapshot::Snapshot;
use crate::state::Change;

use super::{EpisodeStep, Host, Resolved};

/// What a change does to the Autoplay countdown.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum CountdownEffect {
    /// Nothing: the countdown, if there is one, runs on.
    Keep,
    /// It is over: replaced by a play, or stopped by the owner.
    End,
    /// Start one, if the Host is sitting on an ended episode that has a next.
    Arm,
}

impl CountdownEffect {
    /// What `change` does to the countdown: a play replaces it, a stop, a cancel
    /// and switching Autoplay off end it, and switching Autoplay on starts one
    /// where the Host is sitting on an ended episode.
    pub(super) fn of(change: &Change) -> Self {
        match change {
            Change::Play { .. }
            | Change::Stop
            | Change::SetAutoplay(false)
            | Change::CancelAutoplay => CountdownEffect::End,
            Change::SetAutoplay(true) => CountdownEffect::Arm,
            _ => CountdownEffect::Keep,
        }
    }
}

impl Host {
    /// Apply what a committed change did to the countdown.
    pub(super) fn settle_countdown(&mut self, countdown: CountdownEffect) {
        match countdown {
            CountdownEffect::Keep => {}
            CountdownEffect::End => self.autoplay = None,
            CountdownEffect::Arm => {
                if self.autoplay.is_none() {
                    self.autoplay = self.countdown_to_next();
                }
            }
        }
    }

    /// The countdown owed to the episode that has just ended, or nothing.
    ///
    /// Only an episode of a series arms one (a film's Video is not an episode),
    /// only with Autoplay on, and only where the Title's own list has a Video
    /// after it that has aired ([`autoplay::on_ended`]). The list is the one
    /// `next_episode` reads, so what counts down is what the Next episode button
    /// would play (ADR-0040). Asking for it is Addon I/O, like the subtitle
    /// fallback in the same tick (ADR-0014).
    pub(super) fn countdown_to_next(&self) -> Option<Pending> {
        if !self.state.preferences().autoplay() || !self.state.playback().has_ended() {
            return None;
        }
        let finished = &self.state.playback().chosen()?.now_playing.video;
        meta::episode_of(&finished.id)?;

        let now = self.clock.now_millis();
        let neighbour = self.neighbour_video(EpisodeStep::Next, finished).ok();
        match autoplay::on_ended(neighbour, now, self.unattended) {
            Outcome::Start(video) => {
                let next = up_next_episode(&finished.r#type, &video)?;
                Some(Pending::countdown(next, now))
            }
            // Nobody has touched anything for the whole run: no countdown, and
            // only a play moves on.
            Outcome::Hold(video) => {
                let next = up_next_episode(&finished.r#type, &video)?;
                Some(Pending::unattended_limit(next))
            }
            Outcome::None => None,
        }
    }

    /// The countdown has run out: play the next episode as `next_episode` would,
    /// or — where continuity finds no Stream — stay on the ended state with the
    /// countdown cleared. Either way every client is owed a Snapshot.
    pub(super) fn autoplay_expired(&mut self) -> Option<Snapshot> {
        let pending = self.autoplay.take();
        let outcome = self.stepped(EpisodeStep::Next);
        match outcome {
            Ok(Resolved::Change(change)) => {
                if let Ok(mut response) = self.commit(change, None) {
                    // The Host played this one and no client asked for it: it
                    // is one more episode nobody has touched.
                    self.unattended += 1;
                    return response.snapshots.pop();
                }
                // The store refused the play: the Host stays on the ended
                // state, as for a Stream that was not found.
                self.autoplay = pending.map(|pending| {
                    pending.no_stream("the Host could not start the next episode".to_owned())
                });
            }
            Ok(_) => {}
            Err(error) => {
                // Continuity found nothing: the Host says so and holds the
                // ended state, and the clients offer the Streams picker.
                self.autoplay = pending.map(|pending| pending.no_stream(refusal_detail(&error)));
            }
        }
        self.revision += 1;
        Some(self.snapshot())
    }
}

/// Why a step found nothing, as a sentence a client can show: the refusal's own
/// detail where it carries one, else its message.
fn refusal_detail(error: &ActionError) -> String {
    match error {
        ActionError::NoNextEpisode { detail } | ActionError::NoPreviousEpisode { detail } => {
            detail.clone()
        }
        other => other.to_string(),
    }
}

/// The episode `video` is, as Autoplay tells every client of it: its Title is
/// the one its id carries, of the type the finished episode's Title had.
fn up_next_episode(r#type: &str, video: &Video) -> Option<UpNextEpisode> {
    let (title, season, episode) = meta::episode_of(&video.id)?;
    Some(UpNextEpisode {
        title: TitleRef::parse(r#type, title).ok()?,
        video: VideoRef::parse(r#type, &video.id).ok()?,
        episode: Episode {
            season: video.season.unwrap_or(season),
            episode: video.episode.unwrap_or(episode),
        },
        name: video.name.clone(),
        still: video.thumbnail.clone(),
    })
}
