//! A `stream` response, in the Host's own words: **the candidates one Addon
//! offers for one Video**.
//!
//! A Stream here is the Host's own thing, not the protocol's object. The
//! protocol's `stream` object carries raw fields and implies that everything it
//! lists can be played; the Host's Stream says where the bytes are *and whether
//! this Host can play them* — a direct URL mpv opens as itself, or a torrent
//! (an `infoHash`, or a `magnet:` in `url`) that this version lists and marks
//! unplayable until the torrent engine arrives (#311). That is what the Provider
//! seam exists for: a candidate that is not playable yet has a shape of its own,
//! so playing it can change without the list, the answer or any client changing
//! shape.
//!
//! ## The Addon's words are kept verbatim
//!
//! `name` and the description are the Addon's own — for AIOStreams, its
//! formatter's badge line (`1080p`, `[RD+]`, `4k DV | HDR`) and the release
//! line under it. The Host re-shapes nothing and re-ranks nothing: what the
//! owner configured their Addon to say is what the list shows, in the order the
//! Addon said it.
//!
//! ## Exactly one location, and only the shapes this Host has
//!
//! A protocol stream object locates its bytes with one of its location fields
//! — `url`, `ytId`, `infoHash`, `externalUrl`, `nzbUrl`, or one of the archive
//! lists — and *exactly* one of them, counting only the fields that say
//! something: an empty string or an empty list is absence serialized, not a
//! second answer. An object carrying none, or more than one, is not guessed at:
//! it is dropped, the way an unreadable catalog item is dropped, and the
//! candidates around it stand. An object whose single location is a shape this
//! Host does not have — a YouTube id, an external web page, an archive this
//! Host cannot unpack — is not a Stream here either: nothing in this Host would
//! ever play one, and a candidate no code path can reach is a promise the list
//! would not be keeping.
//!
//! ## Hints are surfaced, never obeyed
//!
//! `behaviorHints` says how the Addon expects the Stream to behave —
//! `notWebReady` (no https, or not an MP4), `p2p`, `proxyHeaders` (the URL
//! wants particular request headers) — and every one of those is a warning
//! beside the candidate rather than a filter that removes it. A hint is the
//! Addon's opinion about some client; which client can do what with it is the
//! client's business, and mpv is not a web page.
//!
//! ## A torrent is read whole
//!
//! A torrent Stream keeps what the swarm will need: its `fileIdx` (which file of
//! the torrent is the Video), and its `sources` — `announce` is read as an alias,
//! the way the official client core reads it — the `tracker:` and `dht:` entries
//! the Addon points at. Sources are kept verbatim, at most [`MAX_SOURCES`] of at
//! most [`MAX_SOURCE_LEN`] characters each, and the excess is dropped. A `magnet:`
//! in `url` is the same torrent written another way: its `xt=urn:btih:` hash and
//! each `tr=` tracker (as `tracker:<tr>`), with no `fileIdx` and its `dn`
//! ignored. Neither is a direct URL, and a hash that is not an
//! [`InfoHash`] drops the candidate like any malformed one.
//!
//! The rest of a stream object — `subtitles`, `videoSize`, `videoHash`, and
//! Addon-specific fields like WatchHub's per-platform URLs — is not read: nothing
//! here acts on it, and reading a field nothing acts on is a promise this Host
//! would not be keeping (ADR-0009). The subtitles ticket is where a stream's own
//! `subtitles` arrive.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::action::ActionError;
use crate::addon::{AddonId, MAX_ITEMS, MAX_STRING_LEN};
use crate::torrent::InfoHash;

/// The most of a stream body the Host will read.
///
/// An answer of a hundred candidates is tens of kilobytes, trackers and all; an
/// Addon answering with megabytes is misbehaving or lying.
pub const MAX_STREAM_BYTES: usize = 4 * 1024 * 1024;

/// The most `sources` a torrent Stream keeps; the rest are dropped.
pub const MAX_SOURCES: usize = 32;

/// The most characters one of a torrent's `sources` may have; a longer entry is
/// dropped, not cut, because half a tracker address is not one.
pub const MAX_SOURCE_LEN: usize = 512;

/// The fields the protocol says point at a stream's bytes, of which exactly one
/// may be present.
///
/// The single-valued ones (`url`, `ytId`, `infoHash`, `externalUrl`, `nzbUrl`)
/// and the archive lists (`rarUrls`, `zipUrls`, `7zipUrls`, `tgzUrls`,
/// `tarUrls`) are all locations: a `url` beside an `nzbUrl` is two answers to
/// the same question, not a direct one and a spare.
const LOCATIONS: [&str; 10] = [
    "url",
    "ytId",
    "infoHash",
    "externalUrl",
    "nzbUrl",
    "rarUrls",
    "zipUrls",
    "7zipUrls",
    "tgzUrls",
    "tarUrls",
];

