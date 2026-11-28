import { describe, expect, test } from "vitest";

import { blankFeed } from "./discover";
import {
  marqueeSearchPlan,
  searchCanReadOn,
  searchCatalogRowNote,
  searchCatalogRowTitles,
  searchNoCatalogsNote,
  searchPromptCopy,
  searchTmdbRowNote,
} from "./marqueeSearch";
import type { CatalogRow } from "./wire";

function catalogRow(overrides: Partial<CatalogRow> = {}): CatalogRow {
  return {
    addon: "cinemeta",
    type: "series",
    id: "top",
    name: "Popular Series",
    sent: 0,
    metas: [],
    failure: null,
    ...overrides,
  };
}

describe("Marquee Search plan", () => {
  test("queries Addons' searchable Catalogs and TMDB Movies + Series together when keyed", () => {
    const plan = marqueeSearchPlan(true, "hunger games");

    expect(plan.catalogsQuery).toBe("hunger games");
    expect(plan.tmdbFeeds.map((feed) => feed.first)).toEqual([
      { type: "search", query: "hunger games", kind: "movie", page: 1 },
      { type: "search", query: "hunger games", kind: "series", page: 1 },
    ]);
  });

  test("queries only Addons' searchable Catalogs when no TMDB key is held", () => {
    const plan = marqueeSearchPlan(false, "hunger games");

    expect(plan.catalogsQuery).toBe("hunger games");
    expect(plan.tmdbFeeds).toEqual([]);
  });
});

describe("Marquee Search copy and row notes", () => {
  test("formats empty Catalog row notes by kind", () => {
    expect(searchCatalogRowNote(catalogRow({ type: "series", sent: 0 }), "hunger games")).toBe(
      "No series match \u201chunger games\u201d.",
    );
    expect(searchCatalogRowNote(catalogRow({ type: "movie", sent: 0 }), "hunger games")).toBe(
      "No movies match \u201chunger games\u201d.",
    );
    expect(searchCatalogRowNote(catalogRow({ type: "channel", sent: 0 }), "news")).toBe(
      "No titles match \u201cnews\u201d.",
    );
    expect(searchCatalogRowNote(catalogRow({ sent: 3, metas: [] }), "test")).toBe(
      "This Catalog sent items the Host could not read.",
    );
    expect(
      searchCatalogRowNote(
        catalogRow({ failure: { kind: "fetch", detail: "timeout" } }),
        "test",
      ),
    ).toBeNull();
  });

  test("formats TMDB row notes across reading and empty states", () => {
    const feed = blankFeed();
    expect(searchTmdbRowNote(feed, "reading", "movie", "dune")).toBe("Looking for movies…");
    expect(searchTmdbRowNote(feed, "reading-more", "series", "dune")).toBe(
      "Looking for more series…",
    );
    expect(searchTmdbRowNote(feed, "empty", "series", "hunger games")).toBe(
      "No series match \u201chunger games\u201d.",
    );
    expect(searchTmdbRowNote(feed, "ready", "movie", "dune")).toBeNull();
  });

  test("adapts prompt and empty-catalogs copy to whether TMDB is held", () => {
    expect(searchPromptCopy(true).body).toContain("TMDB");
    expect(searchPromptCopy(false).body).not.toContain("TMDB");
    expect(searchNoCatalogsNote(true)).toBeNull();
    expect(searchNoCatalogsNote(false)).toBe(
      "No Addon offers a Catalog that can be searched.",
    );
  });
});

describe("Marquee Search row titles (render 16)", () => {
  test("titles each Catalog row by its kind", () => {
    expect(
      searchCatalogRowTitles([
        catalogRow({ type: "movie", name: "Popular" }),
        catalogRow({ type: "series", name: "Popular" }),
        catalogRow({ addon: "kitsu", type: "anime", name: "Trending" }),
      ]),
    ).toEqual(["Movies", "Series", "Anime"]);
  });

  test("adds the Catalog name only to tell apart rows of one Addon and kind", () => {
    expect(
      searchCatalogRowTitles([
        catalogRow({ type: "movie", id: "top", name: "Popular" }),
        catalogRow({ type: "movie", id: "year", name: "New" }),
        catalogRow({ type: "series", id: "top", name: "Popular" }),
        catalogRow({ addon: "other", type: "movie", name: "Popular" }),
      ]),
    ).toEqual(["Movies \u00b7 Popular", "Movies \u00b7 New", "Series", "Movies"]);
  });
});

describe("Marquee Search Read on", () => {
  const read = { ...blankFeed(), page: 1 };

  test("pages on from a page that brought no readable item", () => {
    expect(searchCanReadOn(read)).toBe(true);
  });

  test("is not offered before the first page, after the last, or beside a failure", () => {
    expect(searchCanReadOn(blankFeed())).toBe(false);
    expect(searchCanReadOn({ ...read, done: true })).toBe(false);
    expect(searchCanReadOn({ ...read, failure: { kind: "tmdb", detail: "503" } })).toBe(false);
  });
});
