# The remote is the window's equal: one page, one surface, one capability list

Ticket #32 ("Remote parity") makes the browser remote client the Host serves as
capable as the Host's own window: browsing and search, opening a Title and
choosing among its Streams, the full control set, and the Host's own settings
(Addons, the TMDB key, the Stremio account, the paired devices) — over the one
Action surface. ADR-0017 §9 left the page deliberately minimal and said the full
remote "arrives as a bigger page"; this records the decisions that shape it.

## 1. One hand-written, self-contained, compiled-in page

`crates/host-wire/remote/index.html` grows from the pairing-and-playback page of
#31 into the full client: the same document, larger. It stays one self-contained
document with no build step, embedded with `include_str!`, for the reasons
ADR-0017 §2 and §9 already gave — a browser on another device must be able to
load *something* before it can pair, and the Host is the only thing that knows it
exists, so the page travels with the binary rather than from a build directory
that may not be there. The cost ADR-0017 §9 named still applies and is paid
knowingly: the page mirrors the window's pure decisions (`src/*.ts`) by hand, and
a change to a frame or a decision is a change in two places.

The alternatives were weighed and rejected:

- **Reuse the React window with a WebSocket transport.** It would share the UI
  and give parity for free, but it needs a build step whose output must be
  regenerated and committed (or read from `dist/`, which ADR-0017 §2 rejected),
  and it would put a bundler between `cargo test` and the page the Host actually
  serves — a stale bundle is a remote that silently differs from the window,
  which is the failure this ticket exists to prevent.
- **Two checked-in files, `index.html` plus a `remote.js`.** The script would be
  unit-testable, but it breaks "one self-contained document" for no gain a
  checklist does not already give, and the pure decisions worth testing are the
  Host's, which are tested where they live.

## 2. The capability list is data, and it is asserted against the Action surface

`Action::SPELLINGS` in `host-core` is the surface written down as data, and
`Action::spelling` is the match that spells one; both are generated, from one
list, by the `action_spellings!` macro in `action.rs`. The generated `match` is
exhaustive with no wildcard, so the compiler refuses to build until a new variant
has a line there — and because the list is built from those same lines, a
spelling cannot reach the match and miss the list. A test
(`the_spelling_list_is_the_whole_surface`) checks the lines agree with serde's own
`type` tags and cover every variant, so a spelling that does not match the wire
form fails too. The remote page carries the same list in a machine-readable JSON
block, and `host-wire`'s `the_remote_declares_the_whole_action_surface` asserts
it *equals* `SPELLINGS`. So a capability added to the surface — which the
exhaustive match forces a maintainer to notice — cannot be silently missing from
the remote, and the remote cannot claim a capability the surface does not have.

The declaration is load-bearing rather than a comment: the page's `dispatch`
refuses to send an Action whose spelling is not in the list, so a control wired
to an Action the list does not name throws instead of leaving the wire. What the
list asserts is that the remote can *send* every Action (and only those); it is a
declaration of capability, and the checklist is what confirms an affordance is
wired to it.

Rejected, with reasons: **a curated remote list** (it is the failure ADR-0002
exists to prevent — a remote that can do most of what the window can); **no list,
and a test that reads the page's controls** (there is nothing static to read in
hand-written markup, and the assertion would be a regex over JavaScript); **a
generated list** (a build step for one array of strings, and the page is
committed, not generated).

## 3. Browsing stays on the remote; playback is a bar over it

The Host's own window *becomes* the player while a Stream plays: it owns the
picture, and there is nowhere else to put the interface (ADR-0003). A remote
client owns no picture — the picture is on the Host — so it does not have to
disappear. The remote keeps its browse surface, its Title, and its Stream list,
and a bar pinned above them carries the transport and opens the full control
sheet. That is ADR-0005 made visible: two clients can look at different things
while one of them plays, and a phone controlling the television never loses the
screen it was browsing.

The transport on the bar is the set the Host will take while something plays
(`transportable`), and the sheet is the set it will take while a Stream is
open (`controllable`) — the same terms the window's OSD uses, from the same
Snapshot.

Rejected, with reasons: **swapping to a full-screen player surface, as the window
does** (it would stop a phone from browsing while the television plays, for no
reason a remote has); **a control set only reachable from the bar with no sheet**
(the full set is the ticket's point, and a phone has the room for it).

## 4. "Previous episode" is not on the surface, and is not invented here

The ticket's acceptance list names "next/previous episode". The Action surface
has `NextEpisode` and no `PreviousEpisode`: what plays next is a rule the Host
owns (ADR-0014), and the surface never grew a "previous" it does not need — a
client reaches an earlier episode through the Title's own episode list, which the
remote shows. The remote therefore offers `Next episode` exactly where the window
does, and an earlier episode is a press on that episode. If a `PreviousEpisode`
Action is ever wanted it is an `Action`, a `Telling` and a property in the
reading — the shape ADR-0013 and ADR-0014 predicted — and not a client feature;
this is written down so the gap in the ticket's wording is not mistaken for a gap
in the remote.

## 5. The remote reaches the Host's settings too

Because the capability list is the whole surface, the remote also carries the
settings the window does: pasting an Addon's manifest URL, entering or clearing
the TMDB key, signing in to or out of Stremio, revoking a paired device, and
choosing the subtitle-language preference. This is "not a curated subset" taken
literally: a person with the phone in their hand and the television in front of
them can configure the Host they are watching. Every one of those is the same
Action the window sends, and none of them carries a credential into a Snapshot.

## Consequences

- A capability added for the window is reachable from the remote the moment it
  is added to `Action::SPELLINGS` and the page; the parity assertion is a
  comparison of two lists, and it fails loudly rather than quietly.
- The page is larger and untested by the build, as ADR-0017 §9 accepted: the
  windowed checklist (`scripts/windows/verify.ps1` step 26) walks it by hand, and
  the capability list is asserted by `host-wire/src/remote.rs`.
- The remote mirrors the window's pure decisions by hand. A decision changed in
  `src/*.ts` and not in the page is a divergence a person finds by hand, not a
  build failure — the cost ADR-0017 §9 named, now larger.