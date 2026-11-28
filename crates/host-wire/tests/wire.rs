//! The wire server, driven the way a remote client drives it: a real socket, a
//! real WebSocket handshake, real frames, over a real `Host`.
//!
//! Nothing below the Action surface is named: this is the second client's door,
//! and what it proves is that it is the same door (ADR-0002).

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use host_core::{
    Action, ActionError, AddonProvider, DeviceSummary, DeviceToken, FetchError, Fetcher,
    FixtureClock, FixtureFetcher, FixturePlayer, Host, HostDoor, InMemorySecretStore,
    InMemoryStore, Response, RevisionSink, Snapshot, WIRE_VERSION,
};
use host_wire::{Broadcast, Server, Surface, QUESTION_QUEUE, QUESTION_WORKERS};
use serde_json::{json, Value};
use tungstenite::stream::MaybeTlsStream;
use tungstenite::{connect, Message, WebSocket};

/// The Host, behind the same three methods the app shell implements — over the
/// real thing rather than a mock, so a frame that reaches the Host is a frame the
/// Host acted on.
struct Fixture {
    door: HostDoor,
    broadcast: Broadcast,
    clock: Arc<FixtureClock>,
}

impl Fixture {
    /// A Host over any [`Fetcher`], such as one that gates specific URLs.
    fn over(fetcher: Arc<dyn Fetcher>) -> Arc<Self> {
        let store = Arc::new(InMemoryStore::new());
        let clock = Arc::new(FixtureClock::new());
        let provider = Arc::new(AddonProvider::new(fetcher.clone()));
        let host = Host::new(
            store,
            fetcher,
            Arc::new(InMemorySecretStore::new()),
            provider,
            Arc::new(FixturePlayer::new()),
            clock.clone(),
        )
        .expect("a Host over in-memory seams starts");

        Arc::new(Self {
            door: HostDoor::new(host),
            broadcast: Broadcast::new(),
            clock,
        })
    }

    /// The code the Host is showing, which a client redeems.
    fn code(&self) -> String {
        self.door.snapshot().pairing_code.as_str().to_owned()
    }

    /// A change the Host made on its own — a clock tick, or another client:
    /// publishing it is what the shell's `publish` does beside emitting it.
    fn publish_change(&self, action: Action) -> Response {
        self.dispatch(action, Arc::new(Unrevised))
            .expect("the Host takes this change")
    }
}

/// A sink no test expects a revision on: a change never revises anything.
struct Unrevised;

impl RevisionSink for Unrevised {
    fn revise(&self, _answer: host_core::Answer) {}
}

impl Surface for Fixture {
    fn dispatch(
        &self,
        action: Action,
        revisions: Arc<dyn RevisionSink>,
    ) -> Result<Response, ActionError> {
        let response = self.door.dispatch_asking(action, Some(revisions))?;
        for snapshot in &response.snapshots {
            self.broadcast.publish(snapshot);
        }
        Ok(response)
    }

    fn device(&self, token: &DeviceToken) -> Option<DeviceSummary> {
        self.door.device(token)
    }

    fn snapshot(&self) -> Snapshot {
        self.door.snapshot()
    }
}

fn server() -> (Arc<Fixture>, Server) {
    server_over(Arc::new(FixtureFetcher::new()))
}

fn server_over(fetcher: Arc<FixtureFetcher>) -> (Arc<Fixture>, Server) {
    server_over_fetcher(fetcher)
}

fn server_over_fetcher(fetcher: Arc<dyn Fetcher>) -> (Arc<Fixture>, Server) {
    let fixture = Fixture::over(fetcher);
    let server = Server::start(
        fixture.clone(),
        fixture.broadcast.clone(),
        "127.0.0.1:0".parse().expect("a loopback address"),
    )
    .expect("the Host can bind a loopback port");
    (fixture, server)
}

fn action(body: &str) -> Action {
    let envelope = format!(r#"{{"version":{WIRE_VERSION},"action":{body}}}"#);
    Action::parse(&envelope).unwrap_or_else(|error| panic!("{envelope} should parse: {error}"))
}

/// A stale Title's refresh test: an Addon that answers one film, and a copy of
/// it that is later read again with a changed name.
const MANIFEST_URL: &str = "https://v3-cinemeta.strem.io/manifest.json";
const MOVIE_URL: &str = "https://v3-cinemeta.strem.io/meta/movie/tt0133093.json";
const MANIFEST: &str = r#"{"id":"com.linvo.cinemeta","version":"3.0.14","name":"Cinemeta","resources":["meta"],"types":["movie"],"catalogs":[],"idPrefixes":["tt"]}"#;
const MOVIE: &str = r#"{"meta":{"id":"tt0133093","type":"movie","name":"The Matrix"}}"#;
const MOVIE_CHANGED: &str =
    r#"{"meta":{"id":"tt0133093","type":"movie","name":"The Matrix Resurrections"}}"#;
/// Past a film's thirty days of freshness.
const STALE_AFTER: i64 = 30 * 24 * 60 * 60 * 1000 + 1;

fn open_movie() -> Value {
    json!({
        "type": "open_title",
        "addon": "com.linvo.cinemeta",
        "title": { "type": "movie", "id": "tt0133093" },
    })
}

/// One plain GET over a real socket, split into its head and its body.
fn get(server: &Server, path: &str) -> (String, Vec<u8>) {
    let mut stream = TcpStream::connect(server.address()).expect("the Host is listening");
    stream
        .write_all(
            format!("GET {path} HTTP/1.1\r\nHost: host\r\nConnection: close\r\n\r\n").as_bytes(),
        )
        .expect("the request is sent");
    let mut response = Vec::new();
    stream
        .read_to_end(&mut response)
        .expect("the Host answers and closes");
    let split = response
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .expect("the response has a head and a body")
        + 4;
    let (head, body) = response.split_at(split);
    (
        String::from_utf8(head.to_vec()).expect("the head is text"),
        body.to_vec(),
    )
}

/// A client, as one really is: a WebSocket over a socket, with a read timeout so
/// a Host that has stopped answering fails the test rather than hanging it.
struct Client {
    socket: WebSocket<MaybeTlsStream<TcpStream>>,
}

impl Client {
    fn connect(server: &Server) -> Self {
        let url = format!("ws://{}/", server.address());
        let (socket, _) = connect(&url).expect("the Host accepts a WebSocket");
        if let MaybeTlsStream::Plain(stream) = socket.get_ref() {
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .expect("the test client can be given a read timeout");
        }
        Self { socket }
    }

    fn send(&mut self, frame: Value) {
        self.socket
            .send(Message::Text(frame.to_string().into()))
            .expect("the Host is listening");
    }

    /// The next frame, or a failure rather than a hang.
    fn read(&mut self) -> Option<Value> {
        loop {
            match self.socket.read() {
                Ok(Message::Text(text)) => {
                    return Some(serde_json::from_str(&text).expect("the Host writes JSON"));
                }
                Ok(Message::Close(_)) | Err(_) => return None,
                Ok(_) => continue,
            }
        }
    }

    /// The next frame, which the Host must send.
    fn next(&mut self) -> Value {
        self.read().expect("the Host is still answering")
    }

    /// Greet the Host, and hand back what it said this connection is.
    fn hello(&mut self, token: Option<&DeviceToken>) -> Value {
        self.send(json!({ "version": WIRE_VERSION, "hello": { "token": token } }));
        self.next()
    }

    /// Take a command, and read until the frame correlated to it: the Snapshots
    /// the Host pushes in between are not this command's answer.
    fn command(&mut self, id: u64, command: Value) -> Value {
        self.send(json!({ "version": WIRE_VERSION, "id": id, "command": command }));
        loop {
            let frame = self.next();
            if frame.get("id").and_then(Value::as_u64) == Some(id) {
                return frame;
            }
        }
    }

    /// The next pushed Snapshot, skipping anything else.
    fn next_snapshot(&mut self) -> Value {
        loop {
            let frame = self.next();
            if frame.get("snapshot").is_some() {
                return frame;
            }
        }
    }

    /// The next pushed Snapshot that says what the test is waiting for.
    ///
    /// A connection has Snapshots queued from before the one a test cares about —
    /// the one its own pairing published, at least — so "the next one" is not
    /// "the one this change produced".
    fn snapshot_where(&mut self, predicate: impl Fn(&Value) -> bool) -> Value {
        for _ in 0..20 {
            let frame = self.next();
            if let Some(snapshot) = frame.get("snapshot") {
                if predicate(snapshot) {
                    return frame;
                }
            }
        }
        panic!("no Snapshot the test was waiting for arrived");
    }
    /// The next revised Answer pushed to this connection, skipping anything
    /// else the Host sent in between.
    fn next_revision(&mut self) -> Value {
        for _ in 0..20 {
            let frame = self.next();
            if frame.get("revision").is_some() {
                return frame;
            }
        }
        panic!("no revised Answer arrived");
    }

    /// Whether no frame arrives within `wait`.
    ///
    /// The socket is read with that timeout and a timeout is the only quiet
    /// answer: a frame, or a close, is not quiet.
    fn quiet(&mut self, wait: Duration) -> bool {
        let MaybeTlsStream::Plain(stream) = self.socket.get_ref() else {
            return false;
        };
        let stream = stream.try_clone().expect("the socket can be measured");
        let held = stream
            .read_timeout()
            .expect("the socket has a read timeout");
        stream
            .set_read_timeout(Some(wait))
            .expect("the socket can be given a short wait");

        let quiet = matches!(
            self.socket.read(),
            Err(tungstenite::Error::Io(error))
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                )
        );

        stream
            .set_read_timeout(held)
            .expect("the socket leaves with the timeout it had");
        quiet
    }
}

