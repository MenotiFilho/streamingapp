# TMDB Title caching, season batching, and catch-up watching: the facts

**Date of research:** 2026-11-07. **Where:** primary sources only — TMDB's
API reference at `developer.themoviedb.org` (every reference page inlines its
OpenAPI 3.1 definition; the pages now also serve a Markdown twin when `.md` is
appended to the URL, which is what is quoted below), TMDB's own support forum
posts written by TMDB staff or moderators, TMDB's Contribution Bible, TMDB's API
Terms of Use, and live HTTP responses from `api.themoviedb.org`. Two
well-known client codebases (TMDbLib and php-tmdb) are used only as
corroboration and are labelled as such. No design recommendations; facts and
their source links, including the negatives.

Context: a desktop Host opens a series' Title with `GET /3/tv/{id}` and then one
`GET /3/tv/{id}/season/{n}` per season, serially. The open questions are
`append_to_response` batching, `next_episode_to_air`/`last_episode_to_air`,
`status`/`in_production`, episode air dates and future episodes, Season 0,
rate limits and caching terms, and the two change feeds.

Read with `CONTEXT.md` (*Title*, *Video*, *Up next*). The repo's credential
and TMDB transport facts are in
`docs/research/tmdb-discovery-and-id-mapping.md` §1 and §7.

## Sources, and what each one is

