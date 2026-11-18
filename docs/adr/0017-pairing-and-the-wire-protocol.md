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

**A Reply is the answer, not a second copy of state.** The transport clears the
`snapshots` a `Response` carries before it writes the Reply: the same Snapshots
were already published by the `WireSurface`, and every paired connection reads
them from the push. Sending them twice put a ~42 KB Snapshot inside every
command's answer, which the shipped page then ignored — the largest burst a
play/pause ever caused. The window's IPC response still carries its Snapshots;
that is a different door with no push beside it.

Rejected, with reasons: **trusting a client to read the Reply's Snapshots**
(state is what every client is told, not what one answer happens to include);
**dropping the push for the connection that asked** (it would need a per
connection ledger of which Snapshots a Reply covered, and a second client on the
same change would still need the push).

This supersedes one line of ADR-0009, which expected #31's adapter to run the
Host's `dispatch` inside `spawn_blocking`: `spawn_blocking` is a runtime's
primitive and this Host has no runtime. The intent is kept — a fetch on one
connection must not block another, or the window — because each connection is
already its own thread, and the window's own bridge is already
`#[tauri::command(async)]`.

Rejected, with reasons: **an async server** (`tokio` for six devices, and a
runtime the rest of the Host would then be tempted to use); **two ports** (an
address and a port to remember, and a browser that cannot reach the page that
would pair it); **a static-file directory** (the frontend is built outside the
tree and copied in, so the one page the Host must always have is compiled in
with `include_str!`).

**#88 amends this by one step, not the principle.** The page is still one
compiled-in document and still has no build step, but its template is completed
*at serve time*: `host-wire` splices `src/tokens.css`, the shared
`src/languages.json`, and the approved TMDB mark into the page through
one marker convention (`/*__SPLICE_NAME__*/`) before the bytes leave the Host. This keeps `src/tokens.css` the single palette in the tree and
the subtitle list one list for two clients — the alternative was a second copy
on disk that could drift from the window's — while the document a browser
receives is still self-contained, still needs no network asset, and still has no
bundler between `cargo test` and the page the Host serves. The template on disk
holds no `:root` block of its own.

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
- **The code is for a connection that is not in yet.** A paired connection is
  refused `PairDevice` with `ActionError::AlreadyPaired`; the rule is in §5.

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
secret store; storing a digest is a deliberate step past the letter of that and is
how the store stays a defensible place for them. A copy of the database is then a
list of which devices paired, not a list of live keys, and no Snapshot has a field
a token could occupy — `DeviceSummary` is an id, a name and a timestamp, and the
existing walk over every Snapshot field name still passes. What the spec asked for
is kept exactly where it matters: revocation is still a database row going away,
and nothing about it moved into the keyring.

Rejected, with reasons: **the raw token in the database** (a backup, a synced
folder or a `sqlite3` read would be a set of working remotes); **the token in the
secret store** (it is not the owner's credential and does not belong beside the
`authKey`; there would be one keyring entry per device to revoke, and revocation
would mean writing to a store the Host treats as read-mostly); **a token in the
WebSocket URL** (the anti-pattern ADR-0009 already named — a URL is logged,
pasted and shown; the token travels in the `hello` frame instead and stays in a
structured message the Host controls).

## 5. Pairing is two rules, and they are pure

`permitted(action, paired) -> Result<(), ActionError>` is the whole of what
pairing means at a socket:

- a connection that has **not** paired may take `PairDevice` and nothing else —
  everything else is refused with `ActionError::Unpaired`;
- a connection that **has** paired may take everything but `PairDevice`, which is
  refused with `ActionError::AlreadyPaired`.

Both matter. The first is #31's story 55: an open port on the network is not a
playback remote for whoever finds it. The second is least privilege: a device
pairs by *being* unpaired, so a device that is already in cannot redeem the code
the owner is reading off the window and add another one. It also makes the code
harmless where it is easiest to carry it — in the Snapshot — because every client
that sees a Snapshot is, by definition, already past the only thing the code buys.

Unpaired connections are also pushed nothing: a Snapshot goes only to a
connection whose token names a device *now*.

It is `host-wire` that asks the rules, because "has this connection paired" is a
fact about a socket rather than about the state every client shares; the rules
themselves are in `host-core` where the Action space is, so a capability added to
the surface is judged by the same table. The local window's Tauri bridge does not
ask them at all: it is in-process, the Host's own process, and has no token to
present.

Rejected, with reasons: **a separate pairing endpoint or sub-protocol** (a second
door beside the Action surface, which ADR-0002 exists to prevent); **an
`ActionError` per unpaired Action** (the refusal is about the connection, not
about the Action); **letting unpaired connections read Snapshots but not change
state** (an open port would broadcast what is playing, which is state the spec
keeps for paired devices); **letting a paired device pair another** (nothing needs
it, and it hands every paired client a way to add clients).

