import { describe, expect, test } from "vitest";

import { blankFeed, feedWith, MOVIE, type DiscoverFeed } from "../../core/discover";
import { SERIES } from "../../core/title";
import {
  discoverEmptyNote,
  discoverNoCounterpart,
  discoverNoKey,
  discoverPageAsk,
  discoverRowNote,
  discoverRowTag,
  discoverTag,
  feedMore,
  feedState,
  genreAsk,
  genresFor,
  rowsForKind,
  type GenreChoice,
} from "./editorial";

const ACTION: GenreChoice = { key: "Action", name: "Action", movie: 28, series: 10759 };
const TV_MOVIE: GenreChoice = { key: "TV Movie", name: "TV Movie", movie: 10770, series: null };
const KIDS: GenreChoice = { key: "Kids", name: "Kids", movie: null, series: 10762 };

function feed(overrides: Partial<DiscoverFeed> = {}): DiscoverFeed {
  return { ...blankFeed(), ...overrides };
}

describe("Discover's genres", () => {
  test("one row: the union of both kinds, each chip carrying the id each kind is asked by", () => {
    const genres = genresFor("host");

    expect(genres[0]).toEqual(ACTION);
    expect(genres).toContainEqual(TV_MOVIE);
    expect(genres).toContainEqual(KIDS);
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
      key: "Action",
      name: "Action",
      movie: "Action",
      series: "Action",
    });
    expect(genres).toContainEqual({
      key: "Reality-TV",
      name: "Reality-TV",
      movie: null,
      series: "Reality-TV",
    });
  });
});

describe("what a genre chip asks a kind", () => {
  test("All genres filters nothing, which is not the same as no counterpart", () => {
    expect(genreAsk(null, MOVIE)).toEqual({ kind: "all" });
    expect(genreAsk(null, SERIES)).toEqual({ kind: "all" });
    expect(genreAsk(TV_MOVIE, SERIES)).toEqual({ kind: "none" });
    expect(genreAsk(KIDS, MOVIE)).toEqual({ kind: "none" });
    expect(genreAsk(ACTION, SERIES)).toEqual({ kind: "value", value: 10759 });
  });

  test("a page is asked by the per-kind id, and not at all where the kind has no such genre", () => {
    const page = { source: "host" as const, page: 3, skip: 0 };

    expect(discoverPageAsk({ ...page, kind: MOVIE, genre: ACTION })).toEqual({
      type: "discover",
      kind: "movie",
      page: 3,
      genre: 28,
    });
    expect(discoverPageAsk({ ...page, kind: SERIES, genre: ACTION })).toEqual({
      type: "discover",
      kind: "series",
      page: 3,
      genre: 10759,
    });
    expect(
      discoverPageAsk({ ...page, kind: SERIES, genre: TV_MOVIE }),
      "the row is drawn empty rather than asking the unfiltered feed",
    ).toBeNull();
    expect(discoverPageAsk({ ...page, kind: MOVIE, genre: null })).toEqual({
      type: "discover",
      kind: "movie",
      page: 3,
    });
  });

  test("the preview asks Cinemeta by its name, both kinds or neither", () => {
    expect(
      discoverPageAsk({
        source: "preview",
        kind: MOVIE,
        genre: { key: "Action", name: "Action", movie: "Action", series: "Action" },
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
        genre: { key: "Reality-TV", name: "Reality-TV", movie: null, series: "Reality-TV" },
        page: 1,
        skip: 0,
      }),
    ).toBeNull();
  });
});

describe("a feed's paging and state", () => {
  test("More is offered only after a first page, or to retry a failed one", () => {
    expect(feedMore(feed())).toBe(false);
    expect(feedMore(feed({ failure: { kind: "fetch", detail: "down" } }))).toBe(true);
    expect(feedMore(feed({ page: 1 }))).toBe(true);
    expect(feedMore(feed({ page: 1, done: true }))).toBe(false);
  });

  test("a first page reads, a later page reads on, and a failed page is a failure", () => {
    expect(feedState(feed(), true)).toBe("reading");
    expect(feedState(feed({ page: 1 }), true)).toBe("reading-more");
    expect(feedState(feed({ failure: { kind: "fetch", detail: "down" } }), false)).toBe(
      "failed",
    );
  });

  test("an empty feed is only empty after the Addon answered nothing", () => {
    expect(feedState(feed(), false)).toBe("ready");
    expect(feedState(feed({ done: true }), false)).toBe("empty");
    expect(
      feedState(
        feed({ items: [{ ...meta(), id: "tt1" }] }),
        false,
      ),
    ).toBe("ready");
  });
});

describe("the editorial row's bookkeeping", () => {
  test("the tag names the filter or Trending, and the count the kind prints", () => {
    expect(discoverTag(MOVIE, null, 20)).toBe("Trending / 20 films");
    expect(discoverTag(SERIES, null, 1)).toBe("Trending / 1 series");
    expect(discoverTag(MOVIE, ACTION, 3)).toBe("Action / 3 films");
  });

  test("a row with no counterpart carries no tag, because it has no feed", () => {
    expect(discoverRowTag(feed(), SERIES, TV_MOVIE, { kind: "none" })).toBeNull();
  });

  test("a row says Reading before its first answer, then its filter and count", () => {
    expect(discoverRowTag(feed(), MOVIE, null, { kind: "all" })).toBe("Reading");
    expect(
      discoverRowTag(feed({ page: 1, items: [meta()] }), SERIES, ACTION, {
        kind: "value",
        value: 10759,
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
    expect(
      discoverRowNote("empty", MOVIE, ACTION, { kind: "value", value: 28 }),
    ).toBe(discoverEmptyNote(ACTION));
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

describe("a keyless Search's rows", () => {
  test("only the chosen kind's answering Catalogs are drawn, in the Host's order", () => {
    const rows = [
      { type: "movie", name: "Popular" },
      { type: "series", name: "Popular Series" },
      { type: "movie", name: "Top Rated" },
    ];

    expect(rowsForKind(rows, MOVIE).map((row) => row.name)).toEqual([
      "Popular",
      "Top Rated",
    ]);
    expect(rowsForKind(rows, SERIES).map((row) => row.name)).toEqual(["Popular Series"]);
  });
});

describe("a page folded into a feed", () => {
  test("a successful page advances the feed and the next More asks the next one", () => {
    const once = feedWith(feed(), {
      type: MOVIE,
      sent: 2,
      metas: [meta("tt1"), meta("tt2")],
      failure: null,
    });

    expect(once.page).toBe(1);
    expect(once.items).toHaveLength(2);
    expect(feedMore(once)).toBe(true);
  });
});

function meta(id = "tt0133093") {
  return {
    id,
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
