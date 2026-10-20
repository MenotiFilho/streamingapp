//! The remote client the Host serves: one page, compiled in and completed at
//! serve time.
//!
//! A browser on another device has to load *something* before it can pair, and
//! the Host is the only thing that knows it exists, so the page travels with the
//! binary rather than from a build directory that may not be there (#31). It is
//! deliberately one self-contained document with no build step, and it is the
//! Host's own window's equal rather than a curated subset (#32): pairing,
//! browsing and search, opening a Title and choosing among its Streams, the full
//! control set, and the Host's own settings — all over the one Action surface
//! (ADR-0002). Its capability list is asserted against that surface here, so a
//! control added for one client cannot go missing from the other.
//!
//! Browsing and navigation stay in the page, per device (ADR-0005): what one
//! client is looking at moves nothing on another, and the Cast Remote's docked
//! strip — not the disappearance of the browse surface — is where the one shared
//! thing, playback, is controlled.
//!
//! The template on disk is not quite the page that is served. The palette
//! (`src/tokens.css`), the curated subtitle languages (`src/subtitle-languages.json`),
//! the approved TMDB mark, and the app version are spliced in here, at serve
//! time, through one marker convention (`/*__SPLICE_NAME__*/`). That keeps
//! `src/tokens.css` the single palette in the tree and the language list one
//! list for two clients, while the bytes a browser receives are still one
//! self-contained document with no build step (#88, amending ADR-0017 §2 and
//! ADR-0018 §1).

use std::io;
use std::net::TcpStream;
use std::sync::OnceLock;

use crate::http::{self, Request};

/// The page as committed: the structure, the styles, and the script, with the
/// shared assets named by their splice markers.
const TEMPLATE: &str = include_str!("../remote/index.html");

/// The window's one palette (#77). The remote splices it rather than keeping a
/// second `:root` block on disk.
const TOKENS: &str = include_str!("../../../src/tokens.css");

/// The curated subtitle languages (#82), spliced as the JSON the picker reads.
const SUBTITLE_LANGUAGES: &str = include_str!("../../../src/subtitle-languages.json");

/// The approved TMDB mark, spliced from the window's own asset so the two
/// clients cannot drift.
const TMDB_LOGO: &str = include_str!("../../../src/assets/tmdb-logo.svg");

/// The window's keyboard intent table, read only by the test that keeps the two
/// clients agreeing on what a key means.
#[cfg(test)]
const KEY_INTENTS_SOURCE: &str = include_str!("../../../src/input.ts");

/// The one marker convention. A marker is a CSS comment so the template is a
/// valid document before it is spliced, and it is consumed in [`splice`].
const TOKENS_MARKER: &str = "/*__SPLICE_TOKENS__*/";
const SUBTITLE_LANGUAGES_MARKER: &str = "/*__SPLICE_SUBTITLE_LANGUAGES__*/";
const TMDB_LOGO_MARKER: &str = "/*__SPLICE_TMDB_LOGO__*/";
const VERSION_MARKER: &str = "/*__SPLICE_VERSION__*/";

/// The page, spliced once per process.
fn page() -> &'static str {
    static PAGE: OnceLock<String> = OnceLock::new();
    PAGE.get_or_init(|| splice(TEMPLATE))
}

/// Replace every marker with what it names.
///
/// A missing marker is a programming error in the template, not a condition a
/// browser's request can create: the page would silently lose its palette or its
/// language list, so the first serve fails loudly instead.
fn splice(template: &str) -> String {
    for marker in [
        TOKENS_MARKER,
        SUBTITLE_LANGUAGES_MARKER,
        TMDB_LOGO_MARKER,
        VERSION_MARKER,
    ] {
        assert!(
            template.contains(marker),
            "the remote template carries the {marker} marker"
        );
    }

    template
        .replace(TOKENS_MARKER, TOKENS)
        .replace(SUBTITLE_LANGUAGES_MARKER, SUBTITLE_LANGUAGES)
        .replace(TMDB_LOGO_MARKER, TMDB_LOGO)
        .replace(
            VERSION_MARKER,
            &format!("\"{}\"", env!("CARGO_PKG_VERSION")),
        )
}

