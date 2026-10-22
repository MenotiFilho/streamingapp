//! What the Host tells mpv, in mpv's own command vocabulary.
//!
//! The half of the Player that goes outward: the Host's own
//! [`Telling`](host_core::Telling) is what it *means*, and this is how mpv
//! spells it — `loadfile`, `seek`, `set pause`, `set aid`, `sub-add`, `stop`.
//! Pure, so what the Host means by a control is tested without a player
//! (ADR-0013), and faithful to the vocabulary mpv 0.37 answers
//! (`docs/research/mpv-control-facts.md`).

use host_core::{Aspect, ChapterStep, Crop, SeekTarget, StreamUrl, Telling};

use crate::AUTOCROP_SCRIPT_STEM;

/// The command that opens a Stream, whatever was playing.
///
/// Opening is not a [`Telling`]: it is a method of the Player's own, so it is
/// not one of the controls a client asks for.
pub(crate) fn load(url: &StreamUrl) -> (&'static str, Vec<String>) {
    (
        "loadfile",
        vec![url.as_str().to_owned(), "replace".to_owned()],
    )
}

/// The option that starts the next file where a resume left off, in mpv's own
/// spelling: a number of seconds, or `none` for the file's own beginning.
///
/// `start` is a property mpv reads when it *loads* a file, not a command it
/// applies afterwards — which is why it is set before [`load`] rather than sent
/// as a seek, and why opening is where it belongs. It is set on every open,
/// `none` included, so that a Stream opened after a resume does not inherit the
/// position the resume began at. It is a *string* property, and mpv refuses a
/// number with `MPV_ERROR_PROPERTY_FORMAT`; `none` rather than `no` is mpv's own
/// word for unset, which is what a plain read of it answers (verified against
/// mpv 0.37, the version this container builds against).
pub(crate) fn start(start: Option<f64>) -> (&'static str, String) {
    (
        "start",
        start
            .map(|seconds| seconds.to_string())
            .unwrap_or_else(|| "none".to_owned()),
    )
}

/// The command that lets the Stream go.
pub(crate) fn stop() -> (&'static str, Vec<String>) {
    ("stop", Vec::new())
}

