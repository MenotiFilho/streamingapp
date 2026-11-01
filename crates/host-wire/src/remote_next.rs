//! The staged React Remote: the built client, served from `/next`.
//!
//! The page travels with the binary (ADR-0017 §2, ADR-0035 §3): `remote.html`
//! and the hashed assets beside it are built by `pnpm build:remote`, committed,
//! and compiled in as one directory. Nothing is built at serve time and no
//! asset comes from a network.
//!
//! Four routes, and no fifth: `/next` answers `308` to `/next/` so a bookmark
//! without the slash lands on the document; `/next/` is the document, served
//! `no-store` so a new Host is a new page; `/next/assets/<name>` is one hashed
//! asset, served `immutable` because its URL names its contents; and everything
//! else under `/next/` is a 404. The build's own metadata — `build-info.json`
//! and `licenses.md` — is compiled in beside the page and never served: one is
//! the capability list a test reads, the other is a notice for a reader of the
//! tree, and neither is a client asset.

use std::io;
use std::net::TcpStream;

use include_dir::{include_dir, Dir};

use crate::http::{self, Request};

/// The built client, as `pnpm build:remote` wrote it.
static REMOTE: Dir<'static> = include_dir!("$CARGO_MANIFEST_DIR/remote-next");

/// The document the `/next/` route answers with.
const DOCUMENT: &str = "remote.html";
/// The build's capability list: compiled in, never served.
const BUILD_INFO: &str = "build-info.json";
/// The bundled dependencies' notices: compiled in, never served.
const LICENSES: &str = "licenses.md";

/// What one path under `/next` asks for.
#[derive(Debug, PartialEq, Eq)]
enum Route<'a> {
    /// `/next` — the staging route without its trailing slash.
    Redirect,
    /// `/next/` — the built document.
    Document,
    /// `/next/assets/<name>` — one hashed asset, by its name.
    Asset(&'a str),
    /// Anything else, including the build's metadata.
    NotFound,
}

/// The route decision, as a function of the path alone.
///
/// A query has already been dropped by [`Request::parse`], so this is the whole
/// of what a request under the staging route can mean. A name that could leave
/// the embedded directory is not a name this Host serves, even though the
/// directory lookup would refuse it anyway.
fn route(path: &str) -> Route<'_> {
    if path == "/next" {
        return Route::Redirect;
    }
    let Some(rest) = path.strip_prefix("/next/") else {
        return Route::NotFound;
    };
    if rest.is_empty() {
        return Route::Document;
    }
    if rest == BUILD_INFO || rest == LICENSES {
        return Route::NotFound;
    }
    let Some(name) = rest.strip_prefix("assets/") else {
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

/// Answer one request under `/next`.
pub(crate) fn serve(stream: &mut TcpStream, request: &Request) -> io::Result<()> {
    match route(&request.path) {
        Route::Redirect => http::write_permanent_redirect(stream, "/next/"),
        Route::Document if request.method == "GET" => match REMOTE.get_file(DOCUMENT) {
            Some(document) => http::write_document(
                stream,
                "200 OK",
                "text/html; charset=utf-8",
                document.contents(),
            ),
            None => not_found(stream),
        },
        Route::Asset(name) if request.method == "GET" => {
            match REMOTE.get_file(format!("assets/{name}")) {
                Some(asset) => {
                    http::write_immutable_asset(stream, content_type(name), asset.contents())
                }
                None => not_found(stream),
            }
        }
        _ => not_found(stream),
    }
}

/// The one answer for a path this Host does not serve.
fn not_found(stream: &mut TcpStream) -> io::Result<()> {
    http::write_document(stream, "404 Not Found", "text/plain; charset=utf-8", b"")
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
        while let Some(start) = rest.find("/next/assets/") {
            let after = &rest[start + "/next/assets/".len()..];
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
        assert_eq!(route("/next/build-info.json"), Route::NotFound);
        assert_eq!(route("/next/licenses.md"), Route::NotFound);
    }

    #[test]
    fn the_staging_route_has_exactly_the_four_answers() {
        assert_eq!(route("/next"), Route::Redirect);
        assert_eq!(route("/next/"), Route::Document);
        assert_eq!(
            route("/next/assets/remote-abc123.js"),
            Route::Asset("remote-abc123.js")
        );

        // A path this module does not answer is not a path it serves: the
        // document by its file name, a bare assets directory, a nested name, a
        // traversal, a neighbouring prefix and the root are all 404s.
        for path in [
            "/next/index.html",
            "/next/assets/",
            "/next/assets/nested/remote.js",
            "/next/assets/../remote.html",
            "/nextish",
            "/next/anything",
            "/",
            "/index.html",
        ] {
            assert_eq!(route(path), Route::NotFound, "{path} is not a /next route");
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
