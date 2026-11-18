//! A real mpv, driven headless: the Player seam over the thing that plays.
//!
//! The Streams here are served by a tiny HTTP server the test starts on a local
//! port, because a Stream is an http(s) URL and nothing else (ADR-0013) — and
//! because a Stream that cannot be fetched is one of the things being tested. No
//! audio device and no display are involved: the Player is started with
//! [`Placement::Headless`], which is a real mpv with nowhere to draw and nobody to
//! hear it, so this runs in a dev container with no GPU.
//!
//! `fixtures/controls.mkv` is the one committed fixture, generated once in the
//! dev container with ffmpeg and checked in as bytes (under 200 KB):
//!
//! ```text
//! ffmpeg -y -f lavfi -i "testsrc2=size=96x72:rate=5:duration=10" \
//!   -f lavfi -i "sine=frequency=440:duration=10" -f lavfi -i "sine=frequency=880:duration=10" \
//!   -i chapters.txt -i en.srt -i pt.srt \
//!   -map 0:v -map 1:a -map 2:a -map 4:s -map 5:s -map_metadata 3 \
//!   -vf "pad=128:72:16:0:black" -c:v libx264 -crf 28 -pix_fmt yuv420p -c:a aac -b:a 48k -c:s srt \
//!   -metadata:s:a:0 language=eng -metadata:s:a:0 title="English stereo" \
//!   -metadata:s:a:1 language=por -metadata:s:a:1 title="Portuguese" \
//!   -metadata:s:s:0 language=eng -metadata:s:s:1 language=por controls.mkv
//! ```
//!
//! It is 128×72 with 96×72 of picture and a 16 px black bar each side, two audio
//! tracks (`eng`, `por`), two embedded subtitle tracks (`eng`, `por`), two
//! chapters, and ten seconds — long enough for the stock autocrop script to
//! finish a detect pass when the Host asks for one.

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use host_core::{
    Aspect, ChapterStep, Crop, CropRectangle, Language, Observation, PlaybackState, Player,
    SeekTarget, Statistics, StreamBuffer, StreamUrl, SubtitleColor, SubtitleScale, Telling, Track,
    TrackKind, VideoSize,
};
use host_mpv::{MpvError, MpvPlayer, Placement};

/// How long a test waits for mpv to say something before giving up on it.
const PATIENCE: Duration = Duration::from_secs(15);

/// The committed fixture the controls are exercised against.
///
/// Generated once in the dev container with ffmpeg (see the note in the test
/// module docs): 128×72 with 96×72 of picture and a 16 px black bar each side,
/// two audio tracks (`eng`, `por`), two embedded subtitle tracks (`eng`,
/// `por`), two chapters, and ten seconds — long enough for the stock autocrop
/// script's detect pass when the toggle asks for it. It is bytes in the test
/// binary so a test never depends on the working directory.
const CONTROLS: &[u8] = include_bytes!("fixtures/controls.mkv");

/// A Stream served over HTTP, and the server that serves it.
struct Streams {
    /// Where the silence that plays, pauses and ends is.
    playing: String,
    /// Where the control fixture is.
    movie: String,
    /// Where nothing but a refusal is.
    refused: String,
}

/// Serve one WAV of silence at one path, the control fixture at another, and
/// refuse everything else.
///
/// A file of `seconds` long is enough to play, pause, seek and end on; writing
/// it here — 8 kHz, 8-bit, mono — keeps the test free of tooling, and serving
/// it over HTTP keeps it the shape a Stream really is. The fixture is a real
/// container with tracks, chapters and black bars, and it is served the same
/// way so that every control is asserted through a Stream and not a path.
fn serve(seconds: f64) -> Streams {
    let listener = TcpListener::bind("127.0.0.1:0").expect("a free port");
    let port = listener.local_addr().expect("the server's address").port();
    let bytes = Arc::new(wav(seconds));

    thread::spawn(move || {
        for connection in listener.incoming() {
            let Ok(stream) = connection else { continue };
            let bytes = bytes.clone();
            thread::spawn(move || answer(stream, &bytes));
        }
    });

    Streams {
        playing: format!("http://127.0.0.1:{port}/silence.wav"),
        movie: format!("http://127.0.0.1:{port}/controls.mkv"),
        refused: format!("http://127.0.0.1:{port}/nothing-here.wav"),
    }
}

