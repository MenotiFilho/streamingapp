//! The wire server: the one Action surface, reached from another device.
//!
//! This is a translator and nothing else (ADR-0002). It reads a frame, asks the
//! Host, writes the answer back, and pushes the Snapshots the Host publishes to
//! every paired connection. It decides one thing — whether a connection has
//! paired — because that is a fact about a socket rather than about the state
//! every client shares, and it borrows the rule for it from
//! [`host_core::permitted`].
//!
//! Threads, not an async runtime: the Host has no executor, the transports beside
//! this one are blocking, and one thread per connection with a read timeout is a
//! fraction of the machinery for a handful of devices on a home network.
//!
//! What a connection does:
//!
//! - a `GET` without the upgrade gets the remote client's page, so a browser has
//!   something to load before it has anything to say;
//! - a `GET` with the upgrade becomes a WebSocket and speaks the [`host_core`]
//!   wire protocol;
//! - a connection that has not paired may attempt to pair and nothing else — the
//!   refusal is [`host_core::ActionError::Unpaired`], in the Host's own words;
//! - a pushed Snapshot goes only to connections that are paired *now*, so a
//!   revoked device stops hearing anything at the moment it is revoked.

use std::io;
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use host_core::{
    Action, ActionError, Answer, ClientFrame, DeviceSummary, Response, ServerFrame, Snapshot,
};
use tungstenite::protocol::{Message, Role, WebSocket};

use crate::http;
use crate::remote;

/// How long a connection waits for a client's frame before looking at what the
/// Host has published. Small enough that a pushed Snapshot arrives as the eye
/// reads it, large enough that an idle connection is not a busy loop.
const READ_TIMEOUT: Duration = Duration::from_millis(200);

/// How often the listener looks at whether it has been asked to stop.
const ACCEPT_PAUSE: Duration = Duration::from_millis(25);

/// How many wrong pairing codes one connection may offer before the Host hangs
/// up on it. A six-character code is thirty bits; five guesses is not a way to
/// find one, and a client that has mistyped five times can reconnect.
const MAX_PAIRING_ATTEMPTS: u32 = 5;

/// The port the Host prefers for its wire server. A memorable number rather than
/// a random one, so `host:8090` is worth writing down; a Host that cannot have it
/// binds whatever the operating system offers and says so.
pub const DEFAULT_PORT: u16 = 8090;

/// The Host, as the wire server reaches it.
///
/// The same three things a remote client needs and no more: take an Action, name
/// a token, and read the state as it stands. Implemented in the app shell over
/// the same handle the Tauri bridge uses, and in this crate's tests over a real
/// [`host_core::Host`].
pub trait Surface: Send + Sync + 'static {
    /// Take an Action through the one door. The shell's implementation publishes
    /// what the Action published, exactly as the window's does.
    fn dispatch(&self, action: Action) -> Result<Response, ActionError>;

    /// The device a presented token belongs to, or nothing: a token this Host
    /// never issued, or one issued to a device that has been revoked.
    fn device(&self, token: &str) -> Option<DeviceSummary>;

    /// The state as it stands — what a client that has just connected, or just
    /// reconnected, is owed.
    fn snapshot(&self) -> Snapshot;
}

/// The running server, and the address it is answering on.
pub struct Server {
    address: SocketAddr,
    stop: Arc<AtomicBool>,
    listener: Option<JoinHandle<()>>,
}

impl Server {
    /// Start answering on `address`, and hand back where it landed.
    ///
    /// `address` may be `0.0.0.0:0` to let the operating system choose the port,
    /// which is what a Host whose preferred port is taken does: what a person
    /// needs is the address the server reports, not the one it asked for.
    pub fn start(
        surface: Arc<dyn Surface>,
        broadcast: Broadcast,
        address: SocketAddr,
    ) -> io::Result<Self> {
        let listener = TcpListener::bind(address)?;
        // The port may have been the operating system's to choose; the address
        // the Host reports is the one it actually holds.
        let address = listener.local_addr()?;
        listener.set_nonblocking(true)?;

        let stop = Arc::new(AtomicBool::new(false));
        let thread_stop = stop.clone();
        let listener_handle = thread::Builder::new()
            .name("host-wire".to_owned())
            .spawn(move || accept_loop(listener, surface, broadcast, thread_stop))?;

        Ok(Self {
            address,
            stop,
            listener: Some(listener_handle),
        })
    }

    /// The address this server is answering on.
    pub fn address(&self) -> SocketAddr {
        self.address
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(listener) = self.listener.take() {
            let _ = listener.join();
        }
    }
}

