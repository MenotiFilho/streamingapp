import { describe, expect, test } from "vitest";

import type { Title } from "./host-client";
import { streamsSubject, theFilm } from "./stream";

function film(overrides: Partial<Title> = {}): Title {
  return {
    addon: "community.stremboxd",
    id: "tt0133093",
    key: { kind: "addon", addon: "community.stremboxd", id: "tt0133093" },
    type: "movie",
    name: "The Matrix",
    poster: null,
    background: null,
    logo: null,
    description: null,
    releaseInfo: null,
    runtime: null,
    imdbRating: null,
    genres: [],
    videos: [],
    ...overrides,
  };
}

describe("the Video a film is watched as", () => {
  test("an Addon's own Title is played by the id its Addon indexes", () => {
    expect(theFilm(film()).id).toBe("tt0133093");
  });

  test("a Title TMDB met is played in TMDB's spelling, so progress unifies", () => {
    expect(
      theFilm(
        film({
          key: { kind: "tmdb", id: 603 },
        }),
      ).id,
    ).toBe("tmdb:603");
  });
});

describe("what the Streams are Streams of", () => {
  const video = {
    id: "tt0903747:1:2",
    name: "Cat's in the Bag...",
    season: 1,
    episode: 2,
    thumbnail: null,
  };
  const series = film({ id: "tt0903747", type: "series", name: "Breaking Bad" });

  test("a series' episode is named by its number and the name the Addon gave", () => {
    expect(streamsSubject(series, null, video)).toBe("S1E2 — Cat's in the Bag...");
  });

  test("a film is named by its Title, with the card standing in for a sparse answer", () => {
    const sparse = film({ id: "tt0133093", name: "tt0133093" });

    expect(
      streamsSubject(
        sparse,
        { id: "tt0133093", type: "movie", name: "The Matrix", poster: null },
        {
          id: "tt0133093",
          name: null,
          season: null,
          episode: null,
          thumbnail: null,
        },
      ),
    ).toBe("The Matrix");
  });

  test("a Video with no number is named by its name, and by its id when it has none", () => {
    expect(streamsSubject(series, null, { ...video, season: null, episode: null })).toBe(
      "Cat's in the Bag...",
    );
    expect(
      streamsSubject(series, null, { ...video, season: null, episode: null, name: null }),
    ).toBe("tt0903747:1:2");
  });
});
