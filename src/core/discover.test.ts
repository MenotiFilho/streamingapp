import { describe, expect, test, vi } from "vitest";

import type { AddonManifest, DiscoverRow, MetaPreview } from "./wire";
import {
  ALL_GENRES,
  blankFeed,
  DISCOVER_GENRES,
  DISCOVER_ROWS,
  discoverAsk,
  discoverNoCounterpart,
  discoverPlayable,
  discoverReads,
  feedWith,
  genreFilterFor,
  genresOf,
  MOVIE,
  type DiscoverKind,
} from "./discover";
import { SERIES } from "./title";

function meta(overrides: Partial<MetaPreview> = {}): MetaPreview {
  return {
    id: "tmdb:603",
    type: "movie",
    name: "The Matrix",
    poster: "https://images.test/matrix.jpg",
    posterShape: null,
    background: null,
    releaseInfo: "1999",
    imdbRating: null,
    genres: [],
    description: null,
    ...overrides,
  };
}

function row(
  metas: MetaPreview[],
  sent = metas.length,
  failure: DiscoverRow["failure"] = null,
): DiscoverRow {
  return { type: "movie", sent, metas, failure };
}

function addon(overrides: Partial<AddonManifest> = {}): AddonManifest {
  return {
    id: "com.example.test",
    name: "Test",
    version: "1.0.0",
    resources: [{ name: "stream", types: ["movie", "series"], idPrefixes: ["tt"] }],
    types: ["movie", "series"],
    catalogs: [],
    idPrefixes: [],
    behaviorHints: { configurable: false, configurationRequired: false },
    ...overrides,
  };
}

describe("Discover's genres", () => {
  test("each kind is filtered by TMDB's own genre list for it", () => {
    expect(genresOf(MOVIE)).toContainEqual({ id: 28, name: "Action" });
    expect(genresOf(MOVIE)).toContainEqual({ id: 878, name: "Science Fiction" });
    expect(genresOf(MOVIE).map((genre) => genre.id)).not.toContain(10759);

    expect(genresOf(SERIES)).toContainEqual({ id: 10759, name: "Action & Adventure" });
    expect(genresOf(SERIES)).toContainEqual({ id: 10765, name: "Sci-Fi & Fantasy" });
    expect(
      genresOf(SERIES).map((genre) => genre.id),
      "a film's Action is not a series' genre",
    ).not.toContain(28);
  });
});

describe("Discover's one genre row", () => {
  function genreNamed(name: string) {
    const choice = DISCOVER_GENRES.find((held) => held.name === name);
    if (!choice) {
      throw new Error(`Discover's row has no ${name}`);
    }
    return choice;
  }

  test("is All genres, then TMDB's film order, then the series-only names, with the id each kind is asked by", () => {
    expect(
      DISCOVER_GENRES.map(({ name, movie, series }) => [name, movie, series]),
      "the union is TMDB's film list in its own order, with every series-only name after it",
    ).toEqual([
      ["All genres", null, null],
      ["Action", 28, 10759],
      ["Adventure", 12, 10759],
      ["Animation", 16, 16],
      ["Comedy", 35, 35],
      ["Crime", 80, 80],
      ["Documentary", 99, 99],
      ["Drama", 18, 18],
      ["Family", 10751, 10751],
      ["Fantasy", 14, 10765],
      ["History", 36, null],
      ["Horror", 27, null],
      ["Music", 10402, null],
      ["Mystery", 9648, 9648],
      ["Romance", 10749, null],
      ["Science Fiction", 878, 10765],
      ["TV Movie", 10770, null],
      ["Thriller", 53, null],
      ["War", 10752, 10768],
      ["Western", 37, 37],
      ["Kids", null, 10762],
      ["News", null, 10763],
      ["Reality", null, 10764],
      ["Soap", null, 10766],
      ["Talk", null, 10767],
    ]);
  });

  test("a combined series genre is reached through its film parts and is not a chip of its own", () => {
    const names = DISCOVER_GENRES.map((choice) => choice.name);

    expect(names).not.toContain("Action & Adventure");
    expect(names).not.toContain("Sci-Fi & Fantasy");
    expect(names).not.toContain("War & Politics");
    expect(genreFilterFor(genreNamed("Action"), SERIES)).toEqual({ kind: "id", id: 10759 });
    expect(genreFilterFor(genreNamed("Adventure"), SERIES)).toEqual({
      kind: "id",
      id: 10759,
    });
    expect(genreFilterFor(genreNamed("Science Fiction"), SERIES)).toEqual({
      kind: "id",
      id: 10765,
    });
    expect(genreFilterFor(genreNamed("Fantasy"), SERIES)).toEqual({ kind: "id", id: 10765 });
    expect(genreFilterFor(genreNamed("War"), SERIES)).toEqual({ kind: "id", id: 10768 });
  });

  test("All genres filters neither kind, unlike a genre with no counterpart in one", () => {
    expect(DISCOVER_GENRES[0]).toBe(ALL_GENRES);
    expect(ALL_GENRES.all).toBe(true);
    expect(
      genreFilterFor(ALL_GENRES, MOVIE),
      "All genres is not a genre id and not a missing one: it filters nothing",
    ).toEqual({ kind: "all" });
    expect(genreFilterFor(ALL_GENRES, SERIES)).toEqual({ kind: "all" });
    expect(
      genreFilterFor(null, MOVIE),
      "no chip held asks the same unfiltered feed as the All genres chip",
    ).toEqual({ kind: "all" });

    const filmOnly = genreNamed("TV Movie");
    expect(filmOnly.all).toBe(false);
    expect(genreFilterFor(filmOnly, MOVIE)).toEqual({ kind: "id", id: 10770 });
    expect(
      genreFilterFor(filmOnly, SERIES),
      "series have no TV Movie: the row is drawn empty, not asked unfiltered",
    ).toEqual({ kind: "none" });

    const seriesOnly = genreNamed("Kids");
    expect(seriesOnly.all).toBe(false);
    expect(genreFilterFor(seriesOnly, MOVIE)).toEqual({ kind: "none" });
    expect(genreFilterFor(seriesOnly, SERIES)).toEqual({ kind: "id", id: 10762 });
  });
});

