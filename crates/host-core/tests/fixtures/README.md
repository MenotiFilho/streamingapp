# Fixtures

Bodies recorded from real Addons, so that the parses and the request paths are
tested against what an Addon really serves rather than against what this repo
imagines it serves.

## Manifests

- `stremboxd-manifest.json` — `https://api.stremboxd.com/manifest.json`, as served
  on 2026-10-15. Recorded by
  `curl -sS https://api.stremboxd.com/manifest.json`.
- `cinemeta-manifest.json` — `https://v3-cinemeta.strem.io/manifest.json`, as served
  on 2026-10-15. Recorded by `curl -sS https://v3-cinemeta.strem.io/manifest.json`.
  Carries the `addon_catalog` resource and an `addonCatalogs` list this Host has no
  use for, which is the point: a manifest that knows more than the Host does still
  works. Its catalogs also declare their controls both ways — the long `extra` form
  and the short `extraSupported` / `extraRequired` one — because real Addons do.
- `hostile-manifest.json` — a manifest that lies: right shape, one field of the
  wrong type. It lies once on purpose: a parse reports the first thing wrong and
  stops, so a fixture with several lies would only ever exercise the first. The
  rules it does not exercise are unit tests in `addon.rs`, one per rule.
- `not-a-manifest.html` — what an Addon installed from the wrong URL answers with.

## Catalog pages

Recorded the same way, and trimmed to their first items so that the repository does
not carry a hundred posters it never asserts on. What is kept is the shape: real
items, the fields this Host has no use for, and the Addon's own cache hints.

- `cinemeta-catalog-movie-top.json` —
  `https://v3-cinemeta.strem.io/catalog/movie/top.json`, the first 8 of its 48
  items. Carries `hasMore` and the hints `cacheMaxAge` 14400,
  `staleRevalidate` 3600, `staleError` 3600, and items carrying `imdb_id`, `slug`,
  `popularities` and more that this Host ignores.
- `cinemeta-catalog-movie-top-skip100.json` — the same catalog asked for with
  `skip=100`, which is the next page rather than the first one again.
- `cinemeta-search-movie-top.json` — the same catalog asked for with
  `search=matrix`, the first 8 of its 19 items. Carries `query` and `rank` beside
  `metas`, which is what a response with unexpected top-level fields looks like.
- `stremboxd-catalog-letterboxd-popular.json` —
  `https://api.stremboxd.com/catalog/movie/letterboxd-popular.json`, the first 8 of
  its 100 items. Carries no cache hint at all, which is the case a Host has to keep
  asking about.
- `catalog-with-a-bad-item.json` — written by hand, not recorded: a page whose
  second item is missing its type and whose third is a bare number. One record that
  cannot be read is dropped rather than blanking the row around it.
- `hostile-catalog.json` — written by hand: a response whose `metas` are not a
  list. That is a fact about the Addon rather than about one item, so it is refused.

These are not asserted on as content — only that the Host reads them into its own
vocabulary, refuses the ones that are not catalogs, and never reaches the network
in a unit test. Refresh them by hand when an Addon's manifest or a page changes;
the Host's tests are about the shape, not about what Stremboxd happens to list this
week.

## Meta responses

One item's metadata, as `open_title` asks for it. Recorded the same way, and
trimmed the same way.

- `cinemeta-meta-movie.json` —
  `https://v3-cinemeta.strem.io/meta/movie/tt0133093.json`, as served on
  2026-10-15. A film: an empty `videos`, and `cast`, `director`, `trailers`,
  `links`, `slug` and `popularities` that this Host has no use for.
- `cinemeta-meta-series.json` —
  `https://v3-cinemeta.strem.io/meta/series/tt0903747.json`, the same day. Trimmed
  from its 67 episodes to five — a season-0 special, the first three of season 1,
  and the first of season 2 — so the file keeps the shape of a real episode
  (`name`, `season`, `number`, `episode`, `overview`, `thumbnail`, `rating`, the
  `tvdb_id` this Host ignores) without carrying sixty more of them.
- `sparse-meta.json` — written by hand, not recorded: the least a meta response
  can be about the item it answers for — an id, a type and a name — since a real
  Addon is allowed to answer with no more and the Host must still open a Title.
- `hostile-meta.json` — written by hand: a response whose `meta` is a string.
  That is a fact about the Addon rather than a missing field, so it is refused.

## TMDB responses

Where a Title maps to TMDB: the `find` answer that turns an Addon's IMDb id into a
TMDB record id, and the `details` answer the Host merges over the Addon's metadata.
Written by hand, not recorded — a recorded answer needs a key to ask for, and these
are trimmed to the fields the Host reads — but carrying TMDB's own ids and titles
for the two Titles the tests use.

