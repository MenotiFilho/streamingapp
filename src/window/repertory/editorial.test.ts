import { describe, expect, test } from "vitest";

import {
  DISCOVER_GENRES,
  MOVIE,
  blankFeed,
  discoverNoCounterpart,
  type DiscoverFeed,
} from "../../core/discover";
import { SERIES } from "../../core/title";
import type { MetaPreview } from "../../core/wire";
import {
  discoverEmptyNote,
  discoverNoKey,
  discoverPageAsk,
  discoverRowNote,
  discoverRowTag,
  genresFor,
} from "./editorial";

/**
 * The window's half of Discover and Search (ADR-0032, ADR-0035 §1): the
 * preview's own genres and asks, a row's bookkeeping and the copy it prints.
 * The genre filter, the kinds, the feed state and the "no counterpart" line are
 * the core's and are tested there.
 */

const ACTION = DISCOVER_GENRES.find((genre) => genre.name === "Action")!;
const TV_MOVIE = DISCOVER_GENRES.find((genre) => genre.name === "TV Movie")!;

function feed(overrides: Partial<DiscoverFeed> = {}): DiscoverFeed {
  return { ...blankFeed(), ...overrides };
}

describe("Discover's genres", () => {
  test("one row: the union of both kinds, each chip carrying the id each kind is asked by", () => {
    const genres = genresFor("host");

    expect(genres[0]).toEqual(ACTION);
    expect(genres).toContainEqual(TV_MOVIE);
    expect(genres).toContainEqual({
      name: "Kids",
      movie: null,
      series: 10762,
      all: false,
    });
    expect(
      genres.some((genre) => genre.name === "All genres"),
      "All genres is the chip that clears the filter, not one of the union",
    ).toBe(false);
    expect(
      genres.map((genre) => genre.name),
      "a combined series genre is reached through its film parts",
    ).not.toContain("Action & Adventure");
  });

  test("the preview's row is Cinemeta's own union, asked by its genre name", () => {
    const genres = genresFor("preview");

    expect(genres[0]).toEqual({
      name: "Action",
      movie: "Action",
      series: "Action",
      all: false,
    });
    expect(genres).toContainEqual({
      name: "Reality-TV",
      movie: null,
      series: "Reality-TV",
      all: false,
    });
  });
});

describe("a page is asked by the filter the core decided", () => {
  test("the Host is asked by the per-kind id, and not at all where there is no counterpart", () => {
    expect(
      discoverPageAsk({
        source: "host",
        kind: MOVIE,
        filter: { kind: "id", id: 28 },
        page: 3,
        skip: 0,
      }),
    ).toEqual({ type: "discover", kind: "movie", page: 3, genre: 28 });
    expect(
      discoverPageAsk({
        source: "host",
        kind: SERIES,
        filter: { kind: "id", id: 10759 },
        page: 3,
        skip: 0,
      }),
    ).toEqual({ type: "discover", kind: "series", page: 3, genre: 10759 });
    expect(
      discoverPageAsk({
        source: "host",
        kind: SERIES,
        filter: { kind: "none" },
        page: 3,
        skip: 0,
      }),
      "the row is drawn empty rather than asking the unfiltered feed",
    ).toBeNull();
    expect(
      discoverPageAsk({
        source: "host",
        kind: MOVIE,
        filter: { kind: "all" },
        page: 3,
        skip: 0,
      }),
    ).toEqual({ type: "discover", kind: "movie", page: 3 });
  });

  test("the preview asks Cinemeta by its name, both kinds or neither", () => {
    expect(
      discoverPageAsk({
        source: "preview",
        kind: MOVIE,
        filter: { kind: "id", id: "Action" },
        page: 1,
        skip: 40,
      }),
    ).toEqual({
      type: "browse_catalog",
      addon: "cinemeta",
      catalog: { type: "movie", id: "top" },
      extra: [
        { name: "genre", value: "Action" },
        { name: "skip", value: "40" },
      ],
    });
    expect(
      discoverPageAsk({
        source: "preview",
        kind: MOVIE,
        filter: { kind: "none" },
        page: 1,
        skip: 0,
      }),
    ).toBeNull();
  });
});

describe("the editorial row's bookkeeping", () => {
  test("a row with no counterpart carries no tag, because it has no feed", () => {
    expect(discoverRowTag(feed(), SERIES, TV_MOVIE, { kind: "none" })).toBeNull();
  });

  test("a row says Reading before its first answer, then its filter and count", () => {
    expect(discoverRowTag(feed(), MOVIE, null, { kind: "all" })).toBe("Reading");
    expect(
      discoverRowTag(feed({ page: 1, items: [meta()] }), SERIES, ACTION, {
        kind: "id",
        id: 10759,
      }),
    ).toBe("Action / 1 series");
  });

  test("a row with no counterpart says why, instead of an empty-feed line", () => {
    expect(discoverNoCounterpart(SERIES, "TV Movie")).toBe(
      "Nothing is screening here: TV Movie is not a series genre.",
    );
    expect(
      discoverRowNote("ready", SERIES, TV_MOVIE, { kind: "none" }),
    ).toBe(discoverNoCounterpart(SERIES, "TV Movie"));
    expect(discoverRowNote("empty", MOVIE, ACTION, { kind: "id", id: 28 })).toBe(
      discoverEmptyNote(ACTION),
    );
    expect(discoverRowNote("reading", MOVIE, null, { kind: "all" })).toBe(
      "Reading the programme…",
    );
  });

  test("the no-key state names what powers Discover and where the key goes", () => {
    expect(discoverNoKey()).toEqual({
      title: "Discover is powered by TMDB",
      body:
        "TMDB supplies the weekly Trending feed and the genres it can be filtered by. Add a TMDB API key in Settings → Credentials to browse it.",
      action: "Open Settings → Credentials",
    });
  });

  test("an empty feed says what a person can do about it", () => {
    expect(discoverEmptyNote(null)).toBe("Nothing is screening in this feed.");
    expect(discoverEmptyNote(ACTION)).toBe(
      "Nothing is screening under Action. Choose another genre.",
    );
  });
});

function meta(): MetaPreview {
  return {
    id: "tt0133093",
    type: MOVIE,
    name: "The Matrix",
    poster: null,
    posterShape: null,
    background: null,
    releaseInfo: "1999",
    imdbRating: "8.7",
    genres: ["Action"],
    description: null,
  };
}
