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
//! the subtitle appearance presets (`src/subtitle-appearance.json`), the Stream
//! buffer presets (`src/stream-buffer.json`), and the approved TMDB mark are
//! spliced in here, at serve time, through one marker convention
//! (`/*__SPLICE_NAME__*/`). That keeps `src/tokens.css` the single palette in the
//! tree and each list one list for two clients, while the bytes a browser
//! receives are still one self-contained document with no build step (#88,
//! #126, #135; amending ADR-0017 §2 and ADR-0018 §1).

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

/// The subtitle appearance presets (#126), sharing one file with `src/controls.ts`
/// so the window's chips and the Remote's cannot drift (ADR-0024 §5).
const SUBTITLE_APPEARANCE: &str = include_str!("../../../src/subtitle-appearance.json");

/// The Stream buffer presets (#135), the same file `src/controls.ts` imports, so
/// the two clients offer one list (ADR-0026).
const STREAM_BUFFER: &str = include_str!("../../../src/stream-buffer.json");

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
const SUBTITLE_APPEARANCE_MARKER: &str = "/*__SPLICE_SUBTITLE_APPEARANCE__*/";
const STREAM_BUFFER_MARKER: &str = "/*__SPLICE_STREAM_BUFFER__*/";
const TMDB_LOGO_MARKER: &str = "/*__SPLICE_TMDB_LOGO__*/";

