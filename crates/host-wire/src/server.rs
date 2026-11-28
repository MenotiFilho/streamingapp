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
//! this one are blocking, and a connection thread with a read timeout keeps
//! greetings, pairing, changes, pushed Snapshots and pings moving while a
//! small per-connection worker pool resolves questions off-thread.
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
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::{self, Receiver, Sender, SyncSender};
use std::sync::{Arc, Mutex, Weak};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use host_core::{
    Action, ActionError, Answer, ClientFrame, DeviceId, DeviceSummary, DeviceToken, Response,
    RevisionSink, ServerFrame, Snapshot,
};
use tungstenite::protocol::{Message, Role, WebSocket};

use crate::http;
use crate::remote_page;

/// How long a connection waits for a client's frame before looking at what the
/// Host has published. Small enough that a pushed Snapshot arrives as the eye
/// reads it, large enough that an idle connection is not a busy loop.
const READ_TIMEOUT: Duration = Duration::from_millis(200);

/// How often the listener looks at whether it has been asked to stop.
const ACCEPT_PAUSE: Duration = Duration::from_millis(25);

/// How long a connection's request may take to arrive. A phone sends it the
/// moment its socket opens, and gives up on a socket that has not opened after
/// eight seconds; a request still missing after this is not coming, and the
/// thread waiting for it is let go.
const HEAD_TIMEOUT: Duration = Duration::from_secs(10);

/// How often an idle connection is pinged. The browser answers at the framing
/// layer, so this costs the page nothing and keeps a home router's mapping for
/// a phone whose screen has been off for a while.
const PING_EVERY: Duration = Duration::from_secs(20);

/// How long a connection may say nothing — not even a pong — before the Host
/// hangs up on it.
///
/// A locked phone's browser stops answering pings, but its connection is
/// usually still there when it wakes, and the page asks the Host the moment it
/// is looked at again. Hanging up after a minute turned every unlock into a
/// reconnect. A peer that has really gone is found sooner by the pings
/// themselves: nobody acknowledges them, and the socket's own retries give up.
/// This bound is for a peer whose network still answers and whose page never
/// comes back.
const IDLE_TIMEOUT: Duration = Duration::from_secs(10 * 60);

/// How many wrong pairing codes one connection may offer before the Host hangs
/// up on it. A six-character code is thirty bits; five guesses is not a way to
/// find one, and a client that has mistyped five times can reconnect.
const MAX_PAIRING_ATTEMPTS: u32 = 5;

/// The port the Host prefers for its wire server. A memorable number rather than
/// a random one, so `host:8090` is worth writing down; a Host that cannot have it
/// binds whatever the operating system offers and says so.
pub const DEFAULT_PORT: u16 = 8090;

/// Maximum concurrent question workers per connection.
///
/// Questions run off the connection thread so slow fetches never hold up
/// playback controls, greetings, pings or pushed Snapshots; a client that
/// floods questions queues behind this bound instead of spawning unbounded
/// threads.
pub const QUESTION_WORKERS: usize = 4;

/// How many questions one connection may have waiting for a worker.
///
/// Home asks four at a time (#112), so a client that reaches this is asking far
/// faster than it can be answered, and is refused rather than queued without end.
pub const QUESTION_QUEUE: usize = 64;

/// The Host, as the wire server reaches it.
///
/// The same three things a remote client needs and no more: take an Action, name
/// a token, and read the state as it stands. Implemented in the app shell over
/// the same handle the Tauri bridge uses, and in this crate's tests over a real
/// [`host_core::Host`].
pub trait Surface: Send + Sync + 'static {
    /// Take an Action through the one door. The shell's implementation publishes
    /// what the Action published, exactly as the window's does, and hands back
    /// any Answer that arrives after the Response to `revisions` — the client
    /// whose connection asked (ADR-0038 §2).
    fn dispatch(
        &self,
        action: Action,
        revisions: Arc<dyn RevisionSink>,
    ) -> Result<Response, ActionError>;

    /// The device a presented token belongs to, or nothing: a token this Host
    /// never issued, or one issued to a device that has been revoked. Asked at
    /// the moment of every command and every push, because a revoke is a change
    /// and a connection should not be believed about itself.
    fn device(&self, token: &DeviceToken) -> Option<DeviceSummary>;

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
                        if let Err(error) = serve(&surface, &broadcast, stream, PING_EVERY) {
                            // A request that ends before it is answered — a page
                            // load abandoned, a handshake cut short — is the
                            // ordinary end of a connection, not a failure of the
                            // Host's. A conversation logs its own end.
                            tracing::debug!(%peer, %error, "a remote request ended");
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
    ping_every: Duration,
) -> io::Result<()> {
    // The listener is non-blocking so it can notice `stop`, and on Windows a
    // socket accepted from it is non-blocking too (Linux does not pass the flag
    // on). A connection's I/O is meant to block: a read waits out
    // `READ_TIMEOUT`, and a write waits for the phone to read. Non-blocking, a
    // read returned at once — each connection's thread spun a whole core, and a
    // request that had not quite arrived was refused before its handshake — and
    // a write that did not fit the socket's buffer at once failed, which hung
    // up on a phone every time a press published a Snapshot.
    stream.set_nonblocking(false)?;
    stream.set_read_timeout(Some(HEAD_TIMEOUT))?;
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
        return remote_page::serve(&mut stream, &request);
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

    let peer = stream.peer_addr().ok();
    let mut socket = WebSocket::from_raw_socket(stream, Role::Server, None);
    connection(surface, broadcast, &mut socket, peer, ping_every)
}

