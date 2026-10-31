//! The remote client the Host serves: one page, compiled in and completed at
//! serve time.
//!
//! A browser on another device has to load *something* before it can pair, and
//! the Host is the only thing that knows it exists, so the page travels with the
//! binary rather than from a build directory that may not be there (#31). It is
//! deliberately one document with no build step, plus the one pinned motion
//! asset ADR-0031 allows, and it is the Host's own window's equal rather than a
//! curated subset (#32): pairing,
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
//! The template on disk is not quite the page that is served. The repertory
//! token sheet (`src/shell/repertory/tokens.css`), the drawn icon sprite
//! (`remote/icons.svg`), the curated subtitle languages
//! (`src/subtitle-languages.json`), the subtitle appearance presets
//! (`src/subtitle-appearance.json`), the Stream buffer presets
//! (`src/stream-buffer.json`), and the approved TMDB mark are spliced in here, at
//! serve time, through one marker convention. That keeps the palette, each
//! drawing and each list one source in the tree, while the bytes a browser
//! receives are still one document with no build step (#88, #126, #135, #149,
//! #159; amending ADR-0017 §2 and ADR-0018 §1). Motion is the one asset fetched
//! beside the document, version-pinned and cached (ADR-0031 §1).
//!
//! The repertory surface is served at `/` (#160). `/next`, which staged the
//! surface while it was being built (#152), answers `308 Permanent Redirect` to
//! `/` so a bookmark or an open tab on a phone lands on the one surface.

use std::io;
use std::net::TcpStream;
use std::sync::OnceLock;

use crate::http::{self, Request};

/// The page as committed: the structure, the styles, and the script, with the
/// shared assets named by their splice markers.
const TEMPLATE: &str = include_str!("../remote/index.html");

/// The repertory token sheet (#145–#149, #153), the same file the window
/// imports. The remote splices it rather than keeping a second `:root` block on
/// disk.
const REPERTORY_TOKENS: &str = include_str!("../../../src/window/repertory/tokens.css");

/// The same drawn icon set the window renders (#153), spliced into the served
/// page as a symbol sprite (#159). One set, two clients.
const REPERTORY_ICONS: &str = include_str!("../remote/icons.svg");

/// Motion's vanilla `animate`, the one asset the page fetches outside its own
/// document (ADR-0031 §1). The file is committed and version-pinned; the route
/// carries that version and is served `immutable`.
const MOTION_PATH: &str = "/motion-14.7.1.js";
const MOTION: &[u8] = include_bytes!("../remote/motion-14.7.1.js");

/// The faces the repertory token sheet names (#153). The window loads them from
/// its own origin; the served page receives the same bytes at `/fonts/<name>`,
/// so a phone without the faces is a fallback, not a different design.
const FONT_BODONI_MODA: &[u8] =
    include_bytes!("../../../public/fonts/bodoni-moda-latin-wght-normal.woff2");
const FONT_INTER: &[u8] = include_bytes!("../../../public/fonts/inter-latin-wght-normal.woff2");
const FONT_PLEX_400: &[u8] =
    include_bytes!("../../../public/fonts/ibm-plex-mono-latin-400-normal.woff2");
const FONT_PLEX_500: &[u8] =
    include_bytes!("../../../public/fonts/ibm-plex-mono-latin-500-normal.woff2");

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

/// The one marker convention. A marker is a CSS or HTML comment so the template
/// is a valid document before it is spliced, and it is consumed in [`splice`].
const REPERTORY_TOKENS_MARKER: &str = "/*__SPLICE_REPERTORY_TOKENS__*/";
const REPERTORY_ICONS_MARKER: &str = "<!--__SPLICE_REPERTORY_ICONS__-->";
const SUBTITLE_LANGUAGES_MARKER: &str = "/*__SPLICE_SUBTITLE_LANGUAGES__*/";
const SUBTITLE_APPEARANCE_MARKER: &str = "/*__SPLICE_SUBTITLE_APPEARANCE__*/";
const STREAM_BUFFER_MARKER: &str = "/*__SPLICE_STREAM_BUFFER__*/";
const TMDB_LOGO_MARKER: &str = "/*__SPLICE_TMDB_LOGO__*/";

/// Every marker the template must carry, in the order it is spliced.
const MARKERS: [&str; 6] = [
    REPERTORY_TOKENS_MARKER,
    REPERTORY_ICONS_MARKER,
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
        .replace(REPERTORY_TOKENS_MARKER, REPERTORY_TOKENS)
        .replace(REPERTORY_ICONS_MARKER, REPERTORY_ICONS)
        .replace(SUBTITLE_LANGUAGES_MARKER, SUBTITLE_LANGUAGES)
        .replace(SUBTITLE_APPEARANCE_MARKER, SUBTITLE_APPEARANCE)
        .replace(STREAM_BUFFER_MARKER, STREAM_BUFFER)
        .replace(TMDB_LOGO_MARKER, TMDB_LOGO)
}

