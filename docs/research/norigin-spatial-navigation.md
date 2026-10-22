# Norigin spatial navigation against the window's custom focus model — research spike

**Date of research:** 2026-10-22. Every npm, GitHub, documentation and source
read below was done on this date.
**Question (issue [#129](https://github.com/MenotiFilho/streamingapp/issues/129)).**
Could `@noriginmedia/norigin-spatial-navigation` replace the custom window focus
model without losing the level stack, per-level memory/rehome, the player OSD
ladder, gamepad intents, the new direct-first/closest and cross-region rules, or
Remote parity — and at what code/test cost?

**Read with** `CONTEXT.md` (*Row*, *Title*, *Stream*, *Remote client*, *Host*),
ADR-0002 (one Action surface), ADR-0017 (pairing and the one-socket wire) and
ADR-0018 (the Remote client is the window's equal).

**Scope.** This is a spike, not a migration. The experiment is preserved in
`docs/research/norigin-spike/` — source, tests, configuration, the bundle entries
and a README with the exact reproduction commands — so the evidence survives
`/tmp`. No package, lockfile or production file was changed. The repository's
model is read as it stands at `e3b9cc6` (2026-10-21), so #127's 24 px reveal and
#128's direct-first/closest rule are read from their issues, not from implemented
code.

**Verdict up front:** **keep the custom model; reject Norigin as a replacement
for this window.** Norigin would replace measurement and registration, not the
behaviours that matter here; §7 prices the migration and §9 states the
recommendation.

---

## 1. What the custom model owns today

The model is deliberately pure: `src/focus.ts` takes measured rectangles and
returns a decision; `src/shell/layout.ts` measures the DOM into it;
`src/shell/useSpatialFocus.ts` supplies the level lifetime, input and painting.
The behaviours are not incidental — each one has a test or a screen that depends
on it.

| Behaviour | Where it lives | What it does |
|---|---|---|
| Geometry inside a region | `src/focus.ts:166-198` (`nearest`) | Lined-up candidates first within `ALIGNED = 1`, then the smallest sideways gap, the shortest step past `MIN_STEP = 1`, then the closest centre. |
| Child descent before siblings | `src/focus.ts:451-465`, `:255-263` | A branch's own Back leads into the child row tracks below it; a child that is off to the side is not entered. |
| Cross-region guard | `src/focus.ts:200-253`, `:467-487` | Focus crosses only to a sibling region strictly in the direction that overlaps the origin on the cross axis (`gap <= ALIGNED`), which is what stops a short row track leaking diagonally into a wider row track. |
| Entering a region | `src/focus.ts:285-380` (`widerThan`, `covering`, `enter`) | Lands on the card under the origin's middle; the head when the origin is wider than the target; nearest; then memory; then 0. |
| Walls | `src/focus.ts:489-547` | Row-track ends and rail ends stop; Up from the top of content goes nowhere under `DEFAULT_RULES`. The unused `Rules` switches exist only for comparison. |
| Rehome | `src/focus.ts:555-594` | A disappeared control steps back to the control before the gap, clamped; an emptied region falls back to the rail's memory. |
| Level stack | `src/shell/ShellFrame.tsx:53-66`, `:107-124`; `src/shell/navigation.ts` | The top level owns focus; the base and lower levels stay mounted and `inert`; a push paints over the level below without unmounting it; Back pops the top. |
| Per-level memory | `src/shell/useSpatialFocus.ts:53-88` | `levelKey` is `base:<destination>` or `level:<id>`; each level holds region memory and the exact focused element. Popping a level restores the exact control underneath. |
| Ensure / recovery | `src/shell/useSpatialFocus.ts:90-139`, `:203-257` | Always something focused on top; a removed control is re-homed; a `focusout` that leaves the level is repaired in a microtask. |
| Player OSD ladder | `src/shell/PlayerOverlay.tsx:51-59`, `:179-215`, `:308-352` | The picture → strip → top ladder overrides row-track geometry; the strip and top remember their own control; a hidden OSD wakes on input and lands on the pending stop. |
| Gamepad | `src/shell/useGamepad.ts:6-85`; `src/input.ts:49-70`, `:136-163` | Standard-mapping buttons and left stick, first press plus 400/160 ms repeat; X/Y are volume. |
| Keyboard / typing | `src/input.ts:32-40`, `:83-130` | Arrows, Escape/Backspace/GoBack; Left/Right/Backspace belong to a text field; Enter/Space are left to the control's native activation. |
| Reveal | `src/shell/useSpatialFocus.ts:67-70` | `focus({ preventScroll: true })` then `scrollIntoView({ block: "nearest", inline: "nearest" })`. #127 will replace this with a 24 px margin walk over scrollable ancestors. |
| Measurement | `src/shell/layout.ts:94-146` | `data-region` / `data-focusable`, DOM order, prune empty regions, mark `data-measuring` so the lift transform is not measured. |
| Remote client mirror | `crates/host-wire/remote/index.html:1137-1259` | A flat `nearest` over the active scope, plus `data-focus-key` restoration for level return focus. No regions, no gamepad, no pad column. |

**Size of the model being weighed.**

| Measure | Count | Files |
|---|---|---|
| Engine production lines | **1,295** | `focus.ts` 594, `layout.ts` 168, `useSpatialFocus.ts` 283, `input.ts` 164, `useGamepad.ts` 86 |
| Focus-related tests | **62** | `focus.test.ts` 23, `input.test.ts` 17, `layout.test.ts` 8, `ShellFrame.test.tsx` 6, the player ladder 4 and pad 4 in `PlayerOverlay.test.tsx` |
| Focus-related test lines | **1,275** | 452 + 170 + 187 + 155 + 143 (ladder) + 168 (pad) |
| Production `data-focusable` sites | **24** in **15** files | the five kit components, the rail and every screen; most sites are loops over cards, Streams, episodes or devices |
| Production `data-region` declarations | **32** in **11** files | rail, screen, row regions, branches, player/OSD/volume |
| Level surfaces the shell builds | **8** | base (six destinations), Title, Streams, Settings category, confirm, episodes, OSD popover, player |
| Whole window test suite | **391 tests / 33 files** | `pnpm test`, 2026-10-22 |

The site counts are production `.tsx` occurrences: tests, `kit.css` and the
`layout.ts` selector are excluded, so a raw `grep` over `src` reports more
(64 `data-focusable` occurrences across 25 files). The player-ladder section of
`PlayerOverlay.test.tsx` is 4 tests and 143 lines; the pad section is 4 tests and
168 lines; the 311-line figure in the line total is both.

The point of the counts is not that 1,295 lines is small; it is that the lines
are the *decision*, not glue. Norigin offers no equivalent of most of the
entries above, so a migration cannot delete them.

---

## 2. What Norigin actually is, at exact versions

### 2.1 Packages and dates

| Package | Version | Published | Role | Unpacked |
|---|---|---|---|---|
| `@noriginmedia/norigin-spatial-navigation` | **3.3.0** | 2026-07-30 | combined/legacy wrapper; re-exports core + react | 5,687 B / 5 files |
| `@noriginmedia/norigin-spatial-navigation-react` | **3.3.0** | 2026-07-30 | React hooks (`useFocusable`, `FocusContext`) | 17,528 B / 7 files |
| `@noriginmedia/norigin-spatial-navigation-core` | **4.1.2** | 2026-09-25 | singleton engine, key handling, layout adapters | 191,575 B / 17 files |

Sources: npm registry metadata for each package (`npm view … --json`, read
2026-10-22), GitHub release
[`@noriginmedia/norigin-spatial-navigation-core@4.1.2`](https://github.com/NoriginMedia/Norigin-Spatial-Navigation/releases/tag/@noriginmedia/norigin-spatial-navigation-core@4.1.2)
published 2026-09-25T11:22:53Z, and release commit
`f34e75f850d6d89bb5ddfb405b69c481f8e600d0` (2026-09-25T11:22:10Z). The repository
is **MIT**, not archived, default branch `main`, 491 stars at the time of
reading. The active hooks package is the `-react` package; the docs' package
table calls the combined package "Legacy combined package — upgrading from
v1/v2"
([Norigin docs, Packages](https://devportal.noriginmedia.com/docs/Norigin-Spatial-Navigation/)).
The combined package re-exports the `-react` and `-core` pair at the same
versions. The `Unpacked` column is npm's `dist.unpackedSize` — package bytes, not
a runtime bundle size.

### 2.2 API surface relied on

Read from the published `.d.ts` files and the source at the release commit:

- `UseFocusableConfig<P>` / `UseFocusableResult<E>` from
  `@noriginmedia/norigin-spatial-navigation-react` — `focusKey`, `focusable`,
  `saveLastFocusedChild`, `preferredChildFocusKey`, `trackChildren`,
  `autoRestoreFocus`, `isFocusBoundary`, `focusBoundaryDirections`,
  `nextFocusResolver`, `measureChildrenLayout`, `onEnterPress`,
  `onArrowPress`, `onFocus`, `onBlur`, `accessibilityLabel`; result
  `ref`, `focusSelf`, `focused`, `hasFocusedChild`, `focusKey`.
- `NextFocusResolver = (direction: Direction, focusKey: string,
  siblings: FocusableComponent[]) => FocusableComponent | null`.
- `FocusableComponent` — the object the resolver receives; carries `focusKey`,
  `parentFocusKey`, `layout`, `focusable`, `preferredChildFocusKey`,
  `lastFocusedChildKey`, callbacks, etc.
- `FocusableComponentLayout` — `left`, `top`, `right`, `bottom`, `width`,
  `height`, `x`, `y`, `node`.
- `LayoutAdapter` — `addEventListeners`, `removeEventListeners`,
  `measureLayout`, `blurNode`, `focusNode`.
- `SpatialNavigationServiceOptions` — `debug`, `visualDebug`, `throttle`,
  `throttleKeypresses`, `useGetBoundingClientRect`, `layoutAdapter`,
  `shouldFocusDOMNode`, `domNodeFocusOptions`, `shouldUseNativeEvents`, `rtl`,
  `distanceCalculationMethod`, `customDistanceCalculationFunction`,
  `onUtterText`, `focusOnPresetKey`.
- `DistanceCalculationFunction` / `Corners` — **the `.d.ts` defines
  `Corners` as `{ a: {x,y}; b: {x,y} }`**, while the public docs example uses
  `nearPlumbLinePoint` / `nearStraightLinePoint`. The `.d.ts` is the one the
  compiler accepts; the docs example is stale. This is a small but real
  documentation risk for a migration.

The source is at
[`packages/core/src/SpatialNavigation.ts`](https://github.com/NoriginMedia/Norigin-Spatial-Navigation/blob/f34e75f850d6d89bb5ddfb405b69c481f8e600d0/packages/core/src/SpatialNavigation.ts)
and
[`packages/react/src/useFocusable.ts`](https://github.com/NoriginMedia/Norigin-Spatial-Navigation/blob/f34e75f850d6d89bb5ddfb405b69c481f8e600d0/packages/react/src/useFocusable.ts).

### 2.3 What it provides

- A tree of focusable components linked by React context (`FocusContext`),
  with auto-generated or supplied stable `focusKey`s.
- A default coordinate algorithm: candidate cutoff, adjacent-slice detection
  (20 % overlap), weighted score
  `(primary × 5 + secondary + 1) / (adjacent ? 5 : 1)`, `distanceCalculationMethod`
  of `corners`, `edges` or `center`.
- Container memory (`saveLastFocusedChild`, default true), a preferred child,
  focus boundaries, `setFocus`, `navigateByDirection`, `focusSelf`,
  `getCurrentFocusKey`, `doesFocusableExist`, `updateAllLayouts`, `pause` /
  `resume`.
- A key listener for arrows and Enter only, remappable through `setKeyMap`.
- Layout adapters: default `offsetLeft/Top` (fast, ignores transforms),
  `GetBoundingClientRectAdapter` (viewport, includes transforms), or a custom
  adapter.
- `shouldFocusDOMNode` + `domNodeFocusOptions` for native focus and
  `preventScroll`.
- `accessibilityLabel` + `onUtterText` (a callback, not ARIA), `trackChildren`
  for `hasFocusedChild`, debug overlay, throttling.
- No level stack, no Back, no region/wall model, no gamepad polling, no
  scroll-into-view, no resize/fullscreen listener, no Remote client import path.

---

## 3. The spike

### 3.1 What was built

`docs/research/norigin-spike/` (preserved from `/tmp/norigin-spike`): a 399-line
React slice plus a 305-line test file, **14 passing tests**, React 19.3.1,
`@noriginmedia/norigin-spatial-navigation-react` 3.3.0, core 4.1.2, jsdom 30.1.2,
Vitest 5.0.4. The library was initialised with `shouldFocusDOMNode: true`,
`domNodeFocusOptions: { preventScroll: true }`, `focusOnPresetKey: false`, and a
custom `LayoutAdapter` that reads the same rectangles the test writes (jsdom has
no layout). The adapter returns the full `left/top/right/bottom/width/height`
shape; returning only `x/y/w/h` silently produces zero-size layouts and no
navigation — a useful reminder that the library's layout contract is not the
app's `Rect`. The folder's README carries the exact install, test, coverage and
bundle commands.

The slice contains:

- base shell with a six-item rail and two row tracks (Continue watching,
  catalog);
- a pushed Title level with its own Back-focusable Play/Episode controls;
- a popover level over the player;
- the player's picture / strip / top ladder;
- a dynamic row track that can insert at the head and remove the focused item;
- a text field beside a Go control;
- the #128 rule attempted as the default plus three mechanisms:
  `nextFocusResolver`, `onArrowPress` + `setFocus`, and
  `customDistanceCalculationFunction`.

### 3.2 What the 14 tests showed

| Spike test | Result |
|---|---|
| Move inside a row track, Down into the row track below, Left into the rail | **Works** for movement inside the track and rail crossing. Down from `continue:1` landed on `catalog:0`, not the card under the origin's middle (`catalog:1`); the library has no `covering` rule. |
| Short row track's end stays put | **Works** by default: no candidate to the right, so it stops. This is the old #51 wall, not #128. |
| #128 default (same test as the short row track) | **Blocked** at the end of the short row track; the library does not search the whole level. In the flat-parent test its weighted score preferred the closer diagonal over the aligned control 400 px away: it is not direct-first. |
| Push a Title level, pop it, restore the exact control | **Works only with glue**: a `focusKey` per level, `isFocusBoundary` on the level root, `autoRestoreFocus: false` on the level root, an effect that calls `setFocus` after the level mounts, and a saved `getCurrentFocusKey()` before the push. Without the effect the `setFocus` runs before the level exists and does nothing. |
| Popover over the player returns to the picture | **Works with the same glue.** |
| Player ladder picture → strip → top → strip → picture | **Works** with a `nextFocusResolver` on the player root that maps the stop to its child container. The ladder table itself is still the app's. |
| Hidden OSD | **Fails**: Up from the picture does nothing; there is no strip mounted. The app's wake + `pendingStop` render is still required. |
| Insert at the head of a dynamic row track | **Works** with stable keys: focus stays on `b`, Right moves to `c`. |
| Remove the focused control | **Fails the model**: removing `c` landed on `a` (first item); the app's `rehome` would land on `b` (the control before the gap). |
| Escape / Backspace / GoBack | **No-ops**: the default key map is arrows + Enter only. The app's `back` intent is still custom. |
| Left/Right in a text field | **Navigates out** of the field to the next control. The app's `isTypingTarget` / `keyIntent` exception is still required. |
| `preventScroll` and the reveal | **Partial**: `focus()` is called with `{ preventScroll: true }`; nothing calls `scrollIntoView`. The 24 px reveal is still custom. |
| #128 via `nextFocusResolver` | **Cannot pick a grandchild**: a resolver on `screen` can return the catalog *row region*, but that region then restores its own last child (`catalog:5`), not the closest card (`catalog:1`). |
| #128 via `onArrowPress` | **Works**, but only because the leaf's handler calls `setFocus('catalog:1')` directly and returns `false`. That is the app's decision code moved into a per-control callback, not a library feature. |
| Custom distance | **Can encode direct-first inside one parent; cannot search another region.** With the default engine, the closer diagonal beat the aligned control 400 px away (its weighted score, not direct-first). A custom function returning 0 for an overlapping sibling and a prohibitive cost otherwise made the aligned control win — so the seam can express the rule, but the app has to reimplement it from corners, with no focus key and no candidate set of its own. From the end of a short row track the callback was never shown `catalog:1`: the engine enumerates the current parent's siblings behind a direction cutoff, then climbs (`SpatialNavigation.ts:1149`, `:1217-1245`, `:1304`), not the whole level. The seam is `:518-587`; the score it feeds is `:644-651`. |

The experiment's raw numbers:

- source: **399 lines**, test: **305 lines**, **14 tests** for one representative
  slice; **+704 / −0** lines in **2 authored files** (the preserved folder also
  carries configuration, bundle entries and the README);
- `tsc --noEmit` clean, `vitest run` 14/14 passing in about 2 s;
- coverage on `spike.tsx` (v8, `@vitest/coverage-v8` 5.0.4): **96.92 % lines
  (63/65)**, 94.44 % statements (68/72), 84.00 % branches (42/50), 90.90 %
  functions (30/33); the uncovered lines are 326 and 373;
- **ease:** low for the base/rail/row-track slice (one file, no production imports);
  moderate per level (a mount effect, a saved key, boundary flags and
  `autoRestoreFocus: false`); high for #128's cross-region half, which needs app
  code outside the library. Testing was easy: 14 tests, 96.9 % line coverage,
  about 2 s;
- no production file, package.json or lockfile touched.

---

## 4. Behaviour-by-behaviour comparison

Legend: **●** the library does it; **◐** possible with glue or a custom
callback; **○** the library has no such concept.

| Behaviour the window owns | Custom model | Norigin | Verdict |
|---|---|---|---|
| Rail / row tracks / same-region geometry | `nearest` | default algorithm | ● broadly, but ranking differs (adjacent slice 20 %, primary weight) |
| Land under the origin's middle (`covering`) | yes | no: last child, preferred, else closest-to-origin | ○ |
| Head when origin is wider (`widerThan`) | yes | no | ○ |
| Sibling overlap guard | yes (`gap <= 1`) | no region concept; climbs parents and uses 20 % adjacent slice | ○ / different |
| Descend into a branch's children before siblings | yes | parent/child tree does this, but with the library's own entry rules | ◐ |
| Row-track / rail walls | yes (configurable rules) | `isFocusBoundary` on containers can build walls, but direction-by-direction and not the model's row-track/rail split | ◐ |
| Rehome to the previous control | yes | `autoRestoreFocus` after 300 ms focuses the parent, then last/preferred/closest-to-origin | ○ |
| Level stack / Back | yes (`ShellFrame`, `navigation`) | none; a saved-key `setFocus` history is app glue | ○ |
| Per-level memory / exact element restore | yes | `saveLastFocusedChild` per container; exact key restore only if the key is stable and mounted | ◐ |
| Player OSD ladder | yes (`LADDER`) | a resolver can route the visible stops; the table and the hidden-OSD wake are app code | ◐ |
| OSD idle / pinning / pending stop | yes | none | ○ |
| Gamepad polling + repeat | yes | none (only DOM key events) | ○ |
| Keyboard table / Back keys / typing protection | yes | arrows + Enter only; no typing exception | ○ |
| #128 direct-first / closest anywhere | specified, pending | default is a weighted score, not direct-first; in the spike's flat parent the closer diagonal won. Resolver sees direct children only; `onArrowPress` can jump per leaf; custom distance re-ranks siblings but cannot enumerate another region | ○ |
| Cross-region closest | specified, pending | no whole-level search | ○ |
| `preventScroll` | yes | `domNodeFocusOptions` | ● |
| 24 px reveal | #127 pending | none; no `scrollIntoView` in the source | ○ |
| Resize / fullscreen remeasure | measured per move | no listener; `updateAllLayouts()` is manual | ◐ |
| Accessible labels | native buttons/aria, no announcements | `accessibilityLabel` + `onUtterText`; no ARIA generated | ◐ |
| Remote client parity | hand-written mirror | cannot import into the compiled page | ○ |

**What the library would replace:** the flat tree/registration, focus keys,
focus state (`focused` / `hasFocusedChild`), default sibling geometry,
boundaries, `setFocus`/`navigateByDirection`, layout adapters, and the key
listener if the app lets it own the keys. That is a useful layer. It is not the
layer where this app's complexity sits.

---

## 5. Focus-key churn for dynamic row tracks, Streams and episodes

The custom model has **no per-control keys**: a control is identified by
`regionId` plus its DOM index (`src/focus.ts:75`), and the level's memory stores
the exact element (`src/shell/useSpatialFocus.ts:14`, `:72-76`). Norigin
requires a **globally unique `focusKey` per registered control** and stores
components in a flat map (`SpatialNavigation.ts:1495`); a duplicate key
overwrites the earlier component. This is the largest hidden migration cost.

| Site | Stable id available? | Key that would be needed | Churn |
|---|---|---|---|
| Home catalog cards | `meta.id` | `home:<catalogKey>:<meta.id>` | The same Title can appear in two row tracks; a row-track prefix is mandatory. A Title id is stable across paging. |
| Continue watching | `video.id` | `home:continue:<type>/<video.id>` | Stable; but the same video can also be in a Title's episode row track while both the base and the Title level are mounted. |
| Title episodes | `video.id` | `title:<titleId>:episode:<video.id>` | Stable within a Title; a level prefix is needed to avoid colliding with Continue watching. |
| Seasons | `season` | `title:<titleId>:season:<season>` | Stable; `null` season needs a sentinel. |
| Streams | **no id** | `streams:<addon>:<stable hash or index>` | `Stream` carries no id. The obvious `addon + index` (`remote` already does this) points at a different Stream when the Addon reorders or the list is refreshed. A URL hash is possible but the URL can carry a debrid session (CONTEXT: Now playing "never where its bytes are"), so a raw URL must not become a DOM `data-*` key. |
| Settings devices | device id | `settings:devices:<id>` | Stable. |
| Settings languages / genres / chips | tag / id | prefixes | Stable; needs a key builder. |
| Popover controls | fixed names | `popover:<name>:<control>` | Stable. |
| Player controls | fixed names | `player:<stop>:<control>` | Stable. |

Consequences:

1. **Every dynamic list needs a key builder.** The focusable sites counted in §1
   show the scale. This is not one string per card; it is a new key convention per
   screen, plus a rule that it is globally unique across *all mounted levels*,
   not just the visible one.
2. **The base and a pushed Title level are both mounted.** A top-level prefix
   (`base:`, `level:title:<id>:`, `player:`) is mandatory, or the same
   `video.id` / `meta.id` in two levels silently steals focus from the other.
3. **Streams are the worst case.** The current model happily focuses Stream
   index 4 of Addon X. Norigin needs a key that is stable across reorder and
   does not expose the URL; an index key churns, and a URL key leaks a secret.
4. **Removal semantics change.** With keys, the library's removal path clears
   the parent's `lastFocusedChildKey` and restores to the first/preferred child
   after 300 ms; the app's `rehome` (`focus.index - 1`) must be rebuilt as a
   custom removal history if exact behaviour is required.
5. **The Remote client already uses keys** (`data-focus-key`, `:1240-1252`), but
   it is a flat page with one active scope; its key convention is not a global
   tree and cannot be reused for the window without the level prefixes above.

---

## 6. Dependency and bundle cost

Measured with `esbuild 0.28.2 --bundle --minify --format=esm --external:react`
and `gzip -9n`; the entry files and exact commands are in the spike README. This
is a reasonable lower bound for the Vite/Rollup production shape but is not the
app's own build:

| Import | Minified | Gzip |
|---|---|---|
| `@noriginmedia/norigin-spatial-navigation-core` only | **53,217 B** | **17,081 B** |
| core + the hooks the slice imports | **55,561 B** | **17,844 B** |
| react hooks only (deduped core) | 2,344 B extra | 763 B extra |
| empty React external baseline | 69 B | 83 B |

The core package declares `lodash-es@^4.17.21`; tree-shaking removes some of it
but the measured bundle still contains the used lodash helpers. The library is
MIT and has no runtime dependency beyond `lodash-es` and React (peer
`react >=16.8.0`). The combined package is only a **5.7 KB unpacked re-export**
(npm `dist.unpackedSize`, 5 files), not a runtime size; the real cost is the
core's 53 KB minified.

For comparison, the app's current runtime dependencies are React, React DOM,
the Tauri API and two font packages (`package.json`). Adding Norigin adds a
second general-purpose utility dependency (`lodash-es`) and **17.8 KB gzip** to
the window bundle. That is not fatal for a desktop app; it is simply a cost with
no corresponding deletion of the 1,295-line model. The combined cost bundle is
in §7.2.

---

## 7. Migration cost estimate

### 7.1 What a migration would touch

| Area | Files | Work |
|---|---|---|
| Focusable controls and regions | 15 screen/kit files (24 `data-focusable` sites; the 32 `data-region` declarations sit across 11 files, some of them shell) | add `useFocusable` / `FocusContext`, key builders, `focusable` for disabled, remove the `data-focusable` convention or bridge it |
| Level frame and stack | `ShellFrame.tsx`, `Shell.tsx`, `navigation.ts`, `useSpatialFocus.ts` (4) | level-root boundaries, `autoRestoreFocus: false`, saved-key history, push/pop effects, Back, inert/aria-hidden |
| Pure model | `focus.ts` (+ `focus.test.ts`) | either delete and accept library defaults (loses covering/rehome/#128) or keep and rewrite it around `FocusableComponent`/keys (little deletion) |
| Measurement | `layout.ts` (+ `layout.test.ts`) | custom `LayoutAdapter`; `data-measuring` handling; prune empties; resize/fullscreen invalidation |
| Player / OSD | `useOsdVisibility.ts`, `osd.ts` (`PlayerOverlay.tsx` and `PlayerPopovers.tsx` are in the 15 above) | ladder resolver, hidden-OSD wake/pending, volume intents, OSD pinning |
| Input | `input.ts`, `useGamepad.ts` | keep both; prevent the library's window listener from double-handling; typing exception; Back keys |
| Tests | 5 files hold the 62 focus tests: 3 in the rewrite set (`focus.test.ts`, `layout.test.ts`, `PlayerOverlay.test.tsx`), 2 as regression (`input.test.ts`, `ShellFrame.test.tsx`) | rewrite the pure geometry tests as component/integration tests, or keep `focus.ts` for the Remote client/#128 and add library tests; add key-uniqueness and level-restore tests |
| Remote client | `crates/host-wire/remote/index.html` | unchanged — and therefore still a hand-written model |

**File arithmetic.** Production: 15 screen/kit + 4 shell + `focus.ts` +
`layout.ts` + 2 OSD + 2 input + 1 Remote client page = **26**. Test files: 5
hold the 62 focus tests; **3 are in the rewrite set** (`focus.test.ts`, 452
lines; `layout.test.ts`, 187; `PlayerOverlay.test.tsx`, 1,144) and 2 are
expected to pass as regression (`input.test.ts`, 170; `ShellFrame.test.tsx`,
155). The estimate is therefore **26 production + 3 test = 29 files**, or **31**
if both regression files need edits.

### 7.2 Cost estimate (measured and estimated numbers separated)

**Measured in the spike:** **+704 / −0** lines in 2 authored files (399 source +
305 test), 14 tests, and 96.92 % line coverage of `spike.tsx`.

**Cost bundle — the full set in one place.** 26 production files + 3 test files
(29, or 31 with both regression files) · 24 focusable sites in 15 files · 32
regions in 11 files · 8 level surfaces · 62 existing focus tests in 5 files
(1,275 focus-related lines) · **6–10 engineer-days** for parity, including the
level/rehome/ladder/#128 glue and a Windows walkthrough (**estimate**) · 17.8 KB
gzip (§6) · a 1,295-line model that cannot be deleted while the Remote client
still needs its geometry and #128 needs its decision.

**Lines, full adoption (estimate).** The pure-model files hold **1,401** lines
that could be removed: `focus.ts` 594 + `layout.ts` 168 (762 production) +
`focus.test.ts` 452 + `layout.test.ts` 187 (639 test). At least the spike's
**399** source lines of glue return for *one* representative slice; with eight
level surfaces the added glue is plausibly **1,000–1,800** lines. The net is not
a deletion.

**Thin adoption** (library only for measurement/painting, keep `decideMove`):
replaces `layout.ts` (168 lines) with an adapter and touches the paint path;
saves perhaps **100–200** lines net (**estimate**), adds 17.8 KB gzip, and gains
no behaviour.

**Full adoption** (delete `focus.ts` and `layout.ts`, use library defaults): the
only shape that could delete the pure model, but it loses `covering`,
`widerThan`, the sibling overlap guard, previous-control rehome, the player
ladder's exact stop memory, #128 and Remote client parity. That is not an option
under the issue's constraints.

**Comparison:** #127 (reveal) and #128 (direct-first/closest) are each a focused
change to the existing pure model plus tests; the custom model is cheap to extend
precisely because it is pure geometry in, decision out.

### 7.3 What would remain custom after a "successful" Norigin migration

1. The level stack, Back, inert/aria-hidden and exact per-level restore.
2. Per-level memory/rehome, including previous-control semantics.
3. The player's OSD ladder, wake/pending stop, volume and OSD idle/pinning.
4. Gamepad polling, repeat and intents.
5. The keyboard table, Escape/Backspace/GoBack, typing protection.
6. #128's direct-first/closest and cross-region whole-level search.
7. The 24 px reveal (#127).
8. Remote client parity.
9. Resize/fullscreen invalidation if not done manually.
10. Accessibility announcements, if wanted beyond `onUtterText`.
11. Measurement guards (`data-measuring`, prune) and key uniqueness.
12. The FocusContext tree itself, which is new wiring in every screen.

That list is essentially the model. The library would own "which rectangle is
next" and registration — the part the custom model already tests best.

---

## 8. Remote client parity

ADR-0018 §1 makes the Remote client **one hand-written, self-contained,
compiled-in page**: `crates/host-wire/src/remote.rs:35` is
`include_str!("../remote/index.html")`, with no build step between `cargo test`
and the page the Host serves. The ADR rejected reusing the React window because
it would need a build step or a committed bundle, and accepts the cost: "The
remote mirrors the window's pure decisions by hand. A decision changed in
`src/*.ts` and not in the page is a divergence a person finds by hand, not a
build failure" (ADR-0018 Consequences; ADR-0017 §2, §9).

The page cannot import the library: it is served from Rust with no bundler. Its
focus block is **123 lines** (`remote/index.html:1137-1259`), with `moveFocus` a
flat `nearest` over the whole active scope and `data-focus-key` /
`captureView` / `restoreView` handling level return focus (`:1240-1252`,
`:2745-2780`, `:3089-3100`). It has **92 `data-focusable` occurrences across 89
lines** and **84 `data-focus-key` occurrences**. For input, the Host asserts only
that the page's `KEY_INTENTS` matches the window's
(`crates/host-wire/src/remote.rs:280-299`); there is no shared code and no
focus-model test between the two.

`[inference]` If the window adopted Norigin, the page would stay the old flat
`nearest`; the window's behaviour would live in a library tree while the page's
remains a hand-written function. Divergence would grow, and mirroring it by hand
would be no easier. The page's flat `nearest` already searches the whole active
scope, which is closer to #128's cross-region fallback than Norigin's per-parent
search, so #128 is another reason the page cannot follow the library.

---

## 9. Recommendation

**Keep the custom model. Reject Norigin as a replacement for the window's focus
model.** Do not migrate now under the current constraints.

Reasons, in order:

1. **It does not own the behaviours that cost the most.** Levels, memory,
   rehome, the OSD ladder, gamepad and #128 are all outside the library's
   vocabulary. The spike had to add glue for the level stack, the popover, the
   visible ladder and #128; the hidden OSD and previous-control rehome failed
   outright.
2. **The default geometry is not the locked model.** No `covering`, no
   `widerThan`, a 20 % adjacent-slice rule instead of the 1 px overlap guard,
   and a weighted score instead of direct-first/closest. `nextFocusResolver`
   cannot see grandchildren; `customDistanceCalculationFunction` can re-encode
   direct-first for one parent's siblings but cannot enumerate another region;
   `onArrowPress` can jump to a key but is per-leaf custom code.
3. **The Remote client cannot share it.** ADR-0018's page is compiled in with no
   build step. A migration leaves two models and makes the mirroring harder.
4. **The cost is a new dependency plus more glue, not less code** (§7.2). The
   pure model cannot be deleted because the Remote client still needs its
   geometry and #128 needs its decision.
5. **The custom model is the cheaper place to add #127/#128.** They are pure
   geometry changes with existing tests; the spike shows the library needs
   per-control callbacks to do #128 and still cannot do the reveal.

**Boundary of this finding:** the conclusion depends on the current constraints —
a compiled-in Remote client, the locked `covering` / overlap / direct-first
rules, and a React-only window. If any of those changes, re-open the question.
That is a boundary, not a recommendation.

---

## 10. What I could not verify

- **Windows / WebView2 behaviour.** The spike is jsdom only. No real window,
  CSS transforms, scrolling, fullscreen or GPU surface was exercised.
- **A real TV remote or gamepad.** The library never sees Gamepad API events;
  the app's polling remains. No hardware was used.
- **The app's own Vite bundle.** The 53 KB minified / 17.8 KB gzip figures are
  an isolated esbuild measurement, not `pnpm build` output; code splitting and
  minifier differences could change them.
- **A real browser's layout.** The adapter replaced `getBoundingClientRect`
  with test rectangles; nested positioned elements, scroll containers and
  transformed ancestors were not measured. The library's default
  `offsetLeft/Top` and its `GetBoundingClientRectAdapter` have different
  behaviour here (the latter includes transforms, which is why the app uses
  `data-measuring`).
- **A full app migration.** No screen from `src/shell` was migrated; the slice
  is representative but not the 26 production files or 8 level surfaces.
- **Coverage of the app.** The 96.92 % line figure is v8 coverage of
  `spike.tsx` only; it says nothing about the app's own coverage.
- **Screen-reader behaviour.** `accessibilityLabel` was not wired to
  `onUtterText` in a real assistive stack; no ARIA is generated by the library.
- **Performance at scale.** The docs recommend "hundreds, not thousands" of
  focusables; the app's long Settings/Title/Streams lists were not benchmarked.
  The library also re-renders focused components and tracked parents on each
  move, which the current DOM-focus paint does not.
- **The library's roadmap for #128-like rules.** No issue or release note was
  found that promises a global closest-control resolver; I did not read the
  whole issue backlog.
- **The exact `@noriginmedia/norigin-spatial-navigation` combined package
  internals.** It is a re-export of the other two packages at the same commit;
  the active code is the `-react` + `-core` pair.
- **`customDistanceCalculationFunction`'s docs example.** I ran a custom
  function against the published `.d.ts` shape and the callback does what §3.2
  reports. The `.d.ts` and the docs still disagree on `Corners`
  (`nearPlumbLinePoint` / `nearStraightLinePoint`); I did not run the docs'
  stale example.

---

## 11. Sources

### This repository

- Issue [#129](https://github.com/MenotiFilho/streamingapp/issues/129) —
  the spike; issues [#127](https://github.com/MenotiFilho/streamingapp/issues/127)
  (24 px reveal), [#128](https://github.com/MenotiFilho/streamingapp/issues/128)
  (direct-first/closest), [#120](https://github.com/MenotiFilho/streamingapp/issues/120)
  (OSD ladder/gamepad volume), [#121](https://github.com/MenotiFilho/streamingapp/issues/121)
  (descend/measure/prune), [#79](https://github.com/MenotiFilho/streamingapp/issues/79)
  (the model) and [#51](https://github.com/MenotiFilho/streamingapp/issues/51)
  (the prototype).
- `src/focus.ts`, `src/focus.test.ts`, `src/shell/layout.ts`,
  `src/shell/layout.test.ts`, `src/shell/useSpatialFocus.ts`, `src/input.ts`,
  `src/input.test.ts`, `src/shell/useGamepad.ts`,
  `src/shell/PlayerOverlay.tsx`, `src/shell/PlayerOverlay.test.tsx`,
  `src/shell/PlayerPopovers.tsx`, `src/shell/useOsdVisibility.ts`,
  `src/shell/osd.ts`, `src/shell/ShellFrame.tsx`,
  `src/shell/ShellFrame.test.tsx`, `src/shell/navigation.ts`,
  `src/shell/Shell.tsx`.
- `crates/host-wire/remote/index.html` (focus block `:1137-1259`, keydown
  `:3807-3816`, capture/restore `:2745-2780`, push/pop `:3089-3100`);
  `crates/host-wire/src/remote.rs` (`include_str!` at `:35`, keyboard-intent
  test at `:280-299`).
- ADR-0002 (one Action surface), ADR-0003 (mpv owns the swapchain),
  ADR-0017 §2/§9 (one compiled-in page, no build step), ADR-0018 §1 and
  Consequences (the Remote client is the window's equal; the mirror is by hand).
- `docs/research/gamepad-and-remote-input.md` (the input channels and the
  secure-context limit; the Remote client has no pad column).

### Norigin Spatial Navigation

- npm:
  [`@noriginmedia/norigin-spatial-navigation@3.3.0`](https://www.npmjs.com/package/@noriginmedia/norigin-spatial-navigation/v/3.3.0),
  [`@noriginmedia/norigin-spatial-navigation-react@3.3.0`](https://www.npmjs.com/package/@noriginmedia/norigin-spatial-navigation-react/v/3.3.0),
  [`@noriginmedia/norigin-spatial-navigation-core@4.1.2`](https://www.npmjs.com/package/@noriginmedia/norigin-spatial-navigation-core/v/4.1.2)
  (versions, publish dates, `dist.unpackedSize`, dependencies; read
  2026-10-22).
- GitHub:
  [repository](https://github.com/NoriginMedia/Norigin-Spatial-Navigation),
  [core 4.1.2 release](https://github.com/NoriginMedia/Norigin-Spatial-Navigation/releases/tag/@noriginmedia/norigin-spatial-navigation-core@4.1.2)
  (2026-09-25T11:22:53Z), release commit
  [`f34e75f`](https://github.com/NoriginMedia/Norigin-Spatial-Navigation/commit/f34e75f850d6d89bb5ddfb405b69c481f8e600d0),
  [`SpatialNavigation.ts`](https://github.com/NoriginMedia/Norigin-Spatial-Navigation/blob/f34e75f850d6d89bb5ddfb405b69c481f8e600d0/packages/core/src/SpatialNavigation.ts)
  (the custom-distance seam `:518-587`, the score `:644-651`, the cutoff
  `:1149`, the sibling set `:1217-1245`, the climb `:1304`),
  [`useFocusable.ts`](https://github.com/NoriginMedia/Norigin-Spatial-Navigation/blob/f34e75f850d6d89bb5ddfb405b69c481f8e600d0/packages/react/src/useFocusable.ts).
- Docs (read 2026-10-22):
  [Packages](https://devportal.noriginmedia.com/docs/Norigin-Spatial-Navigation/),
  [Core Concepts](https://devportal.noriginmedia.com/docs/Norigin-Spatial-Navigation/guides/concepts),
  [Focus Hierarchy & Context](https://devportal.noriginmedia.com/docs/Norigin-Spatial-Navigation/guides/focus-hierarchy),
  [Next Focus Resolver](https://devportal.noriginmedia.com/docs/Norigin-Spatial-Navigation/guides/next-focus-resolver),
  [Distance Calculation](https://devportal.noriginmedia.com/docs/Norigin-Spatial-Navigation/guides/distance-calculation),
  [Key Mapping](https://devportal.noriginmedia.com/docs/Norigin-Spatial-Navigation/guides/key-mapping),
  [Programmatic Focus](https://devportal.noriginmedia.com/docs/Norigin-Spatial-Navigation/guides/programmatic-focus),
  [Performance Tuning](https://devportal.noriginmedia.com/docs/Norigin-Spatial-Navigation/guides/performance),
  [useFocusable API](https://devportal.noriginmedia.com/docs/Norigin-Spatial-Navigation/api-reference/useFocusable).

### The spike (preserved in this PR, under `docs/`)

- [`norigin-spike/README.md`](norigin-spike/README.md) — exact install, test,
  coverage and bundle commands, with the versions above.
- [`norigin-spike/spike.tsx`](norigin-spike/spike.tsx) — 399 lines:
  base/rail/row tracks, Title level, popover, player ladder, dynamic row track,
  search field, #128 attempts.
- [`norigin-spike/spike.test.tsx`](norigin-spike/spike.test.tsx) — 305 lines,
  14 tests, all passing on 2026-10-22 with React 19.3.1, jsdom 30.1.2, Vitest
  5.0.4, package versions above; 96.92 % line coverage of the slice.
- Bundle measurement: `esbuild 0.28.2`, `--bundle --minify --format=esm
  --external:react`, `gzip -9n`; core 53,217 B min / 17,081 B gzip; core + the
  hooks the slice imports 55,561 B min / 17,844 B gzip; empty baseline 69 B /
  83 B. Entry files are in the same folder.
