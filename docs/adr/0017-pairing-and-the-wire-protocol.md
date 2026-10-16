# Pairing and the wire: one socket, one versioned codec, and a token per device

Ticket #31 ("Pairing and the wire protocol") turns the Action surface into
something a second device reaches: a duplex WebSocket on the Host's LAN address,
a pairing code that a client redeems once for a token of its own, device tokens
in storage, and an mDNS announcement with manual `host:port` as the fallback that
must work first. This records the decisions that shape it.

## 1. The protocol codec is pure and lives in `host-core`

`crates/host-core/src/wire.rs` holds the frames — a `ClientFrame` in
(`Hello`, `Command`) and a `ServerFrame` out (`Welcome`, `Reply`, `Refusal`,
`Snapshot`) — and their parsing and spelling. It knows nothing of sockets,
tokens, threads or who may say what. The one rule that is a rule rather than a
spelling, `permitted`, is pure too.

The codec sits in `host-core` and not in the transport crate because it is the
Host's own vocabulary written down, exactly as `Action::parse` already was: the
transport crate is outside `host-core` precisely because the network is not the
Host's business (ADR-0009), and a codec is not network.

**The wire version *is* the Action version.** `WIRE_VERSION = ACTION_VERSION`.
The version is read off the raw frame and judged before anything else in it, the
order the Action envelope already parses in, so a client that speaks another
version hears *that* rather than a complaint about an Action this Host has never
heard of — the clear, actionable error #31 asks for, in the vocabulary
`ActionError::UnsupportedVersion` already had. A second version number would be a
second place for a client and the Host to disagree about the same thing.

Rejected, with reasons: **a codec above the transport crate** (it would make the
socket the definition of the protocol, and the vocabulary would move out of
`host-core`); **jsonrpc-style framing** (a general spec this Host has no use for,
and a version tucked inside a `params` object is not judged first); **a separate
protocol version** (see above).

## 2. One port, one socket: the page and the WebSocket share it

`crates/host-wire/` is the transport: `http.rs` reads a request head a byte at a
time so nothing past it is consumed, answers the upgrade with its own `101` and
the `Sec-WebSocket-Accept` RFC 6455 derives, and otherwise answers with the
remote client's page. `server.rs` hands the socket to `tungstenite` for framing
only. `tungstenite` is used with `default-features = false`: the handshake is
done here, which is what lets `GET /` and `GET /` with an upgrade live on the
same port — so manual `host:port` is one thing to type and one thing to remember.

Threads, not an async runtime: the Host holds no executor, the transports beside
this one (`host-addon`, `host-mpv`) are blocking, and one thread per connection
with a read timeout is a fraction of the machinery for a handful of devices on a
home network. A connection looks at what the Host published between reads rather
than blocking on a writer, which is why a pushed Snapshot arrives within a
quarter of a second.

Rejected, with reasons: **an async server** (`tokio` for six devices, and a
runtime the rest of the Host would then be tempted to use); **two ports** (an
address and a port to remember, and a browser that cannot reach the page that
would pair it); **a static-file directory** (the frontend is built outside the
tree and copied in, so the one page the Host must always have is compiled in
with `include_str!`).

## 3. Pairing: a displayed single-use code, and a token per device

The Host shows a six-character code, drawn from the operating system's
randomness, spelled in an alphabet with the look-alikes removed (`I`, `O`, `0`,
`1` are absent) so a code read off one screen and typed into another does not
have to be guessed at. A client redeems it with `Action::PairDevice { code,
name }` and is answered with `Answer::Paired { device, token }`.

- **The code is single-use.** Redeeming it rotates the one the Host shows, in the
  same change, so a code is worth exactly one device. A code that has been
  redeemed is not a code any more.
- **There is no expiry.** Rotation on use is the whole lifetime rule. A code that
  is never redeemed is still shown — the owner is looking at the window that
  shows it — and a time-to-live would put a clock into a decision surface the
  spec asks to be pure. Guessing is made unattractive where it happens: a
  connection that offers wrong codes is hung up on after five (`MAX_PAIRING_ATTEMPTS`
  in `host-wire`), so thirty bits are not found by asking.
