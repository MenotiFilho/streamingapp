//! What mpv says, folded into the Host's own words.
//!
//! The half of the Player that comes back: the memory of what mpv's events said
//! about the open it was given, the properties mpv answers with, and
//! [`observe`] — a pure function of the two, returning the Host's
//! [`Observation`]. Everything mpv-shaped stops here: nothing above this module
//! names `time-pos` or `eof-reached` (ADR-0013).
//!
//! mpv's own vocabulary is *shaped* rather than re-exported: [`Properties`] is
//! the raw answers (a `"sub"` for a track's type, `96x72+16+0` for the crop, a
//! `0.0` for "no aspect override"), and [`observe`] is the one place that turns
//! them into the Host's [`Aspect`](host_core::Aspect),
//! [`Track`](host_core::Track) and
//! [`CropRectangle`](host_core::CropRectangle). Keeping the deciding here, and
//! the reading of the handle in `lib.rs`, is what makes every one of these rules
//! testable without an mpv.

use host_core::{
    Aspect, Chapter, CropRectangle, Observation, PlaybackState, Statistics, Track, TrackId,
    TrackKind, VideoSize,
};

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
    /// What mpv was last *reported* as decoding with, once the picture was up.
    ///
    /// The line is worth having when it changes and not four times a second, and
    /// the change that matters is hardware decode engaging a moment after the
    /// picture appears: logging only the first tick reports `no` and then never
    /// mentions the `d3d11va` that follows, which is the opposite of what a
    /// person debugging playback wants (it is what the Windows walkthrough read,
    /// and misread, until #28).
    decode: Option<(String, String)>,
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
            decode: None,
        }
    }

    /// mpv started a file: whatever was said about the last ending is over.
    pub(crate) fn started(&mut self) {
        self.asking = true;
        self.ending = None;
    }

    /// Whether what mpv is decoding with is worth saying now: the picture is up,
    /// and either this Stream has not been reported on yet or mpv has changed
    /// what it decodes with since.
    ///
    /// `drawing` is mpv's own `vo-configured` — a fact about the video output —
    /// rather than whether a pixel format happened to be readable this tick,
    /// which is a fact about the timing: gating on the latter is why this line
    /// went unsaid on Windows for a whole ticket.
    pub(crate) fn reported(
        &mut self,
        observation: &Observation,
        drawing: bool,
        decode: (&str, &str),
    ) -> bool {
        if !drawing {
            return false;
        }
        let up = matches!(
            observation.state,
            PlaybackState::Playing | PlaybackState::Paused
        );
        if !up {
            return false;
        }

        let decode = (decode.0.to_owned(), decode.1.to_owned());
        if self.decode.as_ref() == Some(&decode) {
            return false;
        }
        self.decode = Some(decode);
        true
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

/// One track as mpv lists it, before the Host's own vocabulary is applied.
///
/// `track-list/N/...` verbatim: `kind` is mpv's `audio`/`sub`/`video`, and
/// `external` is mpv's own sense of the word — a track added after the file —
/// which is why the Host's `embedded` is its inverse.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RawTrack {
    /// mpv's number for the track (`track-list/N/id`).
    pub(crate) id: i64,
    /// mpv's own kind word (`track-list/N/type`).
    pub(crate) kind: String,
    /// What the container says the track's language is.
    pub(crate) language: Option<String>,
    /// The track's own title.
    pub(crate) title: Option<String>,
    /// The codec the container names.
    pub(crate) codec: Option<String>,
    /// mpv's `external`: true for a track that did not come in the file.
    pub(crate) external: bool,
    /// Whether this is the track playing now.
    pub(crate) selected: bool,
    /// Whether the Stream marks this its default of the kind.
    pub(crate) default: bool,
    /// Whether the subtitles are forced.
    pub(crate) forced: bool,
}

/// One chapter as mpv lists it, before it is numbered.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct RawChapter {
    /// The chapter's name, where the container gives one.
    pub(crate) title: Option<String>,
    /// Where the chapter starts, in seconds.
    pub(crate) time: f64,
}

