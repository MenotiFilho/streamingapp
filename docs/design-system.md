# The repertory design system

**Ticket:** #150 (wayfinder map #143). **Supersedes:** the Velvet Curtains
design record — spec #71 and its token ticket #77. **Decision:** ADR-0030;
**Motion:** ADR-0031.

This is the client's living visual record: the palette, the type, the scales,
the focus mark, the motion, the icons, the component anatomy, the artwork rules
and the copy voice. It is what a build ticket reads before drawing a screen. It
holds no behaviour: every Action, Snapshot, focus rule, level-stack rule and
Remote flow belongs to the Host and to `CONTEXT.md`, and this record does not
move them.

The values live in `src/shell/repertory/tokens.css`; #153 adds the motion
presets in `src/shell/repertory/motion.ts`. The window imports them and
`crates/host-wire` splices the token sheet into the served Remote page; the
Velvet sheet sits beside it until the cutover (#160). #153 rebuilds the sheet to
this record; where the prototype still differs today, the difference is listed
in §14 rather than left as a second rule.

## 1. The direction

A personal ten-foot cinema: an ink-black room, warm ivory ink, one house colour.
The interface is a **printed programme**, not a glass dashboard — hairlines
instead of cards, a display serif for names, a quiet grotesk for the interface,
mono for every piece of bookkeeping, and posters shown unframed as if pasted on
the wall.

What the direction refuses, everywhere: glass, blur, rounded cards and pills,
drop shadows as depth, focus lifts and scaling, fill inversion on focus, light
mode, and decoration that competes with the artwork. The picture and the poster
are the only loud things; the room around them is quiet.

## 2. Palette

| Token | Value | Role |
|---|---|---|
| `--rep-ink` | `#0b0a09` | the canvas and the room |
| `--rep-ink-raised` | `#141210` | a raised plate: popover, drawer, dialog, the OSD's ink |
| `--rep-ink-elevated` | `#1b1815` | the one step above raised: an open row, a pressed cell |
| `--rep-ivory` | `#f2e9d8` | primary ink: names, body, the focus keyline |
| `--rep-dim` | `#c8bda9` | secondary ink: captions, descriptions, labels |
| `--rep-muted` | `#8c8375` | tertiary ink: bookkeeping that must still pass 4.5:1 |
| `--rep-hairline` | `#6e6659` | rules, table edges, the unfocused control edge |
| `--rep-house` | `#c9a45c` | the house: brass marks, stamps, the active destination |
| `--rep-house-deep` | `#b08a45` | pressed and hover hairlines, the dimmer brass |
| `--rep-status-red` | `#ff4d4d` | status only: refusal, the unplayable mark, the confirming side |

Measured on ink (`#0b0a09`), WCAG 2.2: ivory 16.41, dim 10.65, muted 5.29,
hairline 3.49 (a non-text rule, 3:1), brass 8.43, brass-deep 6.19, red 6.05. On
`ink-raised` every text pair still clears 4.5:1 and the hairline still clears
3:1. `tokens.test.ts` measures pairs out of the sheet; today it guards ivory,
dim, muted, hairline and brass, and #153 extends it to brass-deep and the status
red, so a colour change fails until its pair is proven again.

Every brass wash or glow derives from `--rep-house` (`color-mix` or a channel
expression), never a repeated `rgba()` literal: the one allowed brass
correction has to move the washes with it. #153 makes the existing wash derive
from the token and adds the test that fails on a brass literal anywhere but
`--rep-house` and `--rep-house-deep`.

Rules:

- **Brass is a mark and text on ink, never a field behind ivory.** Ivory on brass
  is 1.95:1 and fails every threshold; ink on brass is 8.43:1 and is the only
  text a brass fill may carry. Red on `ink` text is 6.05:1; ivory on red is
  2.71:1, so a red fill carries ink or nothing.
- **Red is status**, never decoration: a refusal line, the unplayable mark, the
  confirming side of a destructive dialog. A red mark never means "selected".
- Brass marks the house's voice: the active destination, a stamp, a chapter
  tick, the progress fill, a section's top rule. It is never body copy and never
  a large fill.
- **Dark only.** There is no light mode, no theme switch and no per-surface
  palette. `color-scheme: dark` is part of the system.
- Artwork is the only uncontrolled colour on the page. Scrims bring a picture
  down to the room instead of raising the room to the picture.

## 3. Type

| Role | Family | Used for |
|---|---|---|
| Display | Bodoni Moda (variable) | the feature's name, a Title page's name, a section's name, an Addon/category/device name, a popover heading, the Remote's wordmark |
| Interface | Inter (variable) | poster and Continue captions, labels, body, controls, forms, empty-state copy |
| Bookkeeping | IBM Plex Mono | timecode, year, rating, quality stamp, version, ids, pairing code, stats, chapter callout, dates |

Display is set at weight 500 with `-0.012em` tracking and `1.08` leading; it is
never used below the section size, and never for a poster caption. Interface is
400 for body and 500 for labels, names and controls, with `0.008em` tracking and
`1.4` body leading. Mono is 400/500 with tabular figures everywhere a number can
tick. Caps labels take `0.08em` tracking.

The two-family comparison from research #144 is closed: **Bodoni Moda / Inter /
IBM Plex Mono**. The prototype's Playfair alternate (Playfair Display + IBM Plex
Sans) is **cut**, not deferred: it is not a setting and not a second pairing,
and the prototype's `data-pairing` token block, its `?type=playfair` rehearsal
option and the Playfair imports leave in #153.

