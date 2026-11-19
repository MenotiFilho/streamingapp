//! The read-only conformance run against real Addons (#33, ADR-0019).
//!
//! The Host's addon path — its one [`Fetcher`] and the parsers that read what an
//! Addon answers with — turned into a report a person reads. It is a diagnostic,
//! not a test suite: it *reports* what a real Addon did, and it never asserts on
//! someone else's content. A missing field, an empty page, an Addon that is down
//! and an Addon that answers with something else are each an outcome in the
//! report, not a failure of the run.
//!
//! ## What it does, and what it never does
//!
//! Pointed at a manifest URL it asks the Addon for its manifest, then for the
//! resources that manifest declares: a catalog, a search, a Title, that Video's
//! Streams and its subtitles. Every ask goes through the same
//! [`ResourceRequest`] URL rule and the same [`Manifest::answers`] judgement the
//! Host builds by, and every answer is read by the same parser the Host reads it
//! with ([`Manifest::parse`], [`Page::parse`], [`Title::parse`],
//! [`Stream::parse`], [`Subtitle::parse`]), so what it reports is what the Host
//! would actually see.
//!
//! It asks **once per resource**: the first catalog the Addon declares that can
//! be asked for on its own, the first catalog that offers a search, and one
//! Title. A manifest that declares a dozen catalogs is a dozen rows a client
//! pages through, not a dozen questions a conformance run needs to ask.
//!
//! Every ask is a `GET`. When an Addon returns a torrent Stream for the run's
//! Video, the first torrent Stream is handed to the [`TorrentEngine`] to wait
//! for metadata only (bounded at [`METADATA_BOUND`], 60 s), reporting time to
//! metadata, peer count and the chosen file before calling `let_go` without
//! requesting any video bytes. It writes nothing to the Addon, nothing to
//! Stremio and nothing to the Host's own store, and it holds no credential.
//!
//! The URL asked is part of each [`ResourceReport`], and the run prints the
//! manifest URL it was given — for the same reason a failure to be diagnosed
//! names where it went. An Addon like AIOStreams carries its configuration inside
//! its manifest URL, which ADR-0009 keeps out of a Snapshot; this is a diagnostic
//! on the owner's own machine rather than something published to a client, and a
//! report is treated as the manifest URL it came from (ADR-0019).
//!
//! ## One failure is one line
//!
//! A resource that cannot be read does not stop the run: one Addon being down is
//! one line that says so, and the rest still answer. The manifest is the one
//! exception, because which resources to ask is the manifest's own answer — an
//! Addon whose manifest cannot be read is an Addon with nothing to ask.

use std::time::Duration;

use host_core::{
    ChosenStream, Clock, Fetcher, InfoHash, Manifest, Page, Playback, ResourceRequest,
    ServeRequest, Stream, Subtitle, SystemClock, Title, TitleRef, TorrentEngine, TorrentPhase,
    TorrentReport, VideoRef, CATALOG, META, SEARCH, STREAM, SUBTITLES,
};

/// The manifest's name in a report. Not a protocol resource (`Manifest::parse`
/// reads it directly), but it is one ask like the others and is reported as one.
const MANIFEST: &str = "manifest";

/// The torrent metadata probe's name in a report.
const TORRENT: &str = "torrent";

/// The bound on waiting for a torrent's metadata: 60 s, matching the Host's
/// give-up while opening a torrent (ADR-0042 §5).
pub const METADATA_BOUND: Duration = Duration::from_secs(60);

/// How often the metadata probe polls the engine's reports.
const POLL_EVERY: Duration = Duration::from_millis(50);

/// How long after `Chosen` arrives to wait for a post-metadata `Status` report
/// (which carries the connected peer count) when none has arrived yet.
const STATUS_SETTLE: Duration = Duration::from_millis(1_500);

/// What one ask of one Addon came to.
///
/// The four outcomes the run reports, and no fifth. Third-party content decides
/// which one it is; the run itself never fails on it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Outcome {
    /// The Addon answered and the Host read it.
    Ok,
    /// The Addon answered and the Host read it, and there was nothing in it this
    /// Host can use.
    Empty,
    /// The Addon answered with something that is not this resource.
    Malformed { detail: String },
    /// There was no answer at all.
    Unreachable { detail: String },
}

/// One resource asked of one Addon, and what came of it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResourceReport {
    /// The resource's name: `manifest`, `catalog`, `search`, `meta`, `stream`,
    /// `subtitles`.
    pub resource: &'static str,
    /// What was asked about, in the Host's words: `movie/top`, `matrix`, a
    /// Title and Video named `type/id`. Empty for the manifest.
    pub subject: String,
    /// The URL the Host asked at.
    pub url: String,
    /// How many things the answer carried, when the resource is a list and it
    /// read: the items of a page, the Streams of a Video. `None` for the
    /// manifest, which is one thing rather than a list, and for an answer that
    /// did not read.
    pub found: Option<usize>,
    pub outcome: Outcome,
}

/// An Addon's own description of itself, as the run read it — enough to say
/// which Addon was reached and what it offers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ManifestSummary {
    pub id: String,
    pub name: String,
    pub version: String,
    /// The resource names the manifest declares, in its own order.
    pub resources: Vec<String>,
    pub types: Vec<String>,
    pub catalogs: usize,
}

/// One torrent Stream's metadata probe, for the first torrent Stream an Addon
/// returned for the run's Video.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TorrentCheck {
    /// The Video whose first torrent Stream was probed (`movie/tt0133093`, …).
    pub video: String,
    /// The torrent's infoHash (40 lowercase hex characters).
    pub info_hash: InfoHash,
    /// What waiting for its metadata came to.
    pub outcome: TorrentOutcome,
}

/// What waiting for a torrent's metadata came to.
///
/// Third-party swarm availability decides which one it is; the run itself
/// never fails on it (ADR-0019).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TorrentOutcome {
    /// Metadata arrived and a file was chosen, without fetching video bytes.
    Metadata {
        /// How long from `serve` until metadata arrived.
        elapsed: Duration,
        /// Connected peers reported by the engine.
        peers: u32,
        /// Index of the chosen file inside the torrent.
        file_idx: u32,
        /// Base name of the chosen file.
        file_name: String,
    },
    /// The wait reached its bound without metadata arriving.
    TimedOut {
        /// How long the probe waited.
        elapsed: Duration,
        /// Latest peer count reported before the bound expired.
        peers: u32,
    },
    /// The engine could not serve the torrent, chose no file, failed, or exited.
    Failed {
        /// The engine's own sentence or reason.
        detail: String,
        /// Latest peer count reported before the failure.
        peers: u32,
    },
}

/// One Addon's whole run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AddonReport {
    /// The manifest URL the run was pointed at, as it was given.
    pub manifest_url: String,
    /// What the manifest said, or `None` when there was no manifest to read — in
    /// which case no resource was asked, and `asks` holds only the manifest.
    pub summary: Option<ManifestSummary>,
    /// Every ask the run made, in order, the manifest first.
    pub asks: Vec<ResourceReport>,
    /// The metadata check of the first torrent Stream the Addon returned for
    /// the run's Video, if any.
    pub torrent: Option<TorrentCheck>,
}