/// What mpv's properties answer at one moment, in mpv's own shapes.
///
/// The whole of what the Player reads off the handle: everything mpv-shaped
/// stops at this type, and [`observe`] is where a `"sub"` becomes a
/// [`TrackKind::Subtitle`], where `WxH+x+y` becomes a [`CropRectangle`], and
/// where a `0.0` becomes [`Aspect::Source`].
#[derive(Debug, Clone, PartialEq)]
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
    /// `track-list/N/...`, in mpv's own order — or `None` where mpv could not
    /// answer how many there are, which is not the same as a file that carries
    /// none.
    pub(crate) tracks: Option<Vec<RawTrack>>,
    /// `chapter-list/N/...`, in the order the container gives them.
    pub(crate) chapters: Vec<RawChapter>,
    /// mpv's `chapter`: which chapter is playing, negative with no chapters.
    pub(crate) chapter: Option<i64>,
    /// The rate playback runs at: mpv's `speed`.
    pub(crate) speed: Option<f64>,
    /// The level playback runs at: mpv's `volume`.
    pub(crate) volume: Option<f64>,
    /// Whether the sound is held: mpv's `mute`.
    pub(crate) muted: Option<bool>,
    /// How far the subtitles are shifted: mpv's `sub-delay`.
    pub(crate) subtitle_delay: Option<f64>,
    /// mpv's `video-crop`, verbatim (`96x72+16+0`, `0x0+0+0`, empty).
    pub(crate) crop: Option<String>,
    /// mpv's `video-aspect-override`: `0.0` means no override.
    pub(crate) aspect: Option<f64>,
    /// The picture's width, where a file is loaded.
    pub(crate) width: Option<i64>,
    /// The picture's height, where a file is loaded.
    pub(crate) height: Option<i64>,
    /// mpv's `video-bitrate`, absent for a Stream it does not measure.
    pub(crate) video_bitrate: Option<i64>,
    /// mpv's `frame-drop-count`.
    pub(crate) dropped_frames: Option<i64>,
    /// mpv's `hwdec-current`, verbatim (`no`, `d3d11va`, …).
    pub(crate) hardware_decode: Option<String>,
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
///
/// The controls are read whether or not a file has been loaded, because mpv
/// answers them whether or not one has; the three facts that only mean something
/// about a picture — the aspect, the resolution and the statistics — are absent
/// until a file is loaded, because mpv has no picture to answer them about.
pub(crate) fn observe(memory: &Memory, properties: &Properties) -> Observation {
    if let Some(Ending::Failed(words)) = &memory.ending {
        return Observation {
            failure: Some(words.clone()),
            ..Observation::idle()
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
        tracks: properties
            .tracks
            .as_ref()
            .map(|tracks| tracks.iter().filter_map(track).collect()),
        chapters: properties
            .chapters
            .iter()
            .enumerate()
            .map(|(index, chapter)| Chapter {
                index,
                title: chapter.title.clone().filter(|title| !title.is_empty()),
                time: chapter.time,
            })
            .collect(),
        // mpv's chapter is an index from zero, and negative (or absent) when
        // there are none.
        chapter: properties
            .chapter
            .and_then(|index| usize::try_from(index).ok()),
        speed: properties.speed,
        volume: properties.volume,
        muted: properties.muted,
        subtitle_delay: properties.subtitle_delay,
        crop: properties.crop.as_deref().and_then(crop_rectangle),
        aspect: aspect(properties.aspect, properties.loaded),
        resolution: resolution(properties.width, properties.height, properties.loaded),
        statistics: statistics(properties),
    }
}

/// One mpv track as a track the Host controls, where it is one this Host has a
/// control for.
///
/// The video track is deliberately left out: no client asks which track carries
/// the picture, and the Host has no control for it. A track mpv numbers zero or
/// below is not a track anything can select, so it is not one either.
fn track(raw: &RawTrack) -> Option<Track> {
    let kind = match raw.kind.as_str() {
        "audio" => TrackKind::Audio,
        "sub" => TrackKind::Subtitle,
        _ => return None,
    };

    Some(
        Track {
            id: TrackId::new(raw.id)?,
            kind,
            language: raw.language.clone(),
            title: raw.title.clone(),
            codec: raw.codec.clone(),
            // mpv's `external` is the opposite of the Host's `embedded`.
            embedded: !raw.external,
            selected: raw.selected,
            default: raw.default,
            forced: raw.forced,
        }
        .bounded(),
    )
}

/// The rectangle mpv's `video-crop` names, or nothing where it is uncropped.
///
/// mpv reads back an empty string when no crop is set, and that is also the
/// spelling the Host clears with: the stock autocrop script's own clear, and
/// what the script tests to decide whether to clear or to detect (#119). The
/// older `0x0+0+0` spelling still reads back as "the whole picture" here — a
/// rectangle with no width or height could not be a picture anyway — but it is
/// no longer used, because the script sees that non-empty string as a crop.
fn crop_rectangle(raw: &str) -> Option<CropRectangle> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }

    // `[W]x[H][+X[+Y]]`: mpv always writes the `WxH` and its read-back carries
    // an offset, but a bare size is parsed all the same.
    let (size, offset) = match raw.split_once('+') {
        Some((size, offset)) => (size, Some(offset)),
        None => (raw, None),
    };
    let (width, height) = size.split_once('x')?;
    let width: u32 = width.trim().parse().ok()?;
    let height: u32 = height.trim().parse().ok()?;
    if width == 0 || height == 0 {
        return None;
    }

    let (x, y) = match offset {
        Some(offset) => {
            let (x, y) = offset.split_once('+').unwrap_or((offset, "0"));
            (x.trim().parse().ok()?, y.trim().parse().ok()?)
        }
        None => (0, 0),
    };

    Some(CropRectangle {
        width,
        height,
        x,
        y,
    })
}

