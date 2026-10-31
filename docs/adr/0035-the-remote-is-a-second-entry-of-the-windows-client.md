# The served Remote is a second entry of the window's client

Ticket #193 (wayfinder map #187). The served Remote has been one hand-written
document that mirrors the window's decisions: 4,568 script lines, 1,777
style lines, ~470 lines of pure decisions that already had a home in `src/*.ts`,
and a capability list asserted by comparing two texts. #188 measured the
duplication, #189 the build, #190 the client core, #191 the kit and the player
split, and #192 the sequence. This records the decision they add up to: the
Remote becomes a **second entry of the window's client**, built from the same
tree, and serves from `/next` until one cutover.

It supersedes the three clauses that said the Remote has no build step —
ADR-0018 §1, ADR-0017 §2 and ADR-0031 §1 — while keeping the principle all three
protected: **the page travels with the binary, the Host serves it, and it fetches
nothing outside the Host.** The build is a developer step whose output is
committed and compiled in; nothing is built at serve time and no client asset
comes from a network.

## 1. One tree, two entries

```
src/core/          the client core — the decisions both clients share
src/core/react/    its React bindings
src/kit/           the screen-agnostic primitives, the token sheet and the icons
src/window/        the ten-foot client (today `src/shell/`)
src/remote/        the served Remote client
```

Two documents, `index.html` and `remote.html`, are the two Vite entries. There
is no pnpm workspace and no second package: the boundary is a folder, and the
structure test below is what enforces it. **`core ← kit ← window | remote`** is
the whole layering: the core imports neither the kit nor a client, the kit may
import the core's types and decisions, and each client imports both.

The **client core** holds the Host-facing decisions and nothing that knows a
platform: the one door to the Host (`HostLink` — `dispatch`, `snapshot`,
`onSnapshot`, `state`, `onState`, `close`), the `Session` over it (the Snapshot
and its revision guard, the one alert, the pending keys, `unplayable`,
`HomeStore`), the `Navigation` store (the Level stack with a per-client payload,
and `canGoBack`), the Action and Response mirrors, the error table, the playback
view model, and the pure modules the window already has — the action keys, the
input intents, the motion presets, and the screen decisions from `title.ts`
through `settingsRegister.ts`.

What stays out is as important. **The platform is the client's:** the window keeps
spatial focus (`focus`, `layout`, `reveal`, `useSpatialFocus`), the gamepad and
fullscreen hooks, the Tauri window, the ten-foot frame and programme copy, and the
rehearsal trio; the Remote keeps its browser-history sentinel, the pairing form,
the socket and the device-token storage. The **Device token never crosses the
seam**: `WebSocketLink` intercepts it and writes it through an injected
`TokenStore`, so a core `Response` carries a paired Device and no token, and the
window bundles no token code.

The core is **move, not rewrite**. The window's modules and their suites travel
with import-only edits; the window's behaviour is frozen while the tree moves,
and its existing tests are the net that proves it. A changed assertion during the
move is a bug in the move.

**Framework-free is a test, not a convention.** Outside `src/core/react/`, the
core imports no React, touches no `document` or `window`, and names no
`localStorage`, `WebSocket` or `@tauri-apps`; the kit and `core/react/` are React
and may touch the DOM but no storage, socket or Tauri. `src/window/` and
`src/remote/` are the platform. A structure test reads the module graph, exactly
as the token lock reads the sheet (ADR-0032 §4). No barrel `index.ts`: clients
import deep paths so the graph the test reads is the real one.

## 2. One kit, two scales, two layouts

`src/kit` is **screen-agnostic**: it holds a primitive that knows no screen and no
Host, even one only a single client uses. It carries `Button`, `Chip`,
`PosterCard`, `ContinueWatchingCard`, `ConfirmDialog`, `PendingSpinner`,
`Popover`, `Sheet`, `MenuGroup`/`MenuRow`/`MenuReadout`, `Field`, and the icon
sprite, plus the token sheet. `RowTrack` (with a new touch `Rail`) and every
player drawing stay in their client.

The kit consumes **role tokens only**; there is no `density` prop and no fork. The
window's token sheet keeps the ten-foot floors; the Remote's root re-maps the
roles to the hand scale and adds `--rep-remote-touch` to the controls. The shared
focus keyline moves into `kit.css`, and `data-focusable` stays on the primitives.

