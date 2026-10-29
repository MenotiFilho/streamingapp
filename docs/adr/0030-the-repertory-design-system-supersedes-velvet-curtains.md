# The repertory design system supersedes Velvet Curtains

Ticket #150 (wayfinder map #143). Five prototypes (#145–#149) established the
direction. This records the replacement, not the values: the living record is
`docs/design-system.md`, and the values are `src/shell/repertory/tokens.css`.

## 1. One client language, and it is the repertory's

The client's visual language is **Repertory**: ink-black canvas, warm ivory ink,
one brass house colour, a display serif for names, a grotesk for the interface,
mono for bookkeeping, hairlines instead of cards, posters unframed, focus as a
single ivory keyline and a spotlight wash. It replaces **Velvet Curtains** — the
obsidian/smoked-glass palette, Syne/Plus Jakarta Sans, crimson accent and dual
focus halos shipped by #71/#77.

Velvet Curtains is not a base to inherit from. No Velvet token is carried over as
an alias, no Velvet font ships, and no Velvet component ships unchanged: the
kit's controls are re-dressed in repertory clothes until #153 replaces the kit,
and the cutover (#160) deletes the Velvet sheet rather than mapping its names
onto the new ones. (The status red keeps its hex `#ff4d4d` because the new
palette chose that red on its own measured pair; that is a value coincidence,
not an inheritance.) The two systems coexist while the window's
`VITE_UI=repertory` flag and the Remote's `?ui=repertory` bridge stage them, and
that coexistence is a rollback, not a supported pair of themes.

Rejected, with reasons: **keeping both systems behind a setting** (two visual
languages for one room, and a permanent second palette to keep measured);
**preserving Velvet tokens as aliases** (aliases carry the old decisions — the
crimson accent, the radii, the lift — into a system that deliberately refuses
them, and no one can then delete either); **a gradual restyle of the Velvet
shell** (the direction changes the frame, the card anatomy and the type
families at once; a screen-by-screen repaint would leave the client speaking two
languages for the length of the map).

## 2. The record is a document; the values are one sheet

`docs/design-system.md` is the living design record: palette and measured pairs,
type families and roles, the two scales, space and rules, the focus mark,
motion, the icon set, the component anatomy, the artwork chain and marks, the
copy voice, and what is provisional. A build ticket reads it before drawing a
screen; a change to the system edits it in the same pull request as the sheet.

The record holds no behaviour. Every Action, Snapshot, focus rule, level-stack
rule and Remote flow stays where `CONTEXT.md` and the ADRs put it; the design
system only decides how those are drawn.

Rejected, with reasons: **only an ADR** (a decision record is a snapshot of a
choice, not a reference for thirty components); **only the token sheet** (values
without the rules — when brass may fill, what a missing backdrop becomes, where
the cinema voice stops — leave each ticket to invent them); **a second spec
issue** (the spec that produced Velvet is exactly the artifact that aged worst).

## 3. One sheet, two named scales, carried to both clients

`src/shell/repertory/tokens.css` is the one declaration of the palette, the
families, the ten-foot scale, the hand scale, spacing, motion and focus. The
window imports it; `crates/host-wire` splices the same file into the served
Remote page, and the served page also receives the same font files and the same
icon sprite. One source per fact, for both clients — the Velvet sheet lives
beside it only until the cutover deletes it.

The ten-foot scale is proportional to the **shorter** side of the window
(`min(1vw, 1.7778vh)`) with a rem floor and no rem ceiling, so a 4K window at
100% scaling does not halve the physical type and a wide, shallow window does
not inflate it. The hand scale is a second named set of the same roles for a
phone held at arm's length; it is not a second palette and not a second sheet.

Rejected, with reasons: **a rem-capped scale** (the 4K-at-100% trap measured in
research #144); **two sheets** (a palette can then drift between clients);
**viewport width alone** (a short or ultrawide window inflates the type); **a
viewing-distance preference** (new Host state and a new Action, which the map
freezes, to solve what the stage unit already solves).

## 4. Rollout: staged behind a flag, cut over once

The repertory surface is staged, not switched: the window keeps the Velvet shell
usable behind `VITE_UI=repertory`, the served page keeps `/` and adds its own
selector, and the cutover is one change that deletes the old surface and the
flags once the six destinations, Title/Streams, the OSD and the Remote are
drawn.

Rejected, with reasons: **a big-bang change to `main`** (the window keeps a
working surface while the prototypes and the build tickets land, and the flag is
the rollback); **preserving the Velvet tests as presentation coverage** (they
assert the surface being deleted, and the new drawing gets its own suite — the
behaviour suites survive, the migration is #151); **shipping the Remote's
restyle after the window's** (the two clients would speak two languages for the
length of a release, and the token splice already carries both).

## Consequences

- The repertory tokens and kit are rebuilt behind the flag (#153); the browse
  screens, the OSD and the Remote are drawn against the record
  (#154–#159); the cutover (#160) deletes the Velvet sheet, its kit, the
  `VITE_UI` flag and the Velvet-only presentation tests.
- `docs/design-system.md` is the reference for every client screen and for the
  served Remote; this ADR records why Velvet Curtains is gone.
- `src/shell/repertory/tokens.css` is the single token source for the repertory
  surface; the Velvet `src/tokens.css` and its `src/shell/kit/tokens.test.ts` are
  deleted at cutover, and `src/shell/repertory/tokens.test.ts` guards the new
  palette's measured pairs.
- The served Remote receives the token sheet, the icon sprite and the font
  files from `host-wire`; a phone that lacks the faces falls back rather than
  seeing a different design.
- #152 decides how the served page is staged; #159 carries the hand scale's one
  tuning pass; the owner's Windows walkthrough may correct the brass once.
- The Velvet spec (#71) and its token ticket (#77) stay closed as history; they
  are superseded, not amended.