/// The shape mpv says the picture is drawn at, where a picture is loaded at all.
///
/// mpv answers `video-aspect-override` as a number: zero (or anything not a
/// positive ratio) is its "no override", which is the Stream's own shape.
fn aspect(value: Option<f64>, loaded: bool) -> Option<Aspect> {
    if !loaded {
        return None;
    }

    match value {
        Some(value) if value.is_finite() && value > 0.0 => Some(Aspect::Ratio { value }),
        _ => Some(Aspect::Source),
    }
}

/// How large the picture is, where a file is loaded and mpv gives both sides.
fn resolution(width: Option<i64>, height: Option<i64>, loaded: bool) -> Option<VideoSize> {
    if !loaded {
        return None;
    }

    let (width, height) = (width?, height?);
    Some(VideoSize {
        width: u32::try_from(width).ok()?,
        height: u32::try_from(height).ok()?,
    })
}

/// What mpv says about how the Stream is playing, where one is loaded to say it
/// about.
///
/// `video-bitrate` is absent for a Stream mpv does not measure — which a
/// headless test's `vo=null` is — so the bitrate is legitimately `None` while
/// the dropped-frame count and the decode mode are not.
fn statistics(properties: &Properties) -> Option<Statistics> {
    if !properties.loaded {
        return None;
    }

    Some(
        Statistics {
            bitrate: count(properties.video_bitrate),
            dropped_frames: count(properties.dropped_frames),
            hardware_decode: properties.hardware_decode.clone(),
        }
        .bounded(),
    )
}