/// Answer a request that is not an upgrade: the page, or nothing.
pub(crate) fn serve(stream: &mut TcpStream, request: &Request) -> io::Result<()> {
    match (request.method.as_str(), request.path.as_str()) {
        // The page is the whole client, so it is served for both the bare host
        // and the name a browser might append to it.
        ("GET", "/") | ("GET", "/index.html") => http::write_document(
            stream,
            "200 OK",
            "text/html; charset=utf-8",
            page().as_bytes(),
        ),
        // A browser asks for this whether or not the page offers one; saying no
        // is quieter than a 200 with nothing in it.
        ("GET", "/favicon.ico") => {
            http::write_document(stream, "404 Not Found", "text/plain; charset=utf-8", b"")
        }
        _ => http::write_document(
            stream,
            "404 Not Found",
            "text/plain; charset=utf-8",
            b"the Host serves one page and its socket\n",
        ),
    }
}

#[cfg(test)]
mod tests {
    use std::collections::{BTreeMap, BTreeSet};

    use super::{
        page, splice, KEY_INTENTS_SOURCE, SUBTITLE_LANGUAGES, TEMPLATE, TMDB_LOGO, TOKENS,
        VERSION_MARKER,
    };

    /// The page's capability list: the Actions it says it can send, read out of
    /// the JSON block it carries for exactly this purpose.
    fn declared_capabilities(page: &str) -> BTreeSet<String> {
        let marker = "id=\"action-capabilities\"";
        let start = page
            .find(marker)
            .expect("the remote page declares its capability list");
        let after = &page[start..];
        let open = after.find('>').expect("the declaration has a body") + 1;
        let close = after[open..]
            .find("</script>")
            .expect("the declaration is closed")
            + open;
        serde_json::from_str(&after[open..close])
            .expect("the capability list is a JSON array of Action spellings")
    }

    /// Every custom property a token sheet declares, by name.
    fn token_properties(css: &str) -> BTreeSet<String> {
        css.lines()
            .filter_map(|line| {
                let line = line.trim();
                let rest = line.strip_prefix("--")?;
                let (name, _) = rest.split_once(':')?;
                Some(format!("--{}", name.trim()))
            })
            .collect()
    }

    /// The `KEY_INTENTS` table in a source file, as keys and intents.
    ///
    /// Both files hold one object literal of `Key: "intent"` lines. The parser is
    /// deliberately narrow: a comment line, a blank line or a member that does
    /// not read that way is a test failure rather than something silently
    /// skipped, because the point is that the two tables are the same table.
    fn key_intents(source: &str) -> BTreeMap<String, String> {
        let start = source
            .find("KEY_INTENTS")
            .expect("the source declares a KEY_INTENTS table");
        let open = source[start..]
            .find('{')
            .expect("the intent table is an object literal")
            + start;
        let close = source[open..]
            .find('}')
            .expect("the intent table is closed")
            + open;

        let mut table = BTreeMap::new();
        for line in source[open + 1..close].lines() {
            let line = line.trim().trim_end_matches(',');
            if line.is_empty() || line.starts_with("//") {
                continue;
            }
            let (key, value) = line
                .split_once(':')
                .unwrap_or_else(|| panic!("{line} is a key and an intent"));
            let key = key.trim().trim_matches('"');
            let value = value.trim().trim_matches('"');
            assert!(
                !key.is_empty() && !value.is_empty(),
                "{line} is not a key and an intent"
            );
            table.insert(key.to_owned(), value.to_owned());
        }
        table
    }

