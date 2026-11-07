import { describe, expect, test } from "vitest";

import type { MetaPreview, Title } from "./wire";
import { titleFacts, titleSide, unmappedOf } from "./titlePage";

function title(overrides: Partial<Title> = {}): Title {
  return {
    addon: "community.stremboxd",
    id: "tt0133093",
    key: { kind: "addon", addon: "community.stremboxd", id: "tt0133093" },
    type: "movie",
    name: "The Matrix",
    poster: "https://images.test/matrix-poster.jpg",
    background: "https://images.test/matrix-backdrop.jpg",
    logo: null,
    description: null,
    releaseInfo: "1999",
    runtime: "136 min",
    imdbRating: "8.7",
    genres: ["Action", "Science Fiction"],
    videos: [],
    ...overrides,
  };
}

function card(overrides: Partial<MetaPreview> = {}): MetaPreview {
  return {
    id: "tt0133093",
    type: "movie",
    name: "The Matrix",
    poster: "https://images.test/matrix-poster.jpg",
    posterShape: "poster",
    background: null,
    releaseInfo: "1998",
    imdbRating: null,
    genres: [],
    description: null,
    ...overrides,
  };
}

describe("the Title page's facts", () => {
  test("prints the record's order: IMDb, year, runtime, then genres", () => {
    expect(titleFacts(title())).toEqual([
      { role: "rating", text: "IMDb 8.7" },
      { role: "year", text: "1999" },
      { role: "runtime", text: "136 min" },
      { role: "genre", text: "Action" },
      { role: "genre", text: "Science Fiction" },
    ]);
  });

  test("falls back to the card's year for a sparse answer, and prints nothing it was not told", () => {
    const sparse = title({
      releaseInfo: null,
      runtime: null,
      imdbRating: null,
      genres: [],
    });

    expect(titleFacts(sparse)).toEqual([]);
    expect(titleFacts(sparse, card())).toEqual([{ role: "year", text: "1998" }]);
  });
});

describe("the Unmapped mark", () => {
  test("is an Addon-keyed Title, and a TMDB-mapped Title is not", () => {
    expect(unmappedOf(title())).toBe(true);
    expect(unmappedOf(title({ key: { kind: "tmdb", id: 603 } }))).toBe(false);
  });
});

describe("what the Title page offers next", () => {
  test("a film is one Video to find Streams for, and prints only its action", () => {
    expect(titleSide(title())).toEqual({ kind: "film" });
  });

  test("a series keeps its seasons in the order the Addon listed them", () => {
    const series = title({
      type: "series",
      videos: [
        { id: "tt0:0:1", name: "Special", season: 0, episode: 1, thumbnail: null, airDate: null },
        { id: "tt0:1:1", name: "Pilot", season: 1, episode: 1, thumbnail: null, airDate: null },
        { id: "tt0:1:2", name: "Second", season: 1, episode: 2, thumbnail: null, airDate: null },
        { id: "tt0:2:1", name: "Third", season: 2, episode: 1, thumbnail: null, airDate: null },
      ],
    });

    expect(titleSide(series).kind).toBe("series");
    const side = titleSide(series);
    expect(side.kind === "series" ? side.seasons.map((season) => season.season) : []).toEqual([
      0, 1, 2,
    ]);
  });

  test("a series whose Addon listed no episodes says so rather than becoming a film", () => {
    expect(titleSide(title({ type: "series" }))).toEqual({
      kind: "series-empty",
      kicker: "A series with no episodes",
      note: "This series' Addon listed no episodes, so there is nothing to ask Streams of.",
    });
  });
});