### The scale

One stage unit drives every ten-foot size:

```css
--rep-stage: min(1vw, 1.7778vh);
```

At 1920×1080 the stage is 19.2px — exactly `1vw` — so the 1920 column is the
prototype's measured value. On a 16:9 window the two terms agree; on a short or
ultrawide window the **shorter side** governs, so a wide, shallow window does
not inflate the type. Each role is `max(<floor>, calc(var(--rep-stage) * <n>))`:
a rem floor keeps a desk window legible, and there is no rem ceiling (a rem
ceiling is the 4K-at-100% trap the research measured).

| Token | Floor | Stage × | At 1920 | Role |
|---|---:|---:|---:|---|
| `--rep-text-hero` | 72px | 4.6 | 88px | the feature's name |
| `--rep-text-title` | 48px | 3.0 | 58px | a Title page's name |
| `--rep-text-section` | 36px | 2.1 | 40px | a section or destination head |
| `--rep-text-body` | 28px | 1.667 | 32px | body and descriptions |
| `--rep-text-control` | 26px | 1.35 | 26px | buttons, labels, poster captions |
| `--rep-text-caption` | 24px | 1.25 | 24px | secondary captions |
| `--rep-text-mono` | 24px | 1.25 | 24px | bookkeeping |
| `--rep-text-badge` | 18px | 1.1 | 21px | stamps and badges |

The 1920 body of 32px and caption of 24px sit on the research's ten-foot floors
(28–29px body, 24px caption, 48px title). A long feature name steps down through
the prototype's two densities rather than wrapping to five lines; a long
description clamps on its card and is read on the Title page.

### Faces on disk

The window bundles lean Latin `woff2` faces (Bodoni Moda, Inter, IBM Plex Mono)
and their OFL notices; the served Remote receives the same files from the Host
and the same `@font-face` rules, so a phone without them is a fallback, not the
design. Fontsource's package CSS is prototype plumbing and is replaced by the
subset files at cutover. No page fetches a font from a third party.

## 4. Space, rules and radius

Spacing steps: 4, 8, 12, 16, 24, 36, 48, 64px (`--rep-space-1`…`8`). Spacing is
fixed in rem; **layout dimensions scale with the stage** and carry the 1080p
floor:

| Token | At 1920 | Rule |
|---|---:|---|
| page gutter | 56px | `max(32px, 2.9 × stage)` |
| stage top | 48px | `max(32px, 2.5 × stage)` |
| stage bottom | 96px | `max(64px, 5 × stage)` |
| row gap | 24px | `max(16px, 1.25 × stage)` |
| compact spine | 92px | `max(92px, 4.8 × stage)` |
| open spine | 280px | `max(280px, 14.6 × stage)` |
| program strip (strip frame) | 168px | `max(168px, 8.75 × stage)` |