/// The bytes of a WAV of silence: what a Stream that plays is made of.
fn wav(seconds: f64) -> Vec<u8> {
    const RATE: u32 = 8_000;
    let samples = (RATE as f64 * seconds) as u32;
    let data = vec![128u8; samples as usize]; // 8-bit PCM silence is the middle of the range
    let mut wav = Vec::with_capacity(data.len() + 44);

    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + data.len() as u32).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16u32.to_le_bytes()); // the fmt chunk is 16 bytes
    wav.extend_from_slice(&1u16.to_le_bytes()); // PCM
    wav.extend_from_slice(&1u16.to_le_bytes()); // mono
    wav.extend_from_slice(&RATE.to_le_bytes());
    wav.extend_from_slice(&RATE.to_le_bytes()); // byte rate, one byte per sample
    wav.extend_from_slice(&1u16.to_le_bytes()); // block align
    wav.extend_from_slice(&8u16.to_le_bytes()); // bits per sample
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&(data.len() as u32).to_le_bytes());
    wav.extend_from_slice(&data);

    wav
}

/// Answer one request: the WAV for `/silence.wav`, the control fixture for
/// `/controls.mkv`, a 404 for everything else.
///
/// Ranges are honoured, because a Stream is a file served over HTTP and seeking
/// in one is a range request: `start` (a resume, #29) and every seek mpv makes
/// ask for a byte range, and a server that answered the whole body to each of
/// them would have mpv reading the Stream from the beginning however far it was
/// told to skip.
fn answer(mut stream: TcpStream, bytes: &[u8]) {
    let mut request = String::new();
    let mut reader = BufReader::new(stream.try_clone().expect("the stream is copyable"));
    if reader.read_line(&mut request).is_err() {
        return;
    }
    // The rest of the headers, so the request is read rather than half-read —
    // and so the range mpv asked for can be answered.
    let mut range = None;
    for line in reader.lines() {
        match line {
            Ok(line) if line.trim().is_empty() => break,
            Ok(line) => {
                if let Some(value) = line
                    .split_once(':')
                    .filter(|(name, _)| name.eq_ignore_ascii_case("range"))
                    .map(|(_, value)| value.trim())
                {
                    range = byte_range(value);
                }
            }
            Err(_) => return,
        }
    }

    let (content_type, body): (&str, &[u8]) = if request.contains("/silence.wav") {
        ("audio/wav", bytes)
    } else if request.contains("/controls.mkv") {
        ("video/x-matroska", CONTROLS)
    } else {
        let _ = write!(
            stream,
            "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        );
        let _ = stream.flush();
        return;
    };

    match range
        .and_then(|(start, end)| (start < body.len()).then(|| (start, end.min(body.len() - 1))))
    {
        Some((start, end)) => {
            let slice = &body[start..=end];
            let _ = write!(
                stream,
                "HTTP/1.1 206 Partial Content\r\nContent-Type: {content_type}\r\n\
                 Accept-Ranges: bytes\r\nContent-Range: bytes {start}-{end}/{total}\r\n\
                 Content-Length: {length}\r\nConnection: close\r\n\r\n",
                total = body.len(),
                length = slice.len(),
            );
            let _ = stream.write_all(slice);
        }
        None => {
            let _ = write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nAccept-Ranges: bytes\r\n\
                 Content-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = stream.write_all(body);
        }
    }
    let _ = stream.flush();
}

/// The byte range a `Range: bytes=start-end` header asks for, where it asks for
/// one. An open-ended range (`bytes=start-`) ends at the end of the body.
fn byte_range(value: &str) -> Option<(usize, usize)> {
    let (start, end) = value.strip_prefix("bytes=")?.split_once('-')?;
    Some((start.parse().ok()?, end.parse().unwrap_or(usize::MAX)))
}

fn stream(url: &str) -> StreamUrl {
    StreamUrl::parse(url).unwrap_or_else(|error| panic!("{url} should be a Stream URL: {error}"))
}

fn player() -> MpvPlayer {
    MpvPlayer::start(Placement::Headless).expect("mpv starts in this environment")
}

/// The tracks the Player has *said* the Stream carries: nothing while it has not
/// said. A read that failed is not a file with no tracks in it, which is the
/// same distinction the Host draws (ADR-0014).
fn said(observation: &Observation) -> &[Track] {
    observation.tracks.as_deref().unwrap_or_default()
}

/// Open the control fixture and wait until mpv is playing it with all four of
/// its tracks listed — where every control test starts from.
///
/// It deliberately does not wait for a crop: the stock autocrop script's
/// automatic pass is off, and a test that wants its toggle waits for what the
/// press does.
fn controlling(streams: &Streams) -> MpvPlayer {
    let player = player();
    player
        .open(&stream(&streams.movie), None)
        .expect("mpv takes the fixture");
    until(&player, "started playing the fixture", |observation| {
        observation.state == PlaybackState::Playing && said(observation).len() == 4
    });
    player
}

/// Wait for the Player to say something a test is waiting for, or fail with the
/// last thing it did say.
fn until(
    player: &MpvPlayer,
    wanted: &str,
    mut reached: impl FnMut(&Observation) -> bool,
) -> Observation {
    let deadline = Instant::now() + PATIENCE;
    let mut last = player.observe();

    while Instant::now() < deadline {
        if reached(&last) {
            return last;
        }
        thread::sleep(Duration::from_millis(50));
        last = player.observe();
    }

    panic!("the Player never {wanted}; the last thing it said was {last:?}");
}

#[test]
fn a_stream_plays_and_reports_where_it_is_and_how_long_it_is() {
    let streams = serve(6.0);
    let player = player();

    player
        .open(&stream(&streams.playing), None)
        .expect("mpv takes the Stream");
    let playing = until(&player, "started playing", |observation| {
        observation.state == PlaybackState::Playing && observation.position.is_some()
    });

    assert_eq!(
        playing.duration.map(|seconds| seconds.round()),
        Some(6.0),
        "the Stream says how long it is, and the Host publishes it: {playing:?}"
    );
    assert_eq!(playing.failure, None);

    thread::sleep(Duration::from_millis(400));
    let moved = player.observe();
    assert!(
        moved.position > playing.position,
        "playback moves on its own: {:?} then {moved:?}",
        playing.position
    );
}

/// Wait for the position to stop moving, and answer where it stopped.
///
/// "Paused" as the picture means it rather than as the flag means it: the flag
/// flips the moment mpv takes the command, and the picture can still advance for
/// a moment afterwards — under load, for longer than any fixed sleep covers.
fn settled(player: &MpvPlayer) -> f64 {
    let deadline = Instant::now() + PATIENCE;
    let mut last = player.observe().position;

    while Instant::now() < deadline {
        thread::sleep(Duration::from_millis(100));
        let now = player.observe().position;
        if now == last {
            return now.expect("a Stream that has a position keeps it");
        }
        last = now;
    }

    panic!("the picture never stopped moving");
}

#[test]
fn pausing_holds_the_picture_and_resuming_lets_it_run() {
    let streams = serve(20.0);
    let player = player();
    player
        .open(&stream(&streams.playing), None)
        .expect("mpv takes it");
    until(&player, "started playing", |observation| {
        observation.position.is_some()
    });

    player
        .tell(Telling::Pause(true))
        .expect("mpv takes the pause");
    let paused = until(&player, "held the picture", |observation| {
        observation.state == PlaybackState::Paused
    });
    // The pause flag flips the moment the command is taken; the picture can
    // still advance for a moment after, so this waits for it to stand still
    // and then checks that it stayed there.
    let held = settled(&player);
    thread::sleep(Duration::from_millis(500));
    let still = player.observe();

    assert_eq!(
        still.position,
        Some(held),
        "a paused Stream stays where it was: {paused:?} then {still:?}"
    );

    player
        .tell(Telling::Pause(false))
        .expect("mpv takes the resume");
    // Resuming is "the picture moves past where the pause held it", and that is
    // what this waits for: the state flips a moment before the position does.
    until(
        &player,
        "played on from where the pause left it",
        |observation| {
            observation.state == PlaybackState::Playing && observation.position > Some(held)
        },
    );
}

#[test]
fn seeking_moves_playback_to_where_it_was_told() {
    let streams = serve(60.0);
    let player = player();
    player
        .open(&stream(&streams.playing), None)
        .expect("mpv takes it");
    until(&player, "started playing", |observation| {
        observation.position.is_some()
    });

    player
        .tell(Telling::Seek(SeekTarget::To { seconds: 30.0 }))
        .expect("mpv takes the seek");
    let moved = until(&player, "moved to 30 seconds", |observation| {
        observation
            .position
            .is_some_and(|position| (29.0..32.0).contains(&position))
    });
    assert_eq!(
        moved.state,
        PlaybackState::Playing,
        "a seek does not stop playback"
    );

    player
        .tell(Telling::Seek(SeekTarget::By { seconds: -10.0 }))
        .expect("mpv takes the relative seek");
    until(&player, "moved back ten seconds", |observation| {
        observation.position.is_some_and(|position| position < 22.0)
    });
}

#[test]
fn stopping_leaves_nothing_open() {
    let streams = serve(60.0);
    let player = player();
    player
        .open(&stream(&streams.playing), None)
        .expect("mpv takes it");
    until(&player, "started playing", |observation| {
        observation.position.is_some()
    });

    player.stop().expect("mpv takes the stop");
    let stopped = until(&player, "let the Stream go", |observation| {
        observation.state == PlaybackState::Idle
    });

    assert_eq!(stopped.position, None);
    assert_eq!(stopped.duration, None);
    assert_eq!(stopped.failure, None);
}

#[test]
fn a_stream_that_cannot_be_fetched_says_so_in_mpvs_own_words() {
    let streams = serve(1.0);
    let player = player();

    player
        .open(&stream(&streams.refused), None)
        .expect("mpv agrees to try, and finds out later");
    let failed = until(
        &player,
        "said the Stream could not be opened",
        |observation| observation.failure.is_some(),
    );

    assert_eq!(
        failed.state,
        PlaybackState::Idle,
        "a Stream that cannot be opened is nothing playing"
    );
    assert_eq!(
        failed.failure.as_deref(),
        Some("That Stream could not be opened — mpv could not load it."),
        "the failure is mpv's own words about what it could not load"
    );
}

#[test]
fn a_stream_that_plays_to_its_end_says_it_ended_and_where_it_ended() {
    let streams = serve(1.5);
    let player = player();
    player
        .open(&stream(&streams.playing), None)
        .expect("mpv takes it");
    until(&player, "started playing", |observation| {
        observation.position.is_some()
    });

    // mpv reports the file as ended when the demuxer runs out, which is a
    // moment before the last of the audio is played — so what a test waits for
    // is the end it settles at, not the first word of it.
    let ended = until(&player, "settled at its end", |observation| {
        observation.state == PlaybackState::Ended
            && observation
                .position
                .zip(observation.duration)
                .is_some_and(|(position, duration)| (duration - position).abs() < 0.25)
    });

    assert_eq!(ended.failure, None);
    assert_eq!(
        ended.duration.map(|seconds| seconds.round()),
        Some(2.0),
        "how long the Stream is stays answered after it ended: {ended:?}"
    );
}

#[test]
fn a_stream_the_player_cannot_start_at_all_is_still_the_hosts_problem_to_report() {
    // The Player itself, not mpv: a handle mpv will not initialize. Nothing
    // here is a Stream — it is the environment saying there is no player.
    let error = MpvError {
        detail: "no libmpv".to_owned(),
    };

    assert_eq!(
        error.to_string(),
        "mpv could not be started: no libmpv",
        "a Host with no player says so rather than panicking"
    );
}

#[test]
fn selecting_an_audio_track_moves_the_selection_without_restarting_playback() {
    let streams = serve(6.0);
    let player = controlling(&streams);

    // Wait for a position before it is read as the "before" of a comparison:
    // the state is Playing a moment before `time-pos` is answered.
    let before = until(&player, "said where it is", |observation| {
        observation.position.is_some()
    });
    let wanted = said(&before)
        .iter()
        .find(|track| track.kind == TrackKind::Audio && !track.selected)
        .expect("the fixture carries two audio tracks, one of them not playing");

    player
        .tell(Telling::AudioTrack(wanted.id))
        .expect("mpv takes the audio track");

    let after = until(&player, "moved the audio selection", |observation| {
        said(observation)
            .iter()
            .any(|track| track.kind == TrackKind::Audio && track.id == wanted.id && track.selected)
    });

    assert_eq!(
        after.state,
        PlaybackState::Playing,
        "changing a track does not stop playback"
    );
    assert!(
        after
            .position
            .zip(before.position)
            .is_some_and(|(after, before)| after >= before),
        "changing a track does not reopen the Stream: the position ran from {:?} to {:?}",
        before.position,
        after.position
    );
}

#[test]
fn selecting_a_subtitle_track_shows_it_and_none_turns_subtitles_off() {
    let streams = serve(6.0);
    let player = controlling(&streams);

    let subtitle = said(&player.observe())
        .iter()
        .find(|track| track.kind == TrackKind::Subtitle)
        .expect("the fixture carries embedded subtitles")
        .clone();

    player
        .tell(Telling::SubtitleTrack(Some(subtitle.id)))
        .expect("mpv takes the subtitle track");
    let showing = until(&player, "showed the subtitles", |observation| {
        said(observation).iter().any(|track| {
            track.kind == TrackKind::Subtitle && track.id == subtitle.id && track.selected
        })
    });
    assert_eq!(
        showing.state,
        PlaybackState::Playing,
        "changing a subtitle track does not stop playback"
    );

    player
        .tell(Telling::SubtitleTrack(None))
        .expect("mpv takes turning subtitles off");
    until(&player, "turned the subtitles off", |observation| {
        !said(observation)
            .iter()
            .any(|track| track.kind == TrackKind::Subtitle && track.selected)
    });
}

#[test]
fn the_subtitle_delay_is_observed_after_it_is_told() {
    let streams = serve(6.0);
    let player = controlling(&streams);

    player
        .tell(Telling::SubtitleDelay { seconds: -0.5 })
        .expect("mpv takes the delay");

    let shifted = until(&player, "shifted the subtitles", |observation| {
        observation
            .subtitle_delay
            .is_some_and(|seconds| (seconds + 0.5).abs() < 1e-6)
    });

    assert_eq!(shifted.subtitle_delay, Some(-0.5));
}

#[test]
fn speed_volume_and_mute_are_observed_after_they_are_told() {
    let streams = serve(6.0);
    let player = controlling(&streams);

    player
        .tell(Telling::Speed { rate: 1.5 })
        .expect("mpv takes the rate");
    until(&player, "ran at the told rate", |observation| {
        observation
            .speed
            .is_some_and(|rate| (rate - 1.5).abs() < 1e-6)
    });

    player
        .tell(Telling::Volume { level: 80.0 })
        .expect("mpv takes the level");
    let quieter = until(&player, "played at the told level", |observation| {
        observation
            .volume
            .is_some_and(|level| (level - 80.0).abs() < 1e-6)
    });
    assert_eq!(quieter.volume, Some(80.0));

    player
        .tell(Telling::Muted(true))
        .expect("mpv takes the mute");
    let muted = until(&player, "held the sound", |observation| {
        observation.muted == Some(true)
    });
    assert_eq!(muted.muted, Some(true));
}

#[test]
fn the_chapters_are_listed_and_moving_between_them_is_observed() {
    let streams = serve(6.0);
    let player = controlling(&streams);

    let listed = until(&player, "listed the chapters", |observation| {
        observation.chapters.len() == 2
    });
    assert_eq!(listed.chapters[0].title.as_deref(), Some("Intro"));
    assert!(
        (listed.chapters[1].time - 5.0).abs() < 0.1,
        "the second chapter starts where the container says: {listed:?}"
    );

    until(&player, "said which chapter is playing", |observation| {
        observation.chapter == Some(0)
    });

    player
        .tell(Telling::Chapter(ChapterStep::Next))
        .expect("mpv takes the next chapter");
    until(&player, "moved to the next chapter", |observation| {
        observation.chapter == Some(1)
    });

    player
        .tell(Telling::Chapter(ChapterStep::Previous))
        .expect("mpv takes the previous chapter");
    until(&player, "moved to the previous chapter", |observation| {
        observation.chapter == Some(0)
    });

    player
        .tell(Telling::Chapter(ChapterStep::At { index: 1 }))
        .expect("mpv takes the chapter index");
    until(&player, "moved to the told chapter", |observation| {
        observation.chapter == Some(1)
    });
}

#[test]
fn a_crop_is_observed_and_clearing_it_is_observed_as_uncropped() {
    let streams = serve(6.0);
    let player = controlling(&streams);

    // A manual crop is the Host's to set, and it is observed promptly: the
    // script's automatic pass is off, so nothing races it.
    let rectangle = CropRectangle {
        width: 64,
        height: 64,
        x: 8,
        y: 4,
    };
    player
        .tell(Telling::Crop(Crop::Rectangle {
            width: 64,
            height: 64,
            x: 8,
            y: 4,
        }))
        .expect("mpv takes the crop");
    let cropped = until(&player, "cropped the picture", |observation| {
        observation.crop == Some(rectangle)
    });
    assert_eq!(cropped.crop, Some(rectangle));

    player
        .tell(Telling::Crop(Crop::Off))
        .expect("mpv takes clearing the crop");
    until(&player, "let the whole picture through", |observation| {
        observation.crop.is_none()
    });
}

#[test]
fn an_aspect_ratio_is_observed_and_source_is_observed_as_no_override() {
    let streams = serve(6.0);
    let player = controlling(&streams);

    player
        .tell(Telling::Aspect(Aspect::Ratio { value: 1.7778 }))
        .expect("mpv takes the ratio");
    until(&player, "drew at the told shape", |observation| {
        observation.aspect.is_some_and(
            |aspect| matches!(aspect, Aspect::Ratio { value } if (value - 1.7778).abs() < 1e-3),
        )
    });

    player
        .tell(Telling::Aspect(Aspect::Source))
        .expect("mpv takes the Stream's own shape");
    until(&player, "drew at the Stream's own shape", |observation| {
        observation.aspect == Some(Aspect::Source)
    });
}

#[test]
fn the_picture_size_is_observed() {
    let streams = serve(6.0);
    let player = controlling(&streams);

    let playing = until(&player, "said how large the picture is", |observation| {
        observation.resolution.is_some()
    });

    assert_eq!(
        playing.resolution,
        Some(VideoSize {
            width: 128,
            height: 72,
        }),
        "the picture is the padded frame, bars and all"
    );
}

#[test]
fn the_statistics_say_what_is_decoding_and_what_was_dropped() {
    let streams = serve(6.0);
    let player = controlling(&streams);

    // `statistics` appears as soon as mpv has numbers to report, and the
    // decoding word arrives with `hwdec-current` a moment later — on a loaded
    // machine the two are far enough apart that waiting for the former alone
    // reads the latter before it is there. So this waits for the fact it
    // asserts, as the crop tests do.
    let playing = until(&player, "said how it is decoding", |observation| {
        observation
            .statistics
            .as_ref()
            .is_some_and(|statistics| statistics.hardware_decode.is_some())
    });
    let statistics: Statistics = playing.statistics.expect("waited for it");

    assert_eq!(
        statistics.hardware_decode.as_deref(),
        Some("no"),
        "this container has no hardware decode, and mpv says so"
    );
    assert_eq!(
        statistics.bitrate, None,
        "a headless picture has no video bitrate to report"
    );
    assert!(
        statistics.dropped_frames.is_some(),
        "frames are counted even with nowhere to draw"
    );
}

#[test]
fn autocrop_is_off_until_asked_and_toggling_it_crops_and_restores() {
    let streams = serve(6.0);
    let player = player();
    player
        .open(&stream(&streams.movie), None)
        .expect("mpv takes the fixture");

    // The script's automatic pass is started off (`autocrop-auto=no`), so the
    // first frame keeps the bars the fixture carries. The old automatic pass
    // applied a crop about six seconds in; waiting past that is what proves it
    // is gone.
    until(&player, "started playing uncropped", |observation| {
        observation.state == PlaybackState::Playing && observation.crop.is_none()
    });
    // A negative assertion has to outlast the pass it denies, so this waits
    // rather than reading once.
    thread::sleep(Duration::from_secs(7));
    assert_eq!(
        player.observe().crop,
        None,
        "the script's automatic pass is off: nothing is cropped on load"
    );

    // Back near the beginning, so the detect pass still has the couple of
    // seconds it says it needs on a ten-second fixture.
    player
        .tell(Telling::Seek(SeekTarget::To { seconds: 1.0 }))
        .expect("mpv takes the seek");
    until(&player, "moved back for the detect", |observation| {
        observation.position.is_some_and(|seconds| seconds < 2.0)
    });

    // The Host's toggle is the script's own binding: detect the bars, then a
    // second press clears the crop the script set.
    player
        .tell(Telling::Autocrop)
        .expect("mpv takes the script's toggle");
    until(&player, "cropped the bars away", |observation| {
        observation.crop
            == Some(CropRectangle {
                width: 96,
                height: 72,
                x: 16,
                y: 0,
            })
    });

    player
        .tell(Telling::Autocrop)
        .expect("mpv takes the script's toggle again");
    until(&player, "restored the full frame", |observation| {
        observation.crop.is_none()
    });
}

#[test]
fn the_subtitle_language_preference_selects_the_matching_embedded_track() {
    let streams = serve(6.0);
    let player = player();

    // mpv matches a BCP-47 tag like `pt-BR` to the container's `por` track, and
    // only does so when it is set before the open.
    player
        .tell(Telling::SubtitleLanguage(Some(
            Language::parse("pt-BR").expect("a language tag"),
        )))
        .expect("mpv takes the preference");
    player
        .open(&stream(&streams.movie), None)
        .expect("mpv takes the fixture");

    until(
        &player,
        "selected the preferred subtitle language",
        |observation| {
            observation.state == PlaybackState::Playing
                && said(observation).iter().any(|track| {
                    track.kind == TrackKind::Subtitle
                        && track.selected
                        && track.language.as_deref() == Some("por")
                })
        },
    );
}

#[test]
fn subtitles_can_be_recoloured_and_scaled_without_overriding_their_own_styling() {
    let streams = serve(6.0);
    let player = controlling(&streams);

    // The two spellings the Host sends are ones mpv's own property parser takes.
    // What is asserted here is that the Player they reach accepts them; that a
    // colour applies to unstyled text and not to an ASS track's authored style,
    // and that the size applies to both, is the manual walkthrough's evidence —
    // it needs a picture to look at (ADR-0024).
    player
        .tell(Telling::SubtitleColor(
            SubtitleColor::parse("#FFCC00").expect("a subtitle colour"),
        ))
        .expect("mpv takes a subtitle colour");
    player
        .tell(Telling::SubtitleScale(
            SubtitleScale::parse(1.25).expect("a subtitle size"),
        ))
        .expect("mpv takes a subtitle size");
}

#[test]
fn the_demuxer_cache_limits_are_ones_mpv_takes() {
    // The Host's one buffer preference becomes three mpv properties, and `tell`
    // is what proves each name and value is one this mpv accepts. Whether the
    // cache then rides out a network dip is a fact about the network and the
    // bitrate, not something a headless test can see (ADR-0026).
    let streams = serve(2.0);
    let player = controlling(&streams);

    player
        .tell(Telling::StreamBuffer(
            StreamBuffer::parse(300, 512).expect("a buffer"),
        ))
        .expect("mpv takes the look-ahead and the memory ceiling");
}

#[test]
fn a_stream_opened_after_one_that_was_held_plays_rather_than_opening_held() {
    // mpv's `pause` belongs to the player and not to the file. A client that
    // paused one Stream, stopped, and then chose another used to be handed the
    // new one held at 0:00, offering Play — which is what the Windows
    // walkthrough saw when it moved from a film to an episode (the OSD read
    // `0:00 / 2:00` with a Play button). Opening a Stream means playing it.
    let streams = serve(20.0);
    let player = player();
    player
        .open(&stream(&streams.playing), None)
        .expect("mpv takes the Stream");
    until(&player, "started playing", |observation| {
        observation.position.is_some()
    });

    player
        .tell(Telling::Pause(true))
        .expect("mpv takes the pause");
    until(&player, "held the picture", |observation| {
        observation.state == PlaybackState::Paused
    });
    player.stop().expect("mpv takes the stop");
    until(&player, "let the Stream go", |observation| {
        observation.state == PlaybackState::Idle
    });

    player
        .open(&stream(&streams.playing), None)
        .expect("mpv takes the Stream again");
    let playing = until(
        &player,
        "played the Stream it was given next",
        |observation| {
            matches!(
                observation.state,
                PlaybackState::Playing | PlaybackState::Paused
            )
        },
    );

    assert_eq!(
        playing.state,
        PlaybackState::Playing,
        "a Stream opened after one that was held plays, rather than opening held"
    );
}

#[test]
fn a_stream_opened_at_a_resume_point_starts_there_rather_than_at_its_beginning() {
    // A minute of Stream, opened half an hour of seconds in: if `start` were
    // ignored the position would begin near zero, so a position well past the
    // mark is the only reading that says the resume happened. Waited for rather
    // than read once, because which tick carries the first position is timing.
    let streams = serve(60.0);
    let player = player();

    player
        .open(&stream(&streams.playing), Some(30.0))
        .expect("mpv takes the Stream at the resume point");
    let resumed = until(&player, "began at the resume point", |observation| {
        observation.state == PlaybackState::Playing
            && observation
                .position
                .is_some_and(|position| position >= 25.0)
    });

    assert!(
        resumed.duration.is_some_and(|duration| duration > 55.0),
        "the Stream opened is the whole minute, not a shorter one that would make \
         any position look like a resume: {resumed:?}"
    );
}