/// The conversation: a greeting, then commands, with pushed Snapshots between.
///
/// Its end is logged once, with why it ended and the device it was, so a phone
/// that keeps reconnecting is something the owner can read in the log rather
/// than guess at.
fn connection(
    surface: &Arc<dyn Surface>,
    broadcast: &Broadcast,
    socket: &mut WebSocket<TcpStream>,
    peer: Option<SocketAddr>,
    ping_every: Duration,
) -> io::Result<()> {
    let opened = Instant::now();
    let mut device = None;
    let ended = converse(surface, broadcast, socket, peer, &mut device, ping_every);
    let why = match &ended {
        Ok(why) => why.clone(),
        Err(error) => format!("it failed: {error}"),
    };
    tracing::info!(
        peer = %Peer(peer),
        device = device.as_deref().unwrap_or("none"),
        seconds = opened.elapsed().as_secs(),
        why,
        "a remote connection ended"
    );
    ended.map(|_| ())
}

/// A connection's address as a log line spells it.
struct Peer(Option<SocketAddr>);

impl std::fmt::Display for Peer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self.0 {
            Some(peer) => write!(f, "{peer}"),
            None => f.write_str("unknown"),
        }
    }
}

/// The conversation's loop, answering why it ended.
fn converse(
    surface: &Arc<dyn Surface>,
    broadcast: &Broadcast,
    socket: &mut WebSocket<TcpStream>,
    peer: Option<SocketAddr>,
    device: &mut Option<String>,
    ping_every: Duration,
) -> io::Result<String> {
    let subscription = broadcast.subscribe();
    let mut questions = QuestionPool::new(surface.clone());
    // Declared after the pool, so it is dropped first: what is still queued is
    // abandoned before the workers can see that the queue has closed.
    let mut owed = Owed::new();
    let mut paired: Option<Arc<Paired>> = None;
    let mut wrong_codes = 0u32;
    let mut last_seen = Instant::now();
    let mut last_ping = Instant::now();

    loop {
        let quiet = match socket.read() {
            Ok(Message::Text(text)) => {
                last_seen = Instant::now();
                let mut conversation = Conversation {
                    surface,
                    questions: &mut questions,
                    owed: &mut owed,
                    paired: &mut paired,
                    wrong_codes: &mut wrong_codes,
                };
                let outcome = conversation.handle(&text, socket)?;
                if let Some(now_paired) = &paired {
                    if device.as_deref() != Some(now_paired.name.as_str()) {
                        tracing::info!(
                            peer = %Peer(peer),
                            device = now_paired.name.as_str(),
                            "a remote device connected"
                        );
                        *device = Some(now_paired.name.clone());
                    }
                }
                if let Outcome::Stop(why) = outcome {
                    let _ = socket.close(None);
                    let _ = socket.flush();
                    return Ok(why.to_owned());
                }
                false
            }
            Ok(Message::Close(frame)) => {
                // The Remote says why when it lets a socket go on purpose.
                return Ok(match frame {
                    Some(frame) if !frame.reason.is_empty() => format!(
                        "the device closed it ({}: {})",
                        u16::from(frame.code),
                        frame.reason
                    ),
                    Some(frame) => format!("the device closed it ({})", u16::from(frame.code)),
                    None => "the device closed it".to_owned(),
                });
            }
            // A ping is answered by the framing layer on the next write; a pong
            // is the answer this Host asked for, and either is proof the client
            // is still there. A binary frame has no meaning here.
            Ok(_) => {
                last_seen = Instant::now();
                false
            }
            Err(tungstenite::Error::Io(error))
                if matches!(
                    error.kind(),
                    io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
                ) =>
            {
                // Nobody said anything.
                true
            }
            Err(error) => return Ok(format!("the connection dropped: {error}")),
        };

        // Judged before the push, after a read: a thread that was held in a
        // write to a frozen phone reads the pongs that queued meanwhile before
        // it decides the phone said nothing.
        match keepalive(Instant::now(), last_seen, last_ping, quiet, ping_every) {
            Keepalive::Close => {
                let _ = socket.close(None);
                let _ = socket.flush();
                return Ok(format!(
                    "it said nothing for {} minutes",
                    IDLE_TIMEOUT.as_secs() / 60
                ));
            }
            Keepalive::Ping => {
                last_ping = Instant::now();
                // The reply is the browser's, not the page's: a phone whose page
                // is merely hidden answers it, and a frozen or a dead one does not.
                let _ = socket.send(Message::Ping(Vec::new().into()));
            }
            Keepalive::None => {}
        }

        // The Host's own news, on the way to every client allowed to hear it,
        // and then what this one asked for.
        if !push(surface, &subscription, &paired, socket)?
            || !send_owed(surface, &owed, &paired, socket)?
        {
            return Ok("the device was revoked".to_owned());
        }
    }
}

