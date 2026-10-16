//! A `stream` response, in the Host's own words: **the candidates one Addon
//! offers for one Video**.
//!
//! A Stream here is the Host's own thing, not the protocol's object. The
//! protocol's `stream` object carries raw fields and implies that everything it
//! lists can be played; the Host's Stream says where the bytes are *and whether
//! this Host can play them* — a direct URL mpv opens as itself, or an
//! `infoHash` that this version lists and marks unplayable because the torrent
//! bridge is a later ticket (#12). That is what the Provider seam exists for:
//! a candidate that is not playable yet has a shape of its own, so the bridge
//! can change what plays without the list, the answer or any client changing
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
//! The rest of a stream object — `fileIdx`, `sources` (a torrent's trackers),
//! `subtitles`, `videoSize`, `videoHash`, and Addon-specific fields like
//! WatchHub's per-platform URLs — is not read: nothing here acts on it, and
//! reading a field nothing acts on is a promise this Host would not be keeping
//! (ADR-0009). #12's bridge is where a torrent's file index and trackers
//! arrive, and the subtitles ticket where a stream's own `subtitles` do.

use serde::Serialize;
use serde_json::{Map, Value};

use crate::action::ActionError;
use crate::addon::{AddonId, MAX_ITEMS, MAX_STRING_LEN};

/// The most of a stream body the Host will read.
///
/// An answer of a hundred candidates is tens of kilobytes, trackers and all; an
/// Addon answering with megabytes is misbehaving or lying.
pub const MAX_STREAM_BYTES: usize = 4 * 1024 * 1024;

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
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stream {
    /// The Addon's own word for the candidate, verbatim: its badges —
    /// resolution, quality, source, cached — as its formatter wrote them.
    pub name: Option<String>,
    /// The Addon's longer description: the release, the size, the seeders.
    /// Read from `description`, falling back to the deprecated `title` that
    /// Addons in the wild still answer with.
    pub description: Option<String>,
    /// Where the bytes are, and whether this Host can open them.
    pub playback: Playback,
    /// What the Addon's hints say about playing it, in the order they were
    /// read. Surfaced, never acted on: a warning is not a filter.
    pub warnings: Vec<Warning>,
    /// The file's own name, where the Addon knows it
    /// (`behaviorHints.filename`).
    pub filename: Option<String>,
    /// The release the Addon binge-groups a series' episodes by
    /// (`behaviorHints.bingeGroup`), so two releases can be told apart and a
    /// later ticket can binge on one.
    pub binge_group: Option<String>,
}

/// Where a Stream's bytes are, and whether this Host can play it now.
///
/// The two shapes, and the only two: a direct URL mpv opens as itself, and an
/// `infoHash` that something must turn into bytes first — something this
/// version does not have.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum Playback {
    /// A direct URL: mpv opens it as itself.
    Direct { url: String },
    /// A torrent infoHash: listed and marked unplayable in this version. The
    /// bridge that would fetch it is #12, and it will play from this same
    /// shape — which is why the shape is here rather than after it.
    InfoHash { info_hash: String },
}

/// What the Addon's hints say about playing a Stream.
///
/// Every one of these is shown beside the candidate and removes none of them:
/// they are the Addon's expectations about clients, and the clients here are
/// mpv and a browser on another device, which do not agree about what they can
/// play.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
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
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
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
        "url" => Playback::Direct {
            url: string(object.get("url")?)?,
        },
        "infoHash" => Playback::InfoHash {
            info_hash: string(object.get("infoHash")?)?,
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
    if text.is_empty() || text.len() > MAX_STRING_LEN {
        return None;
    }
    Some(text.to_owned())
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

    /// The infoHash a candidate says its bytes are at, or a complaint.
    fn info_hash(stream: &Stream) -> &str {
        match &stream.playback {
            Playback::InfoHash { info_hash } => info_hash,
            other => panic!("expected an infoHash candidate: {other:?}"),
        }
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
    fn an_infohash_candidate_is_listed_and_says_it_is_not_playable_here_yet() {
        // The torrent bridge is #12: until it exists, a candidate whose bytes
        // are a torrent is a candidate this Host cannot open — and the list
        // says so by the shape it carries, not by dropping it.
        let streams = parsed(TORRENTIO);

        assert_eq!(streams.len(), 5, "every recorded candidate is listed");
        for stream in &streams {
            assert!(
                matches!(stream.playback, Playback::InfoHash { .. }),
                "a torrent is not a URL this Host can open: {stream:?}"
            );
        }
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
            r#"{"streams":[{"ytId":"dQw4w9WgXcQ","infoHash":"deadbeef"}]}"#,
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
            r#"{"streams":[{"infoHash":"deadbeef","externalUrl":""}]}"#,
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
        let streams = parsed(r#"{"streams":[{"url":null,"infoHash":"deadbeef"}]}"#);
        assert_eq!(streams.len(), 1);
        assert_eq!(info_hash(&streams[0]), "deadbeef");
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
        // The recorded answers carry `fileIdx`, `sources`, and WatchHub's
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

        let info_hash_stream =
            serde_json::to_value(&parsed(TORRENTIO)[0]).expect("a Stream serializes");
        assert_eq!(
            info_hash_stream["playback"],
            serde_json::json!({
                "kind": "info_hash",
                "infoHash": "61065ea115b7cc3e8db9fb5ab1f6f327f08bd1c9",
            })
        );
    }
}
