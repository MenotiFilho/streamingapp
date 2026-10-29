# Repertory Addons, Settings, Library, and pairing

**Ticket:** #147 (wayfinder map #143). **Branch:**
`prototype/147-repertory-addons-settings-library-pairing`, over the frame and
Home from #145 and the Title/Streams/Discover/Search work from #146. **Run:**
2026-10-29.

This is the prototype's record, not an ADR: the frame, the Home anatomy, the
type pairing and the browse-screen anatomy are already decided on #145 and
#146. What follows is how the utility destinations wear that direction, the
patterns they share, and what is still open.

## The logbook

Addons, Settings and Library are the booth's register, not admin forms. They
keep the structure the browse screens settled:

- **One line at the top.** The destination name in brass on the left, then the
  hairline rule. There is no second heading and no paragraph explaining what
  the screen is. Home, Discover and Search already read that way; the utility
  screens follow them.
- **Sections are printed lines.** The utility screens label a section with one
  line of mono and its rule; the programme's numbered `RowHead` stays on Home,
  Discover and Streams. The Addons register carries two small column labels;
  Settings has no section title of its own, only its four destination rows and
  the mono labels inside each sub-screen.
- **Hairlines, not cards.** Lists are hairline rows separated by a 2px step so
  the focus model can tell one row from the next. Forms are a mono label over
  an input whose only edge is a bottom rule. Buttons that change a list are
  lines of type with a rule under them.
- **Display serif for names, mono for facts.** An Addon, a category and a
  device are named in the display face; ids, versions, dates, pairing codes and
  refusals are mono or sans copy. Red remains status only: a refusal, an
  unplayable mark, the confirming side of a destructive question.
- **Chips are the choice.** Preferences are single-select chips in a hairline
  row; there is no dropdown and no second selected state.

## Addons: two columns on one page

The Addons screen is fitted to the page and split in two.

- **Left: Add an Addon.** The label is the Host's `Addon manifest URL`, the
  field is a hairline input, and the one strong action is **Add**. The manifest
  URL is never drawn back: it can carry the Addon's credentials, so the Host
  never publishes it (ADR-0009). A successful add says which Addon arrived; a
  refusal stays beside the field and keeps what was pasted.
- **Right: Configured Addons.** The Host's own order, one hairline row per
  Addon: the name in the display serif, the version in mono, and a **Details**
  mark. Focus opens the row in place; focus leaving closes it. The open row
  shows a compact 2x2 of the manifest's own facts — Id, Catalogs, Resources,
  Types — and the three controls that change the list: **Move up**, **Move
  down**, **Remove**.
- **Order is the Host's.** Move asks for the 0-based position the Action names,
  and is disabled at the ends. Remove pushes the same confirmation the Velvet
  surface uses: what leaves Home, what the Featured catalog loses, and that
  Watch progress already recorded stays. When the row disappears, focus steps
  to the Addon before it, or back to the form when there was none.
- **Height.** The page fits the window; the right column is the scroll, not the
  whole screen. The left column keeps its form and its preview note together at
  the top. A narrow window stacks the columns and lets the register scroll under
  the form.
- **Empty and refused.** An empty register says so and points back at the form.
  A refused add or reorder is a red line beside the control that asked, never
  the window's one alert.

The first build of this screen used a numbered section head for the form and
another for the list, a counted destination tag, row indices and a four-row
fact table. The owner's reaction was that it carried too much: too many
numbers, too many titles, and too much on screen. The two-column page, the
small column labels and the compact 2x2 facts are the correction.

## Settings: the short register

The base screen is one line of destinations: **Credentials**, **Preferences**,
**Remote devices**, **About/Credits**. There is no section title, count or
description above them. Choosing a row pushes a sub-screen over the list, so
Back returns to the exact row that opened it.

Every sub-screen starts with **Back** and the sub-screen's name in the display
serif, then its rule. There is no lede, no numbered section head and no mono
tag: each section is a small mono label over its controls.

- **Credentials.** A Protection ledger names the secret store (`OS keyring` or
  `Owner-only (0600) file`) and answers `Held` / `Not held` for TMDB and
  `Signed in` / `Not signed in` for Stremio. The TMDB key is a hairline form:
  save is the strong action, clear is destructive and asks first. The shared
  Stremio account form is reused unchanged; with an account held it offers
  sign-out through a confirmation.
- **Preferences.** Single-select chips under the labels `Subtitle language`,
  `Subtitle appearance` (with `Colour` and `Size`), `Stream buffer` (with
  `Look-ahead` and `Memory ceiling`) and `Featured catalog`. The buffer is two
  chip groups whose Actions carry the pair, so a quick second press composes
  from the first rather than reverting it (ADR-0026). A value a Remote set
  outside the presets is named by an **Other** chip rather than leaving every
  chip unpressed. The Featured catalog has **No featured catalog** first, and
  one line when no Addon offers a Catalog. There are no explanatory
  paragraphs: the label and the selected chip carry the state.
- **Remote devices.** The pairing panel is the call board: **Address** in mono,
  **Pairing code** in large brass mono, its label reading `Pairing code · single
  use`. Below it, the paired-device ledger: name in display serif, the paired
  stamp in mono, **Revoke** in the status red. Revoke asks first and leaves
  every other device working; after it, focus steps to the device before it, or
  to Back. An empty ledger is one line, not a panel.
- **About/Credits.** The TMDB mark and its required notice, the app version,
  and the GPL-3.0-or-later licence, each under its mono label.

