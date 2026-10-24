//! The real Seek preview: a second, silent libmpv taking stills of a local
//! fixture.
//!
//! What the container can prove is the mechanism — a frame exists, the frame of
//! one moment is not the frame of another, a bucket already answered costs no
//! second capture, and a Stream that will not open answers nothing at all. What
//! it cannot prove is the colour (HDR tonemapping needs a real HDR Stream and a
//! display) and the provider's tolerance of a second connection to a debrid
//! link; those are Windows walkthrough items (ADR-0028).
//!
//! The fixture is served over HTTP because a Stream is an http(s) URL and
//! nothing else, with byte ranges honoured so mpv's seeks are real seeks.

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::thread;
use std::time::{Duration, Instant};

use base64::Engine;
use host_core::{Previewer, StreamUrl};
use host_mpv::MpvPreviewer;

/// The committed fixture the stills are taken from: 128×72, two chapters, ten
/// seconds — two buckets of five.
const CONTROLS: &[u8] = include_bytes!("fixtures/controls.mkv");

/// A local server's two URLs: the fixture, and a path nothing answers on.
struct Streams {
    movie: String,
    refused: String,
}

/// Serve the control fixture at one path and refuse everything else.
fn serve() -> Streams {
    let listener = TcpListener::bind("127.0.0.1:0").expect("a free port");
    let port = listener.local_addr().expect("the server's address").port();

    thread::spawn(move || {
        for connection in listener.incoming() {
            let Ok(stream) = connection else { continue };
            thread::spawn(move || answer(stream));
        }
    });

    Streams {
        movie: format!("http://127.0.0.1:{port}/controls.mkv"),
        refused: format!("http://127.0.0.1:{port}/nothing-here.mkv"),
    }
}

/// Answer one request: the fixture for `/controls.mkv`, a 404 for everything
/// else, and a range where one is asked for.
fn answer(mut stream: TcpStream) {
    let mut request = String::new();
    let mut reader = BufReader::new(stream.try_clone().expect("the stream is copyable"));
    if reader.read_line(&mut request).is_err() {
        return;
    }
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

    if !request.contains("/controls.mkv") {
        let _ = write!(
            stream,
            "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        );
        let _ = stream.flush();
        return;
    }

    match range.and_then(|(start, end)| {
        (start < CONTROLS.len()).then(|| (start, end.min(CONTROLS.len() - 1)))
    }) {
        Some((start, end)) => {
            let slice = &CONTROLS[start..=end];
            let _ = write!(
                stream,
                "HTTP/1.1 206 Partial Content\r\nContent-Type: video/x-matroska\r\n\
                 Accept-Ranges: bytes\r\nContent-Range: bytes {start}-{end}/{total}\r\n\
                 Content-Length: {length}\r\nConnection: close\r\n\r\n",
                total = CONTROLS.len(),
                length = slice.len(),
            );
            let _ = stream.write_all(slice);
        }
        None => {
            let _ = write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: video/x-matroska\r\nAccept-Ranges: bytes\r\n\
                 Content-Length: {}\r\nConnection: close\r\n\r\n",
                CONTROLS.len()
            );
            let _ = stream.write_all(CONTROLS);
        }
    }
    let _ = stream.flush();
}

/// The byte range a `Range: bytes=start-end` header asks for.
fn byte_range(value: &str) -> Option<(usize, usize)> {
    let (start, end) = value.strip_prefix("bytes=")?.split_once('-')?;
    Some((start.parse().ok()?, end.parse().unwrap_or(usize::MAX)))
}

/// One still at a time in this file.
///
/// The Host's own timeout is three seconds — measured as generous for one worker
/// on one machine (ADR-0028) — and seven libmpv instances loading a fixture at
/// once in a container is not one worker on one machine. Serializing the file
/// keeps the tests about the mechanism rather than about the scheduler.
static ONE_AT_A_TIME: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn serial() -> std::sync::MutexGuard<'static, ()> {
    ONE_AT_A_TIME
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn stream(url: &str) -> StreamUrl {
    StreamUrl::parse(url).unwrap_or_else(|error| panic!("{url} should be a Stream URL: {error}"))
}