/// One candidate a Provider returned for a Video, as the Host lists it.
///
/// Readable as well as readable-from: a client that chooses a candidate sends it
/// back in the Action that plays it. Everything but where the bytes are may be
/// missing — a candidate with no badge line is still a candidate — and the
/// fields a variant does not know are ignored, the way every Action's own object
/// is (ADR-0009's wire rule).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stream {
    /// The Addon's own word for the candidate, verbatim: its badges —
    /// resolution, quality, source, cached — as its formatter wrote them.
    #[serde(default)]
    pub name: Option<String>,
    /// The Addon's longer description: the release, the size, the seeders.
    /// Read from `description`, falling back to the deprecated `title` that
    /// Addons in the wild still answer with.
    #[serde(default)]
    pub description: Option<String>,
    /// Where the bytes are, and whether this Host can open them.
    pub playback: Playback,
    /// What the Addon's hints say about playing it, in the order they were
    /// read. Surfaced, never acted on: a warning is not a filter.
    #[serde(default)]
    pub warnings: Vec<Warning>,
    /// The file's own name, where the Addon knows it
    /// (`behaviorHints.filename`).
    #[serde(default)]
    pub filename: Option<String>,
    /// The release the Addon binge-groups a series' episodes by
    /// (`behaviorHints.bingeGroup`), so two releases can be told apart and a
    /// later ticket can binge on one.
    #[serde(default)]
    pub binge_group: Option<String>,
}

/// Where a Stream's bytes are, and whether this Host can play it now.
///
/// The two shapes, and the only two: a direct URL mpv opens as itself, and a
/// torrent that the Torrent engine must turn into bytes first.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum Playback {
    /// A direct URL: mpv opens it as itself.
    Direct { url: String },
    /// A torrent: an Addon's `infoHash` Stream, or a `magnet:` in its `url`.
    /// Listed and marked unplayable until the Torrent engine can serve it
    /// (#311), and it will play from this same shape.
    Torrent {
        info_hash: InfoHash,
        /// Which file of the torrent is the Video, where the Addon says; absent,
        /// the engine chooses once the torrent's metadata arrives.
        #[serde(default)]
        file_idx: Option<u32>,
        /// The Addon's `sources` (or `announce`), verbatim: `tracker:` and
        /// `dht:` entries, within [`MAX_SOURCES`] and [`MAX_SOURCE_LEN`].
        #[serde(default)]
        sources: Vec<String>,
    },
}

/// What the Addon's hints say about playing a Stream.
///
/// Every one of these is shown beside the candidate and removes none of them:
/// they are the Addon's expectations about clients, and the clients here are
/// mpv and a browser on another device, which do not agree about what they can
/// play.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Warning {
    /// The URL is not fit for a browser — no https, or not an MP4
    /// (`behaviorHints.notWebReady`).
    NotWebReady,
    /// The Stream comes from peers (`behaviorHints.p2p`).
    P2p,
    /// The URL wants particular request headers sent with it
    /// (`behaviorHints.proxyHeaders`), which this Host does not send yet.
    ProxyHeaders,
}

/// One Addon's answer to a Video's stream request, on its way to the client that
/// asked for it.
///
/// The Addon travels with it, because every Addon that answers a `stream`
/// request is asked at once and the answer has to say which is which (ADR-0005
/// — a client's stream list is its own, so it travels as an answer and never as
/// a Snapshot). `failure` is what a search's row already carries, for the same
/// reason: one Addon being down is one group that says so, not a question that
/// fails (ADR-0010).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddonStreams {
    pub addon: AddonId,
    /// The candidates, in the Addon's own order. The Host re-ranks nothing.
    pub streams: Vec<Stream>,
    /// Set when the Addon did not answer: the group is then empty and this says
    /// why, in the Host's vocabulary, so one Addon's failure does not blank
    /// another's candidates.
    pub failure: Option<ActionError>,
}

/// Why a stream response was not read, in the Host's own vocabulary.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum StreamError {
    #[error("that is not a stream response: {detail}")]
    NotJson { detail: String },
    #[error("the stream response is missing {field}")]
    Missing { field: String },
    #[error("{field} should be {expected}")]
    WrongType {
        field: String,
        expected: &'static str,
    },
    #[error("{field} is longer than this Host will hold ({limit})")]
    TooLarge { field: String, limit: usize },
}

impl Stream {
    /// Read a `streams` response into the Host's own candidates.
    ///
    /// Pure: no I/O, no state, and a refusal is just a value. An object that
    /// cannot be read as a Stream is dropped rather than blanking the answer
    /// around it — a hundred candidates are not all-or-nothing — but a body
    /// that is not a stream response is a refusal, because that is a fact about
    /// the Addon rather than about one candidate.
    pub fn parse(body: &str) -> Result<Vec<Self>, StreamError> {
        if body.len() > MAX_STREAM_BYTES {
            return Err(StreamError::TooLarge {
                field: "the stream response".to_owned(),
                limit: MAX_STREAM_BYTES,
            });
        }

        let value: Value = serde_json::from_str(body).map_err(|error| StreamError::NotJson {
            detail: error.to_string(),
        })?;
        let object = value.as_object().ok_or_else(|| StreamError::NotJson {
            detail: "a stream response is a JSON object".to_owned(),
        })?;

        let streams = object
            .get("streams")
            .ok_or_else(|| StreamError::Missing {
                field: "streams".to_owned(),
            })?
            .as_array()
            .ok_or_else(|| StreamError::WrongType {
                field: "streams".to_owned(),
                expected: "an array",
            })?;
        if streams.len() > MAX_ITEMS {
            return Err(StreamError::TooLarge {
                field: "streams".to_owned(),
                limit: MAX_ITEMS,
            });
        }

        Ok(streams.iter().filter_map(one).collect())
    }
}

