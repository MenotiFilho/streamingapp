# A row's horizontal end is a wall: the overlap guard returns

Ticket #245. ADR-0025 §3 chose to let Right at the end of a short row cross
diagonally to the closest control in the row below. The owner reverses that for
horizontal exits from a row: a rail is a line of cards, and Right at its last
card landing on a card in the rail beneath is not what a rail means. This
records the reversal, what it keeps from #128, and the alternatives it rejects.

## 1. Context

The window's rows are horizontal rails of cards, stacked inside a content
branch. #51 made a short row stop at its end rather than leak into the wider row
below; #128 (ADR-0025 §3) removed that wall so the level-wide search could pick
the next occupied control on that side. On a real Home screen that turns Right
at the last card of "Continue watching" into a diagonal jump into the catalog
below — a move that reads as a bug, because a card in the next rail is not the
next thing in the rail the person was walking. The geometry is real; the meaning
is not.

## 2. Decision

`Rules.rowExit` selects the exit rule, and `DEFAULT_RULES.rowExit` is
`"overlap"`.

- **A horizontal exit from a `row` requires overlap.** Under `overlap`, the
  level-wide search of `edge: "nearest"` may only choose a candidate whose
  cross-axis gap with the focused control is at most `ALIGNED` (1 px). That is
  #51's vertical-overlap guard, restored for horizontal row exits only.
- **The rail stays reachable.** A `rail` is a region of its own kind — a
  column, not a card row. A horizontal exit from a row may always reach it,
  whatever the y of its items; the guard walls the rows from each other. Left
  from a row's first card therefore still crosses to the spine. The row below
  does not overlap the row above, so Right at the end of a short row blocks.
- **Vertical moves keep the level-wide search.** `rowExit` is horizontal by
  definition: Up and Down still find the closest control anywhere on that side,
  including one in a row that does not line up.
- **Grids are not rows.** A `rail-grid` is a `branch`, so its lines keep their
  wrap between lines; the guard applies to `kind: "row"` only.
- **The other walls are untouched.** The rail's vertical ends stay walls, the
  rail's Left stays the left edge, and `edge: "stop"` keeps its own behaviour.
- **`rowExit: "level"` restores #128's diagonal crossing.** The rejected model
  stays selectable so a test can lock it rather than leave it to arithmetic.

## 3. Trade-offs and rejected alternatives

The trade-off accepted: a short row's end is a wall even when a real control
exists diagonally below it. The cost is a stop the geometry could avoid; the
gain is that a horizontal walk never changes rails. A person who wants the row
below presses Down, and Down still lands on the closest control there, off to
the side where the row does not line up.

Rejected, with reasons:

- **A hard wall in both directions.** It would also stop Left from the first
  card, and the spine — the full-height rail that is the left edge of the room
  — would become unreachable from a row. The guard is overlap, not "no exit".
- **Only Right blocked.** It would put the asymmetry in the rule instead of the
  geometry: Left is allowed because the spine overlaps, not because Left is
  special.
- **Reusing `edge: "stop"`.** That is #51's whole model, not this one: it also
  changes the in-row direct-first ranking and the sibling and child steps, so a
  screen that only needs the row-end wall would lose #128's aligned-first
  geometry. `rowExit` is one switch over the settled ranking.

## 4. What stands

ADR-0025 §1 (direct-first, then closest, inside a region) and §2 (the
cross-region order, the level-wide search and the strip's box) stand. §4 (the
window and dialog scoping) stands: the strip's box is still an extra candidate
in the level-wide search, and a dialog with nothing under the origin still lands
on its head. §3's diagonal row-end crossing is reversed; its vertical moves, its
off-side sibling and child crossings, and its other screens are untouched. §5's
evidence list follows the change.

## 5. Tests and evidence

`src/window/focus.test.ts` pins the decision:

- default: Right at the end of a short row is `blocked` when the row below does
  not overlap it — "Right at the end of a short row is a wall when the row below
  does not overlap it";
- `rowExit: "level"` restores the diagonal crossing — "rowExit level keeps
  #128's diagonal crossing at the end of a short row", and the off-side sibling
  case;
- default: Left from a row's first card crosses to the rail — "Left from the
  first card still reaches the full-height rail that overlaps the row";
- default: Left reaches the rail even from a row placed below all of the rail's
  own items — "Left reaches the spine from a row below the rail's own items";
- default: a horizontal move to a control in a sibling at the same height still
  crosses;
- default: Down from a row still crosses to the closest control in the row
  below — "crosses down to the row below and enters the card under the origin's
  middle";
- the rail's vertical ends remain walls, and `edge: "stop"` keeps #51's wall.

The Windows walkthrough is the owner's. `verify.ps1` step 27 now asserts the
wall: it focuses the Continue watching row's More card and checks that Right
leaves focus there, instead of the crossing #128 scripted.
