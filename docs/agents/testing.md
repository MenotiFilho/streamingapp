# Testing the window

What a test in `src/` may assert, and what a build ticket owes before a screen's
old surface is deleted. The decision and its reasons are ADR-0032; this is the
checklist to apply while working.

Rust is tested the usual way (`cargo test`, seams with in-memory fakes — see
`AGENTS.md`). This page is about the window's TypeScript and React suites.

## The rule

1. A test asserts a **decision of a pure module**, or a **frozen contract at the
   window's boundary**: which Action leaves, which control takes focus, which
   Level is on the stack.
2. The DOM is a **harness**, never the assertion target: render, find the thing
   to press, assert the Action / Level / focus. No class names, no element
   nesting, no CSS text, no matching rendered copy.
3. When a rule has no module, **extract the smallest one that holds it**, in the
   ticket that owns the screen. Per screen — never one client-wide copy table.
4. Copy is tested only where the copy *is* the rule (an empty state that says
   what to do, a refusal that names its cause), through the seam that chooses the
   words.
5. **No snapshot tests.** There are none in the tree, and the rule keeps it that
   way.
6. CSS is read as text in exactly two places (below). Nowhere else.

## What happens to a suite

| The suite | What to do |
| --- | --- |
| Pure decisions (`focus`, `input`, `controls`, `navigation`, `layout`, `reveal`, `osd`, `homeStore`, `program`, `settings`, `previewState`, the parsers) | Leave it. These are the tests the rule is named after. |
| Hooks that drive the window (`useFullscreen`, `useSpatialFocus`, `usePending`) | Leave it. The hook's contract is behaviour. |
| The repertory prototype's suites (`repertory/screens`, `logbook`, `player`) | Inherit as the baseline and extend to the gate. |
| The repertory kit (`repertory/kit/*`) | Built by #153: each primitive's props contract — focusable, disabled, paging, selection, pending — asserted without the drawing. The Velvet kit (`kit/*`) stays frozen with its suites until #160. |
| A Velvet screen (`Home`, `Title`, `Settings`, `Addons`, `Search`, `Discover`, `Shell`, `ShellFrame`, `Library`) | **Mine then freeze.** Read it for the rules it encodes, extract each into a module and test the module. Do not edit the file; it stays green until #160 deletes it. |
| `PlayerOverlay` | **Adapt deep** at #159: the OSD keeps its focus ladder, pad, idle window, pending states, refusals and popover dismissal, re-pointed at the repertory OSD. |
| `kit/tokens` (Velvet palette) | Dies with Velvet at #160; `repertory/tokens` carries the contrast lock. |

Frozen means frozen: the Velvet suites are edited only when a shared seam
(`navigation`, `reveal`, `homeStore`) changes underneath them. `VITE_UI=repertory`
ships the old shell as the rollback until the cutover, and a fallback nobody
tests is not a rollback.

## The gate

A screen's Velvet counterpart may only be deleted once all of this is true:

- **Six destinations** — Home, Discover, Search, Library, Addons, Settings: each
  mounts from a Snapshot, first focus lands, Back restores, and one failure or
  empty path is drawn.
- **Title and Streams**: facts and Play; Streams grouped by Addon with verbatim
  badges, filename, warnings and unplayable marks; focus and back restored.
- **The OSD**: the deep suite, re-pointed.
- **One journey**: Home → Title → Streams → play → OSD → Stop → Title, with
  focus restored where it was left.
- **The Remote**: `host-wire`'s wire suite, plus the page smoke below.
- **The two locks** below.

## The two presentation locks

- `src/shell/repertory/tokens.test.ts` — the palette's measured **contrast
  pairs**, not its hexes: ivory, dim and muted at 4.5:1 on ink and raised; the
  hairline at 3:1 as a non-text rule; brass legible on ink; and ivory off brass,
  where it fails at 1.95:1. The brass may be tuned once after the owner's
  Windows panel (ADR-0030), and a hex change that keeps the pairs passes.
- The frameless chrome's band and `pointer-events`, asserted against the
  repertory sheet: the strip's band is the band the D-pad geometry measures, and
  the strip leaves the pointer to its button. A drift here is a window that will
  not move or a button that will not click.

Both read CSS as text. If you find yourself adding a third, the assertion
probably belongs on a decision instead.

## The served Remote

`crates/host-wire/remote/index.html` is one page with no seams of its own, so it
is the one client whose markup gets asserted. `host-wire`'s wire tests cover the
protocol (pairing, push, revoke, reconnection, version refusal, rate limiting);
#159 adds a jsdom smoke over the spliced template: the page parses, it boots, and
the transport is where it should be. The page's decision logic is not extracted
into tested modules in this effort (ADR-0032 §5).

## Writing a test

Name the behaviour in the title, as the existing suites do, and drive it from
the smallest thing that decides it:

```ts
// Good: the seam decides, the test asks it.
expect(decideMove(layout, focus, "left")).toMatchObject({
  kind: "crossed",
  regionId: "rail",
});

// Good: the DOM is the harness; the assertion is the contract.
// (`actions()` in Shell.test.tsx reads the Actions a fake Host was sent.)
render(<Shell client={client} />);
await press("Escape");
expect(actions(host.invocations)).toContainEqual({ type: "stop_playback" });

// Not: an assertion about the drawing.
expect(screen.getByRole("listitem")).toHaveClass("poster-card--focused");
```

A rule that only exists inside JSX is a rule waiting to be deleted with the
markup. Extract it first, then test it.
