# The Remote and the window: what is duplicated, what is shared, and what only one of them has

**Ticket:** #188 (wayfinder map #187). **Captured on:**
`research/remote-window-duplication` @ `d5821ae`. **Read:** 2026-10-31.

This is an inventory, not a decision. It maps every render function, screen,
style block and piece of state in the served Remote
(`crates/host-wire/remote/index.html`, 6,453 lines) to its counterpart in the
window (`src/`, 17,196 non-test lines, of which 7,542 are the repertory
surface), classifies each by kind, and sizes the moves a migration plan would
sequence. Where the two clients genuinely differ — not "drawn differently" but
"one can do a thing the other cannot" — it says so plainly.

It is the evidence base for #190 (the core boundary), #191 (the kit's shared
surface and the player split) and #192 (the migration sequence), and for ADR-0035,
which records it.

## How to read the classification

Every entry is one of four things. The line between them is what a migration
plan can and cannot share.

- **Pure decision** — facts in, words or geometry out. No DOM, no Host, no
  socket. Two clients can share the module unchanged; React and a classic
  script can both call it.
- **Client state** — what *this* device is looking at, has typed, or has in
  flight. Never published, never shared between devices (ADR-0005). Two clients
  cannot share the *values*, but they can share the *shape* of the reducer.
- **Transport** — the socket or the IPC channel, the frames, correlation,
  pairing, reconnection. One client uses `tungstenite` over a WebSocket; the
  other uses Tauri IPC. Neither can share the code, both share the protocol.
- **Platform** — what only one client can do because of where it runs: mpv's
  child window, a ten-foot focus ladder, a phone's system Back, the tab's
  history, the absence of the Gamepad API on an insecure origin.

## 1. The two clients in numbers

| | Remote (`crates/host-wire/remote/index.html`) | Window (`src/`) |
|---|---|---|
| One document | 6,453 lines, no build step | Vite + React, 17,196 non-test lines |
| Styles | 1,777 lines in the page (`:8-1784`), 266 rules, one `@media` | `repertory.css` 2,791 + `kit.css` 821 + `osd.css` 1,044 |
| Markup | 80 lines (`:1786-1865`), three surfaces and a level host | JSX across 20 screen and kit components |
| Script | 4,568 lines classic (`:1866-6433`) + 20 lines module (`:6434-6453`) | TS/TSX, 12,931 lines of tests beside it |
| Functions | 246 | — |
| Actions it can send | 44 (the whole `Action::SPELLINGS`, ADR-0018 §2) | 44 in the type; 43 sent — no window control sends `pair_device`, because the window *is* the Host |
| Controls that dispatch | 54 `data-a` names handled in `act()` | per-screen handlers |
| Shared *code* with the other client | `tokens.css`, `icons.svg`, four JSON lists, the TMDB mark — all spliced at serve time | the same files, imported at build time |

The single most important number is the last one. The two clients share
**assets and lists**, not code. Everything else is a hand-kept parallel.

## 2. The page, section by section

Line ranges are of `crates/host-wire/remote/index.html`. "Window counterpart"
names the module or component that holds the equivalent today.

| Lines | Section | Count | Class | Window counterpart |
|---|---:|---|---|---|
| 1-7 | doctype, head, meta | 7 | platform | `index.html` |
| 8-1784 | the whole style sheet | 1,777 | platform | `tokens.css` (shared) + `repertory.css` / `kit.css` / `osd.css` (parallel) |
| 1787-1865 | body: sprite, capability block, status stack, pairing, three surfaces | 79 | platform | `main.tsx`, `RepertoryEntry.tsx`, `ShellFrame.tsx` |
| 1869-1903 | wire constants, capabilities, key intents | 35 | transport | `host-client.ts:8`, `input.ts:32` |
| 1904-1957 | `Raw`/`esc`/`html`/`mark` — safe HTML | 54 | platform | React's own escaping; `icons.tsx` |
| 1958-2027 | the model's constants (kinds, speeds, appearance, buffer, aspects, nav, settings, genres) | 70 | pure | `discover.ts`, `controls.ts`, `navigation.ts`, `settingsRegister.ts` |
| 2028-2251 | formatting and view models | 224 | pure | `playback.ts`, `controls.ts`, `osd.ts`, `stream.ts` |
| 2252-2309 | Title and Stream identity | 58 | pure | `title.ts`, `stream.ts` |
| 2310-2486 | the browse model (rows, feeds, answers, hero, addons) | 177 | pure | `browse.ts`, `discover.ts`, `home.ts`, `addons.ts`, `library.ts` |
| 2487-2547 | `explain`, the error table | 61 | pure | `host-client.ts:372-505` |
| 2548-2730 | spatial focus, keyboard only | 183 | pure + platform | `focus.ts`, `layout.ts`, `reveal.ts` |
| 2731-2877 | `net`, the WebSocket and its frames | 147 | transport | `HostClient` + `tauriTransport`, `host-core/src/wire.rs` |
| 2878-2958 | `state`, lookups, in-flight maps | 81 | client state | `Shell` + `HomeStore` + screen state |
| 2959-2987 | projection (`livePosition`) | 29 | pure | `usePlaybackPosition.ts` + `osd.projectedPosition` |
| 2988-3108 | Motion: presets, rise/sink/fade, reduced motion | 121 | platform | `motion.ts`, `frame.ts` |
| 3109-3210 | drawer open/close, `goBack` helpers | 102 | client state | `Shell.back()` + `navigation.ts` |
| 3211-3346 | the five redraw signatures | 136 | client state | React reconciliation (no counterpart) |
| 3347-3372 | `renderScreen` / `renderDestination` | 26 | platform | `RepertoryScreens.tsx` |
| 3373-3523 | **Home** | 151 | platform | `RepertoryHome.tsx` (531) + `RailGrid`/`EditorialRow` |
| 3524-3587 | **Discover** | 64 | platform | `RepertoryDiscover.tsx` (322) |
| 3588-3666 | **Search** | 79 | platform | `RepertorySearch.tsx` (483) |
| 3667-3704 | **Library** | 38 | platform | `RepertoryLibrary.tsx` (203) |
| 3705-3775 | **Addons** | 71 | platform | `RepertoryAddons.tsx` (322) |
| 3776-3796 | **Settings** index | 21 | platform | `RepertorySettings.tsx` (797) |
| 3797-4219 | the level stack: Title, Streams, four Settings leaves, About, Confirm | 423 | platform | `RepertoryTitle` (283), `RepertoryStreams` (268), `RepertorySettings` |
| 4220-4272 | the docked cast strip | 53 | platform | **no counterpart** |
| 4273-4459 | surface 2, the expanded Cast Remote | 187 | platform | `PlayerOverlay.tsx` (1,088), differently |
| 4460-4608 | the seek preview | 149 | pure + client state | `usePreview.ts`, `osd.previewBucket`/`chapterAt`/`streamKey` |
| 4609-4869 | surface 3, the shared playback drawer | 261 | platform | `PlayerPopovers.tsx` (476) |
| 4870-4929 | draft/focus/scroll capture and restore | 60 | client state | React (no counterpart) |
| 4930-4989 | the system Back sentinel | 60 | platform | **no counterpart** |
| 4990-5067 | `paint` / `refresh` | 78 | client state | React (no counterpart) |
| 5068-5102 | `ask` and `dispatch` wrappers | 35 | client state | `Shell.ask` / `Shell.take` |
| 5103-5228 | the Home loaders | 126 | client state | `HomeStore.ts` (413) |
| 5229-5323 | the Discover and Search loaders | 95 | client state | `discover.ts` feed helpers + screen effects |
| 5324-5440 | Title and Streams flows | 117 | client state | `RepertoryTitle` / `RepertoryStreams` |
| 5441-5626 | the playing series' Episodes, on demand | 186 | client state | **no counterpart** |
| 5627-5680 | confirms and the settings Actions | 54 | client state | `ConfirmAction.tsx`, `Settings` screens |
| 5681-6043 | `act()` — 54 control names to 44 Actions | 363 | client state | every screen's handler |
| 6044-6195 | delegated events, keydown | 152 | platform | `useSpatialFocus.ts` |
| 6196-6300 | pairing and the conversation | 105 | transport | **no counterpart** (the window is the Host) |
| 6301-6432 | staying connected: reconnect, heartbeat, probe | 132 | transport | Tauri IPC (no equivalent; the channel is the process) |

