# Focus is an input modality: decoration and centring belong to navigation

Ticket #245. Three navigation bugs and the spine's layout share one seam: focus
is both a navigation instrument and a pointer side effect. A click or a tap was
painting the ivory keyline, the ivory ink and the spotlight wash on the control
under the pointer; the same focus also ran the repertory's centred reveal, so a
click on a fully visible card could recentre the page. The window and the
served Remote draw one kit (ADR-0035 §2), and both showed it. This records the
rule that separates the two jobs: **the last input decides whether focus is
drawn and revealed.**

## 1. The modality is the last input

`InputModality` is `"pointer"` or `"navigation"`. The room opens in `"pointer"`:
a client that mounts with a control focused paints nothing, because the person
has not asked the room to move yet. Any `keydown` means navigation, including
Tab and Enter; any `pointerdown` means pointer. A standard-mapping pad has no
key event, so the focus engine marks navigation itself before it runs an intent.
The modality is a small framework-free store in `src/core/inputModality.ts`, and
the installer writes `html[data-input="navigation"]` (or `pointer`) so every
stylesheet can read the one fact.

The installer takes the page root rather than reaching for a global document:
the entries pass `document.documentElement`, and the suite passes a fake root.
That keeps the core's platform-free rule (ADR-0035 §1) without moving the
decision into either client. Installation is idempotent and cleanable.

Rejected, with reasons: **`:focus-visible` alone** (the pad's focus is
programmatic and would not match; a click can still match after a key, and the
reveal would still centre); **a `:hover` guess** (a touch is not a hover, and a
mouse that only moves must not switch the room); **a modality per screen**
(the window and the Remote would drift, and the kit's ring is one decision).

## 2. Pointer is direct manipulation and shows nothing

In pointer modality no focus treatment is painted: no keyline, no ivory ink, no
wash, no focus background, no form field's focus rule. The stylesheets gate every
focus rule with `html[data-input="navigation"] <selector>:focus`; a rule that
combined `:hover` with `:focus` is split so hover stays under the pointer, and
the selected-state branches — `aria-pressed`, `aria-current`, a chosen chip —
are never gated. A selected control is a state, not a focus decoration, and it
must keep saying what it is when the mouse chose it.

The focus still moves. The browser's native focus is what a click on a button
does, and the focus engine still remembers the control for the D-pad, Back and a
destination change. What is removed is the drawing and the scroll, not the
position.

Rejected, with reasons: **hiding the outline but keeping the ink and wash** (a
half-treated control reads as a different selected state); **gating selected
states too** (a person who clicked a chip could no longer see which filter is
on); **a `pointer` class on every control** (the modality is one fact about the
room, and a class per control is the same fact repeated).

## 3. Navigation owns the decoration and the centre

A key or a pad intent is navigation, so the treatment is painted and the focus
is revealed. The reveal centres only the axis the movement used: Left/Right
centres x and minimally reveals y; Up/Down centres y and minimally reveals x.
A mount, a Back restore and a destination change are not a direction: they
centre both axes. `nearest` is unchanged, because a scrollport that is not the
repertory's frame still wants the minimal reveal on both axes.

This is what removes the two-line-title jitter: a horizontal walk between two
cards no longer recentres vertically by half the caption height on every step.
The axis travels through the focus engine as a pending axis set before
`.focus()`; the synchronous focusin listener consumes it, and the guard that
already prevents a second reveal also prevents the fallback path from applying
the axis twice.

Rejected, with reasons: **always centring both axes** (the jitter this ticket
exists to remove); **centring only from the frame's marker** (the marker says
"this screen centres"; it cannot know which direction the person walked);
**a second reveal mode** (the existing centre with an axis is the same rule and
keeps one geometry).

## 4. The cut-off first press is the one pointer scroll

A pointer press on a control that is fully visible activates on the first click,
with no scroll and no ring. A control cut off by its row is a different case: the
browser's own focus scroll would move the row before the click lands, so the
first press only focuses and reveals it minimally; the second press, with the
control now focused at pointerdown, activates. The plan is pure —
`pointerPressPlan({ inRow, wasFocused, fullyVisible })` in
`src/core/pointerPress.ts` — and the DOM half that records the press and walks
the scrollports lives in `src/core/react/pointerPress.ts`, the core's one DOM
pocket (ADR-0035 §1). The record is made at `pointerdown` capture, before the
browser's native focus scroll, then read at `click` capture. A control outside a
row is direct manipulation and always activates.

"Fully visible" means within a pixel. The test sets the control's exact border
box against each scrollport's client box, and the browser snaps that client box
to whole pixels while the control's rect keeps the fraction. A control that
fills its port — the Title's episode rows fill their list's width — therefore
overhangs the snapped box by the remainder and so reads as cut off, at every
window width where the snap rounds down: the first press only focused the row
and the second one opened it. It was found on the Windows build while #275 was
verified, and `main` had it all along. `insidePort` admits less than a whole
pixel past an edge, which is the snap's whole error; a pixel or more is still a
cut-off, and the row at a list's bottom edge keeps the two-press rule.

