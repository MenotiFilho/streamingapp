//! The Torrent engine seam: how a chosen torrent becomes a URL the Player can
//! open.
//!
//! A torrent Stream is not bytes, it is an infoHash and a swarm. The **Torrent
//! engine** (CONTEXT.md) is what joins the swarm and serves the file asked for,
//! and this is the seam the Host reaches it through, carried beside the
//! [`Player`](crate::Player) and the [`Previewer`](crate::Previewer) (ADR-0042
//! §2). It answers at once with a loopback [`StreamUrl`], before the torrent's
//! metadata has arrived, and reports what it finds afterwards; the Host is never
//! blocked on a swarm.
//!
//! Like the Player and the transport, the real implementation lives outside this
//! crate: this one holds neither the network, `tokio` nor `unsafe` code, only the
//! vocabulary the seam speaks and the two fakes a Host is tested against —
//! [`FixtureTorrentEngine`], which a test drives, and [`NoTorrentEngine`], which
//! a Host without a torrent engine has.

use std::fmt;
use std::sync::Mutex;

use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::playback::StreamUrl;
use crate::preferences::{StreamBuffer, TorrentCache};

/// A torrent's identity: the SHA-1 of its info dictionary, spelled as 40
/// lowercase hexadecimal characters.
///
/// Addons write it two ways — 40 hex characters in an `infoHash`, and either 40
/// hex or 32 base32 characters in a magnet's `xt=urn:btih:` — so it is read in
/// both and kept in one, and two spellings of the same torrent compare equal.
/// Anything else is not a torrent this Host can name, and a candidate carrying it
/// is dropped like any malformed one.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct InfoHash(String);

/// The RFC 4648 base32 alphabet: `A`–`Z`, then `2`–`7`.
const BASE32: &[u8; 32] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

impl InfoHash {
    /// An infoHash from 40 hexadecimal or 32 base32 characters, in either case,
    /// or why it is not one.
    pub fn parse(raw: &str) -> Result<Self, InvalidInfoHash> {
        let refused = || InvalidInfoHash {
            value: raw.to_owned(),
        };
        match raw.len() {
            40 if raw.bytes().all(|b| b.is_ascii_hexdigit()) => Ok(Self(raw.to_ascii_lowercase())),
            32 => {
                let mut bytes = Vec::with_capacity(20);
                let (mut buffer, mut bits) = (0u32, 0u32);
                for character in raw.bytes() {
                    let value = BASE32
                        .iter()
                        .position(|&b| b == character.to_ascii_uppercase())
                        .ok_or_else(refused)?;
                    buffer = (buffer << 5) | value as u32;
                    bits += 5;
                    if bits >= 8 {
                        bits -= 8;
                        bytes.push((buffer >> bits) as u8);
                        buffer &= (1 << bits) - 1;
                    }
                }
                Ok(Self(bytes.iter().map(|b| format!("{b:02x}")).collect()))
            }
            _ => Err(refused()),
        }
    }

    /// The infoHash as 40 lowercase hexadecimal characters.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for InfoHash {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl Serialize for InfoHash {
    /// As the 40 lowercase hexadecimal characters, which is what a client reads.
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0)
    }
}

impl<'de> Deserialize<'de> for InfoHash {
    /// Read the way an Addon's is: 40 hexadecimal or 32 base32 characters, and
    /// anything else is refused, so a client cannot send back a name this Host
    /// could not have listed.
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = String::deserialize(deserializer)?;
        Self::parse(&raw).map_err(serde::de::Error::custom)
    }
}

/// A string that is not an infoHash, offered as one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, thiserror::Error)]
#[error("{value:?} is not an infoHash — it is 40 hexadecimal or 32 base32 characters")]
pub struct InvalidInfoHash {
    pub value: String,
}

/// What the Host knows about the file it wants, so the engine can choose it
/// once the torrent's metadata arrives (ADR-0042 §4).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ServeHints {
    /// `behaviorHints.filename`: the Addon's own name for the file it means.
    pub filename: Option<String>,
    /// The Video's season and episode, as [`meta::episode_of`](crate::meta)
    /// reads them.
    pub season: Option<u32>,
    pub episode: Option<u32>,
}

/// One torrent the Host asks the engine to serve.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServeRequest {
    pub info_hash: InfoHash,
    /// Which file of the torrent the Addon said, trusted by the engine only when
    /// it is in range and points at a video.
    pub file_idx: Option<u32>,
    /// Trackers and `dht:` sources, kept as the Addon wrote them.
    pub sources: Vec<String>,
    pub hints: ServeHints,
}

/// How far a torrent has come before it is being fetched.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TorrentPhase {
    /// Still looking for the torrent: no metadata, or no peer yet.
    Finding,
    /// Bytes are arriving.
    Fetching,
}

