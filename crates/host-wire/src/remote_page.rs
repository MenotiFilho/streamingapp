//! The served Remote: the built client, embedded and answered at `/`.
//!
//! The page travels with the binary (ADR-0017 §2, ADR-0035 §3): `remote.html`
//! and the hashed assets beside it are built by `pnpm build:remote`, committed,
//! and compiled in as one directory. Nothing is built at serve time and no
//! asset comes from a network.
//!
//! Four routes, and no fifth. `/` and `/index.html` answer with the built
//! document, `no-store` so a new Host is a new page; `/assets/<name>` is one
//! hashed asset, served `immutable` because its URL names its contents; every
//! path under the retired `/next` prefix — `/next`, `/next/`, an old asset URL,
//! or anything else that begins with it — is one `308 Permanent Redirect` to
//! `/`, never a second document; and everything else, including the build's
//! own metadata, `/favicon.ico` and the document by its file name, is a 404.
//! The token sheet's `/fonts/*` faces are the Host's own route and are answered
//! before this table by [`crate::remote`].

use std::io;
use std::net::TcpStream;

use include_dir::{include_dir, Dir};

use crate::http::{self, Request};
use crate::remote;

/// The built client, as `pnpm build:remote` wrote it.
static REMOTE: Dir<'static> = include_dir!("$CARGO_MANIFEST_DIR/remote");

/// The document the `/` route answers with.
const DOCUMENT: &str = "remote.html";
/// The build's capability list: compiled in, never served.
const BUILD_INFO: &str = "build-info.json";
/// The bundled dependencies' notices: compiled in, never served.
const LICENSES: &str = "licenses.md";

/// What one path asks for.
#[derive(Debug, PartialEq, Eq)]
enum Route<'a> {
    /// `/` or `/index.html` — the built document.
    Document,
    /// `/assets/<name>` — one hashed asset, by its name.
    Asset(&'a str),
    /// A path under the retired `/next` prefix.
    Redirect,
    /// Anything else, including the build's metadata.
    NotFound,
}

/// The route decision, as a function of the path alone.
///
/// A query has already been dropped by [`Request::parse`], so this is the whole
/// of what a request can mean. A name that could leave the embedded directory
/// is not a name this Host serves, even though the directory lookup would
/// refuse it anyway.
fn route(path: &str) -> Route<'_> {
    if path == "/" || path == "/index.html" {
        return Route::Document;
    }
    if path == "/next" || path.starts_with("/next/") {
        return Route::Redirect;
    }
    if path == BUILD_INFO || path == LICENSES || path == DOCUMENT {
        return Route::NotFound;
    }
    let Some(name) = path.strip_prefix("/assets/") else {
        return Route::NotFound;
    };
    if name.is_empty() || name.contains('/') || name.contains("..") {
        return Route::NotFound;
    }
    Route::Asset(name)
}

/// The content type of one asset, by the extension its build gave it.
fn content_type(name: &str) -> &'static str {
    match name.rsplit_once('.').map(|(_, extension)| extension) {
        Some("js") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("html") => "text/html; charset=utf-8",
        Some("json" | "map") => "application/json",
        Some("svg") => "image/svg+xml",
        Some("woff2") => "font/woff2",
        Some("woff") => "font/woff",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("ico") => "image/x-icon",
        _ => "application/octet-stream",
    }
}