Four rows are worth reading twice because they are **not** a redrawing of
something the window has: the docked strip (`:4220-4272`), the system Back
(`:4930-4989`), the Episodes sheet (`:5441-5626`), and pairing
(`:6196-6300`).

## 3. Screens, side by side

Every destination exists on both clients. The anatomy and the amount of it do
not match.

| Destination | Remote | Window | Verdict |
|---|---|---|---|
| Home | hero with dots (`:3389-3411`), Continue watching (`:3413-3446`), rows with a More card (`:3463-3484`) | feature with position and date, Continue watching rail, rails plus a grid | equivalent, differently shaped: the window has section numbers (`homeSectionIndex`), a programme date, a capped 20-item rail and a grid opened from More; the Remote has none of those |
| Discover | one flat grid, kind chips, genre chips, one More (`:3525-3586`) | one row per kind with a rail, a genre row, a grid from More, feed states, no-key gate | equivalent decision set, different structure. The no-key copy is near-verbatim (`editorial.discoverNoKey`, `:3535-3543`) |
| Search | one form, two TMDB rows or one row per searchable Catalog (`:3589-3665`) | the same, as editorial rows with rails | equivalent |
| Library | **a stub**: "will appear here once the Library is built" (`:3668-3680`) | reads the account collection, marks Continue and expired sessions (`RepertoryLibrary`, `accountLibrary.ts`, ADR-0029) | **not equivalent — the window is ahead** |
| Addons | form, status line, expandable rows, move/remove (`:3706-3774`) | two-column logbook with the same Actions | equivalent |
| Settings | four categories, each a pushed level (`:3777-3796`, `:4004-4201`) | the same four as `settingsLevelId` levels | equivalent, except About (below) |
| Title | hero, facts as chips, season chips, episode buttons (`:3841-3943`) | programme page with a facts rail, season index, one action | equivalent decisions (`titlePage.ts`), different order |
| Streams | Addon-grouped buttons with badges, filename, warnings, unplayable mark (`:3945-4002`) | the same in `RepertoryStreams` with counts and roles | equivalent; the window adds `candidateCountLabel` and `badgeRole` |
| Confirm | a modal card (`:4203-4218`) | `ConfirmDialog` + a level | equivalent |

### Where Settings diverges in content, not shape

- **About/Credits** — the Remote prints TMDB, licences (`:4188-4201`); the
  window also prints the app version (`RepertorySettings.tsx:766-776`). The
  Remote has no `package.json` to read and no version on the page.
- **Credentials** — the Remote prints the protection ledger (`:4018-4052`); the
  window prints the same ledger from `settingsRegister.protectionLedger`. The
  copy matches; the backend wording does too (`OS keyring`, `Owner-only (0600)
  file`).
- **Remote devices** — both print address, code and devices; the Remote stamps
  `new Date(pairedAt).toLocaleString()` (`:4180`), the window uses
  `Intl.DateTimeFormat("en-GB", …)` (`RepertorySettings.tsx:788-797`). Two
  renderings of one fact.

## 4. The pure decisions

This is the part with the most genuine duplication: the same function, twice,
usually line for line. The table lists the Remote's function(s), the window
module that already holds the decision, and how close the two are.

Legend: **same** = behaviour and wording identical; **near** = same decision,
different rendering or a narrower table; **split** = the window has more
structure than the Remote's single function.