/// One candidate, or nothing when the object is not one.
///
/// The module's location rule is applied here: exactly one location field, it
/// must say something, and it must name a shape this Host has. What makes an
/// object a Stream is not its name or its hints — those may all be missing —
/// but where its bytes are.
fn one(value: &Value) -> Option<Stream> {
    let object = value.as_object()?;

    let mut locations = object
        .iter()
        .filter(|(name, value)| LOCATIONS.contains(&name.as_str()) && locates(value))
        .map(|(name, _)| name.as_str());
    let location = locations.next()?;
    if locations.next().is_some() {
        return None;
    }

    let playback = match location {
        "url" => {
            let url = string(object.get("url")?)?;
            if is_magnet(&url) {
                magnet(&url)?
            } else {
                Playback::Direct { url }
            }
        }
        "infoHash" => Playback::Torrent {
            info_hash: InfoHash::parse(&string(object.get("infoHash")?)?).ok()?,
            file_idx: file_idx(object),
            sources: sources(object),
        },
        // ytId, externalUrl, nzbUrl, the archive lists: a single location, and
        // a shape this Host does not have. Nothing here plays one.
        _ => return None,
    };

    Some(Stream {
        name: field(object, "name"),
        // `title` is what the protocol deprecated in favour of `description`,
        // and what Addons in the wild — Torrentio among them — still answer
        // with, so a Stream reads both and shows one.
        description: field(object, "description").or_else(|| field(object, "title")),
        playback,
        warnings: warnings(object),
        filename: hint(object, "filename"),
        binge_group: hint(object, "bingeGroup"),
    })
}

/// A torrent's `fileIdx`: a non-negative whole number, or nothing.
///
/// Anything else — a string, a fraction, the `-1` some Addons write for "you
/// choose" — is the Addon not naming a file, and the engine chooses.
fn file_idx(object: &Map<String, Value>) -> Option<u32> {
    u32::try_from(object.get("fileIdx")?.as_u64()?).ok()
}

/// A torrent's `sources`, or its `announce` alias: the entries that are
/// strings, within the bounds. `sources` wins when an object carries both.
fn sources(object: &Map<String, Value>) -> Vec<String> {
    let Some(entries) = object
        .get("sources")
        .or_else(|| object.get("announce"))
        .and_then(Value::as_array)
    else {
        return Vec::new();
    };
    bounded(entries.iter().filter_map(Value::as_str))
}

/// Entries within the bounds, in order: the empty and the overlong are dropped,
/// and so is everything past the first [`MAX_SOURCES`] that remain.
fn bounded<'a>(entries: impl Iterator<Item = &'a str>) -> Vec<String> {
    entries
        .filter(|entry| !entry.is_empty() && entry.chars().count() <= MAX_SOURCE_LEN)
        .take(MAX_SOURCES)
        .map(str::to_owned)
        .collect()
}

/// Whether a `url` is a magnet link rather than an address: the scheme is
/// case-insensitive.
fn is_magnet(url: &str) -> bool {
    url.get(.."magnet:".len())
        .is_some_and(|scheme| scheme.eq_ignore_ascii_case("magnet:"))
}

/// A magnet link as the torrent it names: the first `xt=urn:btih:` hash and each
/// `tr=` as `tracker:<tr>`. There is no file index in a magnet, and `dn` — a
/// display name nobody asked for — is ignored. A magnet without a valid `btih`
/// is nothing.
fn magnet(url: &str) -> Option<Playback> {
    let query = url["magnet:".len()..].strip_prefix('?')?;
    let mut hash = None;
    let mut trackers = Vec::new();
    for (key, value) in query.split('&').filter_map(|pair| pair.split_once('=')) {
        match key {
            "xt" if hash.is_none() => {
                let urn = decoded(value);
                if let Some((scheme, rest)) = urn.split_at_checked("urn:btih:".len()) {
                    if scheme.eq_ignore_ascii_case("urn:btih:") {
                        hash = Some(InfoHash::parse(rest).ok()?);
                    }
                }
            }
            "tr" if !value.is_empty() => trackers.push(format!("tracker:{}", decoded(value))),
            _ => {}
        }
    }
    Some(Playback::Torrent {
        info_hash: hash?,
        file_idx: None,
        sources: bounded(trackers.iter().map(String::as_str)),
    })
}

/// A magnet parameter's value with its percent-escapes undone. `+` stays `+`: a
/// tracker address may carry one, and a magnet is not a form.
fn decoded(value: &str) -> String {
    percent_encoding::percent_decode_str(value)
        .decode_utf8_lossy()
        .into_owned()
}

/// Whether a location field carries a location.
///
/// An empty string, an empty list, or a `null` is the Addon not passing one —
/// a serialization of absence, which is how Addons in the wild write a field
/// they have nothing for. Only a field that says something counts towards the
/// exactly-one rule: a `url` beside an empty `rarUrls` is one answer and not
/// two, and an empty `ytId` beside an `infoHash` is not the Addon
/// contradicting itself.
fn locates(value: &Value) -> bool {
    match value {
        Value::String(text) => !text.is_empty(),
        Value::Array(items) => !items.is_empty(),
        _ => false,
    }
}

/// The warnings a candidate's hints carry, in a fixed order.
fn warnings(object: &Map<String, Value>) -> Vec<Warning> {
    let Some(hints) = object.get("behaviorHints").and_then(Value::as_object) else {
        return Vec::new();
    };

    let mut warnings = Vec::new();
    if hints.get("notWebReady") == Some(&Value::Bool(true)) {
        warnings.push(Warning::NotWebReady);
    }
    if hints.get("p2p") == Some(&Value::Bool(true)) {
        warnings.push(Warning::P2p);
    }
    if hints.get("proxyHeaders").is_some_and(Value::is_object) {
        warnings.push(Warning::ProxyHeaders);
    }
    warnings
}

