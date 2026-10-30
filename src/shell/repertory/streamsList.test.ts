import { describe, expect, test } from "vitest";

import type { MetaPreview, Snapshot, Title, Video } from "../../host-client";
import { candidateCountLabel, streamsGroupName, streamsSubject } from "./streamsList";

function title(overrides: Partial<Title> = {}): Title {
  return {
    addon: "community.stremboxd",
    id: "tt0903747",
    key: { kind: "addon", addon: "community.stremboxd", id: "tt0903747" },
    type: "series",
    name: "Breaking Bad",
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

function video(overrides: Partial<Video> = {}): Video {
  return {
    id: "tt0903747:1:2",
    name: "Cat's in the Bag...",
    season: 1,
    episode: 2,
    thumbnail: null,
    ...overrides,
  };
}

function card(overrides: Partial<MetaPreview> = {}): MetaPreview {
  return {
    id: "tt0133093",
    type: "movie",
    name: "The Matrix",
    poster: null,
    posterShape: "poster",
    background: null,
    releaseInfo: null,
    imdbRating: null,
    genres: [],
    description: null,
    ...overrides,
  };
}

const SNAPSHOT = {
  addons: [{ id: "torrentio", name: "Torrentio" }],
} as unknown as Snapshot;

describe("what the Streams are Streams of", () => {
  test("a series' episode is named by its number and the name the Addon gave", () => {
    expect(streamsSubject(title(), null, video())).toBe("S1E2 — Cat's in the Bag...");
  });

  test("a film is named by its Title, with the card standing in for a sparse answer", () => {
    const film = title({ id: "tt0133093", type: "movie", name: "tt0133093" });

    expect(streamsSubject(film, card(), { id: "tt0133093", name: null, season: null, episode: null, thumbnail: null })).toBe(
      "The Matrix",
    );
  });

  test("a Video with no number is named by its own name, and by its id when it has none", () => {
    expect(streamsSubject(title(), null, video({ season: null, episode: null }))).toBe(
      "Cat's in the Bag...",
    );
    expect(streamsSubject(title(), null, video({ season: null, episode: null, name: null }))).toBe(
      "tt0903747:1:2",
    );
  });
});

describe("the Streams list's bookkeeping", () => {
  test("an Addon group is headed by the Host's name for it, or by its id when it has none", () => {
    expect(streamsGroupName(SNAPSHOT, "torrentio")).toBe("Torrentio");
    expect(streamsGroupName(SNAPSHOT, "unknown.addon")).toBe("unknown.addon");
    expect(streamsGroupName(null, "torrentio")).toBe("torrentio");
  });

  test("the count says candidates and Addons, singular where there is one", () => {
    expect(candidateCountLabel(12, 3)).toBe("12 candidates / 3 Addons");
    expect(candidateCountLabel(1, 1)).toBe("1 candidate / 1 Addon");
    expect(candidateCountLabel(0, 2)).toBe("0 candidates / 2 Addons");
  });
});