| Remote (`:`) | Window module | Verdict |
|---|---|---|
| `formatTime` `:2028-2041` | `playback.ts:68-84` | same |
| `remainingTime` `:2040-2045` | `osd.ts:114-125` | same |
| `timelineFraction` `:2047-2052` | `osd.ts:127-146` | same |
| `bufferedSpan` `:2054-2068` | `osd.ts:148-169` | same |
| `formatDelay`, `stepDelay` `:2070-2076` | `controls.ts:114-127` | same |
| `stepScale`, `formatScale`, `scaleSelected`, `scalePreset`, `colorSelected` `:2077-2093` | `controls.ts:179-213` | same |
| `formatBufferSeconds`, `formatBufferMegabytes`, the two presets `:2094-2105` | `controls.ts:247-269` | same |
| `currentBuffer` `:2108-2111` | inline in `RepertorySettings` | near (the window has no exported helper) |
| `formatSpeed`, `formatVolume` `:2112-2113` | `controls.ts:129-140`, `278-281` | same |
| `chapterLabel` `:2114-2117` | `controls.ts:288-300` | same |
| `speedSelected` `:2118-2120` | `controls.ts:270-273` | same |
| `centredCrop`, `cropChoices`, `cropSelected`, `aspectSelected` `:2121-2160` | `controls.ts:302-376` | same |
| `formatBitrate`, `statisticsLines` `:2162-2178` | `controls.ts:380-409` | same |
| `orderedTracks`, `subtitlesOn`, `trackLabel`, `trackMarks` `:2180-2197` | `controls.ts:70-112` | same |
| `watching`, `transportable` `:2198-2199` | `playback.ts:19-37` | same |
| `previousEpisodeDisabled`, `nextEpisodeDisabled` `:2200-2203` | `controls.ts:420-431` | same |
| `pictureNote` `:2204-2210` | `playback.ts:39-52` | near — same fields, the Remote rewords the `own_window` sentence |
| `badgeLines`, `playingName` `:2211-2219` | `stream.ts:39-49`, `playback.ts:54-66` | same |
| `qualityBadge`, `streamTitle` `:2220-2230` | `osd.ts:29-51` | same |
| `playabilityNote`, `warningNote`, `streamName`, `unplayableNote` `:2231-2251` | `stream.ts:73-111` | same |
| `isSeries`, `seasonsOf`, `seasonName`, `labelOf`, `nameOf`, `posterOf`, `releaseOf`, `titleArtOf`, `titleStubOf` `:2252-2294` | `title.ts:45-206` | same |
| `tmdbIdOf`, `discoveredKeyOf`, `theFilm` `:2296-2308` | `title.ts:159-190`, `stream.ts:28-37` | same |
| `declaredCatalogs`, `blankRow`, `rowWith`, `keyOf`, `catalogKey`, `pageable`, `unaskable`, the four `answered*` `:2310-2366` | `browse.ts`, `host-client.ts:823-875` | same |
| `progressOf`, `resumable`, `cardName`, `cardNote` `:2368-2387` | `library.ts:20-66` | same |
| `blankFeed`, `feedWith` `:2388-2399` | `discover.ts:115-178` | same |
| `discoverPlayable`, `discoverAsk` `:2400-2419` | `discover.ts:94-102`, `:179-197` | same |
| `heroArt`, `heroSlides`, `featuredRow`, `continueArt`, `addonName` `:2421-2447` | `home.ts:42-111` | same; the Remote drops `addonLabel`, `HERO_SLIDES` is 4 on both |
| `joinOrNone`, `resourcesOf`, `catalogsOf`, `moveTarget`, `addOutcome` `:2448-2471` | `addons.ts` | same, except `addStatusText`: the Remote builds the sentence inline (`:3724-3729`) |
| `protectionReadout` `:2472-2481` | `settingsRegister.ts:56-65` | same wording |
| `subtitleLanguageName` `:2482-2486` | `languages.ts:32` | same (both read the spliced JSON) |
| `spellingOf` `:2400-2405` | Host side (`AddonManifest::spelling`) | near — a client-side re-derivation of an Addon resource rule |

Three observations:

1. **`explain` is the one table that is deliberately smaller.** The Remote
   covers 41 of the Host's 57 `HOST_ERROR_KINDS` and falls back to
   `error.detail || error.kind` (`:2492-2545`). It omits `invalid_aspect`,
   `invalid_catalog_ref`, `invalid_crop`, `invalid_preview_at`,
   `invalid_seek_target`, `invalid_speed`, `invalid_stream_buffer`,
   `invalid_subtitle_color`, `invalid_subtitle_delay`, `invalid_subtitle_scale`,
   `invalid_title_ref`, `invalid_video_ref`, `invalid_volume`, `library`,
   `subtitles`, `unknown_chapter`, `unknown_track`. Several of those are
   reachable from controls the page *does* draw — the colour and size chips, the
   buffer chips, the speed list, the seek bar — so a refusal's fallback is a raw
   kind string, not a sentence. The window's table is the fuller one.
2. **The genre tables are a verbatim duplicate, not spliced.** The Remote's
   `MOVIE_GENRES`/`SERIES_GENRES` (`:2008-2024`) are the same 19 and 16
   TMDB ids and names, in the same order, as the private tables in
   `src/discover.ts:33-74`. Unlike the subtitle-language list, they are not
   spliced, so a TMDB genre rename is a two-place change.
3. **`statisticsLines` is in `controls.ts`, not `osd.ts`** — worth knowing
   before a migration plan puts the OSD's model in one file.

## 5. Client state

The Remote keeps one flat `state` object (`:2884-2938`) with 34 fields and
rebuilds it by hand on every paint. The window keeps the same facts spread
across five places.

| Remote field | Window equivalent | Class |
|---|---|---|
| `token`, `device`, `online`, `snapshot`, `playbackAt`, `needsRefresh` | `HostClient` + `Shell`'s `snapshot` state | transport / client state |
| `error` | `Shell.error` | client state |
| `destination` | `Navigation.destination` (`navigation.ts:57-61`) | client state |
| `levels` | `Navigation.levels` (`ShellLevel[]`) | client state |
| `heroIndex`, `heroHeld`, `heroTimer` | `RepertoryHome`'s feature state | client state |
| `home.rows`, `home.loading`, `home.generation`, `home.paging` | `HomeStore` | client state |
| `discover.kind`, `genre`, `feed`, `loading`, `generation` | `RepertoryDiscover` state + `discover.ts` feed | client state |
| `search.*` | `RepertorySearch` state + `search.ts` | client state |
| `unplayable` | `Shell.unplayable` (a `Set`, ADR-0020) | client state |
| `addons.expanded`, `addons.status`, `addons.expect` | `RepertoryAddons` state + `addStatusText` | client state |
| `cast`, `sheet`, `sheetOpened`, `episodes` | `Shell`'s `player` level + `popover` levels | client state |
| `showStatistics` | state inside the picture popover | client state |
| `focusTarget`, `sheetReturn`, `castReturn` | `reveal.focusAndReveal` + each level's return key | client state |
| `seriesCache` | none — the window has no Episodes sheet | client state |
| `screenSignature` … `sheetSignature` | none — React's reconciliation | client state |
| `bufferDraft` | none — the window reads the Snapshot only | client state |

Two structural differences matter for any move:

- **Signatures instead of reconciliation.** The Remote decides whether to
  redraw a region by building a string from the fields it draws
  (`screenSignature` `:3212-3247`, `levelSignature` `:3249-3276`,
  `miniSignature`, `castSignature`, `sheetSignature`). A field missing from a
  signature is a stale region; the window has no such failure mode. Moving a
  screen to React deletes its signature, and the tests that pin signature
  contents go with it.
- **Manual view preservation.** Every repaint captures the focused control's
  key, the four scroll offsets and every input draft, then restores them
  (`captureView`/`restoreView` `:4891-4918`, `captureDrafts`/`restoreDrafts`
  `:4874-4890`). React keeps the DOM node instead. The window's equivalent
  concerns are `reveal.ts` (bring a control into view) and `useSpatialFocus`
  (where focus is), not node identity.

