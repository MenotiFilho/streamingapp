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

## Where the suites live

| The suite | What it asks |
| --- | --- |
| Pure decisions (`src/core/*.test.ts`; the window's `focus`, `layout`, `reveal`, `episodesMenu`, `refusals` and `rehearsal/` suites) | The rule is named after these. A new rule lands here. |
| Hooks that drive the window (`useFullscreen`, `useSpatialFocus`) and the core's React bindings | The hook's contract is behaviour. |
| The window's screens (`src/window/marquee/*.test.tsx`) | A screen drawn from a Snapshot: the Action at the boundary, where focus lands and returns, the Level on the stack, one failure or empty path. |
| The journey (`src/window/marquee/journey.test.tsx`) | Home → Title → Streams → play → OSD → Stop → Title over a fake Host, and each destination's way to a Title. |
| The player (`src/window/marquee/MarqueePlayer.test.tsx`) | The deep suite: the OSD's focus ladder, pad, idle window, pending states, refusals, panels, Autoplay and the docked transport. |
| The kit (`src/kit/**/*.test.{ts,tsx}`) | Each primitive's props contract — focusable, disabled, selection, pending — asserted without the drawing. |

## The gate

A surface may only be deleted once all of this is true of its replacement. The
cutover to Marquee (#365) cleared it, and a later redesign clears it again:

- **Six destinations** — Home, Discover, Search, Library, Addons, Settings: each
  mounts from a Snapshot, first focus lands, Back restores, and one failure or
  empty path is drawn.
- **Title and Streams**: facts and Play; Streams grouped by Addon with verbatim
  badges, filename, warnings and unplayable marks; focus and back restored.
- **The OSD**: the deep suite, re-pointed.
- **One journey**: Home → Title → Streams → play → OSD → Stop → Title, with
  focus restored where it was left.
- **The Remote**: `host-wire`'s wire suite, plus the Remote's component suites
  below.
- **The two locks** below.

## The two presentation locks

- `src/kit/tokens.test.ts` — the palette's measured **contrast pairs**
  (`docs/design-system.md` §2): every pair listed there at 4.5:1 or better, and
  white kept off lavender and the IMDb yellow. It reads the sheets of the kit and
  of both clients, so lavender is declared once, in `--mq-accent`, and it holds
  the reference-frame unit, the radii, the focus scales and the motion
  vocabulary. The accent may be tuned once after the owner's Windows panel (§12
  of the record); a change that keeps the pairs and is written back to the record
  passes.
- The frameless chrome's band and `pointer-events`, asserted against
  `src/window/marquee/marquee.css` in `MarqueeFrame.test.tsx`: the strip's band
  is the band the D-pad geometry measures, and the strip leaves the pointer to
  its button. A drift here is a window that will not move or a button that will
  not click.

Both read CSS as text. If you find yourself adding a third, the assertion
probably belongs on a decision instead.

## The served Remote

The served Remote is `src/remote`, a client of `src/core` built into
`crates/host-wire/remote/` by `pnpm build:remote` (ADR-0035 §1, §3). Its
decisions live in the shared core and are tested there; its screens are the
component suites beside them (`src/remote/*.test.tsx`), which drive a screen
from a fake `HostLink` and assert the Action at the boundary, the first mount
and one empty or failure path — never markup. The pairing gate, the browser
history and the socket and device-token storage have their own module suites.
`host-wire`'s wire suite covers the protocol (pairing, push, revoke,
reconnection, version refusal, rate limiting) and the served routes; the
artifact's capability list, `build-info.json`, is compared to
`Action::SPELLINGS` and `ACTION_VERSION` by a Rust test, so a capability added
on one side cannot pass.

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
// (`actions()` in MarqueePlayer.test.tsx reads the Actions a fake Host was sent.)
render(<MarqueeEntry client={host.client} />);
fireEvent.keyDown(document, { key: "Escape" });
await waitFor(() =>
  expect(actions(host.invocations)).toContainEqual({ type: "stop_playback" }),
);

// Not: an assertion about the drawing.
expect(screen.getByRole("listitem")).toHaveClass("poster-card--focused");
```

A rule that only exists inside JSX is a rule waiting to be deleted with the
markup. Extract it first, then test it.