/// The document a GET path asks for, where it asks for one.
fn document(path: &str) -> Option<&'static str> {
    match path {
        "/" | "/index.html" => Some(page()),
        _ => None,
    }
}

/// The bytes of one requested face, by the name in its `/fonts/` URL.
fn font(path: &str) -> Option<&'static [u8]> {
    match path.strip_prefix("/fonts/")? {
        "bodoni-moda-latin-wght-normal.woff2" => Some(FONT_BODONI_MODA),
        "inter-latin-wght-normal.woff2" => Some(FONT_INTER),
        "ibm-plex-mono-latin-400-normal.woff2" => Some(FONT_PLEX_400),
        "ibm-plex-mono-latin-500-normal.woff2" => Some(FONT_PLEX_500),
        _ => None,
    }
}

/// Answer a request that is not an upgrade: the page, its faces, or nothing.
pub(crate) fn serve(stream: &mut TcpStream, request: &Request) -> io::Result<()> {
    if request.method == "GET" {
        // The page is the whole client, so it is served for both the bare host
        // and the name a browser might append to it.
        if let Some(document) = document(&request.path) {
            return http::write_document(
                stream,
                "200 OK",
                "text/html; charset=utf-8",
                document.as_bytes(),
            );
        }
        // `/next` staged the repertory surface before the cutover (#152); it
        // now redirects permanently to `/` (#160).
        if request.path == "/next" {
            return http::write_permanent_redirect(stream, "/");
        }
        // One versioned asset, its URL naming the version, so it can be cached
        // for good (ADR-0031 §1).
        if request.path == MOTION_PATH {
            return http::write_immutable_asset(stream, "text/javascript; charset=utf-8", MOTION);
        }
        // The token sheet's `@font-face` rules name these files by absolute
        // path, so the window and the served page read one set of bytes.
        if request.path.starts_with("/fonts/") {
            return match font(&request.path) {
                Some(bytes) => http::write_asset(stream, "font/woff2", bytes),
                None => {
                    http::write_document(stream, "404 Not Found", "text/plain; charset=utf-8", b"")
                }
            };
        }
        // A browser asks for this whether or not the page offers one; saying no
        // is quieter than a 200 with nothing in it.
        if request.path == "/favicon.ico" {
            return http::write_document(stream, "404 Not Found", "text/plain; charset=utf-8", b"");
        }
    }
    http::write_document(
        stream,
        "404 Not Found",
        "text/plain; charset=utf-8",
        b"the Host serves one page, its fonts, its motion asset and its socket\n",
    )
}

#[cfg(test)]
mod tests {
    use std::collections::{BTreeMap, BTreeSet};

    use super::{
        document, font, page, KEY_INTENTS_SOURCE, MARKERS, MOTION, MOTION_PATH, REPERTORY_ICONS,
        REPERTORY_TOKENS, STREAM_BUFFER, SUBTITLE_APPEARANCE, SUBTITLE_LANGUAGES, TEMPLATE,
        TMDB_LOGO,
    };

    const ICONS_SOURCE: &str = include_str!("../../../src/window/repertory/icons.tsx");
    const PACKAGE_JSON: &str = include_str!("../../../package.json");

    /// Every SVG path `d` attribute in a source, for the sprite/window compare.
    fn d_paths(source: &str) -> BTreeSet<String> {
        let mut paths = BTreeSet::new();
        let mut rest = source;
        while let Some(start) = rest.find(" d=\"") {
            let after = &rest[start + 4..];
            let end = after.find('"').expect("an SVG path is quoted");
            paths.insert(after[..end].to_owned());
            rest = &after[end..];
        }
        paths
    }

    /// The names `icons.tsx` declares, in the order the window renders them.
    fn icon_names(source: &str) -> Vec<String> {
        let start = source
            .find("export const ICON_NAMES = [")
            .expect("the window declares its icon names")
            + "export const ICON_NAMES = [".len();
        let end = source[start..]
            .find("] as const")
            .expect("the icon-name list is closed")
            + start;
        source[start..end]
            .split('"')
            .skip(1)
            .step_by(2)
            .map(str::to_owned)
            .collect()
    }

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

