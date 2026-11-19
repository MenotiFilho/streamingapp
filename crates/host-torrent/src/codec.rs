//! The stdio protocol: one JSON object per line, in both directions (spec #311,
//! "The stdio protocol").
//!
//! This is the codec and nothing else, so what the Host and the engine say to each
//! other is decided, and tested, apart from any child process. The Host writes
//! [`Op`]s and reads [`Event`]s; the scripted stand-in this crate's tests spawn
//! does the opposite through the same two types, which is what makes both
//! directions round-trip. `engine/protocol.go` is the Go half, and the two are
//! kept in step by hand: a field spelt differently here is a torrent that never
//! plays.

use std::fmt;

use host_core::{
    FailureKind, InfoHash, ServeHints, ServeRequest, StreamUrl, TorrentLimits, TorrentPhase,
    TorrentReport,
};
use serde::{Deserialize, Serialize};

/// What the Host says to the engine.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Op {
    /// Read-ahead and the disk ceiling, for every held torrent.
    Limits(TorrentLimits),
    /// Serve a torrent's file. Answered at once, before metadata, by the
    /// [`Event::Served`] or [`Event::Refused`] carrying the same `id`.
    Serve { id: u64, request: ServeRequest },
    /// Drop a torrent and delete its directory.
    LetGo(InfoHash),
}

/// What the engine says to the Host.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Event {
    /// Listening: the engine is ready for ops.
    Ready,
    /// The loopback URL a serve is answered with.
    Served { id: u64, url: StreamUrl },
    /// A serve the engine will not do, in a sentence an owner can read.
    Refused { id: u64, sentence: String },
    Status {
        info_hash: InfoHash,
        phase: TorrentPhase,
        peers: u32,
        rate: u64,
    },
    Chosen {
        info_hash: InfoHash,
        file_idx: u32,
        name: String,
    },
    Failed {
        info_hash: InfoHash,
        kind: FailureKind,
        sentence: String,
    },
}

impl Event {
    /// The report this event is, for the three the Host collects. A `ready` and
    /// the answers to a serve are for the process layer, not for a client.
    pub fn into_report(self) -> Option<TorrentReport> {
        match self {
            Event::Status {
                info_hash,
                phase,
                peers,
                rate,
            } => Some(TorrentReport::Status {
                info_hash,
                phase,
                peers,
                rate,
            }),
            Event::Chosen {
                info_hash,
                file_idx,
                name,
            } => Some(TorrentReport::Chosen {
                info_hash,
                file_idx,
                name,
            }),
            Event::Failed {
                info_hash,
                kind,
                sentence,
            } => Some(TorrentReport::Failed {
                info_hash,
                kind,
                sentence,
            }),
            Event::Ready | Event::Served { .. } | Event::Refused { .. } => None,
        }
    }
}

/// A line that is not one the receiver knows. The caller logs it and goes on:
/// unknown lines are ignored in both directions.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodeError(String);

impl fmt::Display for DecodeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for DecodeError {}

impl DecodeError {
    fn from_json(error: serde_json::Error) -> Self {
        Self(error.to_string())
    }
}

// The wire shapes. Private, so the spelling of a field is in one place and the
// rest of the crate speaks the seam's own types.

#[derive(Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
enum WireOp {
    Limits {
        readahead: u64,
        cache: u64,
    },
    Serve {
        id: u64,
        #[serde(rename = "infoHash")]
        info_hash: InfoHash,
        #[serde(rename = "fileIdx")]
        file_idx: Option<u32>,
        sources: Vec<String>,
        hints: WireHints,
    },
    LetGo {
        #[serde(rename = "infoHash")]
        info_hash: InfoHash,
    },
}