## 6. The transport seams

There are two doors to one Action surface (ADR-0002, ADR-0008), and they meet
only at the Host.

| Concern | Remote | Window |
|---|---|---|
| Channel | `new WebSocket(wss://location.host/)` (`:2746-2749`) | `tauriInvoke`/`tauriListen` (`host-client.ts:554-562`) |
| Frame encode | `{version, id, command}` (`:2831-2838`) | `{version, action}` envelope inside `dispatch` (`host-client.ts:574-579`) |
| Frame decode | `welcome` / `reply` / `refusal` / `snapshot` handled in `onFrame` (`:6234-6296`) | a `host://snapshot` event with the Snapshot as payload (`host-client.ts:582-586`) |
| Correlation | `net.pending` keyed by `id` (`:2733-2735`, `:2831-2838`) | the IPC promise |
| Greeting | `hello` with the stored token, answered by `welcome` (ADR-0017 §7) | none — the window *is* the Host |
| Reconnect | 8 s connect timeout, 12 s heartbeat, 30 s stale, 1.5 s probe wait (`:1878-1882`, `:6301-6432`) | none |
| Pairing | form → `pair_device` → token in `localStorage` (`:6197-6218`) | no form; the window shows the code in Settings |
| The codec's home | `host-core/src/wire.rs` (frames, version, `permitted`) | the same file, by the IPC command |
| Snapshot shape | read by hand from JSON | `Snapshot` type in `host-client.ts:14-77` |

`RepertoryEntry.tsx` and `context.tsx` are not transport at all: `RepertoryEntry`
wraps `Shell` in one `MotionConfig` and the repertory class, and `context.tsx`
carries a single boolean (`PreviewDataProvider`) that says the plain Vite page
has no Host. A second entry for the Remote would reuse `Shell`, not these.

### The hooks, and what the page does instead

| Hook (`src/shell/`) | Lines | What it owns | The page's version |
|---|---:|---|---|
| `usePlaybackPosition.ts` | 37 | projects the anchor forward on a 250 ms clock | `livePosition` `:2972-2986` + `updateCastLive` |
| `usePreview.ts` | 171 | the 5 s bucket, one ask in flight, the 200-still cache | `seekPreview` `:4468-4608`, same constants |
| `useOsdVisibility.ts` | 110 | the 3 s idle window and what pins it | none — the expanded card never hides |
| `useSpatialFocus.ts` | 425 | keydown → intent → `decideMove` → focus and reveal | `moveFocus`/`focusables`/`activeScope` `:2623-2729` + `focusByKey` |
| `usePending.ts` | 47 | one wait per control, a second press dropped | `runWaiting`/`runAction`/`WAITING_CONTROLS` `:5719-5738` |
| `useGamepad.ts` | 81 | pad buttons and axes, with repeat | none — no pad on an insecure origin |
| `useFullscreen.ts` | 254 | the Tauri window's fullscreen | none |
| `useReducedMotion.ts` | 23 | the media query | `motion.reduced` in `startRepertoryMotion` `:3093-3106`, and `scheduleHero` re-reads it `:5201` |

Three have no page counterpart at all (`useOsdVisibility`, `useGamepad`,
`useFullscreen`); two are near-identical (`usePlaybackPosition`, `usePending`);
the rest are narrower copies.

**The one place the two clients must agree by construction** is the codec:
`WIRE_VERSION = ACTION_VERSION` (ADR-0017 §1), so the version a phone sends and
the version a window sends are the same number. The Remote's `VERSION = 1`
(`:1872`) is the only copy outside Rust.

## 7. The kit: generic, window-specific, and the OSD

Eight primitives, 820 lines of `kit.css` and 1,395 lines of TS/TSX including
their suites (`src/shell/repertory/kit/`).

| Primitive | Lines | What it decides | Shareable with a phone? |
|---|---:|---|---|
| `Button` | 64 | variant, pending, disabled | **generic.** A `data-focusable` button is the same control at ten feet and in a thumb. |
| `Chip` / `ChoiceChip` | 61 | pressed state, tone | **generic** for appearance; the phone wants 44 px targets, which is a scale token, not a different component. |
| `PosterCard` | 123 | 2:3 art, caption, rating, Unmapped/Unplayable/Continue marks, `openable` | **mostly generic.** The `columns`/half-card anatomy belongs to the rail; the card itself is one shape. |
| `ContinueWatchingCard` | 87 | 16:9 art, 2 px progress line, note, name, unplayable | **mostly generic**, same caveat. |
| `RowTrack` | 303 | numbered head, equal-share columns, half card, drag, two arrow paging on Motion | **window-specific in mechanics.** A phone scrolls with a thumb; the arrows and the 5.5-card view are a ten-foot decision. The *head* (index, title, rule, tag, action) is generic. |
| `ConfirmDialog` | 88 | modal, Cancel/Confirm order | **generic** (a phone uses the same order). |
| `Popover` | 34 | anchored panel | **window-specific**: the Remote's menus are a bottom drawer (ADR-0031 §4), not an anchored panel. |
| `PendingSpinner` | 12 | the wait | **generic.** |

The OSD is not in the kit and should not be treated as one primitive:

- `PlayerOverlay.tsx` is 1,088 lines: the three-stop ladder
  (`picture`/`strip`/`top`, `:66-92`), the auto-hide clock (`useOsdVisibility`,
  3 s), the volume pillar, the timeline with chapter ticks and callouts, and
  sixteen Actions between the strip and the five popovers.
- The Remote's player is 187 lines of card (`:4273-4459`) plus 261 lines of
  drawer (`:4609-4869`) plus 149 lines of seek preview (`:4460-4608`).
- They share **no component**. They share `osd.ts`'s decisions, `usePreview`'s
  bucket/cache rule and the `PREVIEW_BUCKET_SECONDS = 5` / `PREVIEW_STILLS_KEPT =
  200` constants — duplicated by hand in the page (`:4480-4483`).

The honest summary for #191: **six of eight primitives are generic, or nearly
so; `RowTrack` and `Popover` are ten-foot artefacts; the OSD is a window
artefact with a phone sibling, not a shared component.**

## 8. The tests that lock the two clients