/// Pair `client` with the code the Host is showing, and hand back the device it
/// was paired as and the token it answered with.
fn pair(client: &mut Client, fixture: &Fixture, name: &str) -> (DeviceSummary, DeviceToken) {
    let code = fixture.code();
    let frame = client.command(
        2,
        json!({ "type": "pair_device", "code": code, "name": name }),
    );

    let paired = &frame["response"]["answer"]["paired"];
    let device: DeviceSummary =
        serde_json::from_value(paired["device"].clone()).expect("the pairing names the device");
    let token = DeviceToken::parse(
        paired["token"]
            .as_str()
            .expect("the pairing issues a token"),
    )
    .expect("the token is one a device could hold");
    (device, token)
}

#[test]
fn the_root_serves_the_built_remote_document_without_a_cache() {
    // The cutover (ADR-0035 §5): `/` is the React Remote's built document, and
    // the document is never cached — a new Host ships a new page, and the
    // hashed assets beside it are the ones that may be kept.
    let (_fixture, server) = server();
    let (head, body) = get(&server, "/");

    assert!(
        head.starts_with("HTTP/1.1 200 OK"),
        "the page is served: {head}"
    );
    assert!(head.contains("Content-Type: text/html; charset=utf-8\r\n"));
    assert!(head.contains("Cache-Control: no-store\r\n"));

    let document = String::from_utf8(body).expect("the document is text");
    assert!(
        document.starts_with("<!doctype html>"),
        "the root document is the built page: {document}"
    );
    assert!(
        !document_assets(&document).is_empty(),
        "the document names the bundle it loads"
    );

    // The name a browser may append is the same document, not a second page.
    let (index_head, index_body) = get(&server, "/index.html");
    assert!(index_head.starts_with("HTTP/1.1 200 OK"));
    assert_eq!(
        index_body.as_slice(),
        document.as_bytes(),
        "/index.html is the document by its other name"
    );
}