    #[test]
    fn the_remote_declares_the_whole_action_surface() {
        // The remote is the Host's own window's equal, not a curated subset
        // (ADR-0002). A capability added to the surface is one the remote is
        // held to here: the page's list must name every Action and no other, so
        // a control added for one client cannot go missing from the other (#32).
        let declared = declared_capabilities(page());
        let surface: BTreeSet<&str> = host_core::Action::SPELLINGS.iter().copied().collect();

        let declared: BTreeSet<&str> = declared.iter().map(String::as_str).collect();
        assert_eq!(
            declared, surface,
            "the remote's capability list is the Action surface, exactly"
        );
    }

    #[test]
    fn the_served_page_carries_every_token_the_window_uses() {
        let tokens = token_properties(TOKENS);
        assert!(!tokens.is_empty(), "the token sheet declares its palette");

        let served = page();
        for token in &tokens {
            assert!(
                served.contains(&format!("{token}:")),
                "the served page carries {token} from src/tokens.css"
            );
        }
    }

    #[test]
    fn the_served_page_carries_the_shared_subtitle_language_list() {
        let languages: Vec<serde_json::Value> =
            serde_json::from_str(SUBTITLE_LANGUAGES).expect("the subtitle-language list is JSON");
        assert!(!languages.is_empty());

        let served = page();
        for language in languages {
            let tag = language["tag"].as_str().expect("a language has a tag");
            let name = language["name"].as_str().expect("a language has a name");
            assert!(served.contains(tag), "the served page carries {tag}");
            assert!(served.contains(name), "the served page carries {name}");
        }
    }

    #[test]
    fn the_splice_markers_are_consumed() {
        // The bytes a browser receives are the finished page: no marker survives
        // to be read as content, and the template names what gets spliced.
        let served = page();
        for marker in [
            "/*__SPLICE_TOKENS__*/",
            "/*__SPLICE_SUBTITLE_LANGUAGES__*/",
            "/*__SPLICE_TMDB_LOGO__*/",
            "/*__SPLICE_VERSION__*/",
        ] {
            assert!(
                !served.contains(marker),
                "the served page consumed {marker}"
            );
        }
        assert!(served.contains("--bg-canvas:"), "the palette was spliced");
    }

    #[test]
    fn the_template_holds_no_local_palette() {
        // `src/tokens.css` is the single source of truth: the template names the
        // splice marker instead of keeping a second copy of the values.
        assert!(
            !TEMPLATE.contains(":root"),
            "the template has no local :root block"
        );
        assert!(
            !TEMPLATE.contains("--bg-canvas:"),
            "the template declares no palette custom properties"
        );
    }

    #[test]
    fn the_served_page_carries_the_tmdb_attribution() {
        let served = page();
        assert!(served
            .contains("This product uses the TMDB API but is not endorsed or certified by TMDB"));
        assert!(
            served.contains("class=\"tmdb-logo\""),
            "the About/Credits logo is on the page"
        );
        // The mark itself, from the window's own asset rather than a second copy.
        let mark = TMDB_LOGO
            .split_once("d=\"")
            .and_then(|(_, rest)| rest.split_once('"'))
            .map(|(path, _)| path)
            .expect("the TMDB mark is an SVG path");
        assert!(served.contains(mark), "the served logo is the asset's path");
    }

    #[test]
    fn the_remote_keyboard_intents_are_the_windows() {
        // One intent table, two clients: the keyboard column is the same words in
        // the same order, and the remote deliberately has no pad column on the
        // insecure HTTP origin.
        assert_eq!(
            key_intents(KEY_INTENTS_SOURCE),
            key_intents(page()),
            "the remote's KEY_INTENTS matches src/input.ts"
        );
        let served = page();
        for pad in [
            "PAD_BUTTONS",
            "PAD_AXES",
            "padIntents",
            "navigator.getGamepads",
        ] {
            assert!(!served.contains(pad), "the remote carries no pad column");
        }
    }

    #[test]
    fn the_version_marker_is_replaced_with_a_json_string() {
        let spliced = splice(TEMPLATE);
        let marker = VERSION_MARKER;
        assert!(!spliced.contains(marker));
        assert!(spliced.contains(&format!("\"{}\"", env!("CARGO_PKG_VERSION"))));
    }
}