| Suite | Lines | Tests | What it actually locks |
|---|---:|---:|---|
| `crates/host-wire/src/remote.rs` | 938 | 20 | the page's capability JSON **equals** `Action::SPELLINGS`; `KEY_INTENTS` equals `src/input.ts`'s keyboard column and the page has no pad column; the subtitle-appearance and stream-buffer JSON equal the Host's bounds; the subtitle-language list is present; every token is spliced; the icon *names and path data* match `icons.tsx`; the Motion asset is pinned and licence-headed; five menus in one drawer, Volume outside it; the seek bar draws buffered/played; the seek preview exists; the TMDB notice and mark; no marker survives; no local palette; a press is answered at once |
| `crates/host-wire/tests/wire.rs` | 649 | 15 | pairing, push, reply-not-state, subtitle appearance and buffer over a real socket, reconnect, revoke (twice: before and between), no re-pair, version refusal, lockout after five bad codes, `/` serves the page, `/next` redirects, the motion asset is immutable, the fonts |
| `crates/host-core/src/wire.rs` | 491 | 12 | the codec: flat frames, greeting-only/command-only, version judged first, id correlation, one frame carrying one thing, unknown key refused, spell-back round trip, `permitted` for both pairing states |
| `src/shell/repertory/remotePage.test.ts` | 575 | 17 | the page **boots** in jsdom over the spliced template: pairing gate, app mount, strip → card, the transport and five menus, the sprite not a glyph, drawer closes without Motion, scrim closes, the clock advances between Snapshots, statistics update in place without rebuilding the drawer, a pushed Snapshot moves the button, an in-flight command is refused on close, reconnect + hello, visibility probe, idle greeting, wake probe, the history sentinel, Back unwinds a Level, Back at rest warns and disarms, a Snapshot or Welcome does not re-arm |
| `src/shell/repertory/screens.test.tsx` | 936 | 22 | the *window's* Title, Streams, Discover and Search against a fake Host, at the Action boundary |
| `src/shell/repertory/Home.test.tsx` | 555 | 20 | Home's rails, feature, Continue watching, empty and failure paths |
| `src/shell/repertory/journey.test.tsx` | 235 | 1 journey | Home → Title → Streams → Back → Title → Back → Home, focus restored |
| `src/shell/repertory/player.test.tsx` | 378 | 7 | the OSD: ladder, pad, idle, pending, refusals, popover dismissal |
| `src/shell/repertory/kit/*.test.tsx` | 602 | 33 | each primitive's props contract, without the drawing |
| `crates/host-core/tests/action_surface.rs` | — | — | the Snapshot's exact camelCased wire shape and the no-credential field walk |

### What is locked, and what is not

**Locked by construction or by assertion:**

- the Action surface (the page's JSON vs `SPELLINGS`);
- the keyboard intents (the page's table vs `src/input.ts`);
- the four shared lists (appearance, buffer, languages, icons);
- the palette (the page splices `tokens.css` and keeps no `:root`);
- the Motion version and presets;
- the page boots and its transport works.

**Not locked, and this is the migration risk:**

- **No test compares a Remote view-model function to its `src/*.ts` twin.**
  `formatTime`, `badgeLines`, `titleStubOf`, `trackLabel`, `explain`,
  `protectionReadout` and forty others are duplicated with no equality
  assertion. A change on either side is caught by a person or not at all.
- **No test compares the Remote's Snapshot field reads to `host-client.ts`.**
  The Rust shape test pins the JSON, and `remotePage.test.ts` holds its own
  hand-written `SNAPSHOT` literal (`:31-74`); nothing ties the page's reads to
  the TypeScript type. A field renamed in Rust and in `host-client.ts` passes
  every suite and breaks the page at runtime.
- **The capability list proves capability, not an affordance.** `library` is
  the proof: it is declared in `:1807` and no control in the page ever sends it,
  because the Library screen is a stub.
- **The Remote's copy is not compared to the window's.** ADR-0032 §2 refuses one
  client-wide copy table on purpose; the practical consequence is that
  "Discover is powered by TMDB", the empty states and the Addon-add sentence are
  maintained twice, and only the page's instances are asserted (as substrings,
  for the ones `remote.rs` names).
- **No CSS assertion relates the page's sheet to the window's.** Only
  `tokens.test.ts` (contrast pairs) and the frameless-chrome band exist, both
  window-side.

## 9. Where the phone and the ten-foot layouts genuinely differ

These are not restylings. They are different capabilities, and a migration plan
that "shares the screen" would lose one of them.

### 9.1 The picture

The window *becomes* the player while `picture === "in_window"` (ADR-0003):
`Shell.tsx:191-243` pushes a `player` level, adds `picture-behind` to the
document so mpv's child window shows through, and draws the OSD over it. The
Remote owns no picture. It notes where the picture is (`pictureNote`) and keeps
its browse surface. That is ADR-0018 §3 made visible, and it is correct.

**The asymmetry to decide:** with `picture === "own_window"` or `"nowhere"`, the
window's `playerActive` is false, so the window draws **no transport at all** —
no play/pause, no seek, no stop, no volume. The Remote's strip is drawn whenever
`watching()` is true, regardless of `picture`. In the one configuration where
the picture is in mpv's own window (the Windows build's fallback), *the phone has
controls and the TV does not*. That is a window gap the Remote exposes, not a
Remote excess.

### 9.2 The player: OSD over mpv vs strip + card + drawer

| | Window OSD | Remote |
|---|---|---|
| Surface | one overlay over mpv's picture | a docked strip, an expanded card, and a drawer over it |
| When it appears | while `picture === "in_window"` and `watching()` | whenever `watching()`, collapsed to the strip |
| Input | keyboard **and** gamepad, three-stop ladder (`picture`/`strip`/`top`), remembered stop per direction | keyboard only, geometry over whatever surface is on top |
| Idle | auto-hides after 3 s (`OSD_IDLE_MS`), pinned by pending/popover/focus | never hides while expanded |
| Volume | an always-visible pillar in the strip, 0–130, 5 per press, one Action when the steps settle | an always-visible box with a range input, one `set_volume` per change |
| Timeline | a `div` track with pointer capture, chapter ticks, callouts, a seek preview above the bar | an `<input type="range">` with the buffered/played fills behind it, the preview above it |
| Menus | five **popovers** anchored to their icons: Picture, Subtitles, Audio, Speed, Chapters | five **drawer** panels: Audio & Subtitles, Episodes, Speed, Chapters, Picture |
| Subtitles | its own popover: track, off, delay, size | combined with Audio; also delay and size |
| Episodes | none — only `next_episode`/`previous_episode` | a full season/episode list that picks and plays a Stream |
| Fullscreen | `FullscreenButton` (F11) | none |
| Refusal | `Refusal` inline in the OSD | the page's one alert line (`renderError`) |

The player split is therefore four moves, not one: the **decisions** (shared,
already in `osd.ts`/`controls.ts`), the **transport strip** (shareable shape, two
drawings), the **timeline** (two different controls over one model), and the
**menus** (a popover set and a drawer set over one control set).