/// What the run is told to ask for, beside the manifest URL.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Options {
    /// What to search for, when a catalog offers a search.
    pub query: String,
    /// The Title to open, and the Video whose Streams and subtitles are asked
    /// for. For a series whose Addon answers `meta`, the first Video the Addon
    /// lists is used; the Title itself is the Video for a film.
    pub title: TitleRef,
    /// How long to wait for a torrent's metadata before letting go (default:
    /// [`METADATA_BOUND`], 60 s).
    pub torrent_timeout: Duration,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            query: "matrix".to_owned(),
            // The Matrix: a film every metadata Addon answers for, so a run
            // needs no setup beyond a manifest URL.
            title: TitleRef {
                r#type: "movie".to_owned(),
                id: "tt0133093".to_owned(),
            },
            torrent_timeout: METADATA_BOUND,
        }
    }
}

/// Run the conformance check against one Addon, read-only.
///
/// Pure in the Host's sense: the only things it touches are the [`Fetcher`]
/// and [`TorrentEngine`] it was given, so a test drives it with fixtures and
/// never the network or a real swarm.
pub fn run(
    fetcher: &dyn Fetcher,
    torrents: &dyn TorrentEngine,
    manifest_url: &str,
    options: &Options,
) -> AddonReport {
    run_with(
        fetcher,
        torrents,
        manifest_url,
        options,
        &SystemClock,
        std::thread::sleep,
    )
}

