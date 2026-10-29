# Repertory Remote: the phone frame, the docked strip, and the drawer

**Ticket:** #149 (wayfinder map #143). **Branch:**
`prototype/149-repertory-remote`, over the frame and Home from #145, the
Title/Streams/Discover/Search language from #146, the utility grammar from #147,
and the Player OSD from #148. **Run:** 2026-10-29.

This is the prototype's record, not an ADR and not a resolution. It answers the
shape question the ticket asks, states what the phone frame is, and lists what
#150 (the design system) and #152 (the staging/cutover) still have to decide.
The owner's reaction is what closes #149.

## The answer to the question

**The three-surface shape still earns its place, but only after it is read
correctly: it is two surfaces and a drawer, not three screens.**

- The **browse surface** is the page: the destinations, the feature, Continue
  watching and the catalog rows. Its bottom index is the programme's table of
  contents.
- The **docked cast strip** is not a third surface. It is the expanded Remote's
  *collapsed state*, sitting above the index, sharing the page's ink and
  hairlines, and carrying the two immediate actions (back ten seconds and
  play/pause). Tapping its centre opens the Remote.
- The **expanded Remote** is the programme card: a full-bleed still, the
  Title/episode, the timeline and transport directly below the title, the
  always-visible volume box, and one row of five menus. It is a deliberate
  expansion, not a takeover that loses the browse surface underneath.
- **One shared drawer** over that card serves Audio & Subtitles, Episodes,
  Speed, Chapters and Picture, with the same head and Done/Back rule. It is not
  a fourth page. Volume is not a menu: it is the always-visible box between the
  transport and the menu row, and its mute control is an icon.

The simpler frame — one long remote page with Audio & Subtitles folded inline —
was rejected for two reasons. First, the transport must stay within a thumb's
reach while the television plays; an inline track list pushes the timeline and
transport down exactly when a person is adjusting subtitles. Second, the
browse surface must survive the expansion (ADR-0018 §3): the phone never loses
the screen it was browsing, and collapsing returns to the docked strip at the
same place. A one-page remote either duplicates the transport or makes the
browse a second route, and a second route is the shape ADR-0018 rejected.

What is provisional about this answer: it is a reading from the phone-width
drawing, not a measured walkthrough on a real handset. If the owner finds the
expanded card too tall, the first thing to move is the full-bleed still (the
card can keep a 2:3 thumbnail beside the title instead); the strip, transport
and sheet depths are the parts that should not move.

## The phone frame

### Surface 1: the programme, with the strip docked

- **The head is a printed line, not a bar.** The wordmark is Bodoni Moda; the
  connection is a mono mark with a brass square. There is no glass and no blur.
- **A destination is one brass mono line and its rule.** Home, Discover, Search,
  Library, Addons and Settings keep their names; the large screen heading and
  the explanatory lede of the Velvet surface are gone. The feature is the first
  picture, as on the window's Home.
- **The feature is full-bleed** between two hairlines, with a scrim and the
  Title in Bodoni. Its dots are two-pixel rules, not round beads.
- **Rows are printed programmes.** Posters are unframed, the title is the only
  running text, the year is a small hairline stamp beside it, and the
  description is not drawn on the card. Continue watching is a 16:9 still with
  a two-pixel brass progress line and a mono note.
- **The bottom index is the six destinations.** Mono labels, a 2px brass keyline
  on the active item, no pill and no fill.
- **Touch first.** Every control is at least 44px, the page uses
  `env(safe-area-inset-*)`, and hover is never the only affordance. Focus is the
  2px ivory keyline; press is an ink lift; `aria-pressed` is the state.
- **The strip is docked, not floating.** It is a full-width band above the index
  with a still, the Title/episode (Bodoni + mono), a progress hairline, back ten
  seconds, and play/pause. It reserves its height in the screen so the last row
  is never covered. It is the same strip at every destination.

### Surface 2: the expanded programme card

- **The head is sticky**: collapse at the left, the live mark at the right. The
  Title lives on the plate, not in the head.
- **The plate is the wide backdrop**, full-bleed between hairlines, with a
  scrim and the Title/episode over it. The default surface's poster card is
  hidden on this surface; the plate uses the Continue watching entry's
  backdrop, which is already in the Snapshot.
