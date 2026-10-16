//! The read-only conformance run against real Addons (#33).
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
//! [`ResourceRequest`] URL rule the Host builds by, and every answer is read by
//! the same parser the Host reads it with ([`Manifest::parse`], [`Page::parse`],
//! [`Title::parse`], [`Stream::parse`], [`Subtitle::parse`]), so what it reports
//! is what the Host would actually see.
//!
//! Every ask is a `GET`. It writes nothing to the Addon, nothing to Stremio and
//! nothing to the Host's own store, and it holds no credential: there is no path
//! here to a write because the engine takes only a [`Fetcher`], and a `Fetcher`
//! fetches.
//!
//! The URLs asked are part of each [`ResourceReport`] — for the same reason a
//! failure to be diagnosed names where it went. An Addon like AIOStreams carries
//! its configuration inside its manifest URL, and the resource URL is that URL
//! with a path appended, so treat a report as you would the manifest URL itself.
//!
//! ## One failure is one line
//!
//! A resource that cannot be read does not stop the run: one Addon being down is
//! one line that says so, and the rest still answer. The manifest is the one
//! exception, because which resources to ask is the manifest's own answer — an
//! Addon whose manifest cannot be read is an Addon with nothing to ask.

use host_core::{
    FetchError, Fetcher, Manifest, Page, ResourceRequest, Stream, Subtitle, Title, TitleRef,
    CATALOG, META, STREAM, SUBTITLES,
};

/// What one ask of one Addon came to.
///
/// The four outcomes the run reports, and no fifth. Third-party content decides
/// which one it is; the run itself never fails on it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Outcome {
    /// The Addon answered and it read: how many things the answer carried.
    ///
    /// `0` is used for the manifest, which is one thing rather than a list, so
    /// that a manifest that read always reports `ok`. A list resource with
    /// nothing usable in it is [`Empty`](Self::Empty), never `Ok { items: 0 }`.
    Ok { items: usize },
    /// The Addon answered and it read, and there was nothing in it this Host
    /// can use.
    Empty,
    /// The Addon answered with something that is not this resource.
    Malformed { detail: String },
    /// There was no answer at all.
    Unreachable { detail: String },
}

impl Outcome {
    /// The outcome of a list answer that carried `items` things.
    fn carried(items: usize) -> Self {
        match items {
            0 => Self::Empty,
            count => Self::Ok { items: count },
        }
    }
}

/// One resource asked of one Addon, and what came of it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResourceReport {
    /// The resource's name in the protocol: `manifest`, `catalog`, `search`,
    /// `meta`, `stream`, `subtitles`.
    pub resource: &'static str,
    /// What was asked about, in the Host's words: `movie/top`, `matrix`, a
    /// Title and Video named `type/id`. Empty for the manifest.
    pub subject: String,
    /// The URL the Host asked at.
    pub url: String,
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
}

/// What the run is told to ask for, beside the manifest URL.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Options {
    /// What to search for, when a catalog offers a search.
    pub query: String,
    /// The Title to open, and the Video whose Streams and subtitles to ask for.
    /// For a series whose Addon answers `meta`, the first Video the Addon lists
    /// is used; the Title itself is the Video for a film.
    pub title: TitleRef,
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
        }
    }
}