/// Why a torrent failed, as far as the Host acts on it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FailureKind {
    /// No file of the torrent is the one asked for (ADR-0042 §4).
    NoFile,
    /// The engine could not keep the torrent on disk: the Stream ends.
    Storage,
    Other,
}

/// What the engine says on its own, collected by [`TorrentEngine::reports`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TorrentReport {
    Status {
        info_hash: InfoHash,
        phase: TorrentPhase,
        peers: u32,
        /// Bytes per second.
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
        /// The engine's own words, which the Host shows in place of the Player's.
        sentence: String,
    },
    /// The engine itself ended: its process, or the pipe to it.
    Exited,
}

/// How much the engine reads ahead and keeps, applied to every held torrent at
/// once. The arithmetic that makes it belongs to the Host's preferences; this is
/// only what is told.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TorrentLimits {
    pub readahead_bytes: u64,
    pub cache_bytes: u64,
}

impl TorrentLimits {
    /// The least a torrent is ever read ahead: 16 MiB.
    pub const MIN_READAHEAD_BYTES: u64 = 16 << 20;

    /// The limits two preferences make (ADR-0042 §3): a torrent is read ahead by
    /// three quarters of the Stream buffer's bytes, and never less than 16 MiB,
    /// and the disk it may take is the Torrent cache.
    ///
    /// The Stream buffer's megabytes are decimal, as the interface says; the
    /// engine clamps the read-ahead to what its cache can hold.
    pub fn from_preferences(buffer: StreamBuffer, cache: TorrentCache) -> Self {
        Self {
            readahead_bytes: readahead_for(buffer.megabytes() * 1_000_000),
            cache_bytes: cache.bytes(),
        }
    }
}

/// Three quarters of a buffer's bytes, and at least 16 MiB.
fn readahead_for(buffer_bytes: u64) -> u64 {
    (buffer_bytes / 4 * 3).max(TorrentLimits::MIN_READAHEAD_BYTES)
}

/// The engine could not serve a torrent, in a sentence an owner can read.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, thiserror::Error)]
#[error("{sentence}")]
pub struct TorrentError {
    pub sentence: String,
}

impl TorrentError {
    pub fn new(sentence: impl Into<String>) -> Self {
        Self {
            sentence: sentence.into(),
        }
    }
}

/// The Host's seam between a chosen torrent Stream and the Player (ADR-0042 §2).
pub trait TorrentEngine: Send + Sync {
    /// Serve a torrent's file: answered at once with a loopback URL, before
    /// metadata.
    fn serve(&self, request: &ServeRequest) -> Result<StreamUrl, TorrentError>;

    /// Drop a torrent: stop fetching and uploading, delete its directory.
    fn let_go(&self, info_hash: &InfoHash);

    /// Read-ahead and the disk ceiling, applied to every held torrent at once.
    fn set_limits(&self, limits: TorrentLimits);

    /// What the engine has reported since the last call: status, the chosen
    /// file, failures, its own exit.
    fn reports(&self) -> Vec<TorrentReport>;
}

/// The sentence a Host without a torrent engine refuses with.
const NOT_IN_THIS_BUILD: &str = "The torrent engine is not part of this build.";

/// A Host with no torrent engine: every serve is refused.
///
/// What a test gets when it does not name one, and what the shell uses when the
/// engine's binary is missing, so a torrent Stream fails with a sentence rather
/// than a panic.
#[derive(Debug, Default)]
pub struct NoTorrentEngine;

impl TorrentEngine for NoTorrentEngine {
    fn serve(&self, _request: &ServeRequest) -> Result<StreamUrl, TorrentError> {
        Err(TorrentError::new(NOT_IN_THIS_BUILD))
    }

    fn let_go(&self, _info_hash: &InfoHash) {}

    fn set_limits(&self, _limits: TorrentLimits) {}

    fn reports(&self) -> Vec<TorrentReport> {
        Vec::new()
    }
}

/// A [`TorrentEngine`] a test drives by hand: it records what the Host asked, in
/// order, and reports whatever a test tells it to.
#[derive(Debug, Default)]
pub struct FixtureTorrentEngine {
    serves: Mutex<Vec<ServeRequest>>,
    let_gos: Mutex<Vec<InfoHash>>,
    limits: Mutex<Vec<TorrentLimits>>,
    queued: Mutex<Vec<TorrentReport>>,
    refusing: Mutex<Option<TorrentError>>,
}

impl FixtureTorrentEngine {
    /// An engine that serves every request and has nothing to report.
    pub fn new() -> Self {
        Self::default()
    }

