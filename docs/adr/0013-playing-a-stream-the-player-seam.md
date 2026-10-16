# Playing a Stream: the Player seam, a URL that never travels, and a picture the Host does not draw

Ticket #27 ("Play a Stream: mpv owns the picture") is the first ticket where the
Host makes something happen on a screen. It introduces the Player seam, links
libmpv in-process, and makes the prototype branch's embedding recipe real
(`prototype/windows-embed`, #3). Eight decisions are worth writing down.

## The Player is a seam beside the Provider, and mpv is only its implementation

`host_core::Player` is what the Host asks for playback: `open(url)`,
`set_paused(bool)`, `seek(target)`, `stop()`, `observe()`, `picture()`. One
implementation is `host-mpv`, which is mpv, and a test drives `FixturePlayer`
instead — the same shape `Fetcher`, `Store` and `Provider` already have. The
Host's rules stay above the seam: which URL a candidate carries, what every
client is told, what a failure does to the list.

mpv is *not* in `host-core`, for the reason `cargo test -p host-core` must never
build a TLS stack (ADR-0009, ADR-0013's sibling): a crate of the Host's own
vocabulary and decisions should not link a media stack, so `host-core` names
`Player` and knows nothing about `time-pos`, `keep-open` or `wid`.

The one thing about a Player that is per platform is **where the picture goes**,
and it is a `Surface` a caller hands in, because it cannot change afterwards:
`wid` is an option mpv reads once, when it initializes.

- `Surface::InWindow { handle }` — mpv draws into a child window of the Host's
  own. Windows, by its HWND; X11 by its XID the day #19 says the overlay works
  there.
- `Surface::OwnWindow` — mpv opens a window of its own. Wayland and macOS have
  no `wid` at all, and this is what those platforms get; the Host's interface
  says where the picture is instead of pretending it is in this window.
- `Surface::Headless` — no video output and no audio output at all, which is
  what the integration test drives a *real* mpv with (`vo=null`, `ao=null`).

Rejected, with reasons: **the Player inside `host-core`** (every test in the
repository would link libmpv, and the domain would carry mpv's option names);
**a Player with one method per mpv property** (the seam would be mpv's API with
another name, and a second Player — a test's, a future platform's — would have
to pretend to have properties it does not); **the render API** (ADR-0003 already
settled that it cannot pass HDR through, which is why mpv owns the swapchain);
**choosing the surface inside `host-mpv`** (the crate would have to know about
windows it is not allowed to know about — the HWND is Tauri's, and this crate
must stay free of the UI toolkit).

## The Host samples its Player; it does not run one

An open is asynchronous. `Player::open` agreeing to try is not playing, a URL
that cannot be reached is found out later, and a Stream ends on its own. So the
Host reads the Player rather than being called back by it:

- The Player answers `observe()` with an `Observation` — what state, where, how
  long, and the words for an open that failed — computed from mpv's properties
  and from the events drained since the last look, with no blocking anywhere.
- `Host::sample()` folds that into state and returns a Snapshot **only when
  something moved**. A tick that reports the same position is not a change and
  publishes nothing.
- The clock is the app shell's: `host-core` holds no threads and no timers (the
  whole crate is a handful of pure decisions and one mutex), so the shell's
  sampler thread asks every 250 ms and publishes what changed through the same
  `ipc::publish` an Action's Snapshots go through.

Two consequences worth stating plainly. First, **the Action surface is still the
only door a client goes through** (ADR-0002): sampling is the Host reading its
own limb, not a second path into state, and it publishes exactly the Snapshot any
client would have got. Second, **the Host's own record moves at the moment of
the Action**: a pause or a seek is applied to what the Host publishes
immediately, and the Player's next report is what corrects it — which is what
makes a scrubber feel immediate without the window inventing a position.

The mpv-shaped halves are pure and therefore tested without a player:
`host_mpv::telling` (a `Telling` → mpv's command name and arguments) and
`host_mpv::observing` (the memory of what events said + the properties mpv
answers → the Host's `Observation`). The integration test in
`crates/host-mpv/tests/mpv.rs` drives a real headless mpv through play, pause,
seek, end and a Stream that cannot be fetched, served over HTTP by the test
itself — a Stream is an http(s) URL (below), and a test that reaches the network
is a test that flakes.

Rejected, with reasons: **an mpv event callback calling back into the Host** (it
would put a thread, a channel and a second mutation path inside `host-core`, and
the frame-rate event stream would have to be filtered to get back to "state
changed"); **only sampling when a client asks** (a client that is watching
nothing still has to see the Stream end and the failure arrive, and a remote
client must not have to poll); **publishing on every tick** (the revision would
move four times a second to say nothing, and every Snapshot assertion in the
repository — "the revision did not move" — would stop meaning anything).

## A Stream URL is a credential by presumption, and the client names the candidate

ADR-0009 decided that an Addon's manifest URL never reaches a Snapshot, because
the debrid configuration lives inside it. A Stream URL is the same kind of
thing — AIOStreams and Torbox put a session in the URL — and a Snapshot reaches
every paired client. So:

- `StreamUrl` validates a URL once (`http`/`https`, host, bounded, no control
  characters) and is the only thing about a Stream that stays inside the Host.
- What a Snapshot carries about playback is `NowPlaying`: the Video, the Addon
  whose answer the candidate came from, and the Addon's own words about it (its
  badge line, its description, the file's name, the binge group).
- `Action::PlayStream { video, addon, stream }` carries the candidate *back*,
  whole, because the Host re-asks nothing: the list a client chooses from is that
  client's own (ADR-0005), so which candidate plays is the client's decision and
  the Host cannot reconstruct it from an index or from a remembered answer —
  remembering one would be shared state invented for nothing. What the Host
  judges is the part that matters: where the bytes are.

An `infoHash` is refused with `ActionError::Unplayable` rather than pretended
about: the bridge that turns one into bytes is #12, and #12 changes nothing above
this line — it either resolves to a URL a `Player::open` accepts or becomes a
Provider that offers playable candidates.

Rejected, with reasons: **naming a candidate by its index in the answer a client
was sent** (the Host would have to keep a per-client list, which is the shared
state ADR-0005 exists to avoid, and a reconnect would lose it);
**publishing the URL** (a Snapshot is broadcast; the URL is where the session
lives); **accepting any scheme mpv can open** (`file://`, `magnet:`, an archive
— a shape nothing here would play, and a promise the Host would not be keeping).

## A failure is `idle` with the words for why, and the candidate stays named

A Stream that cannot be opened is not a state of its own: the Player is left
doing nothing, so `PlaybackState` is `idle` and `failure` carries the Player's
own words ("That Stream could not be opened — mpv could not load it."). The
Stream stays named in `nowPlaying`, because the client that pressed play has to
be able to say *which* candidate did not open, and the window's rule is
therefore simple: the player surface is shown when the state is not `idle`, so a
failure puts the client back on the list it chose from, with the reason above it.
A `stop` clears both.

mpv's failed open arrives as `MPV_EVENT_END_FILE` with a reason of `error` and
an mpv error code, not as a returned error: the open was accepted and the failure
is later news, which is exactly why the failure travels as a Snapshot and not as
the Action's answer.

## `keep-open=yes`, and why "ended" is a state the Host can see

mpv unloads a file when it reaches its end: without `keep-open`, `path`,
`time-pos` and `duration` all become unavailable at the moment playback stops,
and a Player that wanted to say "this Stream ended at 42:10" would have to
remember the position it no longer has. With `keep-open=yes`, mpv pauses the
player itself, sets `eof-reached`, and keeps everything else: the position *is*
the duration, the file is still the file, and `ended` is a state read the same
way every other state is.

mpv's own pause at the end is also why the reading order matters: `eof-reached`
is asked *before* `pause`, or "ended" would read as "paused" — the truth about a
property and a lie about the Stream.

This was verified against a real mpv before it was written down
(`docs/research/mpv-headless-facts.md`), including the fact that `eof-reached`
is set a moment *before* the last of the audio is played — a test waits for the
end it settles at, not the first word of it.

## Where the picture is is published, because a client shares the Host's window

`PlaybackSnapshot.picture` carries the `Picture` the Player was built with
(`in_window`, `own_window`, `nowhere`) — a fact about the machine, like which
backend holds a credential, and not something any Action changes. It is what
lets one frontend serve both platforms honestly: where the picture is in the
same window as the interface, the page stops painting that rectangle (mpv's
child window is behind the webview, and anything painted over it would hide the
video); where it is in a window of its own, the interface says so rather than
showing an empty rectangle.

While the state is not `idle`, the Host's own window *is* the player: the picture
fills it and the OSD is drawn over the picture. That is the local window's own
arrangement, not a rule about clients — the remote client of #31/#32 lays itself
out as it likes, and nothing about it is a Snapshot field.

## On Windows the app shell is the only place that says `unsafe`

The child window mpv creates under the Host's own is created *on top* of the
webview and is the size mpv made it, so two things have to be done to it that
have no safe wrapper: push it to the bottom of the z-order (and make it answer
`WM_NCHITTEST` with `HTTRANSPARENT`, so a click that lands on the picture while
it is briefly on top still reaches the interface), and keep it the size of the
window's client area on every resize.

The workspace forbids `unsafe_code`; the app shell — where platform code belongs
— denies it instead and lets exactly one module allow it
(`src-tauri/src/player/windows.rs`, four Win32 calls). Everywhere else an
`unsafe` block is a build failure, as it is in the rest of the workspace. The
watching thread that adopts the child lives beside the sampling clock because it
polls for the same reason the clock does: mpv creates its child per Stream.

Rejected: **carrying the adoption in `host-mpv`** (the crate would gain
`unsafe`, a Win32 dependency and knowledge of Tauri's window — and a Player that
draws into *a* window is not a Player that knows *which*); **region cut-outs
instead of a layering** (Ventic's shape, which cannot draw the interface *over*
the video, and the ticket asks for exactly that); **`libloading` at runtime, as
the prototype did** (the prototype needed it because the dev bundle ships no
MSVC import library; this Host links libmpv properly, and the build script
generates the import library once — see `scripts/windows/README.md`).

## A Host with no usable Player still browses

`player::start` failing is not a reason for the window not to open: playback is
one of the things the Host does. The shell logs the failure and builds the Host
with a `NoPlayer` that refuses every telling with the words it failed with, so
the window browses, searches, opens Titles, lists Streams — and says plainly why
nothing plays when someone presses a candidate.

Rejected: **panicking at startup** (a machine with a broken libmpv would show
nothing at all, and the reason would be in a log nobody reads); **silently
offering the list without playback** (a candidate that does nothing when
pressed is worse than one that says why).

## Consequences

A control added by #28 is a new `Action` variant, a telling in `host-mpv` and a
property in the reading — no shape above the seam changes, and the window, the
remote client and the tests get it through the one surface at once. #29 records
Watch progress from the position the Host already publishes, and uses the `ended`
state it can now see. #12 turns an `infoHash` into bytes and hands the result to
the same `Player::open`. #19 settles X11 and either moves that platform to
`Surface::InWindow` or leaves it where it is. #31/#32 give every client the
pause, seek and stop this ticket put on the Action surface, with no second path
to maintain.