**Radius is zero.** There is no card radius, no pill and no rounded control; the
one circle in the system is the pending spinner. Depth is a hairline and one ink
step, never a shadow. Rules are 1px; the step between two focusable rows is 2px
so the focus model can tell them apart; a brass rule is 2px (the featured or
active item, a drawer's top rule, a popover's top rule); a progress line is 2px.

**Measure is typographic**, not a pixel column: prose is 58–62ch, a utility
panel and a form 46ch, a poster caption 2 lines, the feature's description 3
lines and a Title page's description 6. The spine, the gutter and the stage
carry the scale; the reading column does not grow with the window. The
prototype still fixes the utility panels at 760px; #153 moves them to the
measure.

## 5. Focus

One mark, on every focusable thing — poster card, rail item, button, OSD icon,
form field, row:

- a **2px ivory keyline with a 3px offset**, outside a control; where the art
  fills the row (a poster or continue card), the same 3px offset is drawn
  **inside the artwork's edge** so a scrollport never crops it;
- a brass **spotlight wash** on the feature and on a focused poster's artwork —
  a radial soft edge, not a border. The system **narrows** the prototype here:
  the prototype washed every card and every rail item, and the locked mark is
  the keyline everywhere, the wash in those two places only;
- hover is one hairline and, at most, one ink step; it is never the only cue;
- pressed is `--rep-ink-elevated` and nothing else;
- selected (`aria-pressed="true"`, `aria-current="page"`, a chosen chip) is a
  2px brass inset rule on the leading edge plus ivory ink — no fill, no size
  change.

The keyline has to fit: a scrollport gets 3px of extra padding so a focused edge
is never clipped, and a rail's first and last card are inset by the same 3px.
The spine grows on focus (compact → open) and the page makes room; a Settings
leaf keeps the spine live, with the focus root covering both.

The prototype still carries three leftovers here: the feature at a 6px offset,
the poster cards keylined 3px outside rather than on the art, and the kit's
`kit-focus-invert` filling focused controls. The kit is #153's; the feature and
the cards are #154's; the record's mark is the one above.

## 6. Motion

**Two engines, one vocabulary.** Movement runs on **Motion** — `motion/react` in
the window, the vanilla `animate` served to the Remote. CSS keeps the effects
that are self-contained: a wash, a fill, a colour change, as a `transition` on
the token duration. Both read the same presets, so a rail and a drawer settle
with the same feel.

