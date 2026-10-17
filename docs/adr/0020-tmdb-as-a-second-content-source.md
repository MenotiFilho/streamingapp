# TMDB as a second content source: Discover, the Discovered Title, and an id bridge per Addon

Ticket #53 ("Discover from TMDB: the model and the Host seam") is the first time
a Title can come from somewhere that is not an Addon, and the first time the
Host's own metadata source (TMDB, ADR-0009) and its content sources (Addons) meet
in one screen. ADR-0010 said a question is an Action variant, a `ValidatedAction`
variant and a variant of `Answer`, and named browsing, opening a Title and
finding Streams as its consumers; this is the fourth. The owner's decision is the
whole shape of it: **TMDB Discover yields Title cards; opening one asks every
Addon for its Streams by id; an Addon that does not know the id answers nothing
and it is marked.**

## Discover is a question, and it is not a Catalog and not a Provider

Three shapes were available and two are wrong.

- **A `Provider`.** ADR-0012 scopes `Provider` to one source's `stream` answer —
  turning a Video into playable candidates. Discover yields *metadata rows*, the
  other side of the protocol; a `Provider` that answered rows would be a second,
  differently-shaped seam wearing one name.
- **A Catalog from a non-Addon source.** ADR-0009 makes an Addon an id inside its
  manifest, and ADR-0010 makes a catalog request
  `{manifestUrl}/catalog/{type}/{id}/{extra}.json`, judged by `Manifest::answers`.
  A TMDB feed has none of the three — no Addon id, no manifest URL, no declared
  `extra` — so widening `Catalog` would put TMDB onto the Addon-shaped request
  path ADR-0009/0010 exist to keep Addon-shaped.