fn accept_loop(
    listener: TcpListener,
    surface: Arc<dyn Surface>,
    broadcast: Broadcast,
    stop: Arc<AtomicBool>,
) {
    while !stop.load(Ordering::SeqCst) {
        match listener.accept() {
            Ok((stream, peer)) => {
                let surface = surface.clone();
                let broadcast = broadcast.clone();
                // One thread per connection. A connection that cannot be named
                // still gets served: a client that made it this far is worth an
                // answer.
                let _ = thread::Builder::new()
                    .name("host-wire-connection".to_owned())
                    .spawn(move || {
                        if let Err(error) = serve(&surface, &broadcast, stream) {
                            // A client hanging up is the ordinary end of a
                            // connection, not a failure of the Host's.
                            tracing::debug!(%peer, %error, "a remote connection ended");
                        }
                    });
            }
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                thread::sleep(ACCEPT_PAUSE);
            }
            Err(error) => {
                tracing::warn!(%error, "the wire server could not accept a connection");
                thread::sleep(ACCEPT_PAUSE);
            }
        }
    }
}

/// Answer one connection: the page or the upgrade, and then frames.
fn serve(
    surface: &Arc<dyn Surface>,
    broadcast: &Broadcast,
    mut stream: TcpStream,
) -> io::Result<()> {
    let head = http::read_head(&mut stream)?;
    let Some(request) = http::Request::parse(&head) else {
        return http::write_document(
            &mut stream,
            "400 Bad Request",
            "text/plain; charset=utf-8",
            b"",
        );
    };

    if !request.is_websocket_upgrade() {
        return remote::serve(&mut stream, &request);
    }

    let Some(accept) = request.accept_key() else {
        return http::write_document(
            &mut stream,
            "400 Bad Request",
            "text/plain; charset=utf-8",
            b"",
        );
    };
    http::write_upgrade(&mut stream, &accept)?;

    stream.set_read_timeout(Some(READ_TIMEOUT))?;
    // Nagle would hold a small frame — a pause, a seek — back for the sake of a
    // packet that is never coming. A control wants sending now.
    let _ = stream.set_nodelay(true);

    let mut socket = WebSocket::from_raw_socket(stream, Role::Server, None);
    connection(surface, broadcast, &mut socket)
}

/// The conversation: a greeting, then commands, with pushed Snapshots between.
fn connection(
    surface: &Arc<dyn Surface>,
    broadcast: &Broadcast,
    socket: &mut WebSocket<TcpStream>,
) -> io::Result<()> {
    let subscription = broadcast.subscribe();
    let mut paired: Option<String> = None;
    let mut token: Option<String> = None;
    let mut wrong_codes = 0u32;

    loop {
        match socket.read() {
            Ok(Message::Text(text)) => {
                let mut conversation = Conversation {
                    surface,
                    paired: &mut paired,
                    token: &mut token,
                    wrong_codes: &mut wrong_codes,
                };
                if let Outcome::Stop = conversation.handle(&text, socket)? {
                    let _ = socket.close(None);
                    let _ = socket.flush();
                    return Ok(());
                }
            }
            Ok(Message::Close(_)) => return Ok(()),
            // A ping is answered by the framing layer on the next write; a pong
            // is nobody's business; a binary frame has no meaning here.
            Ok(_) => {}
            Err(tungstenite::Error::Io(error))
                if matches!(
                    error.kind(),
                    io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
                ) =>
            {
                // Nobody said anything; look at what the Host published.
            }
            Err(error) => {
                tracing::debug!(%error, "a remote connection closed");
                return Ok(());
            }
        }

        // The Host's own news, on the way to every client allowed to hear it.
        if !push(surface, &subscription, &paired, &token, socket)? {
            return Ok(());
        }
    }
}

/// Send whatever the Host has published since the last look.
///
/// Answers whether the connection is still wanted: a device that has been
/// revoked stops being told anything the moment it is revoked, and the
/// connection is closed rather than left to wonder.
fn push(
    surface: &Arc<dyn Surface>,
    subscription: &Subscription,
    paired: &Option<String>,
    token: &Option<String>,
    socket: &mut WebSocket<TcpStream>,
) -> io::Result<bool> {
    let _ = socket.flush();
    loop {
        let snapshot = match subscription.try_recv() {
            Some(snapshot) => snapshot,
            None => return Ok(true),
        };

        let (Some(paired), Some(token)) = (paired.as_deref(), token.as_deref()) else {
            // A connection that has not paired is not told what is playing.
            continue;
        };
        // Asked of the Host now rather than remembered from the greeting: a
        // revoke is a change, and a connection holding a token that no longer
        // names a device is not a connection any more.
        let still_paired = surface
            .device(token)
            .is_some_and(|device| device.id.as_str() == paired);
        if still_paired {
            send(socket, &ServerFrame::Snapshot(Box::new(snapshot)))?;
        } else {
            let _ = send(
                socket,
                &ServerFrame::Refusal {
                    id: None,
                    error: ActionError::Unpaired,
                },
            );
            let _ = socket.close(None);
            return Ok(false);
        }
    }
}

/// The conversation's own state: what this connection is, and how many pairing
/// attempts it has spent.
struct Conversation<'a> {
    surface: &'a Arc<dyn Surface>,
    paired: &'a mut Option<String>,
    token: &'a mut Option<String>,
    wrong_codes: &'a mut u32,
}

