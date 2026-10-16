//! The remote client the Host serves: one page, compiled in.
//!
//! A browser on another device has to load *something* before it can pair, and
//! the Host is the only thing that knows it exists, so the page travels with the
//! binary rather than from a build directory that may not be there (#31). It is
//! deliberately one self-contained document: what it does today is pair and show
//! what is playing, and the full parity remote is the ticket that grows it (#32).

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
