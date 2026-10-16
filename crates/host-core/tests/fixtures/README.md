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