The presets will live in `src/shell/repertory/motion.ts` (#153). From #153 the
sheet carries the same durations as `--rep-motion-panel` and
`--rep-motion-quick` (today `--rep-dur-fast` / `--rep-dur-med`); the window reads
the presets from the module, the Remote's script reads the two durations from the
page's computed style, and #153's test asserts that the module and the sheet
agree. One set of numbers, two readers.

| Preset | Value | Used for |
|---|---|---|
| panel | spring, `visualDuration: 0.24`, `bounce: 0` | a pushed level, a drawer, a popover, the spine, a rail's scroll |
| quick | spring, `visualDuration: 0.14`, `bounce: 0` | a focus reveal inside a rail, small state changes |
| fade | tween, `0.14s`, `cubic-bezier(0.22, 1, 0.36, 1)` | opacity and colour, in CSS and in Motion |

No bounce anywhere: the springs are critically damped, so one that is
interrupted keeps its velocity and settles without overshoot. No entrance
stagger on a screen's content — a level arrives as one thing.

**What moves:**

- A destination switch **cross-fades the base** (240ms); it does not slide.
- A **pushed level** — a Title, Streams, a Settings leaf, a confirmation —
  enters 24px from the trailing edge with a fade, and leaves the same way; Back
  reverses it. The level stack, the focus restoration and the Actions are
  unchanged; focus is restored on the new level at the start of the transition,
  and the animation never gates input.
- A **popover or drawer** rises 12–16px with a fade (on the Remote, from the
  bottom edge); the scrim fades with it.
- A **rail** scrolls with `animate()` on its scroll offset, so a second press
  redirects it mid-flight; the focus reveal uses the same path. No snapping and
  no inertia.
- The **feature** cross-fades between slides on its 24s beat, replacing the
  earlier no-cross-fade rule; focus still holds it.
- The **spine's** width and its label reveal use the panel spring.
- The OSD appears and hides on its own clock (behaviour); its panels use the
  panel spring; the timeline and volume fills stay CSS.

**What does not move:** posters do not zoom, rows do not slide or stagger, cards
do not lift, the focus keyline does not animate its geometry (the wash may
fade), and no control scales under the pointer.

**Reduced motion.** The window puts one `<MotionConfig reducedMotion="user">` at
the root: transform and layout animations off, opacity and colour fades kept.
That config only reaches `motion` components, so the window's direct `animate()`
calls — the rail scroll and the focus reveal — check `useReducedMotion()` and
jump instead of animating. The Remote cannot use the React APIs, so its module
script reads `matchMedia("(prefers-reduced-motion: reduce)")` (and listens for
changes) and runs only the opacity/colour animations. Under the same media query
the CSS transform transitions are disabled and the width fills snap; only opacity
and colour still fade. The feature stops rotating. This **replaces** the earlier
0ms rule: with reduced motion the room keeps its fades and loses its movement.
The OSD's auto-hide clock, the focus rules and every Action are untouched.

**Tests** assert the final state, never a frame: transform and layout assertions
mount with `reducedMotion="always"`, opacity and colour assertions with a zero
transition. No test asserts a spring's intermediate values.

## 7. Icons

**One drawn set, shared by the window and the served Remote.** A 24×24 viewBox,
`currentColor`, `fill="none"` for chrome and a filled mark for transport,
round caps and joins; 1.7 stroke for the chrome and destination marks, 2–2.2
where a mark stands alone over the picture in the OSD. Marks are bare: no
circle, no square, no container, except a cell of the hairline table.

The set: the six destination marks, More, back, close, previous episode, next
episode, −10s, +10s, play, pause, stop, fullscreen, volume, volume muted,
picture, subtitles, audio, speed, chapters, and the chevron the popovers use.
The window's inline SVGs are the source for the destination, transport, close
and fullscreen marks; the ±10s and subtitles marks still draw as text in the
prototype and join the set in #153/#158. The served page receives the same
symbols as a sprite spliced at serve time, like the token sheet. **No Unicode
glyph stands in for a mark on the Remote** — the phone's emoji font is not the
design system; the prototype still uses Unicode there and #159 replaces it.

## 8. Component anatomy

### The frame

- **Spine**: the programme index, numbers in mono, names in sans, the active
  destination in brass with a 2px rule, the date and clock at the foot. Compact
  at rest, open on focus. Under 15 destinations it lists them and ends with
  **All destinations**; the grid always holds the whole programme.
- **Programme line**: every screen's head is one line — the destination's name
  in brass mono on the left, then a hairline to the right edge. No second
  heading, no explanatory paragraph above content.
- **Section head** (Home, Discover, Streams): a numbered line in mono, the rule,
  then the row. Utility screens use a plain mono label and its rule instead; the
  numbered head is the programme's, not the register's.
- **Page**: one screen, fitted where the content allows; the content column is
  the measure, not the window. A short window scrolls the page rather than
  clipping the copy.
- **Utility register** (Addons, Settings, Library): the same one line at the
  top, then hairline rows with a 2px step, names in display serif, bookkeeping
  in mono, and no index numbers. Addons is two columns — the form on the left,
  the Host's register on the right — and an open Addon row carries the
  manifest's own facts as a compact 2×2 (**Id**, Catalogs, Resources, Types)
  plus **Move up**, **Move down** and **Remove**. A narrow window stacks the
  columns and lets the register scroll under the form.

### Cards

- **Poster card**: unframed 2:3 artwork; the only running text is the Title in
  sans at control size (2 lines, dim; ivory when focused); the year is a small
  mono stamp after the name; the IMDb stamp sits over the art at the bottom
  right, only when the Host has a rating; an Unplayable Title keeps its stamp
  and still opens.
- **Continue watching card**: 16:9 still, a 2px brass progress line under the
  art and a mono note (remaining time or episode), then the Title in sans. An
  entry whose Addon was removed is marked unplayable and does not open.
- **Feature**: the backdrop between two hairlines, a two-gradient ink scrim, the
  Title in display serif over it, the kicker in mono (`Feature presentation` and
  the programme's position), one line of facts, the description, and one
  action — **Open the Title**. It rotates every 24s while unfocused; focus holds
  it; Left/Right step it; reduced motion stops it.
- **Episode row**: 16:9 still (or a typographic plate), `S#E#` and the name, a
  **Streams** mark. The season rail is single-select chips in one scrolling
  line; the episode list scrolls under it.

### Controls

- **Chip**: a hairline box, mono/sans label, single-select; chosen is the brass
  inset rule and ivory ink, never a fill. A value outside the presets is named
  by an **Other** chip rather than leaving every chip unpressed. Discover's
  genre row is **All genres** first, then TMDB's own genre order — one list,
  never a curated second one.
- **Button**: a line of type with a rule under it; the one primary action is a
  **brass fill carrying ink** (never ivory, 8.43:1), a quiet action is brass ink
  with a rule, and destructive is red ink and always asks first.
- **Form**: a mono caps label over a transparent field whose only edge is a
  bottom hairline; the focused field takes the ivory keyline. A refusal is a red
  line under the field and the pasted value stays.
- **List row**: a hairline row with a 2px step, the name in display serif, the
  bookkeeping in mono at the trailing end, and one trailing control where the
  row changes the Host. A row that opens is itself the control. No index
  numbers on utility screens.
- **Popover / drawer**: an `ink-raised` plate with a 2px brass top rule, a
  display-serif heading, mono group labels and hairline rows; the pressed row
  carries the brass inset rule. The OSD's popovers are `min(20.8 × stage,
  100vw - 2rem)` wide (400px at 1920) with `min(62vh, 26.7 × stage)` of height,
  anchored above the control strip, and clear the window's top by one spacing
  step at a short height. A scrim closes it; Back closes it before it closes the
  level beneath.
- **Dialog**: one question, the consequence in the Host's words, Cancel focused
  first; the confirming side is the only red fill.
- **OSD**: a programme note printed over the film, in translucent ink plates and
  hairlines. Top left: the brass `Now playing` kicker, the episode or `Feature`,
  the Title in display serif, a brass quality stamp, and the Addon/codec/bitrate
  facts in one mono line. Top right: fullscreen and Stop, each a square hairline
  control (Stop is the X). Right edge: the bare volume rail — a **drawn rail with
  a brass fill**, not the browser's native range. Bottom: the centred transport
  with the five icon menus around it (Picture, Subtitles, Audio left; Speed,
  Chapters right), then the timeline — a hairline track, a buffered read, the
  brass progress, an ivory playhead, brass chapter ticks, mono clocks at each
  end. The current chapter is named **only in the hover/drag callout**, which
  names the chapter of the position pointed at; the prototype prints it
  permanently at the centre, and #158 removes that line. Ticks keep a minimum
  spacing (~24px); a container with many chapters collapses to a tick rail
  without names.
- **Pairing call board**: **Address** in mono, **Pairing code** in large brass
  mono with the label `Pairing code · single use`, then the paired-device ledger
  (name in display serif, paired stamp in mono, **Revoke** in red). Revoke asks
  first and leaves every other device working. The code's tracking is the caps
  tracking; there is **no copy control** — the panel is a call board read from
  the screen, and a copy affordance would be a client-only convenience the map
  does not open.

## 9. Artwork and marks

The fallback chain, in order, and never a grey box:

| Surface | Chain |
|---|---|
| Feature | backdrop → landscape poster → typographic plate (name in display serif over ink) |
| Poster card, feed, Library | poster → typographic plate |
| Title page | backdrop → landscape poster → poster, with a two-gradient scrim; the wordmark/logo over it, else the name in display serif |
| Continue watching | 16:9 backdrop → landscape poster → 16:9 plate |
| Episode row | 16:9 still → plate with `S#E#` and the name |
| Remote plate | the Continue watching entry's backdrop → landscape poster → 2:3 poster beside the title → plate |

Art is never framed, never rounded, never cropped from 2:3 to 16:9 (a poster
fills a 2:3 slot or becomes the plate), and never replaced by a flat panel when a
backdrop is missing — the plate is typographic and intentional.

Marks, all stamped rather than spoken:

- **Year**: a small mono stamp beside the name.
- **IMDb**: over the poster's art, bottom right, only when the Host carries a
  rating; never a second row of facts.
- **Unmapped**: the brass stamp on the Title page — *Unmapped — no TMDB record
  met this Title, so it is keyed by its Addon* — a mark, not an error.
- **Unplayable**: a status-red outlined stamp on a card or candidate; it still
  opens and the Streams list still shows what exists.
- **Quality / source**: the Addon's own badge lines verbatim, first line as the
  source, the rest as marks; never re-worded, re-ranked or hidden.
- **Waiting**: a quiet mono line (`Waiting for the Host…` after 150ms), never a
  spinner on a control that can still be read.

## 10. Copy voice

Two vocabularies, and they do not mix:

- **Host words stay on functional controls**: Streams, Addons, Library, Catalog,
  Continue watching, Settings, Pairing code, Watch progress. A control never
  renames a Host concept into cinema language.
- **The cinema voice lives in the programme**: Home's section heads and kicker,
  the destination heads, empty states, waits and descriptive lines.

The voice is plain, present tense, and short: *Tonight's feature*; *Nothing is
screening tonight.*; *Add an Addon to open the programme.*; *The room is empty
until an Addon is configured.* No exclamation marks, no faux-projectionist
whimsy, no adjective stacking, and no second sentence that repeats the first.
A section head is a name, not a sentence.

Errors are the exception to the voice: they quote the Host's own vocabulary and
the Action's refusal verbatim (`no_previous_episode`, `invalid_position`,
`unknown_addon`) and add at most one line saying what the person can do. A
client-side transport failure is named in the client's own words (`unreachable`)
and is never dressed as a Host refusal. An error is never dressed in cinema
language and never softened into an empty state. Destructive dialogs state the
consequence in the Host's own words.

