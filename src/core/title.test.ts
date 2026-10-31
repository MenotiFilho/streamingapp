import { describe, expect, test } from "vitest";

import type { MetaPreview, Title } from "./wire";
import { discoveredKeyOf, titleArtOf, titleStubOf } from "./title";

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
    runtime: null,
    imdbRating: null,
    genres: [],
    videos: [],
    ...overrides,
  };
}

function preview(overrides: Partial<MetaPreview> = {}): MetaPreview {
  return {
    id: "tt0133093",
    type: "movie",
    name: "The Matrix",
    poster: "https://images.test/matrix-poster.jpg",
    posterShape: "poster",
    background: null,
    releaseInfo: "1999",
    imdbRating: null,
    genres: [],
    description: null,
    ...overrides,
  };
}

describe("the Title screen's art", () => {
  test("the Title's own backdrop beats the card's and the poster", () => {
    expect(
      titleArtOf(
        title(),
        preview({ background: "https://images.test/card-backdrop.jpg" }),
      ),
    ).toEqual({
      src: "https://images.test/matrix-backdrop.jpg",
      kind: "background",
    });
  });

  test("the card's backdrop stands in for a sparse Title", () => {
    expect(
      titleArtOf(
        title({ background: null }),
        preview({ background: "https://images.test/card-backdrop.jpg" }),
      ),
    ).toEqual({
      src: "https://images.test/card-backdrop.jpg",
      kind: "background",
    });
  });

  test("the poster is the last art standing, and no art is no art", () => {
    expect(titleArtOf(title({ background: null }), preview())).toEqual({
      src: "https://images.test/matrix-poster.jpg",
      kind: "poster",
    });
    expect(
      titleArtOf(
        title({ background: null, poster: null }),
        preview({ poster: null }),
      ),
    ).toEqual({ src: null, kind: "none" });
  });
});

describe("the Title card sent back with a play", () => {
  test("carries the backdrop the Title screen drew, where there is one", () => {
    const card = titleStubOf(
      title(),
      preview({ background: "https://images.test/card-backdrop.jpg" }),
    );

    expect(card.background).toBe("https://images.test/matrix-backdrop.jpg");
  });

  test("falls back to the card's backdrop for a sparse Title", () => {
    const card = titleStubOf(
      title({ background: null }),
      preview({ background: "https://images.test/card-backdrop.jpg" }),
    );

    expect(card.background).toBe("https://images.test/card-backdrop.jpg");
  });

  test("omits the key where no art has a backdrop", () => {
    const card = titleStubOf(title({ background: null }), preview());

    expect(card).not.toHaveProperty("background");
  });
});

describe("a Discovered Title's key", () => {
  test.each([
    ["tmdb:603", { kind: "tmdb", id: 603 }],
    ["tmdb:1396", { kind: "tmdb", id: 1396 }],
  ] as const)("%s is TMDB's own id", (id, key) => {
    expect(discoveredKeyOf(id)).toEqual(key);
  });

  test.each(["tt0133093", "tmdb:", "tmdb:60x", "tmdb:603:1:1"])(
    "%s is not a Discovered Title's key",
    (id) => {
      expect(discoveredKeyOf(id)).toBeNull();
    },
  );
});