- **A TTL is not rejected forever**: it is an addition to a pure rule, and the
  seam for it (`PairingCode` plus a clock) is already there.

Rejected, with reasons: **a password or a shared secret** (the spec's user story
is a code entered once, not a credential typed every time); **a QR code only**
(a phone camera is not the only way in, and the code is what makes manual entry
work); **pairing by the window alone** (there is then no second device, which is
the point of the ticket).

## 4. What the Host keeps of a token is a digest, never the token

A device's token is 256 bits from the operating system, spelled in base64url. The
`Device` the Host holds and the `devices` row the store writes carry a SHA-256
**digest** of it (`TokenDigest`), not the token. The token itself is handed to
the device once, in the answer to the pairing, and read from the socket only to
be matched — `Host::device` digests what was presented and looks for a device
whose digest is equal.

The spec puts paired-device tokens in the non-secret SQLite store rather than the
secret store; storing a digest is how that stays a defensible place for them. A
copy of the database is then a list of which devices paired, not a list of live
keys, and no Snapshot has a field a token could occupy — `DeviceSummary` is an
id, a name and a timestamp, and the existing walk over every Snapshot field name
still passes.

Rejected, with reasons: **the raw token in the database** (a backup, a synced
folder or a `sqlite3` read would be a set of working remotes); **the token in the
secret store** (it is not the owner's credential and does not belong beside the
`authKey`; there would be one keyring entry per device to revoke, and revocation
would mean writing to a store the Host treats as read-mostly); **a token in the
WebSocket URL** (the anti-pattern ADR-0009 already named — a URL is logged,
pasted and shown; the token travels in the `hello` frame instead and stays in a
structured message the Host controls).

## 5. Unpaired is one rule, and it is pure

`permitted(action, paired) -> Result<(), ActionError>` is the whole of what
"unpaired" means: a connection that has not paired may take `PairDevice` and
nothing else, and everything else is refused with `ActionError::Unpaired` — in
the Host's vocabulary, so a client reads a kind and a person reads a sentence.
Unpaired connections are also pushed nothing: a Snapshot goes only to a
connection whose token names a device *now*.

It is `host-wire` that asks the rule, because "has this connection paired" is a
fact about a socket rather than about the state every client shares; the rule
itself is in `host-core` where the Action space is, so a capability added to the
surface is judged by the same table. The local window's Tauri bridge does not ask
it at all: it is in-process, the Host's own process, and has no token to present.

Rejected, with reasons: **a separate pairing endpoint or sub-protocol** (a second
door beside the Action surface, which ADR-0002 exists to prevent); **an
`ActionError` per unpaired Action** (the refusal is about the connection, not
about the Action); **letting unpaired connections read Snapshots but not change
state** (an open port would broadcast what is playing, which is state the spec
keeps for paired devices).

## 6. Revoking one device cuts it off where it would have been spoken to

`Action::RevokeDevice { id }` is a change like any other: the device leaves the
state and the store, every client is told the list changed, and the device's
token matches nothing from that moment. The connection itself is not tracked as a
thing to close: the next time a Snapshot would have reached it, the server asks
the Host whether the token still names a device (`Surface::device`), and a
connection that fails that question is sent one refusal and closed.

That is deliberately lazy. It costs one digest lookup per pushed Snapshot per
connection, which is nothing; and it means a revoke does not have to find a
socket, a thread or a registry — the Host's state is the single answer, and a
revoked device is cut off by the same fact that removes it from the window's
list. Other devices are untouched: each has its own token and its own queue.

Rejected, with reasons: **a session registry keyed by connection** (a second
source of truth for "is this device in", which can drift from the state the
Snapshot is built from); **closing on the Action's return** (it would need the
adapter to know which sockets hold which tokens, which is the registry again).

## 7. A reconnect is a greeting, and it is answered with current state

