# Bounded fan-out inside a question

Ticket #113 is the third child of #110 ("Home and Discover load slowly"). #111
made a question clone a frozen view and resolve outside the change lock, so one
client's Home no longer queues another client's Discover
([ADR-0022](0022-questions-fetch-outside-the-change-lock.md)). Inside one
question, though, the Addons were still asked one after another:
`search_catalogs` mapped over its plan with `catalog_row`, and `find_streams`
mapped over `asks_for` with `Provider::streams`. One slow Addon held the whole
Action for its timeout, and the client saw the sum. This records the fan-out
that fixes it.

## Scoped threads, because both seams block

[ADR-0009](0009-blocking-fetcher-addon-identity-and-the-manifest-url.md) keeps
`Fetcher` blocking, and [`Provider`](../../crates/host-core/src/provider.rs) is the
same shape on purpose. A fan-out over a blocking seam is threads, and
`std::thread::scope` is the smallest thread there is:

- the threads can borrow the [`HostView`](../../crates/host-core/src/view.rs), the
  plan, the request and the page cache, because the scope guarantees they are
  joined before it returns — no `'static`, no `Arc` per ask, no clone of a whole
  manifest merely to satisfy a spawn;
- every ask is joined before the question answers, so the door's timing line
  still covers the whole Action and no background work outlives it;
- `std::thread` is in the standard library. There is no runtime to start, no
  pool to shut down, and no new dependency beside `tracing`, which #111 added as
  a facade only.

`HostView` is already `Send + Sync` — it owns the frozen Addon list and holds
`Arc`s to the seams and the shared cache — so nothing had to be put behind a new
global lock to make this work. The compiler is the proof: a field that was not
`Sync` would refuse the `scope` closure.

## The bound is eight, enforced by chunks

`FAN_OUT_LIMIT` is 8. The plan (or the Addon asks) is split into chunks of at
most eight, one scoped thread is spawned per item, the chunk's threads are
joined, and only then is the next chunk spawned. That makes "at most eight in
flight" true by construction, even when one Addon is slow: the next chunk waits
for the slow one, and no semaphore has to count anything. In `find_streams`, an
Addon whose manifest declares no spelling this Host can build is not an ask: its
empty group is placed in its slot before the fan-out, so it neither takes one of
the eight slots nor waits for the network.

Rejected, with reasons:

- **Spawn every ask and gate them with a semaphore.** The same bound with a
  second synchronization mechanism and up to N parked threads instead of 8
  running ones. The chunk is the bound; a semaphore would only restate it.
- **A thread pool.** A pool is state the Host would own and shut down, with a
  queue whose depth is another thing to bound. A question is a short burst of
  eight threads that live for the length of one ask; the OS already pools
  threads.
- **`rayon` or another parallel-iterator crate.** A new dependency and a global
  pool for an eight-way fan-out whose order is written down. `rayon` would also
  hide the join point that keeps the door's timing honest.
- **An async runtime and a task per Addon.** The transports and the Player are
  blocking, and ADR-0009 refused a runtime in `host-core` for exactly this
  reason. The fan-out would have to make the seams async first, which changes
  every test double and every signature above them.
- **A Host-wide in-flight cap instead of a per-question one.** ADR-0022 already
  refused that: the door does not own work the client created, and #112 bounds
  the clients' own requests. Two policies would fight; this one is local to the
  question that fans out.

## Answers in configured order, asks in no order

Each fan-out pre-sizes a vector of slots, one per item, and every thread writes
the answer for its own index. The Answer is then read from the slots in plan
order. Completion order — even the reverse of configured order — cannot move a
Catalog Row or a Streams group.

What is no longer guaranteed is the **order the Addons are asked in**. Within a
chunk the spawn order is still the plan's, but scheduling decides who reaches
the network first; across chunks a later chunk necessarily starts after an
earlier one finishes. Tests that compared `fetcher.asked()` or
`provider.asked()` to the configured list now compare a multiset. The one
ordering that remains a fact is the TMDB `/external_ids` hop in `find_streams`:
it happens inside `asks_for`, before the fan-out, once for the Video, and the
test still asserts it first.