/// Run the conformance check against one Addon, read-only.
///
/// Pure in the Host's sense: the only thing it touches is the [`Fetcher`] it was
/// given, so a test drives it with recorded fixtures and never the network.
pub fn run(fetcher: &dyn Fetcher, manifest_url: &str, options: &Options) -> AddonReport {
    let mut asks = Vec::new();

    // The manifest is the first ask and the only one that decides the rest:
    // which resources to ask is the manifest's own answer, so an Addon whose
    // manifest cannot be read is an Addon with nothing to ask.
    let manifest = match read_manifest(fetcher, manifest_url) {
        Ok(manifest) => {
            asks.push(ResourceReport {
                resource: "manifest",
                subject: String::new(),
                url: manifest_url.to_owned(),
                outcome: Outcome::Ok { items: 0 },
            });
            manifest
        }
        Err(outcome) => {
            asks.push(ResourceReport {
                resource: "manifest",
                subject: String::new(),
                url: manifest_url.to_owned(),
                outcome,
            });
            return AddonReport {
                manifest_url: manifest_url.to_owned(),
                summary: None,
                asks,
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

    // A catalog, with the values its Addon requires filled in — the same rule the
    // Host fills them in by, so the URL is one the Addon really takes.
    if let Some((catalog, extra)) = manifest
        .catalogs
        .iter()
        .find_map(|catalog| catalog.default_extra().map(|extra| (catalog, extra)))
    {
        let requested =
            ResourceRequest::new(CATALOG, &catalog.r#type, &catalog.id).with_extra(extra);
        asks.push(ask(
            fetcher,
            manifest_url,
            "catalog",
            format!("{}/{}", catalog.r#type, catalog.id),
            &requested,
            |body| {
                Page::parse(body)
                    .map(|page| page.metas.len())
                    .map_err(|error| error.to_string())
            },
        ));
    }

    // A search, asked of the first catalog that offers one, for the query the
    // run was given.
    if let Some((catalog, extra)) = manifest.catalogs.iter().find_map(|catalog| {
        catalog
            .search_extra(&options.query)
            .map(|extra| (catalog, extra))
    }) {
        let requested =
            ResourceRequest::new(CATALOG, &catalog.r#type, &catalog.id).with_extra(extra);
        asks.push(ask(
            fetcher,
            manifest_url,
            "search",
            options.query.clone(),
            &requested,
            |body| {
                Page::parse(body)
                    .map(|page| page.metas.len())
                    .map_err(|error| error.to_string())
            },
        ));
    }

    // The Title the run was told to open, and the Video its Streams and
    // subtitles are asked for. The Title itself is the Video for a film; for a
    // series whose Addon answers `meta`, the first Video the Addon lists is.
    let asked = &options.title;
    let mut video = asked.clone();

    let meta = ResourceRequest::new(META, &asked.r#type, &asked.id);
    if manifest.answers(&meta) {
        let url = meta.url(manifest_url);
        let outcome = match fetch(fetcher, &url) {
            Err(error) => Outcome::Unreachable {
                detail: error.to_string(),
            },
            Ok(body) => match Title::parse(&body, manifest.id.clone(), asked) {
                Err(error) => Outcome::Malformed {
                    detail: error.to_string(),
                },
                Ok(title) => {
                    if let Some(first) = title.videos.first() {
                        video = TitleRef {
                            r#type: asked.r#type.clone(),
                            id: first.id.clone(),
                        };
                    }
                    Outcome::Ok { items: 1 }
                }
            },
        };
        asks.push(ResourceReport {
            resource: "meta",
            subject: asked.to_string(),
            url,
            outcome,
        });
    }

    // Streams, of the Video — the Title for a film, an episode for a series.
    let streams = ResourceRequest::new(STREAM, &video.r#type, &video.id);
    if manifest.answers(&streams) {
        asks.push(ask(
            fetcher,
            manifest_url,
            "stream",
            video.to_string(),
            &streams,
            |body| {
                Stream::parse(body)
                    .map(|streams| streams.len())
                    .map_err(|error| error.to_string())
            },
        ));
    }

    // Subtitles, of the same Video — the fallback source ADR-0014 names.
    let subtitles = ResourceRequest::new(SUBTITLES, &video.r#type, &video.id);
    if manifest.answers(&subtitles) {
        asks.push(ask(
            fetcher,
            manifest_url,
            "subtitles",
            video.to_string(),
            &subtitles,
            |body| {
                Subtitle::parse(body)
                    .map(|subtitles| subtitles.len())
                    .map_err(|error| error.to_string())
            },
        ));
    }

    AddonReport {
        manifest_url: manifest_url.to_owned(),
        summary: Some(summary),
        asks,
    }
}

/// Fetch one URL through the Host's one Fetcher.
fn fetch(fetcher: &dyn Fetcher, url: &str) -> Result<String, FetchError> {
    fetcher.fetch(url)
}

/// Read one Addon's manifest, or the outcome that says why there is none.
fn read_manifest(fetcher: &dyn Fetcher, manifest_url: &str) -> Result<Manifest, Outcome> {
    match fetch(fetcher, manifest_url) {
        Err(error) => Err(Outcome::Unreachable {
            detail: error.to_string(),
        }),
        Ok(body) => Manifest::parse(&body).map_err(|error| Outcome::Malformed {
            detail: error.to_string(),
        }),
    }
}

/// Ask one resource and read the answer, reporting what came of it.
///
/// `read` turns a body into how many things it carried — the parser the Host
/// reads that resource with — and its error into the detail a person is shown.
fn ask(
    fetcher: &dyn Fetcher,
    manifest_url: &str,
    resource: &'static str,
    subject: String,
    requested: &ResourceRequest,
    read: impl FnOnce(&str) -> Result<usize, String>,
) -> ResourceReport {
    let url = requested.url(manifest_url);
    let outcome = match fetch(fetcher, &url) {
        Err(error) => Outcome::Unreachable {
            detail: error.to_string(),
        },
        Ok(body) => match read(&body) {
            Err(detail) => Outcome::Malformed { detail },
            Ok(items) => Outcome::carried(items),
        },
    };

    ResourceReport {
        resource,
        subject,
        url,
        outcome,
    }
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
                outcome_line(&ask.outcome)
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
                Outcome::Ok { .. } => ok += 1,
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

fn outcome_line(outcome: &Outcome) -> String {
    match outcome {
        // The manifest, which read and is one thing rather than a list.
        Outcome::Ok { items: 0 } => "ok".to_owned(),
        Outcome::Ok { items } => format!("ok ({items} item{})", plural(*items)),
        Outcome::Empty => "empty".to_owned(),
        Outcome::Malformed { detail } => format!("malformed: {detail}"),
        Outcome::Unreachable { detail } => format!("unreachable: {detail}"),
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
    use host_core::{FetchError, FixtureFetcher};

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

    fn outcome(report: &AddonReport, resource: &str) -> Outcome {
        report
            .asks
            .iter()
            .find(|ask| ask.resource == resource)
            .unwrap_or_else(|| panic!("the run asked {resource}: {:?}", report.asks))
            .outcome
            .clone()
    }

    #[test]
    fn a_well_behaved_addon_is_asked_every_resource_and_reads() {
        let fetcher = well_behaved();
        let report = run(&fetcher, MANIFEST_URL, &options());

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

        assert_eq!(outcome(&report, "manifest"), Outcome::Ok { items: 0 });
        assert_eq!(outcome(&report, "catalog"), Outcome::Ok { items: 1 });
        assert_eq!(outcome(&report, "search"), Outcome::Ok { items: 1 });
        assert_eq!(outcome(&report, "meta"), Outcome::Ok { items: 1 });
        assert_eq!(outcome(&report, "stream"), Outcome::Ok { items: 1 });
        assert_eq!(outcome(&report, "subtitles"), Outcome::Ok { items: 1 });

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
        let report = run(&fetcher, MANIFEST_URL, &options());

        assert!(report.summary.is_none());
        assert_eq!(report.asks.len(), 1, "the manifest is the only ask");
        assert!(
            matches!(outcome(&report, "manifest"), Outcome::Malformed { .. }),
            "a body that is not a manifest is malformed: {:?}",
            outcome(&report, "manifest")
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
        let report = run(&fetcher, MANIFEST_URL, &options());

        assert!(report.summary.is_none());
        assert_eq!(
            outcome(&report, "manifest"),
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
        let report = run(&fetcher, MANIFEST_URL, &options());

        assert_eq!(
            report
                .asks
                .iter()
                .map(|ask| ask.resource)
                .collect::<Vec<_>>(),
            vec!["manifest", "stream"],
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
        let report = run(&fetcher, MANIFEST_URL, &options());

        assert!(
            matches!(outcome(&report, "catalog"), Outcome::Malformed { .. }),
            "the catalog body is not a catalog"
        );
        assert_eq!(outcome(&report, "search"), Outcome::Ok { items: 1 });
        assert_eq!(outcome(&report, "meta"), Outcome::Ok { items: 1 });
        assert_eq!(
            outcome(&report, "stream"),
            Outcome::Ok { items: 1 },
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
        let report = run(&fetcher, MANIFEST_URL, &options());

        assert_eq!(outcome(&report, "catalog"), Outcome::Empty);
        assert_eq!(outcome(&report, "search"), Outcome::Empty);
        assert_eq!(outcome(&report, "stream"), Outcome::Empty);
        assert_eq!(outcome(&report, "subtitles"), Outcome::Empty);
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
        let report = run(&fetcher, MANIFEST_URL, &options());

        assert_eq!(outcome(&report, "manifest"), Outcome::Ok { items: 0 });
        for resource in ["catalog", "search", "meta", "stream", "subtitles"] {
            assert!(
                matches!(outcome(&report, resource), Outcome::Unreachable { .. }),
                "{resource} was down: {:?}",
                outcome(&report, resource)
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
            MANIFEST_URL,
            &Options {
                query: "matrix".to_owned(),
                title: series,
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
        assert_eq!(outcome(&report, "stream"), Outcome::Ok { items: 1 });
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
        let report = run(&fetcher, MANIFEST_URL, &options());

        assert_eq!(outcome(&report, "catalog"), Outcome::Ok { items: 1 });
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
        let rendered = render(&[run(&fetcher, MANIFEST_URL, &options())]);

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
}
