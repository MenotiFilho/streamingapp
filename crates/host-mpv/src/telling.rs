//! What the Host tells mpv, in mpv's own command vocabulary.
//!
//! The half of the Player that goes outward: a [`Telling`] is one thing the Host
//! asked for, and [`Telling::command`] is how mpv spells it — `loadfile`,
//! `seek`, `set pause`, `stop`. Pure, so what the Host means by a control is
//! tested without a player (ADR-0013).

use host_core::{SeekTarget, StreamUrl};

/// One thing the Host tells the Player to do, in the Host's own terms — which
/// mpv then spells.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Telling {
    /// Open a Stream, whatever was playing.
    Load(StreamUrl),
    /// Hold the picture where it is, or let it run.
    Pause(bool),
    /// Move within the Stream.
    Seek(SeekTarget),
    /// Let the Stream go.
    Stop,
}

impl Telling {
    /// The mpv command this telling is: a name and its arguments, mpv's own
    /// spelling of what the Host asked for.
    ///
    /// Pausing goes through mpv's `set` command rather than the `pause` command
    /// of the same name: mpv 0.37's `pause` command *toggles* the property and
    /// ignores its argument, so "pause" sent to an already-paused player would
    /// resume it.
    pub(crate) fn command(&self) -> (&'static str, Vec<String>) {
        match self {
            Telling::Load(url) => (
                "loadfile",
                vec![url.as_str().to_owned(), "replace".to_owned()],
            ),
            Telling::Pause(paused) => (
                "set",
                vec![
                    "pause".to_owned(),
                    if *paused { "yes" } else { "no" }.to_owned(),
                ],
            ),
            Telling::Seek(SeekTarget::To { seconds }) => {
                ("seek", vec![seconds.to_string(), "absolute".to_owned()])
            }
            Telling::Seek(SeekTarget::By { seconds }) => {
                ("seek", vec![seconds.to_string(), "relative".to_owned()])
            }
            Telling::Stop => ("stop", Vec::new()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url() -> StreamUrl {
        StreamUrl::parse("https://stream.example.org/v/tt0133093.mkv").expect("a Stream URL")
    }

    #[test]
    fn every_telling_is_mpvs_own_spelling_of_it() {
        let cases = [
            (
                Telling::Load(url()),
                (
                    "loadfile",
                    vec![
                        "https://stream.example.org/v/tt0133093.mkv".to_owned(),
                        "replace".to_owned(),
                    ],
                ),
            ),
            (
                Telling::Pause(true),
                ("set", vec!["pause".to_owned(), "yes".to_owned()]),
            ),
            (
                Telling::Pause(false),
                ("set", vec!["pause".to_owned(), "no".to_owned()]),
            ),
            (
                Telling::Seek(SeekTarget::To { seconds: 120.5 }),
                ("seek", vec!["120.5".to_owned(), "absolute".to_owned()]),
            ),
            (
                Telling::Seek(SeekTarget::By { seconds: -10.0 }),
                ("seek", vec!["-10".to_owned(), "relative".to_owned()]),
            ),
            (Telling::Stop, ("stop", Vec::new())),
        ];

        for (telling, expected) in cases {
            assert_eq!(
                telling.command(),
                expected,
                "{telling:?} is not what mpv is told"
            );
        }
    }

    #[test]
    fn a_pause_is_a_setting_rather_than_a_toggle() {
        let (name, arguments) = Telling::Pause(true).command();

        assert_eq!(name, "set");
        assert_eq!(arguments, vec!["pause".to_owned(), "yes".to_owned()]);
    }
}
