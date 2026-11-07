import { describe, expect, test } from "vitest";

import type { MetaPreview, Title, Video } from "./wire";
import { airsNote, discoveredKeyOf, titleArtOf, titleStubOf } from "./title";

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

function video(overrides: Partial<Video> = {}): Video {
  return {
    id: "tt0903747:1:1",
    name: "Pilot",
    season: 1,
    episode: 1,
    thumbnail: null,
    airDate: null,
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

describe("the air date an announced episode carries", () => {
  // Saturday 7 November 2026, in the machine's own zone: the day the decision
  // compares against is injected, so the test never reads the wall clock.
  const today = new Date(2026, 10, 7, 9, 30);

  test("a day after today is printed as the programme prints a date", () => {
    expect(airsNote(video({ airDate: "2026-11-12" }), today)).toBe("Airs 12 Nov");
    expect(airsNote(video({ airDate: "2027-01-03" }), today)).toBe("Airs 3 Jan");
  });

  test("today, a past day and no day are not announced", () => {
    expect(airsNote(video({ airDate: "2026-11-07" }), today)).toBeNull();
    expect(airsNote(video({ airDate: "2026-11-06" }), today)).toBeNull();
    expect(airsNote(video({ airDate: null }), today)).toBeNull();
    expect(airsNote(video({ airDate: "" }), today)).toBeNull();
  });

  test("a day the calendar does not have is no day", () => {
    for (const airDate of ["2026-13-01", "2026-02-30", "2026-1-2", "soon"]) {
      expect(airsNote(video({ airDate }), today)).toBeNull();
    }
  });
});