/// Every marker the template must carry, in the order it is spliced.
const MARKERS: [&str; 5] = [
    TOKENS_MARKER,
    SUBTITLE_LANGUAGES_MARKER,
    SUBTITLE_APPEARANCE_MARKER,
    STREAM_BUFFER_MARKER,
    TMDB_LOGO_MARKER,
];

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
    for marker in MARKERS {
        assert!(
            template.contains(marker),
            "the remote template carries the {marker} marker"
        );
    }

    template
        .replace(TOKENS_MARKER, TOKENS)
        .replace(SUBTITLE_LANGUAGES_MARKER, SUBTITLE_LANGUAGES)
        .replace(SUBTITLE_APPEARANCE_MARKER, SUBTITLE_APPEARANCE)
        .replace(STREAM_BUFFER_MARKER, STREAM_BUFFER)
        .replace(TMDB_LOGO_MARKER, TMDB_LOGO)
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
        page, KEY_INTENTS_SOURCE, MARKERS, STREAM_BUFFER, SUBTITLE_APPEARANCE, SUBTITLE_LANGUAGES,
        TEMPLATE, TMDB_LOGO, TOKENS,
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

    /// The body of the page's `sheetSignature`, which decides when the sheet
    /// redraws. Its exact shape is not the point; what it carries is.
    fn sheet_signature(page: &str) -> &str {
        page.split("function sheetSignature()")
            .nth(1)
            .and_then(|rest| rest.split("return JSON.stringify").nth(1))
            .and_then(|rest| rest.split("});").next())
            .expect("the page has a sheet signature")
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
    fn the_served_page_carries_the_subtitle_appearance_controls() {
        // The Remote is the window's equal (ADR-0018): the appearance is two
        // Actions, and both clients reach them. The declaration in the
        // capability list above is what proves it *can* send them; this is what
        // proves an affordance is wired to each one.
        let served = page();
        for needle in [
            r#"data-a="subtitle-color""#,
            r#"data-a="subtitle-scale""#,
            r#"case "subtitle-color": {"#,
            r#"case "subtitle-scale": {"#,
            "SUBTITLE_COLORS",
            "SUBTITLE_SCALES",
            "stepScale",
            "formatScale",
            "Smaller subtitles",
            "Larger subtitles",
        ] {
            assert!(served.contains(needle), "the served page carries {needle}");
        }

        // The sheet is redrawn from a signature, so a size that moved has to be
        // part of it or the readout and buttons would keep the old value.
        let signature = sheet_signature(served);
        assert!(
            signature.contains("subtitleScale"),
            "the sheet signature carries the subtitle size: {signature}"
        );
    }

    #[test]
    fn the_shared_subtitle_appearance_list_agrees_with_the_hosts_bounds() {
        // ADR-0024 §5's "the same values by construction": one JSON is imported
        // by `src/controls.ts`, spliced into the served page, and held to the
        // bounds `SubtitleScale` validates against here.
        let appearance: serde_json::Value =
            serde_json::from_str(SUBTITLE_APPEARANCE).expect("the appearance list is JSON");

        assert_eq!(
            appearance["minScale"].as_f64(),
            Some(host_core::SubtitleScale::MIN),
            "the list's minimum is SubtitleScale::MIN"
        );
        assert_eq!(
            appearance["maxScale"].as_f64(),
            Some(host_core::SubtitleScale::MAX),
            "the list's maximum is SubtitleScale::MAX"
        );

        let scales = appearance["scales"]
            .as_array()
            .expect("the appearance list carries sizes");
        assert_eq!(scales.len(), 4, "there are four size presets");
        for choice in scales {
            let scale = choice["scale"].as_f64().expect("a size is a number");
            assert!(
                host_core::SubtitleScale::parse(scale).is_ok(),
                "{scale} is a size the Host accepts"
            );
        }
    }

    #[test]
    fn the_served_page_carries_the_stream_buffer_controls() {
        // The Remote is the window's equal (#32, ADR-0018): the buffer is one
        // preference, and the page carries both halves of it as chips.
        let served = page();
        for needle in [
            r#"data-a="buffer-seconds""#,
            r#"data-a="buffer-megabytes""#,
            r#"case "buffer-seconds": {"#,
            r#"case "buffer-megabytes": {"#,
            "STREAM_BUFFER_SECONDS",
            "STREAM_BUFFER_MEGABYTES",
            "set_stream_buffer",
            "Look-ahead",
            "Memory ceiling",
        ] {
            assert!(served.contains(needle), "the served page carries {needle}");
        }
    }

    #[test]
    fn the_shared_stream_buffer_list_agrees_with_the_hosts_bounds() {
        // `src/stream-buffer.json` is imported by `src/controls.ts`, spliced
        // into the served page, and held here to the bounds `StreamBuffer`
        // validates against — one list for two clients (ADR-0026).
        let buffer: serde_json::Value =
            serde_json::from_str(STREAM_BUFFER).expect("the buffer list is JSON");

        assert_eq!(
            buffer["minSeconds"].as_u64(),
            Some(host_core::StreamBuffer::MIN_SECONDS),
            "the list's smallest look-ahead is StreamBuffer::MIN_SECONDS"
        );
        assert_eq!(
            buffer["maxSeconds"].as_u64(),
            Some(host_core::StreamBuffer::MAX_SECONDS),
            "the list's longest look-ahead is StreamBuffer::MAX_SECONDS"
        );
        assert_eq!(
            buffer["minMegabytes"].as_u64(),
            Some(host_core::StreamBuffer::MIN_MEGABYTES),
            "the list's smallest ceiling is StreamBuffer::MIN_MEGABYTES"
        );
        assert_eq!(
            buffer["maxMegabytes"].as_u64(),
            Some(host_core::StreamBuffer::MAX_MEGABYTES),
            "the list's largest ceiling is StreamBuffer::MAX_MEGABYTES"
        );
        assert_eq!(
            buffer["defaultSeconds"].as_u64(),
            Some(host_core::StreamBuffer::DEFAULT_SECONDS),
            "the list's default look-ahead is StreamBuffer::DEFAULT_SECONDS"
        );
        assert_eq!(
            buffer["defaultMegabytes"].as_u64(),
            Some(host_core::StreamBuffer::DEFAULT_MEGABYTES),
            "the list's default ceiling is StreamBuffer::DEFAULT_MEGABYTES"
        );

        let seconds = buffer["seconds"]
            .as_array()
            .expect("the buffer list carries look-aheads");
        for choice in seconds {
            let seconds = choice["seconds"]
                .as_u64()
                .expect("a look-ahead is a number");
            assert!(
                host_core::StreamBuffer::parse(seconds, host_core::StreamBuffer::DEFAULT_MEGABYTES)
                    .is_ok(),
                "{seconds} s is a look-ahead the Host accepts"
            );
        }
        let megabytes = buffer["megabytes"]
            .as_array()
            .expect("the buffer list carries ceilings");
        for choice in megabytes {
            let megabytes = choice["megabytes"].as_u64().expect("a ceiling is a number");
            assert!(
                host_core::StreamBuffer::parse(host_core::StreamBuffer::DEFAULT_SECONDS, megabytes)
                    .is_ok(),
                "{megabytes} MB is a ceiling the Host accepts"
            );
        }

        // The default pair is one of the choices: a Host that has never been
        // told shows a chip pressed, not an Other nobody chose.
        assert!(
            seconds.iter().any(|choice| choice["seconds"].as_u64()
                == Some(host_core::StreamBuffer::DEFAULT_SECONDS)),
            "the default look-ahead has a chip"
        );
        assert!(
            megabytes.iter().any(|choice| choice["megabytes"].as_u64()
                == Some(host_core::StreamBuffer::DEFAULT_MEGABYTES)),
            "the default ceiling has a chip"
        );
    }

    #[test]
    fn the_served_page_carries_the_shared_subtitle_appearance_list() {
        // The bytes a browser receives carry the file's own JSON, not a second
        // hand-written list, so a chip added to Settings appears on both clients.
        let served = page();
        assert!(
            served.contains(SUBTITLE_APPEARANCE),
            "the served page carries src/subtitle-appearance.json verbatim"
        );

        let appearance: serde_json::Value =
            serde_json::from_str(SUBTITLE_APPEARANCE).expect("the appearance list is JSON");
        for (kind, field) in [("colors", "label"), ("scales", "label")] {
            for choice in appearance[kind]
                .as_array()
                .expect("the appearance list has the expected groups")
            {
                let label = choice[field].as_str().expect("a choice has a label");
                assert!(served.contains(label), "the served page carries {label}");
            }
        }

        // A value off the four-preset ladder — the Remote accepts any scale in
        // range — is named rather than leaving every chip unpressed.
        assert!(
            served.contains("Other (") && served.contains("scalePreset"),
            "the page has the Other choice for a size between the presets"
        );
        assert!(
            served.contains("SUBTITLE_SCALES.find") && !served.contains("SCALE_STEP"),
            "the sheet steps the four presets rather than a percentage"
        );
        assert!(
            !TEMPLATE.contains(r##""#FFFF00""##),
            "the template keeps no local colour list"
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
        for marker in MARKERS {
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
    fn the_served_page_answers_a_press_at_once() {
        // A control whose Action waits is marked before anything awaits, an
        // identical Action already in flight is joined, a relative one is not,
        // and the page shows one wait for all of them (#137).
        let served = page();
        for needle in [
            "async function runAction",
            "async function runWaiting",
            r#"node.dataset.pending = "true""#,
            "actionKey",
            "REPEATING_ACTIONS",
            "WAITING_CONTROLS",
            "pending-pill",
            "Waiting for the Host",
            "Opening…",
            r#"void runAction(node, node.dataset.a, node.dataset)"#,
        ] {
            assert!(served.contains(needle), "the served page carries {needle}");
        }
    }

    #[test]
    fn the_served_seek_bar_draws_the_read_ahead_under_the_played_fill() {
        // #139: a second, muted layer behind the accent fill, driven from the
        // Snapshot's `buffered` span; the range stays the control on top.
        let served = page();
        for needle in [
            r#"<div class="seek-track">"#,
            r#"class="seek-buffered" data-buffered"#,
            r#"class="seek-played" data-played"#,
            "function bufferedSpan(buffered, duration)",
            "bufferedLayer.hidden = span === null",
            "timelineFraction(p.position, p.duration)",
            "appearance: none; -webkit-appearance: none",
            r#"aria-label="Position""#,
            r#"data-focusable data-focus-key="cast-seek""#,
        ] {
            assert!(served.contains(needle), "the served page carries {needle}");
        }
    }

    #[test]
    fn the_served_timeline_draws_a_seek_preview_while_a_range_is_dragged() {
        // #140: the Remote has no pointer over its bar, so dragging is the
        // pointing. The tip is asked for per five-second bucket, one ask in
        // flight and the newest winning, and a moment the Host cannot draw is
        // the time and the chapter alone (ADR-0028).
        let served = page();
        for needle in [
            r#"<div class="seek-preview" data-preview-tip hidden>"#,
            r#"<img data-preview-still alt="" hidden />"#,
            r#"class="seek-preview-time tabular" data-preview-time"#,
            r#"class="seek-preview-chapter" data-preview-chapter hidden"#,
            "function previewBucket(at)",
            "function previewPoint(at)",
            "if (target.matches(\"[data-seek]\")) {",
            "previewPoint(Number(target.value))",
            "dispatch({ type: \"preview\", at: asked.at })",
            "seekPreview.wanted = { bucket, at: moment }",
            "if (seekPreview.wanted && seekPreview.wanted.bucket !== asked.bucket)",
            "tip.dataset.pending = seekPreview.waiting ? \"true\" : \"false\"",
            "const chapter = previewChapter(point.at)",
        ] {
            assert!(served.contains(needle), "the served page carries {needle}");
        }
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
}
