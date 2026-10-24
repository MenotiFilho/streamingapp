# A control that waits on the Host says so, and cannot be pressed twice

Issue #137: a control that waits on an Action looked dead after it was pressed,
and pressing it twice sent the Action twice. The clearest case was Next episode:
the Host holds its change lock while it asks the Addons for the Title's list and
the neighbour's Stream (ADR-0022), so **no Snapshot arrives until the step has
resolved**. The OSD kept showing the old episode, the button stayed enabled, and
two presses skipped two episodes.

This records why the wait is a client's to draw, how a press is guarded, and why
the Host did not grow a "busy" state.

## 1. The wait is drawn by the client, because the Host publishes nothing while it works

A Change in flight holds the Host's one lock for the whole of its I/O. That is
deliberate: two changes must not interleave (ADR-0022), and a Snapshot is built
from settled state, so there is no honest state to publish halfway through. A
client that waited for a Snapshot to say "working" would wait for the work to
finish.

The client already knows it sent the Action. So it marks the control before it
awaits, and clears the mark when the answer arrives. `TitleScreen` and
`StreamsLoader` already did this for their two navigation paths by pushing a
waiting level immediately; this decision generalises the shape rather than adding
a second mechanism.

Rejected, with reasons: **a Host `busy` field in the Snapshot** (it would be
state about an operation, not about the Host's world, and it would have to be
published outside the lock that is holding the operation); **a Host "queued"
answer** (the Action's answer is already the moment it is done); **waiting for
the first Snapshot** (that is the wait).

## 2. The guard is synchronous, and it is two layers

A second Action is not harmless: a Change queues behind the lock the first is
holding (ADR-0022), a Question races it, and for a cumulative Action the queue is
the bug.

- **The control** marks itself with a ref before React has painted, so two
  presses in the same tick cannot both start work. A boolean in state alone would
  not do: the second press arrives before the state has rendered.
- **The client's door** joins an identical Action already in flight. This is the
  second barrier, and it catches two different controls asking for the same
  thing — the strip's Next episode and the after-the-end Next episode — as well
  as a press that slipped past a control whose guard was reset too early.

"Identical" is the Action's own wire shape, serialised with object keys in one
order (`actionKey`), so two callers that built the same Action in different field
orders agree; arrays keep their order. The window keys its `InFlight` by that
key, and the Remote keeps the same `ordered`/`actionKey` pair inline. Keying by
type alone would be wrong: choosing Stream A and then Stream B are two different
Actions, and both should reach the Host in order.

Relative Actions are the exception. `seek` by a number of seconds, the chapter
steps and Autocrop mean "one more step", so two presses are two steps and neither
is joined (`repeats`). The episode steps are relative too, but they are the case
the guard exists for: two presses on Next episode before the Host answers are a
double press, not a request to skip two.

The key is freed when the run settles, success or refusal, so a refusal can be
tried again and a person is never locked out by an error.

## 3. What waits is said where the change will appear

- **Next / previous episode** (window): the pressed arrow becomes a spinner, both
  episode steps lock, and the OSD says "Loading the next episode…" where a
  refusal would appear.
- **A Stream chosen** (window): the row says "Opening…", every row is locked
  while it does, and the level leaves when the Snapshot says the Stream opened.
- **Settings, Addons, Stremio, confirmations**: their existing save/submit
  controls now draw the kit's spinner and are disabled while their own flag is
  set.
- **The Remote**: every control whose Action waits — opening a Title, finding
  Streams, choosing one, an episode step, adding an Addon, signing in, pairing —
  goes through `runAction`, and the submit forms through `runWaiting`. The node
  is marked pending before the first await, and a small pill says "Waiting for
  the Host…" after 150 ms. A chosen Stream's row also says "Opening…". The mark
  is `aria-disabled`, not `disabled`: the page may own the disabled state of the
  same node, and clearing the wait must not re-enable what the page set.

Fast local controls (pause, seek, volume, chapters) are deliberately left alone
in both clients: the Remote's `WAITING_CONTROLS` is the set that waits, and the
window's pending state is opted into per control. The door still joins identical
absolute Actions, while `repeats` leaves relative ones alone — so two rewinds are
two rewinds, and a double-mute still sends one target.

## 4. One primitive, two clients, no new Action

The window's primitive is `usePending` (a ref plus a state), and `InFlight`
keyed by `actionKey`. The kit's `Button` and the OSD's `IconButton` grew a
`pending` property that disables, marks `aria-busy`, and draws a spinner. The
Remote gets the same shape without a build step: `runWaiting` + `runAction` +
the pill, and the same `ordered`/`actionKey`/`repeats` decisions inline. No
Action, no Snapshot field and no Host rule were added for this; it is a fact
about a client's own request, not about the Host's state (ADR-0002).

Rejected, with reasons: **a per-screen busy flag** (the same shape re-written in
every screen, which is how the two navigation paths already drifted apart);
**disabling the whole surface while anything is in flight** (questions may run
concurrently and a person should be able to leave; only the thing that is
actually waiting says so); **an optimistic local transition** (the client cannot
know the next episode or the opened Stream, and inventing one would be a second
source of truth).

## Consequences

- A press is acknowledged before the Host answers, so a slow Addon looks slow
  rather than broken.
- A double press of an absolute or waiting Action sends one. A relative step is
  never joined: two rewinds are two rewinds, and a fast local control does not
  grow a spinner it would not have time to show.
- A refusal clears the wait and is shown as before, beside the control that
  asked.
- The Remote's pill is a client-side courtesy; the control's `aria-busy` is what
  a screen reader hears.
