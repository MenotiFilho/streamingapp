import { describe, expect, test } from "vitest";

import {
  LIBRARY_FILTERS,
  filterLibraryEntries,
  libraryEmptyCopy,
  libraryEntryProgress,
  libraryEntryWatched,
} from "./marqueeLibrary";
import type { LibraryEntry, ResumeEntry } from "./wire";

function entry(overrides: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
    id: "tt0133093",
    name: "The Matrix",
    type: "movie",
    poster: null,
    posterShape: "poster",
    mtime: 100,
    videoId: null,
    position: null,
    duration: null,
    continueWatching: false,
    ...overrides,
  };
}

function resume(overrides: Partial<ResumeEntry> = {}): ResumeEntry {
  return {
    video: {
      id: "tt0133093",
      name: null,
      season: null,
      episode: null,
      thumbnail: null,
      airDate: null,
    },
    title: {
      addon: "cinemeta",
      id: "tt0133093",
      type: "movie",
      name: "The Matrix",
      poster: null,
    },
    position: 7000,
    duration: 7200,
    watched: true,
    unplayable: null,
    ...overrides,
  };
}

describe("Marquee Library filtering", () => {
  test("offers All, Movies, and Series chips in order", () => {
    expect(LIBRARY_FILTERS).toEqual([
      { id: "all", label: "All" },
      { id: "movie", label: "Movies" },
      { id: "series", label: "Series" },
    ]);
  });

  test("filters entries by type while preserving the Host's order", () => {
    const entries = [
      entry({ id: "tt1", type: "series", name: "Severance" }),
      entry({ id: "tt2", type: "movie", name: "Dune" }),
      entry({ id: "tt3", type: "series", name: "The Last of Us" }),
    ];

    expect(filterLibraryEntries(entries, "all").map((item) => item.id)).toEqual([
      "tt1",
      "tt2",
      "tt3",
    ]);
    expect(filterLibraryEntries(entries, "movie").map((item) => item.id)).toEqual(["tt2"]);
    expect(filterLibraryEntries(entries, "series").map((item) => item.id)).toEqual([
      "tt1",
      "tt3",
    ]);
  });
});

describe("Marquee Library watched & progress marks and empty states", () => {
  test("marks watched movies from Watch progress and hides their progress bar", () => {
    const film = entry({ id: "tt0133093", type: "movie", position: 7000, duration: 7200 });
    const show = entry({ id: "tt0903747", type: "series", position: 1200, duration: 2400 });

    expect(libraryEntryWatched(film, [resume()])).toBe(true);
    expect(libraryEntryWatched(show, [resume({ title: { ...resume().title, id: "tt0903747", type: "series" } })])).toBe(
      false,
    );
    expect(libraryEntryProgress(film, true)).toBeNull();
    expect(libraryEntryProgress(show, false)).toBeCloseTo(0.5, 5);
    expect(libraryEntryProgress(entry({ position: 5000, duration: 2400 }), false)).toBe(1);
    expect(libraryEntryProgress(entry(), false)).toBeNull();
  });

  test("distinguishes an empty Library from an empty filter slice", () => {
    expect(libraryEmptyCopy("all")).toEqual({
      title: "Nothing in your Library yet",
      body: "Titles saved in your Stremio account will appear here.",
      canReset: false,
    });
    expect(libraryEmptyCopy("movie").canReset).toBe(true);
    expect(libraryEmptyCopy("series").canReset).toBe(true);
  });
});
