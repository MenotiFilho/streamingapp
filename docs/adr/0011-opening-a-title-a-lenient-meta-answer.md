# Opening a Title: a lenient meta answer, Videos as the unit, and no page cache

> **Two amendments since this was written.**
> [ADR-0020](0020-tmdb-as-a-second-content-source.md) makes TMDB the metadata
> source for every Title on a key-held Host: its record supplies the poster, the
> description, the backdrop, the rating, the genres and the **Videos**, and the
> Addon's `meta` answer is drawn only where no key is held or TMDB met no record —
> so the Videos rule below holds only without a key. And ticket #62 widened what
> this Host reads so that art can be drawn rather than dropped: `background` on a
> catalog item (`MetaPreview`) and on a meta answer (`Title`), `logo` on a meta
> answer, and a Video's `thumbnail`. Read the ignored-field list below with those
> three struck — Home's hero, the Title screen, and a series' episode rows draw
> them. The `meta.rs`/`catalog.rs` comments and the `meta.rs` test comment that
> repeat the old list move with the build ticket, not with this decision.

Ticket #24 ("Open a Title and see its Videos") is the second ticket that reads
from an Addon, and the first whose answer is about **one item** rather than a page
of them. ADR-0010 said a question is answered with an `Answer` rather than a
Snapshot, and named this ticket and #26 as the next two of the same shape; this is
that shape, filled in. It is also the first time the Host's vocabulary distinguishes
a Title from a Video, which everything after this acts on.

## The answer is a `Title`, and its identity is the client's

`Action::OpenTitle { addon, title }` validates into `ValidatedAction::OpenTitle`,
is resolved by asking one Addon, and comes back as `Answer::Title(Box<Title>)`.
`Title` is the glossary's word, and its `id`/`type` are the identity the client
opened; `addon` travels with it because that is what a later ticket asks for a
Video's Streams of. `Video` is the glossary's other word: one playable unit,
carrying the id its Addon indexes it by (`tt0903747:1:1`), which is what Watch
progress is recorded against and what a Stream is asked for by.

The Addon asked is the one the client names — the Addon whose catalog supplied the
item — and `Manifest::answers` decides whether it is the Addon's to answer at all
(the rule ADR-0010 wrote down and named `meta` as a consumer of). The alternative,
asking every configured Addon that supports `meta` and merging the answers, is
#25's job: it is where "TMDB-first where a Title can be mapped, the Addon where it
cannot" lives, and doing it here would put a ranking of Addons into the Host before
the ticket that decides it exists. A `TitleRef` sits beside `CatalogRef` for the
same reason: the protocol names both a `{type}/{id}`, but a message about a Title
must not say "catalog", so the two are types of their own that share one rule for
what a usable pair is.

## A sparse meta answer is a Title, not a failure

The client asked to open a Title it already has a card for, so the id and the type
are known before the Addon answers. That is what makes leniency possible, and the
ticket asks for it: *"a missing or partially populated `meta` response degrades to
what is available rather than erroring"*.

So `Title::parse` refuses exactly two things, and neither is a missing field:

- a body that is not a JSON object (`{"meta":…}` is the only shape a meta response
  has), and
- a `meta` that is there but is not an object.

Everything else is read with `parse`'s own leniency: a field of the wrong type is
the field the Addon did not send, a `name` it left out is the Title's id, and no
`meta` at all — which is what the SDK's own handler answers when it knows nothing
about the item, `{"meta": null}` — is an answer, not a failure. The `id` and the
`type` are not read from the body at all: the Title *is* the item the client asked
about, so an answer cannot rename it and an `id` the Addon sends is ignored.

Only the fields this Host acts on are read, which is ADR-0009's rule about a
manifest applied to a Title: the poster, the year, the description, the runtime,
the rating and the genres are drawn, a Video's id, name and place in its season are
drawn, and everything else a meta response carries — `background`, `logo`, `cast`,
`director`, `trailers`, `links`, `slug`, `popularities`, and a video's `thumbnail`,
`overview`, `rating` and `firstAired` — is ignored rather than refused. Reading a
field nothing acts on is a promise this Host would not be keeping; it arrives with
the ticket that draws it.

Two asymmetries inside that leniency are deliberate. A `videos` that is not a list
**is** refused, and one longer than the Host will hold with it: an empty list of
Videos is a film, and reading a lie as a film would hide a series' episodes, which
is the one thing this ticket exists to show. A `genres` that is not a list is
ignored instead — and, unlike `videos`, a longer one is read rather than refused —
because genres decorate a Title while its Videos are what a Title *is*: the same
leniency a catalog item's genres already get (ADR-0010). A single Video that cannot
be read is dropped rather than blanking the series around it, the way a bad item is
dropped from a catalog page.

An Addon that cannot be reached, or that answers with a body that is not a meta
response, is an `ActionError` — not a row with a `failure` in it the way a catalog
search answers, because one Addon was asked for one Title and there is no second
row for the client to fall back on.

## A meta answer is not kept

The catalog page cache (ADR-0010) is keyed by URL and holds pages, because paging
through a row, or two clients looking at the same one, would otherwise ask the same
Addon for the same hundred posters over and over. A Title is one item the owner
opened on purpose, once, and the Addon's `cacheMaxAge` is a hint for the former
case. Re-opening a Title asks again, and there is nothing to invalidate, nothing to
bound, and no `staleError` path to invent for a page nobody pages through.

Rejected, with reasons: **publishing the Title or its Videos in a Snapshot** (which
Title is open is a client's own business — ADR-0005 — and two clients looking at
different Titles is the point); **an `Answer::Title` that carries the catalog row
it came from** (the row is the client's already, and a Snapshot-shaped answer would
make the Host hold a client's cursor); **making `Title` the thing the client opens
by id without the Addon** (with two Addons there is no answer to "which one", and
naming it either way is the rule #25 exists to write); **caching the meta answer
beside the pages** (above); and **refusing a meta response with no `meta`**
(because it is the shape a real SDK handler answers with, and a card that opens
into an error is worse than a card that opens into the little the Addon knows).

Consequences: a new question is an `Action` variant, a `ValidatedAction` variant
and a variant of `Answer` (ADR-0010 already said so, and this is the second one);
a capability that acts on one Video — #26's Streams, #29's Watch progress — is
keyed by the Video's own id and the Addon its Title carries; and the window falls
back to the card it opened when the Addon's answer was sparse, because the Host's
leniency is only useful if the client shows what it already had.