/// The `/assets/<name>` URLs a document names, in the order it names them.
fn document_assets(document: &str) -> Vec<String> {
    let mut names = Vec::new();
    let mut rest = document;
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
fn the_retired_staging_prefix_is_one_permanent_redirect_to_the_root() {
    // `/next` was the staged Remote's route until the cutover. Every spelling
    // of it — the bare route, the document, an old asset URL — is one permanent
    // redirect to `/`, never a second document. A neighbouring name is not the
    // retired route and is answered as nothing.
    let (_fixture, server) = server();

    for path in [
        "/next",
        "/next/",
        "/next/assets/remote-abc123.js",
        "/next/anything",
    ] {
        let (head, body) = get(&server, path);
        assert!(
            head.starts_with("HTTP/1.1 308 Permanent Redirect"),
            "{path} redirects: {head}"
        );
        assert!(
            head.contains("Location: /\r\n"),
            "{path} redirects to the root: {head}"
        );
        assert!(body.is_empty(), "a 308 redirect carries no body");
    }

    let (head, body) = get(&server, "/nextish");
    assert!(
        head.starts_with("HTTP/1.1 404 Not Found"),
        "a neighbouring name is not the retired route: {head}"
    );
    assert!(body.is_empty());
}

#[test]
fn the_remotes_assets_are_served_immutably() {
    // Every asset the document names is embedded, and its URL names its
    // contents, so the browser may keep it for good.
    let (_fixture, server) = server();
    let (_, body) = get(&server, "/");
    let document = String::from_utf8(body).expect("the document is text");

    for name in document_assets(&document) {
        let (head, body) = get(&server, &format!("/assets/{name}"));

        assert!(
            head.starts_with("HTTP/1.1 200 OK"),
            "assets/{name} is served: {head}"
        );
        assert!(
            head.contains("Cache-Control: public, max-age=31536000, immutable\r\n"),
            "assets/{name} is immutable: {head}"
        );
        assert!(!body.is_empty(), "assets/{name} has its bytes");
        if name.ends_with(".js") {
            assert!(
                head.contains("Content-Type: text/javascript; charset=utf-8\r\n"),
                "a script is served as a script: {head}"
            );
        }
        if name.ends_with(".css") {
            assert!(
                head.contains("Content-Type: text/css; charset=utf-8\r\n"),
                "a stylesheet is served as a stylesheet: {head}"
            );
        }
    }
}

#[test]
fn the_remotes_metadata_and_every_unknown_path_is_a_404() {
    // The capability list and the bundled notices travel with the binary, and
    // neither is a client asset. The document by its build name, the browser's
    // favicon and a name the artifact does not hold are refused the same way.
    let (_fixture, server) = server();

    for path in [
        "/build-info.json",
        "/licenses.md",
        "/remote.html",
        "/favicon.ico",
        "/assets/missing-abc123.js",
        "/anything",
    ] {
        let (head, body) = get(&server, path);
        assert!(
            head.starts_with("HTTP/1.1 404 Not Found"),
            "{path} is not a route: {head}"
        );
        assert!(body.is_empty(), "{path} carries no body");
    }
}

#[test]
fn the_vendored_motion_route_is_gone() {
    // ADR-0035 §4: the hand-written page's pinned Motion asset is deleted at
    // the cutover, and its route dies with it rather than being left as a
    // second copy.
    let (_fixture, server) = server();
    let (head, body) = get(&server, "/motion-14.7.1.js");

    assert!(
        head.starts_with("HTTP/1.1 404 Not Found"),
        "the vendored bundle is not a route: {head}"
    );
    assert!(body.is_empty());
}

#[test]
fn the_host_serves_the_fonts_the_page_asks_for() {
    // #153: the token sheet the page imports names its faces by absolute
    // `/fonts/<name>` path, so the Host has to answer those bytes itself. The
    // body is a woff2 face, not a page and not a 404.
    let (_fixture, server) = server();

    for name in [
        "figtree-latin-wght-normal.woff2",
        "figtree-latin-ext-wght-normal.woff2",
    ] {
        let (head, body) = get(&server, &format!("/fonts/{name}"));
        assert!(
            head.starts_with("HTTP/1.1 200 OK"),
            "/fonts/{name} is served: {head}"
        );
        assert!(head.contains("Content-Type: font/woff2\r\n"));
        assert!(head.contains("Cache-Control: public, max-age=3600\r\n"));
        assert!(
            body.starts_with(b"wOF2"),
            "the body is the woff2 face: {name}"
        );
    }

    let (head, body) = get(&server, "/fonts/not-a-face.woff2");
    assert!(
        head.starts_with("HTTP/1.1 404 Not Found"),
        "a name the sheet does not carry is not a face: {head}"
    );
    assert!(body.is_empty());
}

#[test]
fn a_connection_that_has_not_paired_can_only_attempt_to_pair() {
    let (fixture, server) = server();
    let mut client = Client::connect(&server);

    let welcome = client.hello(None);
    assert_eq!(
        welcome["welcome"]["device"],
        Value::Null,
        "a first connect is told it has not paired"
    );

    let refused = client.command(1, json!({ "type": "stop_playback" }));
    assert_eq!(
        refused["error"]["kind"], "unpaired",
        "an open port is not a playback remote for whoever finds it"
    );

    // The pairing exchange is reachable, and reaches nothing else.
    let (_device, token) = pair(&mut client, &fixture, "Test phone");
    assert_eq!(token.as_str().len(), 43);

    // With the token adopted, an ordinary Action is taken rather than refused.
    let answered = client.command(
        3,
        json!({ "type": "set_subtitle_languages", "languages": ["pt-BR"] }),
    );
    assert!(
        answered.get("response").is_some(),
        "a paired client is answered: {answered}"
    );
}

#[test]
fn the_language_lists_cross_the_wire_whole_and_the_old_actions_are_refused_as_unknown() {
    let (fixture, server) = server();
    let mut client = Client::connect(&server);
    client.hello(None);
    pair(&mut client, &fixture, "Test phone");
    let _joined = client.next_snapshot();

    // Both lists are set by their Actions and published in the Snapshot.
    let answered = client.command(
        3,
        json!({ "type": "set_subtitle_languages", "languages": ["pt-BR", "en"] }),
    );
    assert!(answered.get("response").is_some(), "{answered}");
    let answered = client.command(
        4,
        json!({ "type": "set_audio_languages", "languages": ["fr"] }),
    );
    assert!(answered.get("response").is_some(), "{answered}");
    let pushed = client
        .snapshot_where(|snapshot| snapshot["preferences"]["audioLanguages"] == json!(["fr"]));
    assert_eq!(
        pushed["snapshot"]["preferences"]["subtitleLanguages"],
        json!(["pt-BR", "en"])
    );
    assert!(
        pushed["snapshot"]["preferences"]
            .get("subtitleLanguage")
            .is_none(),
        "the single language is gone from the Snapshot"
    );

    // A list the Host refuses is refused by what is wrong with it.
    for (languages, kind) in [
        (json!(["en", "fr", "de", "es"]), "too_many_languages"),
        (json!(["en", "EN"]), "duplicate_language"),
        (json!(["not a tag"]), "invalid_language"),
    ] {
        let refused = client.command(
            5,
            json!({ "type": "set_audio_languages", "languages": languages }),
        );
        assert_eq!(refused["error"]["kind"], kind, "{refused}");
    }

    // The removed Actions get the codec's ordinary refusal for an unknown one.
    for removed in [
        json!({ "type": "set_subtitle_language", "language": "pt-BR" }),
        json!({ "type": "clear_subtitle_language" }),
    ] {
        let refused = client.command(6, removed);
        assert_eq!(refused["error"]["kind"], "malformed", "{refused}");
    }
}

#[test]
fn a_paired_client_sees_state_change_without_asking_for_it() {
    let (fixture, server) = server();
    let mut client = Client::connect(&server);
    client.hello(None);
    pair(&mut client, &fixture, "Test phone");
    // The Snapshot the pairing published, pushed to the device that joined.
    let joined = client.next_snapshot();
    assert_eq!(joined["snapshot"]["devices"][0]["name"], "Test phone");

    // Somebody else moved the state — here the Host itself, as its clock does.
    fixture.publish_change(action(
        r#"{"type":"set_subtitle_languages","languages":["pt-BR"]}"#,
    ));

    let pushed = client.next_snapshot();
    assert_eq!(
        pushed["snapshot"]["preferences"]["subtitleLanguages"],
        json!(["pt-BR"]),
        "state arrives pushed, not polled: {pushed}"
    );
}

#[test]
fn a_look_hint_is_a_fire_and_forget_command_that_reads_ahead() {
    let fetcher = Arc::new(
        FixtureFetcher::new()
            .serving(MANIFEST_URL, MANIFEST)
            .serving(MOVIE_URL, MOVIE),
    );
    let (fixture, server) = server_over(fetcher.clone());
    fixture.publish_change(action(&format!(
        r#"{{"type":"add_addon","url":"{MANIFEST_URL}"}}"#
    )));

    let mut client = Client::connect(&server);
    client.hello(None);
    pair(&mut client, &fixture, "Phone");
    let revision = fixture.door.snapshot().revision;

    let reply = client.command(
        3,
        json!({
            "type": "look_hint",
            "addon": "com.linvo.cinemeta",
            "title": { "type": "movie", "id": "tt0133093" },
        }),
    );
    assert_eq!(
        reply["response"]["snapshots"],
        json!([]),
        "a hint publishes no Snapshot: {reply}"
    );
    assert!(
        reply["response"]["answer"].is_null(),
        "a hint answers nothing: {reply}"
    );
    assert_eq!(
        fixture.door.snapshot().revision,
        revision,
        "a hint moves no revision"
    );
    assert_eq!(
        fetcher
            .asked()
            .iter()
            .filter(|url| *url == MOVIE_URL)
            .count(),
        0,
        "the hint queued the read rather than making it"
    );

    assert_eq!(fixture.door.drain().ran, 1);
    let opened = client.command(4, open_movie());
    assert_eq!(
        opened["response"]["answer"]["title"]["name"], "The Matrix",
        "the Title the hint read ahead opens: {opened}"
    );
    assert_eq!(
        fetcher
            .asked()
            .iter()
            .filter(|url| *url == MOVIE_URL)
            .count(),
        1,
        "the open after the read-ahead fetched nothing: {:?}",
        fetcher.asked()
    );
}

#[test]
fn a_revised_title_goes_to_the_asking_device_and_no_other() {
    let fetcher = Arc::new(
        FixtureFetcher::new()
            .serving(MANIFEST_URL, MANIFEST)
            .serving(MOVIE_URL, MOVIE),
    );
    let (fixture, server) = server_over(fetcher.clone());

    // The Addon is configured before the second device connects, so the only
    // Snapshot that device is owed is the state its own pairing publishes.
    let mut asker = Client::connect(&server);
    asker.hello(None);
    pair(&mut asker, &fixture, "Phone");
    asker.command(3, json!({ "type": "add_addon", "url": MANIFEST_URL }));

    let mut bystander = Client::connect(&server);
    bystander.hello(None);
    pair(&mut bystander, &fixture, "Tablet");
    let _joined = bystander.next_snapshot();

    let first = asker.command(4, open_movie());
    assert_eq!(
        first["response"]["answer"]["title"]["name"], "The Matrix",
        "the first open answers the source's copy"
    );

    fixture.clock.tick(STALE_AFTER);
    fetcher.update(MOVIE_URL, Ok(MOVIE_CHANGED.to_owned()));

    let stale = asker.command(5, open_movie());
    assert_eq!(
        stale["response"]["answer"]["title"]["name"], "The Matrix",
        "a stale Title is answered from the cache at once"
    );
    assert_eq!(
        fetcher
            .asked()
            .iter()
            .filter(|url| *url == MOVIE_URL)
            .count(),
        1,
        "and the wire client waited on no fetch"
    );

    assert_eq!(fixture.door.drain().ran, 1);

    let revision = asker.next_revision();
    assert_eq!(
        revision["revision"]["revision"]["name"], "The Matrix Resurrections",
        "the revised Answer arrives on the asking device's socket: {revision}"
    );
    assert!(
        bystander.quiet(Duration::from_millis(300)),
        "a device that did not ask hears nothing"
    );
}

#[test]
fn a_reply_is_an_answer_and_not_a_second_copy_of_state() {
    let (fixture, server) = server();
    let mut client = Client::connect(&server);
    client.hello(None);
    pair(&mut client, &fixture, "Test phone");
    let _joined = client.next_snapshot();

    let reply = client.command(
        3,
        json!({ "type": "set_subtitle_languages", "languages": ["pt-BR"] }),
    );
    assert_eq!(
        reply["response"]["snapshots"],
        json!([]),
        "the reply carries the answer; state arrives as a pushed Snapshot"
    );
    let pushed = client.snapshot_where(|snapshot| {
        snapshot["preferences"]["subtitleLanguages"] == json!(["pt-BR"])
    });
    assert_eq!(
        pushed["snapshot"]["preferences"]["subtitleScale"], 1.0,
        "the pushed Snapshot is the one state the client applies: {pushed}"
    );
}

#[test]
fn a_paired_client_sets_the_subtitle_appearance_and_sees_the_hosts_values() {
    let (fixture, server) = server();
    let mut client = Client::connect(&server);
    client.hello(None);
    pair(&mut client, &fixture, "Test phone");

    let colored = client.command(
        3,
        json!({ "type": "set_subtitle_color", "color": "#00ffff" }),
    );
    assert!(
        colored.get("response").is_some(),
        "the Remote can change the colour: {colored}"
    );
    let pushed =
        client.snapshot_where(|snapshot| snapshot["preferences"]["subtitleColor"] == "#00FFFF");
    assert_eq!(
        pushed["snapshot"]["preferences"]["subtitleScale"], 1.0,
        "the size arrives beside the colour, as the Host holds it: {pushed}"
    );

    let scaled = client.command(4, json!({ "type": "set_subtitle_scale", "scale": 1.5 }));
    assert!(
        scaled.get("response").is_some(),
        "the Remote can change the size: {scaled}"
    );
    let pushed = client.snapshot_where(|snapshot| snapshot["preferences"]["subtitleScale"] == 1.5);
    assert_eq!(
        pushed["snapshot"]["preferences"]["subtitleColor"], "#00FFFF",
        "the colour is still the one the Remote chose: {pushed}"
    );

    for bound in [0.25, 3.0] {
        let reply = client.command(5, json!({ "type": "set_subtitle_scale", "scale": bound }));
        assert!(
            reply.get("response").is_some(),
            "the Remote can set the widened bound {bound}: {reply}"
        );
        client.snapshot_where(|snapshot| snapshot["preferences"]["subtitleScale"] == bound);
    }
}

#[test]
fn a_paired_client_can_switch_streams_over_the_wire() {
    let (fixture, server) = server();
    let mut client = Client::connect(&server);
    client.hello(None);
    pair(&mut client, &fixture, "Test phone");

    // Switching with nothing playing refuses cleanly over the wire.
    let refused = client.command(
        3,
        json!({
            "type": "switch_stream",
            "addon": "community.example",
            "stream": {
                "name": "4K",
                "description": null,
                "playback": { "kind": "direct", "url": "https://stream.example.org/4k.mkv" },
                "warnings": [],
                "filename": null,
                "bingeGroup": null,
            },
        }),
    );
    assert_eq!(refused["error"]["kind"], "nothing_playing");
    assert_eq!(refused["error"]["control"], "switch_stream");

    // Start playing a Stream, then switch to another Stream over the wire.
    let played = client.command(
        4,
        json!({
            "type": "play_stream",
            "video": { "type": "movie", "id": "tt0133093" },
            "addon": "community.example",
            "title": {
                "addon": "community.example",
                "id": "tt0133093",
                "type": "movie",
                "name": "The Matrix",
                "poster": null,
            },
            "stream": {
                "name": "1080p",
                "description": null,
                "playback": { "kind": "direct", "url": "https://stream.example.org/1080p.mkv" },
                "warnings": [],
                "filename": null,
                "bingeGroup": null,
            },
        }),
    );
    assert!(played.get("response").is_some(), "play_stream: {played}");
    client.snapshot_where(|snapshot| snapshot["playback"]["nowPlaying"]["name"] == "1080p");

    let switched = client.command(
        5,
        json!({
            "type": "switch_stream",
            "addon": "community.alt",
            "stream": {
                "name": "4K HDR",
                "description": null,
                "playback": { "kind": "direct", "url": "https://stream.example.org/4k.mkv" },
                "warnings": [],
                "filename": null,
                "bingeGroup": null,
            },
        }),
    );
    assert!(
        switched.get("response").is_some(),
        "switch_stream: {switched}"
    );
    let pushed =
        client.snapshot_where(|snapshot| snapshot["playback"]["nowPlaying"]["name"] == "4K HDR");
    assert_eq!(
        pushed["snapshot"]["playback"]["nowPlaying"]["addon"],
        "community.alt"
    );
    assert_eq!(
        pushed["snapshot"]["playback"]["nowPlaying"]["video"]["id"],
        "tt0133093"
    );
}

#[test]
fn a_paired_client_sets_the_stream_buffer_and_sees_it_pushed() {
    let (fixture, server) = server();
    let mut client = Client::connect(&server);
    client.hello(None);
    pair(&mut client, &fixture, "Test phone");

    let set = client.command(
        3,
        json!({ "type": "set_stream_buffer", "seconds": 600, "megabytes": 1024 }),
    );
    assert!(
        set.get("response").is_some(),
        "the Remote can change the buffer: {set}"
    );
    let pushed =
        client.snapshot_where(|snapshot| snapshot["preferences"]["streamBuffer"]["seconds"] == 600);
    assert_eq!(
        pushed["snapshot"]["preferences"]["streamBuffer"]["megabytes"], 1024,
        "the ceiling arrives beside the look-ahead: {pushed}"
    );
}

#[test]
fn a_paired_client_sets_the_torrent_cache_and_sees_it_pushed() {
    let (fixture, server) = server();
    let mut client = Client::connect(&server);
    client.hello(None);
    pair(&mut client, &fixture, "Test phone");

    let set = client.command(3, json!({ "type": "set_torrent_cache", "megabytes": 8000 }));
    assert!(
        set.get("response").is_some(),
        "the Remote can change the torrent cache: {set}"
    );
    let pushed = client
        .snapshot_where(|snapshot| snapshot["preferences"]["torrentCache"]["megabytes"] == 8000);
    assert_eq!(
        pushed["snapshot"]["preferences"]["streamBuffer"]["megabytes"], 512,
        "the Stream buffer is left as it was: {pushed}"
    );
}

#[test]
fn a_torrent_cache_outside_its_range_is_refused_with_its_own_code() {
    let (fixture, server) = server();
    let mut client = Client::connect(&server);
    client.hello(None);
    pair(&mut client, &fixture, "Test phone");

    let refused = client.command(3, json!({ "type": "set_torrent_cache", "megabytes": 255 }));

    assert_eq!(
        refused["error"]["kind"], "invalid_torrent_cache",
        "the refusal names the preference: {refused}"
    );
}

#[test]
fn a_paired_client_sets_autoplay_and_sees_it_pushed() {
    let (fixture, server) = server();
    let mut client = Client::connect(&server);
    client.hello(None);
    pair(&mut client, &fixture, "Test phone");

    let set = client.command(3, json!({ "type": "set_autoplay", "autoplay": false }));
    assert!(
        set.get("response").is_some(),
        "the Remote can change Autoplay: {set}"
    );
    let pushed = client.snapshot_where(|snapshot| snapshot["preferences"]["autoplay"] == false);
    assert_eq!(
        pushed["snapshot"]["preferences"]["autoplay"], false,
        "the updated Autoplay preference arrives in the pushed Snapshot: {pushed}"
    );
}

#[test]
fn a_paired_client_cancels_autoplay_and_a_cancel_with_nothing_pending_is_harmless() {
    let (fixture, server) = server();
    let mut client = Client::connect(&server);
    client.hello(None);
    pair(&mut client, &fixture, "Test phone");

    let cancelled = client.command(3, json!({ "type": "cancel_autoplay" }));

    assert!(
        cancelled.get("response").is_some(),
        "the Remote can cancel Autoplay, and with no countdown it is answered, not refused: {cancelled}"
    );
    assert!(cancelled.get("refusal").is_none());
}

#[test]
fn a_client_that_reconnects_is_told_the_state_as_it_stands() {
    let (fixture, server) = server();
    let mut first = Client::connect(&server);
    first.hello(None);
    let (_device, token) = pair(&mut first, &fixture, "Test phone");

    fixture.publish_change(action(
        r#"{"type":"set_subtitle_languages","languages":["pt-BR"]}"#,
    ));

    // The phone slept through that. It comes back with the token it was paired
    // with, greets the Host, and is handed the current state rather than a view
    // of the moment it left.
    let mut returned = Client::connect(&server);
    let welcome = returned.hello(Some(&token));
    assert_eq!(welcome["welcome"]["device"]["name"], "Test phone");

    let caught_up = returned.next_snapshot();
    assert_eq!(
        caught_up["snapshot"]["preferences"]["subtitleLanguages"],
        json!(["pt-BR"]),
        "a reconnecting client catches up instead of holding a stale view"
    );
}

#[test]
fn revoking_one_device_cuts_it_off_and_leaves_the_other_working() {
    let (fixture, server) = server();
    let mut phone = Client::connect(&server);
    phone.hello(None);
    let (phone_device, phone_token) = pair(&mut phone, &fixture, "Phone");

    let mut television = Client::connect(&server);
    television.hello(None);
    let (_, television_token) = pair(&mut television, &fixture, "Television");

    // Both hear what the Host publishes.
    fixture.publish_change(action(
        r#"{"type":"set_subtitle_languages","languages":["pt-BR"]}"#,
    ));
    television.snapshot_where(|snapshot| {
        snapshot["preferences"]["subtitleLanguages"] == json!(["pt-BR"])
    });

    // The owner revokes the phone, from the television.
    let revoked = television.command(
        4,
        json!({ "type": "revoke_device", "id": phone_device.id.as_str() }),
    );
    assert!(revoked.get("response").is_some());

    // The phone stops hearing anything: the next Snapshot it would have been sent
    // is a refusal and a close instead.
    fixture.publish_change(action(
        r#"{"type":"set_subtitle_languages","languages":[]}"#,
    ));
    let mut cut_off = false;
    for _ in 0..10 {
        match phone.read() {
            None => {
                cut_off = true;
                break;
            }
            Some(frame) => {
                if frame["error"]["kind"] == "unpaired" {
                    cut_off = true;
                    break;
                }
            }
        }
    }
    assert!(cut_off, "a revoked device is cut off");

    // And the television, which paired with its own token, is untouched.
    assert!(
        fixture.device(&television_token).is_some(),
        "the other device's token still names it"
    );

    // Its own connection still receives: the revocation did not take the server
    // down with it.
    fixture.publish_change(action(
        r#"{"type":"set_subtitle_languages","languages":["en"]}"#,
    ));
    television
        .snapshot_where(|snapshot| snapshot["preferences"]["subtitleLanguages"] == json!(["en"]));

    assert!(
        fixture.device(&phone_token).is_none(),
        "the revoked device's token matches nothing"
    );
}

#[test]
fn a_revoked_devices_command_is_not_taken_before_a_snapshot_would_have_cut_it_off() {
    let (fixture, server) = server();
    let mut phone = Client::connect(&server);
    phone.hello(None);
    let (phone_device, _token) = pair(&mut phone, &fixture, "Phone");

    // The owner revokes it from the Host itself, and the phone has not read the
    // Snapshot that would have cut it off. The command it sends next must be
    // refused at the moment it arrives: a device that is not paired any more does
    // not get one more Action in before anyone notices.
    fixture.publish_change(action(&format!(
        r#"{{"type":"revoke_device","id":"{}"}}"#,
        phone_device.id
    )));
    phone.send(json!({
        "version": WIRE_VERSION,
        "id": 9,
        "command": { "type": "set_subtitle_language", "language": "pt-BR" },
    }));

    let mut answered = false;
    for _ in 0..10 {
        match phone.read() {
            None => break,
            Some(frame) => {
                if frame.get("response").is_some() {
                    answered = true;
                    break;
                }
            }
        }
    }

    assert!(
        !answered,
        "a revoked device's command is refused, not answered"
    );
    assert!(
        fixture.snapshot().preferences.subtitle_languages.is_empty(),
        "and nothing it asked for happened"
    );
}

#[test]
fn a_paired_connection_may_not_pair_again() {
    let (fixture, server) = server();
    let mut client = Client::connect(&server);
    client.hello(None);
    pair(&mut client, &fixture, "Test phone");
    let code = fixture.code();

    let refused = client.command(
        3,
        json!({ "type": "pair_device", "code": code, "name": "Another" }),
    );

    assert_eq!(
        refused["error"]["kind"], "already_paired",
        "a device pairs by being unpaired"
    );
}

#[test]
fn a_frame_in_another_version_is_refused_as_a_version_rather_than_misparsed() {
    let (_fixture, server) = server();
    let mut client = Client::connect(&server);

    client.send(json!({
        "version": 99,
        "id": 7,
        "command": { "type": "something_from_the_future" },
    }));

    let refused = client.next();
    assert_eq!(refused["error"]["kind"], "unsupported_version");
    assert_eq!(refused["error"]["supported"], WIRE_VERSION);
    assert_eq!(refused["error"]["got"], 99);
    assert_eq!(
        refused["id"], 7,
        "the refusal is correlated, so the client knows which command it was"
    );
}

#[test]
fn a_client_that_mistypes_the_code_too_often_is_hung_up_on() {
    let (fixture, server) = server();
    let mut client = Client::connect(&server);
    client.hello(None);

    // A code that is certainly not the one showing, so the refusals below are
    // for the reason the test means.
    let wrong = if fixture.code() == "AAAAAA" {
        "BBBBBB"
    } else {
        "AAAAAA"
    };

    let mut refusals = 0;
    let mut closed = false;
    for id in 0..8 {
        client.send(json!({
            "version": WIRE_VERSION,
            "id": id,
            "command": { "type": "pair_device", "code": wrong, "name": "Phone" },
        }));
        match client.read() {
            None => {
                closed = true;
                break;
            }
            Some(frame) => {
                if frame["error"]["kind"] == "pairing" {
                    refusals += 1;
                }
            }
        }
    }

    assert_eq!(refusals, 5, "five wrong codes are five refusals");
    assert!(closed, "the Host hangs up rather than guessing forever");
}

#[test]
fn set_addon_enabled_broadcasts_the_change_and_refuses_open_title_while_disabled() {
    let fetcher = Arc::new(
        FixtureFetcher::new()
            .serving(MANIFEST_URL, MANIFEST)
            .serving(MOVIE_URL, MOVIE),
    );
    let (fixture, server) = server_over(fetcher);
    let mut client = Client::connect(&server);
    client.hello(None);
    pair(&mut client, &fixture, "Test phone");

    let added = client.command(2, json!({ "type": "add_addon", "url": MANIFEST_URL }));
    assert!(
        added.get("response").is_some(),
        "add_addon succeeds: {added}"
    );
    let initial = client.snapshot_where(|snapshot| {
        snapshot["addons"]
            .as_array()
            .is_some_and(|addons| addons.len() == 1 && addons[0]["id"] == "com.linvo.cinemeta")
    });
    assert_eq!(initial["snapshot"]["addons"][0]["enabled"], true);

    let disabled = client.command(
        3,
        json!({
            "type": "set_addon_enabled",
            "addon": "com.linvo.cinemeta",
            "enabled": false,
        }),
    );
    assert!(
        disabled.get("response").is_some(),
        "set_addon_enabled(false) succeeds: {disabled}"
    );
    let pushed = client.snapshot_where(|snapshot| {
        snapshot["addons"][0]["id"] == "com.linvo.cinemeta"
            && snapshot["addons"][0]["enabled"] == false
    });
    assert_eq!(pushed["snapshot"]["addons"][0]["enabled"], false);

    let refused = client.command(4, open_movie());
    assert_eq!(refused["error"]["kind"], "addon_disabled");
    assert_eq!(refused["error"]["id"], "com.linvo.cinemeta");

    let enabled = client.command(
        5,
        json!({
            "type": "set_addon_enabled",
            "addon": "com.linvo.cinemeta",
            "enabled": true,
        }),
    );
    assert!(
        enabled.get("response").is_some(),
        "set_addon_enabled(true) succeeds: {enabled}"
    );
    let restored = client.snapshot_where(|snapshot| {
        snapshot["addons"][0]["id"] == "com.linvo.cinemeta"
            && snapshot["addons"][0]["enabled"] == true
    });
    assert_eq!(restored["snapshot"]["addons"][0]["enabled"], true);

    let opened = client.command(6, open_movie());
    assert_eq!(opened["response"]["answer"]["title"]["name"], "The Matrix");
}

struct ActiveGuard<'a>(&'a AtomicUsize);