#[derive(Serialize, Deserialize)]
struct WireHints {
    filename: Option<String>,
    season: Option<u32>,
    episode: Option<u32>,
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "ev", rename_all = "snake_case")]
enum WireEvent {
    Ready,
    Served {
        id: u64,
        url: String,
    },
    Refused {
        id: u64,
        sentence: String,
    },
    Status {
        #[serde(rename = "infoHash")]
        info_hash: InfoHash,
        phase: WirePhase,
        peers: u32,
        rate: u64,
    },
    Chosen {
        #[serde(rename = "infoHash")]
        info_hash: InfoHash,
        #[serde(rename = "fileIdx")]
        file_idx: u32,
        name: String,
    },
    Failed {
        #[serde(rename = "infoHash")]
        info_hash: InfoHash,
        kind: WireFailure,
        sentence: String,
    },
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum WirePhase {
    Finding,
    Fetching,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum WireFailure {
    NoFile,
    Storage,
    Other,
}

impl Op {
    /// The line the engine is sent, without its newline.
    pub fn to_line(&self) -> String {
        let wire = match self {
            Op::Limits(limits) => WireOp::Limits {
                readahead: limits.readahead_bytes,
                cache: limits.cache_bytes,
            },
            Op::Serve { id, request } => WireOp::Serve {
                id: *id,
                info_hash: request.info_hash.clone(),
                file_idx: request.file_idx,
                sources: request.sources.clone(),
                hints: WireHints {
                    filename: request.hints.filename.clone(),
                    season: request.hints.season,
                    episode: request.hints.episode,
                },
            },
            Op::LetGo(info_hash) => WireOp::LetGo {
                info_hash: info_hash.clone(),
            },
        };
        serde_json::to_string(&wire).expect("an op is JSON")
    }

    /// An op from a line, or why it is not one.
    pub fn from_line(line: &str) -> Result<Self, DecodeError> {
        let wire: WireOp = serde_json::from_str(line.trim()).map_err(DecodeError::from_json)?;
        Ok(match wire {
            WireOp::Limits { readahead, cache } => Op::Limits(TorrentLimits {
                readahead_bytes: readahead,
                cache_bytes: cache,
            }),
            WireOp::Serve {
                id,
                info_hash,
                file_idx,
                sources,
                hints,
            } => Op::Serve {
                id,
                request: ServeRequest {
                    info_hash,
                    file_idx,
                    sources,
                    hints: ServeHints {
                        filename: hints.filename,
                        season: hints.season,
                        episode: hints.episode,
                    },
                },
            },
            WireOp::LetGo { info_hash } => Op::LetGo(info_hash),
        })
    }
}

impl Event {
    /// The line the Host is sent, without its newline.
    pub fn to_line(&self) -> String {
        let wire = match self {
            Event::Ready => WireEvent::Ready,
            Event::Served { id, url } => WireEvent::Served {
                id: *id,
                url: url.as_str().to_owned(),
            },
            Event::Refused { id, sentence } => WireEvent::Refused {
                id: *id,
                sentence: sentence.clone(),
            },
            Event::Status {
                info_hash,
                phase,
                peers,
                rate,
            } => WireEvent::Status {
                info_hash: info_hash.clone(),
                phase: match phase {
                    TorrentPhase::Finding => WirePhase::Finding,
                    TorrentPhase::Fetching => WirePhase::Fetching,
                },
                peers: *peers,
                rate: *rate,
            },
            Event::Chosen {
                info_hash,
                file_idx,
                name,
            } => WireEvent::Chosen {
                info_hash: info_hash.clone(),
                file_idx: *file_idx,
                name: name.clone(),
            },
            Event::Failed {
                info_hash,
                kind,
                sentence,
            } => WireEvent::Failed {
                info_hash: info_hash.clone(),
                kind: match kind {
                    FailureKind::NoFile => WireFailure::NoFile,
                    FailureKind::Storage => WireFailure::Storage,
                    FailureKind::Other => WireFailure::Other,
                },
                sentence: sentence.clone(),
            },
        };
        serde_json::to_string(&wire).expect("an event is JSON")
    }

    /// An event from a line, or why it is not one. A `served` whose URL the Player
    /// could not open is not one either.
    pub fn from_line(line: &str) -> Result<Self, DecodeError> {
        let wire: WireEvent = serde_json::from_str(line.trim()).map_err(DecodeError::from_json)?;
        Ok(match wire {
            WireEvent::Ready => Event::Ready,
            WireEvent::Served { id, url } => Event::Served {
                id,
                url: StreamUrl::parse(&url).map_err(|e| DecodeError(e.to_string()))?,
            },
            WireEvent::Refused { id, sentence } => Event::Refused { id, sentence },
            WireEvent::Status {
                info_hash,
                phase,
                peers,
                rate,
            } => Event::Status {
                info_hash,
                phase: match phase {
                    WirePhase::Finding => TorrentPhase::Finding,
                    WirePhase::Fetching => TorrentPhase::Fetching,
                },
                peers,
                rate,
            },
            WireEvent::Chosen {
                info_hash,
                file_idx,
                name,
            } => Event::Chosen {
                info_hash,
                file_idx,
                name,
            },
            WireEvent::Failed {
                info_hash,
                kind,
                sentence,
            } => Event::Failed {
                info_hash,
                kind: match kind {
                    WireFailure::NoFile => FailureKind::NoFile,
                    WireFailure::Storage => FailureKind::Storage,
                    WireFailure::Other => FailureKind::Other,
                },
                sentence,
            },
        })
    }
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};

    use super::*;

    const HASH: &str = "c12fe1c06bba254a9dc9f519b335aa7c1367a88a";

    fn hash() -> InfoHash {
        InfoHash::parse(HASH).expect("an infoHash")
    }

    fn as_json(line: &str) -> Value {
        serde_json::from_str(line).expect("a line is JSON")
    }

    fn request() -> ServeRequest {
        ServeRequest {
            info_hash: hash(),
            file_idx: Some(2),
            sources: vec![
                "tracker:udp://tracker.example.org:1337".to_owned(),
                format!("dht:{HASH}"),
            ],
            hints: ServeHints {
                filename: Some("Show.S01E03.mkv".to_owned()),
                season: Some(1),
                episode: Some(3),
            },
        }
    }

    fn bare_request() -> ServeRequest {
        ServeRequest {
            info_hash: hash(),
            file_idx: None,
            sources: Vec::new(),
            hints: ServeHints::default(),
        }
    }

    #[test]
    fn limits_are_written_as_the_spec_spells_them() {
        let line = Op::Limits(TorrentLimits {
            readahead_bytes: 384_000_000,
            cache_bytes: 2_000_000_000,
        })
        .to_line();

        assert_eq!(
            as_json(&line),
            json!({"op": "limits", "readahead": 384_000_000u64, "cache": 2_000_000_000u64})
        );
    }

    #[test]
    fn a_serve_is_written_with_every_field_even_when_it_has_no_value() {
        let full = Op::Serve {
            id: 7,
            request: request(),
        }
        .to_line();
        let bare = Op::Serve {
            id: 8,
            request: bare_request(),
        }
        .to_line();

        assert_eq!(
            as_json(&full),
            json!({
                "op": "serve",
                "id": 7,
                "infoHash": HASH,
                "fileIdx": 2,
                "sources": ["tracker:udp://tracker.example.org:1337", format!("dht:{HASH}")],
                "hints": {"filename": "Show.S01E03.mkv", "season": 1, "episode": 3},
            })
        );
        // The Go side reads `null` as "absent", and so does this: a field that is
        // left out would be one the spec does not describe.
        assert_eq!(
            as_json(&bare),
            json!({
                "op": "serve",
                "id": 8,
                "infoHash": HASH,
                "fileIdx": null,
                "sources": [],
                "hints": {"filename": null, "season": null, "episode": null},
            })
        );
    }

    #[test]
    fn a_let_go_names_the_torrent() {
        assert_eq!(
            as_json(&Op::LetGo(hash()).to_line()),
            json!({"op": "let_go", "infoHash": HASH})
        );
    }

    #[test]
    fn a_line_is_one_line() {
        let ops = [
            Op::Serve {
                id: 1,
                request: ServeRequest {
                    hints: ServeHints {
                        filename: Some("two\nlines.mkv".to_owned()),
                        ..ServeHints::default()
                    },
                    ..request()
                },
            },
            Op::LetGo(hash()),
        ];
        for op in ops {
            assert!(!op.to_line().contains('\n'), "{op:?}");
        }
        let event = Event::Refused {
            id: 1,
            sentence: "Two\nlines.".to_owned(),
        };
        assert!(!event.to_line().contains('\n'));
    }

    #[test]
    fn every_op_round_trips() {
        let ops = [
            Op::Limits(TorrentLimits {
                readahead_bytes: 16 << 20,
                cache_bytes: 256_000_000,
            }),
            Op::Serve {
                id: 0,
                request: bare_request(),
            },
            Op::Serve {
                id: u64::from(u32::MAX) + 1,
                request: request(),
            },
            Op::LetGo(hash()),
        ];
        for op in ops {
            assert_eq!(Op::from_line(&op.to_line()), Ok(op));
        }
    }

    #[test]
    fn every_event_round_trips() {
        let url = StreamUrl::parse(&format!("http://127.0.0.1:41999/token/{HASH}/3")).unwrap();
        let events = [
            Event::Ready,
            Event::Served { id: 3, url },
            Event::Refused {
                id: 4,
                sentence: "That torrent is not one this Host can fetch.".to_owned(),
            },
            Event::Status {
                info_hash: hash(),
                phase: TorrentPhase::Finding,
                peers: 0,
                rate: 0,
            },
            Event::Status {
                info_hash: hash(),
                phase: TorrentPhase::Fetching,
                peers: 12,
                rate: 4_200_000,
            },
            Event::Chosen {
                info_hash: hash(),
                file_idx: 5,
                name: "Show.S01E03.mkv".to_owned(),
            },
            Event::Failed {
                info_hash: hash(),
                kind: FailureKind::NoFile,
                sentence: "This torrent holds 24 videos and none is S01E03.".to_owned(),
            },
            Event::Failed {
                info_hash: hash(),
                kind: FailureKind::Storage,
                sentence: "The disk is full.".to_owned(),
            },
            Event::Failed {
                info_hash: hash(),
                kind: FailureKind::Other,
                sentence: "Something else.".to_owned(),
            },
        ];
        for event in events {
            assert_eq!(Event::from_line(&event.to_line()), Ok(event));
        }
    }

    #[test]
    fn the_engines_lines_are_read_as_the_spec_spells_them() {
        let served =
            format!(r#"{{"ev":"served","id":2,"url":"http://127.0.0.1:5000/aa/{HASH}/2"}}"#);
        let status = format!(
            r#"{{"ev":"status","infoHash":"{HASH}","phase":"fetching","peers":3,"rate":900}}"#
        );
        let failed =
            format!(r#"{{"ev":"failed","infoHash":"{HASH}","kind":"no_file","sentence":"No."}}"#);

        assert_eq!(Event::from_line(r#"{"ev":"ready"}"#), Ok(Event::Ready));
        assert!(matches!(
            Event::from_line(&served),
            Ok(Event::Served { id: 2, .. })
        ));
        assert_eq!(
            Event::from_line(&status),
            Ok(Event::Status {
                info_hash: hash(),
                phase: TorrentPhase::Fetching,
                peers: 3,
                rate: 900,
            })
        );
        assert!(matches!(
            Event::from_line(&failed),
            Ok(Event::Failed {
                kind: FailureKind::NoFile,
                ..
            })
        ));
    }

    #[test]
    fn a_line_with_a_trailing_newline_or_carriage_return_is_still_read() {
        // A Windows engine writes `\r\n` if it is ever built to.
        assert_eq!(Event::from_line("{\"ev\":\"ready\"}\r\n"), Ok(Event::Ready));
    }

    #[test]
    fn what_is_not_a_known_event_is_an_error_and_never_a_panic() {
        let lines = [
            "",
            "   ",
            "not json",
            "[]",
            "{}",
            r#"{"ev":"teleported"}"#,
            r#"{"ev":"served","id":1}"#,
            r#"{"ev":"served","id":1,"url":"file:///etc/passwd"}"#,
            r#"{"ev":"served","id":-1,"url":"http://127.0.0.1:1/a"}"#,
            r#"{"ev":"status","infoHash":"nothash","phase":"fetching","peers":1,"rate":1}"#,
            &format!(
                r#"{{"ev":"status","infoHash":"{HASH}","phase":"dreaming","peers":1,"rate":1}}"#
            ),
            &format!(r#"{{"ev":"failed","infoHash":"{HASH}","kind":"mystery","sentence":"x"}}"#),
            r#"{"op":"limits","readahead":1,"cache":1}"#,
        ];
        for line in lines {
            assert!(Event::from_line(line).is_err(), "{line:?}");
        }
    }

    #[test]
    fn what_is_not_a_known_op_is_an_error_and_never_a_panic() {
        let lines = [
            "",
            "not json",
            r#"{"op":"teleport"}"#,
            r#"{"op":"serve","id":1}"#,
            r#"{"op":"let_go","infoHash":"short"}"#,
            r#"{"ev":"ready"}"#,
        ];
        for line in lines {
            assert!(Op::from_line(line).is_err(), "{line:?}");
        }
    }

    #[test]
    fn a_field_the_codec_does_not_know_is_ignored() {
        // The engine may say more than this Host reads yet.
        let line = r#"{"ev":"ready","version":"9"}"#;
        assert_eq!(Event::from_line(line), Ok(Event::Ready));
    }

    #[test]
    fn only_status_chosen_and_failed_become_reports() {
        let status = Event::Status {
            info_hash: hash(),
            phase: TorrentPhase::Fetching,
            peers: 2,
            rate: 10,
        };
        assert_eq!(
            status.into_report(),
            Some(TorrentReport::Status {
                info_hash: hash(),
                phase: TorrentPhase::Fetching,
                peers: 2,
                rate: 10,
            })
        );
        assert!(Event::Ready.into_report().is_none());
        assert!(Event::Refused {
            id: 1,
            sentence: String::new()
        }
        .into_report()
        .is_none());
    }
}