The window reveals through `focusAndReveal(control, { mode: "nearest", force:
true })`; the Remote calls `focus({ preventScroll: true })` and
`scrollIntoView({ block: "nearest", inline: "nearest" })`. Both are the minimal
reveal, never the centre: the pointer asked for a target, not for the room to
move it to the middle.

Rejected, with reasons: **activating on the first press and letting the browser
scroll** (the activation is a different control from the one the person aimed
at); **always focusing first** (a fully visible control would need two clicks
for no reason); **a timer or a double-click window** (the browser already says
which control was pressed; a clock would make the rule depend on speed);
**comparing the exact boxes with no tolerance** (the snapped client box is the
only port the DOM offers, so every control that fills its port reads as cut off
at some window widths); **rebuilding the port's exact content box from computed
style** (the used size depends on `box-sizing`, the scrollbar and the zoom: more
machinery to reproduce a number the tolerance already bounds); **taking the
episode list out of the rule** (the row that really is cut off at its bottom
would lose the rule, and every other full-width list would stay a window width
away from the same bug).

## 5. The Remote shares the rule

The Remote is a second entry of the same client (ADR-0035), and it installs the
same modality and press rules in its own entry. Its rail carries
`data-kind="row"` so the cut-off rule finds it, and its `scroll-snap-type` and
`scroll-snap-align` are removed: a snap point fights the minimal reveal and made
the rail jump back after a tap. The horizontal scroll, `overscroll-behavior` and
touch scrolling stay.

Rejected, with reasons: **a Remote-only implementation** (two models for one
gesture, and the phone is where the cut-off press matters most); **keeping the
snap and suppressing the reveal** (the card would stay half-cut and the press
would still activate the wrong one); **a second pointer plan in the template**
(the pure plan is the lock, and the Remote imports it).

## Consequences

- A pointer user gets no visual focus; the selected states still carry state,
  and hover still answers. This is the trade: direct manipulation is not a
  keyboard walk, and the room does not pretend it is.
- Keyboard and assistive-technology focus depend on a keydown or a pad intent.
  A programmatic focus with no input before it stays in pointer mode until the
  next key, which is the intended default; Back is a key intent and marks
  itself, while a destination change restores focus under whichever modality
  chose it.
- `reveal(control, { force: true })` is the only pointer scroll. The cut-off
  first press uses it; `focusAndReveal` without `force` focuses with
  `preventScroll` and tells no reveal listener.
- The modality is one attribute on `html`, written before the browser moves
  focus, so a stylesheet never has to guess and no component carries a
  `pointer`/`keyboard` prop.
- The spine opens when a spine item takes focus in navigation, as well as on
  hover and an arrow walk; a pointer press on the same item leaves it compact.
  The open/compact width, the label fade and the panel spring are unchanged.
- Tests: `inputModality.test.ts` (keydown, pointerdown, the attribute, install
  and teardown), `pointerPress.test.ts` (the four plans, the rect ports and the
  one-pixel slack), `src/core/react/pointerPress.test.ts` (the fixed-panel
  visibility walk, and a row that fills its snapped port),
  `reveal.test.ts` (the axis, the unchanged nearest, the pointer skip and the
  one forced reveal), `useSpatialFocus.test.tsx` (pointer moves without
  revealing, navigation reveals, the two-press cut-off), `screens.test.tsx`
  (the Title's first press on an episode, and the main button outside any row)
  and `frame.test.ts` (`spineOpensOn`). No CSS is read as text; the two
  presentation locks are unchanged (ADR-0032).
- `docs/design-system.md` §5 is the drawing's home: the keyline, the ink and
  the wash are navigation's, and a pointer focus draws none of them.

## Amendment (#392): arrow keys own navigation; mouse movement and wheel return to pointer

In the Marquee walkthrough (#392), treating every `keydown` as navigation and
ignoring mouse movement made pointer and keyboard use feel sticky: pressing
`Tab` or `Enter` forced navigation modality (and Home's following-focus layout),
while moving the mouse or scrolling the wheel after an arrow key left the room
stuck in navigation modality until a click.

1. **Navigation keys vs pointer keys.** Only directional arrow keys (`ArrowUp`,
   `ArrowDown`, `ArrowLeft`, `ArrowRight`, with `ArrowLeft`/`ArrowRight` inside
   a text input kept for the caret) and gamepad/D-pad intents enter
   `"navigation"` modality. `Tab`, `Shift+Tab`, `Enter`, `Escape` (from a
   keyboard), and typing keys leave the room in `"pointer"` modality so
   keyboard focus traversal and activation work without forcing navigation
   decoration or Home's following mode.
2. **Returning to pointer.** In addition to `pointerdown`, a `wheel` scroll or
   real mouse movement (`pointermove` with changed pointer coordinates,
   ignoring stationary synthetic events emitted during scroll/layout shifts)
   returns the room to `"pointer"` modality.
3. **Hovering.** Hovering content never moves focus, never scrolls or reveals,
   never swaps the Home hero, and never expands the nav rail (the expanded
   rail's fade gradient carries `pointer-events: none` so hovering over content
   next to the rail never holds the rail open). Hovering the rail itself still
   expands it.