impl Drop for ActiveGuard<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

/// A [`Fetcher`] whose recorded URLs can be held behind per-URL gates so
/// tests control concurrency and completion order without wall-clock sleeps.
struct BlockingFetcher {
    inner: FixtureFetcher,
    gates: Mutex<HashMap<String, mpsc::Receiver<()>>>,
    entered_tx: mpsc::Sender<String>,
    active: AtomicUsize,
    peak: AtomicUsize,
}

impl BlockingFetcher {
    fn new(inner: FixtureFetcher) -> (Arc<Self>, mpsc::Receiver<String>) {
        let (entered_tx, entered_rx) = mpsc::channel();
        let fetcher = Arc::new(Self {
            inner,
            gates: Mutex::new(HashMap::new()),
            entered_tx,
            active: AtomicUsize::new(0),
            peak: AtomicUsize::new(0),
        });
        (fetcher, entered_rx)
    }

    fn gate(&self, url: &str) -> mpsc::Sender<()> {
        let (tx, rx) = mpsc::channel();
        self.gates
            .lock()
            .expect("gates lock")
            .insert(url.to_owned(), rx);
        tx
    }
}

impl Fetcher for BlockingFetcher {
    fn fetch_with_headers(
        &self,
        url: &str,
        headers: &[(&str, &str)],
    ) -> Result<String, FetchError> {
        let gate = self.gates.lock().expect("gates lock").remove(url);
        if let Some(rx) = gate {
            let now = self.active.fetch_add(1, Ordering::SeqCst) + 1;
            self.peak.fetch_max(now, Ordering::SeqCst);
            let _guard = ActiveGuard(&self.active);
            let _ = self.entered_tx.send(url.to_owned());
            let _ = rx.recv();
        }
        self.inner.fetch_with_headers(url, headers)
    }
}

