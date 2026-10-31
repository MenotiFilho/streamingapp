import { describe, expect, test } from "vitest";

import { SEARCH_KINDS, searchAsk } from "./search";

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
