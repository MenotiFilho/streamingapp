# The Remote reuses the window: the migration plan

**Ticket:** #193 (wayfinder map #187). **Decision:** ADR-0035. **State:** planned;
nothing started. **Tickets:** 21, filed as #196–#216.

The decision is that the served Remote becomes a second entry of the window's
client: one `src/core`, one `src/kit`, two clients, one build artifact served
from `/next` until one cutover. This is the route there. Each ticket is one pull
request, except the three hand-check tasks; every ticket carries its own gate,
and the gates are what "done" means.

## 1. The shape

**Window first, then the Remote screen by screen behind `/next`, then one
cutover.**

- **Phase A — the window proves the tree.** Three mechanical moves (the rename,
  the core extraction, the kit), the Field adoption, and four seam tickets (the
  link, the Session, the Navigation, the playback view) put the window on the new
  client core. Every existing suite stays green and no assertion changes; the
  phase gate is one Windows `verify.ps1` walkthrough.
- **Phase B — the Remote behind `/next`.** A walking skeleton carries the build,
  the embedding and the staging; then Home, Discover/Search, Library, Addons,
  Title/Streams, Settings, and the player in two tickets. Each PR rebuilds and
  commits the artifact. `/` still serves the hand-written page, so a regression
  in the new Remote cannot reach the phone's real route.
- **Phase C — the cutover.** One PR flips `/` to the React Remote, moves the
  artifact into place, and deletes the hand-written page, its splices, its
  vendored Motion and its two test suites. Rollback is a revert.

The hand-written page is **frozen** from A1 to C1: green, untouched, and still
serving `/`. The new suites accumulate beside it.

The tickets are wired with native blocked-by edges in the order they appear:
A1 → … → A9 → B1 → … → B7 → P1 → B8 → B9 → P2 → C1. The first unblocked ticket
is the one to take; nothing later starts early, because every Remote ticket
rebuilds and commits the same artifact.

## 2. Phase A — the window proves the tree

