//! A scripted stand-in for the Go Torrent engine, for this crate's own tests.
//!
//! It speaks the stdio protocol through the crate's codec and does what its
//! arguments say, so the Host's side of the pipe is tested without a swarm and
//! without Go. It is a test tool: never bundled, never started by the Host.
//!
//! ```text
//! fake-torrent-engine --torrents-dir <dir> [--mode <mode>] [--record <file>]
//!                     [--stderr <text>] [--closed-marker <file>]
//! ```
//!
//! - `--record <file>`: the argument line, then every line read from stdin, one
//!   per line, written before the engine answers it.
//! - `--stderr <text>`: a line on stderr at start.
//! - `--closed-marker <file>`: created when stdin closes, which is how a test
//!   sees the Host let go of the pipe.
//! - `--mode`:
//!   - `serve` (default): every serve is answered with a URL.
//!   - `refuse`: every serve is refused.
//!   - `silent`: a serve is never answered.
//!   - `chatty`: a serve is answered, then followed by a status, a chosen, two
//!     lines no Host knows, and a failure.
//!   - `exit-on-serve`: the engine exits when it is asked to serve.
//!   - `exit-after-ready`: the engine exits as soon as it is ready.

use std::fs::OpenOptions;
use std::io::{BufRead, Write};
use std::process::ExitCode;

use host_core::{FailureKind, StreamUrl, TorrentPhase};
use host_torrent::codec::{Event, Op};

fn main() -> ExitCode {
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    let flag = |name: &str| {
        arguments
            .iter()
            .position(|argument| argument == name)
            .and_then(|at| arguments.get(at + 1))
            .cloned()
    };
    let mode = flag("--mode").unwrap_or_else(|| "serve".to_owned());
    let record = flag("--record");
    let closed_marker = flag("--closed-marker");

    let append = |path: &str, line: &str| {
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .expect("the record opens");
        writeln!(file, "{line}").expect("the record is written");
    };

    if let Some(path) = &record {
        append(path, &format!("ARGS {}", arguments.join(" ")));
    }
    if let Some(text) = flag("--stderr") {
        eprintln!("{text}");
    }

    let out = std::io::stdout();
    let say = |event: &Event| {
        let mut out = out.lock();
        writeln!(out, "{}", event.to_line()).expect("stdout is written");
        out.flush().expect("stdout is flushed");
    };
    let say_raw = |line: &str| {
        let mut out = out.lock();
        writeln!(out, "{line}").expect("stdout is written");
        out.flush().expect("stdout is flushed");
    };

    say(&Event::Ready);
    if mode == "exit-after-ready" {
        return ExitCode::SUCCESS;
    }

    for line in std::io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        if let Some(path) = &record {
            append(path, &line);
        }
        let Ok(Op::Serve { id, request }) = Op::from_line(&line) else {
            continue;
        };
        let url = StreamUrl::parse(&format!(
            "http://127.0.0.1:1/token/{}/{id}",
            request.info_hash
        ))
        .expect("a stand-in URL is a URL");
        match mode.as_str() {
            "refuse" => say(&Event::Refused {
                id,
                sentence: "That torrent is not one this engine can fetch.".to_owned(),
            }),
            "silent" => {}
            "exit-on-serve" => return ExitCode::SUCCESS,
            "chatty" => {
                say(&Event::Served { id, url });
                say(&Event::Status {
                    info_hash: request.info_hash.clone(),
                    phase: TorrentPhase::Fetching,
                    peers: 3,
                    rate: 1500,
                });
                say(&Event::Chosen {
                    info_hash: request.info_hash.clone(),
                    file_idx: 1,
                    name: "Show.S01E03.mkv".to_owned(),
                });
                say_raw("this is not an event");
                say_raw(r#"{"ev":"teleported"}"#);
                say(&Event::Failed {
                    info_hash: request.info_hash.clone(),
                    kind: FailureKind::NoFile,
                    sentence: "This torrent holds 24 videos and none is S01E03.".to_owned(),
                });
            }
            _ => say(&Event::Served { id, url }),
        }
    }

    // Stdin closed: the Host let go of the pipe.
    if let Some(path) = &closed_marker {
        std::fs::write(path, "closed").expect("the marker is written");
    }
    ExitCode::SUCCESS
}