#[test]
fn a_blocking_question_does_not_delay_a_change_on_the_same_connection() {
    let (fetcher, entered_rx) = BlockingFetcher::new(
        FixtureFetcher::new()
            .serving(MANIFEST_URL, MANIFEST)
            .serving(MOVIE_URL, MOVIE),
    );
    let (fixture, server) = server_over_fetcher(fetcher.clone());
    let mut client = Client::connect(&server);
    client.hello(None);
    pair(&mut client, &fixture, "Phone");
    client.command(3, json!({ "type": "add_addon", "url": MANIFEST_URL }));

    let release_question = fetcher.gate(MOVIE_URL);
    client.send(json!({
        "version": WIRE_VERSION,
        "id": 10,
        "command": open_movie(),
    }));
    assert_eq!(
        entered_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("the question enters its worker fetch"),
        MOVIE_URL
    );

    client.send(json!({
        "version": WIRE_VERSION,
        "id": 11,
        "command": { "type": "set_subtitle_languages", "languages": ["pt-BR"] },
    }));

    let first_reply = loop {
        let frame = client.next();
        if frame.get("id").is_some() {
            break frame;
        }
    };
    assert_eq!(
        first_reply["id"], 11,
        "the change's Reply arrives before the blocked question: {first_reply}"
    );
    assert!(first_reply.get("response").is_some());

    release_question
        .send(())
        .expect("release the blocked question");
    let question_reply = loop {
        let frame = client.next();
        if frame.get("id").and_then(Value::as_u64) == Some(10) {
            break frame;
        }
    };
    assert_eq!(
        question_reply["response"]["answer"]["title"]["name"],
        "The Matrix"
    );
}