- **A new question Action** — the one chosen. It mirrors `BrowseCatalog`: an
  `Action` variant, a `ValidatedAction` variant and an `Answer` variant
  (ADR-0010), answering the client that asked and publishing no Snapshot
  (ADR-0005 — a feed is one client's browse). The credential stays in the Host
  (ADR-0009/0016); the window never holds it and never builds the URL.

The Action carries the type (`movie`/`series`), a page, and optional genre and
sort; the screen's default surface is TMDB's **trending** feed (the week), with a
type toggle and a genre filter. The answer is a new
`Answer::Discover(Vec<DiscoverRow>)`, where a `DiscoverRow` mirrors `CatalogRow`
— the items, how many the answer carried (so a client pages the same way), and a
`failure` — minus the Addon, because there is none. A client draws a Discover row
with the same card it draws a catalog row, and the Answer's own variant is what
tells it that opening a card goes the Discover path rather than `open_title`.

`CONTEXT.md` gains **Discover** for this feed; a **Catalog** stays exactly "one
feed of Titles an Addon offers".

## A Discovered Title is TMDB-keyed, and it has no Addon

`CONTEXT.md` already said a Title is "keyed by its TMDB id when one exists". A
**Discovered Title** is that case taken to its limit: TMDB named it and no Addon
did, so it is keyed by `TitleKey::Tmdb` from the first moment and may be unknown
to every configured Addon. It is the inverse of an Unmapped Title: mapped to
TMDB, and perhaps answerable by nothing. Both terms are now in the glossary —
**Discover** is the feed, **Discovered Title** is the item.

Because it has no Addon it cannot travel through `open_title`, which names one
and refuses unless that Addon's manifest answers (ADR-0011). So a second question
Action opens a Discovered Title against TMDB instead, answering the same
`Answer::Title` shape with no Addon behind it — which makes `Title.addon`
optional as well. `open_title` keeps its own shape, and ADR-0011's rule — the
identity is the client's, the Addon asked is the one it named — is untouched for
the Titles that have one.

The missing Addon reaches the library, which is where it shows. ADR-0015's card
carries the Addon a Title came from, because that is what a removed Addon is
judged against; a Discovered Title has none, so `TitleCard.addon` becomes
optional and the `addon_removed` mark applies only where one was present.

## The client speaks TMDB ids; each Addon is asked in the spelling it declares

A TMDB discovery result carries only TMDB's numeric id — no IMDb id, no external
ids (the #48 note, §7). Addons are the other way round: Cinemeta declares
`["tt"]`, and `tmdb:` is real only because some Addons declare it. One id cannot
be sent to every Addon, so the bridge is built **per Addon**, at the moment of
asking:

- the client names the Video by its **TMDB id** — `tmdb:<id>`, and
  `tmdb:<id>:<s>:<e>` for an episode, which is the protocol's
  `{title}:{season}:{episode}` rule applied to a `tmdb:` title;
- for each configured Addon whose manifest is asked, the Host builds the request
  in the spelling *that* Addon declares — `tmdb:<id>` where it declares `tmdb:`,
  the `/external_ids`-resolved `tt…` where it declares `tt` — judges it with
  `Manifest::answers`, and asks it with that request (ADR-0010's rule, applied
  per Addon);
- an Addon that declares neither is simply not asked; its group is empty, and
  that emptiness is what "marked" means.

This is one amendment to ADR-0012. That ADR said the `VideoRef` is not handed to
a Provider because `Manifest::answers` judges a request and the Addon must be
asked with *that* request. That still holds; what changes is that the request is
now built **per Addon** from the Video, by a pure function of the Addon's own
prefixes, rather than built once and offered to all of them. The invariant is
kept per Addon: the request judged is the request asked.

## When a key is held, TMDB is the metadata source for every Title — Videos included

The owner chose TMDB-first: with a Credential held, every Title's metadata comes
from TMDB, and its **Videos** — a series' episodes — come from TMDB too, with the
Addon's own episode list replaced. This is the largest change here, and it amends
ADR-0011, which read a Title's Videos from the Addon's `meta` answer as the thing
a Title *is*.

The reasoning is the owner's: Addon metadata in the wild is uneven and often old,
TMDB is the metadata catalogue the Host is already configured with, and the
Streams are the Addons' business regardless. So `open_title` still asks the named
Addon for meta — its answer is the spine when TMDB cannot answer, and the request
path is unchanged — but where TMDB answers, its record supplies the poster,
description, runtime, rating, genres, backdrop and the Videos. A Discovered Title,
which has no Addon at all, is simply the case where TMDB is the only source.

The rule for a series is the one the owner accepted: the episode list is TMDB's,
its Videos are keyed `tmdb:<id>:<s>:<e>`, and at the moment of finding Streams
each is rewritten to an Addon's own id — the title part substituted for the
spelling that Addon declares, `:{s}:{e}` kept — by the same per-Addon bridge
above. **TMDB and an Addon can disagree on a series' season or episode
numbering** — specials, split seasons and anime ordering are the known cases —
and where they disagree the rewrite asks an Addon for an episode it does not
have, so it answers nothing. That is a known consequence of choosing one
metadata source over the other, recorded here so it is watched in the build
rather than discovered in the wild. Which TMDB endpoints serve a series' episode
list, and what they cost, is a fact the build gathers — the #48 note covered
discover, trending and external ids, not TMDB's season endpoints.

Without a key there is no TMDB, so every Title is exactly what the Addon said
(ADR-0011 unchanged), and `tmdb_refine` is the no-op it already is when no
credential is held.

## With no key, Discover is a screen that says so

Discover stays in the rail and, with no key held, shows that it is TMDB-powered
and where a key goes rather than hiding. The Snapshot already carries
`protection.tmdb_held`, so the window draws the state without asking. A hidden
screen teaches nothing and shifts the rail as the key comes and goes.

## No cache, and a failure is a row

Unlike a catalog (ADR-0010), a Discover page is **not cached**: every page hits
TMDB. TMDB sends no cache hints to honour, and a feed is a live thing whose
staleness is worse than its latency. A failed call — including the `429` TMDB
answers when pushed past its roughly forty requests a second — is a
`DiscoverRow` carrying a `failure` in the Host's vocabulary, the same shape a
catalog search already uses, rather than a retry, a block, or a screen-level
error.

## A Discovered Title no Addon can play is marked twice, cheaply and on demand

Marking every card at Discover time would mean fanning out a network call per
card, which is exactly what TMDB's rate limit punishes. So the mark is drawn
where it is cheap: **locally** on a card when no configured Addon declares any
spelling the Title could be asked by (the manifests' `idPrefixes` are already in
the Snapshot), and **on open** when a Title's Streams come back with no group
carrying any candidate — the empty-answer case `Answer::Streams` already has. A
Title an Addon merely has nothing *for* is not pre-judged; an Addon that could
never be asked *is*.

## No new store; Continue watching unifies on the TMDB id

A Discovered Title gets no store of its own. It enters **Continue watching** the
way anything does — by being played, through Watch progress (ADR-0015) — and
never the **Library**, which is the owner's Stremio-account collection and a
sign-in-gated stub on this map. Because a played Video is keyed by its TMDB id
when a key is held, a Title played once through an Addon's card and once through
Discover is **one** entry, not two; without a key there is no TMDB id to unify
on, and the two are separate, which is the honest cost of no key.

TMDB's terms require its logo and the notice "This product uses the TMDB API but
is not endorsed or certified by TMDB" somewhere prominent, in an About or Credits
section. That is a hard requirement of using the API and lands with the Discover
screen and the Settings surface, not as a later nicety.

Rejected, with reasons: **a `Provider`** (ADR-0012's grain is Streams, not rows);
**a non-Addon Catalog** (would falsify `Catalog`'s definition and put TMDB on the
Addon-shaped request path); **the window calling TMDB** (the credential is the
Host's — ADR-0009/0016 — and the URL builder would be untested); **a single id
sent to every Addon** (neither `tt` nor `tmdb:` reaches the other's Addons, so
half the ecosystem is stranded); **`tmdb:` only** (Cinemeta and Torrentio are
`tt`-only, which is nearly everything); **caching Discover pages** (no hint to
honour, and a stale feed is worse than a fresh fetch); **persisting Discover
pages** (a just-started Host showing yesterday's feed); **pre-fanning-out per
card to mark playability** (a rate-limit trap); **a store for Discovered Titles**
(Continue watching already gives the played ones a home, and the Library is out
of scope); **`open_title` with an optional Addon** (overloads a variant whose
meaning is "ask this Addon", and blurs ADR-0011 for the Titles that do have one).

## Consequences

A new Action adds a `ValidatedAction` and an `Answer` variant, with the
action-spelling list and the client capability assertion (ADR-0018) growing by
one. `FindStreams` builds its request per Addon rather than once.
`Title.addon` and `TitleCard.addon` become optional. ADR-0011 is amended for a
key-held Host: TMDB supplies a Title's Videos and the Addon's episode list is
replaced; without a key it stands as written. The glossary gains **Discover** and
**Discovered Title**. The window gains a Discover screen whose cards open a
Discovered Title, and a Settings surface that explains the key; both carry the
TMDB attribution.
