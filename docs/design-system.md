# The Marquee design system

**Decision:** ADR-0043. **Supersedes:** the design record of ADR-0030.
**Motion:** ADR-0031. **Drawing:** `docs/design/marquee/` (the mockup's generator,
see its README).

This is the client's living visual record: the palette, the type, the scales, the
focus rule, the motion, the icons, the component anatomy, the artwork rules and the
copy voice. A build ticket reads it before drawing a screen, and reads the mockup
for the screen itself. It holds no behaviour: every Action, Snapshot, focus rule,
level-stack rule and Remote flow belongs to the Host and to `CONTEXT.md`, and this
record does not move them. ADR-0043 §4 lists what the drawing asks beyond today's
behaviour; each item lands as its own ticket.

The values live in one sheet of `--mq-*` tokens, `src/kit/tokens.css`, imported
by the window and by the served Remote. Measurements below are given at the
window's **1920×1080 reference frame** and, for the Remote, at a **390×844
phone**. §4 says how the window scales them to other sizes.

## 1. The direction

The window looks like a commercial streaming app on a television. The artwork
carries every screen: a full backdrop behind the hero and the Title, a poster or
a 16:9 card for every item, and the Title's own logo wherever there is one. The
room around the artwork is near-black and quiet. The controls are pill-shaped and
the panels are glass, so the picture shows through them.

Two colours have jobs, and nothing else is coloured:

- **White is focus.** Whatever has focus turns white with ink content, or (for
  artwork) scales up and takes a white outline.
- **Lavender is the primary action at rest, progress and selection**: the button
  you are expected to press, the bar of how far you are, the chip and the check
  of what is chosen, the active destination.

What the direction refuses: a second accent colour, light mode, focus shown by
colour alone without the white, decoration drawn over the artwork other than
scrims and marks, and any control that hides its state behind hover.

## 2. Palette

| Token | Value | Role |
|---|---|---|
| `--mq-canvas` | `#0A0B0F` | the page; also ink, the content colour on white and lavender |
| `--mq-surface` | `#14161D` | panels and sheets (under glass) |
| `--mq-surface-2` | `#1E212A` | a card or still while its art loads |
| `--mq-surface-3` | `#2A2E39` | tiles inside a row (an Addon's logo, a tier box) |
| `--mq-white` | `#FFFFFF` | text, and focus |
| `--mq-accent` | `#C4A7E7` | primary action, progress, selection |
| `--mq-imdb` | `#F5C518` | the IMDb badge, nothing else |
| `--mq-ok` | `#3DD68C` | the watched check on an episode card |
| `--mq-warn` | `#FFB224` | reserved; no screen uses it yet |
| `--mq-danger` | `#FF5C66` | failure, and destructive actions |

White text comes in four strengths, set as opacity over the surface it sits on:
**full** (names, values), **muted 72%** (descriptions, secondary lines),
**faint 50%** (captions, bookkeeping), and **line 12%** for rules. **Glass** is
white at 14% behind a 50–60px background blur: secondary buttons, chips at rest,
and panels.

Measured pairs (WCAG contrast, at the values above):

| Pair | Ratio |
|---|---:|
| white on canvas | 19.7 |
| white on surface | 18.1 |
| muted white on canvas | 10.2 |
| faint white on canvas / on surface | 5.3 / 5.3 |
| lavender on canvas / on surface | 9.4 / 8.6 |
| ink on lavender | 9.4 |
| ink on white | 19.7 |
| white on glass over canvas | 13.7 |
| danger on canvas | 6.5 |
| ok on canvas | 10.5 |
| ink on the IMDb yellow | 12.1 |

Over a picture, text always sits on a scrim (see §9). Its contrast is judged over
a bright film on the panel (§12).

## 3. Type

One family, **Figtree**, in five weights: Regular 400, Medium 500, SemiBold 600,
Bold 700 and ExtraBold 800. Line height is 1.35× the size unless a role says
otherwise.

### The scale (window)

| Role | Size / weight | Used for |
|---|---|---|
| Display | 56 / 800 | Foundations only |
| Screen title | 44 / 800 | a destination's head (Discover, Library, Addons, Settings) |
| Heading | 36 / 800 | a panel's name (Streams) |
| Level title | 28–30 / 800 | a Settings part, a pushed level |
| Row head | 28 / 700 | over every row |
| Body | 22 / 500, line 34 | synopsis, descriptions |
| Control | 20 / 700 | buttons, nav labels, row names |
| Label | 17–18 / 600–700 | chips, choice-group labels, stat values |
| Caption | 15–16 / 500 | notes, dates, details |
| Overline | 14 / 800, tracking 1.2–1.6 | group labels (TORRENTIO), EPISODE 3 |
| Badge | 14 / 700, tracking 0.4 | stream marks, IMDb, UP NEXT |

The phone's scale is in §11.

### Faces on disk

The window bundles Figtree as local `woff2` faces with its OFL notice. The served
Remote receives the same files from the Host, so a phone without them sees the
fallback, not the design. No page fetches a font from a third party.

## 4. Space, radius and depth

Spacing is on an **8px grid** (4 is allowed inside a control). With the rail, the
window's content margin is **168px**. Without it (the player, a full-screen
level) it is **64–72px**. A row's items sit 24–40px apart; that gap leaves room for
a focused card to grow without touching its neighbours.