#[test]
fn a_greeting_while_a_question_is_in_flight_is_answered_promptly_with_welcome() {
    let (fetcher, entered_rx) = BlockingFetcher::new(
        FixtureFetcher::new()
            .serving(MANIFEST_URL, MANIFEST)
            .serving(MOVIE_URL, MOVIE),
    );
    let (fixture, server) = server_over_fetcher(fetcher.clone());
    let mut client = Client::connect(&server);
    client.hello(None);
    let (_device, token) = pair(&mut client, &fixture, "Phone");
    client.command(3, json!({ "type": "add_addon", "url": MANIFEST_URL }));

    let release_question = fetcher.gate(MOVIE_URL);
    client.send(json!({
        "version": WIRE_VERSION,
        "id": 10,
        "command": open_movie(),
    }));
    assert_eq!(
        entered_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("the question enters its worker fetch"),
        MOVIE_URL
    );

    client.send(json!({ "version": WIRE_VERSION, "hello": { "token": token } }));

    let mut saw_welcome = false;
    let mut saw_snapshot = false;
    while !saw_welcome || !saw_snapshot {
        let frame = client.next();
        assert_ne!(
            frame.get("id").and_then(Value::as_u64),
            Some(10),
            "Welcome and its Snapshot arrive before the blocked question's Reply: {frame}"
        );
        if let Some(welcome) = frame.get("welcome") {
            assert_eq!(welcome["device"]["name"], "Phone");
            saw_welcome = true;
        }
        if frame.get("snapshot").is_some() {
            saw_snapshot = true;
        }
    }

    release_question
        .send(())
        .expect("release the blocked question");
    let question_reply = loop {
        let frame = client.next();
        if frame.get("id").and_then(Value::as_u64) == Some(10) {
            break frame;
        }
    };
    assert_eq!(
        question_reply["response"]["answer"]["title"]["name"],
        "The Matrix"
    );
}

