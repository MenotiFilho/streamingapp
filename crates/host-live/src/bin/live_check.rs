//! `live_check` — the read-only conformance run against real Addons (#33).
//!
//! ```sh
//! cargo run --bin live_check
//! cargo run --bin live_check -- https://example.org/manifest.json
//! ```
//!
//! The engine is [`host_live`]; this is the shell that reads its arguments,
//! builds the Host's real [`host_addon::HttpFetcher`], and prints what the run
//! found. Run it deliberately: it reaches the network, and it is a report rather
//! than a test suite (ADR-0019).

use std::process::ExitCode;

use host_addon::HttpFetcher;
use host_core::{ManifestUrl, TitleRef};
use host_live::{render, run, Options};

/// The Addons a run with no arguments checks, one for each resource the Host
/// reads, so that the documented command exercises the whole path with no setup.
const DEFAULT_ADDONS: &[&str] = &[
    "https://v3-cinemeta.strem.io/manifest.json",
    "https://watchhub.strem.io/manifest.json",
    "https://opensubtitles-v3.strem.io/manifest.json",
];

const USAGE: &str = "\
live_check — read-only conformance against real Addons

Usage: live_check [OPTIONS] [MANIFEST_URL...]

Runs the Host's addon path — manifest, catalog, search, meta, stream, subtitles —
against each Addon, and reports what each resource answered. It only reads: it
writes nothing to the Addon, to Stremio or to the Host's own store.

With no MANIFEST_URL it checks a small set of real Addons that between them cover
every resource:

  https://v3-cinemeta.strem.io/manifest.json         catalog, search, meta
  https://watchhub.strem.io/manifest.json            stream
  https://opensubtitles-v3.strem.io/manifest.json    subtitles

Options:
  --search <QUERY>     what to search catalogs for (default: matrix)
  --title <TYPE/ID>    the Title to open; its Streams and subtitles are asked
                       for, and for a series its first episode (default:
                       movie/tt0133093)
  -h, --help           print this help

The report names each resource's outcome — ok, empty, malformed or unreachable —
and the URLs asked, which for an Addon like AIOStreams carry its configuration, so
treat the output as you would the manifest URL. The command exits 0 whenever it
ran: an Addon being down is an outcome in the report, never a failed run.
";

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();

    let cli = match Cli::parse(&args) {
        Ok(Cli::Help) => {
            print!("{USAGE}");
            return ExitCode::SUCCESS;
        }
        Ok(Cli::Run(cli)) => cli,
        Err(message) => {
            eprintln!("live_check: {message}\n");
            eprint!("{USAGE}");
            return ExitCode::from(2);
        }
    };

    let fetcher = HttpFetcher::new();
    let reports: Vec<_> = cli
        .addons
        .iter()
        .map(|url| run(&fetcher, url, &cli.options))
        .collect();

    print!("{}", render(&reports));

    ExitCode::SUCCESS
}

enum Cli {
    Help,
    Run(Run),
}

struct Run {
    addons: Vec<String>,
    options: Options,
}

impl Cli {
    fn parse(args: &[String]) -> Result<Self, String> {
        let mut options = Options::default();
        let mut addons = Vec::new();
        let mut rest = args.iter();

        while let Some(argument) = rest.next() {
            match argument.as_str() {
                "-h" | "--help" => return Ok(Self::Help),
                "--search" => {
                    options.query = value(&mut rest, "--search")?;
                }
                "--title" => {
                    let raw = value(&mut rest, "--title")?;
                    options.title = parse_title(&raw)?;
                }
                other if other.starts_with('-') => {
                    return Err(format!("unknown option {other:?}"));
                }
                url => {
                    // A URL that is not one is a mistake in the command, not a
                    // third-party failure: refuse it here rather than reporting
                    // it as an Addon that could not be reached.
                    let manifest_url =
                        ManifestUrl::parse(url).map_err(|error| error.to_string())?;
                    addons.push(manifest_url.to_string());
                }
            }
        }

        if addons.is_empty() {
            addons = DEFAULT_ADDONS.iter().map(|url| (*url).to_owned()).collect();
        }

        Ok(Self::Run(Run { addons, options }))
    }
}

/// The value an option takes, or why it has none.
fn value(rest: &mut std::slice::Iter<String>, option: &str) -> Result<String, String> {
    rest.next()
        .cloned()
        .ok_or_else(|| format!("{option} needs a value"))
}

/// A Title named `type/id`, the way the Host names one.
fn parse_title(raw: &str) -> Result<TitleRef, String> {
    let (r#type, id) = raw
        .split_once('/')
        .ok_or_else(|| format!("{raw:?} is not a Title — it should be <type>/<id>"))?;

    TitleRef::parse(r#type, id).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_run(args: &[&str]) -> Run {
        let args: Vec<String> = args.iter().map(|arg| (*arg).to_owned()).collect();
        match Cli::parse(&args) {
            Ok(Cli::Run(run)) => run,
            Ok(Cli::Help) => panic!("{args:?} should be a run, not help"),
            Err(message) => panic!("{args:?} should parse: {message}"),
        }
    }

    #[test]
    fn no_arguments_check_the_default_addons_with_the_default_options() {
        let run = parse_run(&[]);
        let expected: Vec<String> = DEFAULT_ADDONS.iter().map(|url| (*url).to_owned()).collect();

        assert_eq!(run.addons, expected);
        assert_eq!(run.options, Options::default());
    }

    #[test]
    fn a_manifest_url_is_checked_instead_of_the_defaults() {
        let run = parse_run(&["https://example.org/manifest.json"]);

        assert_eq!(run.addons, vec!["https://example.org/manifest.json"]);
    }

    #[test]
    fn search_and_title_are_read() {
        let run = parse_run(&[
            "--search",
            "blood & guts",
            "--title",
            "series/tt0903747",
            "https://example.org/manifest.json",
        ]);

        assert_eq!(run.options.query, "blood & guts");
        assert_eq!(run.options.title.r#type, "series");
        assert_eq!(run.options.title.id, "tt0903747");
        assert_eq!(run.addons, vec!["https://example.org/manifest.json"]);
    }

    #[test]
    fn help_is_help_wherever_it_appears() {
        for args in [
            vec!["-h"],
            vec!["--help"],
            vec!["https://x/manifest.json", "-h"],
        ] {
            let args: Vec<String> = args.iter().map(|arg| (*arg).to_owned()).collect();
            assert!(matches!(Cli::parse(&args), Ok(Cli::Help)), "{args:?}");
        }
    }

    #[test]
    fn an_option_that_is_not_one_and_a_title_that_is_not_one_are_refused() {
        for args in [
            vec!["--bogus"],
            vec!["--title", "nonsense"],
            vec!["--search"],
        ] {
            let args: Vec<String> = args.iter().map(|arg| (*arg).to_owned()).collect();
            assert!(Cli::parse(&args).is_err(), "{args:?} should be refused");
        }
    }

    #[test]
    fn a_manifest_url_that_is_not_one_is_a_usage_error_rather_than_an_unreachable_addon() {
        // A mistyped URL is the command's mistake, not a third-party failure, so
        // it is refused before any run rather than reported as unreachable.
        for not_a_url in [
            "not a url",
            "ftp://example.org/manifest.json",
            "example.org",
        ] {
            let args = vec![not_a_url.to_owned()];
            assert!(
                Cli::parse(&args).is_err(),
                "{not_a_url:?} should be refused"
            );
        }
    }
}