/// An mpv count as a number the Host will publish: a negative answer is not a
/// count of anything.
fn count(value: Option<i64>) -> Option<u64> {
    value.and_then(|value| u64::try_from(value).ok())
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

    /// An mpv that has taken an open but has not loaded a file yet: the state a
    /// control is read in is the same, so every test starts here.
    fn loading() -> Properties {
        Properties {
            loaded: false,
            paused: false,
            ended: false,
            position: None,
            duration: None,
            tracks: None,
            chapters: Vec::new(),
            chapter: None,
            speed: None,
            volume: None,
            muted: None,
            subtitle_delay: None,
            crop: None,
            aspect: None,
            width: None,
            height: None,
            video_bitrate: None,
            dropped_frames: None,
            hardware_decode: None,
        }
    }

    /// The same, with a file loaded — what every control's own test builds from.
    fn loaded() -> Properties {
        Properties {
            loaded: true,
            position: Some(0.2),
            duration: Some(600.0),
            ..loading()
        }
    }

    fn track(id: i64, kind: &str) -> RawTrack {
        RawTrack {
            id,
            kind: kind.to_owned(),
            language: None,
            title: None,
            codec: None,
            external: false,
            selected: false,
            default: false,
            forced: false,
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

        let observation = observe(&asking, &loaded());
        assert_eq!(observation.state, PlaybackState::Playing);
        assert_eq!(observation.position, Some(0.2));
        assert_eq!(observation.duration, Some(600.0));
        assert_eq!(observation.failure, None);
    }

    #[test]
    fn a_file_at_its_end_is_ended_before_it_is_paused() {
        let at_the_end = Properties {
            paused: true,
            ended: true,
            position: Some(600.0),
            ..loaded()
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
            paused: true,
            position: Some(12.5),
            ..loaded()
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
    fn a_decode_is_reported_when_the_picture_comes_up_and_when_it_changes() {
        let mut memory = Memory::asking();
        let playing = Properties {
            position: Some(1.0),
            duration: Some(10.0),
            ..loaded()
        };

        let first = observe(&memory, &playing);
        assert!(
            !memory.reported(&first, false, ("no", "unknown")),
            "a picture whose video output is not configured says nothing yet"
        );
        assert!(
            memory.reported(&first, true, ("no", "unknown")),
            "the first sight of a picture is when mpv's decode is worth logging"
        );
        assert!(
            !memory.reported(&first, true, ("no", "unknown")),
            "the four ticks a second after it are not"
        );
        assert!(
            memory.reported(&first, true, ("d3d11va", "unknown")),
            "but hardware decode engaging a moment later is exactly the change worth saying"
        );

        let mut fresh = Memory::asking();
        let opening = observe(&fresh, &loading());
        assert!(
            !fresh.reported(&opening, true, ("no", "unknown")),
            "an open in flight has no picture to report on yet"
        );

        let mut again = Memory::asking();
        assert!(
            again.reported(&first, true, ("d3d11va", "unknown")),
            "a new Stream says what it decodes with, even when it is what the last one said"
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

    #[test]
    fn a_track_is_the_kind_the_host_controls_and_the_video_track_is_skipped() {
        let properties = Properties {
            tracks: Some(vec![
                track(1, "video"),
                RawTrack {
                    title: Some("English stereo".to_owned()),
                    codec: Some("aac".to_owned()),
                    selected: true,
                    default: true,
                    ..track(2, "audio")
                },
                track(3, "sub"),
                RawTrack {
                    language: Some("por".to_owned()),
                    external: true,
                    ..track(4, "sub")
                },
                // A track mpv numbers zero is not one anything can select.
                track(0, "audio"),
            ]),
            ..loaded()
        };

        let observation = observe(&Memory::asking(), &properties);

        assert_eq!(
            observation.tracks,
            Some(vec![
                Track {
                    id: TrackId::new(2).expect("a positive id"),
                    kind: TrackKind::Audio,
                    language: None,
                    title: Some("English stereo".to_owned()),
                    codec: Some("aac".to_owned()),
                    embedded: true,
                    selected: true,
                    default: true,
                    forced: false,
                },
                Track {
                    id: TrackId::new(3).expect("a positive id"),
                    kind: TrackKind::Subtitle,
                    language: None,
                    title: None,
                    codec: None,
                    embedded: true,
                    selected: false,
                    default: false,
                    forced: false,
                },
                Track {
                    id: TrackId::new(4).expect("a positive id"),
                    kind: TrackKind::Subtitle,
                    language: Some("por".to_owned()),
                    title: None,
                    codec: None,
                    // mpv's `external` is the opposite of the Host's `embedded`.
                    embedded: false,
                    selected: false,
                    default: false,
                    forced: false,
                },
            ]),
            "the video track is not a control, and an added track is not embedded"
        );
    }

    #[test]
    fn a_word_the_container_left_empty_is_no_word_at_all() {
        let properties = Properties {
            tracks: Some(vec![RawTrack {
                language: Some(String::new()),
                title: Some(String::new()),
                codec: Some(String::new()),
                ..track(1, "audio")
            }]),
            ..loaded()
        };

        let observation = observe(&Memory::asking(), &properties);

        assert_eq!(
            observation
                .tracks
                .expect("the Player said what the file carries")[0],
            Track {
                id: TrackId::new(1).expect("a positive id"),
                kind: TrackKind::Audio,
                language: None,
                title: None,
                codec: None,
                embedded: true,
                selected: false,
                default: false,
                forced: false,
            }
        );
    }

    #[test]
    fn chapters_are_numbered_and_the_one_playing_is_an_index_from_zero() {
        let properties = Properties {
            chapters: vec![
                RawChapter {
                    title: Some("Intro".to_owned()),
                    time: 0.0,
                },
                RawChapter {
                    title: Some(String::new()),
                    time: 5.0,
                },
            ],
            chapter: Some(1),
            ..loaded()
        };

        let observation = observe(&Memory::asking(), &properties);

        assert_eq!(
            observation.chapters,
            vec![
                Chapter {
                    index: 0,
                    title: Some("Intro".to_owned()),
                    time: 0.0,
                },
                Chapter {
                    index: 1,
                    title: None,
                    time: 5.0,
                },
            ]
        );
        assert_eq!(observation.chapter, Some(1));
    }

    #[test]
    fn no_chapters_is_no_chapter_and_a_negative_index_is_none() {
        let properties = Properties {
            chapter: Some(-1),
            ..loaded()
        };

        let observation = observe(&Memory::asking(), &properties);

        assert_eq!(observation.chapters, Vec::new());
        assert_eq!(observation.chapter, None);
    }

    #[test]
    fn a_crop_reads_as_a_rectangle_and_a_full_frame_is_uncropped() {
        assert_eq!(
            crop_rectangle("96x72+16+0"),
            Some(CropRectangle {
                width: 96,
                height: 72,
                x: 16,
                y: 0,
            })
        );
        assert_eq!(
            crop_rectangle("0x0+0+0"),
            None,
            "the spelling mpv reads back after a crop was cleared is the whole picture"
        );
        assert_eq!(crop_rectangle(""), None);
        assert_eq!(crop_rectangle("not a crop"), None);
    }

    #[test]
    fn a_crop_from_mpv_is_the_hosts_rectangle_and_uncropped_is_none() {
        let cropped = Properties {
            crop: Some("96x72+16+0".to_owned()),
            ..loaded()
        };
        assert_eq!(
            observe(&Memory::asking(), &cropped).crop,
            Some(CropRectangle {
                width: 96,
                height: 72,
                x: 16,
                y: 0,
            })
        );

        let cleared = Properties {
            crop: Some("0x0+0+0".to_owned()),
            ..loaded()
        };
        assert_eq!(observe(&Memory::asking(), &cleared).crop, None);
    }

    #[test]
    fn a_zero_override_is_the_streams_own_shape_and_a_ratio_is_not() {
        assert_eq!(
            aspect(Some(0.0), true),
            Some(Aspect::Source),
            "mpv's no-override reads back as zero"
        );
        assert_eq!(
            aspect(Some(-1.0), true),
            Some(Aspect::Source),
            "anything that is not a positive ratio is no override"
        );
        assert_eq!(
            aspect(Some(1.7778), true),
            Some(Aspect::Ratio { value: 1.7778 })
        );
        assert_eq!(
            aspect(Some(0.0), false),
            None,
            "there is no picture to have a shape before one is loaded"
        );
    }

    #[test]
    fn resolution_is_answered_only_where_a_picture_is_loaded() {
        assert_eq!(
            resolution(Some(128), Some(72), true),
            Some(VideoSize {
                width: 128,
                height: 72,
            })
        );
        assert_eq!(
            resolution(Some(128), Some(72), false),
            None,
            "mpv's picture size is about a picture, and there is none yet"
        );
        assert_eq!(resolution(None, Some(72), true), None);
    }

    #[test]
    fn statistics_say_what_is_decoding_and_what_was_dropped() {
        let properties = Properties {
            video_bitrate: None,
            dropped_frames: Some(3),
            hardware_decode: Some("no".to_owned()),
            ..loaded()
        };

        assert_eq!(
            observe(&Memory::asking(), &properties).statistics,
            Some(Statistics {
                bitrate: None,
                dropped_frames: Some(3),
                hardware_decode: Some("no".to_owned()),
            }),
            "a headless Stream has no bitrate to report and still reports the rest"
        );
        assert_eq!(
            observe(&Memory::asking(), &loading()).statistics,
            None,
            "nothing loaded, nothing to say about how it plays"
        );
    }

    #[test]
    fn a_bitrate_the_player_counts_is_published_as_a_number() {
        // A headless Player has no video output to count bits with, so its own
        // test can only assert that the field is *there*; this is where the
        // number path — which a real display takes — is asserted.
        let properties = Properties {
            video_bitrate: Some(3_500_000),
            dropped_frames: Some(2),
            hardware_decode: Some("d3d11va".to_owned()),
            ..loaded()
        };

        assert_eq!(
            observe(&Memory::asking(), &properties).statistics,
            Some(Statistics {
                bitrate: Some(3_500_000),
                dropped_frames: Some(2),
                hardware_decode: Some("d3d11va".to_owned()),
            })
        );
    }

    #[test]
    fn a_player_that_cannot_say_what_the_stream_carries_says_nothing() {
        let properties = Properties {
            tracks: None,
            ..loaded()
        };

        assert_eq!(
            observe(&Memory::asking(), &properties).tracks,
            None,
            "a read that failed is not a file with no tracks in it — the difference \
             is what keeps the Addon subtitle fallback honest"
        );
    }

    #[test]
    fn a_negative_count_is_not_a_count() {
        assert_eq!(count(Some(-1)), None);
        assert_eq!(count(Some(0)), Some(0));
        assert_eq!(count(None), None);
    }

    #[test]
    fn the_controls_are_read_off_the_properties_as_mpv_answers_them() {
        let properties = Properties {
            speed: Some(1.5),
            volume: Some(80.0),
            muted: Some(true),
            subtitle_delay: Some(-0.5),
            ..loaded()
        };

        let observation = observe(&Memory::asking(), &properties);

        assert_eq!(observation.speed, Some(1.5));
        assert_eq!(observation.volume, Some(80.0));
        assert_eq!(observation.muted, Some(true));
        assert_eq!(observation.subtitle_delay, Some(-0.5));
    }
}