#[test]
fn pushed_snapshots_keep_flowing_while_a_question_is_in_flight() {
    let (fetcher, entered_rx) = BlockingFetcher::new(
        FixtureFetcher::new()
            .serving(MANIFEST_URL, MANIFEST)
            .serving(MOVIE_URL, MOVIE),
    );
    let (fixture, server) = server_over_fetcher(fetcher.clone());
    let mut client = Client::connect(&server);
    client.hello(None);
    pair(&mut client, &fixture, "Phone");
    client.command(3, json!({ "type": "add_addon", "url": MANIFEST_URL }));
    client.snapshot_where(|snapshot| {
        snapshot["addons"]
            .as_array()
            .is_some_and(|addons| !addons.is_empty())
    });

    let release_question = fetcher.gate(MOVIE_URL);
    client.send(json!({
        "version": WIRE_VERSION,
        "id": 10,
        "command": open_movie(),
    }));
    assert_eq!(
        entered_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("the question enters its worker fetch"),
        MOVIE_URL
    );

    fixture.publish_change(action(
        r#"{"type":"set_subtitle_languages","languages":["fr"]}"#,
    ));

    loop {
        let frame = client.next();
        assert_ne!(
            frame.get("id").and_then(Value::as_u64),
            Some(10),
            "the Snapshot arrives while the question is still blocked: {frame}"
        );
        if frame["snapshot"]["preferences"]["subtitleLanguages"] == json!(["fr"]) {
            break;
        }
    }

    release_question
        .send(())
        .expect("release the blocked question");
    let question_reply = loop {
        let frame = client.next();
        if frame.get("id").and_then(Value::as_u64) == Some(10) {
            break frame;
        }
    };
    assert_eq!(
        question_reply["response"]["answer"]["title"]["name"],
        "The Matrix"
    );
}

#[test]
fn two_changes_sent_back_to_back_are_applied_in_order() {
    let fetcher = Arc::new(FixtureFetcher::new().serving(MANIFEST_URL, MANIFEST));
    let (fixture, server) = server_over(fetcher);
    let mut client = Client::connect(&server);
    client.hello(None);
    pair(&mut client, &fixture, "Phone");

    // `set_addon_enabled` depends on `add_addon` having already landed; two
    // subtitle-language writes pin final state order.
    client.send(json!({
        "version": WIRE_VERSION,
        "id": 10,
        "command": { "type": "add_addon", "url": MANIFEST_URL },
    }));
    client.send(json!({
        "version": WIRE_VERSION,
        "id": 11,
        "command": {
            "type": "set_addon_enabled",
            "addon": "com.linvo.cinemeta",
            "enabled": false,
        },
    }));
    client.send(json!({
        "version": WIRE_VERSION,
        "id": 12,
        "command": { "type": "set_subtitle_languages", "languages": ["pt-BR"] },
    }));
    client.send(json!({
        "version": WIRE_VERSION,
        "id": 13,
        "command": { "type": "set_subtitle_languages", "languages": ["en"] },
    }));

    let mut ids = Vec::new();
    while ids.len() < 4 {
        let frame = client.next();
        if let Some(id) = frame.get("id").and_then(Value::as_u64) {
            assert!(
                frame.get("response").is_some(),
                "change {id} succeeded in arrival order: {frame}"
            );
            ids.push(id);
        }
    }
    assert_eq!(ids, vec![10, 11, 12, 13]);

    let final_state = fixture.snapshot();
    assert!(!final_state.addons[0].enabled);
    assert_eq!(
        final_state
            .preferences
            .subtitle_languages
            .iter()
            .map(|l| l.as_str())
            .collect::<Vec<_>>(),
        vec!["en"]
    );
}

