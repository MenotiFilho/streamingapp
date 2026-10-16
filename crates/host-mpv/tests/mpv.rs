//! A real mpv, driven headless: the Player seam over the thing that plays.
//!
//! The Streams here are served by a tiny HTTP server the test starts on a local
//! port, because a Stream is an http(s) URL and nothing else (ADR-0013) — and
//! because a Stream that cannot be fetched is one of the things being tested. No
//! audio device and no display are involved: the Player is started with
//! [`Placement::Headless`], which is a real mpv with nowhere to draw and nobody to
//! hear it, so this runs in a dev container with no GPU.

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use host_core::{Observation, PlaybackState, Player, SeekTarget, StreamUrl, Telling};
use host_mpv::{MpvError, MpvPlayer, Placement};

/// How long a test waits for mpv to say something before giving up on it.
const PATIENCE: Duration = Duration::from_secs(15);

/// A Stream served over HTTP, and the server that serves it.
struct Streams {
    /// Where the bytes that play are.
    playing: String,
    /// Where nothing but a refusal is.
    refused: String,
}

/// Serve one WAV of silence at one path, and refuse everything else.
///
/// A file of `seconds` long is enough to play, pause, seek and end on; writing
/// it here — 8 kHz, 8-bit, mono — keeps the test free of fixtures and of
/// ffmpeg, and serving it over HTTP keeps it the shape a Stream really is.
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

/// Answer one request: the WAV for anything under `/silence.wav`, a 404 for
/// everything else. mpv is simply given the whole body, range request or not.
fn answer(mut stream: TcpStream, bytes: &[u8]) {
    let mut request = String::new();
    let mut reader = BufReader::new(stream.try_clone().expect("the stream is copyable"));
    if reader.read_line(&mut request).is_err() {
        return;
    }
    // The rest of the headers, so the request is read rather than half-read.
    for line in reader.lines() {
        match line {
            Ok(line) if line.trim().is_empty() => break,
            Ok(_) => {}
            Err(_) => return,
        }
    }

    if request.contains("/silence.wav") {
        let _ = write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Type: audio/wav\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            bytes.len()
        );
        let _ = stream.write_all(bytes);
    } else {
        let _ = write!(
            stream,
            "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        );
    }
    let _ = stream.flush();
}

fn stream(url: &str) -> StreamUrl {
    StreamUrl::parse(url).unwrap_or_else(|error| panic!("{url} should be a Stream URL: {error}"))
}

fn player() -> MpvPlayer {
    MpvPlayer::start(Placement::Headless).expect("mpv starts in this environment")
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
        .open(&stream(&streams.playing))
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

#[test]
fn pausing_holds_the_picture_and_resuming_lets_it_run() {
    let streams = serve(20.0);
    let player = player();
    player
        .open(&stream(&streams.playing))
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
    thread::sleep(Duration::from_millis(500));
    let still = player.observe();

    assert_eq!(
        still.position, paused.position,
        "a paused Stream stays where it was: {paused:?} then {still:?}"
    );

    player
        .tell(Telling::Pause(false))
        .expect("mpv takes the resume");
    let resumed = until(&player, "moved again", |observation| {
        observation.state == PlaybackState::Playing
    });
    thread::sleep(Duration::from_millis(400));
    assert!(
        player.observe().position > resumed.position,
        "resuming plays on from where the pause left it"
    );
}

#[test]
fn seeking_moves_playback_to_where_it_was_told() {
    let streams = serve(60.0);
    let player = player();
    player
        .open(&stream(&streams.playing))
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
        .open(&stream(&streams.playing))
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
        .open(&stream(&streams.refused))
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
        .open(&stream(&streams.playing))
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
