# Questions fetch outside the change lock

Ticket #111 is the first child of #110 ("Home and Discover load slowly"). It
found that Home sends one `browse_catalog` per declared Catalog, that the Host
served one Action at a time behind `Mutex<Host>`, and that each of those Actions
held the mutex for the length of a blocking Addon fetch. So the last Home row
waited for the sum of every Addon's latency, Discover queued behind Home, and
the window's `snapshot` command waited behind the same lock. This records the
lock-scope decision that fixes it.

## The door stays one Action surface

Nothing about the protocol changes. There is still one `Action` enum, one
versioned envelope, one `Response`, and the same door for the window and the
wire ([ADR-0002](0002-host-authoritative-single-command-surface.md),
[ADR-0008](0008-thin-shell-and-one-action-surface.md)). The read-only
`live_check` run is not a caller of that door: `host-live` composes the addon
path directly and never builds a `Host`. A question is not a second command
space and a change is not a privileged one; a remote client is still the
window's equal ([ADR-0018](0018-the-remote-is-the-windows-equal.md)), and no
wire version moves.

This is a decision about **how long the Host's lock is held**, not about who may
speak or what they may say. The distinction between a question and a change was
already written down in [ADR-0010](0010-an-answer-beside-the-snapshot-and-the-catalog-request-path.md)
(`Answer` versus `Snapshot`) and in the Action vocabulary; until now it did not
reach the lock.

It amends one rationale in
[ADR-0009](0009-blocking-fetcher-addon-identity-and-the-manifest-url.md): the
Fetcher stays blocking, but its justification — "the Action surface is a door one
client goes through at a time" — is no longer true for questions. A change is
still one at a time; a question is one of many.

## A question clones a frozen view and resolves outside the lock

`src-tauri` used to own `Mutex<Host>`, and so did the wire test fixture: two
copies of the same policy, in two crates, with the rule buried in a doc comment.
The door moves into `host-core` as `HostDoor`, which owns the one `Mutex<Host>`.
The shell's `HostHandle` and the wire fixture become thin wrappers over it, so
there is one lock policy in the repository and `src-tauri` holds no rules.

`HostDoor::dispatch` validates the Action, asks the one classification —
`ValidatedAction::is_question()` — and then:

- **a question** briefly locks the Host, calls `Host::view()`, and releases the
  lock. `HostView` carries the Addon list as it stood at that moment, the
  `Fetcher`, the `Provider`, the `SecretStore`, and the shared page cache. The
  question then resolves on `HostView::ask` with no state lock held at all, so
  two questions can be in flight at once and a slow Addon occupies only its own
  request.
- **a change** keeps the exclusive lock for the whole of `Host::apply`: its
  manifest fetch, its writes, its Player tellings, its Snapshot. Changes stay
  serialized because two changes interleaving into a state neither client asked
  for is exactly what the mutex is for.

`Mutex<Host>` is still the one state lock. There is no lock per Addon and no lock
inside `State`; the page cache has a mutex of its own, and it is a leaf — taken
for one map operation and never while the state lock is held across a fetch.

## The view is as-of-dispatch, not a subscription

The Addon list in a `HostView` is a clone taken under the short lock. That makes
one consequence explicit: a question dispatched before an Addon was removed may
still answer from the Addon that was removed while the question was in flight.
That is deliberate. The alternative — re-checking the Addon list after the fetch
— would make a question's answer depend on a change that happened during it, and
would either fail an answer the Addon really gave or require the question to
take the change lock twice. The view is a snapshot of the only state a question
reads, and a change never waits for a question's fetch.

The reverse direction is equally deliberate: a change does not wait for a
question, and a question does not see a change dispatched after its view was
taken. A client that dispatches a change and then a question sees the change's
effect, because the question's view is cloned after the change returned.

The one shared thing a view does not freeze is the credential: `SecretStore` is
an `Arc` read at the moment of use, as it already was, because a key entered
while a Title is opening is the key the Title should use. The page cache is
shared for the same reason — it is a memo, not state a client can see.

## Only questions escape

Exactly eight Actions are questions. The classification is
`ValidatedAction::is_question`; resolving a question (`HostView::ask`) and
refusing one on the change path (`Host::change`) necessarily name the eight
variants too, so a new question cannot be added without deciding its side in
those matches:

- `browse_catalog`
- `search_catalogs`
- `discover`
- `search`
- `open_title`
- `open_discovered_title`
- `find_streams`
- `preview`

Everything else is a change and stays serialized, including the changes that
also fetch:

- `add_addon` fetches and parses a manifest, and holds the lock across it;
- `sample` may fetch subtitle fallbacks, and is the shell's clock rather than a
  client's Action;