### 9.3 Navigation and Back

- The window has a `ShellLevel` stack of three kinds (`overlay`, `player`,
  `popover`) with an "outmost first" order and `onBack`/`onIntent` hooks
  (`navigation.ts:35-54`).
- The Remote has its own stack of four kinds (`title`, `streams`, `settings`,
  `confirm`) and keeps the sheet and the cast card **outside** it; `goBack()`
  is a hand-written cascade: sheet → levels → cast → destination → false
  (`:6171-6194`).
- The Remote also owns the browser's Back: one opaque history entry, a warning
  on the second-from-last press, re-armed by navigation but not by a Snapshot or
  a Welcome (ADR-0034, `:4930-4989`).
- The window's Back rule that has no Remote equivalent: Back in the player is
  `stop_playback` (`Shell.tsx:198-210`). The Remote's Stop is a button, not Back.

### 9.4 What only one of them has

**Remote only:** the pairing form; the system-Back sentinel; the docked strip;
the expanded cast card; the shared drawer; the Episodes sheet; the reconnect
heartbeat (`CONNECT_TIMEOUT`/`HEARTBEAT_AFTER`/`STALE_AFTER`/`PROBE_WAIT`); the
redraw signatures; the draft/scroll capture.

**Window only:** the mpv picture and the `picture-behind` handoff; the focus
ladder and remembered stops; gamepad input (`useGamepad`, `PAD_BUTTONS`,
`PAD_AXES`); fullscreen; auto-hide; anchored popovers; the Version row on About;
the account Library room; the Home feature's date, section numbers and capped
rail; the grid opened from a More card.

## 10. Divergences that are bugs, not layouts

Worth fixing whichever way the migration goes, because each is a disagreement
between two clients about one Host fact.

1. **The feature rotates every 6 s on the phone** (`:5219`) and every 24 s in the
   window (`homeProgramme.FEATURE_ROTATION_MS = 24_000`). ADR-0031 §4 names the
   24 s beat. The page also full-repaints the screen on each tick instead of
   cross-fading.
2. **The Remote's Library is a stub** while `library` sits in its capability
   list (`:1807`, `:3668-3680`). The window reads the account (ADR-0029).
3. **`loadHome` wipes and re-asks every row** when the Catalog fingerprint
   changes (`:5124-5132`), where `HomeStore.sync` keeps every surviving row,
   its pages and its failure (`homeStore.ts:131-190`). Adding one Addon resets
   the phone's Home to page one.
4. **The Remote's error table omits 17 kinds** and falls back to the raw kind,
   including kinds its own controls can produce (§4).
5. **The genre tables are duplicated instead of spliced** (§4).
6. **The Media query for reduced motion is read three times** in the page
   (the CSS block, `scheduleHero` at `:5201-5203`, `startRepertoryMotion` at
   `:3095-3105`) — three answers to one setting, and only the CSS block is
   covered by the token sheet's `@media`.
7. **The window prints a version, the Remote cannot** — a `package.json` read
   the page has no path to.

## 11. Size estimates for the moves

"Lines" is the Remote code the move retires or rewrites. "Imports" is what the
target module would pull in. "Coupling" is what else moves with it.

### 11.1 The pure decisions (the cheap, high-value moves)

| Move | Remote lines | Target | Imports | Coupling |
|---|---:|---|---|---|
| formatting + player view models | ~150 (`:2028-2178`) | `controls.ts`, `osd.ts`, `playback.ts` exist; **no new code** — delete the copies | none new | none: the functions already have window twins |
| Title/Stream identity | ~58 (`:2252-2308`) | `title.ts`, `stream.ts` | none | none |
| browse model | ~177 (`:2310-2486`) | `browse.ts`, `discover.ts`, `home.ts`, `addons.ts`, `library.ts` | none | two Host-side helpers (`spellingOf`) need a decision: client rule or Host answer |
| `explain` | 61 (`:2487-2547`) | `host-client.ts:372-505` | none | the page would need the TS module in its bundle, which is the build-step question (#189) |
| draws: the genre tables | 20 (`:2008-2024`) | `discover.ts` (add an export) | none | either export the tables or splice them, like the other four lists |

The pure layer is **~470 duplicated decision lines** with an existing home. It
is only movable if the page stops being "one self-contained classic script"
(ADR-0017 §2, ADR-0018 §1) — which is exactly what #189 is researching. Without
a build step, the best available move is **splicing** the source modules into
the page the way `tokens.css` and the four JSON lists already are; that trades a
hand-kept copy for a serve-time transform with no bundler.

### 11.2 The screens

| Screen | Remote lines | Target | Imports the target needs | Coupling |
|---|---:|---|---|---|
| Home | 151 | `RepertoryHome` (531) + rails | `browse`, `home`, `library`, `kit`, `motion` | the feature (6 s vs 24 s), the rail cap, the grid |
| Discover | 64 | `RepertoryDiscover` (322) | `discover`, `editorial`, `kit` | kind/genre state, feed states |
| Search | 79 | `RepertorySearch` (483) | `search`, `editorial`, `kit` | two feeds, catalog fallback |
| Library | 38 | `RepertoryLibrary` (203) | `accountLibrary`, `StremioAccount` | **new feature on the phone**, not a port |
| Addons | 71 | `RepertoryAddons` (322) | `addons`, `ConfirmAction`, `kit` | the confirm level, the add status |
| Settings | 21 + 423 | `RepertorySettings` (797) | `settingsRegister`, `controls`, `StremioAccount` | four leaves, the version row, the date format |
| Title | 104 | `RepertoryTitle` (283) | `titlePage`, `stream`, `kit` | the season rail, the facts order |
| Streams | 59 | `RepertoryStreams` (268) | `streamsList`, `streamChoice`, `kit` | the play flow, the unplayable mark |

Estimate for the whole screen set: **~1,010 Remote lines** replaced by
**~3,000 window lines already written**, if the page can import React — which it
cannot today. As a serve-time transform, the screens would have to become a
second set of components, which is a rewrite, not a move.

### 11.3 The player

| Move | Remote lines | Target | Coupling |
|---|---:|---|---|
| transport + timeline + volume | ~120 (`:4337-4404`) | a shared `Transport` primitive | two input models (ladder vs geometry); one Action set |
| the five menus | 261 (`:4609-4869`) | `PlayerPopovers` + a phone drawer variant | popover vs drawer; one control set, two containers |
| the seek preview | 149 (`:4460-4608`) | `usePreview.ts` (171) + `osd.ts` | already one rule; the page re-implements the cache |
| the Episodes sheet | 186 (`:5441-5626`) | **nothing** — a new window feature | `open_title`/`open_discovered_title`, `find_streams`, `play_stream`; picks its own Stream, duplicating a Host rule |
| the OSD's ladder and idle | — | `PlayerOverlay` (1,088) + `useOsdVisibility` | window-only; the phone has no ladder |

The player is the **largest and least shareable** move: ~700 Remote lines with
no direct window twin, and the one part (Episodes) that would have to be built
in the window rather than moved from the page.

### 11.4 Styles

| Move | Remote lines | Target | Verdict |
|---|---:|---|---|
| the palette | 0 | `tokens.css` | already shared; nothing to do |
| the 266 rules | 1,777 | `repertory.css` + `kit.css` + `osd.css` | **not movable by copy.** The window's rules name `rep-*` classes and assume React's structure. A phone stylesheet that skins the *same* components is the realistic end state: ~300-500 lines layered on `kit.css`, with `RowTrack`, `Popover` and the OSD's ten-foot geometry replaced |
| icons | 0 | `icons.svg` from `icons.tsx` | already shared; nothing to do |

### 11.5 Transport

| Move | Remote lines | Verdict |
|---|---:|---|
| the socket + reconnect | 147 + 132 | **cannot be shared with the window** (Tauri IPC has no socket). It *can* be shared with a native or web Remote; the end state is one `Transport` interface with two implementations, exactly as `HostClient` takes a `Transport` today (`host-client.ts:546-562`) |
| pairing | 105 | Remote-only; belongs beside the Remote's transport, not in the window |
| the capability list | 1 | must stay a declared list with the `remote.rs` equality test |

## 12. What the mapping implies for the plan (not the plan)

Four seams, in order of how much they unlock:

1. **`src/host-client.ts` is the transport seam already** — `HostClient` takes
   a `Transport` (`:546-562`). A `WebSocketTransport` is a new implementation of
   an existing interface, not a second client. That is the cheapest path to one
   client instead of two, and it is what #189's build/embed/serve question makes
   possible or not.
2. **The pure modules are the shared surface.** ~470 duplicated lines already
   have a home. Whether they are *imported* or *spliced* is the build decision;
   either way the duplication itself has no reason to survive.
3. **The kit's generic six** (`Button`, `Chip`, `PosterCard`,
   `ContinueWatchingCard`, `ConfirmDialog`, `PendingSpinner`) are phone-ready
   with a scale token. `RowTrack` and `Popover` are not.