`ClientFrame::Hello { token }` is answered by `ServerFrame::Welcome { device }`,
and a connection that paired is sent `Surface::snapshot()` immediately after. So
a phone that locked its screen and came back is told the state as it stands
rather than holding the view of the moment it left — #31's reconnect, and the
same mechanism that gives a first connection its state. A token the Host does not
know is not an error: the welcome says no device, and the client decides what to
do about it (the shipped page shows the pairing form).

Rejected, with reasons: **a snapshot request command** (a command with no answer
the client could not get for free, and one more id to correlate); **an error for
an unknown token** (a device that was revoked and a device that was never paired
are the same thing to the Host, and "you are not paired" is not a failure of the
request).

## 8. Discovery is mDNS behind a seam, and manual `host:port` is the fallback

`host-wire::discovery` holds a `Discovery` seam: `Mdns` advertises
`_streamingapp._tcp.local.` with the protocol version in a TXT record, and
`NoDiscovery` says nothing, which is what a test and a machine with no multicast
get. The shell announces on startup, logs whether it could, and carries on
either way: the window reads out `host:port` and the pairing code, so nothing
about connecting depends on mDNS. That is the spec's own ordering — mDNS is the
least reliable part of pairing, and the address must work first.

**mDNS is not unit-tested.** The spec's testing decision is that unit tests never
touch the network, and a multicast test would be exactly that: slow, and flaky
wherever multicast is not. What is tested is the codec (fixture-driven), the
server (a real socket on loopback), unpaired rejection, revocation and reconnect.
The announcement itself is walked by hand in `scripts/windows/verify.ps1` step 25,
which checks the Host logged that it announced itself, and on any machine that can
be reached by a browser on the same network.

Rejected, with reasons: **a hand-rolled mDNS responder** (DNS-SD is fiddly and
`mdns-sd` is a plain blocking-free library with no runtime); **discovery in
`host-core`** (multicast is network, and `host-core` has none); **requiring
discovery to pair** (manual `host:port` is the escape hatch the spec names, and it
must work when mDNS does not).

## 9. The shipped page is minimal on purpose; parity is #32

The Host serves one self-contained document (`crates/host-wire/remote/index.html`)
that pairs and shows what is playing, live. It is what makes #31's own story true
— open a browser on another device, enter the code once, watch state change — and
it is deliberately not the remote client: browsing, search, metadata and the whole
control set, with the capability list asserted against the Action surface, are
#32. The page speaks the codec by hand, and a change to a frame is a change in
two places, which is the cost of a client with no build step.

Rejected, with reasons: **reusing the React window** (it is a Tauri client that
reaches the Host over IPC and has no WebSocket path); **a bundled remote app**
(the ticket says no install, and #32 says the browser itself); **shipping #32's
client early** (it would make this ticket's review the size of two).

## 10. Publishing is one place in the shell

`ipc::publish` sends every published Snapshot to the window over Tauri's event bus
and to the `Broadcast` the wire server fans out. Both adapters — the IPC command
and `WireSurface` — call the same `HostHandle::dispatch` and then `publish`, so a
client cannot tell which of them moved the state and there is no second publish
path to keep in step (#8's rule, extended to the second adapter).

`Broadcast` gives each connection its own queue (`mpsc`), and drops a sink whose
receiver has gone away on the next publish — cleanup by the send that fails,
rather than by anything a departed client says.

Rejected, with reasons: **the wire server publishing what it dispatched** (two
publishers for one Action, and a window that would see it twice); **one shared
queue** (one slow connection would hold every other one back).

## Consequences

- A capability added for the window is reachable from a remote client the moment
  it parses, and the capability-parity assertion #32 asks for is a comparison of
  two lists rather than a second implementation.
- `Snapshot` gains `devices`, `pairingCode` and `address`; the TypeScript client
  mirrors them by hand, and the exact-shape test in `action_surface.rs` pins them.
- A Host that cannot bind or cannot announce still browses and still serves — the
  window says what it has, and manual `host:port` is the route.
- The pairing code is shown in every Snapshot, so a paired device can see it. It
  is single-use, rotates on redemption and is not a credential; a device that
  redeems it pairs itself, which it could already do by asking the owner.
