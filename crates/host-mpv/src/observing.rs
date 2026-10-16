//! What mpv says, folded into the Host's own words.
//!
//! The half of the Player that comes back: the memory of what mpv's events said
//! about the open it was given, the properties mpv answers with, and
//! [`observe`] — a pure function of the two, returning the Host's
//! [`Observation`]. Everything mpv-shaped stops here: nothing above this module
//! names `time-pos` or `eof-reached` (ADR-0013).

use host_core::{Observation, PlaybackState};

/// What mpv's own events have said about the open the Player was given.
///
/// The part mpv only says once, in an event: whether an open was asked for, and
/// how the last one ended. Everything else the Player reports is read from
/// properties, which can be asked for at any time.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct Memory {
    /// Whether an open has been asked for and nothing has closed it since.
    asking: bool,
    /// How the last open ended, when it did.
    ending: Option<Ending>,
    /// Whether the Stream now being watched has already been reported on.
    /// Set when the picture first comes up, cleared with every new open, so
    /// that what mpv says about one Stream is said once.
    watching: bool,
}

/// How an open ended, where it did not simply keep playing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Ending {
    /// The Stream played to its end.
    AtEnd,
    /// The Stream could not be opened, in mpv's own words.
    Failed(String),
}

impl Memory {
    /// Nothing has been asked for.
    pub(crate) fn idle() -> Self {
        Self::default()
    }

    /// An open has just been asked for: nothing is known about it yet.
    pub(crate) fn asking() -> Self {
        Self {
            asking: true,
            ending: None,
            watching: false,
        }
    }

    /// mpv started a file: whatever was said about the last ending is over.
    pub(crate) fn started(&mut self) {
        self.asking = true;
        self.ending = None;
    }

    /// Whether this observation is the first sight of a Stream's picture *and*
    /// there is something to say about how it is being drawn — which is once
    /// per Stream, and not before mpv has configured its video output.
    ///
    /// `drawing` is whether mpv has answered what the picture's frames are:
    /// asking it the moment the position appears would report a video output
    /// that has not been set up yet, which is a fact about the timing and not
    /// about the picture.
    pub(crate) fn reported(&mut self, observation: &Observation, drawing: bool) -> bool {
        if self.watching {
            return false;
        }
        let up = matches!(
            observation.state,
            PlaybackState::Playing | PlaybackState::Paused
        );
        if up && drawing {
            self.watching = true;
        }
        up && drawing
    }

    /// mpv played a file to its end.
    pub(crate) fn reached_end(&mut self) {
        self.ending = Some(Ending::AtEnd);
    }

    /// mpv could not play a file.
    pub(crate) fn failed(&mut self, words: String) {
        self.ending = Some(Ending::Failed(words));
    }

    /// mpv let a file go because something replaced it, or because it was told
    /// to stop.
    ///
    /// Nothing is concluded here: a replacement's `stop` arrives *after* the
    /// open that replaced it, and the Player's own `stop` says so itself, so the
    /// next file's start or the Player's own call is what settles it.
    pub(crate) fn let_go(&mut self) {}
}

/// What mpv's properties answer at one moment.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Properties {
    /// Whether a file is loaded: mpv answers with a `path`.
    pub(crate) loaded: bool,
    /// Whether playback is held: mpv's `pause`.
    pub(crate) paused: bool,
    /// Whether the file was played to its end: mpv's `eof-reached`, which —
    /// with `keep-open` — stays as it was reached instead of unloading the file.
    pub(crate) ended: bool,
    /// Where playback is in seconds, where mpv has a position to give.
    pub(crate) position: Option<f64>,
    /// How long the file is in seconds, where it says — a live Stream does not.
    pub(crate) duration: Option<f64>,
}

/// What the Player is doing, from the memory of mpv's events and the properties
/// mpv answers with.
///
/// Pure, and the whole of the Player's reading half. A Stream in flight is
/// `opening` until mpv has a file; a file mpv could not play is nothing playing,
/// with mpv's words for why; a file at its end is `ended` *before* it is
/// `paused`, because mpv pauses the player itself when a file reaches its end
/// with `keep-open`, and "paused" would then be the truth about a property and a
/// lie about the Stream.
pub(crate) fn observe(memory: &Memory, properties: &Properties) -> Observation {
    if let Some(Ending::Failed(words)) = &memory.ending {
        return Observation {
            state: PlaybackState::Idle,
            position: None,
            duration: None,
            failure: Some(words.clone()),
        };
    }

    if !memory.asking {
        return Observation::idle();
    }

    let state = if !properties.loaded {
        PlaybackState::Opening
    } else if properties.ended {
        PlaybackState::Ended
    } else if properties.paused {
        PlaybackState::Paused
    } else {
        PlaybackState::Playing
    };

    Observation {
        state,
        position: properties.position,
        duration: properties.duration,
        failure: None,
    }
}

