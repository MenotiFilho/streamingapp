//! What the Host tells mpv, in mpv's own command vocabulary.
//!
//! The half of the Player that goes outward: the Host's own
//! [`Telling`](host_core::Telling) is what it *means*, and this is how mpv
//! spells it — `loadfile`, `seek`, `set pause`, `set aid`, `sub-add`, `stop`.
//! Pure, so what the Host means by a control is tested without a player
//! (ADR-0013), and faithful to the vocabulary mpv 0.37 answers
//! (`docs/research/mpv-control-facts.md`).

use host_core::{
    codes_for_list, Aspect, ChapterStep, Crop, LanguageList, SeekTarget, StreamBuffer, StreamUrl,
    Telling,
};

use crate::AUTOCROP_SCRIPT_STEM;

/// A language list as mpv's `slang` / `alang` take it: every entry widened
/// through the Host's code table, in order and with duplicates dropped, separated
/// by commas. `pt-BR,en` is `pt-BR,pob,en,eng`, so a Track tagged `pob` is in
/// mpv's first guess too (ADR-0041).
fn comma_joined(languages: &LanguageList) -> String {
    codes_for_list(languages).join(",")
}

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

/// The commands that open a Stream, in the order mpv is given them: the track
/// selection starts from mpv's own choice, the subtitle sync resets to zero,
/// and then the file is loaded.
///
/// `aid` and `sid` go back to `auto` because a `sid=no` from the last Stream
/// would otherwise carry into this one (mpv resets only a selection of a track
/// number, never "no"). `sub-delay` goes back to `0` because mpv retains it
/// across `loadfile replace`, and a subtitle timing offset belongs strictly to
/// one Stream (ADR-0044 §4). The Host's own choice comes after the file reports
/// its Tracks; what an owner picked in the player is carried by the Host as a
/// Hand pick, not by mpv (ADR-0041).
pub(crate) fn opening(url: &StreamUrl) -> Vec<(&'static str, Vec<String>)> {
    vec![
        ("set", vec!["aid".to_owned(), "auto".to_owned()]),
        ("set", vec!["sid".to_owned(), "auto".to_owned()]),
        ("set", vec!["sub-delay".to_owned(), "0".to_owned()]),
        load(url),
    ]
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

/// The mpv commands a telling is: a name and its arguments, mpv's own spelling
/// of what the Host asked for.
///
/// Most tellings are one call; a Stream buffer is three, because mpv bounds its
/// demuxer cache by a time and by two memory budgets and the Host states the
/// pair as one preference (ADR-0026). The order is the order mpv is given them
/// in, and a caller stops at the first refusal.
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
pub(crate) fn commands(telling: &Telling) -> Vec<(&'static str, Vec<String>)> {
    match telling {
        Telling::Pause(paused) => vec![("set", vec!["pause".to_owned(), yes_no(*paused)])],
        Telling::Seek(SeekTarget::To { seconds }) => {
            vec![("seek", vec![seconds.to_string(), "absolute".to_owned()])]
        }
        Telling::Seek(SeekTarget::By { seconds }) => {
            vec![("seek", vec![seconds.to_string(), "relative".to_owned()])]
        }
        Telling::AudioTrack(id) => vec![("set", vec!["aid".to_owned(), id.to_string()])],
        Telling::SubtitleTrack(Some(id)) => vec![("set", vec!["sid".to_owned(), id.to_string()])],
        // Subtitles off, which mpv reads back as `false`.
        Telling::SubtitleTrack(None) => vec![("set", vec!["sid".to_owned(), "no".to_owned()])],
        Telling::SubtitleDelay { seconds } => {
            vec![("set", vec!["sub-delay".to_owned(), seconds.to_string()])]
        }
        Telling::Speed { rate } => vec![("set", vec!["speed".to_owned(), rate.to_string()])],
        Telling::Volume { level } => vec![("set", vec!["volume".to_owned(), level.to_string()])],
        Telling::Muted(muted) => vec![("set", vec!["mute".to_owned(), yes_no(*muted)])],
        Telling::Chapter(ChapterStep::At { index }) => {
            vec![("set", vec!["chapter".to_owned(), index.to_string()])]
        }
        Telling::Chapter(ChapterStep::Next) => {
            vec![("add", vec!["chapter".to_owned(), "1".to_owned()])]
        }
        Telling::Chapter(ChapterStep::Previous) => {
            vec![("add", vec!["chapter".to_owned(), "-1".to_owned()])]
        }
        // The empty string is mpv's "no rectangle": the script's own clear, and
        // what the reading half treats as the whole picture.
        Telling::Crop(Crop::Off) => {
            vec![("set", vec!["video-crop".to_owned(), String::new()])]
        }
        Telling::Crop(Crop::Rectangle {
            width,
            height,
            x,
            y,
        }) => vec![(
            "set",
            vec!["video-crop".to_owned(), format!("{width}x{height}+{x}+{y}")],
        )],
        // The stock script's own toggle: the first press detects the bars and
        // crops to them, the second restores the full frame. Nothing is cleared
        // first — the script reads `video-crop` to decide, and an empty one is
        // exactly what makes it detect (#119).
        Telling::Autocrop => vec![(
            "script-binding",
            vec![format!("{AUTOCROP_SCRIPT_STEM}/toggle_crop")],
        )],
        Telling::Aspect(Aspect::Source) => vec![(
            "set",
            vec!["video-aspect-override".to_owned(), "no".to_owned()],
        )],
        Telling::Aspect(Aspect::Ratio { value }) => vec![(
            "set",
            vec!["video-aspect-override".to_owned(), value.to_string()],
        )],
        // The lists are mpv's first guess, each entry widened through the code
        // table. An empty list is an empty string, which is how mpv is told to
        // prefer nothing; the Host tells both once at startup and with every
        // change (ADR-0041).
        Telling::SubtitleLanguages(languages) => {
            vec![("set", vec!["slang".to_owned(), comma_joined(languages)])]
        }
        Telling::AudioLanguages(languages) => {
            vec![("set", vec!["alang".to_owned(), comma_joined(languages)])]
        }
        // The colour applies to subtitles that do not style themselves, and the
        // size to every subtitle: deliberately no `sub-ass-override`, so an ASS
        // track keeps the colour, font and typesetting it was authored with
        // (ADR-0024). `#RRGGBB` is the form mpv's own colour parser takes.
        Telling::SubtitleColor(color) => vec![(
            "set",
            vec!["sub-color".to_owned(), color.as_str().to_owned()],
        )],
        Telling::SubtitleScale(scale) => vec![(
            "set",
            vec!["sub-scale".to_owned(), scale.value().to_string()],
        )],
        // The buffer is the one telling that is more than one call: mpv bounds
        // its demuxer cache by three properties, and the Host's pair becomes
        // all three (ADR-0026).
        Telling::StreamBuffer(buffer) => stream_buffer_commands(*buffer),
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
            vec![("sub-add", arguments)]
        }
    }
}