| Ticket | What it lands | Gate |
|---|---|---|
| [A1 — move the window to `src/window`](https://github.com/MenotiFilho/streamingapp/issues/196) | `src/shell` → `src/window`; `src/main.tsx` → `src/window/main.tsx`; `index.html` and every import updated | Every suite green with import-only edits; `pnpm typecheck`; `pnpm build`; `git diff -M` shows renames and import lines only |
| [A2 — extract the client core](https://github.com/MenotiFilho/streamingapp/issues/197) | `host-client.ts` → `core/wire.ts`, `core/errors.ts`, `core/answers.ts` plus the class in the window; the shared pure modules → `src/core/`; `src/core/react/`; the structure test | Every suite green with import-only edits; the structure test; typecheck; build |
| [A3 — move the primitives, tokens and icons to `src/kit`](https://github.com/MenotiFilho/streamingapp/issues/198) | The generic primitives (`Button`, `Chip`, the two cards, `ConfirmDialog`, `PendingSpinner`, `Popover`), the icons, `tokens.css` and `kit.css` → `src/kit`; `RowTrack`/`rowPaging` → the window; `host-wire` reads the new paths | Every suite green with no assertion changes; `host-wire` green; typecheck; build; the design record's paths updated |
| [A4 — add `Field`, and adopt it](https://github.com/MenotiFilho/streamingapp/issues/199) | `Field` joins the kit; Search, Addons and Settings adopt it; `LogRefusal` dies | The `Field` suite; the three screens at the Action boundary |
| [A5 — put the window on `HostLink`](https://github.com/MenotiFilho/streamingapp/issues/200) | `core/link.ts`; `TauriLink`, `PreviewLink`; `HostClient` retired; the rehearsal boots | The link contract suite; every window suite; the rehearsal mounts |
| [A6 — put the window on `Session`](https://github.com/MenotiFilho/streamingapp/issues/201) | `core/session.ts`, `useSession`; the Snapshot store, pending, `unplayable`, `HomeStore`, `take`/`ask`; `Shell` reads it | The Session suite; Home, journey and player suites |
| [A7 — put the window on `Navigation`](https://github.com/MenotiFilho/streamingapp/issues/202) | `core/navigation.ts`, `useNavigation`, `canGoBack`; the window's payload replaces `ShellLevel` | The navigation suite; Back and focus suites |
| [A8 — put the window on the playback view](https://github.com/MenotiFilho/streamingapp/issues/203) | `playbackView`, `transportControls`, `playerPanels`, `episodes`; the three hooks → `core/react/`; `Menu*` joins the kit; the OSD re-points | The four new suites; the OSD deep suite; focus and journey |
| [A9 — walk the window on Windows](https://github.com/MenotiFilho/streamingapp/issues/204) | A task: stage, build and walk the branch with `verify.ps1 -Monitor 1`; evidence on the ticket | Every step green; the OSD ladder, focus and idle unchanged; evidence attached |

A1–A3 are mechanical: renames and import lines only. A changed assertion in a
mechanical ticket is a bug in the move, not a licence to rewrite the test. A5–A8
are the four seams, one per ticket, so a failure names the seam it came from.

A9 is the phase gate. A regression it finds is fixed in phase A, before any
Remote ticket starts.

## 3. Phase B — the Remote behind `/next`

| Ticket | What it lands | Gate |
|---|---|---|
| [B1 — the skeleton, `/next` staging and the artifact](https://github.com/MenotiFilho/streamingapp/issues/205) | `remote.html`, `vite.remote.config.ts`, `RemoteApp` on `WebSocketLink` + `TokenStore` + `Session` + `Navigation`, the pairing gate, six placeholders, pairing/history suites, the committed artifact, `remote_next.rs`, the `/next` routes, the CI staleness step | The link contract over the fake socket; pairing and reconnect; `/next` route tests; `build-info.json` equals `SPELLINGS` and `ACTION_VERSION`; the artifact current; a phone pairs and reconnects |
| [B2 — Home](https://github.com/MenotiFilho/streamingapp/issues/206) | The phone Home on the core Home decisions, the 24 s beat, `HomeStore`, the kit's cards, `RemoteRail` | A Home component test; the core Home suite; artifact rebuilt |
| [B3 — Discover and Search](https://github.com/MenotiFilho/streamingapp/issues/207) | The two phone screens on the shared genre tables and decisions; the Remote's own copy | A component test per screen; core suites; artifact rebuilt |
| [B4 — Library](https://github.com/MenotiFilho/streamingapp/issues/208) | The core `accountLibrary` on the phone: signed out, empty, the list with Continue and expired marks; `library` gains a control | A Library component test; core `accountLibrary` suite; artifact rebuilt |
| [B5 — Addons](https://github.com/MenotiFilho/streamingapp/issues/209) | The form and register on `addons.ts`, `Field` and `ConfirmDialog` | An Addons component test; core `addons` suite; artifact rebuilt |
| [B6 — Title and Streams](https://github.com/MenotiFilho/streamingapp/issues/210) | The two levels on `titlePage`, `streamsList` and `streamChoice` | A component test per level; core suites; artifact rebuilt |
| [B7 — Settings, About and Credits](https://github.com/MenotiFilho/streamingapp/issues/211) | The four leaves and About/Credits on `settingsRegister`, `Field` and the bundled version row | Component tests; core `settingsRegister` suite; artifact rebuilt |
| [P1 — phone-check the six destinations](https://github.com/MenotiFilho/streamingapp/issues/212) | A task: walk the six destinations, a Title, its Streams and the settings leaves at `/next` | Every screen draws; Back unwinds; a refusal is readable; evidence attached |
| [B8 — the player's transport surface](https://github.com/MenotiFilho/streamingapp/issues/213) | Strip, expanded card, timeline, volume, Stop/Back, seek preview; the strip for all three `picture` values | Component tests; the preview suite; the OSD suite; artifact rebuilt |
| [B9 — the player's sheets and Episodes](https://github.com/MenotiFilho/streamingapp/issues/214) | The five menus from `playerPanels`, the A&S composition in one `Sheet`, the Episodes sheet from `core/episodes` | Component tests; the `episodes` and `playerPanels` suites; artifact rebuilt |
| [P2 — phone-check the player](https://github.com/MenotiFilho/streamingapp/issues/215) | A task: play a film and an episode, open every menu, change a track and a delay, seek, lock the phone | The strip follows the Host; choices land; the Episodes sheet plays; evidence attached |

The skeleton's own phone check (pair and reconnect) is part of B1's gate, not a
task ticket. The task tickets are where a hand-check is the only evidence that
counts — the window on Windows, the phone's screens, the phone's player — and
each blocks the ticket after it.

## 4. Phase C — the cutover

| Ticket | What it lands | Gate |
|---|---|---|
| [C1 — cut over to the React Remote at `/`](https://github.com/MenotiFilho/streamingapp/issues/216) | Rebuild with `base: "/"`; `remote/` deleted, `remote-next/` moved to `remote/`; `/` serves the React Remote; `/next` 308 → `/`; the Motion route, the splices, the legacy page and its suites deleted; the testing doc and `verify.ps1` step 26 updated | Every suite and the wire suite; the artifact current; the window and the phone walked at `/` on the branch before merge; rollback is a revert |

The cutover is one PR because the two pages cannot both own `/`. Everything
before it is reversible by reverting a single PR; C1 is reversible by reverting
one commit that touches only the serving layer and the deleted legacy files.

## 5. What each gate means

The ADR-0032 rule, applied to a client that now has seams:

- the screen's decisions are tested in `src/core` (most already are; a new rule
  gets a module first);
- a `src/remote/<screen>.test.tsx` component test drives the screen from a fake
  `HostLink` and asserts the Action at the boundary, the first mount, and one
  empty or failure path;
- no markup, class or CSS assertions;
- the artifact is rebuilt and committed; the CI staleness step is green;
- every existing suite, `cargo test`, clippy `--all-targets -- -D warnings`,
  `cargo fmt --check`, `pnpm typecheck` and `pnpm build` are green;
- a review-trail comment on the PR says what was found, what changed and what was
  deliberately kept.

The player tickets add the three `picture` values to the strip's test and the
seek preview's bucket/cache rule; B9 adds the Episodes sheet and the A&S
composition order.

## 6. What is frozen, deleted, and when

| Thing | During A/B | At C1 |
|---|---|---|
| `crates/host-wire/remote/index.html` | frozen, serves `/` | deleted |
| `remotePage.test.ts`, `remoteFocus.test.ts` | green, untouched | deleted |
| `remote.rs`'s page tests, `splice()`, the six markers | green, untouched | deleted |
| `remote/icons.svg`, `motion-14.7.1.js`, the Motion script | unchanged | deleted |
| `src/core`, `src/kit`, `src/window`, `src/remote` | grows | stays |
| `crates/host-wire/remote-next/` | rebuilt every Remote PR | moved to `remote/` with `base: "/"` |
| `dist/` | window only; `pnpm build` unchanged | unchanged; the `dist/remote.html` guard stays |
| `/next` | serves the React Remote | 308 → `/` |
| `/fonts/*` | unchanged | unchanged |

## 7. Divergences fixed by construction

These are bugs the two clients disagreed about, not layouts. Each disappears
because the React Remote imports the shared module:

- the 6 s feature beat becomes the core Home decision's 24 s;
- `loadHome`'s page wipe becomes `HomeStore`'s surviving rows;
- the missing error kinds become the core `explain`;
- the unspliced genre tables become one import;
- the three reduced-motion reads become one `core/react` hook;
- the missing version row becomes the bundle's `package.json` read.

The window's picture gap (#194) and its missing Episodes menu (#195) are filed
after the cutover, as decided in #191. They are not part of this migration and do
not block it.

## 8. Cutover and rollback

C1 rebuilds the artifact with `base: "/"`, removes the legacy directory, moves
the new one into its place, serves `/` from it, and turns `/next` into a permanent
redirect to `/`. It deletes the hand-written page, the six splices, the vendored
Motion and its build script, `remotePage.test.ts`, `remoteFocus.test.ts`, and the
page-level tests in `remote.rs`; `docs/agents/testing.md` loses "the served Remote
has no seams" and `scripts/windows/verify.ps1` step 26 names the new page.

The gate is a pre-merge walkthrough on the branch: the Windows `verify.ps1` with
its evidence, and the phone's six destinations and player at `/`. Merge only
after that. A rollback is a revert of C1; during A and B, `/` is untouched, so a
`/next` regression is a revert or a rebuild, never a production incident.

## 9. Working agreements

- One ticket, one PR, one branch; the plan is the index and the ticket holds the
  detail.
- `pnpm build:remote` and a committed artifact in every Remote PR, including the
  ones that only change a screen; never a hand edit inside
  `crates/host-wire/remote-next/` (the next build deletes it).
- `cargo test` never runs pnpm. The artifact in the tree is what the macro
  compiles.
- The window's behaviour is frozen while the tree moves: a changed assertion in
  A1–A3 is a bug, and a seam ticket changes an assertion only with a decision
  recorded on its PR.
- A screen's component test is a seam, not a screenshot: the first mount, the
  Action at the boundary, and one empty or failure path.
- The three task tickets carry evidence (screenshots, the Host log excerpt) on
  the ticket itself; a defect they find is fixed before the next ticket starts.

## 10. What this plan does not decide

- The Host's Rust Action surface, wire protocol, Snapshot shape or pairing: none
  changes.
- A redesign of the window's visual language, the Remote's hand scale or the
  design system: the Repertory language and its measured values stand.
- The window's picture gap (#194) and Episodes menu (#195): after the cutover.
- A native mobile app, a public deployment or a CDN: out of scope.
- The actual implementation: this plan is the sequence, and every line of it
  lands as its own ticket.
