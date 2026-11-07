import { describe, expect, test } from "vitest";

import type { ContinueEntry, MetaPreview, Title } from "./wire";
import {
  titleAnchor,
  titleFacts,
  titleMainAction,
  titleSide,
  unmappedOf,
} from "./titlePage";

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

const SERIES: Title = title({
  id: "tt0",
  key: { kind: "addon", addon: "community.stremboxd", id: "tt0" },
  type: "series",
  videos: [
    { id: "tt0:1:1", name: "Pilot", season: 1, episode: 1, thumbnail: null, airDate: null },
    { id: "tt0:1:2", name: "Second", season: 1, episode: 2, thumbnail: null, airDate: null },
    { id: "tt0:2:1", name: "Third", season: 2, episode: 1, thumbnail: null, airDate: null },
  ],
});

function entry(overrides: Partial<ContinueEntry> = {}): ContinueEntry {
  return {
    video: { id: "tt0:1:2", name: null, season: 1, episode: 2, thumbnail: null, airDate: null },
    title: {
      addon: "community.stremboxd",
      id: "tt0",
      type: "series",
      name: "A series",
      poster: null,
      background: null,
    },
    position: 300,
    duration: 600,
    watched: false,
    upNext: false,
    unplayable: null,
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

  test("a series keeps the seasons in the Host's order, whose Specials are last", () => {
    const series = title({
      type: "series",
      videos: [
        { id: "tt0:1:1", name: "Pilot", season: 1, episode: 1, thumbnail: null, airDate: null },
        { id: "tt0:1:2", name: "Second", season: 1, episode: 2, thumbnail: null, airDate: null },
        { id: "tt0:2:1", name: "Third", season: 2, episode: 1, thumbnail: null, airDate: null },
        { id: "tt0:0:1", name: "Special", season: 0, episode: 1, thumbnail: null, airDate: null },
      ],
    });

    expect(titleSide(series).kind).toBe("series");
    const side = titleSide(series);
    expect(side.kind === "series" ? side.seasons.map((season) => season.season) : []).toEqual([
      1, 2, 0,
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

describe("the Title's anchor", () => {
  test("opens on the Continue watching entry's Video and its season", () => {
    expect(titleAnchor(SERIES, [entry()])).toEqual({
      season: 1,
      video: SERIES.videos[1],
    });

    expect(
      titleAnchor(SERIES, [
        entry({
          video: { id: "tt0:2:1", name: null, season: 2, episode: 1, thumbnail: null, airDate: null },
        }),
      ]),
    ).toEqual({ season: 2, video: SERIES.videos[2] });
  });

  test("opens at the beginning with no Video focused when the Title has no entry", () => {
    expect(titleAnchor(SERIES, [])).toEqual({ season: 1, video: null });
  });

  test("an entry for another Title does not anchor this one", () => {
    expect(
      titleAnchor(SERIES, [entry({ title: { ...entry().title, id: "tt9" } })]),
    ).toEqual({ season: 1, video: null });
  });

  test("anchors wherever the Title was opened from: identity is type and id, not the door", () => {
    // The same Title reached through another Addon, or through a Discover or
    // Library row, still carries the identity the Host groups its card by.
    const fromAnotherDoor = entry({
      title: { ...entry().title, addon: "another.addon" },
    });

    expect(titleAnchor(SERIES, [fromAnotherDoor])).toEqual({
      season: 1,
      video: SERIES.videos[1],
    });
  });

  test("a film anchors on the Video the Host recorded for it", () => {
    const film = title({ id: "tt0133093", type: "movie" });
    const watched = entry({
      video: { id: "tt0133093", name: null, season: null, episode: null, thumbnail: null, airDate: null },
      title: { ...entry().title, id: "tt0133093", type: "movie", name: "The Matrix" },
    });

    expect(titleAnchor(film, [watched])).toEqual({
      season: null,
      video: watched.video,
    });
  });
});

describe("the Title's main action", () => {
  test("a partly watched episode resumes it, naming the episode and the time left", () => {
    expect(titleMainAction(SERIES, [entry()])).toEqual({
      label: "Resume S1E2 · 5 min left",
      action: { type: "resume", video: { type: "series", id: "tt0:1:2" } },
    });
  });

  test("a partly watched film resumes without an episode label", () => {
    const film = title({ id: "tt0133093", type: "movie" });
    const watched = entry({
      video: { id: "tt0133093", name: null, season: null, episode: null, thumbnail: null, airDate: null },
      title: { ...entry().title, id: "tt0133093", type: "movie", name: "The Matrix" },
      position: 2_400,
      duration: 4_800,
    });

    expect(titleMainAction(film, [watched])).toEqual({
      label: "Resume · 40 min left",
      action: { type: "resume", video: { type: "movie", id: "tt0133093" } },
    });
  });

  test("a finished or unstarted Video has no main action until Play lands", () => {
    expect(titleMainAction(SERIES, [entry({ watched: true })])).toBeNull();
    expect(titleMainAction(SERIES, [entry({ position: null })])).toBeNull();
  });

  test("a Title with no entry has no main action", () => {
    expect(titleMainAction(SERIES, [])).toBeNull();
  });

  test("a partly watched Video with no length resumes without claiming a time left", () => {
    expect(titleMainAction(SERIES, [entry({ duration: null })])).toEqual({
      label: "Resume S1E2",
      action: { type: "resume", video: { type: "series", id: "tt0:1:2" } },
    });
  });
});