    /// Refuse every serve with `sentence`, for the paths where the engine cannot
    /// start or will not serve.
    #[must_use]
    pub fn refusing(self, sentence: &str) -> Self {
        *self.refusing.lock().expect("the fixture is not poisoned") =
            Some(TorrentError::new(sentence));
        self
    }

    /// Queue a report for the next [`TorrentEngine::reports`] call.
    pub fn report(&self, report: TorrentReport) {
        self.queued
            .lock()
            .expect("the fixture is not poisoned")
            .push(report);
    }

    /// Every request the Host served, in order.
    pub fn serves(&self) -> Vec<ServeRequest> {
        self.serves
            .lock()
            .expect("the fixture is not poisoned")
            .clone()
    }

    /// Every torrent the Host let go, in order.
    pub fn let_gos(&self) -> Vec<InfoHash> {
        self.let_gos
            .lock()
            .expect("the fixture is not poisoned")
            .clone()
    }

    /// Every limit the Host told, in order.
    pub fn limits(&self) -> Vec<TorrentLimits> {
        self.limits
            .lock()
            .expect("the fixture is not poisoned")
            .clone()
    }
}

impl TorrentEngine for FixtureTorrentEngine {
    fn serve(&self, request: &ServeRequest) -> Result<StreamUrl, TorrentError> {
        let mut serves = self.serves.lock().expect("the fixture is not poisoned");
        serves.push(request.clone());
        if let Some(refusal) = self
            .refusing
            .lock()
            .expect("the fixture is not poisoned")
            .clone()
        {
            return Err(refusal);
        }
        // A URL of the shape the real engine answers with, distinct per serve.
        let url = format!(
            "http://127.0.0.1:9/fixture-token/{}/{}",
            request.info_hash,
            serves.len()
        );
        Ok(StreamUrl::parse(&url).expect("a fixture URL is a URL"))
    }

    fn let_go(&self, info_hash: &InfoHash) {
        self.let_gos
            .lock()
            .expect("the fixture is not poisoned")
            .push(info_hash.clone());
    }

    fn set_limits(&self, limits: TorrentLimits) {
        self.limits
            .lock()
            .expect("the fixture is not poisoned")
            .push(limits);
    }