/// The mpv command a telling is: a name and its arguments, mpv's own spelling
/// of what the Host asked for.
///
/// Pausing goes through mpv's `set` command rather than the `pause` command of
/// the same name: mpv 0.37's `pause` command *toggles* the property and ignores
/// its argument, so "pause" sent to an already-paused player would resume it.
///
/// Clearing a crop is `video-crop ""`, not `video-crop no` and no longer
/// `0x0+0+0`: `no` is rejected by mpv 0.41, and `0x0+0+0` reads back as that
/// string rather than as empty, which the stock autocrop script reads as "a crop
/// is set" and would clear instead of detect. The empty string is the script's
/// own clear (`set file-local-options/video-crop ''`) and is what the reading
/// half already treats as uncropped (#119, ADR-0014). The autocrop toggle is
/// the script's own binding, named after the file it was written as. Source
/// aspect is `no`, because `video-aspect-override` is a number and `no` is mpv's
/// own word for "none".
pub(crate) fn command(telling: &Telling) -> (&'static str, Vec<String>) {
    match telling {
        Telling::Pause(paused) => ("set", vec!["pause".to_owned(), yes_no(*paused)]),
        Telling::Seek(SeekTarget::To { seconds }) => {
            ("seek", vec![seconds.to_string(), "absolute".to_owned()])
        }
        Telling::Seek(SeekTarget::By { seconds }) => {
            ("seek", vec![seconds.to_string(), "relative".to_owned()])
        }
        Telling::AudioTrack(id) => ("set", vec!["aid".to_owned(), id.to_string()]),
        Telling::SubtitleTrack(Some(id)) => ("set", vec!["sid".to_owned(), id.to_string()]),
        // Subtitles off, which mpv reads back as `false`.
        Telling::SubtitleTrack(None) => ("set", vec!["sid".to_owned(), "no".to_owned()]),
        Telling::SubtitleDelay { seconds } => {
            ("set", vec!["sub-delay".to_owned(), seconds.to_string()])
        }
        Telling::Speed { rate } => ("set", vec!["speed".to_owned(), rate.to_string()]),
        Telling::Volume { level } => ("set", vec!["volume".to_owned(), level.to_string()]),
        Telling::Muted(muted) => ("set", vec!["mute".to_owned(), yes_no(*muted)]),
        Telling::Chapter(ChapterStep::At { index }) => {
            ("set", vec!["chapter".to_owned(), index.to_string()])
        }
        Telling::Chapter(ChapterStep::Next) => ("add", vec!["chapter".to_owned(), "1".to_owned()]),
        Telling::Chapter(ChapterStep::Previous) => {
            ("add", vec!["chapter".to_owned(), "-1".to_owned()])
        }
        // The empty string is mpv's "no rectangle": the script's own clear, and
        // what the reading half treats as the whole picture.
        Telling::Crop(Crop::Off) => ("set", vec!["video-crop".to_owned(), String::new()]),
        Telling::Crop(Crop::Rectangle {
            width,
            height,
            x,
            y,
        }) => (
            "set",
            vec!["video-crop".to_owned(), format!("{width}x{height}+{x}+{y}")],
        ),
        // The stock script's own toggle: the first press detects the bars and
        // crops to them, the second restores the full frame. Nothing is cleared
        // first — the script reads `video-crop` to decide, and an empty one is
        // exactly what makes it detect (#119).
        Telling::Autocrop => (
            "script-binding",
            vec![format!("{AUTOCROP_SCRIPT_STEM}/toggle_crop")],
        ),
        Telling::Aspect(Aspect::Source) => (
            "set",
            vec!["video-aspect-override".to_owned(), "no".to_owned()],
        ),
        Telling::Aspect(Aspect::Ratio { value }) => (
            "set",
            vec!["video-aspect-override".to_owned(), value.to_string()],
        ),
        // An empty `slang` is how mpv is told to prefer nothing; the Host tells
        // it once at startup and with every change of the preference.
        Telling::SubtitleLanguage(Some(language)) => {
            ("set", vec!["slang".to_owned(), language.to_string()])
        }
        Telling::SubtitleLanguage(None) => ("set", vec!["slang".to_owned(), String::new()]),
        // The colour applies to subtitles that do not style themselves, and the
        // size to every subtitle: deliberately no `sub-ass-override`, so an ASS
        // track keeps the colour, font and typesetting it was authored with
        // (ADR-0024). `#RRGGBB` is the form mpv's own colour parser takes.
        Telling::SubtitleColor(color) => (
            "set",
            vec!["sub-color".to_owned(), color.as_str().to_owned()],
        ),
        Telling::SubtitleScale(scale) => (
            "set",
            vec!["sub-scale".to_owned(), scale.value().to_string()],
        ),
        Telling::AddSubtitle {
            url,
            title,
            language,
        } => {
            // `sub-add <url> auto [<title> [<lang>]]`: the positional tail means
            // a language with no title needs an empty title to stand in for it.
            let mut arguments = vec![url.as_str().to_owned(), "auto".to_owned()];
            if title.is_some() || language.is_some() {
                arguments.push(title.clone().unwrap_or_default());
            }
            if let Some(language) = language {
                arguments.push(language.clone());
            }
            ("sub-add", arguments)
        }
    }
}