/// One named field of a stream object, read as a string.
fn field(object: &Map<String, Value>, name: &str) -> Option<String> {
    string(object.get(name)?)
}

/// One named hint of a stream object's `behaviorHints`, read as a string.
fn hint(object: &Map<String, Value>, name: &str) -> Option<String> {
    string(object.get("behaviorHints")?.get(name)?)
}

/// A non-empty string of a length the Host will hold, or nothing.
///
/// A field of the wrong type is a field the Addon did not send: a candidate
/// whose badges are a number is still a candidate, and one whose *location* is
/// a number is not one, because nothing can play it.
fn string(value: &Value) -> Option<String> {
    let text = value.as_str()?;
    if !holdable(text) {
        return None;
    }
    Some(text.to_owned())
}

/// Whether a word is one the Host will hold: it says something and it is short
/// enough to keep.
///
/// The rule a Stream's own words are read by, applied wherever a word arrives —
/// from an Addon's answer, and from a client sending a candidate back to play.
/// Line breaks are kept: AIOStreams writes its badges as one string with a
/// newline in it, and that string is the Addon's own word for the candidate.
pub(crate) fn holdable(word: &str) -> bool {
    !word.is_empty() && word.len() <= MAX_STRING_LEN
}

#[cfg(test)]
mod tests {
    use super::*;

    const TORRENTIO: &str = include_str!("../tests/fixtures/torrentio-streams-matrix.json");
    const TORRENTIO_EPISODE: &str =
        include_str!("../tests/fixtures/torrentio-streams-bb-s1e1.json");
    const WATCHHUB: &str = include_str!("../tests/fixtures/watchhub-streams-matrix.json");
    const DIRECT: &str = include_str!("../tests/fixtures/streams-direct-url.json");
    const BAD_ITEM: &str = include_str!("../tests/fixtures/streams-with-a-bad-item.json");
    const HOSTILE: &str = include_str!("../tests/fixtures/hostile-streams.json");

    fn parsed(body: &str) -> Vec<Stream> {
        Stream::parse(body).unwrap_or_else(|error| panic!("{body} should parse: {error}"))
    }

    fn refused(body: &str) -> StreamError {
        match Stream::parse(body) {
            Ok(streams) => panic!("{body} should be refused, but parsed as {streams:?}"),
            Err(error) => error,
        }
    }

    const HEX: &str = "abcdef0123456789abcdef0123456789abcdef01";

    /// The infoHash a candidate says its bytes are at, or a complaint.
    fn info_hash(stream: &Stream) -> &str {
        match &stream.playback {
            Playback::Torrent { info_hash, .. } => info_hash.as_str(),
            other => panic!("expected a torrent candidate: {other:?}"),
        }
    }

    /// A torrent candidate's file index and sources, or a complaint.
    fn shape(stream: &Stream) -> (Option<u32>, &[String]) {
        match &stream.playback {
            Playback::Torrent {
                file_idx, sources, ..
            } => (*file_idx, sources),
            other => panic!("expected a torrent candidate: {other:?}"),
        }
    }

    /// The one candidate a body holds, as a torrent: its hash, file index and
    /// sources.
    fn torrent_of(body: &str) -> (String, Option<u32>, Vec<String>) {
        let streams = parsed(body);
        assert_eq!(streams.len(), 1, "{body} is one candidate");
        let (file_idx, sources) = shape(&streams[0]);
        (
            info_hash(&streams[0]).to_owned(),
            file_idx,
            sources.to_vec(),
        )
    }

