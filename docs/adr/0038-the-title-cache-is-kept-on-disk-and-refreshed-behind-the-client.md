# The Title cache is kept on disk and refreshed behind the client

Opening a Title is slow. An Addon is asked for `meta`, TMDB is asked for the
record's details, and then TMDB is asked once per season, one season after
another, so a ten-season series costs about twelve sequential round trips before
the Title screen draws. Opening it a second time costs the same twelve, because
a meta answer is kept nowhere. Continue watching's **Up next** needs the same
list of Videos, and it has to be answerable with no network. This records why
the Host now keeps the Titles it reads, on disk, and refreshes them behind the
client. That reverses three earlier positions, named in §6.

The TMDB facts this rests on (`append_to_response`, `next_episode_to_air`,
`status`, air dates, rate limits) are gathered in
`docs/research/tmdb-title-cache-facts.md`. Where that note contradicts a number
here, the note wins and this ADR is amended.

## 1. A Title read is a Title kept, in the store

Every Title the Host reads, from an Addon's `meta`, from TMDB, or from both
joined (ADR-0020), is written to the store with the moment it was read and the
source it came from. Opening a Title the Host holds answers from the store
without touching the network. The cache survives a restart, which is the point:
the Title behind a Continue watching card, and its Up next, must be readable on
a Host that started with no network.

It sits beside the catalog page cache rather than replacing it. A page is still
"something an Addon said a minute ago" and stays in memory (ADR-0010). A Title is
something the owner came back to, and is held the way Watch progress is held.

The cache is bounded by count, oldest read first. It never evicts a Title
behind Watch progress or in the Library, because those are the Titles the row
and Up next are drawn from. There is one ceiling over that: TMDB's API Terms
forbid holding its data **longer than six months**, so a TMDB-sourced copy that
has not been refreshed in six months is dropped whatever it is behind. A card
whose Title was dropped shows its finished Video as Watched until the Title is
read again.

Rejected, with reasons: **in memory only** (every restart starts cold, and Up
next cannot be answered offline, which Continue watching's own definition
forbids); **keyed by request URL** like the page cache (the same Title is reached
by an Addon's id and by its TMDB key, and the question is "which Title", not
"which URL").

## 2. Fresh for a day or a month, then served stale while it is refreshed

A cached Title is **fresh** for a window set by what it is:

- a series still running: **one day**, because episodes arrive weekly;
- a film, or a series TMDB says has ended: **thirty days**.

A fresh Title is answered from the store and nothing is asked. A stale Title is
**also answered from the store, at once**, and refetched in the background. When
the refetch lands and differs, the Host sends the client that asked a **second
answer** to the same question, marked as a revision. The client swaps it in if
that Title is still open, and ignores it otherwise. A refetch that fails keeps
the stale copy and changes nothing a client sees.

The second answer goes only to the asker, because a Title is a client's own
business (ADR-0005): it is an Answer, not a Snapshot. That is new. Until now one
Action produced one Response. The IPC bridge and the wire both gain a way to
deliver an Answer to one client after the Response that opened it.

When the source a Title came from goes away (its Addon removed, or the TMDB
Credential removed), the cached copy is **kept** and served until it goes stale.
After that it is refetched from whatever source still answers. A Continue
watching card whose Addon is gone is still marked unplayable (#29). The cache
does not change what the row marks.

Rejected, with reasons: **honouring the Addon's `cacheMaxAge` for meta** (Cinemeta
sends hours, TMDB sends no hints at all, and the windows above are about how often
a series gains an episode, which neither source states); **waiting for the
refetch and falling back to the stale copy** (a stale Title would be exactly as
slow as today, and the slowness is the complaint); **a Snapshot announcing "Title
X refreshed" so clients re-ask** (it tells every client about one client's
browsing, against ADR-0005); **dropping the copy when its source goes** (a Title
the owner has watched would vanish from its own card's open the moment an Addon is
swapped).

## 3. Read ahead only where the owner is likely to go

Prefetching every Title on Home would be about 200 Titles, each needing one
`meta`, one details and one request per season: over a thousand requests per Home
load, for Titles the owner mostly never opens. The Host reads ahead in three
places only:

- **at startup, in the background:** the Titles behind Continue watching and in
  the Library, which are the ones most likely to be opened and the ones Up next
  needs;