    /// Every face the token sheet's `@font-face` rules name, by file name.
    ///
    /// The rules write an absolute `url("/fonts/<name>")`, which is the same
    /// path the window's origin resolves from `public/` and the served page
    /// asks the Host for.
    fn referenced_fonts(css: &str) -> BTreeSet<String> {
        const MARKER: &str = "url(\"/fonts/";
        let mut names = BTreeSet::new();
        let mut rest = css;
        while let Some(start) = rest.find(MARKER) {
            let after = &rest[start + MARKER.len()..];
            let end = after.find('"').expect("the font URL is quoted");
            names.insert(after[..end].to_owned());
            rest = &after[end..];
        }
        names
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
    fn the_served_page_carries_every_repertory_token() {
        // #149's bridge: the phone reads the same token sheet the window
        // imports, not a hand-copied palette in the template. A token added to
        // the sheet must reach the served page.
        let tokens = token_properties(REPERTORY_TOKENS);
        assert!(
            tokens.contains("--rep-ink"),
            "the repertory sheet declares the palette"
        );
        assert!(
            tokens.contains("--rep-remote-text-body"),
            "the repertory sheet declares the Remote's phone scale"
        );

        let served = page();
        for token in &tokens {
            assert!(
                served.contains(&format!("{token}:")),
                "the served page carries {token} from the repertory token sheet"
            );
        }
    }

    #[test]
    fn the_repertory_surface_is_served_at_the_root_without_a_staging_attribute() {
        // #160: `/` serves the repertory document directly; `/next` is not a
        // separate document (it redirects in `serve`). Neither the `data-ui`
        // staging attribute nor the `?ui` selector remains.
        assert_eq!(document("/"), Some(page()));
        assert_eq!(document("/index.html"), Some(page()));
        assert!(document("/next").is_none());
        assert!(document("/next/").is_none());

        let served = page();
        assert!(
            served.starts_with("<!doctype html>\n<html lang=\"en\">"),
            "the root document opens without a staging attribute"
        );
        assert!(
            !served.contains("data-ui="),
            "the staging attribute is gone from the served page"
        );
        assert!(
            !served.contains("URLSearchParams"),
            "the ?ui bridge is gone"
        );
        assert!(!served.contains("get(\"ui\")"), "the ?ui bridge is gone");
        assert!(served.contains("pairing-card"));
    }

    #[test]
    fn the_repertory_surface_carries_the_one_drawn_icon_set() {
        // #159: the page receives the same symbols the window's `icons.tsx`
        // declares, spliced as one sprite. A name added to the window must
        // reach the Remote, or the page would draw nothing for it.
        let names = icon_names(ICONS_SOURCE);
        assert_eq!(names.len(), 25, "the window declares the drawn set");
        for name in &names {
            let needle = format!("id=\"rep-icon-{name}\"");
            assert!(
                REPERTORY_ICONS.contains(&needle),
                "the sprite carries {needle}"
            );
            assert!(page().contains(&needle), "the served page carries {needle}");
        }

        // The vectors are one drawing, not two that happen to share names: a
        // path changed in the window has to change in the sprite.
        let window_paths = d_paths(ICONS_SOURCE);
        let sprite_paths = d_paths(REPERTORY_ICONS);
        assert!(!sprite_paths.is_empty(), "the sprite carries drawings");
        for path in &sprite_paths {
            assert!(
                window_paths.contains(path),
                "the sprite draws a path the window does not: {path}"
            );
        }
    }

    #[test]
    fn the_motion_asset_is_pinned_licensed_and_read_by_the_module_script() {
        // ADR-0031: one committed, version-pinned ESM bundle, imported by one
        // module script. The spring durations are read from the token sheet,
        // not copied into the page.
        let package: serde_json::Value =
            serde_json::from_str(PACKAGE_JSON).expect("package.json is JSON");
        let dependency = package["dependencies"]["motion"]
            .as_str()
            .expect("the window depends on Motion");
        let pinned = dependency.trim_start_matches(['^', '~', '=']);
        assert_eq!(
            MOTION_PATH,
            format!("/motion-{pinned}.js"),
            "the asset's URL names the dependency's version"
        );
        let bundle = std::str::from_utf8(MOTION).expect("the Motion bundle is UTF-8");
        assert!(
            bundle.starts_with("/*! Motion v14.7.1 | MIT"),
            "the bundle carries its version and licence"
        );
        assert!(bundle.contains("export"), "the bundle is an ES module");

        let served = page();
        for needle in [
            MOTION_PATH,
            "type=\"module\"",
            "startRepertoryMotion",
            "prefers-reduced-motion: reduce",
            "motionSeconds(\"--rep-motion-panel\", 0.24)",
            "motionSeconds(\"--rep-motion-fade\", 0.14)",
            "visualDuration",
            "bounce: 0",
        ] {
            assert!(served.contains(needle), "the served page carries {needle}");
        }
        let module_start = served
            .find("<script type=\"module\">")
            .expect("the page has one module script");
        let module_end = served[module_start..]
            .find("</script>")
            .map(|offset| module_start + offset)
            .expect("the module script is closed");
        let module = &served[module_start..module_end];
        assert!(
            module.contains("import(\"/motion-14.7.1.js\")"),
            "the asset is imported, not inlined"
        );
    }

    #[test]
    fn the_served_page_draws_every_playback_menu_in_one_drawer() {
        // #149's second look: Audio & Subtitles, Episodes, Speed, Chapters and
        // Picture share one drawer and one Done/Back rule. Volume is not a menu:
        // it is the always-visible box between the transport and the five-menu
        // row, and its mute control is an icon.
        let served = page();
        for needle in [
            "function sheetTitle",
            "function renderSheetMenu",
            "function openMenu",
            "function renderCastMenus",
            r#"mark(p.muted ? "volume-muted" : "volume""#,
            r#"case "episodes": return renderEpisodesSheet();"#,
            r#"case "speed": return html`"#,
            "renderChaptersBody(p, \"sheet-\")",
            "renderPictureBody(p, \"sheet-\")",
            "sheet-season-",
            "sheet-episode-",
            "class=\"volume-panel\"",
            "cast-menus",
        ] {
            assert!(served.contains(needle), "the served page carries {needle}");
        }

        // The five menu buttons are one row, and Volume is not one of them.
        let start = served
            .find("function renderCastMenus")
            .expect("the repertory card draws its menu row");
        let end = served[start..]
            .find("function renderCastBody")
            .map(|offset| start + offset)
            .expect("the menu row is followed by the card body");
        let menus = &served[start..end];
        assert_eq!(
            menus.matches("class=\"utility\"").count(),
            5,
            "the repertory card draws five menu buttons"
        );
        assert!(
            !menus.contains("volume-toggle"),
            "Volume is not one of the repertory menu buttons"
        );

        // The drawing order on the expanded card: title, timeline, transport,
        // Volume's box, then the five-menu row.
        for (selector, order) in [
            (".timeline", "order: 2;"),
            (".transport", "order: 3;"),
            (".volume-panel", "order: 4;"),
            (".cast-menus", "order: 5;"),
        ] {
            let rule = format!("{selector} {{");
            let start = served
                .find(&rule)
                .unwrap_or_else(|| panic!("the served page draws {selector}"));
            assert!(
                served[start..].contains(order),
                "{selector} carries {order} in its repertory rule"
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
    fn the_host_serves_every_face_the_token_sheet_names() {
        // #153: the sheet's `@font-face` rules are the only list of faces, and
        // the Host must answer every one of them. A URL the browser asks for
        // and the Host does not know is a page in a fallback face.
        let names = referenced_fonts(REPERTORY_TOKENS);
        assert_eq!(names.len(), 4, "the sheet names four faces: {names:?}");
        for expected in [
            "bodoni-moda-latin-wght-normal.woff2",
            "inter-latin-wght-normal.woff2",
            "ibm-plex-mono-latin-400-normal.woff2",
            "ibm-plex-mono-latin-500-normal.woff2",
        ] {
            assert!(names.contains(expected), "the sheet names {expected}");
        }

        for name in &names {
            let path = format!("/fonts/{name}");
            let bytes = font(&path).unwrap_or_else(|| panic!("the Host serves {path}"));
            assert!(
                bytes.starts_with(b"wOF2"),
                "{name} is served as a woff2 face, not something else"
            );
        }

        // The cut Playfair alternate is not a face this Host carries.
        assert!(font("/fonts/playfair-display-latin-wght-normal.woff2").is_none());
        assert!(font("/fonts/").is_none());
        assert!(font("/elsewhere/inter-latin-wght-normal.woff2").is_none());
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
        assert!(served.contains("--rep-ink:"), "the palette was spliced");
    }

    #[test]
    fn the_template_holds_no_local_palette() {
        // `src/shell/repertory/tokens.css` is the single source of truth: the
        // template names the splice marker instead of keeping a second copy of
        // the values.
        assert!(
            !TEMPLATE.contains(":root"),
            "the template has no local :root block"
        );
        assert!(
            !TEMPLATE.contains("--rep-ink:"),
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
            "timelineFraction(at, p.duration)",
            "function livePosition(p)",
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
            "const PREVIEW_BUCKET_SECONDS = 5",
            "function previewStreamKey(p)",
            "const stream = previewStreamKey(p)",
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
