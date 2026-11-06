import { describe, expect, test } from "vitest";

import { MOVIE } from "../core/discover";
import { SERIES } from "../core/title";
import type { CatalogRow } from "../core/wire";
import {
  CATALOGS_READING,
  NO_SEARCHABLE_CATALOGS,
  blankFeeds,
  kindLabel,
  noMatches,
  queryOf,
  rowNote,
  searchNote,
  searchPlaceholder,
} from "./searchScreen";

/**
 * Search's own decisions (#207, ADR-0032).
 *
 * The two kinds and the ask are the core's; what is asked here is what this
 * screen decides: what a submit actually asks, and the words each row prints.
 */

function row(overrides: Partial<CatalogRow> = {}): CatalogRow {
  return {
    addon: "cinemeta",
    type: "movie",
    id: "top",
    name: "Popular",
    sent: 0,
    metas: [],
    failure: null,
    ...overrides,
  };
}

describe("the query a submit asks", () => {
  test("an empty or blank field is not a question and sends nothing", () => {
    expect(queryOf("")).toBeNull();
    expect(queryOf("   ")).toBeNull();
    expect(queryOf("\n\t ")).toBeNull();
  });

  test("a query is trimmed, and its inside spaces are the person's", () => {
    expect(queryOf("  dune  ")).toBe("dune");
    expect(queryOf("blood & guts")).toBe("blood & guts");
  });

  test("the two keyed rows start blank, one per kind", () => {
    const feeds = blankFeeds();
    expect(Object.keys(feeds).sort()).toEqual(["movie", "series"]);
    expect(feeds.movie).toEqual({ page: 0, items: [], failure: null, done: false });
    expect(feeds.series).toEqual({ page: 0, items: [], failure: null, done: false });
  });
});

describe("Search's copy", () => {
  test("names a kind by the core's label, and the field by the arm", () => {
    expect(kindLabel(MOVIE)).toBe("Movies");
    expect(kindLabel(SERIES)).toBe("Series");
    expect(searchPlaceholder(true)).toBe("Search TMDB for a film or a series");
    expect(searchPlaceholder(false)).toBe(
      "Search the Addons' searchable Catalogs",
    );
  });

  test("a keyed row reads, reads on, and says what matched nothing", () => {
    expect(searchNote("reading", MOVIE, "dune")).toBe("Looking for movies…");
    expect(searchNote("reading-more", SERIES, "dune")).toBe(
      "Looking for more series…",
    );
    expect(searchNote("empty", MOVIE, "dune")).toBe("No movies matched “dune”.");
    expect(noMatches(SERIES, "dune")).toBe("No series matched “dune”.");
    expect(searchNote("ready", MOVIE, "dune")).toBeNull();
    expect(searchNote("failed", MOVIE, "dune")).toBeNull();
  });

  test("a keyless Search says what it is doing, and what a Catalog answered", () => {
    expect(CATALOGS_READING).toBe("Searching every searchable Catalog…");
    expect(NO_SEARCHABLE_CATALOGS).toBe(
      "No Addon offers a Catalog that can be searched.",
    );
  });

  test("a Catalog row says why it has no card, and says nothing when it has one", () => {
    expect(rowNote(row({ sent: 0 }))).toBe(
      "This Catalog answered with no match.",
    );
    expect(rowNote(row({ sent: 2 }))).toBe(
      "This Catalog sent items the Host could not read.",
    );
    expect(rowNote(row({ sent: 2, metas: [meta()] }))).toBeNull();
    expect(rowNote(row({ failure: { kind: "fetch", detail: "down" } }))).toBeNull();
  });
});

function meta() {
  return {
    id: "tt0133093",
    type: MOVIE,
    name: "The Matrix",
    poster: null,
    posterShape: null,
    background: null,
    releaseInfo: "1999",
    imdbRating: null,
    genres: [],
    description: null,
  };
}
