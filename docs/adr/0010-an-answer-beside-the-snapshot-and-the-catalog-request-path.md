# An answer beside the Snapshot, cache hints on the response, and the catalog request path

Ticket #23 ("Browse and search the catalogs") is the first ticket that *reads*
from an Addon rather than configuring one, and the first that has to get something
back to the client that asked for it. Five decisions are worth writing down; one of
them corrects an assumption ADR-0009 made.

## The Action surface answers as well as publishes

Until now everything an Action produced was a Snapshot, and a Snapshot is state
that goes to **every** client — what is playing, what is in the library, which
Addons are configured. Browsing is not that. ADR-0005 says a client browses
independently: what one client is looking at must not move what another one is
looking at, and two people must be able to use the television and the phone at
once. So a catalog row cannot travel as a Snapshot, and putting it in one would
be the exact failure ADR-0005 exists to prevent.

So `Host::dispatch` returns a `Response`, which carries two different things:

- `snapshots` — what every client is owed, in order. Empty when the Action changed
  nothing anyone else can see.
- `answer` — what the client that asked is owed, and no one else. `Answer::Catalogs`
  today; #24's Title and #26's Streams are the same shape.

One `Action` enum goes in and one `Response` comes out, so there is still one door
and one command space (ADR-0002): a browsing Action is an Action variant, and the
window and the WebSocket adapter of #31 are translators over the same surface. The
deviation from ADR-0008's "a new capability is an Action variant, a `ValidatedAction`
variant and a field in the Snapshot" is deliberate and is the point of this
decision: a capability that is a *question* gets an `Answer`, not a Snapshot field.

A question is not a change: browsing publishes no Snapshot and moves no `revision`.
A client's cursor, its search box and which row it scrolled to stay in that client,
where they belong.

## Cache hints are on the response, not in the manifest — ADR-0009 was wrong about that

ADR-0009 said the SDK's cache hints (`cacheMaxAge`, `staleRevalidate`,
`staleError`) were manifest fields the Host would read when it learned to cache.
They are not. The SDK reads them off the *handler's returned object* and turns them
into `Cache-Control` headers (`stremio-addon-sdk/src/getRouter.js`), and Stremio's
own client reads them from the same place (`stremio-core`
`src/types/addon/response.rs`, `ResourceResponseCache`). The recorded Cinemeta page
shows it plainly: `{"metas":[…],"hasMore":true,"cacheMaxAge":14400,
"staleRevalidate":3600,"staleError":3600}` — no such field is in its manifest. So
the hints are read from each response, with the items, and the manifest is left as
it was.

The Host honours two of the three:

- **`cacheMaxAge`** — a page fetched less than this long ago is served without
  asking the Addon again. Absent or `0` means "do not keep it": an Addon that said
  nothing has not licensed the Host to guess.
- **`staleError`** — when the Addon cannot be reached and the page is still inside
  `cacheMaxAge + staleError`, the last good page is served instead of an error. That
  is what makes one Addon going down a row that has something in it.
- **`staleRevalidate`** is carried and *not* acted on: honouring it means answering
  from the cache and revalidating behind the client's back, which a synchronous
  `Fetcher` (ADR-0009) has nowhere to put. It needs the background work #33's
  conformance run is about, not a synchronous Host inventing it.

The cache itself is in memory, keyed by the request URL, and never persisted: a
page is something an Addon said a minute ago, and a Host that has just started has
no business showing yesterday's row.

## The request path is a pure function, and it is `encodeURIComponent`'s encoding

`ResourceRequest` is the protocol's `{resource}/{type}/{id}/{extra}.json` as values
— a resource, a type, an id, and the `extra` values the client chose — and its URL
is a pure function of that and the Addon's manifest URL. Every component is
percent-encoded with the set Stremio's own client uses
(`stremio-core/src/constants.rs` `URI_COMPONENT_ENCODE_SET`: alphanumerics plus
`- _ . ! ~ * ' ( )`), and `extra` is a *stringified querystring*: `name=value`
pairs joined by `&`, each name and value encoded on its own. That last detail is
the one worth having a test for: a search for `blood & guts` has to reach the Addon
as `search=blood%20%26%20guts`, because an Ampersand that survives unencoded is
read as another parameter. The same encoding is why `id` stays one path segment
when it contains a `/`.

