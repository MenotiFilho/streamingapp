# Motion is the repertory animation layer

Ticket #150 (wayfinder map #143), amending the design record's §6, ADR-0030 §3,
ADR-0017 §2 and ADR-0018 §1. The record locked a CSS-only motion list; this
decides the engine that carries it, so rails, modals and screen transitions move
the same way in both clients.

## 1. One library, both clients

Movement runs on **Motion** (`motion`, formerly Framer Motion):

- the window imports `motion/react`;
- the served Remote receives a pinned, vendored ESM bundle of Motion's vanilla
  `animate` (the hybrid build) from `host-wire` at a cacheable route, imported
  by one module script. The page still builds nothing at serve time: the bundle
  is a committed, version-pinned vendor file with its MIT header.

**This amends the "one self-contained document" rule.** ADR-0017 §2 and
ADR-0018 §1 rejected a second checked-in file; the decision is now the document
plus exactly one same-origin, pinned, cacheable asset, imported by one module
script. Nothing is fetched outside the Host, no asset is generated at request
time, and the page still has no build step. The alternative — inlining the
bundle into every response — keeps the letter of the old rule at the cost of
re-sending ~22kb on every load and losing the cache; that trade is rejected
below.

The two clients therefore share the engine, the spring presets and the
transition shapes; only the API surface differs (components in React, `animate`
on the page).

