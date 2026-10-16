# Where Home's hero backdrop comes from, and what the Host must read

**Date of research:** 2026-10-16. **Where:** primary sources only — the Stremio
addon protocol docs and the SDK's own TypeScript types, live answers from a real
Addon (Cinemeta, fetched on this date), the TMDB API reference (whose pages inline
their OpenAPI definitions), and this repo's own code where the question is "what
does the Host already read". No design recommendations beyond the one the ticket
asks for, which is labelled as such; everything else is facts and their source
links, including the negatives.

Issue #59, child of #47 (the new-UI map). Read with `CONTEXT.md` (*Title*, *Meta
preview*, *Row*, *Catalog*, *Featured catalog*, *Addon*, *Snapshot*, *Host*),
`docs/research/tmdb-discovery-and-id-mapping.md` (the sibling note this one builds
on — TMDB discovery, its response shape, and the TMDB ↔ Addon id bridge), ADR-0009
(read only the fields you act on), ADR-0010 (a question is answered, not
published), ADR-0011 (opening a Title reads only the fields it acts on), and
ADR-0005 (clients browse independently).

## Sources, and what each one is

| Source | URL | What it grounds |
|---|---|---|
| Stremio addon protocol — Meta Object / Meta Preview Object | <https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/meta.md> | which fields the protocol documents on a meta answer and on a catalog item |
| Stremio addon protocol overview | <https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/protocol.md> | the `{resource}/{type}/{id}.json` shape, where a catalog item vs a meta answer is asked for |
| Stremio addon SDK — `src/types.d.ts` | <https://github.com/Stremio/stremio-addon-sdk/blob/master/src/types.d.ts> | the SDK's own `MetaPreview` / `MetaDetail` interfaces, i.e. what an SDK author is told to send |
| Cinemeta — live catalog (movies) | <https://v3-cinemeta.strem.io/catalog/movie/top.json> | a real catalog item's fields, `background` / `logo` included |
| Cinemeta — live catalog (series) | <https://v3-cinemeta.strem.io/catalog/series/top.json> | the same for series |
| Cinemeta — live meta (a film) | <https://v3-cinemeta.strem.io/meta/movie/tt0133093.json> | a real meta answer's fields |
| Cinemeta — live manifest | <https://v3-cinemeta.strem.io/manifest.json> | what a real Addon declares (and does not) |
| Stremio image service (metahub) | `https://images.metahub.space/background/<size>/<id>/img` | what Cinemeta's `background` URL points at |
| TMDB `/configuration` | <https://developer.themoviedb.org/reference/configuration-details> | the image base URLs and the `backdrop_sizes` / `logo_sizes` lists |
| TMDB `/discover/movie` | <https://developer.themoviedb.org/reference/discover-movie> | that a discover result carries `backdrop_path` inline |
| TMDB `/trending/movie/{time_window}` | <https://developer.themoviedb.org/reference/trending-movies> | that a trending result carries `backdrop_path` inline |
| TMDB `/movie/{id}/external_ids` / `/find/{external_id}` | <https://developer.themoviedb.org/reference/movie-external-ids>, <https://developer.themoviedb.org/reference/find-by-id> | the id bridge a TMDB fallback would need (via the sibling note) |

Repo citations are file paths in this worktree. Live Addon answers were fetched on
2026-10-16 and the byte counts/field presence below are from that day; TMDB results
and the sibling note's facts are dated 2026-10-16 as well.

---

## 0. The answer in one paragraph