`extra` travels as values rather than as a pre-built string for the same reason: a
client that concatenates its own querystring is a client that can build a different
one, and the encoding rule would then be tested nowhere.

Which Addons a request is asked of is one rule, `Manifest::answers`:

- `catalog` is the special case the protocol asks about by name. An Addon is asked
  for the catalogs it declares and only those, with the values it declared —
  `idPrefixes` deliberately does not apply, as the protocol's own documentation
  says.
- Every other resource is judged by the types it covers and the id prefixes it
  reaches. A resource that declares no types reaches the manifest's own types, and
  one that declares no prefixes reaches every id. This is the rule the ticket asks
  for ("`idPrefixes` respected for non-catalog resources"); `meta` in #24 and
  `stream` in #26 are its consumers.

The Host is the client of the addon protocol (ADR-0006), so *it* fills in the
values a catalog requires from the first option the catalog offers, and *it* is
where the rule for which catalogs can be asked for lives. The window asks about
every catalog an Addon declares and draws the ones the Host answers; a catalog the
Host refuses — one that requires a value its Addon offers no option for — is
simply not a row, and not an error anybody is shown. That is deliberate: a second
copy of the rule in the window is a second copy to keep in step, and the window
has no business knowing that Cinemeta's `New` catalog needs `genre=2026`.

Two smaller things the protocol makes easy to get wrong, and the Host therefore
does once:

- **A card draws what the Addon said about the item.** A catalog of *releases* — an
  Addon's own library, a debrid library — gives every entry one poster and one
  title, and puts the filename in the `description`: *Carrie S01E01* and *Carrie
  S01E08* are ten cards that look identical without it. So the description is
  drawn on the card, clamped to a few lines with the whole of it on the tooltip,
  because it is the only field that tells two entries apart — the need the spec
  states for Streams ("I want to see each Stream's filename … so that I can tell
  two releases apart") showing up one surface earlier.

- **Paging counts what the Addon sent, not what the Host could read.** An item this
  Host cannot read is dropped, so a client counting the items it holds would ask
  the next page for one it has already seen. A row carries `sent` — how many items
  the Addon put in the page — and a client pages on by that.
- **The cache is bounded.** Every distinct search is a URL of its own, so an
  unbounded map of pages would be a slowly growing record of everything the owner
  looked for. The oldest page goes when the map is full.

## A search asks every catalog that offers one, and one failure is one row

`SearchCatalogs` asks every configured Addon's catalogs that declare `search`, in
the order the Addons were configured and each Addon's own order within that. Every
answer is a row, including the ones that failed: a row carries `failure`, a
typed `ActionError` in the Host's own vocabulary, so one Addon being down is one
row with an explanation rather than a search that returns nothing. The same is true
of a page that lies about its shape.

Stremio's own client aggregates search the same way
(`AggrRequest::AllCatalogs` in `stremio-core/src/types/addon/request.rs`), which is
where the ordering and the "which catalogs does this extra belong to" rule come
from.

An item inside a page is treated differently from the page itself. A page that is
not a catalog — not JSON, no `metas`, `metas` not a list — is a refusal, because
that is a fact about the Addon. One *item* that cannot be read is dropped and the
rest of the row stands, because a hundred poster records are not all-or-nothing and
a single bad record is not worth hiding ninety-nine good ones (Stremio's client
skips them too).

Rejected, with reasons: **publishing catalog rows in the Snapshot** (every client
would then be looking at the same row, which is what ADR-0005 forbids, and the
revision would move every time somebody scrolled); **a second Host method or IPC
command for questions** (the command space would then be two spaces, and the
WebSocket adapter of #31 would have to route by variant rather than translate);
**letting the window build the request URL** (the encoding would be untested and
the window would hold the manifest URL, which ADR-0009 keeps out of clients);
**persisting the cache** (a stale row on a just-started Host is worse than a
fetch); **acting on `staleRevalidate`** (nothing here can revalidate behind a
client's back); and **ranking or merging search results across Addons** (the
spec's Stream rule generalised: the Addon's order is the order).

Consequences: a new question is an `Action` variant, a `ValidatedAction` variant
and a variant of `Answer`; the cache is in memory and bounded; and anything that
wants to ask an Addon for a resource goes through `ResourceRequest`,
`Manifest::answers` and the one `Fetcher`.
