import { describe, expect, test } from "vitest";

import { MOVIE } from "../core/discover";
import { SERIES } from "../core/title";
import type { AddonCatalog, AddonManifest, Snapshot } from "../core/wire";
import { NOTHING } from "./fakeSocket.testing";
import {
  ALL_GENRES,
  DISCOVER_KINDS,
  catalogAsk,
  catalogMore,
  catalogNote,
  catalogPageAsk,
  catalogsOf,
  discoverNote,
  discoverTag,
  feedTitle,
} from "./discoverScreen";

/**
 * Discover's own decisions (#207, ADR-0032).
 *
 * The genres and the ask are the core's and are tested there, and the feed's
 * paging is `feed.ts`'s; what is asked here is what this screen decides: the
 * chips, the words it prints, and the Catalog rows the no-credential arm draws.
 */

const SKIP = { name: "skip", isRequired: false, options: [], optionsLimit: 0 };
const GENRE = { name: "genre", isRequired: false, options: [], optionsLimit: 0 };

const FILMS: AddonCatalog = { type: "movie", id: "top", name: "Popular", extra: [SKIP] };
const SERIES_ROW: AddonCatalog = {
  type: "series",
  id: "shows",
  name: "Shows",
  extra: [GENRE],
};

function addon(overrides: Partial<AddonManifest> = {}): AddonManifest {
  return {
    id: "cinemeta",
    name: "Cinemeta",
    version: "3.0.14",
    resources: [{ name: "catalog", types: ["movie", "series"], idPrefixes: null }],
    types: ["movie", "series"],
    catalogs: [FILMS, SERIES_ROW],
    idPrefixes: ["tt"],
    behaviorHints: { configurable: false, configurationRequired: false },
    ...overrides,
  };
}

const SNAPSHOT: Snapshot = { ...NOTHING, addons: [addon()] };

describe("Discover's chips", () => {
  test("are Movie then Series, and Movie is where a person lands", () => {
    expect(DISCOVER_KINDS).toEqual([
      { kind: MOVIE, label: "Movie" },
      { kind: SERIES, label: "Series" },
    ]);
    expect(DISCOVER_KINDS[0]?.kind).toBe(MOVIE);
    expect(ALL_GENRES).toBe("All genres");
  });

  test("a feed is headed by its kind in the plural", () => {
    expect(feedTitle(MOVIE)).toBe("Movies");
    expect(feedTitle(SERIES)).toBe("Series");
  });
});

describe("what a feed prints", () => {
  test("reads, reads on, and says what an empty feed leaves a person to do", () => {
    expect(discoverNote("reading", null)).toBe("Reading the programme…");
    expect(discoverNote("reading-more", null)).toBe("Reading on…");
    expect(discoverNote("empty", null)).toBe("Nothing is screening in this feed.");
    expect(discoverNote("empty", "Action")).toBe(
      "Nothing is screening under Action. Choose another genre.",
    );
  });

  test("a ready or failed feed prints its own line elsewhere", () => {
    expect(discoverNote("ready", null)).toBeNull();
    expect(discoverNote("failed", "Action")).toBeNull();
  });

  test("the tag names the filter or Trending, and the count the kind prints", () => {
    expect(discoverTag(MOVIE, null, 20)).toBe("Trending / 20 films");
    expect(discoverTag(SERIES, null, 1)).toBe("Trending / 1 series");
    expect(discoverTag(MOVIE, "Action", 3)).toBe("Action / 3 films");
  });
});

describe("the Catalogs the no-credential arm draws", () => {
  test("only the chosen kind's, in the Addons' own order", () => {
    expect(catalogsOf(SNAPSHOT, MOVIE).map(({ catalog }) => catalog.id)).toEqual([
      "top",
    ]);
    expect(catalogsOf(SNAPSHOT, SERIES).map(({ catalog }) => catalog.id)).toEqual([
      "shows",
    ]);
    expect(catalogsOf(null, MOVIE)).toEqual([]);
  });

  test("the first page carries no values and the row is asked as it was declared", () => {
    expect(catalogAsk({ addon: "cinemeta", catalog: FILMS })).toEqual({
      type: "browse_catalog",
      addon: "cinemeta",
      catalog: { type: "movie", id: "top" },
      extra: [],
    });
  });

  test("paging on asks the skip the row has read to", () => {
    const row = {
      addon: "cinemeta",
      type: "movie",
      id: "top",
      name: "Popular",
      metas: [],
      offset: 4,
      failure: null,
      done: false,
    };
    expect(catalogPageAsk(row)).toEqual({
      type: "browse_catalog",
      addon: "cinemeta",
      catalog: { type: "movie", id: "top" },
      extra: [{ name: "skip", value: "4" }],
    });
  });

  test("a page that failed before its first answer retried page 1, never skip=0", () => {
    const row = {
      addon: "cinemeta",
      type: "movie",
      id: "top",
      name: "Popular",
      metas: [],
      offset: 0,
      failure: { kind: "fetch", detail: "down" } as const,
      done: false,
    };
    expect(catalogPageAsk(row)).toMatchObject({ extra: [] });
    expect(catalogMore(SNAPSHOT, row)).toBe(true);
  });

  test("More needs a declared skip, and either a page read or one that failed", () => {
    const row = {
      addon: "cinemeta",
      type: "movie",
      id: "top",
      name: "Popular",
      metas: [],
      offset: 0,
      failure: null,
      done: false,
    };
    expect(catalogMore(SNAPSHOT, row)).toBe(false);
    expect(catalogMore(SNAPSHOT, { ...row, offset: 4 })).toBe(true);
    expect(catalogMore(SNAPSHOT, { ...row, offset: 4, done: true })).toBe(false);
    expect(
      catalogMore(SNAPSHOT, {
        ...row,
        type: "series",
        id: "shows",
        offset: 4,
      }),
      "a Catalog that declares no skip has no next page to offer",
    ).toBe(false);
  });
});

describe("what a Catalog row prints", () => {
  const row = {
    addon: "cinemeta",
    type: "movie",
    id: "top",
    name: "Popular",
    metas: [],
    offset: 0,
    failure: null,
    done: false,
  };

  test("a row still to answer is reading, and one that answered nothing is empty", () => {
    expect(catalogNote(row)).toBe("Reading the programme…");
    expect(catalogNote({ ...row, done: true })).toBe(
      "The Catalog answered with no Titles.",
    );
  });

  test("a row with cards, or one that failed, prints its line elsewhere", () => {
    expect(catalogNote({ ...row, metas: [meta()] })).toBeNull();
    expect(
      catalogNote({ ...row, failure: { kind: "fetch", detail: "down" } }),
    ).toBeNull();
  });
});

function meta() {
  return {
    id: "tt0133093",
    type: MOVIE,
    name: "The Matrix",
    poster: null,
    posterShape: null,
    background: null,
    releaseInfo: "1999",
    imdbRating: null,
    genres: [],
    description: null,
  };
}