- **on a client's hint:** the desktop window says it is *looking at* a Title when
  a card has held focus or the pointer for a short dwell, and the Host reads it
  ahead. The hint is a fire-and-forget Action with no answer. The remote sends
  none, because a touch screen has no hover. It still opens anything already
  cached at once, since the cache is the Host's and every client shares it;
- **every Title opened** is kept, so the second open is instant.

The background work runs outside the change lock and bounded, as a question's
fetches already are (ADR-0022, ADR-0023).

Rejected, with reasons: **everything on Home** (the cost above, and TMDB's rate
limit); **the first N cards of each rail** (a guess at attention that the focus
hint makes unnecessary); **only what is opened** (the first open of a Continue
watching Title would still be slow, and Up next would wait for it).

## 4. A series' seasons are asked for together

The per-season loop is replaced by TMDB's `append_to_response` on the details
request, which carries a series' seasons in the same response, up to TMDB's limit
per request (twenty, documented in TMDB's OpenAPI text). A series with more seasons than
that is asked in a second batch, and the batches run as a bounded fan-out
(ADR-0023), not one after another. A season that fails is still skipped rather
than blanking the series around it, as today.

Rejected, with reasons: **a parallel fan-out of single-season requests alone**
(it fixes the latency but keeps the request count; batching fixes both).

## 5. A caught-up series is watched by what TMDB says about it

A series the owner has caught up on leaves Continue watching and comes back when
its Up next is listed. The Host learns that from the series' TMDB record rather
than by re-reading it blindly. The **list of Videos is the truth** and the
record's fields are hints about when to read it: `next_episode_to_air` is null
in TMDB's own example of a running series, and is not documented for an episode
announced with no air date, so its absence proves nothing.

- `next_episode_to_air` is set: the newest season is read again, and the card
  returns as Up next once the episode is in the list, aired or not;
- nothing is announced and `status` says the series is still running
  (`Returning Series`, `In Production`, `Planned` or `Pilot`): the details and
  the newest season are read again **weekly**, which is one request per
  caught-up series with the season appended (§4);
- `status` is `Ended` or `Canceled`: it is not checked again. Opening the Title
  still refreshes it, so a revival is found the next time the owner looks.

An Unmapped Title has no TMDB record, and its Addon's `meta` is re-read weekly
on the same rhythm. TMDB recomputes `next_episode_to_air` about once a day, so
nothing here checks more often than that.

Rejected, with reasons: **daily for every running series** (a season break is
months long, and a daily check finds nothing for most of the year); **trusting
`next_episode_to_air` alone** (it is null for running series, so a series whose
next episode was listed without the field would never come back); **TMDB's
changes feed** (`/tv/changes` lists every changed record by id over up to 14
days, and `/tv/{id}/changes` says that something changed, not that an episode
was added; neither replaces reading the list).

## 6. What this reverses

- **ADR-0010**, "the cache itself is in memory … and never persisted". That still
  holds for catalog pages. It no longer holds for Titles (§1).
- **ADR-0010**, `staleRevalidate` "carried and *not* acted on", because a
  synchronous Fetcher had nowhere to put revalidation. The Host now has
  background work for prefetch and refresh, so serving stale and refreshing
  behind the client is done, for Titles (§2). Catalog pages are unchanged.
- **The note on the Title read** that "a meta answer is not kept in the page
  cache: a Title is one item the owner opened on purpose". It is still not kept
  in the *page* cache. It is kept in the Title cache, because a Title opened on
  purpose is one the owner comes back to.

## Consequences

- The store gains a table for Titles, written from the background as well as
  from questions. It is the second thing the store holds that the Host does not
  own, after Watch progress's Title stub, and it is bounded for that reason.
- One Action can now be followed by a second Answer to the same client. Every
  client must accept an Answer that arrives later and ignore one for a Title it
  is no longer showing.
- TMDB's episode air dates are read, because the caught-up rule and the Title
  screen's "Airs 12 Nov" mark both need them. An air date may arrive as an
  empty string or as null, and both are read as "no date".
- TMDB documents its rate limit only as about 40 requests a second, with `429`
  to be respected. The background queue's bounded fan-out stays well under it,
  and a `429` is a failed fetch that keeps the cached copy.
- TMDB does not promise that an appended season's body matches
  `GET /tv/{id}/season/{n}` field for field, and one report has the season's own
  `id` missing. The batched read is pinned by a recorded fixture of a real
  appended response, not by the single-season fixture.