/// What a connection's own clock says to do after a read.
#[derive(Debug, PartialEq, Eq)]
enum Keepalive {
    /// Nothing yet: keep reading, and keep looking for published state.
    None,
    /// The connection has been quiet long enough to ask whether anyone is there.
    Ping,
    /// The connection has said nothing, not even a pong, for too long.
    Close,
}

/// The liveness decision at the two edges it defines: a connection is pinged
/// after one quiet interval, and closed only after a longer one with no answer.
///
/// Both are decided only after a read that found nothing (`quiet`): a
/// connection that has just said something is plainly there, and one whose
/// thread was busy has not been read since, so its silence is not yet known.
fn keepalive(
    now: Instant,
    last_seen: Instant,
    last_ping: Instant,
    quiet: bool,
    ping_every: Duration,
) -> Keepalive {
    if !quiet {
        Keepalive::None
    } else if now.saturating_duration_since(last_seen) >= IDLE_TIMEOUT {
        Keepalive::Close
    } else if now.saturating_duration_since(last_ping) >= ping_every {
        Keepalive::Ping
    } else {
        Keepalive::None
    }
}

/// What a connection is: the device it paired as, and the token that says so.
///
/// The two travel together and are never apart — a token without a device is
/// nothing to check against, and a device without its token is not a connection.
struct Paired {
    id: DeviceId,
    token: DeviceToken,
    /// What the device is called, for the log line that says it connected.
    name: String,
}