/// The three mpv properties a Stream buffer is.
///
/// `cache-secs` is the look-ahead the demuxer aims for; the two `demuxer-max-*`
/// properties are the memory it may take, ahead and behind. mpv's own defaults
/// split that memory 3:1 (150 MiB ahead, 50 MiB behind), and the same split is
/// kept here so the Host's one number is the whole of the memory the cache can
/// take — neither half can grow past it. The unit the Host states is the decimal
/// megabyte, which is what the interface says.
fn stream_buffer_commands(buffer: StreamBuffer) -> Vec<(&'static str, Vec<String>)> {
    let total = buffer.megabytes() * 1_000_000;
    let behind = total / 4;
    let ahead = total - behind;

    vec![
        (
            "set",
            vec!["cache-secs".to_owned(), buffer.seconds().to_string()],
        ),
        (
            "set",
            vec!["demuxer-max-bytes".to_owned(), ahead.to_string()],
        ),
        (
            "set",
            vec!["demuxer-max-back-bytes".to_owned(), behind.to_string()],
        ),
    ]
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
    fn opening_a_stream_first_forgets_the_last_streams_track_selection_and_sub_delay() {
        // `sid=no` is below zero, so mpv never resets it when the next file's
        // layout differs: a subtitle turned off on one Stream would stay off on
        // the next. `sub-delay` is also retained across `loadfile replace` and
        // must reset to `0` so one Stream's sync offset never leaks into the
        // next (ADR-0044 §4). `auto` puts both tracks back to mpv's own choice
        // before the file is read; carrying "off" on purpose is the Host's Hand
        // pick (ADR-0041).
        assert_eq!(
            opening(&url()),
            vec![
                ("set", vec!["aid".to_owned(), "auto".to_owned()]),
                ("set", vec!["sid".to_owned(), "auto".to_owned()]),
                ("set", vec!["sub-delay".to_owned(), "0".to_owned()]),
                load(&url()),
            ],
            "the three resets come before the file, and the file is the last word"
        );
    }

    #[test]
    fn a_listed_language_is_told_with_every_code_a_file_might_use() {
        // Each entry widened through the Host's code table, in order, with a
        // code both entries share told once: `no` already carries `nb`.
        let told =
            |languages: LanguageList| match &commands(&Telling::SubtitleLanguages(languages))[..] {
                [("set", arguments)] => arguments[1].clone(),
                other => panic!("not one `set`: {other:?}"),
            };
        assert_eq!(
            told(LanguageList::parse(&["no", "nb"]).expect("a list")),
            "no,nor,nb,nob,nn,nno"
        );
        assert_eq!(
            told(LanguageList::parse(&["zh-Hans", "sw"]).expect("a list")),
            "zh-Hans,zh-CN,zh-SG,chs,sw",
            "and a tag the table does not know is told as it is"
        );
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
                Telling::SubtitleLanguages(
                    LanguageList::parse(&["pt-BR", "en"]).expect("a language list"),
                ),
                (
                    "set",
                    vec!["slang".to_owned(), "pt-BR,pob,en,eng".to_owned()],
                ),
            ),
            (
                Telling::SubtitleLanguages(LanguageList::empty()),
                ("set", vec!["slang".to_owned(), String::new()]),
            ),
            (
                Telling::AudioLanguages(
                    LanguageList::parse(&["en", "pt-BR", "fr-CA"]).expect("a language list"),
                ),
                (
                    "set",
                    vec!["alang".to_owned(), "en,eng,pt-BR,pob,fr-CA".to_owned()],
                ),
            ),
            (
                Telling::AudioLanguages(LanguageList::empty()),
                ("set", vec!["alang".to_owned(), String::new()]),
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
                commands(&telling),
                vec![expected],
                "{telling:?} is not what mpv is told"
            );
        }
    }

    #[test]
    fn the_appearance_tellings_do_not_override_a_files_own_styling() {
        // The colour and the size are the two properties the Host sets. It
        // deliberately never sets `sub-ass-override`: `force` would recolour an
        // ASS track and replace its authored fonts and typesetting (ADR-0024).
        assert_eq!(
            commands(&Telling::SubtitleColor(
                host_core::SubtitleColor::parse("#FFCC00").expect("a subtitle colour"),
            )),
            vec![("set", vec!["sub-color".to_owned(), "#FFCC00".to_owned()])]
        );
        assert_eq!(
            commands(&Telling::SubtitleScale(
                host_core::SubtitleScale::parse(1.25).expect("a subtitle size")
            )),
            vec![("set", vec!["sub-scale".to_owned(), "1.25".to_owned()])]
        );

        for telling in [
            Telling::SubtitleColor(
                host_core::SubtitleColor::parse("#FFCC00").expect("a subtitle colour"),
            ),
            Telling::SubtitleScale(host_core::SubtitleScale::parse(1.25).expect("a subtitle size")),
        ] {
            let commands = commands(&telling);
            let (name, arguments) = &commands[0];
            assert!(
                !(*name == "set"
                    && arguments.first().map(String::as_str) == Some("sub-ass-override")),
                "{telling:?} must not force the file's own styling"
            );
        }
    }

    #[test]
    fn a_pause_is_a_setting_rather_than_a_toggle() {
        assert_eq!(
            commands(&Telling::Pause(true)),
            vec![("set", vec!["pause".to_owned(), "yes".to_owned()])]
        );
    }

    #[test]
    fn an_external_subtitle_is_added_auto_and_keeps_its_positional_tail() {
        // A language with no title still has to fill the title's place, because
        // mpv reads the tail by position.
        let told = commands(&Telling::AddSubtitle {
            url: url(),
            title: None,
            language: Some("por".to_owned()),
        });
        assert_eq!(told.len(), 1);
        let (name, arguments) = &told[0];
        assert_eq!(*name, "sub-add");
        assert_eq!(
            arguments,
            &vec![
                "https://stream.example.org/v/tt0133093.mkv".to_owned(),
                "auto".to_owned(),
                String::new(),
                "por".to_owned(),
            ]
        );

        let told = commands(&Telling::AddSubtitle {
            url: url(),
            title: None,
            language: None,
        });
        assert_eq!(
            &told[0].1,
            &vec![
                "https://stream.example.org/v/tt0133093.mkv".to_owned(),
                "auto".to_owned(),
            ]
        );
    }

    #[test]
    fn a_stream_buffer_is_the_time_and_the_two_memory_budgets() {
        let commands = commands(&Telling::StreamBuffer(
            StreamBuffer::parse(300, 512).expect("a buffer"),
        ));

        assert_eq!(
            commands,
            vec![
                ("set", vec!["cache-secs".to_owned(), "300".to_owned()]),
                (
                    "set",
                    vec!["demuxer-max-bytes".to_owned(), "384000000".to_owned()]
                ),
                (
                    "set",
                    vec!["demuxer-max-back-bytes".to_owned(), "128000000".to_owned()]
                ),
            ],
            "the look-ahead, then the 512 MB ceiling split 3:1 as mpv's own defaults split it"
        );
    }
}