fn run_with(
    fetcher: &dyn Fetcher,
    torrents: &dyn TorrentEngine,
    manifest_url: &str,
    options: &Options,
    clock: &dyn Clock,
    mut pause: impl FnMut(Duration),
) -> AddonReport {
    let mut asks = Vec::new();

    // The manifest is the first ask and the only one that decides the rest:
    // which resources to ask is the manifest's own answer, so an Addon whose
    // manifest cannot be read is an Addon with nothing to ask.
    let manifest = match read_manifest(fetcher, manifest_url) {
        Ok(manifest) => {
            asks.push(ResourceReport {
                resource: MANIFEST,
                subject: String::new(),
                url: manifest_url.to_owned(),
                found: None,
                outcome: Outcome::Ok,
            });
            manifest
        }
        Err(outcome) => {
            asks.push(ResourceReport {
                resource: MANIFEST,
                subject: String::new(),
                url: manifest_url.to_owned(),
                found: None,
                outcome,
            });
            return AddonReport {
                manifest_url: manifest_url.to_owned(),
                summary: None,
                asks,
                torrent: None,
            };
        }
    };

    let summary = ManifestSummary {
        id: manifest.id.as_str().to_owned(),
        name: manifest.name.clone(),
        version: manifest.version.clone(),
        resources: manifest
            .resources
            .iter()
            .map(|resource| resource.name.clone())
            .collect(),
        types: manifest.types.clone(),
        catalogs: manifest.catalogs.len(),
    };

    // A catalog: the first the Addon declares that it can be asked for on its
    // own, with the values it requires filled in — the same rule the Host fills
    // them in by, so the URL is one the Addon really takes.
    if let Some((catalog, extra)) = manifest
        .catalogs
        .iter()
        .find_map(|catalog| catalog.default_extra().map(|extra| (catalog, extra)))
    {
        let requested =
            ResourceRequest::new(CATALOG, &catalog.r#type, &catalog.id).with_extra(extra);
        asks.extend(probe(
            fetcher,
            &manifest,
            manifest_url,
            CATALOG,
            format!("{}/{}", catalog.r#type, catalog.id),
            requested,
            read_page,
        ));
    }

    // A search: the first catalog that offers one, for the query the run was
    // given.
    if let Some((catalog, extra)) = manifest.catalogs.iter().find_map(|catalog| {
        catalog
            .search_extra(&options.query)
            .map(|extra| (catalog, extra))
    }) {
        let requested =
            ResourceRequest::new(CATALOG, &catalog.r#type, &catalog.id).with_extra(extra);
        asks.extend(probe(
            fetcher,
            &manifest,
            manifest_url,
            SEARCH,
            options.query.clone(),
            requested,
            read_page,
        ));
    }

    // The Title the run was told to open, and the Video its Streams and
    // subtitles are asked for. The Title itself is the Video for a film; for a
    // series whose Addon answers `meta`, the first Video the Addon lists is.
    let asked = &options.title;
    let mut video = asked.clone();
    let meta = ResourceRequest::new(META, &asked.r#type, &asked.id);
    asks.extend(probe(
        fetcher,
        &manifest,
        manifest_url,
        META,
        asked.to_string(),
        meta,
        |body| {
            let title = Title::parse(body, manifest.id.clone(), asked)
                .map_err(|error| error.to_string())?;
            if let Some(first) = title.videos.first() {
                video = TitleRef {
                    r#type: asked.r#type.clone(),
                    id: first.id.clone(),
                };
            }
            Ok(1)
        },
    ));

    // Streams, of the Video — the Title for a film, an episode for a series.
    let mut first_torrent: Option<Stream> = None;
    let streams = ResourceRequest::new(STREAM, &video.r#type, &video.id);
    asks.extend(probe(
        fetcher,
        &manifest,
        manifest_url,
        STREAM,
        video.to_string(),
        streams,
        |body| {
            let parsed = Stream::parse(body).map_err(|error| error.to_string())?;
            first_torrent = parsed
                .iter()
                .find(|stream| matches!(stream.playback, Playback::Torrent { .. }))
                .cloned();
            Ok(parsed.len())
        },
    ));

    // Subtitles, of the same Video — the fallback source ADR-0014 names.
    let subtitles = ResourceRequest::new(SUBTITLES, &video.r#type, &video.id);
    asks.extend(probe(
        fetcher,
        &manifest,
        manifest_url,
        SUBTITLES,
        video.to_string(),
        subtitles,
        |body| {
            Subtitle::parse(body)
                .map(|subtitles| subtitles.len())
                .map_err(|error| error.to_string())
        },
    ));

    // First torrent Stream, if the Addon returned one: serve for metadata only,
    // download no video bytes, and always let go.
    let torrent = first_torrent.and_then(|stream| {
        let video_ref = VideoRef {
            r#type: video.r#type.clone(),
            id: video.id.clone(),
        };
        let chosen = ChosenStream::parse(video_ref, manifest.id.clone(), &stream).ok()?;
        let request = chosen.serve_request()?;
        Some(probe_torrent_with(
            torrents,
            &video.to_string(),
            &request,
            options.torrent_timeout,
            clock,
            &mut pause,
        ))
    });

    AddonReport {
        manifest_url: manifest_url.to_owned(),
        summary: Some(summary),
        asks,
        torrent,
    }
}

/// Read one Addon's manifest, or the outcome that says why there is none.
fn read_manifest(fetcher: &dyn Fetcher, manifest_url: &str) -> Result<Manifest, Outcome> {
    match fetcher.fetch(manifest_url) {
        Err(error) => Err(Outcome::Unreachable {
            detail: error.to_string(),
        }),
        Ok(body) => Manifest::parse(&body).map_err(|error| Outcome::Malformed {
            detail: error.to_string(),
        }),
    }
}

/// Ask one resource of one Addon, and read the answer.
///
/// `None` when the Addon's manifest does not answer for the resource — the one
/// rule the Host decides every ask by (ADR-0010), so nothing is asked that the
/// Addon did not declare. `read` turns a body into how many things it carried
/// (the parser the Host reads that resource with) and its error into the detail
/// a person is shown.
fn probe(
    fetcher: &dyn Fetcher,
    manifest: &Manifest,
    manifest_url: &str,
    resource: &'static str,
    subject: String,
    requested: ResourceRequest,
    read: impl FnOnce(&str) -> Result<usize, String>,
) -> Option<ResourceReport> {
    if !manifest.answers(&requested) {
        return None;
    }

    let url = requested.url(manifest_url);
    let (outcome, found) = match fetcher.fetch(&url) {
        Err(error) => (
            Outcome::Unreachable {
                detail: error.to_string(),
            },
            None,
        ),
        Ok(body) => match read(&body) {
            Err(detail) => (Outcome::Malformed { detail }, None),
            Ok(0) => (Outcome::Empty, Some(0)),
            Ok(items) => (Outcome::Ok, Some(items)),
        },
    };

    Some(ResourceReport {
        resource,
        subject,
        url,
        found,
        outcome,
    })
}

/// Read one page of a catalog, or one search's answer.
fn read_page(body: &str) -> Result<usize, String> {
    Page::parse(body)
        .map(|page| page.metas.len())
        .map_err(|error| error.to_string())
}

/// Serve one torrent for metadata only, without ever opening the returned URL
/// (so no video bytes are fetched), waiting up to `bound` and always calling
/// `let_go` once `serve` succeeds.
fn probe_torrent_with(
    engine: &dyn TorrentEngine,
    video: &str,
    request: &ServeRequest,
    bound: Duration,
    clock: &dyn Clock,
    mut pause: impl FnMut(Duration),
) -> TorrentCheck {
    // Discard the loopback URL without reading from it: metadata arrives on
    // `serve`, and video bytes are only fetched on HTTP reads.
    if let Err(error) = engine.serve(request) {
        return TorrentCheck {
            video: video.to_owned(),
            info_hash: request.info_hash.clone(),
            outcome: TorrentOutcome::Failed {
                detail: error.to_string(),
                peers: 0,
            },
        };
    }

    let started_ms = clock.now_millis();
    let bound_ms = i64::try_from(bound.as_millis()).unwrap_or(i64::MAX);
    let deadline_ms = started_ms.saturating_add(bound_ms);

    let mut peers: u32 = 0;
    let mut seen_fetching = false;
    let mut metadata_elapsed: Option<Duration> = None;
    let mut chosen: Option<(u32, String)> = None;
    let mut settle_deadline_ms: Option<i64> = None;

    let outcome = loop {
        let mut failed: Option<String> = None;
        let mut exited = false;

        for report in engine.reports() {
            match report {
                TorrentReport::Status {
                    info_hash,
                    phase,
                    peers: reported_peers,
                    ..
                } if info_hash == request.info_hash => {
                    peers = reported_peers;
                    if phase == TorrentPhase::Fetching {
                        seen_fetching = true;
                        metadata_elapsed
                            .get_or_insert_with(|| elapsed_since(started_ms, clock.now_millis()));
                    }
                }
                TorrentReport::Chosen {
                    info_hash,
                    file_idx,
                    name,
                } if info_hash == request.info_hash => {
                    metadata_elapsed
                        .get_or_insert_with(|| elapsed_since(started_ms, clock.now_millis()));
                    chosen = Some((file_idx, name));
                }
                TorrentReport::Failed {
                    info_hash,
                    sentence,
                    ..
                } if info_hash == request.info_hash => {
                    failed.get_or_insert(sentence);
                }
                TorrentReport::Exited => {
                    exited = true;
                }
                TorrentReport::Status { .. }
                | TorrentReport::Chosen { .. }
                | TorrentReport::Failed { .. } => {}
            }
        }

        if let Some((file_idx, file_name)) = &chosen {
            if seen_fetching || exited {
                break TorrentOutcome::Metadata {
                    elapsed: metadata_elapsed.unwrap_or_default(),
                    peers,
                    file_idx: *file_idx,
                    file_name: file_name.clone(),
                };
            }
            let now = clock.now_millis();
            let settle = *settle_deadline_ms.get_or_insert_with(|| {
                now.saturating_add(STATUS_SETTLE.as_millis() as i64)
                    .min(deadline_ms)
            });
            if now >= settle {
                break TorrentOutcome::Metadata {
                    elapsed: metadata_elapsed.unwrap_or_default(),
                    peers,
                    file_idx: *file_idx,
                    file_name: file_name.clone(),
                };
            }
            let remaining = (settle - now).max(0) as u64;
            pause(POLL_EVERY.min(Duration::from_millis(remaining)));
            continue;
        }

        if let Some(detail) = failed {
            break TorrentOutcome::Failed { detail, peers };
        }
        if exited {
            break TorrentOutcome::Failed {
                detail: "The torrent engine stopped.".to_owned(),
                peers,
            };
        }

        let now = clock.now_millis();
        if now >= deadline_ms {
            break TorrentOutcome::TimedOut {
                elapsed: elapsed_since(started_ms, now),
                peers,
            };
        }

        let remaining = (deadline_ms - now).max(0) as u64;
        pause(POLL_EVERY.min(Duration::from_millis(remaining)));
    };

    engine.let_go(&request.info_hash);

    TorrentCheck {
        video: video.to_owned(),
        info_hash: request.info_hash.clone(),
        outcome,
    }
}

fn elapsed_since(started_ms: i64, now_ms: i64) -> Duration {
    Duration::from_millis(now_ms.saturating_sub(started_ms).max(0) as u64)
}

/// Render reports as the lines a person reads.
///
/// Pure: the whole of the output is a function of the reports, so what a run
/// prints can be tested without running one.
pub fn render(reports: &[AddonReport]) -> String {
    let mut out = String::new();

    for report in reports {
        match &report.summary {
            Some(summary) => {
                out.push_str(&format!(
                    "{}  ({} v{})\n",
                    summary.name, summary.id, summary.version
                ));
                out.push_str(&format!("  {}\n", report.manifest_url));
                out.push_str(&format!("  declares: {}\n", join(&summary.resources)));
                out.push_str(&format!("  types: {}\n", join(&summary.types)));
                out.push_str(&format!("  catalogs: {}\n", summary.catalogs));
            }
            None => {
                out.push_str(&format!("{}\n", report.manifest_url));
            }
        }
        out.push('\n');

        for ask in &report.asks {
            out.push_str(&format!(
                "  {:<10} {:<22} {}\n",
                ask.resource,
                ask.subject,
                line(ask)
            ));
        }
        if let Some(torrent) = &report.torrent {
            out.push_str(&format!(
                "  {:<10} {:<22} {}\n",
                TORRENT,
                torrent.video,
                torrent_line(&torrent.outcome)
            ));
        }
        out.push('\n');
    }

    let (mut ok, mut empty, mut malformed, mut unreachable) = (0, 0, 0, 0);
    let mut asks = 0;
    for report in reports {
        asks += report.asks.len();
        for ask in &report.asks {
            match ask.outcome {
                Outcome::Ok => ok += 1,
                Outcome::Empty => empty += 1,
                Outcome::Malformed { .. } => malformed += 1,
                Outcome::Unreachable { .. } => unreachable += 1,
            }
        }
    }

    out.push_str(&format!(
        "{} Addon{}, {} ask{}: {ok} ok, {empty} empty, {malformed} malformed, {unreachable} unreachable\n",
        reports.len(),
        plural(reports.len()),
        asks,
        plural(asks),
    ));

    out
}

/// One ask's outcome, as the words a person reads it in.
fn line(ask: &ResourceReport) -> String {
    match &ask.outcome {
        Outcome::Ok => match ask.found {
            Some(items) => format!("ok ({items} item{})", plural(items)),
            None => "ok".to_owned(),
        },
        Outcome::Empty => "empty".to_owned(),
        Outcome::Malformed { detail } => format!("malformed: {detail}"),
        Outcome::Unreachable { detail } => format!("unreachable: {detail}"),
    }
}

/// One torrent metadata probe's outcome, as the words a person reads it in.
fn torrent_line(outcome: &TorrentOutcome) -> String {
    match outcome {
        TorrentOutcome::Metadata {
            elapsed,
            peers,
            file_idx,
            file_name,
        } => format!(
            "metadata in {}, {} peer{}, file #{file_idx} {file_name}",
            format_duration(*elapsed),
            peers,
            plural(*peers as usize),
        ),
        TorrentOutcome::TimedOut { elapsed, peers } => format!(
            "timed out after {} ({} peer{})",
            format_duration(*elapsed),
            peers,
            plural(*peers as usize),
        ),
        TorrentOutcome::Failed { detail, peers } => {
            if *peers > 0 {
                format!("failed: {detail} ({peers} peer{})", plural(*peers as usize),)
            } else {
                format!("failed: {detail}")
            }
        }
    }
}

fn format_duration(duration: Duration) -> String {
    let millis = duration.as_millis();
    if millis < 1_000 {
        format!("{millis}ms")
    } else {
        format!("{}.{}s", millis / 1_000, (millis % 1_000) / 100)
    }
}

fn join(values: &[String]) -> String {
    if values.is_empty() {
        "none".to_owned()
    } else {
        values.join(", ")
    }
}

fn plural(count: usize) -> &'static str {
    if count == 1 {
        ""
    } else {
        "s"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use host_core::{
        FailureKind, FetchError, FixtureClock, FixtureFetcher, FixtureTorrentEngine,
        NoTorrentEngine,
    };

    const MANIFEST_URL: &str = "https://example.org/manifest.json";

    fn options() -> Options {
        Options::default()
    }

    /// A manifest offering every resource the run can ask for.
    fn manifest() -> String {
        serde_json::json!({
            "id": "org.example.addon",
            "name": "Example",
            "version": "1.2.3",
            "resources": ["catalog", "meta", "stream", "subtitles"],
            "types": ["movie", "series"],
            "catalogs": [
                { "type": "movie", "id": "top", "name": "Top",
                  "extra": [{ "name": "search" }, { "name": "skip" }] }
            ],
        })
        .to_string()
    }

    fn catalog() -> &'static str {
        r#"{"metas":[{"id":"tt0133093","type":"movie","name":"The Matrix"}]}"#
    }

    fn search() -> &'static str {
        r#"{"metas":[{"id":"tt0133093","type":"movie","name":"The Matrix"}]}"#
    }

    fn meta() -> &'static str {
        r#"{"meta":{"name":"The Matrix","poster":"https://example.org/p.jpg"}}"#
    }

    fn streams() -> &'static str {
        r#"{"streams":[{"name":"1080p","url":"https://example.org/x.mkv"}]}"#
    }

    fn subtitles() -> &'static str {
        r#"{"subtitles":[{"id":"one","url":"https://subs.example.org/x.srt","lang":"por"}]}"#
    }

    /// A fetcher serving a whole well-behaved Addon.
    fn well_behaved() -> FixtureFetcher {
        FixtureFetcher::new()
            .serving(MANIFEST_URL, manifest())
            .serving("https://example.org/catalog/movie/top.json", catalog())
            .serving(
                "https://example.org/catalog/movie/top/search=matrix.json",
                search(),
            )
            .serving("https://example.org/meta/movie/tt0133093.json", meta())
            .serving("https://example.org/stream/movie/tt0133093.json", streams())
            .serving(
                "https://example.org/subtitles/movie/tt0133093.json",
                subtitles(),
            )
    }

    fn ask<'a>(report: &'a AddonReport, resource: &str) -> &'a ResourceReport {
        report
            .asks
            .iter()
            .find(|ask| ask.resource == resource)
            .unwrap_or_else(|| panic!("the run asked {resource}: {:?}", report.asks))
    }

    #[test]
    fn a_well_behaved_addon_is_asked_every_resource_and_reads() {
        let fetcher = well_behaved();
        let report = run(&fetcher, &NoTorrentEngine, MANIFEST_URL, &options());

        let summary = report.summary.as_ref().expect("the manifest read");
        assert_eq!(summary.id, "org.example.addon");
        assert_eq!(summary.name, "Example");
        assert_eq!(summary.version, "1.2.3");
        assert_eq!(summary.types, vec!["movie".to_owned(), "series".to_owned()]);
        assert_eq!(
            summary.resources,
            vec![
                "catalog".to_owned(),
                "meta".to_owned(),
                "stream".to_owned(),
                "subtitles".to_owned()
            ]
        );
        assert_eq!(summary.catalogs, 1);

        assert_eq!(ask(&report, MANIFEST).outcome, Outcome::Ok);
        for resource in [CATALOG, SEARCH, META, STREAM, SUBTITLES] {
            assert_eq!(ask(&report, resource).outcome, Outcome::Ok, "{resource}");
            assert_eq!(ask(&report, resource).found, Some(1), "{resource}");
        }

        assert_eq!(
            fetcher.asked(),
            vec![
                MANIFEST_URL.to_owned(),
                "https://example.org/catalog/movie/top.json".to_owned(),
                "https://example.org/catalog/movie/top/search=matrix.json".to_owned(),
                "https://example.org/meta/movie/tt0133093.json".to_owned(),
                "https://example.org/stream/movie/tt0133093.json".to_owned(),
                "https://example.org/subtitles/movie/tt0133093.json".to_owned(),
            ],
            "every ask is the URL the Host builds for the resource it names"
        );
    }

    #[test]
    fn a_manifest_that_is_not_one_is_reported_and_nothing_else_is_asked() {
        let fetcher = FixtureFetcher::new().serving(MANIFEST_URL, "{ not a manifest");
        let report = run(&fetcher, &NoTorrentEngine, MANIFEST_URL, &options());

        assert!(report.summary.is_none());
        assert_eq!(report.asks.len(), 1, "the manifest is the only ask");
        assert!(
            matches!(ask(&report, MANIFEST).outcome, Outcome::Malformed { .. }),
            "a body that is not a manifest is malformed: {:?}",
            ask(&report, MANIFEST).outcome
        );
        assert_eq!(
            fetcher.asked(),
            vec![MANIFEST_URL.to_owned()],
            "which resources to ask is the manifest's answer, and there was none"
        );
    }

    #[test]
    fn an_addon_that_cannot_be_reached_is_reported_and_nothing_else_is_asked() {
        let fetcher = FixtureFetcher::new().failing(
            MANIFEST_URL,
            FetchError::Unreachable {
                detail: "no route to host".to_owned(),
            },
        );
        let report = run(&fetcher, &NoTorrentEngine, MANIFEST_URL, &options());

        assert!(report.summary.is_none());
        assert_eq!(
            ask(&report, MANIFEST).outcome,
            Outcome::Unreachable {
                detail: "the Addon could not be reached: no route to host".to_owned()
            }
        );
        assert_eq!(fetcher.asked(), vec![MANIFEST_URL.to_owned()]);
    }

    #[test]
    fn a_resource_the_addon_does_not_declare_is_never_asked() {
        // A stream-only Addon: nothing to catalog, nothing to open.
        let manifest = serde_json::json!({
            "id": "org.example.streams",
            "name": "Streams",
            "version": "1.0.0",
            "resources": ["stream"],
            "types": ["movie"],
            "catalogs": [],
        })
        .to_string();

        let fetcher = FixtureFetcher::new()
            .serving(MANIFEST_URL, manifest)
            .serving("https://example.org/stream/movie/tt0133093.json", streams());
        let report = run(&fetcher, &NoTorrentEngine, MANIFEST_URL, &options());

        assert_eq!(
            report
                .asks
                .iter()
                .map(|ask| ask.resource)
                .collect::<Vec<_>>(),
            vec![MANIFEST, STREAM],
            "only what the manifest declares is asked"
        );
        assert_eq!(
            fetcher.asked(),
            vec![
                MANIFEST_URL.to_owned(),
                "https://example.org/stream/movie/tt0133093.json".to_owned(),
            ]
        );
    }

    #[test]
    fn one_bad_resource_does_not_stop_the_others() {
        let fetcher = FixtureFetcher::new()
            .serving(MANIFEST_URL, manifest())
            .serving(
                "https://example.org/catalog/movie/top.json",
                "<html>nope</html>",
            )
            .serving(
                "https://example.org/catalog/movie/top/search=matrix.json",
                search(),
            )
            .serving("https://example.org/meta/movie/tt0133093.json", meta())
            .serving("https://example.org/stream/movie/tt0133093.json", streams())
            .serving(
                "https://example.org/subtitles/movie/tt0133093.json",
                subtitles(),
            );
        let report = run(&fetcher, &NoTorrentEngine, MANIFEST_URL, &options());

        assert!(
            matches!(ask(&report, CATALOG).outcome, Outcome::Malformed { .. }),
            "the catalog body is not a catalog"
        );
        assert_eq!(ask(&report, SEARCH).outcome, Outcome::Ok);
        assert_eq!(ask(&report, META).outcome, Outcome::Ok);
        assert_eq!(
            ask(&report, STREAM).outcome,
            Outcome::Ok,
            "one Addon's bad resource is one line, not a run that stops"
        );
    }

    #[test]
    fn an_answer_that_reads_and_carries_nothing_is_empty() {
        let fetcher = FixtureFetcher::new()
            .serving(MANIFEST_URL, manifest())
            .serving(
                "https://example.org/catalog/movie/top.json",
                r#"{"metas":[]}"#,
            )
            .serving(
                "https://example.org/catalog/movie/top/search=matrix.json",
                r#"{"metas":[]}"#,
            )
            .serving("https://example.org/meta/movie/tt0133093.json", meta())
            .serving(
                "https://example.org/stream/movie/tt0133093.json",
                r#"{"streams":[]}"#,
            )
            .serving(
                "https://example.org/subtitles/movie/tt0133093.json",
                r#"{"subtitles":[]}"#,
            );
        let report = run(&fetcher, &NoTorrentEngine, MANIFEST_URL, &options());

        assert_eq!(ask(&report, CATALOG).outcome, Outcome::Empty);
        assert_eq!(ask(&report, SEARCH).outcome, Outcome::Empty);
        assert_eq!(ask(&report, STREAM).outcome, Outcome::Empty);
        assert_eq!(ask(&report, SUBTITLES).outcome, Outcome::Empty);
        assert_eq!(
            ask(&report, CATALOG).found,
            Some(0),
            "an empty answer carried nothing, and the report says so"
        );
    }

    #[test]
    fn an_addon_that_answers_nothing_is_one_unreachable_line_per_resource() {
        // The manifest answers; every resource the Host then asks for is down.
        let fetcher = FixtureFetcher::new()
            .serving(MANIFEST_URL, manifest())
            .failing(
                "https://example.org/catalog/movie/top.json",
                FetchError::Status { status: 503 },
            )
            .failing(
                "https://example.org/catalog/movie/top/search=matrix.json",
                FetchError::Status { status: 503 },
            )
            .failing(
                "https://example.org/meta/movie/tt0133093.json",
                FetchError::Status { status: 500 },
            )
            .failing(
                "https://example.org/stream/movie/tt0133093.json",
                FetchError::Status { status: 500 },
            )
            .failing(
                "https://example.org/subtitles/movie/tt0133093.json",
                FetchError::Status { status: 500 },
            );
        let report = run(&fetcher, &NoTorrentEngine, MANIFEST_URL, &options());

        assert_eq!(ask(&report, MANIFEST).outcome, Outcome::Ok);
        for resource in [CATALOG, SEARCH, META, STREAM, SUBTITLES] {
            assert!(
                matches!(ask(&report, resource).outcome, Outcome::Unreachable { .. }),
                "{resource} was down: {:?}",
                ask(&report, resource).outcome
            );
        }
    }

    #[test]
    fn a_series_streams_and_subtitles_are_asked_of_its_first_video() {
        // The meta answer carries the episodes; the Streams of one episode are
        // asked of the episode's own id, the way the Host asks for them.
        let manifest = serde_json::json!({
            "id": "org.example.addon",
            "name": "Example",
            "version": "1.0.0",
            "resources": ["meta", "stream", "subtitles"],
            "types": ["series"],
            "catalogs": [],
        })
        .to_string();

        let series = TitleRef {
            r#type: "series".to_owned(),
            id: "tt0903747".to_owned(),
        };
        let fetcher = FixtureFetcher::new()
            .serving(MANIFEST_URL, manifest)
            .serving(
                "https://example.org/meta/series/tt0903747.json",
                r#"{"meta":{"name":"Breaking Bad","videos":[
                    {"id":"tt0903747:1:1","name":"Pilot","season":1,"episode":1}
                ]}}"#,
            )
            .serving(
                "https://example.org/stream/series/tt0903747%3A1%3A1.json",
                streams(),
            )
            .serving(
                "https://example.org/subtitles/series/tt0903747%3A1%3A1.json",
                subtitles(),
            );

        let report = run(
            &fetcher,
            &NoTorrentEngine,
            MANIFEST_URL,
            &Options {
                title: series,
                ..options()
            },
        );

        assert_eq!(
            fetcher.asked(),
            vec![
                MANIFEST_URL.to_owned(),
                "https://example.org/meta/series/tt0903747.json".to_owned(),
                "https://example.org/stream/series/tt0903747%3A1%3A1.json".to_owned(),
                "https://example.org/subtitles/series/tt0903747%3A1%3A1.json".to_owned(),
            ],
            "the episodes the Addon listed are the Videos a Stream is asked of"
        );
        assert_eq!(ask(&report, STREAM).outcome, Outcome::Ok);
    }

    #[test]
    fn the_catalog_is_asked_with_the_values_its_addon_requires() {
        // A catalog that requires a genre offers one, and the Host fills it in
        // rather than asking a catalog the Addon will refuse.
        let manifest = serde_json::json!({
            "id": "org.example.addon",
            "name": "Example",
            "version": "1.0.0",
            "resources": ["catalog"],
            "types": ["movie"],
            "catalogs": [
                { "type": "movie", "id": "new", "name": "New",
                  "extra": [{ "name": "genre", "isRequired": true,
                              "options": ["Action", "Comedy"] }] }
            ],
        })
        .to_string();

        let fetcher = FixtureFetcher::new()
            .serving(MANIFEST_URL, manifest)
            .serving(
                "https://example.org/catalog/movie/new/genre=Action.json",
                catalog(),
            );
        let report = run(&fetcher, &NoTorrentEngine, MANIFEST_URL, &options());

        assert_eq!(ask(&report, CATALOG).outcome, Outcome::Ok);
        assert_eq!(
            fetcher.asked(),
            vec![
                MANIFEST_URL.to_owned(),
                "https://example.org/catalog/movie/new/genre=Action.json".to_owned(),
            ]
        );
    }

    #[test]
    fn the_report_names_what_was_asked_and_what_came_of_it() {
        let fetcher = FixtureFetcher::new()
            .serving(MANIFEST_URL, manifest())
            .serving("https://example.org/catalog/movie/top.json", catalog())
            .serving(
                "https://example.org/catalog/movie/top/search=matrix.json",
                r#"{"not":"a catalog"}"#,
            )
            .serving("https://example.org/meta/movie/tt0133093.json", meta())
            .serving(
                "https://example.org/stream/movie/tt0133093.json",
                r#"{"streams":[]}"#,
            )
            .serving(
                "https://example.org/subtitles/movie/tt0133093.json",
                subtitles(),
            );
        let rendered = render(&[run(&fetcher, &NoTorrentEngine, MANIFEST_URL, &options())]);

        assert!(
            rendered.contains("Example  (org.example.addon v1.2.3)"),
            "{rendered}"
        );
        assert!(
            rendered.contains("declares: catalog, meta, stream, subtitles"),
            "{rendered}"
        );
        assert!(rendered.contains("catalog    movie/top"), "{rendered}");
        assert!(rendered.contains("ok (1 item)"), "{rendered}");
        assert!(rendered.contains("empty"), "{rendered}");
        assert!(rendered.contains("malformed"), "{rendered}");
        assert!(
            rendered.contains("1 Addon, 6 asks: 4 ok, 1 empty, 1 malformed, 0 unreachable"),
            "{rendered}"
        );
    }

    const HASH_ONE: &str = "c12fe1c06bba254a9dc9f519b335aa7c1367a88a";
    const HASH_TWO: &str = "08ada5a7a6183aae1e09d831df6748d566095a10";

    #[test]
    fn the_first_torrent_stream_is_served_for_metadata_and_let_go() {
        let streams = serde_json::json!({
            "streams": [
                { "name": "Direct", "url": "https://example.org/direct.mkv" },
                {
                    "name": "First Torrent",
                    "infoHash": HASH_ONE,
                    "fileIdx": 1,
                    "sources": ["tracker:udp://tracker.example.org:1337/announce"],
                    "behaviorHints": { "filename": "The.Matrix.1999.mkv" }
                },
                { "name": "Second Torrent", "infoHash": HASH_TWO }
            ]
        })
        .to_string();

        let fetcher =
            well_behaved().serving("https://example.org/stream/movie/tt0133093.json", streams);
        let engine = FixtureTorrentEngine::new();
        let hash_one = InfoHash::parse(HASH_ONE).unwrap();
        engine.report(TorrentReport::Status {
            info_hash: hash_one.clone(),
            phase: TorrentPhase::Fetching,
            peers: 5,
            rate: 0,
        });
        engine.report(TorrentReport::Chosen {
            info_hash: hash_one.clone(),
            file_idx: 1,
            name: "The.Matrix.1999.mkv".to_owned(),
        });

        let clock = FixtureClock::new().at(10_000);
        let report = run_with(&fetcher, &engine, MANIFEST_URL, &options(), &clock, |d| {
            clock.tick(d.as_millis() as i64);
        });

        let torrent = report.torrent.expect("the first torrent Stream was probed");
        assert_eq!(torrent.video, "movie/tt0133093");
        assert_eq!(torrent.info_hash, hash_one);
        assert_eq!(
            torrent.outcome,
            TorrentOutcome::Metadata {
                elapsed: Duration::ZERO,
                peers: 5,
                file_idx: 1,
                file_name: "The.Matrix.1999.mkv".to_owned(),
            }
        );
        assert_eq!(
            engine.serves().len(),
            1,
            "only the first torrent Stream is served"
        );
        assert_eq!(engine.serves()[0].info_hash, hash_one);
        assert_eq!(engine.serves()[0].file_idx, Some(1));
        assert_eq!(
            engine.serves()[0].sources,
            vec!["tracker:udp://tracker.example.org:1337/announce".to_owned()]
        );
        assert_eq!(
            engine.serves()[0].hints.filename.as_deref(),
            Some("The.Matrix.1999.mkv")
        );
        assert_eq!(engine.let_gos(), vec![hash_one], "the torrent is let go");
    }

    fn torrent_addon(stream_body: String) -> FixtureFetcher {
        well_behaved().serving(
            "https://example.org/stream/movie/tt0133093.json",
            stream_body,
        )
    }

    fn one_torrent_stream(hash: &str) -> String {
        serde_json::json!({
            "streams": [{ "name": "Torrent", "infoHash": hash }]
        })
        .to_string()
    }

    #[test]
    fn an_addon_with_only_direct_streams_never_touches_the_torrent_engine() {
        let fetcher = well_behaved();
        let engine = FixtureTorrentEngine::new();
        let report = run(&fetcher, &engine, MANIFEST_URL, &options());

        assert!(report.torrent.is_none());
        assert!(engine.serves().is_empty());
        assert!(engine.let_gos().is_empty());
    }

    #[test]
    fn a_magnet_stream_is_probed_like_an_info_hash_stream() {
        let streams = serde_json::json!({
            "streams": [{
                "name": "Magnet",
                "url": format!(
                    "magnet:?xt=urn:btih:{HASH_ONE}&tr=udp%3A%2F%2Ftracker.example.org%3A1337%2Fannounce"
                )
            }]
        })
        .to_string();
        let fetcher = torrent_addon(streams);
        let engine = FixtureTorrentEngine::new();
        let hash = InfoHash::parse(HASH_ONE).unwrap();
        engine.report(TorrentReport::Status {
            info_hash: hash.clone(),
            phase: TorrentPhase::Fetching,
            peers: 2,
            rate: 0,
        });
        engine.report(TorrentReport::Chosen {
            info_hash: hash.clone(),
            file_idx: 0,
            name: "film.mkv".to_owned(),
        });

        let clock = FixtureClock::new().at(1_000);
        let report = run_with(&fetcher, &engine, MANIFEST_URL, &options(), &clock, |d| {
            clock.tick(d.as_millis() as i64);
        });

        assert_eq!(engine.serves().len(), 1);
        assert_eq!(engine.serves()[0].info_hash, hash);
        assert_eq!(
            engine.serves()[0].sources,
            vec!["tracker:udp://tracker.example.org:1337/announce".to_owned()]
        );
        assert_eq!(engine.let_gos(), vec![hash]);
        assert!(matches!(
            report.torrent.expect("probed").outcome,
            TorrentOutcome::Metadata {
                peers: 2,
                file_idx: 0,
                ..
            }
        ));
    }

    #[test]
    fn a_series_torrent_carries_the_first_episodes_season_and_episode_hints() {
        let manifest = serde_json::json!({
            "id": "org.example.addon",
            "name": "Example",
            "version": "1.0.0",
            "resources": ["meta", "stream"],
            "types": ["series"],
            "catalogs": [],
        })
        .to_string();
        let series = TitleRef {
            r#type: "series".to_owned(),
            id: "tt0903747".to_owned(),
        };
        let fetcher = FixtureFetcher::new()
            .serving(MANIFEST_URL, manifest)
            .serving(
                "https://example.org/meta/series/tt0903747.json",
                r#"{"meta":{"name":"Breaking Bad","videos":[
                    {"id":"tt0903747:2:5","name":"Breakage","season":2,"episode":5}
                ]}}"#,
            )
            .serving(
                "https://example.org/stream/series/tt0903747%3A2%3A5.json",
                one_torrent_stream(HASH_ONE),
            );
        let engine = FixtureTorrentEngine::new();
        let hash = InfoHash::parse(HASH_ONE).unwrap();
        engine.report(TorrentReport::Status {
            info_hash: hash.clone(),
            phase: TorrentPhase::Fetching,
            peers: 3,
            rate: 0,
        });
        engine.report(TorrentReport::Chosen {
            info_hash: hash.clone(),
            file_idx: 4,
            name: "Show.S02E05.mkv".to_owned(),
        });

        let clock = FixtureClock::new().at(1_000);
        let report = run_with(
            &fetcher,
            &engine,
            MANIFEST_URL,
            &Options {
                title: series,
                ..options()
            },
            &clock,
            |d| {
                clock.tick(d.as_millis() as i64);
            },
        );

        assert_eq!(engine.serves().len(), 1);
        assert_eq!(engine.serves()[0].hints.season, Some(2));
        assert_eq!(engine.serves()[0].hints.episode, Some(5));
        assert_eq!(
            report.torrent.expect("probed").video,
            "series/tt0903747:2:5"
        );
        assert_eq!(engine.let_gos(), vec![hash]);
    }

    #[test]
    fn fast_metadata_waits_for_the_fetching_status_to_capture_peers_while_keeping_metadata_time() {
        let fetcher = torrent_addon(one_torrent_stream(HASH_ONE));
        let engine = FixtureTorrentEngine::new();
        let hash = InfoHash::parse(HASH_ONE).unwrap();
        let clock = FixtureClock::new().at(5_000);

        let mut sent_chosen = false;
        let mut sent_fetching = false;
        let report = run_with(&fetcher, &engine, MANIFEST_URL, &options(), &clock, |d| {
            let now = clock.tick(d.as_millis() as i64);
            let elapsed = now - 5_000;
            if !sent_chosen && elapsed >= 250 {
                sent_chosen = true;
                engine.report(TorrentReport::Chosen {
                    info_hash: hash.clone(),
                    file_idx: 0,
                    name: "film.mkv".to_owned(),
                });
            }
            if !sent_fetching && elapsed >= 1_000 {
                sent_fetching = true;
                engine.report(TorrentReport::Status {
                    info_hash: hash.clone(),
                    phase: TorrentPhase::Fetching,
                    peers: 7,
                    rate: 0,
                });
            }
        });

        assert_eq!(
            report.torrent.expect("probed").outcome,
            TorrentOutcome::Metadata {
                elapsed: Duration::from_millis(250),
                peers: 7,
                file_idx: 0,
                file_name: "film.mkv".to_owned(),
            }
        );
        assert_eq!(engine.let_gos(), vec![hash]);
    }

    #[test]
    fn chosen_without_a_fetching_status_settles_with_the_latest_peer_count() {
        let fetcher = torrent_addon(one_torrent_stream(HASH_ONE));
        let engine = FixtureTorrentEngine::new();
        let hash = InfoHash::parse(HASH_ONE).unwrap();
        engine.report(TorrentReport::Status {
            info_hash: hash.clone(),
            phase: TorrentPhase::Finding,
            peers: 1,
            rate: 0,
        });
        engine.report(TorrentReport::Chosen {
            info_hash: hash.clone(),
            file_idx: 2,
            name: "movie.mp4".to_owned(),
        });

        let clock = FixtureClock::new().at(1_000);
        let report = run_with(&fetcher, &engine, MANIFEST_URL, &options(), &clock, |d| {
            clock.tick(d.as_millis() as i64);
        });

        assert_eq!(
            report.torrent.expect("probed").outcome,
            TorrentOutcome::Metadata {
                elapsed: Duration::ZERO,
                peers: 1,
                file_idx: 2,
                file_name: "movie.mp4".to_owned(),
            }
        );
        // Settled after STATUS_SETTLE rather than waiting the full 60 s bound.
        assert_eq!(clock.now_millis() - 1_000, STATUS_SETTLE.as_millis() as i64);
        assert_eq!(engine.let_gos(), vec![hash]);
    }

    #[test]
    fn a_torrent_without_metadata_within_sixty_seconds_times_out_and_is_let_go() {
        let fetcher = torrent_addon(one_torrent_stream(HASH_ONE));
        let engine = FixtureTorrentEngine::new();
        let hash = InfoHash::parse(HASH_ONE).unwrap();
        engine.report(TorrentReport::Status {
            info_hash: hash.clone(),
            phase: TorrentPhase::Finding,
            peers: 2,
            rate: 0,
        });

        let clock = FixtureClock::new().at(1_000);
        let report = run_with(&fetcher, &engine, MANIFEST_URL, &options(), &clock, |d| {
            clock.tick(d.as_millis() as i64);
        });

        assert_eq!(
            report.torrent.expect("probed").outcome,
            TorrentOutcome::TimedOut {
                elapsed: METADATA_BOUND,
                peers: 2,
            }
        );
        assert_eq!(engine.let_gos(), vec![hash]);
    }

    #[test]
    fn an_engine_failure_during_metadata_is_reported_and_the_torrent_is_let_go() {
        let fetcher = torrent_addon(one_torrent_stream(HASH_ONE));
        let engine = FixtureTorrentEngine::new();
        let hash = InfoHash::parse(HASH_ONE).unwrap();
        engine.report(TorrentReport::Status {
            info_hash: hash.clone(),
            phase: TorrentPhase::Fetching,
            peers: 3,
            rate: 0,
        });
        engine.report(TorrentReport::Failed {
            info_hash: hash.clone(),
            kind: FailureKind::NoFile,
            sentence: "This torrent holds no video.".to_owned(),
        });

        let clock = FixtureClock::new().at(1_000);
        let report = run_with(&fetcher, &engine, MANIFEST_URL, &options(), &clock, |d| {
            clock.tick(d.as_millis() as i64);
        });

        assert_eq!(
            report.torrent.expect("probed").outcome,
            TorrentOutcome::Failed {
                detail: "This torrent holds no video.".to_owned(),
                peers: 3,
            }
        );
        assert_eq!(engine.let_gos(), vec![hash]);
    }

    #[test]
    fn an_engine_exit_during_metadata_is_reported_and_the_torrent_is_let_go() {
        let fetcher = torrent_addon(one_torrent_stream(HASH_ONE));
        let engine = FixtureTorrentEngine::new();
        let hash = InfoHash::parse(HASH_ONE).unwrap();
        engine.report(TorrentReport::Exited);

        let clock = FixtureClock::new().at(1_000);
        let report = run_with(&fetcher, &engine, MANIFEST_URL, &options(), &clock, |d| {
            clock.tick(d.as_millis() as i64);
        });

        assert_eq!(
            report.torrent.expect("probed").outcome,
            TorrentOutcome::Failed {
                detail: "The torrent engine stopped.".to_owned(),
                peers: 0,
            }
        );
        assert_eq!(engine.let_gos(), vec![hash]);
    }

    #[test]
    fn a_refused_serve_is_reported_without_letting_go() {
        let fetcher = torrent_addon(one_torrent_stream(HASH_ONE));
        let engine =
            FixtureTorrentEngine::new().refusing("The torrent engine is not part of this build.");

        let report = run(&fetcher, &engine, MANIFEST_URL, &options());

        assert_eq!(
            report.torrent.expect("probed").outcome,
            TorrentOutcome::Failed {
                detail: "The torrent engine is not part of this build.".to_owned(),
                peers: 0,
            }
        );
        assert!(engine.let_gos().is_empty());
    }

    #[test]
    fn reports_for_another_torrent_are_ignored() {
        let fetcher = torrent_addon(one_torrent_stream(HASH_ONE));
        let engine = FixtureTorrentEngine::new();
        let hash_one = InfoHash::parse(HASH_ONE).unwrap();
        let hash_two = InfoHash::parse(HASH_TWO).unwrap();

        engine.report(TorrentReport::Status {
            info_hash: hash_two.clone(),
            phase: TorrentPhase::Fetching,
            peers: 99,
            rate: 0,
        });
        engine.report(TorrentReport::Chosen {
            info_hash: hash_two,
            file_idx: 9,
            name: "wrong.mkv".to_owned(),
        });
        engine.report(TorrentReport::Status {
            info_hash: hash_one.clone(),
            phase: TorrentPhase::Fetching,
            peers: 4,
            rate: 0,
        });
        engine.report(TorrentReport::Chosen {
            info_hash: hash_one.clone(),
            file_idx: 0,
            name: "right.mkv".to_owned(),
        });

        let clock = FixtureClock::new().at(1_000);
        let report = run_with(&fetcher, &engine, MANIFEST_URL, &options(), &clock, |d| {
            clock.tick(d.as_millis() as i64);
        });

        assert_eq!(
            report.torrent.expect("probed").outcome,
            TorrentOutcome::Metadata {
                elapsed: Duration::ZERO,
                peers: 4,
                file_idx: 0,
                file_name: "right.mkv".to_owned(),
            }
        );
    }

    #[test]
    fn the_report_renders_torrent_metadata_timeout_and_failure_lines() {
        let hash = InfoHash::parse(HASH_ONE).unwrap();
        let base = |outcome| AddonReport {
            manifest_url: MANIFEST_URL.to_owned(),
            summary: None,
            asks: Vec::new(),
            torrent: Some(TorrentCheck {
                video: "movie/tt0133093".to_owned(),
                info_hash: hash.clone(),
                outcome,
            }),
        };

        let metadata_secs = render(&[base(TorrentOutcome::Metadata {
            elapsed: Duration::from_millis(1_250),
            peers: 4,
            file_idx: 0,
            file_name: "The.Matrix.1999.mkv".to_owned(),
        })]);
        assert!(
            metadata_secs
                .contains("  torrent    movie/tt0133093        metadata in 1.2s, 4 peers, file #0 The.Matrix.1999.mkv
"),
            "{metadata_secs}"
        );

        let metadata_ms_one_peer = render(&[base(TorrentOutcome::Metadata {
            elapsed: Duration::from_millis(340),
            peers: 1,
            file_idx: 2,
            file_name: "Show.S01E01.mkv".to_owned(),
        })]);
        assert!(
            metadata_ms_one_peer
                .contains("  torrent    movie/tt0133093        metadata in 340ms, 1 peer, file #2 Show.S01E01.mkv
"),
            "{metadata_ms_one_peer}"
        );

        let timed_out = render(&[base(TorrentOutcome::TimedOut {
            elapsed: Duration::from_secs(60),
            peers: 0,
        })]);
        assert!(
            timed_out.contains(
                "  torrent    movie/tt0133093        timed out after 60.0s (0 peers)
"
            ),
            "{timed_out}"
        );

        let failed_with_peers = render(&[base(TorrentOutcome::Failed {
            detail: "This torrent holds no video.".to_owned(),
            peers: 2,
        })]);
        assert!(
            failed_with_peers.contains(
                "  torrent    movie/tt0133093        failed: This torrent holds no video. (2 peers)
"
            ),
            "{failed_with_peers}"
        );

        let failed_no_peers = render(&[base(TorrentOutcome::Failed {
            detail: "The torrent engine is not part of this build.".to_owned(),
            peers: 0,
        })]);
        assert!(
            failed_no_peers
                .contains("  torrent    movie/tt0133093        failed: The torrent engine is not part of this build.
"),
            "{failed_no_peers}"
        );
    }
}