## 11. The Remote

The Remote is the same cinema, held in a hand: the same palette, families,
icons and marks, with its own **hand scale**.

| Token | Value | Role |
|---|---:|---|
| `--rep-remote-text-hero` | 2.25rem | the plate's Title |
| `--rep-remote-text-title` | 1.75rem | a pushed level's name |
| `--rep-remote-text-section` | 1.25rem | a section head |
| `--rep-remote-text-body` | 0.95rem | body and descriptions |
| `--rep-remote-text-caption` | 0.8125rem | captions |
| `--rep-remote-text-control` | 0.9375rem | controls and labels |
| `--rep-remote-text-mono` | 0.75rem | bookkeeping |
| `--rep-remote-text-badge` | 0.6875rem | stamps |
| `--rep-remote-touch` | 2.75rem | the minimum target (44px) |
| `--rep-remote-nav` | 4.25rem | the bottom index |
| `--rep-remote-strip` | 4.5rem | the docked strip |
| `--rep-remote-gutter` | 1.125rem | the page gutter |

Ink, ivory, brass, hairlines and the same display/interface/mono roles. Touch
first: 44px targets (40px chips), safe-area insets, never hover as the only cue;
keyboard focus keeps the ivory keyline for a Remote driven by a keyboard, and a
finger gets the pressed ink step. The bottom index is the six destinations with
a 2px brass keyline on the active one. The docked strip is a full-width band
above the index (still, Title/episode, progress hairline, −10s, play/pause) and
reserves its height. The expanded card is the programme card: the backdrop
between hairlines, the Title, the timeline, the six-cell transport, the
always-visible volume box, and the five-menu row (Audio, Episodes, Speed,
Chapters, Picture) opening one shared drawer. **Remote devices is a Settings
leaf**, not a seventh destination.