describe("the Discover ask", () => {
  test("with no genre it is the week's trending feed", () => {
    expect(discoverAsk({ kind: MOVIE, page: 1, genre: null })).toEqual({
      type: "discover",
      kind: "movie",
      page: 1,
    });
  });

  test("a genre travels by TMDB's id for the kind", () => {
    expect(discoverAsk({ kind: SERIES, page: 3, genre: 10765 })).toEqual({
      type: "discover",
      kind: "series",
      page: 3,
      genre: 10765,
    });
  });
});

/**
 * The one decision both Discover screens read (#248, S1): two rows, in the same
 * order, each asked page 1 under its own genre counterpart.
 */
describe("what a Discover screen reads", () => {
  const ask = vi.fn(
    (
      kind: DiscoverKind,
      page: number,
      filter: { kind: string; id?: number },
      skip: number,
    ) => ({
      type: "discover" as const,
      kind,
      page,
      ...(filter.kind === "id" ? { genre: filter.id } : {}),
      ...(skip === 0 ? {} : { skip }),
    }),
  );

  test("both kinds, Movies then Series, under the source's feed keys", () => {
    const [movies, series] = discoverReads("host", null, ask);

    expect(DISCOVER_ROWS.map(({ kind }) => kind)).toEqual(["movie", "series"]);
    expect(movies).toMatchObject({
      kind: "movie",
      key: "discover/host/all/movie",
      first: { type: "discover", kind: "movie", page: 1 },
    });
    expect(series?.key).toBe("discover/host/all/series");
    expect(series?.first).toEqual({ type: "discover", kind: "series", page: 1 });
    expect(movies?.next({ page: 1, offset: 20 })).toEqual({
      type: "discover",
      kind: "movie",
      page: 2,
      skip: 20,
    });
  });

  test("a genre asks each kind by its own counterpart and keys the feed by its name", () => {
    const action = DISCOVER_GENRES.find((choice) => choice.name === "Action");
    if (!action) {
      throw new Error("Discover has no Action chip");
    }

    const reads = discoverReads("host", action, ask);

    expect(reads.map((read) => read.key)).toEqual([
      "discover/host/Action/movie",
      "discover/host/Action/series",
    ]);
    expect(reads[0]?.first).toMatchObject({ kind: "movie", genre: 28 });
    expect(reads[1]?.first).toMatchObject({ kind: "series", genre: 10759 });
  });

  test("a kind with no counterpart gets no row to read at all", () => {
    const filmOnly = DISCOVER_GENRES.find((choice) => choice.name === "TV Movie");
    if (!filmOnly) {
      throw new Error("Discover has no TV Movie chip");
    }

    expect(discoverReads("host", filmOnly, ask).map((read) => read.kind)).toEqual([
      "movie",
    ]);
  });

  test("a row says why a kind has no counterpart, in one copy", () => {
    expect(discoverNoCounterpart(SERIES, "TV Movie")).toBe(
      "Nothing is screening here: TV Movie is not a series genre.",
    );
  });
});