/// The bytes behind a still's `data:` URL.
fn still_bytes(image: &str) -> Vec<u8> {
    let encoded = image
        .strip_prefix("data:image/jpeg;base64,")
        .unwrap_or_else(|| panic!("a still is a JPEG data URL: {image}"));
    base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .expect("the still's own bytes")
}

fn previewer(url: &str) -> MpvPreviewer {
    let previewer = MpvPreviewer::start();
    previewer.arm(&stream(url));
    previewer
}

#[test]
fn a_still_is_a_jpeg_of_one_moment() {
    let _serial = serial();
    let streams = serve();
    let previewer = previewer(&streams.movie);

    let frame = previewer.preview(1.0).expect("a still of the fixture");
    let bytes = still_bytes(frame.image());

    assert!(
        bytes.starts_with(&[0xff, 0xd8, 0xff]),
        "a still is a JPEG: {:?}",
        &bytes[..bytes.len().min(4)]
    );
    assert!(
        bytes.len() > 500,
        "a still is a picture rather than an empty file: {} bytes",
        bytes.len()
    );
    assert_eq!(previewer.captures(), 1);
}

#[test]
fn the_frame_of_one_bucket_is_not_the_frame_of_the_next() {
    let _serial = serial();
    // This is the readiness test. A screenshot taken right after `seek` returns
    // the *previous* frame, and `time-pos` is already at the target: every probe
    // that shot immediately got identical bytes, and every one that waited for
    // `MPV_EVENT_PLAYBACK_RESTART` got the new frame (6 of 6, ADR-0028). The
    // fixture's picture moves, so two buckets differing is what says the worker
    // waited.
    let streams = serve();
    let previewer = previewer(&streams.movie);

    let first = previewer.preview(1.0).expect("a still of the first bucket");
    let second = previewer
        .preview(6.0)
        .expect("a still of the second bucket");

    assert_ne!(
        first, second,
        "the second still must be the frame at 5 s, not the frame at 1 s"
    );
    assert_eq!(previewer.captures(), 2);
}

#[test]
fn a_bucket_already_answered_costs_no_second_capture() {
    let _serial = serial();
    let streams = serve();
    let previewer = previewer(&streams.movie);

    let first = previewer.preview(1.0).expect("a still");
    let second = previewer.preview(4.5).expect("the same bucket's still");

    assert_eq!(first, second, "4.5 s is in the same bucket as 1 s");
    assert_eq!(
        previewer.captures(),
        1,
        "the second ask cost no seek and no frame"
    );
}

#[test]
fn a_stream_that_cannot_be_opened_answers_nothing_rather_than_failing() {
    let _serial = serial();
    let streams = serve();
    let previewer = previewer(&streams.refused);
    let started = Instant::now();

    let still = previewer.preview(1.0);

    assert_eq!(still, None, "a Stream that will not open has no still");
    assert!(
        started.elapsed() < Duration::from_secs(10),
        "the wait for a frame is bounded: {:?}",
        started.elapsed()
    );
}

#[test]
fn a_previewer_that_was_never_armed_answers_nothing() {
    let _serial = serial();
    let previewer = MpvPreviewer::start();

    assert_eq!(previewer.preview(1.0), None);
    assert_eq!(previewer.captures(), 0);
}

#[test]
fn disarming_lets_the_stream_go() {
    let _serial = serial();
    let streams = serve();
    let previewer = previewer(&streams.movie);
    assert!(previewer.preview(1.0).is_some());

    previewer.disarm();

    assert_eq!(
        previewer.preview(1.0),
        None,
        "a Stream that was let go has no still even for a bucket already taken"
    );
}

#[test]
fn arming_a_second_stream_forgets_the_first_streams_stills() {
    let _serial = serial();
    let streams = serve();
    let previewer = previewer(&streams.movie);
    previewer.preview(1.0).expect("a still");

    previewer.arm(&stream(&streams.movie));
    previewer.preview(1.0).expect("the new Stream's still");

    assert_eq!(
        previewer.captures(),
        2,
        "re-arming is a different Stream, and a still of one is not a still of another"
    );
}
