import { describe, expect, test } from "vitest";

import { queryOf, SEARCH_KINDS, searchAsk, searchFeedKey, searchReads } from "./search";

describe("the two TMDB rows", () => {
  test("are Movies then Series, and never a kind toggle", () => {
    expect(SEARCH_KINDS).toEqual([
      { kind: "movie", label: "Movies" },
      { kind: "series", label: "Series" },
    ]);
  });

  test("a row is asked by its query, kind and 1-based page", () => {
    expect(
      searchAsk({ query: "blood & guts", kind: "series", page: 2 }),
    ).toEqual({
      type: "search",
      query: "blood & guts",
      kind: "series",
      page: 2,
    });
  });
});

describe("the query a submit asks", () => {
  test("the field's words without their surrounding space", () => {
    expect(queryOf("  dune  ")).toBe("dune");
    expect(queryOf("blood & guts")).toBe("blood & guts");
  });

  test("an empty or blank field is not a question", () => {
    expect(queryOf("")).toBeNull();
    expect(queryOf("   ")).toBeNull();
  });
});

/**
 * The one decision both Search screens read (#248, S1): with a key both kinds
 * are asked for page 1; without one the Addons' searchable Catalogs are asked
 * once, as a single query.
 */
describe("what a Search screen reads", () => {
  test("a keyed query reads both kinds' first pages, under their own keys", () => {
    const read = searchReads(true, "dune");

    expect(read.arm).toBe("keyed");
    if (read.arm !== "keyed") {
      return;
    }
    expect(read.feeds).toEqual([
      {
        kind: "movie",
        key: searchFeedKey("dune", "movie"),
        first: { type: "search", query: "dune", kind: "movie", page: 1 },
        next: expect.any(Function),
      },
      {
        kind: "series",
        key: searchFeedKey("dune", "series"),
        first: { type: "search", query: "dune", kind: "series", page: 1 },
        next: expect.any(Function),
      },
    ]);
    expect(read.feeds[0]?.next({ page: 1 })).toEqual({
      type: "search",
      query: "dune",
      kind: "movie",
      page: 2,
    });
  });

  test("without a key the query is the one search_catalogs ask", () => {
    expect(searchReads(false, "dune")).toEqual({ arm: "catalogs", query: "dune" });
  });
});