describe("a Discover feed", () => {
  test("a page is appended in TMDB's order and the next page is one on", () => {
    const first = feedWith(blankFeed(), row([meta()], 1));
    expect(first.page).toBe(1);
    expect(first.items.map((item) => item.id)).toEqual(["tmdb:603"]);
    expect(first.done).toBe(false);

    const second = feedWith(
      first,
      row([meta({ id: "tmdb:604", name: "The Matrix Reloaded" })], 1),
    );
    expect(second.page).toBe(2);
    expect(second.items.map((item) => item.id)).toEqual(["tmdb:603", "tmdb:604"]);
    expect(second.done).toBe(false);
  });

  test("an item TMDB repeats across pages is held once", () => {
    const first = feedWith(blankFeed(), row([meta()], 1));
    const repeated = feedWith(first, row([meta()], 1));

    expect(repeated.items).toHaveLength(1);
    expect(
      repeated.done,
      "TMDB sent a page, so the next one is still worth asking for",
    ).toBe(false);
  });

  test("an empty page is the end of the feed", () => {
    const first = feedWith(blankFeed(), row([], 0));
    expect(first.page).toBe(1);
    expect(first.done).toBe(true);
  });

  test("a failed page keeps the items already held and the page it was on", () => {
    const first = feedWith(blankFeed(), row([meta()], 1));
    const failed = feedWith(
      first,
      row([], 0, { kind: "tmdb", detail: "TMDB answered with status 429" }),
    );

    expect(failed.page).toBe(first.page);
    expect(failed.items).toEqual(first.items);
    expect(failed.failure).toEqual({
      kind: "tmdb",
      detail: "TMDB answered with status 429",
    });
    expect(failed.done).toBe(false);

    const retried = feedWith(
      failed,
      row([meta({ id: "tmdb:604", name: "The Matrix Reloaded" })], 1),
    );
    expect(retried.page).toBe(2);
    expect(retried.failure).toBeNull();
    expect(retried.items).toHaveLength(2);
  });

  test("a feed that fails before its first page asks that page again", () => {
    const failed = feedWith(
      blankFeed(),
      row([], 0, { kind: "tmdb", detail: "TMDB answered with status 429" }),
    );
    expect(failed.page).toBe(0);
    expect(failed.items).toEqual([]);

    const answered = feedWith(failed, row([meta()], 1));
    expect(answered.page).toBe(1);
    expect(answered.failure).toBeNull();
  });

  test("a blank feed has read nothing and holds no page", () => {
    expect(blankFeed()).toEqual({
      page: 0,
      items: [],
      failure: null,
      done: false,
    });
  });
});

describe("whether a Discovered Title could ever be played", () => {
  test("an Addon whose stream resource declares tmdb: could answer", () => {
    expect(
      discoverPlayable(
        [addon({ resources: [{ name: "stream", types: ["movie"], idPrefixes: ["tmdb:"] }] })],
        MOVIE,
      ),
    ).toBe(true);
  });

  test("an Addon whose stream resource declares tt could answer through the id bridge", () => {
    expect(discoverPlayable([addon()], MOVIE)).toBe(true);
    expect(discoverPlayable([addon()], SERIES)).toBe(true);
  });

  test("a resource with no prefixes of its own falls back to the manifest's", () => {
    expect(
      discoverPlayable(
        [
          addon({
            resources: [{ name: "stream", types: ["movie"], idPrefixes: null }],
            idPrefixes: ["tt"],
          }),
        ],
        MOVIE,
      ),
    ).toBe(true);
  });

  test("an empty resource prefix list overrides the manifest, as the Host reads it", () => {
    expect(
      discoverPlayable(
        [
          addon({
            resources: [{ name: "stream", types: ["movie"], idPrefixes: [] }],
            idPrefixes: ["tt"],
          }),
        ],
        MOVIE,
      ),
    ).toBe(false);
  });

  test("a stream resource that does not cover the kind could not answer it", () => {
    expect(
      discoverPlayable(
        [addon({ resources: [{ name: "stream", types: ["series"], idPrefixes: ["tt"] }] })],
        MOVIE,
      ),
    ).toBe(false);
    expect(
      discoverPlayable(
        [addon({ resources: [{ name: "stream", types: ["series"], idPrefixes: ["tt"] }] })],
        SERIES,
      ),
    ).toBe(true);
  });

  test("an Addon with no stream resource, or with only other prefixes, could never answer", () => {
    expect(
      discoverPlayable(
        [addon({ resources: [{ name: "meta", types: ["movie"], idPrefixes: ["tt"] }] })],
        MOVIE,
      ),
    ).toBe(false);
    expect(
      discoverPlayable(
        [addon({ resources: [{ name: "stream", types: ["movie"], idPrefixes: ["kitsu"] }] })],
        MOVIE,
      ),
    ).toBe(false);
    expect(discoverPlayable([], MOVIE)).toBe(false);
  });
});