The protocol documents `background` and `logo` on the **Meta Object** (the answer
`open_title` gets) and *not* on the shorter **Meta Preview Object** a catalog
returns — but the SDK's own `MetaPreview` type carries both, and real Cinemeta puts
both on **every catalog item** it serves (48/48 films, 50/50 series, live on
2026-10-16; not only on the meta answer). So a hero backdrop is already on the
wire in the Featured catalog's page; the Host simply throws it away at
`MetaPreview` today. The cheapest source and seam is therefore to **widen the
catalog-item read — add `background`/`logo` to `MetaPreview` — and draw the hero
from the `browse_catalog` row the client already asked for**, costing no extra Host
call and no `open_title`. `open_title` per hero Title is the expensive path (four
extra Addon fetches every time Home draws, plus a `/find` per `tt`-only item if a
TMDB fallback rides along) and is unnecessary, because the art is in the preview.
TMDB's `backdrop_path` is a real backdrop source (sizes `w300`/`w780`/`w1280`/
`original`) but belongs to the **Discover** surface (#53), where a TMDB row already
carries it inline, not to a Home hero over Addon catalog items.

---

## 1. What the protocol lets a catalog item carry

The protocol's response doc defines two shapes
(<https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/meta.md>):

- the **Meta Object** — "Used as a response for `defineMetaHandler`" — which lists
  `background` and `logo` as optional:
  > `background` - _optional_ - string, the background shown on the stremio detail
  > page ; heavily encouraged if you want your content to look good; URL to PNG, max
  > file size 500kb
  >
  > `logo` - _optional_ - string, the logo shown on the stremio detail page ;
  > encouraged … URL to PNG
- the **Meta Preview Object** — "This is a shorter variant of the previously
  described Meta Object. Used as a response for `defineCatalogHandler`" — whose
  field list is `id`, `type`, `name`, `poster`, `posterShape`,
  `genres`, `imdbRating`, `releaseInfo`, `director`/`cast`, `links`, `description`,
  `trailers`.

**`background` and `logo` are not in the documented preview field list.** The only
art the preview is documented to carry is `poster`, and the doc says Stremio itself
uses that poster as a backdrop on its own Discover surface:

> `poster` - **required** - string, URL to png of poster … ; also used as the
> background shown on the stremio discover page in the sidebar

The SDK's TypeScript interface tells a different story. `src/types.d.ts` declares
`MetaPreview` with both fields, and `MetaDetail extends MetaPreview`
(<https://github.com/Stremio/stremio-addon-sdk/blob/master/src/types.d.ts>):

```ts
export interface MetaPreview {
    id: string;
    type: ContentType;
    name: string;
    poster?: string;
    posterShape?: "square" | "poster" | "landscape";
    /** The background shown on the stremio detail page. … URL to PNG, max file size 500kb. */
    background?: string;
    /** The logo shown on the stremio detail page. … URL to PNG. */
    logo?: string;
    description?: string;
    trailers?: Array<{ source: string; type: "Trailer" | "Clip" }>;
}

export interface MetaDetail extends MetaPreview {
    genres?: string[];
    releaseInfo?: string;
    …
}
```

So the documented prose (preview: no backdrop) and the SDK type (preview:
`background?`, `logo?`) disagree, and an addon author reading the type — which is
what the SDK compiles against — is invited to send them on a preview. This is a
documentation gap in the protocol doc, not a prohibition: the type is the SDK's
contract, and `MetaDetail extends MetaPreview` means a field the detail page uses
is already a preview field in the type.

What the preview *is* documented to describe its shape with is `posterShape`:
`square` (1:1), `poster` (1:0.675) or `landscape` (1:1.77). `landscape` is the one
shape that is already backdrop-shaped.

---

## 2. What real Addons send: Cinemeta on the preview and on the meta answer

Cinemeta is the Addon the protocol itself points at for `tt` ids, so it is the
reference answer. Fetched live on 2026-10-16:

- **`GET /catalog/movie/top.json`**
  (<https://v3-cinemeta.strem.io/catalog/movie/top.json>) — 48 items, **48 with
  `background`, 48 with `logo`**. An item's keys include
  `id, type, name, poster, background, logo, description, genres, imdbRating,
  releaseInfo, …`. The art fields are exactly:
  ```
  "background": "https://images.metahub.space/background/medium/tt22084616/img"
  "logo":       "https://images.metahub.space/logo/medium/tt22084616/img"
  "poster":     "https://images.metahub.space/poster/small/tt22084616/img"
  ```
- **`GET /catalog/series/top.json`**
  (<https://v3-cinemeta.strem.io/catalog/series/top.json>) — 50 items, all with
  `background` and `logo`.
- **`GET /meta/movie/tt0133093.json`**
  (<https://v3-cinemeta.strem.io/meta/movie/tt0133093.json>) — the meta answer for
  The Matrix carries the same `background` and `logo` URLs as the preview does.
  `posterShape` is absent on both (so the protocol's assumed `poster` applies).

The repo already holds recorded Cinemeta answers that show the same thing, from
before this ticket:

- `crates/host-core/tests/fixtures/cinemeta-catalog-movie-top.json` — every item
  carries `background` and `logo`;
- `crates/host-core/tests/fixtures/cinemeta-search-movie-top.json` — `background`
  is present on the search results too;
- `crates/host-core/tests/fixtures/stremboxd-catalog-letterboxd-popular.json` — a
  second, unrelated Addon also sends `background` (no `logo`).

Two facts about Cinemeta's own manifest
(<https://v3-cinemeta.strem.io/manifest.json>), fetched the same day:

- it declares **neither `logo` nor `background`** — so nothing about preview art
  can be inferred from the manifest;
- it declares `idPrefixes: ["tt"]`, `resources: ["catalog","meta","addon_catalog"]`
  — the `tt`-only Addon the sibling note §7.3 already describes.

Cinemeta's `background` URL is `https://images.metahub.space/background/<size>/
<id>/img`, and the `<size>` Cinemeta sends is `medium`. Fetching the three obvious
segments on 2026-10-16:

| segment | HTTP | Content-Type | bytes |
|---|---|---|---|
| `small` | 200 | image/jpeg | 28,212 |
| `medium` | 200 | image/jpeg | 688,767 |
| `large` | 200 | image/jpeg | 688,767 |

`[inference]` the size segment names a real small/medium/large set, but `medium`
and `large` returned the identical byte length and an unrecognised segment
(`background/xyz/…`) also returned HTTP 200, so the segment's semantics (whether
`large` is distinct, whether unknown values fall back) were **not** confirmed —
see §8. What is confirmed is the byte size: Cinemeta's `medium` backdrop is
~673 KiB, which is **above the protocol's own stated 500kb cap** for `background`
(§1). A four-slide hero drawn from Cinemeta therefore pulls roughly 4 × 673 KiB
≈ 2.6 MiB if it uses `medium` as sent.

---

## 3. What the Host reads today, and the cost of widening it

### 3.1 The Host reads neither field, on either shape

- A catalog item is read into `MetaPreview`
  (`crates/host-core/src/catalog.rs:32-49`), whose doc comment names the dropped
  fields explicitly: "Fields the Host has no use for yet — `background`, `logo`,
  `links`, `trailers`, `behaviorHints`, `videos` — are ignored rather than
  refused." The parse (`catalog.rs:179-203`) reads `id`, `type`, `name`, `poster`,
  `posterShape`, `releaseInfo`, `imdbRating`, `genres`, `description` and nothing
  else. The window's mirror type confirms it (`src/host-client.ts:251-262`).
- A meta answer is read into `Title` (`crates/host-core/src/meta.rs:54-82`). The
  module preamble (`meta.rs:29-34`) says the same: "Only the fields this Host acts
  on are read. A meta response carries far more — … `imdb_id`, `background` and
  `logo`, … — and all of it is ignored rather than refused, because reading a
  field nothing acts on is a promise this Host would not be keeping (ADR-0009)."
  The parse (`meta.rs:218-246`) reads `poster`, `description`, `releaseInfo`,
  `runtime`, `imdbRating`, `genres`, `videos` — no `background`, no `logo`. A test
  (`meta.rs:571-580`, `fields_this_host_has_no_use_for_are_ignored_rather_than_refused`)
  asserts a Cinemeta answer carrying `background`/`logo` still parses.

### 3.2 What widening the read costs

Reading the fields is small and local, and adds **no** I/O:

- `MetaPreview` gains `background: Option<String>` and `logo: Option<String>`,
  read in `meta_preview` exactly as `poster` is (`object.get("background")
  .and_then(non_empty_string)`) — one line each, bounded by the same
  `MAX_STRING_LEN` and the same page `MAX_CATALOG_BYTES` that already apply.
- `Title` gains the same two fields, read in `Title::parse` as `poster` is
  (`meta.and_then(|meta| field(meta, "background"))`), bounded by `MAX_STRING_LEN`
  and `MAX_META_BYTES`.
- `CatalogRow` and the window's `MetaPreview`/`Title` mirrors
  (`src/host-client.ts`) gain the two fields so they reach the client.
- No new Action, no new fetch, no cache change: the bytes were already downloaded
  (Cinemeta sends them on every item) and are being discarded today.

### 3.3 Is widening the read "a decision to record"?

ADR-0009's rule, as ADR-0011 restated it for a meta answer
(`docs/adr/0011-…md:51-58`): "Only the fields this Host acts on are read … every
thing else a meta response carries — `background`, `logo`, … — is ignored rather
than refused. Reading a field nothing acts on is a promise this Host would not be
keeping; **it arrives with the ticket that draws it**." ADR-0009 rejects reading a
manifest's `logo`/`background` for the same reason
(`docs/adr/0009-…md:74-79`).

So widening the read is **the sanctioned path** — this is the ticket that draws
it — and is *not* a violation of ADR-0009. It is, however, a change to a list that
is written down in three places that name `background`/`logo` as ignored:

- ADR-0011's paragraph above,
- the `meta.rs` module doc (lines 29-34),
- the `catalog.rs` `MetaPreview` doc (lines 29-31).

AGENTS.md's rule — "Where an ADR contradicts what you are about to do, say so
explicitly instead of silently overriding it" — therefore applies. The
recommendation is a short ADR (or an explicit Amendment line on ADR-0011) that
records *"the Host now reads `background`/`logo` on a Meta preview and a meta
answer because the hero and the Title screen draw them"*, and that the two module
docs' ignored-field sentences and the test comment are updated with it. This is a
documentation book-keeping decision, not an architectural one: it changes no
seam, no Action, and no Snapshot shape, and the hero's data still travels as an
`Answer` (ADR-0010), not as shared state.

---

## 4. TMDB's backdrop paths and sizes

Building on `tmdb-discovery-and-id-mapping.md` §2 and §6, re-verified 2026-10-16:

- **Sizes** — `GET /3/configuration`
  (<https://developer.themoviedb.org/reference/configuration-details>) returns:
  ```json
  "backdrop_sizes": ["w300", "w780", "w1280", "original"],
  "poster_sizes":   ["w92", "w154", "w185", "w342", "w500", "w780", "original"],
  "logo_sizes":     ["w45", "w92", "w154", "w185", "w300", "w500", "original"]
  ```
  `w780` is the one width shared by the poster and backdrop lists — which is why
  the repo's hard-coded `IMAGE_ROOT = "https://image.tmdb.org/t/p/w780"`
  (`crates/host-core/src/tmdb.rs:44-45`) happens to be a valid backdrop size as
  well as a valid poster size. The backdrop list itself offers no width between
  `w300` (small) and `w780`; for a 1080p/4K ten-foot hero the meaningful names are
  `w1280` and `original`.
- **The record carries the path inline.** A `/discover/movie` result
  (<https://developer.themoviedb.org/reference/discover-movie>) and a
  `/trending/movie/{time_window}` result
  (<https://developer.themoviedb.org/reference/trending-movies>) both include
  `"backdrop_path": "/8YFL5QQVPy3AgrEQxNYVSgiPEbe.jpg"` — a **relative path**, so
  the absolute URL is `https://image.tmdb.org/t/p/<size><backdrop_path>`. No
  secondary call is needed to learn the path: the row itself carries it, exactly
  as it carries `poster_path`.
- **The mapping a TMDB backdrop would need is the one the sibling note already
  wrote.** A Title reaches a TMDB record directly when its id is `tmdb:<id>`, or
  through `/find/{imdb}?external_source=imdb_id` when it is `tt…` and a credential
  is held; the reverse (`external_ids`) and `append_to_response` behaviour are
  §7 there. That bridge is a **per-Title network hop** where the id is `tt`-only.

Facts the hero decision turns on: a TMDB-sourced row (Discover) has the backdrop
path for free in the same answer, while an Addon-sourced Home hero over `tt`-only
items would need the bridge — a call the "no extra Host call to draw Home" goal
does not want.

---

## 5. The mapping and the fallback chain

Where each source can serve a backdrop, and what it costs:

| Source | Where the art is | Cost to read it | Works for |
|---|---|---|---|
| Addon catalog item `background` | on the `browse_catalog` row, already fetched | none (widen `MetaPreview`) | any Addon that sends it (Cinemeta, stremboxd) |
| Addon meta answer `background` | on the `open_title` answer | one `open_title` per Title | an Addon whose preview omits it but whose meta has it |
| Addon `logo` | beside either of the above | none | an overlay/wordmark, not a full-bleed backdrop |
| `posterShape: "landscape"` poster | on the catalog item | none | an Addon that offers landscape posters (Cinemeta never declares it) |
| TMDB `backdrop_path` | on a TMDB discover/trending row, or after a `/find` + details hop | free on a TMDB row; a call otherwise | a Title with a TMDB record, Discover rows, the Title screen |

`[inference]` A sensible fallback chain, in order: **(1)** the catalog item's
`background`; **(2)** if the Catalog declared `posterShape: "landscape"`, the
poster; **(3)** no art — draw the slide from the name and description on a
neutral field, the way the IA already says Home has *no hero* when the Featured
catalog answers with nothing. `logo`, if read, is an overlay decision for the
component kit (#50), not a backdrop. What the chain should **not** do is reach for
TMDB on the hero path: that turns drawing Home into N bridge calls and re-opens
"how does an unmapped Title get art", which #53 owns.

---

## 6. Recommendation: the source, the seam, and why not `open_title`

**Source.** The Addon's own `background`, read from the **Catalog item**, with
`logo` carried beside it for the kit to use as it likes.

**Seam.** Widen the existing catalog-item read — `MetaPreview` (and, for the
Title screen, `Title`) gain `background`/`logo` — and draw the hero from the
Featured catalog's `browse_catalog` row, `Answer::Catalogs`
(`crates/host-core/src/host.rs:660-674`, `1114-1142`). Concretely:

- Home draws the hero from the **first items of the Featured catalog's page**, the
  same `browse_catalog` answer Home already needs for that row (and for every other
  row). The `background`/`logo` fields ride on those items once `MetaPreview` reads
  them.
- **No `open_title` is needed to draw Home.** `open_title` today is one Addon
  `meta` fetch plus a `tmdb_refine` (which can add a `/find` and a `/details` hop)
  per Title (`host.rs:706-721`, `1206-1262`). Doing that for four slides is four
  extra Addon fetches — and up to eight more TMDB calls — *every time Home draws*,
  against the stated IA goal that drawing Home costs no extra Host call. The hero
  also opens through `open_title` **on press** (it is one button), which is the
  same path a card takes; that press is a person's action, not the cost of drawing.
- The window's `MetaPreview`/`Title` mirrors (`src/host-client.ts`) gain the fields
  so the client can render them, and the meta.rs/catalog.rs ignored-field docs and
  ADR-0011's list are updated with a short ADR (§3.3).

**Rejected, with reasons:**

- **`open_title` per hero Title** — the extra calls above; the art is already in
  the preview.
- **A TMDB backdrop for the Home hero** — the Featured catalog is an Addon
  Catalog, and its `tt`-only items carry no TMDB id, so each would need the
  `/find` bridge; TMDB cannot say whether any Addon can play the item anyway (the
  sibling note §9), which is backwards for a row that is *about* playable Titles.
  TMDB's backdrop belongs to **Discover** (#53), where the row is TMDB's own and
  carries `backdrop_path` for free, and to the **Title** screen, where a mapping
  already happened.
- **Scraping `medium`/`large` size segments, or metahub's own sizes** — Cinemeta
  sends one URL; the Host should use what it is sent (and the size segment's
  semantics were not confirmed, §8).
- **Persisting or pre-fetching the images** — out of Host scope: the Host hands a
  client a URL; the window fetches the picture the same way it already fetches a
  poster.

**Why this meets the goal.** The Featured catalog's page is fetched by the one
`browse_catalog` Home already makes; the backdrop URLs were on that page and are
now read instead of dropped. Drawing Home stays one Host call per row (the
Featured catalog's among them), zero `open_title`, zero TMDB traffic.

The one thing #53 should carry forward: for **Discover**, the same
"no extra call" property holds on the TMDB side — a trending/discover row's
`backdrop_path` is inline — so a Discover hero/feature can read TMDB backdrops at
`w1280`/`original` with no bridge hop for the art.

---

## 7. Negatives — what is not true

- **The protocol's documented Meta Preview field list does not include
  `background`/`logo`.** The SDK type does; the prose does not. Any claim that the
  preview "is specified to carry a backdrop" is false; the honest statement is
  that the SDK's `MetaPreview` exposes it and real Addons send it.
- **Cinemeta's manifest carries no `logo` or `background`.** The Addon's art is on
  its resource answers, not its manifest.
- **The Host reads neither field today** — on the catalog item (`MetaPreview`) or
  on the meta answer (`Title`). Both are listed as ignored in code and in
  ADR-0011.
- **TMDB discover/trending give a relative path, not a URL**, and no width or
  height: the size is a path segment the caller chooses from `backdrop_sizes`.
- **TMDB does not guarantee a backdrop for every record** — the response schemas
  type `backdrop_path` as a string and the examples populate it, but no nullability
  guarantee is stated (the sibling note §10 flags the same for `imdb_id`).
- **TMDB knows nothing about Addon playability**, and a TMDB backdrop for a
  `tt`-only Addon item needs the id bridge (sibling note §7, §9).
- **The Host has no mapping from a catalog item to a TMDB record today.** The
  `Meta preview` carries the Addon's id (`tt…` or `tmdb:…`), and only
  `open_title`'s `tmdb_refine` parses/bridges it.

---

## 8. Could not confirm

- **Whether Stremio's own client uses a preview's `background` for its
  featured/hero banner, or falls back to the poster.** The protocol doc only says
  the *poster* is "used as the background shown on the stremio discover page in
  the sidebar"; I did not read `stremio-core` / the Stremio web UI source to
  confirm which field its hero actually draws.
- **The meaning of the `<size>` segment in a metahub `background` URL.** `small`
  and `medium` differed (28,212 vs 688,767 bytes) but `medium` and `large`
  returned the same length, and an unrecognised segment returned HTTP 200, so
  whether `large` is a distinct asset and how unknown values resolve is not
  established.
- **Whether the protocol's 500kb `background` cap is enforced anywhere.**
  Cinemeta's `medium` backdrop measured ~673 KiB on 2026-10-16, above the cap, and
  Stremio still serves it; no enforcement was observed.
- **How many real Addons send a preview `background`.** Sampled: Cinemeta (movies
  and series) and stremboxd both send it; that is two Addons, not a general rule.
- **`backdrop_path` nullability on TMDB results.** Typed as a string with the
  examples populated; the page states no guarantee (mirrors the sibling note's
  `imdb_id` caveat).
- **`meta.videos[].thumbnail` and `metasDetailed`** (Native EPG) were not
  explored; neither bears on a four-slide hero.
