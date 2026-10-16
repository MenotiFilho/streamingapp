//! The wire server, driven the way a remote client drives it: a real socket, a
//! real WebSocket handshake, real frames, over a real `Host`.
//!
//! Nothing below the Action surface is named: this is the second client's door,
//! and what it proves is that it is the same door (ADR-0002).

use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use host_core::{
    Action, ActionError, AddonProvider, DeviceSummary, FixtureClock, FixtureFetcher, FixturePlayer,
    Host, InMemorySecretStore, InMemoryStore, Response, Snapshot, WIRE_VERSION,
};
use host_wire::{Broadcast, Server, Surface};
use serde_json::{json, Value};
use tungstenite::stream::MaybeTlsStream;
use tungstenite::{connect, Message, WebSocket};

/// The Host, behind the same three methods the app shell implements — over the
/// real thing rather than a mock, so a frame that reaches the Host is a frame the
/// Host acted on.
struct Fixture {
    host: Mutex<Host>,
    broadcast: Broadcast,
}

impl Fixture {
    fn new() -> Arc<Self> {
        let store = Arc::new(InMemoryStore::new());
        let fetcher = Arc::new(FixtureFetcher::new());
        let provider = Arc::new(AddonProvider::new(fetcher.clone()));
        let host = Host::new(
            store,
            fetcher,
            Arc::new(InMemorySecretStore::new()),
            provider,
            Arc::new(FixturePlayer::new()),
            Arc::new(FixtureClock::new()),
        )
        .expect("a Host over in-memory seams starts");

        Arc::new(Self {
            host: Mutex::new(host),
            broadcast: Broadcast::new(),
        })
    }

    /// The code the Host is showing, which a client redeems.
    fn code(&self) -> String {
        self.host
            .lock()
            .expect("nothing panics while holding the Host")
            .snapshot()
            .pairing_code
            .as_str()
            .to_owned()
    }

    /// A change the Host made on its own — a clock tick, or another client:
    /// publishing it is what the shell's `publish` does beside emitting it.
    fn publish_change(&self, action: Action) -> Response {
        self.dispatch(action).expect("the Host takes this change")
    }
}

impl Surface for Fixture {
    fn dispatch(&self, action: Action) -> Result<Response, ActionError> {
        let response = self
            .host
            .lock()
            .expect("nothing panics while holding the Host")
            .dispatch(action)?;
        for snapshot in &response.snapshots {
            self.broadcast.publish(snapshot);
        }
        Ok(response)
    }

    fn device(&self, token: &str) -> Option<DeviceSummary> {
        self.host
            .lock()
            .expect("nothing panics while holding the Host")
            .device(token)
    }

    fn snapshot(&self) -> Snapshot {
        self.host
            .lock()
            .expect("nothing panics while holding the Host")
            .snapshot()
    }
}

fn server() -> (Arc<Fixture>, Server) {
    let fixture = Fixture::new();
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
    fn hello(&mut self, token: Option<&str>) -> Value {
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
}

/// Pair `client` with the code the Host is showing, and hand back the device id
/// and the token it answered with.
fn pair(client: &mut Client, fixture: &Fixture, name: &str) -> (String, String) {
    let code = fixture.code();
    let frame = client.command(
        2,
        json!({ "type": "pair_device", "code": code, "name": name }),
    );

    let paired = &frame["response"]["answer"]["paired"];
    (
        paired["device"]["id"]
            .as_str()
            .expect("the pairing names the device")
            .to_owned(),
        paired["token"]
            .as_str()
            .expect("the pairing issues a token")
            .to_owned(),
    )
}

#[test]
fn a_browser_is_served_the_remote_page_before_it_has_anything_to_say() {
    let (_fixture, server) = server();
    let mut stream = TcpStream::connect(server.address()).expect("the Host is listening");
    stream
        .write_all(b"GET / HTTP/1.1\r\nHost: host\r\nConnection: close\r\n\r\n")
        .expect("the request is sent");

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("the Host answers and closes");

    assert!(
        response.starts_with("HTTP/1.1 200 OK"),
        "the page is served: {response}"
    );
    assert!(response.contains("Pair this device"));
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
    assert_eq!(token.len(), 43);

    // With the token adopted, an ordinary Action is taken rather than refused.
    let answered = client.command(
        3,
        json!({ "type": "set_subtitle_language", "language": "pt-BR" }),
    );
    assert!(
        answered.get("response").is_some(),
        "a paired client is answered: {answered}"
    );
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
        r#"{"type":"set_subtitle_language","language":"pt-BR"}"#,
    ));

    let pushed = client.next_snapshot();
    assert_eq!(
        pushed["snapshot"]["preferences"]["subtitleLanguage"], "pt-BR",
        "state arrives pushed, not polled: {pushed}"
    );
}

#[test]
fn a_client_that_reconnects_is_told_the_state_as_it_stands() {
    let (fixture, server) = server();
    let mut first = Client::connect(&server);
    first.hello(None);
    let (_device, token) = pair(&mut first, &fixture, "Test phone");

    fixture.publish_change(action(
        r#"{"type":"set_subtitle_language","language":"pt-BR"}"#,
    ));

    // The phone slept through that. It comes back with the token it was paired
    // with, greets the Host, and is handed the current state rather than a view
    // of the moment it left.
    let mut returned = Client::connect(&server);
    let welcome = returned.hello(Some(&token));
    assert_eq!(welcome["welcome"]["device"]["name"], "Test phone");

    let caught_up = returned.next_snapshot();
    assert_eq!(
        caught_up["snapshot"]["preferences"]["subtitleLanguage"], "pt-BR",
        "a reconnecting client catches up instead of holding a stale view"
    );
}

#[test]
fn revoking_one_device_cuts_it_off_and_leaves_the_other_working() {
    let (fixture, server) = server();
    let mut phone = Client::connect(&server);
    phone.hello(None);
    let (phone_id, phone_token) = pair(&mut phone, &fixture, "Phone");

    let mut television = Client::connect(&server);
    television.hello(None);
    let (_, television_token) = pair(&mut television, &fixture, "Television");

    // Both hear what the Host publishes.
    fixture.publish_change(action(
        r#"{"type":"set_subtitle_language","language":"pt-BR"}"#,
    ));
    television.snapshot_where(|snapshot| snapshot["preferences"]["subtitleLanguage"] == "pt-BR");

    // The owner revokes the phone, from the television.
    let revoked = television.command(4, json!({ "type": "revoke_device", "id": phone_id }));
    assert!(revoked.get("response").is_some());

    // The phone stops hearing anything: the next Snapshot it would have been sent
    // is a refusal and a close instead.
    fixture.publish_change(action(r#"{"type":"clear_subtitle_language"}"#));
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
        r#"{"type":"set_subtitle_language","language":"en"}"#,
    ));
    television.snapshot_where(|snapshot| snapshot["preferences"]["subtitleLanguage"] == "en");

    assert!(
        fixture.device(&phone_token).is_none(),
        "the revoked device's token matches nothing"
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