## The same per-Addon failure semantics

A fan-out changes when the asks happen, not what a failure means. A Catalog Row
that cannot be fetched is still that Row with its `failure` and an empty
`metas`; a Streams group that cannot be fetched is still that group with its
`failure` and no candidates. The other asks run to completion and answer. A
failure is a value in a slot, not a reason to abort the scope.

A panic inside an ask is not modelled as a failure — it was not before the
fan-out either. It is re-raised on the asking thread after the chunk's threads
have been accounted for, so a test double that panics still fails the test that
caused it instead of being swallowed by a thread.

## Only `search_catalogs` and `find_streams` fan out

Those are the two questions that ask a set of Addons for one answer. The rest
are deliberately left alone:

- **`Resume`, `NextEpisode` and `PreviousEpisode`** ask Addons until the first
  playable candidate in configured order (`first_playable`). Fanning them out
  would ask Addons whose answers the Host would never reach, and would change
  when it is allowed to stop. They are also changes, serialized for the length
  of their work (ADR-0022).
- **The subtitle fallback** asks the Addons that offer subtitles, but stops
  adding once the Player has enough tracks (`MAX_FALLBACK_SUBTITLES`). It is the
  same early-stop shape, and it is a change path.
- **`pull_remote`** is not an Addon question at all: it is one call to Stremio's
  account service, made as a change under the lock.
- **The TMDB season loop in `open_title` / `open_discovered_title`** stays
  sequential. Parallelizing it would change which seasons a Title keeps when one
  of them fails, would multiply credential-bearing calls against TMDB's limits,
  and is a non-goal of #113.

## Per-Addon timing, with no payload in it

Each ask in a fan-out gets one `info` line: the Addon id, the resource
(`catalog` or `stream`), `duration_ms`, and the outcome — `ok` or
`ActionError::kind()`, never its detail. A `search_catalogs` line is one per
Catalog ask, so an Addon with several searchable Catalogs contributes several;
the door's own line remains the Action's total (ADR-0022). The helper's parameters are an
`&'static str` resource, an `&AddonId`, a duration and an `&'static str`
outcome; there is no slot for a URL, a query, an error, or an answer, so the
no-credential rule is kept by the shape of the function rather than by
remembering it, the way the door's question log is (ADR-0022). An Addon's
manifest URL can carry a debrid key and a Stream URL can carry a session; none
of that has a parameter to travel in.

The door still logs the Action total. A `search_catalogs` row served from the
cache, or a stale page served because the Addon failed, is still that Addon's
ask and is timed as one; the line has no field saying which, because the ticket
does not ask for one and an extra field is another thing a payload could ride
in. `find_streams` logs nothing for an Addon whose manifest declares no spelling
the Host can build: it was never asked.

## Consequences

- A question now costs, roughly, the sum of each chunk's slowest ask instead of
  the sum of every ask: one ask's worth when there are eight or fewer, plus the
  `/external_ids` hop where a TMDB-keyed `find_streams` needs it. A slow ask
  early in the plan delays the whole Answer — the Answer is returned once — but
  it cannot move a Row or a group out of configured order.
- A question can own up to eight OS threads for the length of its asks. They are
  joined before the Answer is returned; no thread survives the Action.
- Ask order is no longer a fact, and no test may assert it. Answer order is, and
  every Row and group stays at its configured index.
- A per-Addon failure stays one Row or one group, and the rest of the answer
  still arrives.
- The fan-out is visible in the logs as one `info` line per Addon asked, so a
  slow Addon is named with its own duration rather than inferred from a total.
- No wire shape, Snapshot, or Action changes. `live_check` composes the Addon
  path directly and never builds a `Host`, so this decision does not reach it.