| Radius | Where |
|---|---|
| 6 | badges |
| 8–10 | a still inside a row, a time label |
| 12–14 | tiles, tier boxes, list rows on the phone, poster cards on the phone |
| 16 | cards (poster, wide, episode) |
| 18 | list rows, stream rows, Addon rows, fields |
| 20–24 | floating panels, the dropdown menu, the up-next and confirm cards |
| 28 | the side panel and the phone's bottom sheet |
| full | buttons, chips, the search field, switches, the nav items |

### The reference frame

The window is drawn once, at 1920×1080, and scales through one unit:

```css
--mq-u: max(0.5px, calc(min(1vw, 1.7777778vh) / 19.2));
```

- At 1920×1080 `--mq-u` is exactly `1px`. A measurement of `N` on this page or in
  the mockup is written `calc(var(--mq-u) * N)`.
- It scales **linearly with the shorter side of a 16:9 frame**: the window's
  width, or its height × 16/9, whichever is less, over 1920. An ultra-wide window
  does not blow up vertical sizes, and a tall one does not blow up horizontal
  ones.
- It has a **floor of 0.5px**, a 960×540 frame, so a tiny desktop window stays
  readable, and **no ceiling**, so 4K draws at twice the size.
- Type sizes, body line height, spacing, margins, the rail's widths, radii,
  shadows, tracking and the focus outlines follow the unit. The **glass blurs**,
  the focus **scale factors** and the durations are fixed values. So is the
  window chrome's **56px band** and its 4rem clearance, which the D-pad geometry
  measures in CSS pixels.
- The **Remote does not use the unit**: its hand scale (§11) is in CSS pixels.

A decision that needs the unit as a number reads it from `marqueeUnitPx`
(`src/window/marquee/frame.ts`), the same formula.

**Depth** comes from three things, and only these: a **shadow** under what is
focused or floating (offset y 12–30, blur 2.2× the offset, black at 40–55%), the
**glass blur** of panels, and **scrims** over art. Nothing else is raised.

## 5. Focus

