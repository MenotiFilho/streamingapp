# TMDB discovery, and how a TMDB-discovered Title reaches an Addon

**Date of research:** 2026-10-16. **Where:** primary sources only — TMDB's own
API reference at `developer.themoviedb.org` (each reference page inlines its
OpenAPI definition, which is what is quoted below), the Stremio addon protocol
docs, two live/public addon manifests, and this repo's own code where the
question is "what does the Host already do". No design recommendations; facts and
their source links, including the negatives.

Issue #48, child of #47 (the new-UI map). Read with `CONTEXT.md` (*Title*,
*Unmapped Title*, *Meta preview*, *Catalog*, *Stream*, *Credential*),
ADR-0010 (the catalog request path), ADR-0011 (opening a Title), ADR-0009 (the
Fetcher and the TMDB credential), ADR-0016 §2 (credentials in the secret store).

## Sources, and what each one is

| Source | URL | What it grounds |
|---|---|---|
| TMDB `/discover/movie` | <https://developer.themoviedb.org/reference/discover-movie> | movie filters, `sort_by`, response shape |
| TMDB `/discover/tv` | <https://developer.themoviedb.org/reference/discover-tv> | tv filters, response shape |
| TMDB `/genre/movie/list` | <https://developer.themoviedb.org/reference/genre-movie-list> | movie genre ids |
| TMDB `/genre/tv/list` | <https://developer.themoviedb.org/reference/genre-tv-list> | tv genre ids |
| TMDB `/configuration` | <https://developer.themoviedb.org/reference/configuration-details> | image base URLs and size lists |
| TMDB `/movie/{id}/external_ids` | <https://developer.themoviedb.org/reference/movie-external-ids> | TMDB → IMDb for films |
| TMDB `/tv/{id}/external_ids` | <https://developer.themoviedb.org/reference/tv-series-external-ids> | TMDB → IMDb (and TVDB) for series |
| TMDB `/find/{external_id}` | <https://developer.themoviedb.org/reference/find-by-id> | IMDb → TMDB |
| TMDB `/movie/{id}` details | <https://developer.themoviedb.org/reference/movie-details> | `imdb_id` on a details record; `append_to_response` |
| TMDB `/movie/popular` | <https://developer.themoviedb.org/reference/movie-popular-list> | the popular feed |
| TMDB `/trending/movie/{time_window}` | <https://developer.themoviedb.org/reference/trending-movies> | the trending feed |
| TMDB `/trending/tv/{time_window}` | <https://developer.themoviedb.org/reference/trending-tv> | the trending feed |
| TMDB auth (Application) | <https://developer.themoviedb.org/docs/authentication-application> | `api_key` query vs Bearer token |
| TMDB Rate Limiting | <https://developer.themoviedb.org/docs/rate-limiting> | the 40 req/s range, `429` |
| TMDB FAQ | <https://developer.themoviedb.org/docs/faq> | attribution, no SLA, free for non-commercial |
| TMDB Append To Response | <https://developer.themoviedb.org/docs/append-to-response> | which methods support `append_to_response` |
| Stremio addon protocol | <https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/protocol.md> | resources, URL shape, `tt` ids |
| Stremio manifest object | <https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/manifest.md> | `idPrefixes`, catalog `extra` |
| Stremio meta object | <https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/meta.md> | meta id, video id, film video == item id |
| Cinemeta live manifest | <https://v3-cinemeta.strem.io/manifest.json> | a real `idPrefixes: ["tt"]` addon |
| `mrcanelas/tmdb-addon` API doc | <https://github.com/mrcanelas/tmdb-addon/blob/main/docs/api.md> | a real `tmdb:`-keyed addon |
| `mhdzumair/MediaFusion` manifest source | <https://github.com/mhdzumair/MediaFusion/blob/main/backend/src/routes/manifest.rs> | a real addon declaring `tmdb:` beside `tt` |

All URLs re-fetched 2026-10-16. Repo citations are file paths in this worktree
(`research/tmdb-discovery`), which is the same tree as `main` at `738bfd3`.

---

## 0. The answer in one paragraph

