import { describe, expect, test } from "vitest";

import type { Title } from "./host-client";
import { theFilm } from "./stream";

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