- **The timeline sits directly below the title.** It is a two-pixel hairline,
  a brass played fill, a muted read-ahead, an ivory square thumb, mono clocks,
  and the existing seek-preview plate (still, time, chapter) while a range is
  dragged. The preview is the same #140/ADR-0028 flow; nothing about the ask
  changed.
- **The transport sits directly below the timeline**: six hairline cells —
  previous episode, back ten seconds, play/pause (the one brass cell), forward
  ten seconds, next episode, Stop. The glyphs carry text-presentation marks so a
  phone does not turn them into emoji.
- **The five menus are one five-cell hairline row**: Audio, Episodes, Speed,
  Chapters, Picture. The row is joined, not split by the timeline: its top and
  bottom rules are one table, and each cell carries a brass mark and a short
  mono label. Audio's accessible name is still “Audio & Subtitles”.
- **The five menus open the same drawer** — Audio & Subtitles, Episodes, Speed,
  Chapters, Picture — with the same ink panel, brass top rule, sticky head
  (the menu's name, Done) and Done/Back rule. The old inline Speed/Chapters/
  Picture insets and the pushed Episodes level are not drawn on this surface;
  their controls live in the shared drawer. The default page keeps its own
  inline insets and Episodes level until the cutover.
- **Volume is not a menu.** It is the one always-visible box, between the
  transport and the five-cell row: a hairline box with the label/readout, the
  fader and the mute control. There is no Volume button and no popover; the mute
  control is a speaker icon (the sound-wave icon when on, the crossed speaker
  when muted), not the words Mute/Unmute.
- **The wait is still the page's one pill** (`Waiting for the Host…` after
  150ms); the pressed node is `aria-disabled` and `aria-busy` (ADR-0027). The
  opening/ended/refusal lines are printed notes at the foot.

### Surface 3: the shared playback drawer

One bottom drawer over the programme card serves Audio & Subtitles, Episodes,
Speed, Chapters and Picture. It is an ink panel with a brass top rule, a sticky
head whose title names the menu, Done, and the menu's own rows: hairline track
rows with the pressed row carrying a brass inset rule and the delay/size
steppers; the episode season chips and stills; the speed chips; the chapter
steps and ticks; the aspect/crop chips and statistics. Done and Back close it;
the drawer returns focus to the menu button that opened it. It is a drawer, not
a route and not a second page. Volume is not a menu; it is the always-visible
box outside it.

### The pushed levels

Title, Streams, Settings and the confirmation dialogs are re-dressed with the
same grammar, because they are part of the same client: hairline heads with a
mono Back, display-serif names, facts in mono, episode and Stream rows as
hairline lists, forms with bottom rules, the pairing call board, and red only on
status and the confirming side. The level stack, the Actions and the Back order
are untouched. On the default page, Episodes is still a pushed level; on the
repertory surface it is one of the shared drawer's menus.

## What survives, what is redrawn, what is cut

**Survives, deliberately:**

- Every control and every Action, the six destinations, the level stack, the
  browse/card/drawer shape, and the Back order (drawer → level → cast →
  destination).
- Pairing: the single-use code, the device token, the paired-device ledger and
  revoke-with-confirmation. The pairing page is re-dressed, not re-flowed.
- The Snapshot, the one `runAction`/`runWaiting` path, the waiting pill, the
  `aria-disabled` rule, the in-flight join and the relative-action exception.
- The shared lists: subtitle languages, appearance presets, Stream-buffer
  presets and the TMDB mark are still spliced; no second list.
- The seek preview: one ask in flight, the newest bucket wins, an absent still
  is the time and chapter alone.