**The player is the one screen that is genuinely different.** The core shares the
playback decisions — `playbackView`, `transportControls`, `playerPanels` and the
Episodes decisions — and each client draws its own: the window's OSD over mpv's
picture, with its focus ladder, pad, auto-hide and anchored popovers; the
Remote's docked strip, expanded card and one docked sheet. The phone's Episodes
sheet is a feature the window does not have; the migration keeps it. The window's
missing transport when the picture is not in this window (#194) and its missing
Episodes menu (#195) are fixed after the cutover, not during it.

## 3. Two builds, one committed artifact

**Two Vite builds, not one two-entry build.** `pnpm build` keeps `index.html` →
`dist`, which is exactly what Tauri's `frontendDist` embeds. `pnpm build:remote`
builds `remote.html` with `base: "/next/"`, `publicDir: false` and hashed names
into `crates/host-wire/remote-next/`, committed, and emits `build-info.json`
(wire version and Action spellings) and `licenses.md` beside it. A single build
with two inputs was rejected: Rolldown hoists shared modules into a chunk both
entries use, so deleting the Remote's half from `dist` would break the window or
leave Remote code in the Tauri bundle.

`host-wire` embeds the directory with `include_dir!` and a one-line `build.rs`
`rerun-if-changed`, so `cargo test` never invokes pnpm. The Host serves `/next`
(308 to `/next/`), `/next/` as `no-store` HTML, `/next/assets/<hash>` as
`immutable`, and keeps `/fonts/*` at its existing route and hour-long cache —
`publicDir: false` leaves the token sheet's root-absolute font URLs untouched.

**The stale artifact is the risk, and it has three locks.** The artifact is
deterministic (no timestamp, SHA, absolute path or locale in it); CI rebuilds
`pnpm build:remote` and fails on any `git status --porcelain -- …/remote-next`
output, and guards `test ! -e dist/remote.html` so the Remote cannot slip into
the Tauri bundle; and `host-wire`'s test compares `build-info.json`'s Actions and
wire version to `Action::SPELLINGS` and `ACTION_VERSION`. A capability added on
one side cannot pass. The dev loop is the existing `pnpm dev`, which serves
`/remote.html` beside `/`, with a `/host` WebSocket proxy; the staged artifact is
`http://<host>:8090/next`.

## 4. What is superseded, and what stands

**ADR-0018 §1 — "one hand-written, self-contained, compiled-in page" and its
rejected "reuse the React window with a WebSocket transport".** The page is now a
built document plus same-origin hashed assets, and the React window *is* reused.
The reason §1 gave — "a stale bundle is a remote that silently differs from the
window" — is now answered rather than ignored: the artifact is committed, CI
rebuilds it and fails on any diff, and its capability list is read by a Rust test.
The cost §1 accepted knowingly — "a change to a frame or a decision is a change
in two places" — is the 4,568-line mirror. §2's capability list stands, in its new
form: one TypeScript list, emitted into `build-info.json`, compared to
`Action::SPELLINGS`. §3–§5 (the browse surface, the settings, the earlier
episode rule) are untouched.

**ADR-0017 §2 — the page compiled in with `include_str!` and a static directory
rejected.** The page still travels with the binary, now as an embedded directory
of hashed files (`include_dir!`); §2's one port and one socket, its hand-rolled
upgrade, its threads and its push-not-Reply decision all stand. §9 described the
minimal page #32 would grow; that page is what this replaces. The protocol, the
pairing, the Device token and the wire version are unchanged.

**ADR-0031 §1 — the pinned, vendored Motion ESM bundle on its own route.** The
bundle imports `motion` like the window; Vite emits a hashed chunk, and
`licenses.md` carries the MIT notice. The rest of ADR-0031 stands: Motion is the
animation layer for both clients, the presets are one source, and physics is
Motion's while self-contained fades stay CSS.

**The principle survives verbatim.** The page travels with the binary, the Host
serves it, and it fetches nothing outside the Host. There is no CDN, no serve-time
build, no network fetch for an asset, and no second package registry. The build is
a developer step, reviewed as a committed diff.

## 5. The migration is window-first, then the Remote, one cutover

The window proves the tree first: eight tickets — three mechanical moves, the
Field adoption and four seam tickets — move `src/shell` to `src/window`, extract
`src/core`, split `src/kit`, and put the window on `HostLink`, `Session`,
`Navigation` and the shared player view — with every existing suite green and one
Windows `verify.ps1` walkthrough as the phase gate. Then the Remote is built
screen by screen behind `/next`, each ticket rebuilding and committing the
artifact, with two phone checks. Then one
cutover PR serves the React Remote at `/`, moves the artifact into place, and
deletes the hand-written page, its six splices, its vendored Motion, and its two
suites.

Twenty-one implementation tickets carry it: eighteen PRs and three hand-check
tasks, wired with native blocked-by edges. The sequenced list, each ticket's gate
and the cutover detail live in `docs/plans/remote-reuse.md`; the tickets are
filed against this map and this decision. The hand-written page is frozen from
the first window ticket until the cutover — green, untouched, and still serving
`/` — so the migration has a working Remote at every step and a revert at the
end, not a rewrite in the middle.

## 6. Rejected, with reasons

- **A vanilla page with a framework-free kit.** It keeps two rendering models:
  a DOM-building kit is a second framework, and the window's ~3,000 screen lines
  still cannot be shared — only the ~470 pure lines could. The measured saving
  is then exactly the duplication being removed, paid for with a hand-written
  component layer and the phone's own state binding. React is already the
  window's, and one component draws both scales.
- **A pnpm workspace.** Two packages sharing one tree need manifests, dependency
  duplication or hoisting rules, a build order, and `--filter` in CI, for a
  boundary a folder plus a structure test already enforces. Nothing here is
  published or consumed outside the repo; the workspace is infrastructure with
  no user.
- **One inlined HTML document.** Inlining the bundle into every response keeps
  the letter of "one self-contained document" at the cost of re-sending the whole
  client on every load, losing the content hash and the immutable cache, and
  shipping a multi-megabyte document with no separate source map. The Host already
  serves assets; the document and its same-origin hashed assets are still one
  origin and one binary.
- **A big-bang migration.** One PR that moves the core, rewrites the page and
  flips `/` cannot be proved: the window's suites cannot tell a behaviour change
  from a rename when both happen at once, and there is no staged Remote to hand
  until the last line. It also loses the rollback a revert of one cutover gives.
- **Remote-first.** It would make the window the second consumer of a core
  invented for the phone, and the window's suites — the only broad net the move
  has — could not prove the core is behaviour-preserving, because the window
  would not be using it yet. The pure modules are the window's; they move from
  where they are already tested.
- **A separate package for the Remote with its own dependencies.** It would put
  two React versions and two token sheets in one repo, and the kit's whole point
  is that there is one of each. The two entries already build from one root.

## Consequences

- The Remote gains a build. A developer runs `pnpm build:remote`; CI proves the
  committed artifact is current; `cargo test` reads it without a frontend
  toolchain. A release embeds `dist` (window) and `remote/` (Remote) in one binary.
- The decisions, the primitives, the token sheet, the icon sprite, the four JSON
  lists and the error table become single-sourced. The divergences that were bugs
  disappear by construction rather than by hand: the 6 s feature beat, `loadHome`
  wiping pages, the missing error kinds, the unspliced genre tables, the three
  reduced-motion reads and the missing version row.
- Two layouts remain by design. The OSD is the window's and the strip/card/sheet
  is the phone's; they share the playback facts, never the drawing. A future
  screen that is the same screen at both scales composes from the kit; a future
  player change lands in `playbackView` once.
- The Remote loses its focus engine, which existed to survive full repaints, and
  keeps Back (`Escape`, `GoBack`). The window keeps spatial focus, the gamepad and
  the OSD ladder.
- The page's tests die at the cutover, not before. Their cases become the
  `HostLink` contract suite, the core decision suites, the browser history and
  pairing suites, and a smaller `<RemoteApp transport={fake}>` smoke; the
  capability assertion survives as `build-info.json` against `Action::SPELLINGS`
  (ADR-0032, `docs/agents/testing.md`).
- The live docs follow the move: `docs/design-system.md`'s paths change with the
  kit, and `docs/agents/testing.md`'s "the served Remote has no seams" section
  changes at the cutover. `CONTEXT.md` gains no term: *client core*, *kit* and
  *client session* name code structure, not domain vocabulary, and the existing
  *Remote client* and *Cast Remote* entries already say what the served client is.
- The Host's Rust Action surface, wire protocol, Snapshot shape and pairing are
  untouched. `/next` is a route beside `/`, not a staging flag; at cutover it
  becomes a permanent redirect to `/`.
- The owner's eyes remain the gate where no test reaches: one Windows walkthrough
  after the window phase, two phone checks during the Remote phase, and the
  window and phone walked at `/` on the cutover branch before it merges.