impl Paired {
    /// Whether the Host still knows this device. Asked of the Host rather than
    /// remembered, so that a revoke is noticed at the next command and the next
    /// Snapshot rather than at some later convenience.
    fn still_known(&self, surface: &dyn Surface) -> bool {
        surface
            .device(&self.token)
            .is_some_and(|device| device.id == self.id)
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
    paired: &Option<Arc<Paired>>,
    socket: &mut WebSocket<TcpStream>,
) -> io::Result<bool> {
    let _ = socket.flush();
    loop {
        // A Snapshot is the whole state, not a delta: if this connection has
        // fallen behind, the newest one is the only one worth sending. A phone
        // that slept through a minute of playback should hear where the Host is
        // now, not replay every quarter-second it missed — and the subscription
        // holds no more than that one (see `Broadcast`).
        let Some(snapshot) = subscription.take() else {
            return Ok(true);
        };

        let Some(paired) = paired.as_ref() else {
            // A connection that has not paired is not told what is playing.
            continue;
        };
        // Asked of the Host now rather than remembered from the greeting: a
        // revoke is a change, and a connection holding a token that no longer
        // names a device is not a connection any more.
        if paired.still_known(&**surface) {
            send(socket, &ServerFrame::Snapshot(Box::new(snapshot)))?;
        } else {
            cut_off(socket);
            return Ok(false);
        }
    }
}

/// Tell a connection its device is not paired any more, and close it
/// (ADR-0017 §6).
fn cut_off(socket: &mut WebSocket<TcpStream>) {
    let _ = send(
        socket,
        &ServerFrame::Refusal {
            id: None,
            error: ActionError::Unpaired,
        },
    );
    let _ = socket.close(None);
}

/// The conversation's own state: what this connection is, and how many pairing
/// attempts it has spent.
struct Conversation<'a> {
    surface: &'a Arc<dyn Surface>,
    questions: &'a mut QuestionPool,
    owed: &'a mut Owed,
    paired: &'a mut Option<Arc<Paired>>,
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
            ClientFrame::Hello { token } => {
                let device = token.as_ref().and_then(|token| self.surface.device(token));
                // A token the Host never issued, or one it has revoked, makes
                // this a connection that has not paired, and it is told so by a
                // welcome with no device rather than by an error. Whether that
                // is a reason to leave is the client's judgement.
                let greeted = token.zip(device.as_ref()).map(|(token, device)| {
                    Arc::new(Paired {
                        id: device.id.clone(),
                        token,
                        name: device.name.as_str().to_owned(),
                    })
                });
                // A client greets again to see that the Host is there, so only
                // a greeting that changes who this connection is gives up what
                // it has asked.
                if self.paired.as_ref().map(|paired| &paired.id)
                    != greeted.as_ref().map(|paired| &paired.id)
                {
                    self.abandon_questions();
                }
                *self.paired = greeted;
                self.welcome(device, socket)?;
                Ok(Outcome::Keep)
            }
            ClientFrame::Command { id, action } => {
                // The Host is asked now rather than believed from the greeting:
                // a device revoked between two commands is not a paired
                // connection any more, and the question has to be asked when the
                // command arrives or one slips through before the next Snapshot
                // would have noticed.
                let known = self
                    .paired
                    .as_ref()
                    .is_some_and(|paired| paired.still_known(&**self.surface));
                if self.paired.is_some() && !known {
                    *self.paired = None;
                    send(
                        socket,
                        &ServerFrame::Refusal {
                            id: Some(id),
                            error: ActionError::Unpaired,
                        },
                    )?;
                    return Ok(Outcome::Stop("the device was revoked"));
                }

                if let Err(error) = host_core::permitted(&action, known) {
                    send(
                        socket,
                        &ServerFrame::Refusal {
                            id: Some(id),
                            error,
                        },
                    )?;
                    return Ok(Outcome::Keep);
                }

                // Questions resolve outside the change lock (ADR-0022), so they
                // run on this connection's bounded worker pool and never hold up
                // greetings, changes, pairing, pushed Snapshots or pings.
                if let (true, Some(asker)) = (action.is_question(), self.paired.as_ref()) {
                    let job = QuestionJob {
                        id,
                        action,
                        asker: asker.clone(),
                        asking: self.owed.asking.clone(),
                    };
                    if let Err(error) = self.questions.submit(job) {
                        send(
                            socket,
                            &ServerFrame::Refusal {
                                id: Some(id),
                                error,
                            },
                        )?;
                    }
                    return Ok(Outcome::Keep);
                }

                let revisions = self.owed.asking.revisions.clone();
                match self.surface.dispatch(action, revisions) {
                    Ok(mut response) => {
                        // A pairing answers with the token this connection now
                        // holds; adopting it here is what makes the rest of the
                        // conversation a paired one without a second greeting.
                        if let Some(Answer::Paired {
                            device,
                            token: issued,
                        }) = &response.answer
                        {
                            *self.paired = Some(Arc::new(Paired {
                                id: device.id.clone(),
                                token: issued.clone(),
                                name: device.name.as_str().to_owned(),
                            }));
                        }
                        // The Snapshots were already published by the
                        // `WireSurface` that took the Action; the connection
                        // receives them through `push`. A Reply is the answer
                        // this client asked for, not a second copy of state —
                        // which was 42 KB of duplicated state per command.
                        response.snapshots.clear();
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
                            Outcome::Stop("too many wrong pairing codes")
                        } else {
                            Outcome::Keep
                        })
                    }
                }
            }
        }
    }

    /// Give up what this connection has asked and not yet been told: it is
    /// owed to the device that asked, which this connection has stopped being.
    fn abandon_questions(&mut self) {
        *self.owed = Owed::new();
        self.questions.discard_queued();
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

/// One connection's way to be told a revised Answer after its Reply.
///
/// The sender is kept in the background job a stale open queued; the connection
/// thread reads the other end beside the Snapshots it pushes. A connection that
/// has gone drops the receiver, and the send quietly fails.
struct ConnectionRevisions {
    sender: Sender<Answer>,
}

impl RevisionSink for ConnectionRevisions {
    fn revise(&self, answer: Answer) {
        let _ = self.sender.send(answer);
    }
}

/// What a connection is owed for what it has asked as the device it is now: its
/// questions' Replies, and the Answers revised after them.
///
/// A revised Title goes only to the client whose open queued the refresh, so the
/// channels are per connection and not a broadcast (ADR-0038 §2). This is
/// replaced when the connection stops being that device and dropped when the
/// connection ends, and either abandons whatever was queued or undelivered.
struct Owed {
    replies: Receiver<ServerFrame>,
    revisions: Receiver<Answer>,
    asking: Asking,
}

/// The asking side of [`Owed`], carried by every question asked under it.
#[derive(Clone)]
struct Asking {
    abandoned: Arc<AtomicBool>,
    replies: Sender<ServerFrame>,
    revisions: Arc<dyn RevisionSink>,
}

impl Owed {
    fn new() -> Self {
        let (reply_sender, replies) = mpsc::channel();
        let (revision_sender, revisions) = mpsc::channel();
        Self {
            replies,
            revisions,
            asking: Asking {
                abandoned: Arc::new(AtomicBool::new(false)),
                replies: reply_sender,
                revisions: Arc::new(ConnectionRevisions {
                    sender: revision_sender,
                }),
            },
        }
    }
}

impl Drop for Owed {
    fn drop(&mut self) {
        self.asking.abandoned.store(true, Ordering::SeqCst);
    }
}

/// Write every revised Answer, and every question's Reply or Refusal, that has
/// arrived for this connection — to a device the Host knows now and to no other.
///
/// Answers whether the connection is still wanted, as [`push`] does: a question
/// asked before a revoke may well be answered after it.
fn send_owed(
    surface: &Arc<dyn Surface>,
    owed: &Owed,
    paired: &Option<Arc<Paired>>,
    socket: &mut WebSocket<TcpStream>,
) -> io::Result<bool> {
    let revised = owed
        .revisions
        .try_iter()
        .map(|answer| ServerFrame::Revision(Box::new(answer)));
    for frame in revised.chain(owed.replies.try_iter()) {
        let known = paired
            .as_ref()
            .is_some_and(|paired| paired.still_known(&**surface));
        if !known {
            cut_off(socket);
            return Ok(false);
        }
        send(socket, &frame)?;
    }
    Ok(true)
}

/// A question waiting for a worker, and who asked it.
struct QuestionJob {
    id: u64,
    action: Action,
    asker: Arc<Paired>,
    asking: Asking,
}

/// Decrements `outstanding` even if a test double panics inside `dispatch`.
struct OutstandingGuard(Arc<AtomicUsize>);

impl Drop for OutstandingGuard {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

/// One connection's bounded worker pool for questions.
///
/// Workers are spawned lazily up to [`QUESTION_WORKERS`] so idle or unpaired
/// connections own no extra threads, and a flood of questions queues behind them
/// rather than spawning unbounded threads, up to [`QUESTION_QUEUE`] of them.
///
/// Dropping the pool closes the queue, which lets every idle worker exit; one
/// still inside `dispatch` finishes its ask and then exits, without stalling the
/// connection's teardown.
struct QuestionPool {
    surface: Arc<dyn Surface>,
    sender: SyncSender<QuestionJob>,
    receiver: Arc<Mutex<Receiver<QuestionJob>>>,
    outstanding: Arc<AtomicUsize>,
    spawned: usize,
}

impl QuestionPool {
    fn new(surface: Arc<dyn Surface>) -> Self {
        let (sender, receiver) = mpsc::sync_channel(QUESTION_QUEUE);
        Self {
            surface,
            sender,
            receiver: Arc::new(Mutex::new(receiver)),
            outstanding: Arc::new(AtomicUsize::new(0)),
            spawned: 0,
        }
    }

    /// Queue a question for a worker, or refuse it when the queue is full.
    fn submit(&mut self, job: QuestionJob) -> Result<(), ActionError> {
        let need = self.outstanding.fetch_add(1, Ordering::SeqCst) + 1;
        if need > self.spawned && self.spawned < QUESTION_WORKERS && self.spawn_worker() {
            self.spawned += 1;
        }
        if self.spawned == 0 {
            // No thread could be had: answer it here rather than not at all.
            let _guard = OutstandingGuard(self.outstanding.clone());
            answer_question(&self.surface, job);
            return Ok(());
        }
        // The pool holds the receiver, so a full queue is the only refusal.
        self.sender.try_send(job).map_err(|_| {
            self.outstanding.fetch_sub(1, Ordering::SeqCst);
            ActionError::TooManyQuestions {
                limit: QUESTION_QUEUE,
            }
        })
    }

    /// Empty the queue, so abandoned questions take none of its room.
    ///
    /// A worker holding the receiver is waiting on an empty queue, and one that
    /// takes a question first finds it abandoned.
    fn discard_queued(&self) {
        if let Ok(receiver) = self.receiver.try_lock() {
            for _abandoned in receiver.try_iter() {
                self.outstanding.fetch_sub(1, Ordering::SeqCst);
            }
        }
    }

    fn spawn_worker(&self) -> bool {
        let surface = self.surface.clone();
        let receiver = self.receiver.clone();
        let outstanding = self.outstanding.clone();

        thread::Builder::new()
            .name("host-wire-question".to_owned())
            .spawn(move || loop {
                let job = {
                    let guard = receiver
                        .lock()
                        .expect("nothing panics while taking a question");
                    guard.recv()
                };
                let Ok(job) = job else {
                    break;
                };
                let _guard = OutstandingGuard(outstanding.clone());
                answer_question(&surface, job);
            })
            .is_ok()
    }
}

/// Ask a question and send back its answer — unless, since it was queued, the
/// connection has given it up or the Host has stopped knowing the device that
/// asked (ADR-0045 §3).
fn answer_question(surface: &Arc<dyn Surface>, job: QuestionJob) {
    if job.asking.abandoned.load(Ordering::SeqCst) || !job.asker.still_known(&**surface) {
        return;
    }
    let frame = dispatch_question(surface, &job.asking.revisions, job.id, job.action);
    let _ = job.asking.replies.send(frame);
}

fn dispatch_question(
    surface: &Arc<dyn Surface>,
    revisions: &Arc<dyn RevisionSink>,
    id: u64,
    action: Action,
) -> ServerFrame {
    match surface.dispatch(action, revisions.clone()) {
        Ok(mut response) => {
            // The Snapshots were already published by the `Surface` that took
            // the Action; the connection receives them through `push`.
            response.snapshots.clear();
            ServerFrame::Reply { id, response }
        }
        Err(error) => ServerFrame::Refusal {
            id: Some(id),
            error,
        },
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
    /// The Host ends the conversation, for the reason its log line gives.
    Stop(&'static str),
}

/// The Host's published Snapshots, fanned out to whoever is asking.
///
/// One slot per connection rather than one shared queue: each connection reads
/// at its own pace, and one that has gone away must not hold the others back.
/// And a slot rather than a queue: a Snapshot is the whole state, so the newest
/// one a connection has not sent is all it will ever send, and a publish
/// replaces what was waiting. A connection whose thread is held in a write — a
/// phone that froze its page while the Host was playing, its socket's buffers
/// full — then holds one Snapshot, not every one published until it lets go.
///
/// A connection that has gone away is forgotten the next time the Host
/// publishes: its slot is dropped with its subscription, so the cleanup is lazy
/// and needs nothing from the connection that went.
#[derive(Clone, Default)]
pub struct Broadcast {
    slots: Arc<Mutex<Vec<Weak<Slot>>>>,
}

/// The newest Snapshot one connection has not sent yet, if any.
type Slot = Mutex<Option<Snapshot>>;

impl Broadcast {
    pub fn new() -> Self {
        Self::default()
    }

    /// A slot for one connection, which stops receiving when it is dropped.
    pub fn subscribe(&self) -> Subscription {
        let slot = Arc::new(Slot::default());
        self.slots
            .lock()
            .expect("nothing panics while publishing Snapshots")
            .push(Arc::downgrade(&slot));
        Subscription { slot }
    }

    /// Put a published Snapshot in front of every connection that is still there.
    pub fn publish(&self, snapshot: &Snapshot) {
        let mut slots = self
            .slots
            .lock()
            .expect("nothing panics while publishing Snapshots");
        slots.retain(|slot| {
            let Some(slot) = slot.upgrade() else {
                return false;
            };
            *slot.lock().expect("nothing panics while holding a slot") = Some(snapshot.clone());
            true
        });
    }

    /// How many connections are being published to.
    #[cfg(test)]
    fn connections(&self) -> usize {
        self.slots
            .lock()
            .expect("nothing panics while publishing Snapshots")
            .len()
    }
}

/// One connection's slot of published Snapshots.
pub struct Subscription {
    slot: Arc<Slot>,
}

impl Subscription {
    /// The newest Snapshot published since this connection last took one.
    fn take(&self) -> Option<Snapshot> {
        self.slot
            .lock()
            .expect("nothing panics while holding a slot")
            .take()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::io::{Read, Write};

    use host_core::{
        AddonProvider, DeviceName, FixtureClock, FixtureFetcher, FixturePlayer, Host,
        InMemorySecretStore, InMemoryStore, WIRE_VERSION,
    };
    use serde_json::{json, Value};

    /// The state a fresh Host publishes, as a Snapshot to fan out.
    fn snapshot() -> Snapshot {
        let fetcher = Arc::new(FixtureFetcher::new());
        Host::new(
            Arc::new(InMemoryStore::new()),
            fetcher.clone(),
            Arc::new(InMemorySecretStore::new()),
            Arc::new(AddonProvider::new(fetcher)),
            Arc::new(FixturePlayer::new()),
            Arc::new(FixtureClock::new()),
        )
        .expect("a Host over in-memory seams starts")
        .snapshot()
    }

    /// A Host that knows one device by any token, with as much state as a case
    /// gives it.
    struct Roomy {
        device: DeviceSummary,
        state: Snapshot,
    }

    impl Surface for Roomy {
        fn dispatch(
            &self,
            _action: Action,
            _revisions: Arc<dyn RevisionSink>,
        ) -> Result<Response, ActionError> {
            Ok(Response {
                snapshots: Vec::new(),
                answer: None,
            })
        }

        fn device(&self, _token: &DeviceToken) -> Option<DeviceSummary> {
            Some(self.device.clone())
        }

        fn snapshot(&self) -> Snapshot {
            self.state.clone()
        }
    }

    /// The device every `Roomy` Host knows.
    fn phone() -> DeviceSummary {
        DeviceSummary {
            id: DeviceId::parse("phone").expect("a device id"),
            name: DeviceName::parse("Phone").expect("a device name"),
            paired_at: 1_700_000_000_000,
        }
    }

    /// One accepted connection, handed to `serve` the way Windows hands it over:
    /// accepted from the listener's non-blocking socket, and non-blocking itself
    /// (Linux does not pass the flag on, so a suite running there sets it).
    fn serve_as_windows_accepts(state: Snapshot) -> (TcpStream, JoinHandle<()>) {
        let surface: Arc<dyn Surface> = Arc::new(Roomy {
            device: phone(),
            state,
        });
        serve_one(surface, PING_EVERY)
    }

    /// One accepted connection over `surface`, pinged as often as a case asks.
    fn serve_one(surface: Arc<dyn Surface>, ping_every: Duration) -> (TcpStream, JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("a loopback port");
        let client =
            TcpStream::connect(listener.local_addr().expect("an address")).expect("connects");
        let (accepted, _) = listener.accept().expect("accepts");
        accepted
            .set_nonblocking(true)
            .expect("the accepted socket can be made non-blocking");
        client
            .set_read_timeout(Some(Duration::from_secs(10)))
            .expect("the client can be given a read timeout");

        let serving = thread::spawn(move || {
            let _ = serve(&surface, &Broadcast::new(), accepted, ping_every);
        });
        (client, serving)
    }

    const UPGRADE: &[u8] = b"GET / HTTP/1.1\r\nHost: host\r\nUpgrade: websocket\r\n\
        Connection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\
        Sec-WebSocket-Version: 13\r\n\r\n";

    /// The response head the Host wrote, or what it wrote before it hung up.
    fn response_head(client: &mut TcpStream) -> String {
        let mut head = Vec::new();
        let mut byte = [0u8; 1];
        while !head.ends_with(b"\r\n\r\n") {
            match client.read(&mut byte) {
                Ok(1) => head.push(byte[0]),
                _ => break,
            }
        }
        String::from_utf8_lossy(&head).into_owned()
    }

    #[test]
    fn a_request_that_arrives_after_its_connection_is_still_answered() {
        // A phone's request reaches the Host a moment after its connection
        // does. A non-blocking read found nothing yet and hung up, and the
        // Remote said "Connecting" while its attempts were refused one by one.
        let (mut client, serving) = serve_as_windows_accepts(snapshot());
        thread::sleep(Duration::from_millis(100));
        client.write_all(UPGRADE).expect("the request is sent");

        let head = response_head(&mut client);
        assert!(
            head.starts_with("HTTP/1.1 101"),
            "the Host answers the upgrade: {head:?}"
        );

        drop(client);
        serving.join().expect("the connection's thread ends");
    }

    #[test]
    fn a_snapshot_larger_than_the_sockets_buffers_arrives_whole() {
        // A press is answered with a Reply and the Snapshot it published, and a
        // Snapshot is tens of kilobytes. A non-blocking write that did not fit
        // the socket's buffer at once failed, and the Host hung up on the phone
        // that pressed: the Remote flickered to "Reconnecting" on every control.
        let mut state = snapshot();
        // About 14 MB: past what the two sockets buffer, short of a frame's 16 MB.
        state.devices = vec![phone(); 250_000];
        let devices = state.devices.len();
        let (mut client, serving) = serve_as_windows_accepts(state);
        client.write_all(UPGRADE).expect("the request is sent");
        let head = response_head(&mut client);
        assert!(head.starts_with("HTTP/1.1 101"), "{head:?}");

        let mut socket = WebSocket::from_raw_socket(client, Role::Client, None);
        socket
            .send(Message::Text(
                json!({ "version": WIRE_VERSION, "hello": { "token": "a".repeat(43) } })
                    .to_string()
                    .into(),
            ))
            .expect("the greeting is sent");
        // The phone is busy drawing for a moment before it reads.
        thread::sleep(Duration::from_millis(300));

        let mut snapshot_devices = None;
        while snapshot_devices.is_none() {
            match socket.read() {
                Ok(Message::Text(text)) => {
                    let frame: Value = serde_json::from_str(&text).expect("the Host writes JSON");
                    if let Some(snapshot) = frame.get("snapshot") {
                        snapshot_devices = snapshot["devices"].as_array().map(Vec::len);
                    }
                }
                Ok(_) => {}
                Err(error) => panic!("the Host hung up before the Snapshot arrived: {error}"),
            }
        }
        assert_eq!(snapshot_devices, Some(devices));

        drop(socket);
        serving.join().expect("the connection's thread ends");
    }

    #[test]
    fn a_connection_that_cannot_write_holds_the_newest_snapshot_and_nothing_older() {
        // A phone that froze its page while the Host was playing stops reading;
        // its connection's thread is held in a write, and the Host publishes a
        // Snapshot every second meanwhile. What waits for that connection is the
        // one it will send when the write lets go — not every one it missed.
        let broadcast = Broadcast::new();
        let subscription = broadcast.subscribe();
        let mut published = snapshot();
        for revision in 1..=1_000 {
            published.revision = revision;
            broadcast.publish(&published);
        }

        assert_eq!(
            subscription.take().map(|snapshot| snapshot.revision),
            Some(1_000)
        );
        assert!(
            subscription.take().is_none(),
            "nothing older is queued behind the newest"
        );
    }

    #[test]
    fn a_connection_that_has_gone_is_not_published_to() {
        let broadcast = Broadcast::new();
        let kept = broadcast.subscribe();
        drop(broadcast.subscribe());

        broadcast.publish(&snapshot());

        assert!(kept.take().is_some());
        assert_eq!(
            broadcast.connections(),
            1,
            "the gone connection is forgotten"
        );
    }

    #[test]
    fn a_quiet_connection_is_pinged_before_it_is_closed() {
        let now = Instant::now();
        assert_eq!(keepalive(now, now, now, true, PING_EVERY), Keepalive::None);
        assert_eq!(
            keepalive(now, now - PING_EVERY, now - PING_EVERY, true, PING_EVERY),
            Keepalive::Ping
        );
        assert_eq!(
            keepalive(
                now,
                now - IDLE_TIMEOUT,
                now - Duration::from_secs(1),
                true,
                PING_EVERY
            ),
            Keepalive::Close
        );
    }

    #[test]
    fn a_phone_asleep_for_minutes_is_pinged_and_not_hung_up_on() {
        // A locked phone's browser stops answering pings, but its connection is
        // usually still there when it wakes. Hanging up after a minute made
        // every unlock a reconnect.
        let now = Instant::now();
        let asleep = now - Duration::from_secs(5 * 60);
        assert_eq!(
            keepalive(now, asleep, now - PING_EVERY, true, PING_EVERY),
            Keepalive::Ping
        );
        assert_eq!(
            keepalive(now, asleep, now, true, PING_EVERY),
            Keepalive::None
        );
    }

    #[test]
    fn a_connection_that_was_busy_writing_is_read_before_it_is_judged() {
        // A thread held in a write to a frozen phone cannot read the pongs that
        // queued meanwhile: silence is only silence once a read found nothing.
        let now = Instant::now();
        let long_ago = now - IDLE_TIMEOUT * 2;
        assert_eq!(
            keepalive(now, long_ago, now, false, PING_EVERY),
            Keepalive::None
        );
        assert_eq!(
            keepalive(now, long_ago, now, true, PING_EVERY),
            Keepalive::Close
        );
    }

    /// A Host that knows the phone and holds every question until it is let
    /// through, saying when each one has reached it.
    struct Gated {
        entered_tx: Sender<()>,
        gate_rx: Mutex<Receiver<()>>,
    }

    impl Surface for Gated {
        fn dispatch(
            &self,
            _action: Action,
            _revisions: Arc<dyn RevisionSink>,
        ) -> Result<Response, ActionError> {
            let _ = self.entered_tx.send(());
            let _ = self.gate_rx.lock().expect("gate mutex").recv();
            Ok(Response {
                snapshots: Vec::new(),
                answer: None,
            })
        }

        fn device(&self, _token: &DeviceToken) -> Option<DeviceSummary> {
            Some(phone())
        }

        fn snapshot(&self) -> Snapshot {
            snapshot()
        }
    }

    /// A [`Gated`] Host, what has reached it, and the way to let one through.
    fn gated() -> (Arc<dyn Surface>, Receiver<()>, Sender<()>) {
        let (entered_tx, entered_rx) = mpsc::channel();
        let (gate_tx, gate_rx) = mpsc::channel();
        let surface = Arc::new(Gated {
            entered_tx,
            gate_rx: Mutex::new(gate_rx),
        });
        (surface, entered_rx, gate_tx)
    }

    #[test]
    fn pings_keep_flowing_while_a_question_is_in_flight() {
        let (surface, entered, release) = gated();
        let (mut client, serving) = serve_one(surface, Duration::from_millis(50));
        client.write_all(UPGRADE).expect("the request is sent");
        let head = response_head(&mut client);
        assert!(head.starts_with("HTTP/1.1 101"), "{head:?}");

        let mut socket = WebSocket::from_raw_socket(client, Role::Client, None);
        for frame in [
            json!({ "version": WIRE_VERSION, "hello": { "token": "a".repeat(43) } }),
            json!({ "version": WIRE_VERSION, "id": 10, "command": { "type": "library" } }),
        ] {
            socket
                .send(Message::Text(frame.to_string().into()))
                .expect("the Host is listening");
        }
        entered
            .recv_timeout(Duration::from_secs(2))
            .expect("the question reaches the Host");

        // More than one ping, so one sent before the question cannot pass this.
        let mut pings = 0;
        while pings < 3 {
            match socket.read().expect("the Host is still answering") {
                Message::Ping(_) => pings += 1,
                Message::Text(text) => {
                    let frame: Value = serde_json::from_str(&text).expect("the Host writes JSON");
                    assert!(frame.get("id").is_none(), "still in flight: {frame}");
                }
                other => panic!("unexpected: {other:?}"),
            }
        }

        release.send(()).expect("release the question");
        loop {
            if let Message::Text(text) = socket.read().expect("the Host is still answering") {
                let frame: Value = serde_json::from_str(&text).expect("the Host writes JSON");
                if frame["id"] == 10 {
                    break;
                }
            }
        }

        drop(socket);
        serving.join().expect("the connection's thread ends");
    }

    #[test]
    fn a_question_pool_caps_workers_when_flooded() {
        let (surface, entered_rx, gate_tx) = gated();
        let owed = Owed::new();
        let asker = Arc::new(Paired {
            id: phone().id,
            token: DeviceToken::parse(&"a".repeat(43)).expect("a device token"),
            name: "Phone".to_owned(),
        });
        let mut pool = QuestionPool::new(surface);

        let total = QUESTION_WORKERS * 3;
        for id in 0..total {
            pool.submit(QuestionJob {
                id: id as u64,
                action: Action::Library,
                asker: asker.clone(),
                asking: owed.asking.clone(),
            })
            .expect("the queue has room");
        }

        assert_eq!(
            pool.spawned, QUESTION_WORKERS,
            "a flood beyond QUESTION_WORKERS never spawns extra threads"
        );
        for _ in 0..QUESTION_WORKERS {
            entered_rx
                .recv_timeout(Duration::from_secs(2))
                .expect("the bounded workers all enter");
        }
        assert!(
            entered_rx.try_recv().is_err(),
            "excess questions queue behind the worker bound"
        );

        for _ in 0..total {
            gate_tx.send(()).expect("release one worker");
        }
        for _ in 0..total {
            let frame = owed
                .replies
                .recv_timeout(Duration::from_secs(2))
                .expect("every queued question answers");
            assert!(matches!(frame, ServerFrame::Reply { .. }));
        }
    }
}