impl Conversation<'_> {
    /// Handle one text frame.
    fn handle(&mut self, text: &str, socket: &mut WebSocket<TcpStream>) -> io::Result<Outcome> {
        let frame = match ClientFrame::parse(text) {
            Ok(frame) => frame,
            Err(refusal) => {
                // A frame the Host cannot read still gets an answer where an id
                // could be found, so the client knows which of its commands was
                // refused.
                return send(socket, &ServerFrame::from(refusal)).map(|()| Outcome::Keep);
            }
        };

        match frame {
            ClientFrame::Hello { token: presented } => {
                let device = presented
                    .as_ref()
                    .and_then(|presented| self.surface.device(presented.as_str()));
                match (&presented, &device) {
                    (Some(presented), Some(device)) => {
                        *self.paired = Some(device.id.as_str().to_owned());
                        *self.token = Some(presented.as_str().to_owned());
                        self.welcome(Some(device.clone()), socket)?;
                    }
                    // A token the Host never issued, or one it has revoked: this
                    // is a connection that has not paired, and is told so by a
                    // welcome with no device rather than by an error. Whether
                    // that is a reason to leave is the client's judgement.
                    _ => {
                        *self.paired = None;
                        *self.token = None;
                        self.welcome(None, socket)?;
                    }
                }
                Ok(Outcome::Keep)
            }
            ClientFrame::Command { id, action } => {
                if let Err(error) = host_core::permitted(&action, self.paired.is_some()) {
                    send(
                        socket,
                        &ServerFrame::Refusal {
                            id: Some(id),
                            error,
                        },
                    )?;
                    return Ok(Outcome::Keep);
                }

                match self.surface.dispatch(action) {
                    Ok(response) => {
                        // A pairing answers with the token this connection now
                        // holds; adopting it here is what makes the rest of the
                        // conversation a paired one without a second greeting.
                        if let Some(Answer::Paired {
                            device,
                            token: issued,
                        }) = &response.answer
                        {
                            *self.paired = Some(device.id.as_str().to_owned());
                            *self.token = Some(issued.as_str().to_owned());
                        }
                        send(socket, &ServerFrame::Reply { id, response })?;
                        Ok(Outcome::Keep)
                    }
                    Err(error) => {
                        if matches!(error, ActionError::Pairing) {
                            *self.wrong_codes += 1;
                        }
                        let exhausted = *self.wrong_codes >= MAX_PAIRING_ATTEMPTS;
                        send(
                            socket,
                            &ServerFrame::Refusal {
                                id: Some(id),
                                error,
                            },
                        )?;
                        Ok(if exhausted {
                            Outcome::Stop
                        } else {
                            Outcome::Keep
                        })
                    }
                }
            }
        }
    }

    /// The greeting's answer, and — for a connection that paired — the state as
    /// it stands, so a client that reconnected after a network blip is not left
    /// holding a stale view (#31).
    fn welcome(
        &self,
        device: Option<DeviceSummary>,
        socket: &mut WebSocket<TcpStream>,
    ) -> io::Result<()> {
        let paired = device.is_some();
        send(socket, &ServerFrame::Welcome { device })?;
        if paired {
            send(
                socket,
                &ServerFrame::Snapshot(Box::new(self.surface.snapshot())),
            )?;
        }
        Ok(())
    }
}

fn send(socket: &mut WebSocket<TcpStream>, frame: &ServerFrame) -> io::Result<()> {
    socket
        .send(Message::Text(frame.to_json().into()))
        .map_err(|error| io::Error::other(error.to_string()))
}

/// Whether the conversation continues.
enum Outcome {
    Keep,
    Stop,
}

/// The Host's published Snapshots, fanned out to whoever is asking.
///
/// A queue per connection rather than one shared queue: each connection reads at
/// its own pace, and one that has gone away must not hold the others back. A
/// sender whose receiver has been dropped is removed the next time the Host
/// publishes — the cleanup is lazy because a connection that has gone away is
/// discovered by the send that fails, not by anything it says.
#[derive(Clone, Default)]
pub struct Broadcast {
    sinks: Arc<Mutex<Vec<Sender<Snapshot>>>>,
}

impl Broadcast {
    pub fn new() -> Self {
        Self::default()
    }

    /// A queue for one connection, which stops receiving when it is dropped.
    pub fn subscribe(&self) -> Subscription {
        let (sender, receiver) = mpsc::channel();
        self.sinks
            .lock()
            .expect("nothing panics while publishing Snapshots")
            .push(sender);
        Subscription { receiver }
    }

    /// Hand every published Snapshot to every connection that is still there.
    pub fn publish(&self, snapshot: &Snapshot) {
        let mut sinks = self
            .sinks
            .lock()
            .expect("nothing panics while publishing Snapshots");
        sinks.retain(|sink| sink.send(snapshot.clone()).is_ok());
    }
}

/// One connection's queue of published Snapshots.
pub struct Subscription {
    receiver: Receiver<Snapshot>,
}

impl Subscription {
    fn try_recv(&self) -> Option<Snapshot> {
        self.receiver.try_recv().ok()
    }
}
