# Focus crosses to the closest control on that side: #51's anti-leak walls, reversed

**Superseded in part by ADR-0036** — §3's diagonal row-end crossing is reversed; §1, §2 and §4 stand.

Ticket #128 changes where a D-pad move goes when nothing inside the focused
region lies that way. #51 deliberately made a short row stop at its end rather
than leak diagonally into the wider row below; this ticket reverses that wall.
This records the settled rule, the one trade-off it accepts, and what it leaves
alone.

## 1. Inside a region: direct-first, then closest

`nearest` now ranks by two rules:

1. **Direct-first.** A control whose cross-axis gap is at most `ALIGNED` (1 px)
   is lined up with the origin. If any candidate is lined up, the shortest step
   among them wins, with the closer centre across as the tie-break.
2. **Closest.** Only when nothing is lined up does the closest by edge distance
   win: `hypot(step, gap)`, with `across` as the tie-break. `step > MIN_STEP`
   still applies, so a control that does not clear the origin is never a
   candidate.

This is what turns a wrapped grid with a hole into the next occupied control on
that side rather than a stop or an arbitrary small gap. It is also why a card in
a row can move diagonally at all.

The old ranking — smallest sideways gap first, then shortest step, then centre —
stays selectable as `Rules.edge: "stop"`, and the shell keeps `DEFAULT_RULES`
(`edge: "nearest"`). The stop rule exists so a screen can be compared against
#51's model, and so tests that lock the old walls stay meaningful; no screen
switches it on.

Rejected, with reasons: **always choosing the closest and ignoring the lined-up
band** (it would make a card directly below lose to a nearer diagonal, and every
vertical row-to-row move would drift sideways); **a separate function for the
new ranking** (one `nearest` with one rule switch keeps the two models honestly
comparable); **dropping `"stop"` once the new rule landed** (it is the evidence
that the reversal was deliberate, not an accident of arithmetic).

## 2. Across regions: keep the order, then search the level

The move still tries, in order:

1. the focused region's own controls;
2. a child region that overlaps the origin on the cross axis;
3. the rest of the level. `edge: "stop"` keeps #51's version of this step: only
   a sibling that overlaps the band the control sits in on the cross axis.
   `edge: "nearest"` replaces it with a whole-level search for the closest
   control on that side, direct-first then closest; it chooses that control's
   region and lands there with the existing covering/head rules.

The window's full-width strip is the one region that adds its own box to that
search beside its one control: the strip's box is a candidate (when it really
holds every control in the region), and the button remains one too. That is what
lets Up from a top-row card reach the strip at any horizontal position, including
a card whose right edge passes the strip's button (#125). Under `"stop"` the same
reach comes from the strip's band in the sibling step. The child-before-sibling
order is otherwise unchanged.

A control in a branch is a direct landing in that search, not only when the
branch holds the focused region: the Title's Back above its seasons, the Streams
branch's Back above its groups, and a sibling branch's own Back are all returned
as the control itself. `land` would otherwise descend into a child and return a
different control than the search chose.

The rail's vertical ends remain walls before the level-wide search: the six
destinations are a list, and Down on Settings must not fall into the content
beside it even when that content has a control below the rail item. A row's
horizontal end is a wall only when no control exists on that side (under
`edge: "nearest"`), or when the rule is `"stop"`. Up from the top of the content
still reaches the fixed chrome strip; a true edge with nothing anywhere on that
side still blocks.

Rejected, with reasons: **keeping the overlap guard as the only crossing** (that
is #51, and it is exactly what #128 overturns); **removing the child step and
always searching the level first** (a branch's Back must still lead into its
rows before an off-side sibling can win); **letting the level-wide search fill a
rail end** (the rail is a list with its own walls, not free geometry); **landing
on the raw nearest control instead of the chosen region's covering/head rules**
(it would duplicate the landing model and make dialogs unsafe again).

## 3. The trade-off this accepts

Right at the end of a short Home row can now land in the catalog row below.
That is the point: the next occupied control on the right is a real target, and
stopping at the row's own wall was the wall #128 removes. The move is still
bounded — it chooses the closest control, not an arbitrary one — and the row end
remains a wall when there is genuinely nothing on that side.

The same trade-off reaches the other screens without their own region walls
being redesigned: a Title's seasons and episodes, Streams groups, the OSD strip
and popovers, and Settings lists all move by the one ranking. The player's own
Up/Down ladder still answers before the engine sees the intent, and the OSD's
Left/Right remains the strip's geometry. The Remote's flat `nearest` is the same
direct-first/closest ranking over its active scope; it has no regions, so the
cross-region fallback is naturally absent there.

## 4. What #125's window and dialog kinds keep

The `window` and `dialog` region kinds remain scoped exactly as #125 settled
them. Under `edge: "stop"`, only the window's full-width box widens the
cross-axis band in the sibling step; under `"nearest"` that box is an extra
candidate in the level-wide search rather than a widened band. A dialog with
nothing under the origin still lands on its head rather than the nearest answer.
The dialog's safe head is a landing rule, not a crossing rule, so the level-wide
search does not bypass it: the strip's button still reaches the centred confirm
panel, and Up from the dialog's first answer still reaches the strip. Both halves
are pinned under each edge rule.

## 5. Tests and evidence

`src/focus.test.ts` pins direct-first, the closest fallback, the closest-distance
tie, the stop-vs-nearest distinction (including the stop rule's own ties), the
short-row and off-side crossings, the true wall, the rail end, the full-width
strip (including a card at the far right, a mid-row card where only the box
outranks the nearer rail item, and a box drawn tighter than its control), the
strip/dialog crossing under both edge rules, a row below the fold, a wrapped grid
with a hole, and the direct landing on an ancestor's or another branch's own
control. `src/shell/ShellFrame.test.tsx` renders the row-end crossing through the
real shell with stubbed rectangles, and `src/shell/remoteFocus.test.ts` lifts the
Remote page's own `nearest` out of the served template and asserts it matches
the window's, with an absolute answer for each direction.

The Windows walkthrough is deferred with the rest of the #126/#127/#128 batch.
`verify.ps1` step 27 asserted the crossing when #128 landed; since ADR-0036 the
same step asserts the wall (Right at the end of a short row holds), and the
crossing this section describes is pinned by `rowExit: "level"` in
`focus.test.ts`. The step's log also records both rail ends stopping; those are
check-log assertions, not screenshots. Up from the
top row to the strip is step 33's own screenshot. Down from a branch's Back into
an off-side child is not scripted; `focus.test.ts` covers it. The run itself is
the owner's, and was not performed as part of this change.

Rejected, with reasons: **adopting Norigin** (research #129: it replaces
measurement and keys, not this model, and cannot search the level for the
crossing); **a second focus implementation for the Remote** (the tested lifted
code keeps the two clients on one ranking).
