//! The little HTTP that sits under the WebSocket: one port, two answers.
//!
//! A browser on another device has one address to remember — `host:port` — and
//! what it wants from it depends on what it asked for. A plain `GET /` gets the
//! remote client's page; a `GET` carrying the WebSocket upgrade gets a `101` and
//! then frames. Doing the handshake here rather than leaving it to the framing
//! library is what lets both live on the same port, which is what makes manual
//! `host:port` a single thing to type (#31).
//!
//! The head is read a byte at a time, up to a limit, and stops at the blank line
//! that ends it. That is deliberately exact: nothing is read past the end of the
//! head, so the first WebSocket frame — should a client send one immediately —
//! is still in the socket for the framing layer to find.

use std::io::{self, Read, Write};
use std::net::TcpStream;

use base64::Engine as _;

/// The most a request head may be before the Host gives up on it. A head is a
/// request line and a handful of headers; a megabyte of them is not a client.
const MAX_HEAD: usize = 16 * 1024;

/// The magic string RFC 6455 has a server mix into the `Sec-WebSocket-Key` to
/// prove it understood the request rather than merely echoing it.
const WEBSOCKET_GUID: &str = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/// What a client asked for: enough to answer it, and nothing more.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Request {
    pub method: String,
    pub path: String,
    headers: Vec<(String, String)>,
}

impl Request {
    /// Parse a request head, or nothing when it is not one.
    pub fn parse(head: &str) -> Option<Self> {
        let mut lines = head.split("\r\n");
        let mut request_line = lines.next()?.split_whitespace();
        let method = request_line.next()?.to_owned();
        let target = request_line.next()?;
        // A target may carry a query the Host has no questions about; what is
        // answered is decided by the path alone.
        let path = target.split('?').next()?.to_owned();

        let mut headers = Vec::new();
        for line in lines {
            if line.is_empty() {
                break;
            }
            let (name, value) = line.split_once(':')?;
            headers.push((name.trim().to_ascii_lowercase(), value.trim().to_owned()));
        }

        Some(Self {
            method,
            path,
            headers,
        })
    }

    /// A header's value, by its lowercase name.
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(held, _)| held == name)
            .map(|(_, value)| value.as_str())
    }

    /// Whether this is a WebSocket upgrade, and so whether the connection is
    /// handed to the framing layer rather than answered with a page.
    pub fn is_websocket_upgrade(&self) -> bool {
        self.header("upgrade")
            .is_some_and(|value| value.eq_ignore_ascii_case("websocket"))
            && self
                .header("connection")
                .is_some_and(|value| value.to_ascii_lowercase().contains("upgrade"))
            && self.header("sec-websocket-key").is_some()
    }

    /// The `Sec-WebSocket-Accept` this request is owed, for a `101`.
    pub fn accept_key(&self) -> Option<String> {
        let key = self.header("sec-websocket-key")?;
        let accept = format!("{key}{WEBSOCKET_GUID}");
        let mut hasher = sha1::Sha1::new();
        use sha1::Digest as _;
        hasher.update(accept.as_bytes());
        Some(base64::engine::general_purpose::STANDARD.encode(hasher.finalize()))
    }
}

/// Read one request head off a stream, up to the blank line that ends it.
///
/// A byte at a time, so that nothing past the head is consumed: for an upgrade
/// the bytes after it belong to the framing layer.
pub fn read_head(stream: &mut TcpStream) -> io::Result<String> {
    let mut head = Vec::new();
    let mut byte = [0u8; 1];

    while !head.ends_with(b"\r\n\r\n") {
        if head.len() >= MAX_HEAD {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "the request head is longer than this Host will read",
            ));
        }
        match stream.read(&mut byte)? {
            0 => {
                return Err(io::Error::new(
                    io::ErrorKind::UnexpectedEof,
                    "the connection closed before the request head ended",
                ))
            }
            _ => head.push(byte[0]),
        }
    }

    String::from_utf8(head).map_err(|_| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            "the request head is not text this Host will read",
        )
    })
}

/// Answer the upgrade: the one response that turns this connection into a
/// WebSocket.
pub fn write_upgrade(stream: &mut TcpStream, accept: &str) -> io::Result<()> {
    let response = format!(
        "HTTP/1.1 101 Switching Protocols\r\n\
         Upgrade: websocket\r\n\
         Connection: Upgrade\r\n\
         Sec-WebSocket-Accept: {accept}\r\n\r\n"
    );
    stream.write_all(response.as_bytes())?;
    stream.flush()
}

/// Answer with one permanent redirect: a staged route retired after cutover.
pub fn write_permanent_redirect(stream: &mut TcpStream, location: &str) -> io::Result<()> {
    let head = format!(
        "HTTP/1.1 308 Permanent Redirect\r\n\
         Location: {location}\r\n\
         Content-Length: 0\r\n\
         Cache-Control: no-store\r\n\
         Connection: close\r\n\r\n"
    );
    stream.write_all(head.as_bytes())?;
    stream.flush()
}

/// Answer with one document: the remote client's page, or nothing at all.
pub fn write_document(
    stream: &mut TcpStream,
    status: &str,
    content_type: &str,
    body: &[u8],
) -> io::Result<()> {
    write_response(stream, status, content_type, "no-store", body)
}