/// The words the Host publishes when a Stream could not be opened.
///
/// mpv says which error it was by number; this is that number in a sentence a
/// person reads. A code that is not worth naming is kept, so that a person
/// reporting a Stream that will not play has something to report.
pub(crate) fn failure_words(code: i32) -> String {
    let why = match code {
        libmpv2::mpv_error::LoadingFailed => "mpv could not load it".to_owned(),
        libmpv2::mpv_error::Unsupported => "mpv does not support that Stream".to_owned(),
        libmpv2::mpv_error::NothingToPlay => "mpv found nothing to play there".to_owned(),
        other => format!("mpv reported error {other}"),
    };

    format!("That Stream could not be opened — {why}.")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn loading() -> Properties {
        Properties {
            loaded: false,
            paused: false,
            ended: false,
            position: None,
            duration: None,
        }
    }

    #[test]
    fn mpv_could_not_load_it_is_the_words_a_client_reads() {
        assert_eq!(
            failure_words(libmpv2::mpv_error::LoadingFailed),
            "That Stream could not be opened — mpv could not load it."
        );
        assert_eq!(
            failure_words(-1),
            "That Stream could not be opened — mpv reported error -1."
        );
    }

    #[test]
    fn a_player_nothing_was_ever_asked_of_is_idle() {
        assert_eq!(observe(&Memory::idle(), &loading()), Observation::idle());
    }

    #[test]
    fn an_open_in_flight_is_opening_until_mpv_has_a_file() {
        let asking = Memory::asking();

        assert_eq!(
            observe(&asking, &loading()).state,
            PlaybackState::Opening,
            "agreeing to open is not playing"
        );

        let loaded = Properties {
            loaded: true,
            position: Some(0.2),
            duration: Some(600.0),
            ..loading()
        };
        let observation = observe(&asking, &loaded);
        assert_eq!(observation.state, PlaybackState::Playing);
        assert_eq!(observation.position, Some(0.2));
        assert_eq!(observation.duration, Some(600.0));
        assert_eq!(observation.failure, None);
    }

    #[test]
    fn a_file_at_its_end_is_ended_before_it_is_paused() {
        let at_the_end = Properties {
            loaded: true,
            paused: true,
            ended: true,
            position: Some(600.0),
            duration: Some(600.0),
        };

        let observation = observe(&Memory::asking(), &at_the_end);

        assert_eq!(observation.state, PlaybackState::Ended);
        assert_eq!(
            observation.position,
            Some(600.0),
            "where it ended is where a resume starts from (#29)"
        );
    }

    #[test]
    fn a_paused_file_is_paused_and_holds_its_position() {
        let paused = Properties {
            loaded: true,
            paused: true,
            ended: false,
            position: Some(12.5),
            duration: Some(600.0),
        };

        let observation = observe(&Memory::asking(), &paused);

        assert_eq!(observation.state, PlaybackState::Paused);
        assert_eq!(observation.position, Some(12.5));
    }

    #[test]
    fn an_open_that_failed_is_nothing_playing_with_mpvs_words_for_why() {
        let mut memory = Memory::asking();
        memory.failed(failure_words(libmpv2::mpv_error::LoadingFailed));

        let observation = observe(&memory, &loading());

        assert_eq!(observation.state, PlaybackState::Idle);
        assert_eq!(
            observation.failure.as_deref(),
            Some("That Stream could not be opened — mpv could not load it."),
            "the failure is the Player's own words, and they are what a client reads"
        );
    }

    #[test]
    fn a_streams_picture_is_reported_on_once_and_only_once() {
        let mut memory = Memory::asking();
        let playing = Properties {
            loaded: true,
            paused: false,
            ended: false,
            position: Some(1.0),
            duration: Some(10.0),
        };

        let first = observe(&memory, &playing);
        assert!(
            !memory.reported(&first, false),
            "a picture whose video output has not been configured says nothing yet"
        );
        assert!(
            memory.reported(&first, true),
            "the first sight of a picture with frames is when mpv's decode is worth logging"
        );
        assert!(
            !memory.reported(&first, true),
            "the four ticks a second after it are not"
        );

        let mut fresh = Memory::asking();
        let opening = observe(&fresh, &loading());
        assert!(
            !fresh.reported(&opening, true),
            "an open in flight has no picture to report on yet"
        );
    }

    #[test]
    fn a_new_file_ends_whatever_the_last_one_said_about_how_it_went() {
        let mut memory = Memory::asking();
        memory.failed("That Stream could not be opened — mpv could not load it.".to_owned());
        memory.started();

        let observation = observe(&memory, &loading());

        assert_eq!(observation.state, PlaybackState::Opening);
        assert_eq!(
            observation.failure, None,
            "a new open is not the last one's failure"
        );
    }
}