4. **The player splits four ways** (§9.2), and two of the four — the Episodes
   sheet and the transport-without-a-picture — are features the *window* lacks.
   A migration that only moves the page's code into the window would delete
   them.

## 13. Appendix: every render function

The per-function view of §2, for a plan that has to name what it touches.
"Counterpart" is the window component or hook that would draw it; "—" means the
window has no equivalent.

| Remote function | Lines | Count | Class | Counterpart |
|---|---:|---:|---|---|
| `showPairing` | 3172-3176 | 5 | transport | — |
| `showApp` | 3177-3182 | 6 | platform | `RepertoryEntry` |
| `renderConnection` | 3183-3189 | 7 | transport | — |
| `renderError` | 3190-3199 | 10 | client state | `Shell`'s alert stack |
| `renderNav` | 3200-3211 | 12 | platform | `RepertoryNav` |
| `renderScreen` | 3348-3359 | 12 | platform | `RepertoryScreens` |
| `renderDestination` | 3360-3373 | 14 | platform | `RepertoryScreens` |
| `renderHome` | 3374-3487 | 114 | platform | `RepertoryHome` |
| `renderPoster` | 3488-3504 | 17 | platform | `PosterCard` |
| `renderTmdbPoster` | 3505-3524 | 20 | platform | `PosterCard` + `unplayable` |
| `renderDiscover` | 3525-3588 | 64 | platform | `RepertoryDiscover` |
| `renderSearch` | 3589-3667 | 79 | platform | `RepertorySearch` |
| `renderLibrary` | 3668-3681 | 14 | platform | `RepertoryLibrary` |
| `renderStremioForm` | 3682-3705 | 24 | platform | `StremioAccount` |
| `renderAddons` | 3706-3776 | 71 | platform | `RepertoryAddons` |
| `renderSettings` | 3777-3797 | 21 | platform | `RepertorySettingsScreen` |
| `renderLevel` | 3798-3818 | 21 | platform | `ShellFrame`'s levels |
| `levelFrame` | 3819-3830 | 12 | platform | `RepertoryLog`'s head |
| `renderLevelMarkup` | 3831-3840 | 10 | platform | the level registry |
| `renderTitleLevel` | 3841-3944 | 104 | platform | `RepertoryTitle` |
| `renderStreamsLevel` | 3945-4003 | 59 | platform | `RepertoryStreams` |
| `renderSettingsLevel` | 4004-4013 | 10 | platform | `RepertorySettings`'s `SettingsLevel` |
| `settingsSection` | 4014-4017 | 4 | platform | `LogGroup` |
| `renderCredentials` | 4018-4053 | 36 | platform | `CredentialsScreen` |
| `renderPreferences` | 4054-4161 | 108 | platform | `PreferencesScreen` |
| `renderRemoteDevices` | 4162-4187 | 26 | platform | `RemoteDevicesScreen` |
| `renderAbout` | 4188-4202 | 15 | platform | `AboutScreen` (which also prints the version) |
| `renderConfirmLevel` | 4203-4220 | 18 | platform | `ConfirmDialog` |
| `nowTitle` | 4221-4233 | 13 | pure | — (the OSD names the Stream, not the Title: `osd.streamTitle`) |
| `renderMini` | 4234-4273 | 40 | platform | — |
| `renderCast` | 4274-4285 | 12 | platform | `PlayerOverlay` (differently) |
| `renderCastMenus` | 4286-4313 | 28 | platform | the OSD's icon strip |
| `renderCastBody` | 4314-4422 | 109 | platform | `PlayerOverlay` |
| `updateCastLive` | 4423-4490 | 68 | pure + client state | `Timeline` + `usePlaybackPosition` |
| `renderSeekPreview` | 4588-4613 | 26 | pure + client state | `usePreview` + `Timeline`'s preview |
| `renderSheet` | 4614-4619 | 6 | platform | `osdPopoverLevel` |
| `sheetTitle` | 4620-4629 | 10 | pure | `PlayerPopovers.HEADINGS` |
| `renderSheetBody` | 4630-4661 | 32 | platform | `OsdPopover` |
| `updateSheetStatistics` | 4662-4671 | 10 | pure | `statisticsLines` in place |
| `renderSheetMenu` | 4672-4692 | 21 | platform | `PlayerPopovers.MENUS` |
| `renderAudioSubtitlesSheet` | 4693-4746 | 54 | platform | the Subtitles and Audio popovers, combined |
| `renderSpeedBody` | 4747-4756 | 10 | platform | `SpeedMenu` |
| `renderChaptersBody` | 4757-4775 | 19 | platform | `ChaptersMenu` |
| `renderPictureBody` | 4776-4810 | 35 | platform | `PictureMenu` |
| `renderEpisodesSheet` | 4811-4858 | 48 | platform | — |
| `renderTrack` | 4859-4873 | 15 | platform | the track rows in the Audio/Subtitles popovers |