The hand scale is locked as measured; one tuning pass on a real handset is
allowed in the Remote's build ticket (#159), and it changes values, not roles.

## 12. What is provisional, and where it is judged

The system is locked. Five things are allowed to move, each once, each with the
measurement written back here:

- **The brass** — `#c9a45c` is locked, but if the Windows panel reads it as
  orange rather than gold, one correction is allowed and `tokens.test.ts` is
  re-measured. Judged in the owner's Windows walkthrough.
- **The hand scale** — the values above, tuned once on a real handset in #159.
- **The spring durations** — `visualDuration` 0.24/0.14 may be tuned once in
  #153 against the real panel; the vocabulary, the bounce and the shapes do not
  change.
- **The opacities over a picture** — the OSD scrims, the badge fill, the popover
  plate and the preview plate are judged over a bright film on the panel, and
  only their alpha values may move.
- **Crops on unusual aspect ratios** — the feature's backdrop crop at 21:9 and
  4:3, and the popover's clearance at a short window height. Judged in the
  window, then written here.

The prototype's scaffolding is not provisional design: the rehearsal bar, the
sample tracks and statistics, the ticking clock, the sample pairing devices, the
practice Library account and the `?ui=repertory` selector were introduced across
#145–#149 and are #152/#160 machinery; they leave with the flag.