Focus belongs to navigation (ADR-0037, amended #392): arrow keys and gamepad
intents enter navigation modality, while `Tab`, `Shift+Tab`, and `Enter` work in
pointer modality without forcing navigation decoration or following mode, and a
click, wheel scroll, or mouse move returns to pointer modality. Hovering never
moves focus, scrolls, swaps the hero, or expands the rail over content. A
pointer press does not paint focus. When focus is shown, it follows three rules,
by kind:

- **Controls** (buttons, icon buttons, chips, nav items, the search field, the
  dropdown, a category item): the fill turns **white** and the content turns ink.
  The control gets a soft shadow. This is the same whatever the control's kind at
  rest, primary lavender included.
- **Artwork** (poster, wide card, episode card): the card **scales up** (8% for a
  poster, 7% for a wide card, 6% for an episode) around its own centre. It takes a
  **4px white outline** outside its edge and a shadow. Its caption moves down by
  the growth. An episode card also shows a play mark.
- **Rows in a list or panel** (stream rows, track and option rows, Settings list
  rows, Addon rows, ranked languages): the surface lightens from 5.5% to 14% white
  and takes a **3px white outline** inside its edge. A long list stays readable
  because the row is not filled white.

**Selection is not focus.** Something chosen carries lavender: a filled chip with
a check, a lavender check on a row, the lavender pill of the active destination.
A chosen thing that also has focus is white, and keeps its check.

On the **phone** nothing is focused by a finger. A press darkens the control
(ink at 35% over a card, white at 12% behind a tab). Keyboard focus on the Remote
keeps the rules above.

## 6. Motion

The engine and the presets stand as ADR-0031 recorded them: Motion for springs and
gestures, CSS for fades and fills, and the panel (0.24s), quick (0.14s) and fade
(0.14s) presets with no bounce.

**What moves:**

- A **focused card** scales on the quick spring. Its outline and shadow fade in
  with it. A row scrolls to keep the focused card in view on the panel spring.
- The **rail** widens and shows its labels on the panel spring when focus enters
  it, and the dim behind it fades.
- The **hero** cross-fades between titles on its beat. When it switches to
  following focus, its backdrop slides to the right and the rows slide up on the
  panel spring. Each focus change after that cross-fades the title, the facts and
  the logo.
- A **panel** (a player menu, the side panel, a dropdown menu, a confirmation)
  rises 12–16px or slides in from its edge with a fade, and its scrim fades with
  it. On the phone, sheets rise from the bottom edge.
- **Opening a Stream**: the Title's logo fills in from its leading edge as the
  Host reports progress. Its dim copy shows what is left. Without a logo, a bar
  fills under the name. While a Stream is Stalled the spinner turns.
- An **Addon row that moves** rides along the list on the panel spring while it is
  in its moving state.
- Progress fills, the volume and the seek bar stay CSS.

**What does not move:** text does not animate in or stagger, the page does not
parallax, and nothing bounces.

**Reduced motion** keeps ADR-0031's rule: transforms and layout animations are
off, and fades stay. A focused card then shows its outline and shadow without
scaling. The hero switches its mode as a fade.

## 7. Icons

**Phosphor** (MIT), one set for the window and the served Remote, on a 24 grid
drawn at any size. **Regular** weight for chrome, **fill** for transport (play,
pause, skip) and for an active destination, and **bold** for checks. Icons take
the content colour of their control: white at rest, ink on white or lavender, 60%
white for decoration. No Unicode glyph stands in for an icon.

The set, by job: house, compass, magnifying-glass, books, puzzle-piece and
gear-six for the six destinations; play, pause, skip-back, skip-forward,
counter-clockwise and clockwise arrows (−10s and +10s), stop, speaker-high,
corners-out; monitor (picture), closed-captioning, waveform, queue (streams), stack
(episodes), gauge (speed), list-numbers (chapters), pulse (details); arrow-left,
caret-down, caret-right, x, check, plus, minus, info, arrow-up, arrow-down, trash,
dots-six-vertical (drag handle), minus-circle; warning, users, hard-drive,
globe-simple, download-simple, key, device-mobile, film-slate, sliders-horizontal,
arrow-clockwise; cell-signal, wifi and battery for the phone's status bar only.

## 8. Component anatomy

The mockup's Components page holds every component with its variants. The
measurements below are its own.

### Frame

- **Nav rail**: 120px of icons at rest over a left scrim, with the brand mark at
  the top and the clock at the foot. Items are 56px circles 80px apart. Active is
  a lavender glyph on a lavender pill at 16%, and focus is a white circle. When
  focus enters it, it widens to 280px items with labels over a near-opaque panel,
  and dims the screen to 55%.
- **Screen title**: the destination's name (44/800), with an optional subtitle
  that says where its Titles come from (*From TMDB*, *From your Stremio account*).
- **Row header**: the row's name (28/700) and, optionally, the Addon it comes from
  in faint text.

### Hero

Two modes of one component, gated by input modality (#392). In **pointer
modality**, Home is an ordinary whole-window scrollable page: the **rotating**
hero sits at the top and scrolls away with the rows, without following focus or
hover. In **navigation modality**, focusing a row card switches to **following
focus**. **Rotating**: a 1920×880 backdrop under a left and a bottom scrim. Over
it sit the logo (at most 560×180, anchored bottom-left at the content margin),
the meta line, a three-line synopsis, **Watch now** (primary, focused) and
**Details** (secondary), and the ticks at the bottom right. **Following focus**:
the backdrop moves right (1440×810), the logo shrinks to 520×150, the actions
and the ticks go, and the rows start 156px higher. Moving the mouse or scrolling
returns Home to the page layout while keeping the visible rows aligned without a
jump. The **meta line** is the IMDb badge, the rating, then year, runtime and up
to three genres separated by dots.

### Cards

- **Poster** 208×312, radius 16. Optional marks: a watched check (top right, on
  an ink disc) and a progress bar along the bottom.
- **Wide card** 400×225 (Continue watching): the backdrop with the Title's logo
  bottom-left over a bottom scrim, or an episode still without a logo. A progress
  bar runs along the bottom, and an optional **UP NEXT** badge sits top-left. A
  caption under it gives the name and the time left.
- **Episode card** 408×230: the still, a watched check and progress. Its caption
  gives the overline (EPISODE 3), the name, the date and the episode's own
  description in two lines.

### Controls

- **Button**: primary (lavender), secondary (glass), ghost and danger (red), in L
  (60px) and M (48px), each with an optional leading icon.
- **Icon button**: circles of 80, 56 and 48px, with the same kinds.
- **Chip** (46px): off, or on (lavender with a check).
- **Dropdown** (46px pill): a faint label, the value and a caret. Open, it is
  lavender at 18% with a lavender outline, and its menu (radius 20, rows of 52px)
  drops under it.
- **Badge**: neutral (glass), accent, IMDb and danger.
- **Switch** 60×34: lavender with an ink knob when on.
- **Search field** and **text field** (72px, radius 18 or full). A field's label
  sits above it.
- **Size stepper**: minus, a track with a lavender level and a knob, plus, and the
  value. It runs from 25% to 300% in 5% steps.
- **Sync control**: −0.1 s, the value, +0.1 s and Reset.

### Rows and panels

- **Stream row** 848×128: a tier box (lavender for 4K, 1080p on surface-3), the
  name as the Addon gave it, the details (peers, size, source) with icons, the
  marks the name declares, and a play disc. The Stream playing now takes a
  lavender outline and a **PLAYING** badge.
- **Track / option row** 372×64: a title, a detail line, and a lavender check when
  chosen.
- **List row** 880×76: an icon, a label, and either a value with a chevron or a
  switch.
- **Addon row** 880×112: logo tile, name, what it serves, version, and the
  switch. It shows no origin and no reachability (ADR-0044 §1). Focused, it adds
  details, move up, move down and remove. In its moving state it is lavender with
  a drag handle and the hint *Up and down to move · OK to place*.
- **Ranked row**: the position in a lavender disc, the language, and up, down and
  remove.
- **Panels**: the side panel (936×1032, radius 28) for Streams; the floating panel
  (840×540, radius 24) for the player's menus, in two columns split by a rule;
  the confirm card (640×300), whose focus starts on Cancel.
- **Addon notice**: a red-tinted row with the warning icon, *X did not answer*,
  the Host's reason verbatim, and Try again.
- **Empty state**: a glyph disc, a title, one line and one action, centred.

### Player

- **Top bar**: back, the Title and the episode, the Stream's marks (resolution,
  HDR, audio), and close.
- **Seek bar**: the elapsed time, a track with buffered and played fills, chapter
  ticks in ink, a white playhead, and the time remaining. Focused, the bar
  thickens and the frame under the playhead shows above it.
- **Controls**: volume, the transport (−10s, play/pause, +10s), next episode, and
  the menus: picture, subtitles & audio, streams, episodes, speed, chapters,
  details and full screen. The open menu's button is white.
- **Opening**: the Title's logo filling in, or its name over a bar. **Stalled**:
  the spinner, a lavender third of a ring.
- **Up next** and **Still watching?** cards sit at the bottom right.
- **Docked transport**: where the picture is not in the window (mpv has its own,
  or there is none) there is no OSD. A band at the foot of the page, 144 tall on
  surface under a rule, carries *Now playing*, the Title and where the picture
  went; play and pause; the seek track between its two clocks; Cancel or Keep
  watching while Autoplay waits; the volume with mute; and Stop. The page above
  gives up its height. The mockup does not draw it.

## 9. Artwork and marks

| Surface | Chain |
|---|---|
| Hero, Title page | backdrop, under a left and a bottom scrim → landscape poster → the name in Screen title type over canvas |
| Logo | the Title's logo, fitted in its box and anchored bottom-left → the name in type |
| Poster card | poster → the name centred on surface-2 |
| Wide card | backdrop with logo → episode still → surface-2 with the name |
| Episode card and row | still → surface-2 with S#E# and the name |
| Remote | the Title's poster beside its name; the ambient background is the backdrop at 14% |

A **near-black logo** is drawn white so it reads on the dark canvas. A logo is
never stretched, and art is cropped to cover its box from the centre. A scrim is
canvas fading to clear: from the left at 94% for text over art, and from the bottom
at 100% where rows start.

Marks:

- **IMDb**: the yellow badge and the rating in the meta line, only when the Host
  carries a rating.
- **Watched**: a check on an ink disc, **lavender** on a poster and green
  (`--mq-ok`) on an episode card. **Progress**: a lavender bar on a 28% white
  track.
- **UP NEXT**: the accent badge on a wide card.
- **Quality and source**: the Addon's own words, verbatim, as the stream row's
  name and marks; never re-worded or re-ranked.
- **Failure**: the danger tint, the warning icon and the Host's reason verbatim
  (`addon_unreachable`).
- **Waiting**: the spinner only where something is Stalled; a Stream that is
  opening shows its logo filling in.

## 10. Copy voice

Two vocabularies, and they do not mix:

- **Host words stay on controls and heads**: Streams, Addons, Library, Catalog,
  Continue watching, Settings, Pairing code, Up next, Autoplay. A control never
  renames a Host concept.
- **Everything else is plain, present tense and short**: *Nothing in your Library
  yet*, *Discover needs a TMDB key*, *Up and down to move · OK to place*. No
  exclamation marks, and no second sentence that repeats the first. A head is a
  name, not a sentence.

Errors quote the Host's own words and the Action's refusal verbatim, and add at
most one line saying what the person can do. A confirmation names the thing and
states the consequence in the Host's words (*The device's token stops working
immediately. Every other paired device keeps working.*).