- `pull_remote` talks to Stremio's account service;
- playback changes (`play_stream`, `resume`, `next_episode`,
  `previous_episode`, and every control) open, stop or tell the Player.

The window and the wire never classify. `HostDoor` asks `is_question`, and
`Host::dispatch` — the convenience used by tests — asks the same method, so a
new Action cannot be treated one way by one adapter and another way by another.

## `CatalogCache` is shared, and its lock is never held across a fetch

The page cache used to be a field of `Host` and was read and written directly.
It is now `Arc<Mutex<CatalogCache>>`, the same `Arc` handed to every view. A
question takes that lock only to call `fresh`, `when_stale` or `keep`; the fetch
and the parse happen outside it. Two questions fetching different pages do not
queue behind each other, and a page one question keeps is visible to the next
view without copying the cache.

The cache is not a single-flight gate: two questions asking for the same page at
the same moment may both fetch it. That is a cache, not a guarantee, and the
alternative — a lock held across the fetch to deduplicate — is the failure this
ADR exists to remove.

## No global in-flight cap

The door imposes no limit on how many questions may be in flight. A cap would be
a Host policy with no knowledge of the client that caused the work: the window
and the Remote client are sequential today, and #112 adds a bound of four
requests in flight on each; fan-out inside `search_catalogs` / `find_streams`
bounds its own concurrency in
[ADR-0023](0023-bounded-fan-out-inside-a-question.md). A single
Host-wide semaphore would make those two decisions fight each other and would
turn a slow client into a slow Host for everyone else.

`snapshot` stays under the change lock. It is built from the whole state, and a
Snapshot assembled while a change is half-applied is not a state any client may
see. A question no longer holds that lock across its fetch, so `snapshot` no
longer waits behind Home's catalogs; it waits only for a change, which is short
or is a serialized piece of work that was always going to happen.

## Timing lines at the door

The door is the only place that knows when an Action started and whether it was
a question, so the Action's timing lines live there. (ADR-0023 adds one line per
Addon ask inside a fan-out; the door's line remains the Action's total.) A
question gets one `info` line carrying:

- `action`, the stable kind (`browse_catalog`, `find_streams`, …), never a
  payload;
- `addon`, the Addon id, and only for the two questions that name one;
- `duration_ms`;
- `outcome`, a stable word or a stable error kind.

Above two seconds the line is a `warn`. A change is logged at `debug`, because
changes are already visible in the Snapshot stream and a `debug` line per control
is enough.

An error's `kind()` is the serde tag (`malformed`, `fetch`, `no_tmdb_credential`,
…), never its detail. The helper's signature has no slot for an `Action`, a
`ValidatedAction`, a URL, a query or an error, so the rule is kept by the shape
of the code rather than by remembering it: an Addon manifest URL can carry a
debrid key, a Stream URL can carry a session, and a query is the owner's
business. Nothing in the line is built from a payload.

`host-core` depends on `tracing` directly now, as a facade only: the crate still
holds no runtime and no network, and the app shell decides where the lines go.

## Rejected, with reasons

- **A second door or command space for questions.** It would break ADR-0002 and
  make the wire route by variant instead of translating, which is the thing
  ADR-0010 already refused.
- **Fine-grained state locks.** `State` is one value and a Snapshot is built from
  all of it; splitting it into per-Addon or per-field locks would put a lock
  order in the Host and make a consistent Snapshot a matter of luck.
- **An async runtime and a task per question.** The transports are blocking, the
  Player is blocking, and ADR-0009 refused a runtime in `host-core` for the same
  reason. Cloning a view and letting the caller's thread block is smaller.
- **A global in-flight cap or a semaphore at the door.** It would bound work the
  Host did not create and collide with the clients' own bounds and ADR-0023's
  fan-out bound.
- **Holding the `CatalogCache` lock across the fetch**, so a duplicate request
  waits for the first. Two clients would then be serialized by a memo.
- **Taking the addons out of `State` and sharing them behind a lock.** A view
  needs a consistent list for the length of one question, not a list that can
  change under it; a clone is cheaper than a second lock and cannot deadlock.
- **Publishing a Snapshot from a question.** ADR-0005 and ADR-0010 already
  settled that browsing is a client's own business.

## Consequences

- A slow Addon is one slow row, not a slow Host: Discover and `snapshot` do not
  queue behind Home's catalogs, and two Home rows can be fetched at once.
- A question may answer from an Addon removed mid-flight; that is the price of
  not making a change wait for a question, and it is stated here rather than
  discovered later.
- The door is one policy for the window and the wire; a new adapter holds no
  mutex of its own.
- The eight questions are classified by `is_question`; resolving them
  (`HostView::ask`) and refusing them on the change path (`Host::change`) name
  the variants explicitly, so a new Action must choose a side.
- `host-core` logs through `tracing` without gaining a runtime or a transport.