Rejected, with reasons: **window-only** (the phone would keep hand-written CSS
and the two clients would drift in exactly the place the map says may move);
**a build step for the Remote** (the page's value is that one response is the
client; a build would also make the served artifact differ from the reviewed
source); **inlining the bundle in every response** (no cache, and every page
load pays 22kb); **a CDN** (the Host is offline-first and on a LAN; the page must
fetch nothing outside the Host); **Framer Motion** (the former package, which
Motion's own upgrade guide says must never be installed beside `motion`).

## 2. Physics in Motion, CSS in the rest

The boundary:

- **Motion** owns what has physics, interruption, layout or orchestration: a
  rail's programmatic scroll and focus reveal, a drawer or popover's enter/exit,
  a level push/pop, the feature's cross-fade, the spine's width.
- **CSS** keeps what is self-contained and cheap: the focus wash's opacity, the
  timeline and volume fills, a colour or ink step on hover.

Both read the same presets, so the split is an engine choice, not a second
motion language.

Rejected, with reasons: **everything in Motion** (a motion component per poster
puts JS on every focus move, for a 140ms opacity that CSS already does well;
Motion's own guidance keeps simple self-contained effects in CSS);
**CSS-only** (a CSS transition cannot be redirected mid-flight with its
velocity, cannot animate between two layouts, and cannot animate an exit —
which is what makes a rail or a drawer feel fluid when the person changes their
mind).

## 3. Critically damped springs, one fade

| Preset | Value | Used for |
|---|---|---|
| panel | spring, `visualDuration: 0.24`, `bounce: 0` | a pushed level, a drawer, a popover, the spine, a rail's scroll |
| quick | spring, `visualDuration: 0.14`, `bounce: 0` | a focus reveal inside a rail, small state changes |
| fade | tween, `0.14s`, `cubic-bezier(0.22, 1, 0.36, 1)` | opacity and colour |

The durations are declared in `tokens.css` from #153 as `--rep-motion-panel` and
`--rep-motion-quick` (today `--rep-dur-fast` / `--rep-dur-med`). `motion.ts`
reads those two custom properties from the document and pairs them with
`bounce: 0`; the Remote's script reads the same two properties, so the page does
not carry a third copy. No test compares the module with the sheet: ADR-0032
allows exactly two CSS-as-text locks.

`bounce: 0` is deliberate: a critically damped spring keeps an interruption's
velocity and settles without overshoot, which is the fluidity the request is
after. A cinema does not bounce.

Rejected, with reasons: **bounce** (0.15–0.2 reads as a toy in a repertory
room, and overshoot at ten feet draws attention to the chrome); **a single
tween** (no velocity on interruption, which is the whole gain); **two curves
without named presets** (each screen would pick its own and drift).

## 4. The transition shapes

- A **destination switch** cross-fades the base (240ms); it does not slide.
- A **pushed level** (Title, Streams, a Settings leaf, a confirmation) enters
  24px from the trailing edge with a fade and leaves the same way; Back
  reverses it. The level stack, the focus restoration and the Actions are
  unchanged. Focus is restored on the new level at the start of the transition,
  and the animation never gates input.
- A **popover or drawer** rises 12–16px with a fade; on the Remote, the drawer
  rises from the bottom edge and the scrim fades with it.
- A **rail** scrolls with `animate()` on its scroll offset, so a second press
  redirects it mid-flight; the focus reveal uses the same path. No snapping, no
  inertia.
- The **feature** cross-fades on its 15s beat, replacing the record's earlier
  no-cross-fade rule; focus still holds it.
  (Amended 2026-11-06: the beat was 24s; it is 15s at the owner's decision on
  PR #261, sprint 248. The motion rule above is unchanged.)

Nothing else moves: no poster zoom, no row stagger, no card lift, no control
scale. The keyline's geometry never animates.

Rejected, with reasons: **a full-width curtain per level** (theatrical at ten
feet and at odds with the printed-programme stillness); **fade-only** (no
direction, so Back and push feel identical); **longer transitions** (a 400ms
level makes the keyboard feel laggy; 240 is the ceiling).

## 5. Reduced motion keeps the fades

The window puts one `<MotionConfig reducedMotion="user">` at the root: it
disables transform and layout animations and keeps opacity and colour fades.
That config reaches only `motion` components, so the window's direct `animate()`
calls — the rail scroll and the focus reveal — check `useReducedMotion()` and
jump instead of animating. The Remote cannot use the React APIs, so its module
script reads `matchMedia("(prefers-reduced-motion: reduce)")` — and listens for a
change — and runs only opacity and colour animations; every transform is
skipped. Under the same media query the CSS transform transitions are disabled
and the width fills snap; only opacity and colour still fade. The feature stops
rotating. The OSD's auto-hide clock, the focus rules and every Action are
untouched.

This **replaces** the record's earlier rule ("0ms, no transforms, no fades").
The 0ms rule also froze the wash and made every state change a cut; keeping the
fades is the accessible middle: no movement, no sudden flashes.

Tests assert the final state, never a frame: transform and layout assertions
mount with `reducedMotion="always"`, opacity and colour assertions with a zero
transition. (This is the rule; #151 owns the migration list.)

Rejected, with reasons: **zeroing everything** (the earlier rule — no fades, and
the focus wash cuts); **ignoring the setting** (Motion's default is not to read
it, and the system promises to); **a React-only `MotionConfig`** (the phone
would keep moving under a reduced-motion setting).

## 6. Landing

The dependency and the presets land in #153 (the kit and primitives); the screens
consume them in #154–#158; the Remote's vendored bundle and module script land
in #159. No prototype is built for this: the vocabulary is decided and the
system is otherwise locked.

Rejected, with reasons: **a spike first** (the direction is settled and the
design record is already merged); **waiting for the cutover (#160)** (every
screen would be built twice, once with CSS and once with Motion).

## Consequences

- `package.json` gains `motion`; the window imports `motion/react`.
- `tokens.css` declares the two durations; `motion.ts` reads them and pairs them
  with `bounce: 0`; the Remote reads the same properties. One number, two
  readers, no third CSS-as-text lock (ADR-0032).
- The Remote gains one module script and a vendored bundle served by
  `host-wire`; ADR-0017 §2 and ADR-0018 §1 are amended: the page is now the
  document plus one same-origin, pinned asset. It still builds nothing at serve
  time and fetches nothing outside the Host.
- The window's bundle grows by the tree-shaken Motion (roughly 20kb gzip); the
  Remote's asset is roughly 22kb over the LAN, cached. Both are accepted for a
  desktop app and a LAN page.
- The design record's §6 is rewritten, §12 allows one spring-duration tuning in
  #153, and §14 records the prototype's CSS-only state as a difference.
- A reduced-motion user keeps the fades and loses the movement; a test asserts
  the final state, so no suite waits on a spring.
