# The Library is the Stremio account collection, read-only

Ticket #165 ("Read the Stremio account Library into a real Library room"). The
research note `docs/research/stremio-account-api.md` (merged by #164) established
what the account API exposes. This records the decision the room needs, and it
**supersedes the "Library is a stub" reading** of ADR-0020 and CONTEXT.md without
changing ADR-0016's Account sync.

## 1. The room is a read-only projection of `libraryItem`

The Stremio account stores the Library and its own Continue watching in one
`libraryItem` collection. The Host reads that collection into the Library room:

- a row is a `libraryItem` with `removed === false`;
- a tombstone (`removed === true`) stays in the raw document and is never shown;
- the room is ordered by `_mtime` descending;
- `state.lastWatched` is **not** used for the order: marking an episode writes
  the episode's release date, while playback writes now, so the field mixes two
  clocks (research note §4.1).

The room is **read-only**. Membership — saving a Title to the account, removing
it, and the sync that would carry those writes — is not built here. It is a
separate decision because a write can erase fields the Host does not model
(`datastorePut` replaces the document, research note §4.5), and because a
membership control needs its own confirmation and failure surface. The room can
be useful before that decision is taken.

Rejected, with reasons: **building membership now** (a write path whose merge
semantics the API does not document, bundled into a reading ticket); **showing
tombstones** (they are removals, not library items); **ordering by
`lastWatched`** (it is a release-date stamp for a marked episode, not a watch
time); **a per-episode Library** (the account has one item per Title; the current
episode is `state.video_id` and the watched set is the bitfield).

## 2. A question and an answer, never a Snapshot field

The Library is account data read for the client that asked, not shared Host
state. It travels as a question (`Action::Library`) and an answer
(`Answer::Library`), like a catalog row or a Discover page. No Snapshot carries a
library item, and `Snapshot.protection.stremio_held` remains the only account
fact a Snapshot carries. A paired remote client can ask the same question; it
gets its own answer and cannot read another client's browse.

The answer is `{ entries, failure }`:

- `entries` are the filtered, ordered rows;
- `failure` is the Host's `library` error when the account could not be read
  (unreachable, malformed, or a refused session). An empty `entries` list is an
  empty Library only when `failure` is absent; an expired session is a failure,
  never an empty room.

Rejected, with reasons: **a Snapshot field** (the Library is not shared state,
would reach every paired device, and would put account rows beside Watch
progress); **reading it in the client** (the `authKey` is the Host's, and a
client would need the account API); **a silent empty answer on a refused
session** (the room would say the owner saved nothing, which is a lie).

## 3. The auth key stays in host-secret; the read is a seam

`StremioApi` gains a library index read (`library_meta`, `datastoreMeta`). The
existing `library` read (`datastoreGet`) stays. The real HTTP client is
`HttpStremio` in `host-addon`; `host-core` has no HTTP. The `authKey` is read from
the secret store at the moment of the ask and dropped with it.

The read is a diff, not a full download every time:

- a cold Library asks `datastoreGet {all: true}`;
- a later ask compares `datastoreMeta`'s `[id, mtime]` pairs with the cached
  documents and fetches only the ids whose mtime moved;
- the raw documents are kept (the `RemoteItem` shape), including tombstones, so
  a later write can preserve every field the account owns;
- the cache is a memo shared by questions, not Host state and not a Snapshot.

Rejected, with reasons: **a full `datastoreGet` on every ask** (the index exists
to avoid it); **dropping tombstones from the memo** (a later write or a fresh
diff would lose the document's other fields); **storing the library in the
Snapshot** (see §2); **HTTP in host-core** (ADR-0009's boundary).

## 4. A series is one row

A `libraryItem` is one Title, not one episode. A series row carries
`state.video_id` as its current episode and `state.watched` as the watched
bitfield. The Host already parses that bitfield in `sync`; the room does not
expand it into episode rows. The Title name and poster on the item are the row's
name and poster, so drawing the room costs no Addon round-trip.

The Continue mark is `state.timeOffset > 0`; a saved but never played item has
no mark. The room's mark is not a resume control: pressing a card still opens the
Title through the existing `open_title` path, where a configured Addon answers;
a card no Addon can answer for is marked unplayable, like a feed card.

Rejected, with reasons: **one row per watched episode** (the account has no such
keys, and the bitfield is the set, not a history); **fetching an Addon's meta to
draw the card** (the item carries the name and poster, and the room should work
with no Addon round-trip); **using `timeOffset` as a resume control** (the
Episode/Video identity and the Streams still belong to the Addon path).

## 5. The Host's Continue watching is not merged with the account's

CONTEXT.md defines Continue watching as the Host's own, offline record: one card
per Video, drawn from Watch progress. The account's row is per Title, needs the
network, and carries a different resume point. The two rows are allowed to
disagree and both stay readable as their own records. The Library room shows the
account's items and its own Continue mark; it does not copy them into the Host's
Watch progress, and it does not hide the Host's row.

Rejected, with reasons: **merging the rows** (two authorities for one card, with
no way for a client to tell which is current); **using the account's item as
Watch progress** (it is a per-Title position from another client, not the Host's
per-Video record).

## 6. An expired session asks for a sign-in; it is not an empty Library

The account API answers a missing or expired `authKey` with
`{"error":{"message":"Session does not exist"}}` and HTTP 200. The Host maps a
refused library read to `ActionError::Library` and the answer carries it as
`failure`. The room shows the failure and, for the session message, the Stremio
sign-in form again — even though `stremio_held` is still true. Signing in replaces
the key; the room asks again. A Host that has no seam or no key refuses the
question with `SyncUnavailable` rather than pretending the Library is empty.

Rejected, with reasons: **clearing `stremio_held` in a question** (a question
does not change Host state); **treating the refusal as an empty answer** (the
lie §2 rejects); **a client-held session probe** (the key is the Host's).

## Consequences

- New `Action::Library`, `ValidatedAction::Library`, `Answer::Library`, and an
  `ActionError::Library` kind; the window and wire spell the question like every
  other question.
- `StremioApi` gains `library_meta`; `HttpStremio` implements `datastoreMeta`;
  `FixtureStremio` records the index and serves it from its items.
- A `LibraryCache` memo in `HostView`; no Store schema change, no Snapshot
  field.
- The repertory Library room draws the account's posters and names, ordered by
  `_mtime`, with the Continue mark; the no-account gate stays.
- CONTEXT.md's Library entry says the room reads the account collection while
  membership remains unbuilt. ADR-0020's "stub" line is superseded; ADR-0016's
  Watch progress scope is unchanged.
- The plain Vite window answers with a clearly labelled sample account Library;
  the Tauri window asks the Host.