A Settings leaf is a page in the programme, not a takeover: the level begins at
the compact spine and uses the stage's padding, so the spine stays visible. The
spine is also **live**: it sits outside the inert base, and the focus root of a
Settings leaf covers both the spine and the leaf, so Left reaches the programme
index and Right returns to the page. Focusing the spine opens it and the leaf
makes room; choosing a destination closes the leaf. Title, Streams, a
confirmation and the player still take the whole window, and the spine is inert
for them.

The mechanism is one inert-aware layout: the shell root is the focus root for
the repertory base and a Settings leaf, the level below the top and the base's
stage are inert, and the focus model skips inert controls. The base's stage is
inert while a leaf is open; the spine slot is not.

The behaviour belongs to the spine. On the comparison program-strip frame a
Settings leaf is still a full-window overlay; the strip is not left live,
because the winning frame is the spine.

The first Settings build used the programme's numbered `RowHead`s, a mono tag on
every leaf and explanatory paragraphs. The owner's reaction was that it carried
too many numbers, titles and words, and that a leaf should not take over the
screen. The current screen is one single-column register: mono section labels,
short facts, and a pairing panel that stacks the address over the code.

## Library: the gate and the honest stub

The Library is a room that says it is not furnished.

- With no account, a gate block says the Library will hold the Titles saved in
  a Stremio account and that it is not built yet, then draws the shared Stremio
  sign-in form. There is no sign-out on this screen; sign-out lives in Settings
  → Credentials.
- With an account held, the page is only the stub: signed in, the Titles will
  appear once the Library is built, and Account sync reconciles Watch progress,
  not membership. No controls, no list, no claim of a sync that is not built.
- Membership stays unbuilt (CONTEXT.md): this screen must not pretend
  otherwise, and it never borrows Continue watching's vocabulary.

## Utility patterns worth keeping

- **Form.** Mono label in caps, transparent field with a bottom hairline, one
  brass primary action, optional quiet actions as underlined mono. A refusal is
  a red hairline block directly under the form; a success is a two-rule
  `Logged` line. The pasted value stays when the Host refuses it.
- **List.** Hairline rows with a 2px gap, the name in the display serif, the
  bookkeeping at the trailing end in mono, and one trailing control where the
  row changes the Host. A row is the control when the whole row opens;
  otherwise the trailing action is. The utility screens carry no index numbers;
  the programme's numbered rows stay on Home, Discover and Streams.
- **Confirmation.** Every destructive control pushes one `ConfirmAction` level:
  a question, the consequence in the Host's own words, Cancel focused first,
  Back cancels, and a refusal stays inside the dialog. The confirming side is
  the only red fill.
- **Empty and error.** An empty register gets a short title and, where it helps,
  one line saying what to do next; a small empty list can be one line. A refusal
  is never the window's one alert when the screen can own it. `Waiting for the
  Host…` is its own quiet line.
- **Preview note.** A plain Vite window says what is a rehearsal in a mono line
  on the screen it belongs to. The Tauri window draws none.

## Preview data and what is not real

- **Addons are real.** The preview starts with Cinemeta and Torrentio and
  fetches a real manifest when one is added. The preview transport keeps the
  register in this window and publishes each change as a Snapshot; it uses the
  existing `add_addon`, `reorder_addon` and `remove_addon` Actions and invents
  none.
- **Preferences and credentials are local.** The preview answers the existing
  preference and credential Actions from its own Snapshot. A saved TMDB key is
  only a held/not-held flag; nothing is stored and no service is contacted.
- **Pairing is a sample.** The preview's address, code and two devices are
  samples, and the devices are named `(preview)`. The Tauri window reads the
  Host's own address, code and devices.
- **The Library sign-in is local.** Signing in in the plain Vite window flips
  the stub; no Stremio account is contacted.
- **The Tauri window is the real one.** It uses the real `HostClient`; the
  preview transport never runs there.

The pure preview seams — reading a manifest into the Host's `AddonManifest`,
moving a row to a 0-based position, removing one — are in
`src/shell/repertory/previewState.ts` and tested without a network.

## Still provisional

- The Addons columns' ratio and the fitted-height formula at 4K and on short
  desk windows; the current values are measured for the dev window.
- Whether the open Addon's 2x2 facts are still too much, or whether Id belongs
  in the register at all.
- Whether the mono section labels are enough for every Settings section, or a
  couple (Protection, Stream buffer) still need one short explanatory line.
- Whether the Settings base needs any description of a category, or the four
  names are enough.
- Whether every Settings leaf should share the frame root with the spine — the
  Discover no-key state's Credentials leaf does — or only leaves opened from the
  Settings destination.
- Whether the 760px content column (facts, forms, pairing panel, device ledger)
  is the right width at 4K; the current value is measured at 1920×1080.
- The pairing panel's size and position, the code's tracking, and whether a
  copy control for the address/code is worth adding. A copy control is not a
  Host Action; it would be a client convenience only.
- Whether Remote devices should remain a Settings leaf or become its own
  destination; the map leaves the Remote's surfaces open.
- The shared Stremio form is re-dressed from the shell's shared form classes.
  A cutover may give it a dedicated repertory primitive.
- The Library stub's final copy, and whether the signed-in state should point
  at Settings → Credentials.
- The OSD and the served Remote are untouched by this ticket.

## Verification

`pnpm typecheck`, `pnpm test`, `pnpm build`, a second build with
`VITE_UI=repertory`, `cargo test --workspace --no-fail-fast`, `cargo clippy
--all-targets -- -D warnings`, and `cargo fmt --check`, all inside the dev
container. A headless Chrome pass at 1920×1080 checked the Vite layout,
including the Settings leaf's clearance beside the spine and the Left/Right
crossing between the spine and the leaf (Left reached Home, Right returned to
Back); the Tauri window is verified by the owner, and `verify.ps1` is not
redesigned by this ticket.