/// Answer one request that is not a WebSocket upgrade.
pub(crate) fn serve(stream: &mut TcpStream, request: &Request) -> io::Result<()> {
    // The token sheet's `@font-face` rules name these files by absolute path.
    // They are the Host's route, not the page's, so they are answered before
    // the table below, which knows only the page's own paths.
    if request.method == "GET" {
        if let Some(bytes) = remote::font(&request.path) {
            // A face's URL does not name its contents, so it keeps the bounded
            // cache rather than the immutable one.
            return http::write_asset(stream, "font/woff2", bytes);
        }
    }

    match route(&request.path) {
        Route::Document if request.method == "GET" => match REMOTE.get_file(DOCUMENT) {
            Some(document) => http::write_document(
                stream,
                "200 OK",
                "text/html; charset=utf-8",
                document.contents(),
            ),
            None => remote::not_found(stream),
        },
        Route::Asset(name) if request.method == "GET" => {
            match REMOTE.get_file(format!("assets/{name}")) {
                Some(asset) => {
                    http::write_immutable_asset(stream, content_type(name), asset.contents())
                }
                None => remote::not_found(stream),
            }
        }
        Route::Redirect => http::write_permanent_redirect(stream, "/"),
        _ => remote::not_found(stream),
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use super::{content_type, route, Route, BUILD_INFO, DOCUMENT, LICENSES, REMOTE};

    /// The asset names the built document asks for, in the order it names them.
    fn document_assets() -> Vec<String> {
        let document = REMOTE
            .get_file(DOCUMENT)
            .expect("the artifact carries the document");
        let text = std::str::from_utf8(document.contents()).expect("the document is UTF-8");

        let mut names = Vec::new();
        let mut rest = text;
        while let Some(start) = rest.find("/assets/") {
            let after = &rest[start + "/assets/".len()..];
            let end = after
                .find(['"', '?', '#'])
                .expect("an asset URL is quoted or carries a query");
            names.push(after[..end].to_owned());
            rest = &after[end..];
        }
        names
    }

    #[test]
    fn the_build_info_names_the_whole_action_surface_at_the_wire_version() {
        // ADR-0035 §3: the artifact's capability list is the Action surface,
        // read by a Rust test rather than trusted. A capability added on one side
        // cannot pass this.
        let file = REMOTE
            .get_file(BUILD_INFO)
            .expect("the artifact carries its build-info.json");
        let info: serde_json::Value =
            serde_json::from_slice(file.contents()).expect("build-info.json is JSON");

        assert_eq!(
            info["wireVersion"].as_u64(),
            Some(u64::from(host_core::ACTION_VERSION)),
            "the build speaks the Host's wire version"
        );

        let listed = info["actions"]
            .as_array()
            .expect("build-info.json carries the Action spellings");
        let declared: BTreeSet<&str> = listed
            .iter()
            .map(|action| action.as_str().expect("an Action spelling is a string"))
            .collect();
        let surface: BTreeSet<&str> = host_core::Action::SPELLINGS.iter().copied().collect();

        assert_eq!(
            declared.len(),
            listed.len(),
            "the list names every Action once"
        );
        assert_eq!(
            declared, surface,
            "the Remote's capability list is the Action surface, exactly"
        );
    }

    #[test]
    fn the_document_is_the_entry_and_every_asset_it_names_is_embedded() {
        let assets = document_assets();
        assert!(
            !assets.is_empty(),
            "the document names the bundle it loads: {assets:?}"
        );
        for name in assets {
            assert!(
                REMOTE.get_file(format!("assets/{name}")).is_some(),
                "the artifact carries assets/{name}"
            );
        }
    }

    #[test]
    fn the_builds_metadata_is_embedded_and_not_a_route() {
        // The capability list and the notices travel with the binary — one is
        // read by this suite, the other is for a reader of the tree — and a
        // client that asks for either is answered with nothing.
        assert!(REMOTE.get_file(BUILD_INFO).is_some());
        assert!(REMOTE.get_file(LICENSES).is_some());
        assert_eq!(route("/build-info.json"), Route::NotFound);
        assert_eq!(route("/licenses.md"), Route::NotFound);
    }

    #[test]
    fn the_route_table_has_exactly_four_answers() {
        // The document, at the bare host and at the name a browser may append.
        assert_eq!(route("/"), Route::Document);
        assert_eq!(route("/index.html"), Route::Document);

        // One hashed asset, by its name.
        assert_eq!(
            route("/assets/remote-abc123.js"),
            Route::Asset("remote-abc123.js")
        );

        // The retired staging route, in every spelling a bookmark may hold:
        // the bare route, its document, and an asset URL from a tab that was
        // open before the cutover all land on `/`.
        for path in [
            "/next",
            "/next/",
            "/next/assets/remote-abc123.js",
            "/next/anything",
        ] {
            assert_eq!(route(path), Route::Redirect, "{path} is the retired prefix");
        }
        // A neighbouring name is not the retired route, and is not served.
        assert_eq!(route("/nextish"), Route::NotFound);

        // A path this module does not answer is not a path it serves: the
        // build's metadata, the document by its file name, the browser's
        // favicon, a bare assets directory, a nested name, a traversal and an
        // unknown path are all 404s.
        for path in [
            "/build-info.json",
            "/licenses.md",
            "/remote.html",
            "/favicon.ico",
            "/assets/",
            "/assets/nested/remote.js",
            "/assets/../remote.html",
            "/anything",
        ] {
            assert_eq!(route(path), Route::NotFound, "{path} is not a route");
        }
    }

    #[test]
    fn an_asset_is_typed_by_the_extension_its_build_gave_it() {
        assert_eq!(
            content_type("remote-abc123.js"),
            "text/javascript; charset=utf-8"
        );
        assert_eq!(content_type("remote-abc123.css"), "text/css; charset=utf-8");
        assert_eq!(content_type("logo-abc123.svg"), "image/svg+xml");
        assert_eq!(content_type("face-abc123.woff2"), "font/woff2");
        assert_eq!(
            content_type("something-abc123.bin"),
            "application/octet-stream"
        );
    }
}