/// Answer with one cacheable asset: a woff2 face the token sheet names.
///
/// The URL is not content-versioned, so a long `immutable` lifetime would keep
/// a stale face in a browser after a Host update. An hour is long enough to
/// spare a reload and short enough that an upgrade reaches the phone.
pub fn write_asset(stream: &mut TcpStream, content_type: &str, body: &[u8]) -> io::Result<()> {
    write_response(stream, "200 OK", content_type, "public, max-age=3600", body)
}

/// Answer with one permanently cacheable asset whose URL names its contents.
///
/// The served Remote's hashed bundle is what this answers (ADR-0035 §3): the
/// URL carries the content hash, so a new Host ships a new URL rather than a
/// stale cache, and the browser may keep the old one for good.
pub fn write_immutable_asset(
    stream: &mut TcpStream,
    content_type: &str,
    body: &[u8],
) -> io::Result<()> {
    write_response(
        stream,
        "200 OK",
        content_type,
        "public, max-age=31536000, immutable",
        body,
    )
}

fn write_response(
    stream: &mut TcpStream,
    status: &str,
    content_type: &str,
    cache_control: &str,
    body: &[u8],
) -> io::Result<()> {
    let head = format!(
        "HTTP/1.1 {status}\r\n\
         Content-Type: {content_type}\r\n\
         Content-Length: {}\r\n\
         Cache-Control: {cache_control}\r\n\
         Connection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(head.as_bytes())?;
    stream.write_all(body)?;
    stream.flush()
}

#[cfg(test)]
mod tests {
    use super::*;

    const UPGRADE: &str = "GET / HTTP/1.1\r\n\
         Host: 192.168.1.9:8090\r\n\
         Upgrade: websocket\r\n\
         Connection: Upgrade\r\n\
         Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\
         Sec-WebSocket-Version: 13\r\n\r\n";

    #[test]
    fn a_request_head_is_read_for_what_it_asks() {
        let request = Request::parse(UPGRADE).expect("a request head");

        assert_eq!(request.method, "GET");
        assert_eq!(request.path, "/");
        assert!(request.is_websocket_upgrade());
    }

    #[test]
    fn a_plain_get_is_not_an_upgrade() {
        let request =
            Request::parse("GET /index.html HTTP/1.1\r\nHost: x\r\n\r\n").expect("a request head");

        assert_eq!(request.path, "/index.html");
        assert!(!request.is_websocket_upgrade());
    }

    #[test]
    fn the_accept_key_is_the_one_rfc_6455_works_out() {
        // The example from RFC 6455 §1.3, so the mix is the protocol's and not
        // this Host's idea of one.
        let request = Request::parse(UPGRADE).expect("a request head");
        assert_eq!(
            request.accept_key().as_deref(),
            Some("s3pPLMBiTxaQ9kYGzzhZRbK+xOo=")
        );
    }

    #[test]
    fn a_target_carrying_a_query_is_answered_by_its_path() {
        let request =
            Request::parse("GET /?nothing=1 HTTP/1.1\r\nHost: x\r\n\r\n").expect("a request head");
        assert_eq!(request.path, "/");
    }

    #[test]
    fn a_head_that_is_not_a_request_is_not_parsed() {
        assert!(Request::parse("").is_none());
        assert!(Request::parse("nonsense\r\n\r\n").is_none());
    }

    #[test]
    fn a_versioned_asset_is_answered_as_immutable() {
        use std::io::Read as _;
        use std::net::{TcpListener, TcpStream};

        let listener = TcpListener::bind("127.0.0.1:0").expect("a loopback listener");
        let address = listener.local_addr().expect("the listener's address");
        let serving = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("one client");
            write_immutable_asset(&mut stream, "text/javascript; charset=utf-8", b"export{}")
                .expect("the asset is written");
        });

        let mut client = TcpStream::connect(address).expect("a loopback client");
        let mut response = String::new();
        client
            .read_to_string(&mut response)
            .expect("the response is read");
        serving.join().expect("the writer finished");

        assert!(response.starts_with("HTTP/1.1 200 OK\r\n"));
        assert!(response.contains("Cache-Control: public, max-age=31536000, immutable\r\n"));
        assert!(response.ends_with("\r\n\r\nexport{}"));
    }

    #[test]
    fn an_asset_is_answered_with_a_bounded_cache() {
        use std::io::Read as _;
        use std::net::{TcpListener, TcpStream};

        let listener = TcpListener::bind("127.0.0.1:0").expect("a loopback listener");
        let address = listener.local_addr().expect("the listener's address");
        let serving = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("one client");
            write_asset(&mut stream, "font/woff2", b"wOF2").expect("the asset is written");
        });

        let mut client = TcpStream::connect(address).expect("a loopback client");
        let mut response = String::new();
        client
            .read_to_string(&mut response)
            .expect("the response is read");
        serving.join().expect("the writer finished");

        assert!(response.starts_with("HTTP/1.1 200 OK\r\n"));
        assert!(response.contains("Content-Type: font/woff2\r\n"));
        assert!(response.contains("Cache-Control: public, max-age=3600\r\n"));
        assert!(response.ends_with("\r\n\r\nwOF2"));
    }
}