/// mpv's own words for a boolean property.
fn yes_no(value: bool) -> String {
    if value { "yes" } else { "no" }.to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use host_core::TrackId;

    fn url() -> StreamUrl {
        StreamUrl::parse("https://stream.example.org/v/tt0133093.mkv").expect("a Stream URL")
    }

    #[test]
    fn opening_and_stopping_a_stream_are_mpvs_own_commands() {
        assert_eq!(
            load(&url()),
            (
                "loadfile",
                vec![
                    "https://stream.example.org/v/tt0133093.mkv".to_owned(),
                    "replace".to_owned(),
                ],
            )
        );
        assert_eq!(stop(), ("stop", Vec::new()));
    }

    #[test]
    fn a_resume_point_is_mpvs_own_start_option() {
        assert_eq!(
            start(Some(402.5)),
            ("start", "402.5".to_owned()),
            "a resume begins where the Host's Watch progress left off"
        );
        assert_eq!(
            start(None),
            ("start", "none".to_owned()),
            "and a Stream with no resume point begins at its beginning"
        );
    }

    #[test]
    fn every_telling_is_mpvs_own_spelling_of_it() {
        let cases = [
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
            (
                Telling::AudioTrack(TrackId(1)),
                ("set", vec!["aid".to_owned(), "1".to_owned()]),
            ),
            (
                Telling::SubtitleTrack(Some(TrackId(2))),
                ("set", vec!["sid".to_owned(), "2".to_owned()]),
            ),
            (
                Telling::SubtitleTrack(None),
                ("set", vec!["sid".to_owned(), "no".to_owned()]),
            ),
            (
                Telling::SubtitleDelay { seconds: -0.5 },
                ("set", vec!["sub-delay".to_owned(), "-0.5".to_owned()]),
            ),
            (
                Telling::Speed { rate: 1.5 },
                ("set", vec!["speed".to_owned(), "1.5".to_owned()]),
            ),
            (
                Telling::Volume { level: 100.0 },
                ("set", vec!["volume".to_owned(), "100".to_owned()]),
            ),
            (
                Telling::Muted(true),
                ("set", vec!["mute".to_owned(), "yes".to_owned()]),
            ),
            (
                Telling::Chapter(ChapterStep::At { index: 3 }),
                ("set", vec!["chapter".to_owned(), "3".to_owned()]),
            ),
            (
                Telling::Chapter(ChapterStep::Next),
                ("add", vec!["chapter".to_owned(), "1".to_owned()]),
            ),
            (
                Telling::Chapter(ChapterStep::Previous),
                ("add", vec!["chapter".to_owned(), "-1".to_owned()]),
            ),
            (
                Telling::Crop(Crop::Off),
                ("set", vec!["video-crop".to_owned(), String::new()]),
            ),
            (
                Telling::Crop(Crop::Rectangle {
                    width: 96,
                    height: 72,
                    x: 16,
                    y: 0,
                }),
                (
                    "set",
                    vec!["video-crop".to_owned(), "96x72+16+0".to_owned()],
                ),
            ),
            (
                Telling::Autocrop,
                ("script-binding", vec!["autocrop/toggle_crop".to_owned()]),
            ),
            (
                Telling::Aspect(Aspect::Source),
                (
                    "set",
                    vec!["video-aspect-override".to_owned(), "no".to_owned()],
                ),
            ),
            (
                Telling::Aspect(Aspect::Ratio { value: 1.7778 }),
                (
                    "set",
                    vec!["video-aspect-override".to_owned(), "1.7778".to_owned()],
                ),
            ),
            (
                Telling::SubtitleLanguage(Some(
                    host_core::SubtitleLanguage::parse("pt-BR").expect("a language tag"),
                )),
                ("set", vec!["slang".to_owned(), "pt-BR".to_owned()]),
            ),
            (
                Telling::SubtitleLanguage(None),
                ("set", vec!["slang".to_owned(), String::new()]),
            ),
            (
                Telling::SubtitleColor(
                    host_core::SubtitleColor::parse("#FFCC00").expect("a subtitle colour"),
                ),
                ("set", vec!["sub-color".to_owned(), "#FFCC00".to_owned()]),
            ),
            (
                Telling::SubtitleScale(
                    host_core::SubtitleScale::parse(1.25).expect("a subtitle size"),
                ),
                ("set", vec!["sub-scale".to_owned(), "1.25".to_owned()]),
            ),
        ];

        for (telling, expected) in cases {
            assert_eq!(
                command(&telling),
                expected,
                "{telling:?} is not what mpv is told"
            );
        }
    }

    #[test]
    fn the_appearance_tellings_do_not_override_a_files_own_styling() {
        // `sub-ass-override=force` would recolour an ASS track, and would also
        // replace its authored fonts and typesetting. The appearance is a
        // preference about the colour and size only (ADR-0024).
        let cases = [
            Telling::SubtitleColor(
                host_core::SubtitleColor::parse("#FFCC00").expect("a subtitle colour"),
            ),
            Telling::SubtitleScale(host_core::SubtitleScale::parse(1.25).expect("a subtitle size")),
        ];
        for telling in cases {
            let (_, arguments) = command(&telling);
            assert_ne!(
                arguments.first().map(String::as_str),
                Some("sub-ass-override"),
                "{telling:?} must not force the file's own styling"
            );
        }
    }

    #[test]
    fn a_pause_is_a_setting_rather_than_a_toggle() {
        let (name, arguments) = command(&Telling::Pause(true));

        assert_eq!(name, "set");
        assert_eq!(arguments, vec!["pause".to_owned(), "yes".to_owned()]);
    }

    #[test]
    fn an_external_subtitle_is_added_auto_and_keeps_its_positional_tail() {
        // A language with no title still has to fill the title's place, because
        // mpv reads the tail by position.
        let (name, arguments) = command(&Telling::AddSubtitle {
            url: url(),
            title: None,
            language: Some("por".to_owned()),
        });
        assert_eq!(name, "sub-add");
        assert_eq!(
            arguments,
            vec![
                "https://stream.example.org/v/tt0133093.mkv".to_owned(),
                "auto".to_owned(),
                String::new(),
                "por".to_owned(),
            ]
        );

        let (_, arguments) = command(&Telling::AddSubtitle {
            url: url(),
            title: None,
            language: None,
        });
        assert_eq!(
            arguments,
            vec![
                "https://stream.example.org/v/tt0133093.mkv".to_owned(),
                "auto".to_owned(),
            ]
        );
    }
}
