# The window's tests assert decisions, not markup

Ticket #151 (wayfinder map #143). The repertory redo (#145–#150) replaced the
client's visual language; #153–#160 replace the surface itself. This decides
what the window's tests are for while that happens, and afterwards.

The numbers behind the table: the window has 50 suites and 558 tests, and 216
assertions belong to the Velvet surface — 210 of them DOM. The per-suite
disposition lives on the ticket; this records the rule and the reasons.

## 1. A test asserts a decision, or the frozen boundary

The window is a client of the Host: it takes Actions and renders the Snapshots
it is sent (ADR-0002, ADR-0008). Its behaviour is therefore two things — the
pure decisions it makes (focus, input intents, the Level stack, which controls a
Snapshot allows, which rows a catalog produces) and the frozen contract at the
boundary (which Action leaves, which control takes focus, which Level is on the
stack).

So a test may assert what a decision function returns, or the contract at that
boundary. The DOM is a harness: render, find the thing to press, then assert the
Action, the Level or the focus. It is not the assertion target — no class names,
no element nesting, no CSS text, no matching the rendered sentence.

Rejected, with reasons: **re-pointing the structural suites at the new markup**
(the redo would carry 216 assertions about a drawing it is deleting, and every
later restyle pays for them again — the cost the redo exists to stop paying);
**markup-free purism** (then "Home is blank" and "Back dropped the Level" are
untested, and focus is the thing the map froze); **asserting copy by rendering
it** (a rule about which words a state chooses belongs in the module that
chooses them, where it can be read and changed without a DOM).

## 2. The old suites hold rules in the wrong place

Most of the DOM suites are not chrome. They are rules proven against markup: the
row cap, the empty state that says what to do, the inline refusal that does not
stop playback, the order a facts block prints, the Addon an unplayable Stream
came from. Those rules took review cycles to settle, and they are the reason a
mined suite is not simply deleted.

Each B-ticket mines the rule-shaped assertions of the suite it replaces: it
extracts the smallest module that holds the rule, writes the test against that
module, and the markup duplicate dies with the file. The extraction is per
screen. A single client-wide copy table is refused because the repertory voice is
deliberately per-surface (ADR-0030: a programme note is not a settings label),
and one table would make every screen's wording a shared dependency.

The Velvet suites themselves are frozen: green until #160 deletes them, edited
only when a shared seam changes underneath them. Nothing is deleted early,
because `VITE_UI=repertory` ships the old shell as the rollback until the
cutover, and a fallback nobody tests is not a rollback.

Rejected, with reasons: **delete as we go** (a shipped fallback with no tests
behind it); **one global copy module** (above); **porting assertion by
assertion** (it preserves the shape the rule rejects and doubles the work);
**a parity suite over both presentations** (the per-destination repertory suite
already proves the new shell, and a parity suite would mostly prove that two
components accept the same prop).

## 3. The gate before a screen's Velvet counterpart goes

A screen may lose its Velvet counterpart only when the repertory screen clears
the gate:

- the six destinations — Home, Discover, Search, Library, Addons, Settings —
  each mounts from a Snapshot, first focus lands, Back restores, and one failure
  or empty path is drawn;
- Title and Streams: facts and Play, Addon-grouped Streams with verbatim badges,
  filename, warnings and unplayable marks, and focus/back restored;
- the OSD's deep suite, re-pointed at the repertory OSD;
- one journey — Home → Title → Streams → play → OSD → Stop → Title, with focus
  restored where it was left;
- the Remote: `host-wire`'s wire suite plus a jsdom smoke over the spliced page;
- the two presentation locks of §4.

Why the OSD is deep and the destinations are not: the OSD is where the frozen
focus rules are densest — the ladder and its remembered stops, pad presses and
repeats, the idle window and what keeps it up, pending states, popover
dismissal — and none of that sits below a seam. The destinations' rules do sit
below seams (`navigation`, `reveal`, `homeStore`, `osd`, `controls`), so smoke
plus a failure path is their floor.

Rejected, with reasons: **the same floor everywhere** (it would delete the one
DOM suite that is behaviour); **deep suites everywhere** (the thing the redo is
trying to stop paying for); **a journey per surface** (three times the
maintenance for the same signal); **no journey at all** (nothing then proves the
seams compose into a client rather than six mounted screens).

## 4. Two presentation locks, and no others

CSS is read as text in exactly two places. The first is the repertory token
sheet's measured **contrast pairs** — not its hexes: ADR-0030 leaves the brass
provisional for one tuning pass after the Windows panel, so the lock is on what
a pair must clear (ivory, dim and muted at 4.5:1 on ink and raised; the hairline
at 3:1 as a non-text rule; brass legible on ink; and ivory off brass, where it
fails at 1.95:1). The second is the frameless chrome's band and its
`pointer-events`, because a band that drifts between the geometry and the sheet
stops the window moving or stops its button taking a click, and no smoke test
can see either.

Every other CSS assertion dies with Velvet.

Rejected, with reasons: **no CSS assertions at all** (a measured contrast pair
and a drag band are correctness, not taste); **CSS assertions per component**
(exactly the presentation lock this ADR removes); **reading the sheet through a
CSS parser instead of text** (a new dependency and a new failure mode to assert
two declarations).

## 5. The Remote's own suite

The Remote is a second client of the same Actions (ADR-0018), and its protocol
is already covered honestly by `host-wire`'s wire tests: pairing, push, revoke,
reconnection, version refusal, rate limiting. What a restyle can break in the
page is that it boots and that its transport is still there, so #159 adds a
jsdom smoke over the spliced template alongside those tests. The page's decision
logic is not extracted into tested modules in this effort.

Rejected, with reasons: **wire tests only** (a page that fails to boot before
the socket opens passes every wire test); **extracting the 6,297-line page into
tested modules** (the right end state, but a refactor riding on a design ticket,
and nothing in this effort needs it).

## 6. Where the rule lives

`docs/agents/testing.md` carries the mechanics: the per-suite dispositions, the
checklist a B-ticket follows, the gate, and how a new test is shaped. This ADR
carries the decision, its alternatives and its reasons. The ticket holds the
50-suite migration table as the record of what happened to each file.

Rejected, with reasons: **the ADR alone** (agents read the practical docs before
writing a test, not a decision record); **the ticket alone** (a closed issue is
not where a session looks); **both in one file** (a decision record and a working
checklist age differently).

## Consequences

- #153 sets the rule and rewrites the kit's suites; #154–#159 mine and rewrite
  their own screens as they land; #160 deletes the Velvet suites, the Velvet
  token sheet and the `VITE_UI` flag.
- After #160 the window's test count falls sharply: the 216 Velvet assertions
  become the gate's six destination suites, the journey, the kit's rewritten
  props contracts, and the OSD's deep suite.
- A future restyle costs tests only where it changes a rule; a change to a
  drawing costs nothing.
- The price is accepted explicitly: a design detail that was only ever proven by
  markup is now proven by the owner's eyes on the Windows walkthrough, or not at
  all.
- The `host-wire` page smoke is the one place a client's markup is asserted,
  because that client has no seams of its own.