| Source | URL | What it grounds |
|---|---|---|
| TMDB `/tv/{series_id}` reference | <https://developer.themoviedb.org/reference/tv-series-details> | details schema, `append_to_response` description, `status`, `in_production`, `seasons[]`, `last_episode_to_air`, `next_episode_to_air`, the GoT example |
| TMDB `/tv/{series_id}/season/{season_number}` reference | <https://developer.themoviedb.org/reference/tv-season-details> | season body and episode schema |
| TMDB `/tv/{series_id}/season/{season_number}/episode/{episode_number}` reference | <https://developer.themoviedb.org/reference/tv-episode-details> | single-episode schema (same episode shape) |
| TMDB `/tv/latest` reference | <https://developer.themoviedb.org/reference/tv-series-latest-id> | a second full details example, with nulls |
| TMDB Append To Response guide | <https://developer.themoviedb.org/docs/append-to-response> | what `append_to_response` does and where it exists |
| TMDB Rate Limiting guide | <https://developer.themoviedb.org/docs/rate-limiting> | the current documented limit |
| TMDB FAQ | <https://developer.themoviedb.org/docs/faq> | no SLA, free for non-commercial use, attribution |
| TMDB API Terms of Use | <https://www.themoviedb.org/api-terms-of-use> | the 6-month cache ceiling and deletion duty |
| TMDB TV Contribution Bible | <https://www.themoviedb.org/bible/tv> | status meanings |
| Bible — Seasons page | <https://www.themoviedb.org/bible/tv/59f73eb49251416e71000026> | "The special season is always Season 0" |
| Bible — Episodes page | <https://www.themoviedb.org/bible/tv/59f743289251416e71000037> | upcoming episodes, missing air dates, early cancellation |
| TMDB `/tv/changes` reference | <https://developer.themoviedb.org/reference/changes-tv-list> | the global TV change list |
| TMDB `/tv/{series_id}/changes` reference | <https://developer.themoviedb.org/reference/tv-series-changes> | the per-series change feed |
| TMDB (`/tv/season/{season_id}/changes`) reference | <https://developer.themoviedb.org/reference/tv-season-changes-by-id> | season-level changes |
| TMDB (`/tv/episode/{episode_id}/changes`) reference | <https://developer.themoviedb.org/reference/tv-episode-changes-by-id> | episode-level changes |
| Staff post: appending seasons | <https://www.themoviedb.org/talk/63ee22b4699fb7009e3e5102> | 2023 staff example `append_to_response=season/1,season/2`; 20-item behaviour; no wildcard |
| Staff post: append key naming | <https://www.themoviedb.org/talk/5b09473b0e0a267c15002fc9> | appended value key is literally `season/N`; a captured response body |
| Staff post: appended season has episodes | <https://www.themoviedb.org/talk/5b816a4dc3a368655101120a> | appended season answers "the detail of each episode" |
| Staff post: appending one season | <https://www.themoviedb.org/talk/59d2898cc3a36830800048f2> | 2017 staff example `append_to_response=season/1` |
| User report: appended season lacks `id` | <https://www.themoviedb.org/talk/5cde6cb10e0a260ad1cb27aa> | the `_id`-but-no-`id` caveat |
| Staff post: next/last episode fields added | <https://www.themoviedb.org/talk/5a69ad239251414a2800e7d9> | 2018: tickets #470/#471 added the two fields |
| Staff post: next-to-air is computed daily | <https://www.themoviedb.org/talk/5dfa117626dac1001758d80e> | nightly process and ~2 h cache |
| Captured details response with a non-null `next_episode_to_air` | <https://www.themoviedb.org/talk/55a626e2925141099b000dd9> | the field's real shape |
| Staff post: TV status strings | <https://www.themoviedb.org/talk/58b1cfbac3a368077800feb5> | the exact six-value list |
| Staff post: status number mapping | <https://www.themoviedb.org/talk/6685c10585e1cbe90c4a5fe0> | 2024 staff mapping 0–5 |
| Moderator post: a different status mapping | <https://www.themoviedb.org/talk/63e1a55dcb8028007fb50e08> | the 2023 conflicting table |
| Staff post: `in_production` | <https://www.themoviedb.org/talk/58deb4e99251411ba6010038> | 2017 meaning |
| Moderator post: status meanings live in the Bible | <https://www.themoviedb.org/talk/5b889c370e0a2679b70028a1> | 2021 pointer |
| Corroboration: TMDbLib (C#) | <https://github.com/LordMike/TMDbLib> | `TvShow.LastEpisodeToAir`/`NextEpisodeToAir` are one episode base type; `Status` is a free string |
| Corroboration: php-tmdb | <https://github.com/php-tmdb/api/issues/170> | real-world use of `season/1` in `append_to_response` |

All URLs re-fetched 2026-11-07. The reference pages carry their own
`updatedAt`: `tv-series-details` 2025-10-01, `tv-season-details` 2025-10-01,
`rate-limiting` 2025-10-20, `append-to-response` 2025-10-01.

---

## 0. The answers in one paragraph

Yes — a TV details call can append seasons: `?append_to_response=season/1,season/2`,
up to **20 appended items per request**, and the appended value lands in the
response root under the literal key `season/1` (staff statements, with a
captured response body). The appended season carries the season's episode
list, but TMDB never promises a byte-identical body to
`GET /tv/{id}/season/{n}`, and at least one user reports the numeric season
`id` missing from the appended object. `next_episode_to_air` and
`last_episode_to_air` are episode objects on the details response;
`next_episode_to_air` is null in both official examples — one `Ended`, one
`Returning Series` — and is computed by a process that staff (in 2019) said ran
once a day at ~00:00 UTC with a ~2-hour cache; the docs state no null rule at
all. `status` is a free string whose only staff-confirmed values are
`Returning Series`, `Planned`, `In Production`, `Ended`, `Canceled`, `Pilot`;
`in_production` is an undocumented boolean that staff glossed as "currently
being made". Episode `air_date` is an ISO `YYYY-MM-DD` string when known;
TMDB's editorial rules allow upcoming episodes — sometimes without an air date
— so a season response may contain unaired episodes, but the docs do not
promise it. Season 0 is "Specials", always. The documented rate limit is only
"somewhere in the 40 requests per second range" plus "respect the 429" — no
daily cap — and the API Terms cap cached data at **6 months**. Both changes
endpoints exist, cover at most 14 days, and `/tv/{id}/changes` defaults to 24
hours; they report that *something* changed, not that an episode was added.

---

## 1. `append_to_response` on `GET /3/tv/{series_id}`: seasons, the 20 cap, the body

### 1.1 The parameter, as documented

`GET /3/tv/{series_id}` declares (`tv-series-details`):

```
append_to_response  string  "comma separated list of endpoints within this
namespace, 20 items max"
```

The guide (`append-to-response`) says:

> `append_to_response` is an easy and efficient way to append extra requests to
> any top level namespace. The movie, TV show, TV season, TV episode and person
> detail methods all support a query parameter called `append_to_response`. This
> makes it possible to make sub requests within the same namespace in a single
> HTTP request. Each request will get appended to the response as a new JSON
> object.

Two things follow literally from the text: the cap is **20 items**, and the
allowed values are "endpoints within this namespace" — for `/3/tv/{id}` that
namespace is `/3/tv/…`, which is where `/tv/{id}/season/{n}` lives. The
description does not spell out `season/N` as an accepted spelling; the staff
posts below do.

### 1.2 Staff say seasons can be appended, and give the exact URL

TMDB staff member Travis Bell, 2023-02-16, answering "is there a way to get all
episodes in one query"
(<https://www.themoviedb.org/talk/63ee22b4699fb7009e3e5102>):

> not in 1 request, but there is a way can do it in 2. If you you make a top
> level series call to get the number of seasons that are present, you can then
> use `append_to_response` to grab them.
>
> An example grabbing the first 2 seasons of Game of Thrones:
> `https://api.themoviedb.org/3/tv/1399?api_key=###&append_to_response=season/1,season/2`

The same answer appears in 2017 and 2018:

- 2017-10-03, staff, answer to "all seasons and all episodes in one call":
  "You can't get everything in one go, no. You can however call seasons via
  `append_to_response` like so:
  `https://api.themoviedb.org/3/tv/1399?api_key=###&append_to_response=season/1`"
  (<https://www.themoviedb.org/talk/59d2898cc3a36830800048f2>).
- 2018-09-04, staff, answering a request for "the detail of each episode in
  this query": "I would just make a season call, which returns a list of
  episodes... You can also use `append_to_response` if you know the season you
  want to query:
  `https://api.themoviedb.org/3/tv/60059?api_key=###&append_to_response=season/1`"
  (<https://www.themoviedb.org/talk/5b816a4dc3a368655101120a>). The staff answer
  treats the appended season as the thing that returns the episode list.

No wildcard exists. A moderator answered "No." to
`append_to_response=season/*` on 2026-01-07, in the same 2023 thread. Seasons
must be named individually.

### 1.3 The key in the response is literally `season/1`

Staff, 2018-05-26
(<https://www.themoviedb.org/talk/5b09473b0e0a267c15002fc9>):

> every one of the appended methods that is specified in the `append_to_response`
> parameter will map to a JSON object in the root of the response with the same
> name as that field.

The same thread contains a user-pasted body from a real response (show 1418,
`append_to_response=season/1,…,season/11`), which shows the root keys:

```json
"vote_average": 6.8,
"season/1":{"_id": "5256cfbc19c2956ff60a042f", "air_date": "2007-09-24", "episodes":[{"air_date": "2007-09-24",…},
"season/2":{"_id": "5256cfbb19c2956ff60a0348", "air_date": "2008-09-22", "episodes":[{"air_date": "2008-09-22",…},
```

So the key is **not** `season_1`, `season1` or `seasons`, and it is **not** an
array of seasons — each season is a separate root property named with a slash.
A JSON parser, not a fixed schema, is required; the same user's complaint is
precisely that the seasons arrive "in separate fields instead of a List".

### 1.4 Same body as `GET /tv/{id}/season/{n}`?

What the standalone season response contains, per its OpenAPI schema and
example (`tv-season-details`): `_id`, `air_date`, `episodes[]`, `name`,
`networks[]`, `overview`, `id`, `poster_path`, `season_number`, `vote_average`.
Each episode carries `air_date`, `episode_number`, `episode_type`, `id`, `name`,
`overview`, `production_code`, `runtime`, `season_number`, `show_id`,
`still_path`, `vote_average`, `vote_count`, `crew[]`, `guest_stars[]`.

What is actually documented about the appended form is weaker:

- Staff describe the appended value as the season response — it maps to "a JSON
  object ... with the same name as that field" (2018) and it is what returns
  "a list of episodes" (2018).
- The captured 2018 body quoted above shows `_id`, `air_date` and `episodes`
  inside `season/1` — the episode list is there, each entry beginning with an
  `air_date` field as on the standalone call. The body was truncated in the
  post, so the rest cannot be read off it.
- A 2019 support thread
  (<https://www.themoviedb.org/talk/5cde6cb10e0a260ad1cb27aa>) reports the
  season **`id` is absent** from the appended object while a `_id` is present.
  The user's excerpt:

  ```
  [_id] => 5256c89f19c2956ff6046d47
  [air_date] => 2011-04-17
  [name] => Season 1
  [overview] => …
  [poster_path] => /wgfKiqzuMrFIkU1M68DDDY8kGC1.jpg
  [season_number] => 1
  ```

  The standalone response *does* have `id` (`3624` in the docs example). No
  staff reply appears in that thread, so this is a user observation, not a
  confirmation. It does mean the appended object is not safely treated as
  *identical* to the standalone body.

Bottom line: the episodes are the season's episodes with the fields the season
schema lists, but "same body" is not something TMDB documents. Treat the
appended object as the season payload minus whatever TMDB chose to omit
(season `id` is the reported omission); do not rely on `networks` or
`vote_average` being present in the appended form either — I could not verify
them.

### 1.5 The 20-item cap in practice

- The only documented statement is "20 items max" in the parameter description.
- A user (not staff) reports that extra entries are ignored rather than
  rejected: "Since the API doesn't fail on nonexistent append_to requests you
  can add 0-19 (it will only take 20 sub requests in all)" — 2023-12-26, in
  <https://www.themoviedb.org/talk/63ee22b4699fb7009e3e5102>. The same user says
  unknown append targets do not fail either.
- No documented error shape exists for exceeding 20, and I could not test it
  (no credential; see §8).
- A series with more than 20 seasons therefore cannot be fetched in one details
  call. `seasons[]` on the details response is the documented way to learn how
  many seasons exist before building the append list — staff recommends exactly
  that two-call shape in the 2023 post.

**Confidence:** high for the mechanism, the `season/N` spelling, the literal
`season/N` key and the 20 cap (staff + OpenAPI). Medium for "same body" (staff
say it is the season request, but field parity is not documented; `id` is
reported missing). The silent-truncation behaviour beyond 20 is user-reported
only.

---

## 2. `next_episode_to_air` and `last_episode_to_air`

### 2.1 `last_episode_to_air` — documented shape

`tv-series-details` defines `last_episode_to_air` as an object with:

| Field | Schema type | Docs example |
|---|---|---|
| `id` | integer | `1551830` |
| `name` | string | `"The Iron Throne"` |
| `overview` | string | `"In the aftermath…"` |
| `vote_average` | number | `4.809` |
| `vote_count` | integer | `241` |
| `air_date` | string | `"2019-05-19"` |
| `episode_number` | integer | `6` |
| `production_code` | string | `"806"` |
| `runtime` | integer | `80` |
| `season_number` | integer | `8` |
| `show_id` | integer | `1399` |
| `still_path` | string | `"/zBi2O5EJfgTS6Ae0HdAYLm9o2nf.jpg"` |

The `/tv/latest` example (`tv-series-latest-id`) shows the same object with
`"runtime": null` for an episode whose runtime is unknown, so `runtime` is not
guaranteed to be an integer in practice.

### 2.2 `next_episode_to_air` — the schema is empty

In the same OpenAPI definition the property is declared as:

```json
"next_episode_to_air": {}
```

— no type, no properties, no nullability note. That is the whole documented
shape. The GoT example in the same page sets it to `null` (GoT is `Ended`).

The field is not in an official non-null example that I found. A user-pasted
details response in a TMDB support thread
(<https://www.themoviedb.org/talk/55a626e2925141099b000dd9>, 2020) shows it
populated for two shows, with the same field vocabulary as
`last_episode_to_air`, minus `runtime`: `air_date`, `episode_number`, `id`,
`name`, `overview`, `production_code`, `season_number`, `show_id`,
`still_path`, `vote_average`, `vote_count`.

```json
"next_episode_to_air": {
  "air_date": "2020-10-08",
  "episode_number": 14,
  "id": 2193863,
  "name": "Episódio 14",
  "overview": "…",
  "production_code": "",
  "season_number": 15,
  "show_id": 1622,
  "still_path": null,
  "vote_average": 0,
  "vote_count": 0
}
```

Note what that 2020 capture does **not** contain: `runtime`. `runtime` was
added to episode payloads later (it is in the current `last_episode_to_air`
schema and docs example). Treat the object as the episode shape of its day, not
as a frozen schema.

The field's existence and purpose are confirmed by staff: on 2018-07-17 Travis
Bell wrote that tickets #470 and #471 "were completed this morning. These two
tickets include adding a `last_episode_to_air` and `next_episode_to_air` field
to the TV series get details call"
(<https://www.themoviedb.org/talk/5a69ad239251414a2800e7d9>).

### 2.3 When is it null?

TMDB does not document a rule. The two official examples are:

- **GoT, `Ended`:** `"next_episode_to_air": null` (`tv-series-details`).
- **`/tv/latest`, `Returning Series`, `in_production: true`, one aired
  episode:** `"next_episode_to_air": null` (`tv-series-latest-id`, the 妖怪传
  record).

So null does **not** mean "ended" and does **not** mean "not returning". It is
simply "no next episode is currently computed". There is no documented rule for
`last_episode_to_air` being null either; presumably a series with no aired
episode has none, but the docs do not say it.

### 2.4 Is it filled as soon as an episode is announced, even with no air date?

**Not confirmed.** No TMDB page or staff post states this. Two related facts:

- The field is a *next to air* value; an episode with no air date cannot supply
  a date, so the plausible behaviour is null until a date is set — but that is
  inference, not a documented rule.
- Staff (2019-12-18) said the computation is not live: "We only run the process
  to calculate next to air episodes once a day, right around 00:00 UTC. So
  depending where you are in the world, you will have to wait until after 00:00
  UTC AND for the cache to expire (~2 hours)." That is a 2019 statement about
  cadence, not a current guarantee, but it shows the value lags the database.
  (<https://www.themoviedb.org/talk/5dfa117626dac1001758d80e>)

There is also a subtlety for "caught-up" watching: the field is documented as
*the next episode to air*, not "the next episode after the one you watched".
It is a property of the series, not of a viewing position.

**Confidence:** high that the fields exist and are episode objects; high that
null is normal and undocumented; low/unknown on the announced-without-air-date
case and on the exact current recomputation cadence.

---

## 3. `status` and `in_production`

### 3.1 The string values

The OpenAPI schema for `status` is a bare `{"type": "string"}` with example
`"Ended"` — no `enum`, no list. TMDB staff supplied the list on 2017-02-26, in
answer to "Is there a list of all status codes for tv series?"
(<https://www.themoviedb.org/talk/58b1cfbac3a368077800feb5>):

> Sure:
>
> `['Returning Series', 'Planned', 'In Production', 'Ended', 'Canceled', 'Pilot']`

That is the only staff-confirmed set. Note the spelling **`Canceled`** (one
`l`) in the API value, while the Contribution Bible's prose heading says
"Cancelled" — the string value is the one with one `l`.

The Bible explains what the labels mean editorially
(<https://www.themoviedb.org/bible/tv>):

- **Pilot** — "pilot episode not yet picked up to series. Rarely used."
- **In Production** — "a new series is greenlighted and/or the production has
  started, but it is not yet released."
- **Returning Series** — "status we use from the premiere to the very last
  episode of a series… Every series is assumed to be returning until an
  official cancellation/end or after an abnormally long hiatus."
- **Cancelled** — "cancelled by the network… It is used as soon as a cancelled
  series ends or it can be used when a cancelled series is pulled from the
  regular schedule."
- **Ended** — "the series is over and the end was planned in advance."

**Planned** is in the staff list but is not one of the Bible's headings; the
Bible page as read does not describe it.

### 3.2 The numeric `with_status` codes are not a documented enum

`/discover/tv` declares `with_status` as a string with
`"possible values are: [0, 1, 2, 3, 4, 5]"` and no names
(<https://developer.themoviedb.org/reference/discover-tv>). TMDB's own forum
has **two different mappings**:

- Staff, 2024-07-03 (<https://www.themoviedb.org/talk/6685c10585e1cbe90c4a5fe0>):
  `0: Returning Series, 1: Planned, 2: In Production, 3: Ended, 4: Canceled,
  5: Pilot`.
- Moderator, 2023 (<https://www.themoviedb.org/talk/63e1a55dcb8028007fb50e08>):
  `0 Returning Series, 1 Planned, 2 Pilot, 3 In Production, 4 Ended,
  5 Canceled`.

The 2024 staff table is the newer statement and its order matches the 2017
staff string list; the 2023 moderator table swaps Pilot/In Production and
Ended/Canceled. The documentation itself publishes neither, so any numeric
`with_status` filter built from these tables is on insecure ground. Filtering
on the **string** `status` is unambiguous; filtering by number is not.

### 3.3 `in_production`

The schema is `{"type": "boolean", "example": false, "default": true}` — no
description. TMDB's only explanation I found is a 2017 staff reply about the
meaning of the labels
(<https://www.themoviedb.org/talk/58deb4e99251411ba6010038>):

> "in production" would indicate that it is currently being made. "returning
> series" would be the one you;re looking for, like you mentioned. This
> indicates that it's been renewed, yes.

That answer is about the **status** "In Production", not explicitly about the
boolean. The boolean's rule is otherwise undocumented. The two official
examples show it is independent of `status` in the obvious direction:

- GoT: `status: "Ended"`, `in_production: false`.
- 妖怪传 in `/tv/latest`: `status: "Returning Series"`, `in_production: true`,
  `next_episode_to_air: null`.

So `in_production` true is compatible with "Returning Series"; it does not by
itself say a *future episode exists*. There is no documented pairing table.

**Confidence:** high for the six strings (staff quote) and for the meanings
(Bible). High that no enum is documented. Low for the numeric mapping (two
conflicting TMDB statements). Medium for `in_production` (one 2017 staff gloss,
no schema description).

---

## 4. Episode `air_date` in a season response

### 4.1 Format

The season schema types `episodes[].air_date` as `string` with example
`"2011-04-17"` (`tv-season-details`). Every date example cited here is an ISO
8601 calendar date, `YYYY-MM-DD`, no time and no zone. The same shape appears on
the details response's `first_air_date`, `last_air_date`,
`last_episode_to_air.air_date`, and on `seasons[].air_date`.

### 4.2 Can it be null or empty?

The schema has no `nullable` marker and no statement; the docs only show fully
dated episodes. What is established:

- TMDB's editorial rules permit episodes with no known air date. Bible,
  Episodes page (<https://www.themoviedb.org/bible/tv/59f743289251416e71000037>):
  "Blank episodes (with a missing title and/or air date) should be avoided…
  Sometimes, episodic data is not available publicly until the episodes are
  released. In those cases, it is acceptable to add the next upcoming episode
  with a missing title/description… An exception is also made for the first
  episode of a season and the first episode after the mid-season break.
  Sometimes only the episode title and description are known, but not the air
  date, or vice versa."
- On early cancellation: "the first thing you should do is remove the air
  dates from any unaired episodes."
- TMDB's own `/tv/latest` example (`tv-series-latest-id`) uses **both**
  sentinels on date fields in one response: `"first_air_date": ""` (empty
  string) and `"seasons":[{"air_date": null, …}]`.

So the API demonstrably uses `""` for one missing date field and `null` for
another. For **episode** `air_date` specifically, I could not confirm which
sentinel appears; the safe reading is "may be absent, empty or null; a client
must not assume a parseable date". A well-known client corroborates the
possibility: TMDbLib models the episode date as `DateTime?`, and the Haskell
`Network.API.TheMovieDB` docs describe `episodeAirDate :: Maybe Day` as "Episode
air date, if it ever aired" — corroboration only, not policy.

### 4.3 Are future (announced, unaired) episodes listed in season responses?

**Not documented.** Nothing on `tv-season-details` says whether the `episodes`
array is "all episodes TMDB holds" or "aired episodes only". The evidence that
it includes future episodes is indirect but consistent:

- TMDB's editorial rules explicitly instruct contributors to add upcoming
  episodes, including the next episode before its release (Bible quote above).
  A season response returns the episodes TMDB holds for the season, so an
  added upcoming episode should be in it.
- `next_episode_to_air` is an episode object with an `id` and an `air_date` in
  the future relative to capture (the 2020 capture shows The Boys S2E7 dated
  2020-10-02 and Supernatural S15E14 dated 2020-10-08). TMDB therefore holds
  future episode records; the season endpoint is the natural place they are
  exposed.
- The season endpoint's only input is `series_id` + `season_number`; there is
  no "aired only" flag.

But there is no sentence in the API docs promising it, and no official example
with an unaired episode. Treat "future episodes are present" as expected
behaviour, not a contract.

**Confidence:** high for the format; high that missing dates are legitimate in
TMDB's data model; unconfirmed for the exact episode sentinel; medium for
future episodes being present (policy + field existence, no documented
promise).

---

## 5. Season 0, "Specials"

- TMDB's editorial rule is explicit: **"The special season is always Season
  0."** — Bible, Seasons page
  (<https://www.themoviedb.org/bible/tv/59f73eb49251416e71000026>). The same
  page defines what belongs there (episodes that did not originally air as part
  of a regular numbered season, unaired pilots, web specials, some DVD bonus
  content; not theatrical films).
- In the `seasons[]` array of the details response, Season 0 is an ordinary
  entry. The docs' GoT example (`tv-series-details`) has it first:

  ```json
  {
    "air_date": "2010-12-05",
    "episode_count": 272,
    "id": 3627,
    "name": "Specials",
    "overview": "",
    "poster_path": "/kMTcwNRfFKCZ0O2OaBZS0nZ2AIe.jpg",
    "season_number": 0,
    "vote_average": 0
  }
  ```

  Observations from that example: `season_number` is `0`; `name` is the
  localized "Specials" (not "Season 0"); its `air_date` can be earlier than
  Season 1's; `episode_count` counts the specials; it is not filtered out of
  `seasons[]` and `number_of_seasons` is 8 for 8 numbered seasons plus the
  specials entry (the count does not include Season 0).
- In season responses, Season 0 is addressed with the same endpoint,
  `GET /3/tv/{series_id}/season/0`. The path parameter is an integer
  `season_number` with no stated restriction, and the schema has no
  special-case for 0. I found no documented Season 0 example body, so the body
  shape is inferred to be the normal season body with `season_number: 0`.

**Confidence:** high that Season 0 exists and is "Specials" (Bible + docs
example). High that it is requested with `season/0` (no other path exists).
Medium that its response is shape-identical to a numbered season (inference;
no example).

---

## 6. Rate limits, caching guidance, and HTTP cache headers

### 6.1 The documented rate limit

`docs/rate-limiting` (<https://developer.themoviedb.org/docs/rate-limiting>):

> As of December 16, 2019, we have disabled the original API rate limiting (40
> requests every 10 seconds.) … While our legacy rate limits have been disabled
> for some time, we do still have some upper limits to help mitigate needlessly
> high bulk scraping. They sit somewhere in the 40 requests per second range.
> This limit could change at any time so be respectful of the service we have
> built and respect the `429` if you receive one.

Facts:

- **No fixed number is promised.** The only figure is "somewhere in the 40
  requests per second range".
- **No daily cap is documented.** Nothing in the rate-limiting page, the FAQ or
  the reference pages states a per-day quota.
- **`429` is the documented back-off signal.** No `Retry-After` header is
  documented; no retry policy is prescribed.
- The limit's unit (per IP, per key) is not stated on the current page. A 2014
  staff post said the legacy limits were per IP
  (<https://www.themoviedb.org/talk/535bd54fc3a36830a9001648>), but that
  describes the retired 30-req/10-s regime, not the current one.
- No SLA: the FAQ says "We do not currently provide an SLA"
  (<https://developer.themoviedb.org/docs/faq>).

### 6.2 Caching guidance in the Terms

The API Terms of Use (`https://www.themoviedb.org/api-terms-of-use`, reached
from the older `/documentation/api/terms-of-use` path) put caching in the
"must not" list of §1.C:

> Cache, for longer than 6 months, any information obtained through or from
> TMDB or the TMDB APIs.

So a **6-month ceiling** is the only hard caching rule TMDB publishes. There is
no minimum freshness, no required refresh interval, and no positive "please
cache" guidance in the API docs or FAQ. On termination §1.D adds:

> If TMDB terminates Your license, or You terminate your license, You must
> immediately cease all use of the TMDB APIs, TMDB Content, and any TMDB API
> key(s), and you must promptly delete or otherwise purge all TMDB Content,
> including any cached content.

Two consequences that are easy to miss: the ceiling applies to *any*
information obtained from the API (not just images), and a local cache must be
deletable on termination, not merely expirable.

Attribution is a separate condition of the free licence (FAQ): the notice "This
product uses the TMDB API but is not endorsed or certified by TMDB" in an
About/Credits section, plus an approved logo
(<https://developer.themoviedb.org/docs/faq>).

### 6.3 Do responses carry `Cache-Control` / `ETag`?

I could not obtain an authenticated 200 (no credential in this environment), so
the following is what the API returns **without** a credential, measured with
`curl` on 2026-11-07 against `api.themoviedb.org`:

```
HTTP/2 401
content-type: application/json; charset=utf-8
server: openresty
cache-control: public, max-age=300
x-cache: Error from cloudfront
via: 1.1 …cloudfront.net (CloudFront)
vary: Origin
```

The same response headers appeared for `/3/tv/1399`, `/3/tv/1399/season/1`,
`/3/tv/changes` and `/3/configuration`, with and without an `api_key` query
item:

- **`Cache-Control: public, max-age=300`** — present, 300 seconds.
- **No `ETag`**, no `Last-Modified`, no `Age`, no `Expires` on those responses.
- Responses are fronted by CloudFront (`x-cache`, `via`), and the JSON is
  served by `openresty`.

A **200** capture from the same API exists in a user's May 2026 bug report
(<https://www.themoviedb.org/talk/6a0cf9a5dd8f54b8836a3750>). Its headers:

```
HTTP/2 200
content-type: application/json;charset=utf-8
content-encoding: gzip
cache-control: public, max-age=12548
vary: Accept-Encoding, Origin
x-gateway-cache-status: HIT
x-cache: Hit from cloudfront
x-amz-cf-pop: LIS50-P2
```

That capture has **no `ETag`** and no `Last-Modified` either, and its
`max-age` is ~12,500 s (the reporter describes it as "max-age ~12500"), not the
300 s of the 401. It is a user capture during an incident, not TMDB policy, but
it is the only 200 header set I found.

What TMDB says about its own caching in prose:

- Staff, 2019: the next-to-air computation ends with "the cache to expire
  (~2 hours)" (<https://www.themoviedb.org/talk/5dfa117626dac1001758d80e>).
- Staff, 2026, during a data-corruption incident: "what's left as an issue is
  whatever got cached on the CloudFront edges. These will expire over the next
  few hours" (<https://www.themoviedb.org/talk/6a0cf9a5dd8f54b8836a3750>).

Those are incident/feature-specific statements, not a published TTL. There is
**no documented ETag/conditional-request support** and no documented TTL for a
200. The one 200 capture shows `max-age=12548`, the 401s show `max-age=300`; a
client must not assume either value is a contract.

**Confidence:** high for the 40 req/s range, the absence of a documented daily
cap, the 6-month terms ceiling, and the observed 401 headers. Medium for the
200 header set (one user capture, no ETag in it). Unknown whether 200
`max-age` is stable per endpoint or varies by edge; unknown whether any
conditional-request support exists.

---

## 7. The changes endpoints

### 7.1 `GET /3/tv/changes` (the global list)

Reference page `changes-tv-list`
(<https://developer.themoviedb.org/reference/changes-tv-list>), whose own text
is:

> You can query this method up to 14 days at a time. Use the `start_date` and
> `end_date` query parameters. 100 items are returned per page.

Parameters: `end_date` (date), `page` (int, default 1), `start_date` (date).
Response:

```json
{"results":[{"id":225591,"adult":false}, …],
 "page":1,"total_pages":18,"total_results":1763}
```

Every result is only `{id, adult}`: the endpoint tells you **which series
changed**, not what changed. The page does **not** state a default window
(unlike the per-series page, which says 24 hours). It does not document a page
cap.

### 7.2 `GET /3/tv/{series_id}/changes` (one series)

Reference page `tv-series-changes`
(<https://developer.themoviedb.org/reference/tv-series-changes>):

> Get the changes for a TV show. By default only the last 24 hours are returned.
>
> You can query up to 14 days in a single query by using the `start_date` and
> `end_date` query parameters.
>
> TV show changes are a little different than movie changes in that there are
> some edits on seasons and episodes that will create a top level change entry
> at the show level. These can be found under the season and episode keys.
> These keys will contain a `series_id` and `episode_id`. You can use the
> season changes and episode changes methods to look these up individually.

Parameters: `series_id`, `end_date`, `page` (default 1), `start_date`. The
response shape (from the page's example) is:

```json
{"changes":[
  {"key":"images","items":[
    {"id":"640435cf021cee0084710972","action":"updated",
     "time":"2023-03-05 06:25:19 UTC","iso_639_1":"en","iso_3166_1":"",
     "value":{…},"original_value":{…}}
  ]}
]}
```

`action` is a free string; the example shows `"added"` and `"updated"`. `time`
is `"YYYY-MM-DD HH:MM:SS UTC"`. The example's only `key` is `"images"`; the
docs do **not** enumerate the possible keys, and they do not show a `season` or
`episode` entry.

The companion pages repeat the same 24-hour default / 14-day maximum and add:

- Season changes (`tv-season-changes-by-id`): "some edits on episodes …
  create a top level change entry at the season level. These can be found under
  the episode keys."
- Episode changes (`tv-episode-changes-by-id`): same 24 h default, 14-day max,
  with the same episode-key note.

### 7.3 Is this a practical way to detect one series gaining an episode?

What the sources support:

- The per-series call is the *only* documented feed scoped to one series, and
  TMDB explicitly says season/episode edits surface as top-level show changes
  under season/episode keys — so an episode addition is the right *kind* of
  event for this endpoint.
- It is much cheaper than a details call plus a season call: one request covers
  24 h by default and up to 14 days per query.
- But the response is a generic change log. There is no documented event type
  "episode added", no documented key name for an added episode, and no
  documented guarantee that every episode addition appears. The consumer has to
  inspect `changes[].key` / `items[].action` / `items[].value` and decide.
- The 24-hour default means a polling cadence slower than 24 h must send
  `start_date`/`end_date` explicitly; the 14-day maximum means anything slower
  than two weeks can miss changes entirely.
- The change feed reflects edits made to the TMDB database (TMDB is
  user-contributed). A network announcing an episode does not by itself
  produce a change entry; a TMDB contribution does. And the next-to-air value
  is computed separately (staff: once a day in 2019), so the two signals are not
  the same clock.
- The global `/tv/changes` list can tell you *that* one of your watched series
  changed, but only at the granularity of series ids, 100 per page, and only
  within the queried window.

So: **yes for "did this series change in the window", no for "this series
gained an episode" without parsing the change entries, and no documented
guarantee that an addition is in the feed.** For "the next episode's date",
`next_episode_to_air` on the details response is the documented field; the
changes feed is not a substitute for it.

**Confidence:** high for the endpoint shapes, windows and pagination. Medium
that an episode addition reliably shows up as a change entry (staff says
season/episode edits do create entries, but no key/value contract). High that
the docs do not enumerate keys or guarantee the event.

---

## 8. Not confirmed / negatives

Everything here is either absent from the docs or could not be tested because
this environment has no TMDB credential.

- **Authenticated 200 response headers.** I could not make a 200 myself. One
  user-posted 200 capture (2026-05-19) shows `cache-control: public,
  max-age=12548`, `vary: Accept-Encoding, Origin`, `x-gateway-cache-status:
  HIT`, no `ETag`/`Last-Modified`. Whether that set, and the TTL, are stable
  across endpoints and edges is unknown. The `max-age=300` quoted in §6.3 is an
  error response, not proof of the 200 policy.
- **ETag / `If-None-Match` support.** Not documented anywhere I read; none seen
  on the 401s. Do not assume conditional requests save quota.
- **A documented default window for `/3/tv/changes`.** The page says "up to 14
  days" but, unlike the per-series page, never states the default. Do not
  assume 24 h.
- **A documented page cap for the changes endpoints.** Not stated.
- **Field-by-field parity between an appended season and
  `GET /tv/{id}/season/{n}`.** Staff describe the appended value as the season
  response, but the docs never say "identical". A 2019 user reports the season
  `id` missing from the appended object (only `_id` present). Whether
  `networks`, `vote_average`, and per-episode `crew`/`guest_stars` are present
  in the appended form is unverified.
- **Behaviour when more than 20 appends are requested.** The only documented
  statement is "20 items max". A user reports silent ignoring of the extras and
  of unknown append targets; no error shape is documented and I could not test
  it.
- **Whether the 20-item cap counts only season appends or all appends.** The
  parameter description says "20 items", not "20 seasons". Mixing
  `external_ids` and `season/N` presumably counts against the same budget, but
  this is not stated.
- **`next_episode_to_air` with an announced episode that has no air date.**
  Not documented. No example found.
- **`next_episode_to_air` null rule generally.** The docs give no rule; the two
  official examples are null for both an `Ended` and a `Returning Series`
  show. "Null means ended" is contradicted by the `/tv/latest` example.
- **`last_episode_to_air` nullability.** Not documented; no example of a series
  with zero aired episodes.
- **The episode `air_date` sentinel for "unknown".** TMDB uses `""` for
  `first_air_date` and `null` for `seasons[].air_date` in the same official
  example, but no official episode example has an unknown date. The Bible
  allows unknown air dates; the JSON spelling is unconfirmed.
- **Whether a season response includes unaired episodes.** No documented
  promise; no official example with a future episode. The Bible's "Upcoming
  Episodes" policy and the existence of future `next_episode_to_air` records
  make it expected, not guaranteed.
- **Season 0 response body.** No official example of `GET /tv/{id}/season/0`;
  shape inferred from the normal season endpoint. Its `name` in responses is
  unconfirmed (the `seasons[]` entry says "Specials" in the GoT example).
- **The numeric `with_status` mapping.** Two conflicting TMDB forum tables
  (2023 moderator vs 2024 staff); the API reference publishes only `[0..5]`.
- **Any guarantee the six status strings are exhaustive or stable.** Staff
  called the 2017 list "the valid list"; the schema is a plain string with no
  enum, and TMDB reserves the right to change the API (FAQ: "Yes, it can from
  time to time"). No page states the list is closed.
- **The precise meaning of `in_production`.** No schema description; only a
  2017 staff gloss about the status label "In Production".
- **The current next-to-air recomputation cadence.** The 2019 staff statement
  (daily ~00:00 UTC, ~2 h cache) is the only one found; nothing in the current
  docs repeats or updates it.
- **A daily request cap.** None documented; the 40 req/s "range" is the only
  figure.
- **Whether TMDB responds `429` with `Retry-After`.** Not documented; not
  observed (no successful calls to exhaust a limit).
- **The exact `key` values `/tv/{id}/changes` emits for season/episode edits.**
  The page says the entries exist under "season and episode keys"; the only
  example key is `"images"`, and no page lists the vocabulary.
- **A guarantee that `changes` is complete.** No statement about retention
  beyond the 14-day query window, nor about edits that are later reverted.