/// `total` films one Addon answers, each behind its own URL: the ids a client
/// asks for and the URLs the asks reach.
fn numbered_movies(total: usize) -> (FixtureFetcher, Vec<(String, String)>) {
    let mut inner = FixtureFetcher::new().serving(MANIFEST_URL, MANIFEST);
    let mut urls = Vec::with_capacity(total);
    for idx in 0..total {
        let tt_id = format!("tt013309{idx}");
        let url = format!("https://v3-cinemeta.strem.io/meta/movie/{tt_id}.json");
        let body = format!(r#"{{"meta":{{"id":"{tt_id}","type":"movie","name":"Movie {idx}"}}}}"#);
        inner = inner.serving(&url, body);
        urls.push((tt_id, url));
    }
    (inner, urls)
}

/// The command that opens one of the [`numbered_movies`].
fn open_numbered(tt_id: &str) -> Value {
    json!({
        "type": "open_title",
        "addon": "com.linvo.cinemeta",
        "title": { "type": "movie", "id": tt_id },
    })
}

#[test]
fn flooding_questions_beyond_the_worker_limit_queues_without_spawning_more_threads() {
    let total = QUESTION_WORKERS + 2;
    let (inner, urls) = numbered_movies(total);

    let (fetcher, entered_rx) = BlockingFetcher::new(inner);
    let mut gates: HashMap<String, mpsc::Sender<()>> = urls
        .iter()
        .map(|(_id, url)| (url.clone(), fetcher.gate(url)))
        .collect();

    let (fixture, server) = server_over_fetcher(fetcher.clone());
    let mut client = Client::connect(&server);
    client.hello(None);
    pair(&mut client, &fixture, "Phone");
    client.command(3, json!({ "type": "add_addon", "url": MANIFEST_URL }));

    for (idx, (tt_id, _url)) in urls.iter().enumerate() {
        client.send(json!({
            "version": WIRE_VERSION,
            "id": 10 + idx as u64,
            "command": open_numbered(tt_id),
        }));
    }
    // Sent after the flood: proves the connection loop read and queued every
    // question without blocking on the full worker pool.
    client.send(json!({
        "version": WIRE_VERSION,
        "id": 99,
        "command": { "type": "set_subtitle_languages", "languages": ["es"] },
    }));

    let change_reply = loop {
        let frame = client.next();
        if frame.get("id").is_some() {
            break frame;
        }
    };
    assert_eq!(
        change_reply["id"], 99,
        "the change after the question flood answers while the worker pool is saturated"
    );

    let mut in_flight = Vec::with_capacity(QUESTION_WORKERS);
    for _ in 0..QUESTION_WORKERS {
        in_flight.push(
            entered_rx
                .recv_timeout(Duration::from_secs(2))
                .expect("up to QUESTION_WORKERS enter concurrently"),
        );
    }
    assert_eq!(fetcher.active.load(Ordering::SeqCst), QUESTION_WORKERS);
    assert_eq!(fetcher.peak.load(Ordering::SeqCst), QUESTION_WORKERS);
    assert!(
        entered_rx.try_recv().is_err(),
        "questions past QUESTION_WORKERS wait in the queue"
    );

    // Unblock two workers and observe the two queued questions enter without
    // raising peak concurrency past QUESTION_WORKERS.
    for url in in_flight.drain(..2) {
        gates
            .remove(&url)
            .expect("gate exists")
            .send(())
            .expect("unblock");
    }
    for _ in 0..2 {
        in_flight.push(
            entered_rx
                .recv_timeout(Duration::from_secs(2))
                .expect("queued questions enter as workers free up"),
        );
    }
    assert_eq!(fetcher.peak.load(Ordering::SeqCst), QUESTION_WORKERS);

    for url in in_flight {
        gates
            .remove(&url)
            .expect("gate exists")
            .send(())
            .expect("unblock");
    }

    let mut answered = Vec::new();
    while answered.len() < total {
        let frame = client.next();
        if let Some(id) = frame.get("id").and_then(Value::as_u64) {
            assert!(
                frame.get("response").is_some(),
                "queued question {id} succeeds: {frame}"
            );
            answered.push(id);
        }
    }
    answered.sort_unstable();
    let expected: Vec<u64> = (10..10 + total as u64).collect();
    assert_eq!(answered, expected);
}

/// A paired connection whose every question worker is held inside an Addon's
/// fetch, with one more question waiting in the queue behind them.
struct Saturated {
    fixture: Arc<Fixture>,
    server: Server,
    client: Client,
    device: DeviceSummary,
    token: DeviceToken,
    entered: mpsc::Receiver<String>,
    /// The gates of the questions the workers are inside.
    held: Vec<mpsc::Sender<()>>,
    /// The queued question's URL, and the gate that would hold its fetch.
    queued: (String, mpsc::Sender<()>),
}

/// The ids [`Saturated`] asks under, the queued question's being the last.
const ASKED: std::ops::RangeInclusive<u64> = 10..=10 + QUESTION_WORKERS as u64;

impl Saturated {
    fn new() -> Self {
        let (inner, urls) = numbered_movies(QUESTION_WORKERS + 1);
        let (fetcher, entered) = BlockingFetcher::new(inner);
        let mut held: Vec<mpsc::Sender<()>> =
            urls.iter().map(|(_id, url)| fetcher.gate(url)).collect();
        let queued_url = urls.last().expect("a queued question").1.clone();
        let queued = (queued_url, held.pop().expect("the queued question's gate"));

        let (fixture, server) = server_over_fetcher(fetcher);
        let mut client = Client::connect(&server);
        client.hello(None);
        let (device, token) = pair(&mut client, &fixture, "Phone");
        client.command(3, json!({ "type": "add_addon", "url": MANIFEST_URL }));
        for (id, (tt_id, _url)) in ASKED.zip(&urls) {
            client.send(json!({
                "version": WIRE_VERSION,
                "id": id,
                "command": open_numbered(tt_id),
            }));
        }
        // A change answered after them proves the connection has read, and
        // queued, every question.
        client.command(
            99,
            json!({ "type": "set_subtitle_languages", "languages": ["es"] }),
        );
        for _ in 0..QUESTION_WORKERS {
            entered
                .recv_timeout(Duration::from_secs(2))
                .expect("every worker enters its fetch");
        }

        Self {
            fixture,
            server,
            client,
            device,
            token,
            entered,
            held,
            queued,
        }
    }

    fn revocation(&self) -> Action {
        action(&format!(
            r#"{{"type":"revoke_device","id":"{}"}}"#,
            self.device.id.as_str()
        ))
    }

    fn release_workers(&self) {
        for gate in &self.held {
            gate.send(()).expect("release a held question");
        }
    }

    fn assert_the_queued_question_never_ran(&self) {
        assert_eq!(
            self.entered.recv_timeout(Duration::from_millis(500)),
            Err(mpsc::RecvTimeoutError::Timeout),
            "the queued question {} never reaches the Fetcher",
            self.queued.0
        );
    }

    /// Greet again, and read past whatever was already on its way to the
    /// Welcome.
    fn greet(&mut self, token: Option<&DeviceToken>) -> Value {
        self.client
            .send(json!({ "version": WIRE_VERSION, "hello": { "token": token } }));
        loop {
            let frame = self.client.next();
            assert!(
                frame.get("id").is_none(),
                "nothing has answered yet: {frame}"
            );
            if frame.get("welcome").is_some() {
                return frame;
            }
        }
    }

    /// Everything the Host still says before it hangs up, which must be that
    /// the device is not paired and nothing that answers a question.
    fn assert_cut_off_unanswered(&mut self) {
        let mut last = None;
        while let Some(frame) = self.client.read() {
            assert!(
                frame.get("id").is_none(),
                "a revoked device is answered nothing: {frame}"
            );
            last = Some(frame);
        }
        let last = last.expect("the Host says why before it hangs up");
        assert_eq!(last["error"]["kind"], "unpaired", "{last}");
    }
}

#[test]
fn a_question_queued_behind_the_workers_never_runs_once_its_device_is_revoked() {
    let mut saturated = Saturated::new();
    saturated.fixture.publish_change(saturated.revocation());
    saturated.assert_cut_off_unanswered();

    saturated.release_workers();
    saturated.assert_the_queued_question_never_ran();
}

#[test]
fn a_revoke_the_connection_has_not_heard_of_still_stops_its_questions() {
    // Nothing is published, so no push tells the connection: the worker and the
    // reply each have to ask the Host for themselves.
    let mut saturated = Saturated::new();
    saturated
        .fixture
        .door
        .dispatch_asking(saturated.revocation(), None)
        .expect("the Host revokes the device");

    saturated.release_workers();
    saturated.assert_the_queued_question_never_ran();
    saturated.assert_cut_off_unanswered();
}

#[test]
fn a_greeting_that_unpairs_drops_the_queued_questions_and_the_replies_owed() {
    let mut saturated = Saturated::new();
    let welcome = saturated.greet(None);
    assert!(welcome["welcome"]["device"].is_null(), "{welcome}");

    saturated.release_workers();
    saturated.assert_the_queued_question_never_ran();
    assert!(
        saturated.client.quiet(Duration::from_millis(500)),
        "an unpaired connection is sent no Reply"
    );

    // The device is still paired, and what it asked before it unpaired is not
    // owed to it when it comes back.
    let token = saturated.token.clone();
    saturated.greet(Some(&token));
    assert!(saturated.client.next().get("snapshot").is_some());
    assert!(saturated.client.quiet(Duration::from_millis(500)));
}

#[test]
fn a_greeting_as_another_device_is_not_owed_the_first_devices_answers() {
    let mut saturated = Saturated::new();
    let mut other = Client::connect(&saturated.server);
    other.hello(None);
    let (_other_device, other_token) = pair(&mut other, &saturated.fixture, "Tablet");
    // The tablet's pairing is published to the phone too; read it first so the
    // greeting's Welcome is what comes next.
    saturated.client.snapshot_where(|snapshot| {
        snapshot["devices"]
            .as_array()
            .is_some_and(|devices| devices.len() == 2)
    });

    let welcome = saturated.greet(Some(&other_token));
    assert_eq!(welcome["welcome"]["device"]["name"], "Tablet");
    assert!(saturated.client.next().get("snapshot").is_some());

    saturated.release_workers();
    saturated.assert_the_queued_question_never_ran();
    assert!(saturated.client.quiet(Duration::from_millis(500)));
}

#[test]
fn a_question_past_a_full_queue_is_refused_and_the_queued_ones_still_answer() {
    let mut saturated = Saturated::new();
    // One question is queued already: these fill the queue, and go one past it.
    let first = ASKED.end() + 1;
    let overflow = first + QUESTION_QUEUE as u64 - 1;
    for id in first..=overflow {
        saturated.client.send(json!({
            "version": WIRE_VERSION,
            "id": id,
            "command": { "type": "search_catalogs", "query": "matrix" },
        }));
    }

    let refused = loop {
        let frame = saturated.client.next();
        if frame.get("id").is_some() {
            break frame;
        }
    };
    assert_eq!(refused["id"], overflow, "{refused}");
    assert_eq!(refused["error"]["kind"], "too_many_questions", "{refused}");
    assert_eq!(refused["error"]["limit"], QUESTION_QUEUE, "{refused}");

    let change = saturated.client.command(
        500,
        json!({ "type": "set_subtitle_languages", "languages": ["fr"] }),
    );
    assert!(change.get("response").is_some(), "{change}");

    saturated.release_workers();
    saturated
        .queued
        .1
        .send(())
        .expect("release the queued question");
    let mut answered = Vec::new();
    while answered.len() < QUESTION_WORKERS + QUESTION_QUEUE {
        if let Some(id) = saturated.client.next().get("id").and_then(Value::as_u64) {
            answered.push(id);
        }
    }
    answered.sort_unstable();
    let expected: Vec<u64> = (*ASKED.start()..overflow).collect();
    assert_eq!(answered, expected);
}