## 13. What this record does not decide

- **Behaviour**: Actions, Snapshots, the focus model, the level stack, the Back
  order, auto-hide and the Remote flow. Frozen by the map and owned by
  `CONTEXT.md` and the ADRs.
- **The staging**: the served page's route or setting is #152; the window's
  `VITE_UI=repertory` flag and both cutovers are #160.
- **The tests**: which presentation suites survive is #151.
- **The motion layer's code**: the `motion` dependency and its presets land in
  #153, and the Remote's vendored bundle in #159 (ADR-0031).
- **The Windows walkthrough**: `verify.ps1` is not redesigned; the owner verifies
  the window by hand.
- **Anything the Host says**: this record draws the Host's vocabulary; it never
  invents a word for a Host concept.

## 14. Where the prototype still differs

The prototype is the working set, not the finished sheet. These are the
differences known at this writing, each with the ticket that closes it; a build
ticket that finds another one records it here rather than inventing a second
rule.

| The prototype today | The record | Closed by |
|---|---|---|
| `clamp(rem, n vw, n vw)` per token; layout in `2.9vw` | the `--rep-stage` unit and the floor/step table in §3–§4 | #153 |
| utility panels and forms at 760px; the log note at 66ch | the `ch` measure (46ch utility, 58–62ch prose) | #153 |
| the brass wash on every card and rail item, fading at 240ms; the feature at a 6px offset; cards keylined 3px outside | the wash on the feature and a focused poster's art at 140ms; one 3px offset, the keyline on the art's edge | #153, #154 |
| the Playfair alternate: the `data-pairing` token block, its imports and the `?type=playfair` rehearsal option | cut; one pairing | #153 |
| `kit-focus-invert` fills focused controls; the Velvet kit's button/choice/poster re-dressed by repertory classes | the repertory kit: keyline, brass inset rule, no fill | #153 |
| the OSD names the current chapter permanently at the centre | the chapter is named only in the hover/drag callout | #158 |
| the OSD's ±10s and subtitles marks are text; the Remote is Unicode | one drawn set on both clients | #158, #159 |
| the volume is the native range with `accent-color` | a drawn rail with a brass fill | #158 |
| brass repeated as `rgba()` literals in the wash and feature glow | every brass derives from `--rep-house` | #153 |
| shadows on the spine, the feature focus, the popover and the OSD | depth is a hairline and one ink step | #153, #158 |
| reduced motion zeroes `--rep-dur-*` | transforms and layout off, opacity fades kept, fills snap (§6) | #153 |
| CSS transitions only; no animation library, no crossing between screens | Motion in both clients, with the spring presets and the transition shapes in §6 | #153, #159 |
| the Remote's strip still scroll-snaps | no snapping: the rail scroll is redirected mid-flight (§6) | #159 |
| the Velvet sheet and its splice live beside the repertory sheet; the served page keeps `/` and the `?ui` gate | one sheet, one splice, one page | #152, #160 |