## 6. Revoking one device cuts it off at the next thing it does

`Action::RevokeDevice { id }` is a change like any other: the device leaves the
state and the store, every client is told the list changed, and the device's
token matches nothing from that moment. A connection is not tracked as a thing to
close; instead, both doors a revoked connection could use ask the Host whether
its token still names a device:

- **a command** is checked against `Surface::device` *before* `permitted` and
  before `dispatch`, so a device revoked a moment ago cannot slip one Action in
  before the next Snapshot would have noticed. The check is a digest lookup, and
  it happens once per command;
- **a push** asks the same question, so a revoked connection that says nothing is
  cut off the moment a Snapshot would have reached it: it is sent one refusal and
  closed.

That is deliberately lazy and single-sourced: it costs one lookup per command and
per pushed Snapshot per connection, which is nothing, and it means a revoke does
not have to find a socket, a thread or a registry — the Host's state is the single
answer, and a revoked device is cut off by the same fact that removes it from the
window's list. Other devices are untouched: each has its own token and its own
queue. `host-wire/tests/wire.rs` drives both halves over a real socket, including
the command that arrives *between* the revoke and the Snapshot that would have
cut it off.

Rejected, with reasons: **a session registry keyed by connection** (a second
source of truth for "is this device in", which can drift from the state the
Snapshot is built from); **closing on the Action's return** (it would need the
adapter to know which sockets hold which tokens, which is the registry again);
**trusting the connection's own recollection of having paired** (which is what
lets one Action through after a revoke).

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
get. The record itself is built by a pure `service(name, address, port)`, so what
a Host will announce — its instance name, its host name, its address and port, and
`version = WIRE_VERSION` — is something a test holds without touching the network.
The shell announces on startup, logs whether it could, and carries on either way:
the window reads out `host:port` and the pairing code, so nothing about connecting
depends on mDNS. That is the spec's own ordering — mDNS is the least reliable part
of pairing, and the address must work first.

**#31 announces; nothing here browses.** Browsing is what a *client* does, and the
client #31 ships is a browser page, which cannot speak DNS-SD — service discovery
is for a native client, and there is not one yet (#32's page has the same limit).
So the announcement is the half of "discovery works" that this Host can build, and
it is proven two ways: the record is unit-tested, and `scripts/windows/verify.ps1`
step 25 checks the Host logged that it announced itself. On a LAN, a person can
see the record from another machine with `avahi-browse -r _streamingapp._tcp` (or
`dns-sd -B _streamingapp._tcp` on macOS), which `scripts/windows/README.md` says.

**mDNS is not unit-tested end to end.** The spec's testing decision is that unit
tests never touch the network, and a multicast test would be exactly that: slow,
and flaky wherever multicast is not. What is tested is the record, the codec
(fixture-driven), the server (a real socket on loopback), unpaired rejection,
paired refusal, revocation, and reconnect.

Rejected, with reasons: **a hand-rolled mDNS responder** (DNS-SD is fiddly and
`mdns-sd` is a plain blocking-free library with no runtime); **discovery in
`host-core`** (multicast is network, and `host-core` has none); **requiring
discovery to pair** (manual `host:port` is the escape hatch the spec names, and it
must work when mDNS does not); **browsing from the shipped page** (a browser
cannot, and a native discovery client is not a thing this ticket has).

## 9. The shipped page is minimal on purpose; parity is #32

The Host serves one self-contained document (`crates/host-wire/remote/index.html`)
that pairs and shows what is playing, live. It is what makes #31's own story true
— open a browser on another device, enter the code once, watch state change — and
it is deliberately *only* that: no browsing, no metadata, and no control set, so
that #32's full remote is an addition rather than a rewrite of half-built
controls. To see the live half during a manual run, change the state from the
Host's own window (press play) and watch the phone follow.

The page speaks the codec by hand, and a change to a frame is a change in two
places, which is the cost of a client with no build step. Its error table is
deliberately small — the kinds a page that only sends `pair_device` can actually
be given — rather than a copy of the window's fuller one.

Rejected, with reasons: **reusing the React window** (it is a Tauri client that
reaches the Host over IPC and has no WebSocket path); **a bundled remote app**
(the ticket says no install, and #32 says the browser itself); **shipping #32's
client early** (it would make this ticket's review the size of two); **shipping
its controls early** (a control surface half-built is worse than one built once).

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
  is single-use, rotates on redemption, and no paired connection may redeem it
  (§5), so seeing it buys a paired device nothing; the code is what a *new*
  device needs, and the owner is looking at the window that shows it.