## 11. The Remote

The same palette, family, icons, marks and focus rules, at hand scale, on a
390×844 phone with a 16px gutter.

| Role | Value |
|---|---|
| Minimum target | 44px |
| Tab bar | 64px of items over a 34px home-indicator inset; six items of 65px, glyph 24, label 11/600–800 |
| Now-playing strip | 64px, 8px from the edges, radius 16, glass; the Title's poster (36×54), name, time left, −10s and play/pause, and a lavender progress line on its bottom edge |
| Large header | 28/800 name, 13 subtitle |
| Level header | back, the name 17/800, a subtitle 12 |
| Row head | 20/800 |
| Body | 14–15, line 20 |
| Caption | 12–13 |
| Poster | 116×174, radius 12, in three columns 5px apart |
| Wide card | 264×149, radius 14 |
| Bottom sheet | radius 28, a grabber, the title 22/800 and close |

- **The Home hero** fills the top 520px: the backdrop, the logo centred, the facts,
  Watch now and Details, and the ticks. It rotates and swipes. With no focus to
  follow, it has no following mode.
- **The remote** fills the screen when the strip is pressed. It has collapse and
  stop, and *Playing on the Host*. The Title's poster (148×222) sits beside its
  name, the episode in lavender and its description. Under them come the Stream's
  marks, the seek bar, the transport (previous episode, −10s, play/pause in
  lavender at 80px, +10s, next episode), the volume box, seven menus (Subtitles,
  Picture, Streams, Episodes, Speed, Chapters, Details) that open one bottom sheet,
  and the Autoplay switch.
