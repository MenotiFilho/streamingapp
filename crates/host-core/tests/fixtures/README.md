# Fixtures

Manifest bodies, recorded, so that the parse and the Addon path are tested against
what an Addon really serves rather than against what this repo imagines it serves.

- `stremboxd-manifest.json` — `https://api.stremboxd.com/manifest.json`, as served
  on 2026-10-15. Recorded by
  `curl -sS https://api.stremboxd.com/manifest.json`.
- `cinemeta-manifest.json` — `https://v3-cinemeta.strem.io/manifest.json`, as served
  on 2026-10-15. Recorded by
  `curl -sS https://v3-cinemeta.strem.io/manifest.json`. Carries the `addon_catalog`
  resource and an `addonCatalogs` list this Host has no use for, which is the point:
  a manifest that knows more than the Host does still works.
- `hostile-manifest.json` — a manifest that lies: right shape, one field of the
  wrong type. It lies once on purpose: a parse reports the first thing wrong and
  stops, so a fixture with several lies would only ever exercise the first. The
  rules it does not exercise are unit tests in `addon.rs`, one per rule.
- `not-a-manifest.html` — what an Addon installed from the wrong URL answers with.

These are not asserted on as content — only that the Host reads them into its own
vocabulary, refuses the ones that are not manifests, and never reaches the network
in a unit test. Refresh them by hand when an Addon's manifest changes; the Host's
tests are about the shape, not about what Stremboxd happens to list this week.