TMDB's `/discover/movie` and `/discover/tv` return a page of TMDB records filtered
by genre ids, date ranges, original language, region and a fixed set of sort
orders; the genre ids come from two type-specific lists; images are addressed
from a base URL and size names that `/configuration` hands out; the credential is
either a v3 `api_key` query item or a v4 read-access Bearer token (the Host's
`Credential` already handles both). A discovered record carries **only its TMDB
numeric id** — no IMDb id, no external ids, no availability. The id bridge is one
extra hop: `/movie/{id}/external_ids` (or `/tv/{id}/external_ids`) gives
`imdb_id`; the reverse is `/find/{imdb}?external_source=imdb_id`. Stremio addons
answer to an opaque `{type}/{id}` and declare which id prefixes they accept
(`idPrefixes`); a `tt…` id is what Cinemeta and most stream addons accept, while
`tmdb:<id>` is a real, declared prefix on a number of addons (and `tmdb:<id>:<s>:<e>`
for episodes). TMDB does **not** know which addon, if any, can play a record.

---

## 1. Authentication

TMDB's *Application* page is explicit
(<https://developer.themoviedb.org/docs/authentication-application>):

> Version 3 is controlled by either a single query parameter, `api_key`, or by
> using your access token as a `Bearer` token.

and:

> Both authentication methods provide the same level of access, and which one you
> choose is completely up to you.

- **v3 API key** — a query parameter `api_key` on the URL.
- **v4 API read-access token** — a JWT sent as `Authorization: Bearer <token>`.

The OpenAPI definitions on every reference page declare the security scheme as
`apiKey` in the `Authorization` header with `x-bearer-format: bearer`, i.e. the
documented examples all use the Bearer form
(<https://developer.themoviedb.org/reference/discover-movie>).

What the Host already does, as facts about this repo (not choices to revisit):

- `crates/host-core/src/tmdb.rs:137-175` — `Credential::{Query, Bearer}`.
  `Credential::parse` decides by *shape*: a string starting `ey` with exactly two
  `.` is a Bearer, everything else is a v3 `api_key`; a v3 key "cannot travel as
  a header — TMDB answers 401 to that" (`tmdb.rs:13-19`). `query()` and
  `header()` return the one place each shape travels, never both.
- `crates/host-core/src/tmdb.rs:42` — `TMDB_ROOT = "https://api.themoviedb.org/3"`.
- `crates/host-core/src/secret.rs:82-113` — `TmdbKey::parse` judges shape only
  (non-empty, ≤ 4096 chars, no control character, no space) and does not know
  what a key looks like on the inside; both key forms are accepted.
- `crates/host-core/src/action.rs:49-56` — the keys are stored by
  `Action::SetTmdbKey { key }` / `Action::ClearTmdbKey`.
- `crates/host-core/src/host.rs:578-597` — the Action writes/removes
  `CredentialKind::TmdbKey` in the secret store; the Snapshot carries only the
  boolean `protection.tmdb_held` (`host.rs:105`), never the value. ADR-0016 §2 is
  the general rule ("credentials live in the secret store and never enter
  Snapshots or logs").
- ADR-0009 (`docs/adr/0009-…md:8-12`) is why the Host's `Fetcher` grew a
  `fetch_with_headers` default: a v4 read-access token travels in
  `Authorization`, so the seam has to carry one header without every fetcher
  implementing both.

---

## 2. `/configuration` — image base URLs and size names

`GET /3/configuration`
(<https://developer.themoviedb.org/reference/configuration-details>) returns an
`images` object and a `change_keys` list. The `images` object, verbatim from the
inlined example:

```json
{
  "images": {
    "base_url": "http://image.tmdb.org/t/p/",
    "secure_base_url": "https://image.tmdb.org/t/p/",
    "backdrop_sizes": ["w300", "w780", "w1280", "original"],
    "logo_sizes": ["w45", "w92", "w154", "w185", "w300", "w500", "original"],
    "poster_sizes": ["w92", "w154", "w185", "w342", "w500", "w780", "original"],
    "profile_sizes": ["w45", "w185", "h632", "original"],
    "still_sizes": ["w92", "w185", "w300", "original"]
  },
  "change_keys": ["adult", "air_date", …]
}
```

Facts that matter to the UI:

- There are **two** base URLs and the unencrypted one is returned first
  (`http://image.tmdb.org/t/p/`). The FAQ says SSL "is currently available API
  wide … We strongly recommend you use SSL"
  (<https://developer.themoviedb.org/docs/faq>), so the usable base is
  `secure_base_url`.
- The size name is a path segment between the base and the record's
  `poster_path`/`backdrop_path`, e.g. `https://image.tmdb.org/t/p/w342/<poster_path>`.
- `poster_sizes` and `backdrop_sizes` are **different lists**: a poster can be
  `w342`/`w500`/`w780`; a backdrop's smallest documented width is `w300`
  (there is no `w342` backdrop).
- The record's `poster_path`/`backdrop_path` is a **relative path** (leading
  `/`); the absolute URL is built from the base and the size.
- Repo: `crates/host-core/src/tmdb.rs:44-45` hard-codes
  `IMAGE_ROOT = "https://image.tmdb.org/t/p/w780"`, and
  `Record::poster` (`tmdb.rs:352-355`) concatenates it with the record's
  `poster_path`. `w780` is a member of the documented `poster_sizes` list above.
  The repo requests no backdrop size today (the `background` field a meta
  response may carry is ignored — `crates/host-core/src/meta.rs:29-34`).

---

## 3. Genre id lists — `/genre/movie/list` and `/genre/tv/list`

Both return `{"genres":[{"id":<int>,"name":<string>}]}` and both take a
`language` query item (default `"en"`)
(<https://developer.themoviedb.org/reference/genre-movie-list>,
<https://developer.themoviedb.org/reference/genre-tv-list>).

### 3.1 Movies

| id | name |
|---|---|
| 28 | Action |
| 12 | Adventure |
| 16 | Animation |
| 35 | Comedy |
| 80 | Crime |
| 99 | Documentary |
| 18 | Drama |
| 10751 | Family |
| 14 | Fantasy |
| 36 | History |
| 27 | Horror |
| 10402 | Music |
| 9648 | Mystery |
| 10749 | Romance |
| 878 | Science Fiction |
| 10770 | TV Movie |
| 53 | Thriller |
| 10752 | War |
| 37 | Western |

### 3.2 TV

| id | name |
|---|---|
| 10759 | Action & Adventure |
| 16 | Animation |
| 35 | Comedy |
| 80 | Crime |
| 99 | Documentary |
| 18 | Drama |
| 10751 | Family |
| 10762 | Kids |
| 9648 | Mystery |
| 10763 | News |
| 10764 | Reality |
| 10765 | Sci-Fi & Fantasy |
| 10766 | Soap |
| 10767 | Talk |
| 10768 | War & Politics |
| 37 | Western |

Facts for a type × genre filter:

- The two lists are **not** the same set, and the same numeric id means the same
  genre across both only where they overlap (16 Animation, 35 Comedy, 80 Crime,
  99 Documentary, 18 Drama, 10751 Family, 9648 Mystery, 37 Western). Movie
  `28 Action` has no tv counterpart; tv `10759 Action & Adventure` has no movie
  counterpart. A "type × genre" filter therefore needs the list for the type.
- `with_genres` takes **ids**, not names (see §4), so a name shown in the UI
  must be mapped back to the id by the type's own list.
- **Names are localized by `language`.** The movie-list example on the reference
  page is a German rendering (`35 → "Komödie"`, `878 → "Science Fiction"` is the
  untranslated exception), which is the visible proof that the name is a
  translation while the id is stable.

---

## 4. `/discover/movie`

`GET /3/discover/movie` — "Find movies using over 30 filters and sort options"
(<https://developer.themoviedb.org/reference/discover-movie>).

### 4.1 The parameters that matter here

| Parameter | Type | Notes (quoted or from the schema) |
|---|---|---|
| `with_genres` | string | "can be a comma (`AND`) or pipe (`OR`) separated query" — numeric ids |
| `without_genres` | string | the inverse |
| `primary_release_year` | int32 | single year |
| `primary_release_date.gte` / `.lte` | date | the primary-release range |
| `release_date.gte` / `.lte` | date | a different date (all releases) |
| `region` | string | ISO-3166-1; "If you specify the region parameter, the regional release date will be used instead of the primary release date" |
| `with_release_type` | int32 | values 1–6, comma/pipe; "can be used in conjunction with `region`" |
| `sort_by` | enum | default `popularity.desc`; see below |
| `page` | int32 | default `1` |
| `language` | string | default `en-US` |
| `include_adult` | bool | default `false` |
| `include_video` | bool | default `false` |
| `vote_average.gte` / `.lte` | float | rating band |
| `vote_count.gte` / `.lte` | float | votes band |
| `with_runtime.gte` / `.lte` | int32 | minutes |
| `with_original_language` | string | ISO-639-1 |
| `with_origin_country` | string | |
| `watch_region` | string | "use in conjunction with `with_watch_monetization_types` or `with_watch_providers`" |
| `with_watch_providers` | string | comma/pipe |
| `with_watch_monetization_types` | string | `[flatrate, free, ads, rent, buy]` |
| `with_cast` / `with_crew` / `with_people` | string | comma/pipe |
| `with_companies` / `without_companies` | string | |
| `with_keywords` / `without_keywords` | string | |
| `certification`, `certification.gte`, `certification.lte`, `certification_country` | string | certification filtering |

`sort_by` enum (movie): `original_title.asc|desc`, `popularity.asc|desc`,
`revenue.asc|desc`, `primary_release_date.asc|desc`, `title.asc|desc`,
`vote_average.asc|desc`, `vote_count.asc|desc`. Default `popularity.desc`.

`AND`/`OR` logic, quoted from the page's own preamble: "Comma's are treated like
an `AND` query while pipe's are treated like an `OR`."

### 4.2 Response shape (movie)

`{"page":<int>,"results":[…],"total_pages":<int>,"total_results":<int>}`, and each
result is:

```json
{
  "adult": false,
  "backdrop_path": "/8YFL5QQVPy3AgrEQxNYVSgiPEbe.jpg",
  "genre_ids": [28, 12, 878],
  "id": 640146,
  "original_language": "en",
  "original_title": "Ant-Man and the Wasp: Quantumania",
  "overview": "Super-Hero partners Scott Lang …",
  "popularity": 9272.643,
  "poster_path": "/ngl2FKBlU4fhbdsrtdom9LVLBXw.jpg",
  "release_date": "2023-02-15",
  "title": "Ant-Man and the Wasp: Quantumania",
  "video": false,
  "vote_average": 6.5,
  "vote_count": 1856
}
```

Note what is **not** in it: no `imdb_id`, no external ids, no availability. The
`genre_ids` are the numeric ids from §3.1; `vote_average` is TMDB's own score,
not `imdbRating`. Paging is `page` + `total_pages` + `total_results`.

---

## 5. `/discover/tv`

`GET /3/discover/tv` — "Find TV shows using over 30 filters and sort options"
(<https://developer.themoviedb.org/reference/discover-tv>).

### 5.1 The parameters that differ from movie

| Parameter | Type | Notes |
|---|---|---|
| `with_genres` / `without_genres` | string | numeric ids from §3.2, comma/pipe |
| `first_air_date.gte` / `.lte` | date | the series' first-air range |
| `first_air_date_year` | int32 | single year |
| `air_date.gte` / `.lte` | date | any air date |
| `with_original_language` | string | |
| `with_origin_country` | string | (tv has this; movie's analogue is `with_origin_country` too) |
| `with_networks` | int32 | |
| `with_status` | string | `[0,1,2,3,4,5]`, comma/pipe |
| `with_type` | string | `[0,1,2,3,4,5,6]`, comma/pipe |
| `include_null_first_air_dates` | bool | default `false` |
| `screened_theatrically` | bool | |
| `timezone` | string | |
| `with_runtime.gte` / `.lte` | int32 | |
| `vote_average.gte` / `.lte`, `vote_count.gte` / `.lte` | float | |
| `watch_region`, `with_watch_providers`, `with_watch_monetization_types` | | as movie |
| `with_companies`, `without_companies`, `with_keywords`, `without_keywords` | string | |
| `page` | int32 | default `1` |
| `language` | string | default `en-US` |
| `include_adult` | bool | default `false` |

`sort_by` enum (tv): `first_air_date.asc|desc`, `name.asc|desc`,
`original_name.asc|desc`, `popularity.asc|desc`, `vote_average.asc|desc`,
`vote_count.asc|desc`. Default `popularity.desc`.

**There is no `region` parameter on `/discover/tv`** (the movie-only regional
release-date behaviour has no tv equivalent in the documented parameter list).

### 5.2 Response shape (tv)

`{"page":<int>,"results":[…],"total_pages":<int>,"total_results":<int>}`, each
result:

```json
{
  "backdrop_path": "/mAJ84W6I8I272Da87qplS2Dp9ST.jpg",
  "first_air_date": "2023-01-23",
  "genre_ids": [9648, 18],
  "id": 202250,
  "name": "Dirty Linen",
  "origin_country": ["PH"],
  "original_language": "tl",
  "original_name": "Dirty Linen",
  "overview": "To exact vengeance, …",
  "popularity": 2684.061,
  "poster_path": "/ujlkQtHAVShWyWTloGU2Vh5Jbo9.jpg",
  "vote_average": 5,
  "vote_count": 13
}
```

Differences from a movie result: the name field is `name` (movie: `title`), the
date is `first_air_date` (movie: `release_date`), and there is no `adult` /
`video` field. Again: no `imdb_id`, no external ids.

> The **series-vs-series case**: TMDB's `id` for a series is the same numeric id
> used by `/tv/{series_id}/external_ids` (§7). The `type` the addon protocol
> uses for a series is `series`, while TMDB's path says `tv` — the mapping is
> already in the repo at `tmdb.rs:47-84` (`Kind::{Movie, Tv}`,
> `Kind::parse("series") == Some(Tv)`).

---

## 6. Stable "popular / trending" feeds (a Home row)

TMDB documents both, and both are **discover calls underneath**, so they are
stable and page-shaped:

- **Popular:** `GET /3/movie/popular?language=&page=&region=`
  (<https://developer.themoviedb.org/reference/movie-popular-list>). The page
  carries an explicit note: "This call is really just a discover call behind the
  scenes", with the equivalent
  `/discover/movie?…&sort_by=popularity.desc`. A `tv` counterpart
  (`/tv/popular`) is not quoted here but is the same family; see §11.
- **Trending:** `GET /3/trending/movie/{time_window}` and
  `GET /3/trending/tv/{time_window}`, where `time_window` is `day` or `week`
  (default `day`), plus `language`
  (<https://developer.themoviedb.org/reference/trending-movies>,
  <https://developer.themoviedb.org/reference/trending-tv>). The result items
  carry a `media_type` field (`"movie"` / `"tv"`) and the same fields as a
  discover result (id, title/name, poster_path, backdrop_path, release/first-air
  date, `genre_ids`, `vote_average`, `vote_count`, `popularity`,
  `original_language`), and the response has `page`, `total_pages`,
  `total_results`.

So: yes — TMDB exposes a stable popular/trending feed with a documented URL
shape, which is a candidate for a Home row. Both are page-based and carry only
TMDB ids (the id-bridge requirement of §7 applies identically).

The documented parameters for both trending endpoints are only `time_window`
and `language`; the response is nevertheless page-shaped (`page`,
`total_pages`), and the example shows `total_pages: 1000`.

---

## 7. The id bridge: a TMDB id to the id an addon answers to

### 7.1 TMDB id → IMDb id

- `GET /3/movie/{movie_id}/external_ids`
  (<https://developer.themoviedb.org/reference/movie-external-ids>):
  `{"id":550,"imdb_id":"tt0137523","wikidata_id":null,"facebook_id":"FightClub","instagram_id":null,"twitter_id":null}`.
  Supported sources are IMDb, Wikidata, Facebook, Instagram, Twitter.
- `GET /3/tv/{series_id}/external_ids`
  (<https://developer.themoviedb.org/reference/tv-series-external-ids>):
  `{"id":1399,"imdb_id":"tt0944947","freebase_mid":…,"tvdb_id":121361,"tvrage_id":24493,"wikidata_id":"Q23572","facebook_id":…,"instagram_id":…,"twitter_id":…}`.
  A series' external ids also carry `tvdb_id` and `tvrage_id`.

The **details** endpoints carry `imdb_id` directly on the record —
`/movie/{id}`'s response includes `"imdb_id":"tt0076759"`
(<https://developer.themoviedb.org/reference/movie-details>) — and
`append_to_response` can fold `external_ids` into the same request:
`/movie/11?append_to_response=external_ids,images`
(<https://developer.themoviedb.org/docs/append-to-response>). The append doc
scopes this: `append_to_response` "is available on the movie, TV show, TV
season, TV episode and person detail methods" — i.e. **not** on `/discover/*`,
`/trending/*`, `/movie/popular`, or `/search/*`. A Discover result's TMDB id
therefore needs one further request (a details call, with or without an append)
to learn its `imdb_id`.

### 7.2 IMDb id → TMDB id (the reverse)

`GET /3/find/{external_id}?external_source=imdb_id`
(<https://developer.themoviedb.org/reference/find-by-id>) returns
`movie_results`, `tv_results`, `person_results`, `tv_episode_results`,
`tv_season_results`; each result carries `id`, `media_type`, `title`/`name`,
`poster_path`, `release_date`, `genre_ids`, and so on. The `external_source`
enum is `imdb_id, facebook_id, instagram_id, tvdb_id, tiktok_id, twitter_id,
wikidata_id, youtube_id`. IMDb works for movies, TV shows, TV episodes and
people (per the supported-sources table on the same page).

This is exactly what the Host already sends: `TmdbRequest::Find` builds
`…/find/{imdb}?external_source=imdb_id` (`crates/host-core/src/tmdb.rs:186-208`),
and `read_find` reads `movie_results` or `tv_results` by the Title's kind
(`tmdb.rs:288-313`); `Host::tmdb_refine` asks it only when a Title's id is an
IMDb id and a credential is held (`crates/host-core/src/host.rs:1215-1237`).

### 7.3 `tt`-keyed vs `tmdb:`-keyed meta ids in the addon protocol

The protocol's own rules
(<https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/protocol.md>,
<https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/manifest.md>):

- A resource is requested at `/{resource}/{type}/{id}.json`. `id` is an **opaque
  string**: the meta object calls it a "universal identifier; you may use a
  prefix unique to your addon".
- An addon declares which ids it accepts with `idPrefixes` ("use this if you
  want your addon to be called only for specific content IDs — for example, if
  you set this to `["yt_id:", "tt"]` …"). `idPrefixes` may be set per resource
  (`{ name, types, idPrefixes? }`) or at the manifest top level. **`idPrefixes`
  does not apply to the `catalog` resource** — catalogs are asked for by name,
  and the Home search asks the catalogs that declare `search`.
- A resource with no `idPrefixes` matches every id of its declared types.
- `tt` is IMDb: the protocol example says "we set the id prefix of the streams to
  `tt`, which is the prefix for IMDB IDs (example: `tt1254207`)", and notes that
  with a `tt` id the addon need not implement `meta` "as all IMDB IDs … are
  handled internally by Stremio's Cinemeta Addon".
- **Cinemeta**, the addon the protocol points at, is live and declares exactly
  that: `"resources":["catalog","meta","addon_catalog"]`, `"types":["movie","series"]`,
  `"idPrefixes":["tt"]` — <https://v3-cinemeta.strem.io/manifest.json>. A `tt`
  id is what it answers for; a `tmdb:` id is not in its prefix list.
- A series' video id is `{title}:{season}:{episode}` — the meta docs' video
  example is `"id": "tt0108778:1:1"`, and "if you do not provide this [a
  `videos` array] (e.g. for `movie`), Stremio assumes this meta item has one
  video, and it's ID is equal to the meta item `id`"
  (<https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/meta.md>).
  So a film's stream id equals its meta id; a series episode's is the meta id
  with `:season:episode` appended.

`tmdb:`-keyed ids are a real, in-use convention, not something the protocol
docs name. Two live examples:

- **`mrcanelas/tmdb-addon`** ("The Movie Database Addon") declares
  `"idPrefixes": ["tmdb:", "tt"]` and answers both; its catalog items carry
  `{"id": "tmdb:106646", "type": "movie", …}`, its meta endpoint is
  `/meta/movie/tmdb:106646.json`, and a series' seasons are
  `{"id": "tmdb:106646:1"}` — i.e. `tmdb:{id}:{season}` for a season and, by the
  protocol's `{title}:{season}:{episode}` rule, `tmdb:{id}:{season}:{episode}`
  for an episode
  (<https://github.com/mrcanelas/tmdb-addon/blob/main/docs/api.md>).
- **`mhdzumair/MediaFusion`** declares
  `"idPrefixes": ["tt","tmdb:","tvdb:","mal:","mf","dl"]` on its `stream`
  resource, and on `meta` when IMDb metadata is enabled
  (<https://github.com/mhdzumair/MediaFusion/blob/main/backend/src/routes/manifest.rs>).

The repo's own reading of the `{title}:{season}:{episode}` shape is
`meta::episode_of` (`crates/host-core/src/meta.rs:150-158`), written so that a
namespaced title id (`kitsu:12345:1:1`) still reads as a title with two numbers
appended — so `tmdb:1399:1:2` reads as episode 2 of season 1 of `tmdb:1399` the
same way `tt0903747:1:2` does. The repo's doc comments name both title-id
spellings explicitly: "The id the Addon indexes the Title by: `tt0903747`,
`tmdb:603`" (`crates/host-core/src/request.rs:168`,
`crates/host-core/src/meta.rs:60`), and `tmdb:603` is likewise the example in
`ExternalId::parse` (`crates/host-core/src/tmdb.rs:103, 510`).

The repo's id parser already understands the two families
(`crates/host-core/src/tmdb.rs:116-134`):

```
ExternalId::parse(kind, id)
  "tmdb:<u32>"  → ExternalId::Tmdb(<u32>)          // the record's own id
  "tt<digits>"  → ExternalId::Imdb("tt<digits>")   // needs /find to map
  anything else → None
```

and restricts `kind` to `movie`/`series` (`tmdb.rs:58-66`). It also refuses
`tmdb:0`, an empty `tt`, and any other prefix (`tmdb.rs:522-538`).

`TitleKey` (`crates/host-core/src/meta.rs:90-99`) records which of the two the
Host keys a Title by: `{"kind":"tmdb","id":603}` or
`{"kind":"addon","addon":"com.linvo.cinemeta","id":"tt0133093"}`. A Meta
Preview or meta answer is opened by an **addon id plus `{type}/{id}`**
(`crates/host-core/src/meta.rs:54-65`); `Title::parse` sets `key` to the Addon
pair and never rewrites `id`/`type` from the body
(`meta.rs:218-229`); `tmdb_refine` may then set `key` to `TitleKey::Tmdb`
(`host.rs:1240-1259`) **without changing `title.id`**. That is ADR-0011's rule:
the identity a request travels under stays the client's/addon's id.

### 7.4 What `open_title` and `find_streams` send

Facts about the current request path (ADR-0010, ADR-0011):

- **`open_title`** — `Action::OpenTitle { addon: String, title: TitleRef }`
  (`crates/host-core/src/action.rs:102-108`). It resolves to
  `ResourceRequest::new(META, title.type, title.id)` (`META` is the protocol's
  `meta` resource) and is asked of the **one Addon the client named**
  (`crates/host-core/src/host.rs:706-720`). Before asking, `Manifest::answers`
  judges the request against that Addon's `types` and `idPrefixes`; if the
  Addon does not declare it, the Action is refused (`UnknownTitle`). So to open
  a TMDB-discovered Title in an addon, the `{type}/{id}` sent must be one that
  addon's `meta` resource accepts: `tt…` for a `tt`-only addon, `tmdb:…` for an
  addon that declares `tmdb:`. A single Addon cannot be asked "by TMDB id" if it
  does not declare that prefix.
- **`find_streams`** — `Action::FindStreams { video: VideoRef }`
  (`crates/host-core/src/action.rs:115-119`). It resolves to
  `ResourceRequest::new(STREAM, video.type, video.id)` (the protocol's `stream`
  resource) and is asked of **every configured Addon whose manifest answers**,
  in configuration order, each answer a group of its own
  (`crates/host-core/src/host.rs:722-746`; ADR-0010's per-Addon-failure rule,
  applied to Streams). The URL built is `{manifestUrl}/stream/{type}/{id}.json`
  (`crates/host-core/src/provider.rs:99-116`). For a film the `video.id` is the
  title id (protocol: film's single video id == item id); for a series episode
  it is `{title-id}:{season}:{episode}`.
- The credential is irrelevant to the identity: a `tmdb:` id is keyed by its
  record whether or not a key is held; a `tt` id is mapped through `/find` only
  when one is (`host.rs:1204-1205`, `1215-1237`).

In short, the two request shapes a TMDB-discovered Title needs are the same two
the Host already builds — `meta/{type}/{id}` and `stream/{type}/{id}` — where
`id` is either the `tt…` id the bridge produced or a `tmdb:<id>` the target
Addon declares, and an episode's `id` is that value with `:{season}:{episode}`
attached.

---

## 8. Rate limits and attribution

### 8.1 Rate limits

<https://developer.themoviedb.org/docs/rate-limiting>:

> As of December 16, 2019, we have disabled the original API rate limiting (40
> requests every 10 seconds.) … we do still have some upper limits to help
> mitigate needlessly high bulk scraping. They sit somewhere in the 40 requests
> per second range. This limit could change at any time so be respectful of the
> service we have built and respect the `429` if you receive one.

So: no fixed documented quota, an approximate 40 req/s ceiling, and a `429`
response that callers must respect.

### 8.2 Attribution

<https://developer.themoviedb.org/docs/faq>:

> You shall use the TMDB logo to identify your use of the TMDB APIs. You shall
> place the following notice prominently on your application: *"This product uses
> the TMDB API but is not endorsed or certified by TMDB."*
>
> Any use of the TMDB logo in your application shall be less prominent than the
> logo or mark that primarily describes the application … the attribution must be
> within your application's "About" or "Credits" type section.
>
> When using a TMDB logo, we require you to use one of our approved logos.

Further FAQ facts: the API is free "for non-commercial purposes as long as you
attribute TMDB as the source of the data and/or images"; commercial use needs a
license (`sales@themoviedb.org`); there is **no SLA**; TMDB should be called
"TMDB" or "The Movie Database", with links to <https://www.themoviedb.org>.

---

## 9. What TMDB does NOT give us

Every item here is a negative read off the schemas above, with the schema it was
read from:

- **No IMDb id on a Discover / popular / trending / search result.** Those result
  schemas carry `id`, `title`/`name`, `poster_path`, `backdrop_path`, the date,
  `genre_ids`, `vote_average`, `vote_count`, `popularity`, `original_language`,
  `overview`, `adult`/`video` (movie) or `origin_country` (tv) — and nothing
  else. The `imdb_id` lives on `/movie/{id}/external_ids`,
  `/tv/{id}/external_ids`, and the details records.
  (<https://developer.themoviedb.org/reference/discover-movie>,
  <https://developer.themoviedb.org/reference/discover-tv>)
- **No "which addon can play this".** TMDB is a metadata catalogue; it has no
  concept of a Stremio Addon, a torrent, a debrid service or a stream. The
  nearest thing it has is **commercial-provider availability** —
  `watch_region` / `with_watch_providers` / `with_watch_monetization_types`
  (`[flatrate, free, ads, rent, buy]`) on discover, i.e. which *streaming
  services* offer a title in a region — which says nothing about whether any
  Addon the Host is configured with answers for the title.
  (<https://developer.themoviedb.org/reference/discover-movie>)
- **No stream/file information of any kind** — no URL, no magnet, no quality, no
  file size. Those are the Stream domain (protocol `stream` resource) and nothing
  TMDB exposes.
- **No guarantee every record has an IMDb id.** The schema types `imdb_id` as a
  string and the examples populate it, but the external-ids examples show sibling
  fields as `null`, and the docs state no nullability guarantee for `imdb_id`. A
  bridge that assumes one exists can fail; §7.2's `/find` is the other direction
  and has the same problem in reverse. (See §10.)
- **No addon-side filter.** `/discover/tv` has no `region`; neither discover
  endpoint filters by anything outside TMDB's own taxonomy.
- **No `imdbRating`.** Discover/trending carry TMDB's `vote_average`; the repo's
  `Title.imdb_rating` comes from the Addon's meta answer, not from TMDB
  (`crates/host-core/src/meta.rs:237`).
- **No fixed quota or SLA** (§8.1, §8.2), so a bulk fan-out of
  external-id lookups is not something TMDB promises capacity for.
- **Discover does not accept `append_to_response`** (§7.1), so external ids can
  never ride along on the row itself.
- **No `tmdb:` in the Stremio protocol's own vocabulary.** The docs define `id`
  as opaque and `idPrefixes` as an addon's private filter; `tt` is named as
  IMDb, but `tmdb:` is only real because addons declare it (§7.3). Cinemeta —
  the addon the docs name as the IMDb-id handler — declares `["tt"]` only.

---

## 10. What I could not verify

- **A page cap on discover/list calls.** TMDB is widely said to cap `page` at
  500, but the `/discover/movie` reference page I read states no cap, and its
  example shows `total_pages: 38020`. Not asserted here.
- **Whether `page` is accepted by `/trending/*`.** The documented parameters are
  `time_window` and `language` only, while the response is page-shaped
  (`page`, `total_pages`, `total_results`). The docs do not say yes or no.
- **The exact nullability of `imdb_id`.** Both `movie-external-ids` and
  `tv-series-external-ids` type `imdb_id` as a string and populate it in the
  example; the pages do not state that every record has one. (The example's
  `wikidata_id`, `instagram_id` and `twitter_id` are `null`, so absent values are
  clearly possible for other sources.)
- **`/tv/popular` and `/movie/now_playing` / `/upcoming` / `/top_rated`.** Same
  family as `/movie/popular`, but I fetched only the endpoints cited in §1–§8;
  the others are not claimed here.
- **`/search/movie` and `/search/tv`.** A Discover surface usually wants search,
  and TMDB documents both, but I did not fetch them for this note.
- **TMDB's terms of use page itself.** Attribution and rate-limit facts here come
  from the two docs pages cited in §8; I did not read
  `themoviedb.org/documentation/api/terms-of-use`.