    fn reports(&self) -> Vec<TorrentReport> {
        std::mem::take(&mut *self.queued.lock().expect("the fixture is not poisoned"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const HEX: &str = "c12fe1c06bba254a9dc9f519b335aa7c1367a88a";
    // The same 20 bytes in base32.
    const BASE32_HASH: &str = "YEX6DQDLXISUVHOJ6UM3GNNKPQJWPKEK";

    fn hash(raw: &str) -> InfoHash {
        InfoHash::parse(raw).expect("an infoHash")
    }

    fn request(info_hash: &InfoHash) -> ServeRequest {
        ServeRequest {
            info_hash: info_hash.clone(),
            file_idx: Some(2),
            sources: vec!["tracker:udp://tracker.example.org:1337".to_owned()],
            hints: ServeHints {
                filename: Some("Show.S01E03.mkv".to_owned()),
                season: Some(1),
                episode: Some(3),
            },
        }
    }

    #[test]
    fn forty_hex_characters_are_an_info_hash_in_either_case() {
        assert_eq!(hash(HEX).as_str(), HEX);
        assert_eq!(hash(&HEX.to_ascii_uppercase()).as_str(), HEX);
        let mixed = format!("{}{}", HEX[..20].to_ascii_uppercase(), &HEX[20..]);
        assert_eq!(hash(&mixed).as_str(), HEX);
    }

    #[test]
    fn thirty_two_base32_characters_are_the_same_info_hash_in_lowercase_hex() {
        assert_eq!(hash(BASE32_HASH), hash(HEX));
        assert_eq!(hash(BASE32_HASH).as_str(), HEX);
        assert_eq!(hash(&BASE32_HASH.to_ascii_lowercase()), hash(HEX));
    }

    #[test]
    fn base32_reads_every_byte_of_its_alphabet() {
        // All zero bits, and all one bits: the two ends of the alphabet.
        assert_eq!(hash(&"A".repeat(32)).as_str(), "0".repeat(40));
        assert_eq!(hash(&"7".repeat(32)).as_str(), "f".repeat(40));
    }

    #[test]
    fn every_other_length_is_refused() {
        for length in [0, 1, 31, 33, 39, 41, 64] {
            let raw = "a".repeat(length);
            assert!(InfoHash::parse(&raw).is_err(), "{length} characters");
        }
    }

    #[test]
    fn a_character_outside_the_alphabet_is_refused() {
        // Hex's alphabet at the base32 length, and base32's at the hex length.
        assert!(InfoHash::parse(&"0".repeat(32)).is_err(), "0 is not base32");
        assert!(InfoHash::parse(&"1".repeat(32)).is_err(), "1 is not base32");
        assert!(InfoHash::parse(&"8".repeat(32)).is_err(), "8 is not base32");
        assert!(InfoHash::parse(&"9".repeat(32)).is_err(), "9 is not base32");
        assert!(InfoHash::parse(&"g".repeat(40)).is_err(), "g is not hex");
        assert!(InfoHash::parse(&format!("{}!", &HEX[..39])).is_err());
        assert!(InfoHash::parse(&format!("{} ", &HEX[..39])).is_err());
        assert!(InfoHash::parse(&format!("{}é", &HEX[..38])).is_err());
        assert!(InfoHash::parse(&format!("{}=", &BASE32_HASH[..31])).is_err());
    }

    fn limits(buffer_megabytes: u64, cache_megabytes: u64) -> TorrentLimits {
        TorrentLimits::from_preferences(
            StreamBuffer::parse(300, buffer_megabytes).expect("a buffer"),
            TorrentCache::parse(cache_megabytes).expect("a cache"),
        )
    }

    #[test]
    fn read_ahead_is_three_quarters_of_the_stream_buffers_bytes() {
        assert_eq!(limits(512, 2000).readahead_bytes, 384_000_000);
        assert_eq!(limits(4096, 2000).readahead_bytes, 3_072_000_000);
    }

    #[test]
    fn read_ahead_is_never_less_than_sixteen_mebibytes() {
        // 64 MB is the smallest buffer: three quarters is 48 MB, above the floor.
        assert_eq!(limits(64, 2000).readahead_bytes, 48_000_000);
        // The floor binds below 22.37 MB of buffer, which the preference cannot be
        // set to today but the arithmetic must still hold.
        assert_eq!(readahead_for(0), 16 << 20);
        assert_eq!(readahead_for(20_000_000), 16 << 20);
        assert_eq!(readahead_for(30_000_000), 22_500_000);
    }

    #[test]
    fn the_cache_is_the_torrent_caches_bytes_whatever_the_buffer_is() {
        assert_eq!(limits(512, 2000).cache_bytes, 2_000_000_000);
        assert_eq!(limits(64, 256).cache_bytes, 256_000_000);
        assert_eq!(limits(4096, 32000).cache_bytes, 32_000_000_000);
        assert_eq!(limits(64, 2000).cache_bytes, limits(4096, 2000).cache_bytes);
    }

    #[test]
    fn the_fixture_records_serves_let_gos_and_limits_in_order() {
        let engine = FixtureTorrentEngine::new();
        let first = hash(HEX);
        let second = hash(&"b".repeat(40));
        let limits = TorrentLimits {
            readahead_bytes: 16 << 20,
            cache_bytes: 2_000_000_000,
        };

        let url = engine.serve(&request(&first)).expect("served");
        engine.set_limits(limits);
        engine.serve(&request(&second)).expect("served");
        engine.let_go(&second);
        engine.let_go(&first);

        assert!(url.as_str().starts_with("http://127.0.0.1:"));
        assert_eq!(
            engine.serves(),
            vec![request(&first), request(&second)],
            "the whole request is kept, hints and all"
        );
        assert_eq!(engine.let_gos(), vec![second, first]);
        assert_eq!(engine.limits(), vec![limits]);
    }

    #[test]
    fn the_fixture_reports_what_a_test_queued_once() {
        let engine = FixtureTorrentEngine::new();
        assert!(engine.reports().is_empty());

        let status = TorrentReport::Status {
            info_hash: hash(HEX),
            phase: TorrentPhase::Fetching,
            peers: 4,
            rate: 1_000_000,
        };
        engine.report(status.clone());
        engine.report(TorrentReport::Exited);

        assert_eq!(engine.reports(), vec![status, TorrentReport::Exited]);
        assert!(engine.reports().is_empty(), "what was reported is gone");
    }

    #[test]
    fn a_refusing_fixture_still_records_the_serve() {
        let engine = FixtureTorrentEngine::new().refusing("Nobody home.");

        let refused = engine.serve(&request(&hash(HEX)));

        assert_eq!(refused, Err(TorrentError::new("Nobody home.")));
        assert_eq!(engine.serves().len(), 1);
    }

    #[test]
    fn a_host_without_an_engine_refuses_every_serve_with_its_sentence() {
        let engine = NoTorrentEngine;

        let refused = engine.serve(&request(&hash(HEX))).expect_err("refused");

        assert_eq!(
            refused.to_string(),
            "The torrent engine is not part of this build."
        );
        engine.let_go(&hash(HEX));
        engine.set_limits(TorrentLimits {
            readahead_bytes: 1,
            cache_bytes: 1,
        });
        assert!(engine.reports().is_empty());
    }
}