    fn stream_with(fields: &str) -> String {
        format!(r#"{{"streams":[{{{fields}}}]}}"#)
    }

    /// The URL a candidate says its bytes are at, or a complaint.
    fn url(stream: &Stream) -> &str {
        match &stream.playback {
            Playback::Direct { url } => url,
            other => panic!("expected a direct-URL candidate: {other:?}"),
        }
    }

    #[test]
    fn a_recorded_answer_is_read_into_its_candidates_in_the_addons_own_order() {
        let streams = parsed(TORRENTIO);

        assert_eq!(streams.len(), 5);
        let first = &streams[0];
        assert_eq!(
            first.name.as_deref(),
            Some("Torrentio\n4k DV | HDR"),
            "the Addon's own badge line arrives verbatim, newline and all"
        );
        assert!(
            first
                .description
                .as_deref()
                .is_some_and(|description| description.starts_with("Матрица / The Matrix")),
            "a recorded answer keeps its own words: {:?}",
            first.description
        );
        assert_eq!(
            first.filename.as_deref(),
            Some("Матрица.1999.WEB-DL.2160p.mkv"),
            "the filename is the hint's, where the Addon gives one"
        );
        assert_eq!(
            first.binge_group.as_deref(),
            Some("torrentio|4k|WEB-DL|10bit|DV|HDR"),
            "two releases are told apart by the group the Addon binge-groups them in"
        );
        assert_eq!(
            streams.iter().map(info_hash).collect::<Vec<_>>(),
            vec![
                "61065ea115b7cc3e8db9fb5ab1f6f327f08bd1c9",
                "8dc393c100ef0c0d010cfefdcebe572e26c4f775",
                "03dd34fea0ff15a451c1723062a901aa3a0ad458",
                "32dde1f88cb0d890b7e8dd5064c91f30477f2c94",
                "17e40c4a20a021a52f43550912879e19b75c2c47",
            ],
            "no Host-side re-ranking: the recorded order is the order"
        );
    }

    #[test]
    fn an_infohash_candidate_is_listed_as_a_torrent_not_dropped() {
        // A candidate whose bytes are a torrent is not a URL this Host can open
        // as itself — and the list says so by the shape it carries.
        let streams = parsed(TORRENTIO);

        assert_eq!(streams.len(), 5, "every recorded candidate is listed");
        for stream in &streams {
            assert!(
                matches!(stream.playback, Playback::Torrent { .. }),
                "a torrent is not a URL this Host can open: {stream:?}"
            );
        }
    }

    #[test]
    fn a_torrent_keeps_its_file_index_and_sources_when_the_addon_gives_them() {
        // The recorded answer: the first candidate names its file and its
        // sources, the second names neither, the third names a file only.
        let streams = parsed(TORRENTIO);

        assert_eq!(
            shape(&streams[0]),
            (
                Some(0),
                &[
                    "tracker:http://bt4.t-ru.org/ann?magnet".to_owned(),
                    "dht:61065ea115b7cc3e8db9fb5ab1f6f327f08bd1c9".to_owned(),
                ][..]
            ),
            "fileIdx 0 is a file, not an absence"
        );
        assert_eq!(
            shape(&streams[1]),
            (None, &[][..]),
            "a torrent without fileIdx"
        );
        assert_eq!(shape(&streams[2]), (Some(2), &[][..]));
    }

    #[test]
    fn a_torrent_reads_its_sources_from_announce_when_that_is_what_the_addon_says() {
        // `announce` is what the official client core serializes, and what a
        // client re-sending a Stream through it would write.
        let (_, _, sources) = torrent_of(&stream_with(&format!(
            r#""infoHash":"{HEX}","announce":["tracker:udp://tracker.example.org:1337","dht:{HEX}"]"#
        )));

        assert_eq!(
            sources,
            vec![
                "tracker:udp://tracker.example.org:1337".to_owned(),
                format!("dht:{HEX}"),
            ]
        );

        let (_, _, both) = torrent_of(&stream_with(&format!(
            r#""infoHash":"{HEX}","sources":["tracker:http://a.example/ann"],"announce":["tracker:http://b.example/ann"]"#
        )));
        assert_eq!(
            both,
            vec!["tracker:http://a.example/ann".to_owned()],
            "`sources` is the field the protocol documents, so it wins"
        );
    }

    #[test]
    fn a_file_index_that_is_not_a_whole_non_negative_number_is_the_addon_not_naming_a_file() {
        for value in ["-1", "1.5", "\"2\"", "null", "true", "4294967296"] {
            let (_, file_idx, _) = torrent_of(&stream_with(&format!(
                r#""infoHash":"{HEX}","fileIdx":{value}"#
            )));
            assert_eq!(file_idx, None, "fileIdx {value}");
        }

        let (_, file_idx, _) = torrent_of(&stream_with(&format!(
            r#""infoHash":"{HEX}","fileIdx":4294967295"#
        )));
        assert_eq!(file_idx, Some(u32::MAX));
    }

    #[test]
    fn sources_are_kept_verbatim_up_to_thirty_two_entries_of_five_hundred_and_twelve_characters() {
        let long = format!("tracker:http://{}", "a".repeat(MAX_SOURCE_LEN));
        let exact = format!("tracker:{}", "b".repeat(MAX_SOURCE_LEN - "tracker:".len()));
        assert_eq!(exact.chars().count(), MAX_SOURCE_LEN);

        let entries = serde_json::json!([
            long,
            exact,
            5,
            null,
            "",
            "tracker:UDP://Keeps.Case:80/x?y=%20"
        ]);
        let (_, _, sources) = torrent_of(&stream_with(&format!(
            r#""infoHash":"{HEX}","sources":{entries}"#
        )));
        assert_eq!(
            sources,
            vec![exact, "tracker:UDP://Keeps.Case:80/x?y=%20".to_owned()],
            "an overlong entry, a non-string and an empty one are dropped; the rest is verbatim"
        );

        let many: Vec<String> = (0..MAX_SOURCES + 8)
            .map(|n| format!("tracker:http://t{n}.example/ann"))
            .collect();
        let (_, _, kept) = torrent_of(&stream_with(&format!(
            r#""infoHash":"{HEX}","sources":{}"#,
            serde_json::json!(many)
        )));
        assert_eq!(kept.len(), MAX_SOURCES);
        assert_eq!(kept[..], many[..MAX_SOURCES], "the excess is the tail");
    }

    #[test]
    fn sources_that_are_not_a_list_are_no_sources() {
        for value in ["\"tracker:http://a.example\"", "null", "{}", "7"] {
            let (_, _, sources) = torrent_of(&stream_with(&format!(
                r#""infoHash":"{HEX}","sources":{value}"#
            )));
            assert!(sources.is_empty(), "sources {value}");
        }
    }

    #[test]
    fn an_infohash_is_kept_as_lowercase_hex_whichever_way_the_addon_spelled_it() {
        let upper = HEX.to_ascii_uppercase();
        assert_eq!(
            torrent_of(&stream_with(&format!(r#""infoHash":"{upper}""#))).0,
            HEX
        );

        // 32 base32 characters are the same 20 bytes: this spells the ASCII
        // "abcdefghijklmnopqrst".
        let base32 = "MFRGGZDFMZTWQ2LKNNWG23TPOBYXE43U";
        assert_eq!(
            torrent_of(&stream_with(&format!(r#""infoHash":"{base32}""#))).0,
            "6162636465666768696a6b6c6d6e6f7071727374"
        );
    }

    #[test]
    fn a_malformed_infohash_drops_the_candidate_and_leaves_its_neighbours() {
        let body = format!(
            r#"{{"streams":[{{"infoHash":"deadbeef"}},{{"infoHash":"{}g"}},{{"infoHash":5}},{{"infoHash":"{HEX}"}}]}}"#,
            &HEX[..39]
        );
        let streams = parsed(&body);

        assert_eq!(streams.len(), 1, "only the well-formed hash lists");
        assert_eq!(info_hash(&streams[0]), HEX);
    }

    #[test]
    fn a_magnet_in_url_is_a_torrent_not_a_direct_url() {
        let magnet = format!(
            "magnet:?xt=urn:btih:{HEX}&dn=The+Matrix+1999&tr=udp%3A%2F%2Ftracker.example.org%3A1337&tr=http%3A%2F%2Fb.example%2Fann%3Fpass%3Dx%2By"
        );
        let (hash, file_idx, sources) = torrent_of(&stream_with(&format!(r#""url":"{magnet}""#)));

        assert_eq!(hash, HEX);
        assert_eq!(file_idx, None, "a magnet names no file");
        assert_eq!(
            sources,
            vec![
                "tracker:udp://tracker.example.org:1337".to_owned(),
                "tracker:http://b.example/ann?pass=x+y".to_owned(),
            ],
            "each tr= is a tracker source, decoded; dn is nobody's business"
        );
    }

    #[test]
    fn a_magnets_hash_may_be_base32_and_its_scheme_and_keys_any_case_the_hash_urn_allows() {
        let (hash, _, sources) = torrent_of(&stream_with(
            r#""url":"MAGNET:?xt=URN:BTIH:MFRGGZDFMZTWQ2LKNNWG23TPOBYXE43U""#,
        ));
        assert_eq!(hash, "6162636465666768696a6b6c6d6e6f7071727374");
        assert!(sources.is_empty());

        // A hybrid magnet also carries a v2 `btmh` hash this Host does not read.
        let (hash, _, _) = torrent_of(&stream_with(&format!(
            r#""url":"magnet:?xt=urn:btmh:1220{}&xt=urn:btih:{HEX}""#,
            "0".repeat(64)
        )));
        assert_eq!(hash, HEX);
    }

    #[test]
    fn a_magnet_without_a_valid_btih_is_dropped_not_played_as_a_url() {
        for url in [
            "magnet:",
            "magnet:?",
            "magnet:?dn=just+a+name",
            "magnet:?xt=urn:btmh:1220aaaa",
            "magnet:?xt=urn:btih:",
            "magnet:?xt=urn:btih:deadbeef",
            &format!("magnet:?xt=urn:btih:{}g", &HEX[..39]),
            &format!("magnet:{HEX}"),
            &format!("magnet:?xt=btih:{HEX}"),
        ] {
            assert!(
                parsed(&stream_with(&format!(r#""url":"{url}""#))).is_empty(),
                "{url} is neither a torrent nor a URL"
            );
        }
    }

    #[test]
    fn a_magnets_trackers_are_bounded_like_any_sources() {
        let trackers: String = (0..MAX_SOURCES + 3)
            .map(|n| format!("&tr=http://t{n}.example/ann"))
            .collect();
        let (_, _, sources) = torrent_of(&stream_with(&format!(
            r#""url":"magnet:?xt=urn:btih:{HEX}{trackers}""#
        )));

        assert_eq!(sources.len(), MAX_SOURCES);
        assert_eq!(sources[0], "tracker:http://t0.example/ann");
    }

    #[test]
    fn a_magnet_is_the_one_location_so_a_second_location_still_drops_the_candidate() {
        assert!(parsed(&stream_with(&format!(
            r#""url":"magnet:?xt=urn:btih:{HEX}","infoHash":"{HEX}""#
        )))
        .is_empty());
    }

    #[test]
    fn a_recorded_episode_answer_is_read_the_same_way() {
        let streams = parsed(TORRENTIO_EPISODE);

        assert_eq!(streams.len(), 3);
        assert_eq!(
            streams[0].filename.as_deref(),
            Some("Breaking Bad  S01E01  Pilot.mkv")
        );
        assert_eq!(streams[0].name.as_deref(), Some("Torrentio\n4k"));
    }

    #[test]
    fn a_direct_url_is_playable_and_carries_the_addons_own_badges() {
        let streams = parsed(DIRECT);

        assert_eq!(streams.len(), 2);
        assert_eq!(
            url(&streams[0]),
            "https://stream.example.org/v/tt0133093-1080p-abc123.mkv"
        );
        assert_eq!(streams[0].name.as_deref(), Some("AIOStreams\n1080p"));
        assert_eq!(
            streams[0].filename.as_deref(),
            Some("The.Matrix.1999.1080p.BluRay.x265-GROUP.mkv")
        );
        assert_eq!(
            streams[0].binge_group.as_deref(),
            Some("aiostreams|1080p|BluRay|x265")
        );
        assert!(
            streams[0].warnings.is_empty(),
            "a stream whose hints say nothing warns about nothing: {:?}",
            streams[0].warnings
        );
    }

    #[test]
    fn hints_are_surfaced_as_warnings_without_removing_the_candidate() {
        let streams = parsed(DIRECT);

        assert_eq!(
            streams[1].warnings,
            vec![Warning::NotWebReady, Warning::ProxyHeaders],
            "the Addon's hints arrive as warnings, in a fixed order"
        );
        assert_eq!(
            url(&streams[1]),
            "https://proxy.example.net/v/tt0133093-720p",
            "a warned candidate is still a candidate"
        );
    }

    #[test]
    fn a_hint_that_is_not_true_is_not_a_warning() {
        let quiet = parsed(
            r#"{"streams":[{"url":"https://example.org/x.mkv","behaviorHints":{"p2p":false,"notWebReady":false,"proxyHeaders":"soon"}}]}"#,
        );

        assert!(
            quiet[0].warnings.is_empty(),
            "hints are read as what they say: {:?}",
            quiet[0].warnings
        );

        let peers = parsed(
            r#"{"streams":[{"url":"https://example.org/x.mkv","behaviorHints":{"p2p":true}}]}"#,
        );
        assert_eq!(peers[0].warnings, vec![Warning::P2p]);
    }

    #[test]
    fn a_candidate_that_locates_its_bytes_twice_is_not_guessed_at() {
        // The protocol says exactly one location; a stream object with two is
        // an Addon contradicting itself, and picking one would be the Host
        // inventing a fact.
        let streams = parsed(BAD_ITEM);

        assert_eq!(
            streams
                .iter()
                .filter_map(|stream| stream.name.as_deref())
                .collect::<Vec<_>>(),
            vec!["usable", "usable too"],
            "the candidates that locate one way survive the ones that do not"
        );
        assert_eq!(url(&streams[0]), "https://example.org/one.mkv");
        assert_eq!(
            info_hash(&streams[1]),
            "abcdef0123456789abcdef0123456789abcdef01"
        );
    }

    #[test]
    fn a_candidate_whose_location_is_a_shape_this_host_does_not_have_is_not_a_candidate() {
        // A YouTube id, an external web page, an archive: each is exactly one
        // location, and not one this Host could ever open.
        for body in [
            r#"{"streams":[{"ytId":"dQw4w9WgXcQ","name":"a YouTube video"}]}"#,
            r#"{"streams":[{"externalUrl":"https://www.netflix.com/title/123","name":"Watch on Netflix"}]}"#,
            r#"{"streams":[{"nzbUrl":"https://example.org/a.nzb"}]}"#,
            r#"{"streams":[{"url":"https://example.org/a.mkv","externalUrl":"https://example.org/page"}]}"#,
            r#"{"streams":[{"ytId":"dQw4w9WgXcQ","infoHash":"abcdef0123456789abcdef0123456789abcdef01"}]}"#,
        ] {
            assert!(
                parsed(body).is_empty(),
                "{body} is not a candidate this Host can play"
            );
        }
    }

    #[test]
    fn a_recorded_answer_of_places_to_watch_is_not_a_list_of_candidates() {
        // WatchHub answers where a film can be *watched* — Netflix, Amazon,
        // Google Play — as `externalUrl` objects. This Host cannot play a web
        // page, so none of them is a candidate here, and none is invented.
        assert!(
            parsed(WATCHHUB).is_empty(),
            "a link out is not a candidate: {:?}",
            parsed(WATCHHUB)
        );
    }

    #[test]
    fn a_location_field_that_says_nothing_is_not_a_second_location() {
        // Addons in the wild write the fields they have nothing for: an empty
        // list, an empty string. That is absence serialized, not a second
        // answer, and counting it as one would drop a candidate this Host could
        // have played.
        for body in [
            r#"{"streams":[{"url":"https://example.org/a.mkv","rarUrls":[]}]}"#,
            r#"{"streams":[{"url":"https://example.org/a.mkv","ytId":""}]}"#,
            r#"{"streams":[{"infoHash":"abcdef0123456789abcdef0123456789abcdef01","externalUrl":""}]}"#,
        ] {
            assert_eq!(parsed(body).len(), 1, "{body} locates its bytes once");
        }

        assert_eq!(
            url(&parsed(r#"{"streams":[{"url":"https://example.org/a.mkv","rarUrls":[]}]}"#)[0]),
            "https://example.org/a.mkv",
        );
        assert!(
            parsed(r#"{"streams":[{"rarUrls":[]}]}"#).is_empty(),
            "an empty list with nothing else is no location at all"
        );
    }

    #[test]
    fn a_location_that_is_not_a_string_is_not_a_candidate() {
        for body in [
            r#"{"streams":[{"url":""}]}"#,
            r#"{"streams":[{"url":5}]}"#,
            r#"{"streams":[{"url":null}]}"#,
            r#"{"streams":[{"infoHash":""}]}"#,
        ] {
            assert!(parsed(body).is_empty(), "{body} locates nothing");
        }

        // A `null` is the Addon not sending a field — the shape serde's own
        // `Option` would read — so a usable location beside it still locates.
        let streams = parsed(&stream_with(&format!(r#""url":null,"infoHash":"{HEX}""#)));
        assert_eq!(streams.len(), 1);
        assert_eq!(info_hash(&streams[0]), HEX);
    }

    #[test]
    fn a_candidate_that_is_not_an_object_is_dropped_rather_than_blanking_the_answer() {
        let streams = parsed(
            r#"{"streams":["not a candidate at all",5,null,{"url":"https://example.org/x.mkv"}]}"#,
        );

        assert_eq!(streams.len(), 1);
        assert_eq!(url(&streams[0]), "https://example.org/x.mkv");
    }

    #[test]
    fn a_body_that_is_not_a_stream_response_is_refused() {
        for body in [
            "",
            "not json at all",
            "<html>hello</html>",
            "[]",
            "\"streams\"",
            "5",
            "null",
        ] {
            assert!(
                matches!(refused(body), StreamError::NotJson { .. }),
                "{body:?} is not a stream response"
            );
        }
    }

    #[test]
    fn a_response_without_streams_is_refused_rather_than_read_as_no_candidates() {
        assert_eq!(
            refused(r#"{"cacheMaxAge":600}"#),
            StreamError::Missing {
                field: "streams".to_owned()
            },
            "an answer with no candidates at all is not a list this Host invents"
        );
    }

    #[test]
    fn a_response_whose_streams_are_not_a_list_is_refused() {
        assert_eq!(
            refused(HOSTILE),
            StreamError::WrongType {
                field: "streams".to_owned(),
                expected: "an array",
            },
            "a fact about the Addon rather than about one candidate"
        );
        assert_eq!(
            refused(r#"{"streams":null}"#),
            StreamError::WrongType {
                field: "streams".to_owned(),
                expected: "an array",
            }
        );
    }

    #[test]
    fn a_page_longer_than_the_host_holds_is_refused() {
        let body = serde_json::json!({
            "streams": vec![
                serde_json::json!({ "url": "https://example.org/x.mkv" });
                MAX_ITEMS + 1
            ],
        })
        .to_string();

        assert_eq!(
            refused(&body),
            StreamError::TooLarge {
                field: "streams".to_owned(),
                limit: MAX_ITEMS,
            }
        );
    }

    #[test]
    fn a_body_longer_than_the_host_holds_is_refused_before_it_is_parsed() {
        let body = format!("{} {{", " ".repeat(MAX_STREAM_BYTES));

        assert_eq!(
            refused(&body),
            StreamError::TooLarge {
                field: "the stream response".to_owned(),
                limit: MAX_STREAM_BYTES,
            }
        );
    }

    #[test]
    fn fields_this_host_has_no_use_for_are_ignored_rather_than_refused() {
        // The recorded answers carry `title`, `behaviorHints` and WatchHub's
        // per-platform URLs beside the fields the Host reads; a candidate that
        // knows more than the Host does still lists.
        let streams = parsed(TORRENTIO);

        assert_eq!(streams.len(), 5);
        assert!(streams.iter().all(|stream| stream.name.is_some()));
    }

    #[test]
    fn the_wire_shape_is_the_declared_one() {
        let streams = parsed(DIRECT);
        let published = serde_json::to_value(&streams[0]).expect("a Stream serializes");

        assert_eq!(
            published,
            serde_json::json!({
                "name": "AIOStreams\n1080p",
                "description": "The Matrix 1999 1080p BluRay x265-GROUP\n👤 112 💾 4.21 GB ⚙️ TorBox",
                "playback": {
                    "kind": "direct",
                    "url": "https://stream.example.org/v/tt0133093-1080p-abc123.mkv",
                },
                "warnings": [],
                "filename": "The.Matrix.1999.1080p.BluRay.x265-GROUP.mkv",
                "bingeGroup": "aiostreams|1080p|BluRay|x265",
            }),
            "the window reads this by hand, so the shape it declares is the shape that arrives"
        );

        let torrent = serde_json::to_value(&parsed(TORRENTIO)[0]).expect("a Stream serializes");
        assert_eq!(
            torrent["playback"],
            serde_json::json!({
                "kind": "torrent",
                "infoHash": "61065ea115b7cc3e8db9fb5ab1f6f327f08bd1c9",
                "fileIdx": 0,
                "sources": [
                    "tracker:http://bt4.t-ru.org/ann?magnet",
                    "dht:61065ea115b7cc3e8db9fb5ab1f6f327f08bd1c9",
                ],
            })
        );

        let bare = serde_json::to_value(&parsed(TORRENTIO)[1]).expect("a Stream serializes");
        assert_eq!(
            bare["playback"],
            serde_json::json!({
                "kind": "torrent",
                "infoHash": "8dc393c100ef0c0d010cfefdcebe572e26c4f775",
                "fileIdx": null,
                "sources": [],
            }),
            "an absent fileIdx is null, and absent sources are an empty list"
        );
    }

    #[test]
    fn a_torrent_a_client_sends_back_is_read_whole_and_a_bad_hash_is_refused() {
        let wire = serde_json::json!({
            "kind": "torrent",
            "infoHash": HEX.to_ascii_uppercase(),
            "fileIdx": 3,
            "sources": ["tracker:http://a.example/ann"],
        });
        let playback: Playback = serde_json::from_value(wire).expect("the shape round-trips");
        assert_eq!(
            playback,
            Playback::Torrent {
                info_hash: InfoHash::parse(HEX).unwrap(),
                file_idx: Some(3),
                sources: vec!["tracker:http://a.example/ann".to_owned()],
            }
        );

        let minimal: Playback =
            serde_json::from_value(serde_json::json!({"kind": "torrent", "infoHash": HEX}))
                .expect("fileIdx and sources may be missing");
        assert!(matches!(
            minimal,
            Playback::Torrent { file_idx: None, sources, .. } if sources.is_empty()
        ));

        assert!(serde_json::from_value::<Playback>(
            serde_json::json!({"kind": "torrent", "infoHash": "deadbeef"})
        )
        .is_err());
        assert!(serde_json::from_value::<Playback>(
            serde_json::json!({"kind": "info_hash", "infoHash": HEX})
        )
        .is_err());
    }
}