- Keyboard/remote keydown; the page still has no gamepad column, because the
  LAN HTTP origin is not a secure context (research #49).
- The docked strip's data, the title/episode resolution, and the direct
  play/pause and seek Actions.

**Redrawn:**

- The canvas, the type scale for a hand, the head, the rows, the feature, the
  index, the strip, the card, the sheet, the levels, the pairing page.
- Focus: the 2px ivory keyline with a 3px offset; no lift/transform; hover is a
  quiet enhancement, never the only cue.
- The docked strip is a band, not a floating glass card. The expanded card's art
  is the backdrop, not a centred poster.
- The waiting pill and the error banner are printed lines above the strip, not
  floating pills.
- The transport and the five menus are hairline tables instead of rounded
  buttons; the five menus form one row below the transport.
- The drawer is the one pattern for the five menus; Volume is an always-visible
  hairline box, not a button, a popover or an inline row.
- The OSD's language is carried over: mono bookkeeping, display-serif names,
  brass marks, hairlines, no glass.

**Cut visually (no control, Action or flow step):**

- The glass, the blur, the radial page gradients, the rounded cards/pills/
  controls, the poster card frames, the floating mini strip, the empty header
  cell, and the round hero dots.
- The full-screen cast's poster thumbnail on the repertory surface; the plate is
  the wide still. The default surface still draws the poster.
- The repertory surface's inline Speed/Chapters/Picture insets and its pushed
  Episodes level: those controls now live in the shared drawer. The default
  page at `/` keeps its inline insets and its Episodes level until the cutover.
- The split utilities/extras rows and the Volume toggle on the repertory
  surface; five menu buttons are one row and Volume is always visible.
- The emoji presentation of transport glyphs (text-presentation marks only).
- No visible control is hidden behind a menu that was not already behind one.

## Tokens: the bridge, and what it does not solve

The ticket asked not to create a silent second source. The bridge is:

- **`src/shell/repertory/tokens.css`** is now the one declaration of the
  palette, the family stacks, the ten-foot scale, the spacing, the motion and
  the focus values. `repertory.css` imports it; the window gets it through the
  same import chain.
- **`crates/host-wire/src/remote.rs` splices the same file** into the served
  page through `/*__SPLICE_REPERTORY_TOKENS__*/`, alongside the Velvet
  `src/tokens.css` that the default page still reads. The old page sets no
  `data-ui="repertory"`, so the repertory sheet is inert for it.
- **`palette.ts` is deleted.** `tokens.test.ts` now reads the hex values out of
  `tokens.css` with `readToken` and measures the same pairs. There is no second
  palette to drift.
- **The phone scale is in the sheet too** (`--rep-remote-*`): the ten-foot
  values are for a room, and a phone held at arm's length needs another set from
  the same families. Whether #150 promotes this to a first-class part of the
  system, or the Remote keeps its own scale, is a #150 decision. The values are
  a prototype reading, not a locked scale.
- **Fonts are the one part not carried across.** The served page names Bodoni
  Moda / Inter / IBM Plex Mono with the same fallback stack, but it ships no
  `@font-face` files: a phone that does not have them falls back to Didot/Georgia,
  the system grotesk and the system mono. The window's Fontsource CSS is a Vite
  import and cannot travel in a no-build document. Packaging the faces (lean
  Latin subsets, OFL notices, and the Host's route or inline bytes) belongs to
  #150/#153, and the record here marks it as the gap a phone will see.

## Staging: `?ui=repertory` is provisional, on purpose

The page at `/` is still the old Cast Remote with the old palette. Adding
`?ui=repertory` sets `data-ui="repertory"` on `<html>` before the body paints;
that one attribute selects both the shared repertory tokens and the page's
repertory stylesheet. The script, the WebSocket, the capability list and the
Actions are the same page and the same client.

Why a query rather than a route or a Host setting:

- It is additive. The old page is one query-string away and is served by the
  same binary; a paired phone that keeps an old page open is not cut off by the
  staged one.
- It needs no Host setting, no second template, no build step and no second
  client. It is the smallest thing that lets the owner open a phone browser and
  compare.
- Rollback is deleting the query. There is no state to migrate.

**This is an assumption, not the staging decision.** #152 decides whether the
final route is `/next`, a Host setting, a build-time env, a second template, or
a cutover with the window. The query is intentionally not named in the Host's
address or the pairing flow; it is a developer/owner comparison tool. When #152
cuts over, the two palettes and the `?ui` gate should leave with the old
surface; the repertory token splice stays.

## Explicit for #150 (the design system)

- The Remote's phone scale (`--rep-remote-*`): body, display, caption, mono,
  touch, index, strip, gutter. It is currently a prototype reading beside the
  ten-foot scale.
- Touch targets: 44px for controls, 40px for chips, the one-line/one-cell
  rhythm of the transport and the five-menu row.
- The docked strip as a component: still, title/episode, progress hairline,
  two immediate actions, expand affordance, and how it reserves height.
- The shared drawer as a depth of the remote: brass top rule, sticky head,
  menu title, Done, track/episode/speed/chapter/picture rows, and the focus
  return. One drawer, five menus.
- The five-menu row: the labels, the glyph set, the five-cell rhythm, and the
  always-visible Volume box (label/readout, fader, mute icon) between the
  transport and the row.
- The focus treatment on touch: 2px ivory keyline, 3px offset, no lift; how it
  reads on ink, on artwork and on the pressed cell.
- The icon system: the transport and utility marks are still Unicode with text
  presentation; the window's OSD has hand-drawn marks. #150 should decide
  whether the Remote gets the same drawn set.
- Font packaging for the served document (lean Latin faces + OFL notices), and
  whether a phone without them is acceptable as a fallback.
- Whether the phone scale and the ten-foot scale are two named scales in one
  sheet, or two sheets with one source per client.
- The artwork fallback when a Continue watching entry has no backdrop, and the
  caption/year stamp rules on the phone's narrower cards.

## Explicit for #152 (the staging and cutover)

- The selector is `?ui=repertory`; the old page at `/` is untouched; rollback is
  removing the query. This is the bridge only.
- The two palettes coexist in one served document while the old surface lives.
  The final cutover should remove the Velvet `src/tokens.css` splice and the
  `data-ui` gate, or keep the gate only if a Host setting wants both.
- A paired phone may keep the old page open across a Host restart; the old page
  is still served at `/` until the cutover, so it reconnects to the same socket.
  After the cutover, the browser page is whatever `/` serves; the token lives in
  localStorage, so a reload pairs the same device.
- The final route/setting must be chosen with the window's `VITE_UI=repertory`
  cutover in mind (map #143): the Remote and the window should not be speaking
  two design languages after the flag is removed.
- The `?ui` gate is not a product feature and should not be documented to a
  person pairing a phone; it is a comparison tool for this prototype.

## What is not real in this check

- The served page was built and parsed, and its Rust guard runs. The container
  has no display and no phone, so the visual check of the actual phone frame is
  the owner's. No screenshot is committed.
- No artwork, credential, clip or pairing sample is committed. The visual
  harness used public Metahub images and a throwaway Snapshot outside the tree.
- The real flow — pair a phone, see the Snapshot, open a Title, choose a Stream,
  control it, open the drawer — is the Host's flow, unchanged. The prototype
  moves the drawing, not the Actions.

## Provisional list

- The expandable card's height and whether the full-bleed plate is worth the
  scroll at 390×844; a 2:3 thumbnail beside the title is the fallback.
- The exact phone scale values, the 44px touch target, and the index label
  size at 320px.
- The docked strip's height and whether the still or the title should lead when
  the artwork is missing.
- The five-menu row's labels at 320px; “Audio” is the short visible label for
  “Audio & Subtitles”, and the row may need to wrap to two rows if the phone is
  narrower than the dev target.
- The shared drawer's max height (88dvh), its sticky head, and whether each
  menu wants a different height; the Episodes season rail and its scroll.
- The always-visible volume box: its height, its readout, the fader, and the
  speaker/crossed-speaker icon set; whether it should collapse to a single
  line on a very short phone.
- The transport's glyph set (text presentation now; a drawn set is #150).
- The typefaces on the served page (fallbacks today; packaging is #150/#153).
- The pairing page's call-board treatment and the pushed levels' exact
  hairlines; the owner may want the levels closer to the default page's cards.
- The query selector and the two-palette coexistence (the staging decision is
  #152).

## Verification

Inside the dev container:

- `cargo test -p host-wire` — 26 unit tests and 11 socket tests, including the
  capability list, the shared lists, the repertory token splice, the
  `?ui=repertory` guard and the shared-drawer/five-menu guard.
- `cargo test --workspace --no-fail-fast`
- `cargo clippy --all-targets -- -D warnings`
- `cargo fmt --check`
- `pnpm typecheck`, `pnpm test` (611 tests), `pnpm build`, and
  `VITE_UI=repertory pnpm build`.
- A CSS parse of the served page (zero errors; every `var(--…)` is declared) and
  a JavaScript parse of every inline script.

The visual check on a phone or DevTools is the owner's; the Windows
`verify.ps1` walkthrough is not redesigned by this ticket.