- `tmdb-find-matrix.json` — `/find/tt0133093?external_source=imdb_id`: one entry
  in `movie_results`, and the other result lists empty.
- `tmdb-find-bb.json` — the same for `tt0903747`, answered in `tv_results`.
- `tmdb-movie-details.json` — The Matrix (603): the poster path, runtime, genre
  names and release date the Host merges over the Addon's Title, beside fields it
  ignores.
- `tmdb-tv-details.json` — Breaking Bad (1396): `first_air_date` and
  `last_air_date` with `in_production: false`, the closed year range a finished
  series shows.
- `tmdb-tv-details-making.json` — written by hand and about a series that does not
  exist: `in_production: true` with a year range that has not ended, the case the
  `2020-`-style range is for.

## TMDB responses

Where the Host maps an Addon's id to TMDB's own records: a `find` answer that
turns an IMDb id into a TMDB one, and the `details` answer for what TMDB says
about the record it found. Written by hand to the shapes TMDB documents — the
ids and titles for The Matrix (603) and Breaking Bad (1396) are TMDB's own, the
counts and blobs around them are not — because a recorded answer would carry a
session's worth of noise this Host has no use for, and a find needs a key to
record at all.

- `tmdb-find-matrix.json` — `/find/tt0133093?external_source=imdb_id`: the
  answer in `movie_results`, with the other result lists empty beside it.
- `tmdb-find-bb.json` — the same for `tt0903747`, answered in `tv_results`.
- `tmdb-movie-details.json` — `/movie/603`: the fields the Host merges over the
  Addon's Title — genres, runtime, release date, `poster_path` — among the many
  it ignores.
- `tmdb-tv-details.json` — `/tv/1396`: `first_air_date` and `last_air_date`
  with `in_production: false`, the year range a finished series shows.
- `tmdb-tv-details-making.json` — written by hand, not recorded, and invented
  outright: a series `in_production` with no `last_air_date` to end the range
  (`2020–`), which a recording would only catch by being run in that window.

## Stream responses

A Video's candidates, as finding a Stream asks for them. Recorded the same way,
and trimmed the same way.

- `torrentio-manifest.json` — `https://torrentio.strem.fun/manifest.json`, as
  served on 2026-10-15. Carries `background`, `logo` and a long `description`
  this Host has no use for.
- `torrentio-streams-matrix.json` —
  `https://torrentio.strem.fun/stream/movie/tt0133093.json`, the first 5 of its
  97 streams, each trimmed to its first two `sources`. Carries `fileIdx` and
  `sources` beside the fields the Host reads, and the Cyrillic release name one
  of its scraped providers gave a film — the shape of a real answer, not a tidy
  one. Every candidate locates its bytes with `infoHash` and nothing else: a
  torrent, the candidate this version lists and marks unplayable.
- `torrentio-streams-bb-s1e1.json` — the same for
  `.../stream/series/tt0903747:1:1.json`, the first 3 of its 61.
- `watchhub-manifest.json` — `https://watchhub.strem.io/manifest.json`, the same
  day.
- `watchhub-streams-matrix.json` —
  `https://watchhub.strem.io/stream/movie/tt0133093.json`, its 3 streams. Every
  one locates its bytes with `externalUrl` — a link to Amazon, Google Play,
  Telecine — and carries per-platform URLs (`rokuUrl`, `androidUrl`, …) this Host
  ignores. An answer of places to *watch* is not an answer of candidates this
  Host can *play*; the tests assert it reads as no candidates rather than as an
  error.
- `watchhub-streams-bb-s1e1.json` — the same for the episode, both of its
  streams.
- `aiostreams-manifest.json` — written by hand, not recorded: AIOStreams' real
  manifest URL carries the owner's debrid configuration inside it, which is
  exactly why ADR-0009 keeps a manifest URL out of Snapshots. It is the Addon a
  debrid answer belongs to, so the direct-URL case has a source of its own.
- `streams-direct-url.json` — written by hand: a debrid-style answer of direct
  URLs, one carrying `notWebReady` and `proxyHeaders` hints. Not recorded
  because a recorded one would carry a debrid session's tokens inside its URLs.
- `streams-with-a-bad-item.json` — written by hand: one object locating its
  bytes twice (`url` *and* `infoHash`) and one locating them not at all, around
  two that read. The two that lie are dropped and the two that do not stand.
- `hostile-streams.json` — written by hand: a response whose `streams` is a
  string. That is a fact about the Addon rather than about one candidate, so it
  is refused.