`captureView`, `restoreView`, `captureDrafts`, `restoreDrafts`,
`applyFocusTarget`, `paint` and `refresh` are not renderers in this sense: they
are the reconciliation the window does not need (§5).

## 14. Sources

### This repository

- `crates/host-wire/remote/index.html` — the whole page. Cited by section:
  CSS `:8-1784`, markup `:1787-1865`, capability list `:1807`, model
  `:1958-2547`, focus `:2548-2730`, `net` `:2731-2877`, `state` `:2884-2938`,
  projection `:2959-2987`, motion `:2988-3108`, signatures `:3211-3346`,
  screens `:3347-3796`, levels `:3797-4219`, strip `:4220-4272`, cast
  `:4273-4459`, preview `:4460-4608`, drawer `:4609-4869`, capture `:4870-4929`,
  history `:4930-4989`, paint/refresh `:4990-5067`, loaders `:5068-5440`,
  episodes `:5441-5626`, `act()` `:5681-6043`, events `:6044-6195`, pairing
  `:6196-6300`, connection `:6301-6432`.
- `crates/host-wire/src/remote.rs` — the splices (`:44-109`), the capability
  test (`:345-359`), keyboard intents (`:918-936`), the shared lists
  (`:361-559`), tokens and icons (`:560-638`), the Motion asset (`:640-688`),
  the one drawer (`:690-751`), the seek bar (`:850-869`) and preview
  (`:871-898`).
- `crates/host-wire/tests/wire.rs` — the socket suite; `crates/host-core/src/wire.rs`
  — the codec; `crates/host-core/tests/action_surface.rs` — the Snapshot's wire
  shape (`:433-484`) and the credential walk (`:486-545`).
- `src/host-client.ts` — the `Snapshot` type (`:14-77`), `HOST_ERROR_KINDS`
  (`:174-236`), `explain` (`:372-505`), the `Transport` seam (`:546-562`),
  `HostClient` (`:565-586`).
- `src/playback.ts`, `src/title.ts`, `src/stream.ts`, `src/browse.ts`,
  `src/discover.ts`, `src/library.ts`, `src/languages.ts`, `src/controls.ts` —
  the pure decision modules the page mirrors.
- `src/shell/osd.ts`, `src/shell/home.ts`, `src/shell/homeStore.ts`,
  `src/shell/addons.ts`, `src/shell/navigation.ts`, `src/shell/actionKey.ts`,
  `src/shell/inFlight.ts`, `src/shell/search.ts`, `src/shell/streamChoice.ts`,
  `src/shell/reveal.ts`, `src/focus.ts`, `src/input.ts` — the shell's decisions.
- `src/shell/repertory/` — the screens (`RepertoryHome` 531, `RepertoryDiscover`
  322, `RepertorySearch` 483, `RepertoryLibrary` 203, `RepertoryAddons` 322,
  `RepertorySettings` 797, `RepertoryTitle` 283, `RepertoryStreams` 268), the
  pure helpers (`program.ts`, `editorial.ts`, `homeProgramme.ts`,
  `titlePage.ts`, `streamsList.ts`, `settingsRegister.ts`, `accountLibrary.ts`,
  `frame.ts`, `motion.ts`), the kit (`kit/*`, 1,395 lines with suites) and
  `remotePage.test.ts` (575).
- `src/shell/PlayerOverlay.tsx` (1,088) and `src/shell/PlayerPopovers.tsx`
  (476) — the OSD, its ladder and its five popovers.
- `src/shell/Shell.tsx` (314) — the `playerActive` gate on
  `picture === "in_window"` at `:191-243`; `src/shell/ShellFrame.tsx` (382).
- `src/shell/repertory/screens.test.tsx` (936), `Home.test.tsx` (555),
  `journey.test.tsx` (235), `player.test.tsx` (378), `logbook.test.tsx` (921).
- `src/shell/repertory/tokens.css`, `src/shell/repertory/icons.tsx`,
  `crates/host-wire/remote/icons.svg`, `crates/host-wire/remote/motion-14.7.1.js`.

### Decisions

- ADR-0002 (one Action surface), ADR-0003 (mpv owns the swapchain), ADR-0005
  (clients browse independently), ADR-0008 (thin shell, one surface), ADR-0009
  (the transport is outside `host-core`), ADR-0017 (pairing and the wire;
  §1 the codec, §2 one page, §7 reconnect, §9 minimal by design), ADR-0018 (the
  Remote is the window's equal; §1 one document, §2 the capability list, §3 the
  bar over browsing, §5 settings), ADR-0020 (Discover and the unplayable mark),
  ADR-0021 (`previous_episode`), ADR-0024 (subtitle appearance), ADR-0026
  (stream buffer), ADR-0027 (a control that waits says so), ADR-0028 (the seek
  preview), ADR-0029 (the account Library), ADR-0030 (repertory supersedes
  Velvet; §3 one sheet, two scales), ADR-0031 (Motion for both clients; §4 the
  24 s feature beat), ADR-0032 (tests assert decisions; §5 the Remote's suite),
  ADR-0034 (the system Back sentinel).
- `CONTEXT.md` — Level, Pending, Picture, Telling, Cast Remote, Snapshot,
  Action, Watch progress, Continue watching, Library.
- `docs/agents/testing.md` — the gate a screen must clear, and the served
  Remote's place in it.
- `docs/design-system.md` — §3 the two scales, §5 the focus mark, §6 the motion
  presets, §11 the Remote and its hand scale.

### Method

Line numbers were read from the committed tree at `9de2432` (the merge of #186),
on 2026-10-31. Counts are `grep -c` and `wc -l` over the files named above;
"functions" is a match on `^\s*(async )?function name(` in the page. The
`explain` comparison is a set difference between `HOST_ERROR_KINDS` and the two
`switch` bodies. No test was run for this note; it reads the tree only.
