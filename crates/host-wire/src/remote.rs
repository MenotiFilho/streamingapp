//! The remote client the Host serves: one page, compiled in.
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
//! client is looking at moves nothing on another, and a bar over the browse
//! surface — not the disappearance of it — is where the one shared thing,
//! playback, is controlled.

use std::io;
use std::net::TcpStream;

use crate::http::{self, Request};

/// The page, as the Host ships it.
const INDEX: &str = include_str!("../remote/index.html");

/// Answer a request that is not an upgrade: the page, or nothing.
pub(crate) fn serve(stream: &mut TcpStream, request: &Request) -> io::Result<()> {
    match (request.method.as_str(), request.path.as_str()) {
        // The page is the whole client, so it is served for both the bare host
        // and the name a browser might append to it.
        ("GET", "/") | ("GET", "/index.html") => http::write_document(
            stream,
            "200 OK",
            "text/html; charset=utf-8",
            INDEX.as_bytes(),
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
    use std::collections::BTreeSet;

    use super::INDEX;

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

    #[test]
    fn the_remote_declares_the_whole_action_surface() {
        // The remote is the Host's own window's equal, not a curated subset
        // (ADR-0002). A capability added to the surface is one the remote is
        // held to here: the page's list must name every Action and no other, so
        // a control added for one client cannot go missing from the other (#32).
        let declared = declared_capabilities(INDEX);
        let surface: BTreeSet<&str> = host_core::Action::SPELLINGS.iter().copied().collect();

        let declared: BTreeSet<&str> = declared.iter().map(String::as_str).collect();
        assert_eq!(
            declared, surface,
            "the remote's capability list is the Action surface, exactly"
        );
    }
}