- **Lists** use the phone's rows: stream rows 358×112, episode rows with the
  still, the description under it, and Settings and Addon rows of 60–76px. Addons
  has an **Edit** mode with remove (red minus) and drag handles.
- **Pairing** is a screen of its own: the mark, *Pair with your Host*, six code
  cells, the Host's address and Pair.
- **Remote devices** is a Settings leaf, not a seventh destination.

## 12. What is provisional, and where it is judged

Each of these may move once, with the measurement written back here:

- **The lavender on the panel.** `#C4A7E7` may read greyer or pinker on the
  Windows panel than on the mockup. One correction is allowed, judged in the
  owner's Windows walkthrough.
- **The glass.** The blur's cost in WebView2 over a playing picture, and the
  panels' opacity (88–97%). If the blur is too expensive, a panel becomes
  opaque surface; its shape stays.
- **The focus scale.** 8%, 7% and 6%, judged at ten feet on the panel.
- **The opacities over a picture.** The OSD scrims, the dims (30–60%) and the
  ambient background on the phone, judged over a bright film.
- **The reference frame.** The scaling of §4, its 0.5px floor and its lack of a
  ceiling, judged on the panel.

## 13. What this record does not decide

- **Behaviour**: Actions, Snapshots, the focus model, the level stack, the Back
  order, auto-hide and the Remote flow. ADR-0043 §4 lists what the drawing asks
  for beyond today; each item is its own ticket, reasoned against `CONTEXT.md`.
- **The tests**: the presentation locks and the behaviour suites stay governed by
  ADR-0032.
- **The release**: Marquee is the only design of the window and of the Remote.
  It was built on `integration/marquee` and reaches `main` whole, after the
  owner's walkthrough of the Windows build.
- **Anything the Host says**: this record draws the Host's vocabulary and never
  invents a word for a Host concept.
