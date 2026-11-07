import { describe, expect, test } from "vitest";

import {
  DISCOVER_ROWS,
  MOVIE,
  discoverNoCounterpart,
} from "../core/discover";
import { SERIES } from "../core/title";
import type { AddonCatalog, AddonManifest, Snapshot } from "../core/wire";
import { NOTHING } from "./fakeSocket.testing";
import {
  catalogAsk,
  catalogMore,
  catalogNote,
  catalogPageAsk,
  catalogsOf,
  discoverNote,
  discoverTag,
  feedTitle,
  noCatalogState,
} from "./discoverScreen";

/**
 * Discover's own decisions (#207, ADR-0032).
 *
 * The genres and the ask are the core's and are tested there, and the feed's
 * paging is `feed.ts`'s; what is asked here is what this screen decides: the
 * rows it draws, the words it prints, and the Catalog rows the no-credential
 * arm draws.
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

describe("Discover's rows", () => {
  test("are Movies then Series, and the genre row comes before them", () => {
    expect(DISCOVER_ROWS).toEqual([
      { kind: MOVIE, label: "Movies" },
      { kind: SERIES, label: "Series" },
    ]);
    expect(DISCOVER_ROWS[0]?.kind).toBe(MOVIE);
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

  test("a row with no counterpart says why it is empty", () => {
    expect(discoverNoCounterpart(SERIES, "TV Movie")).toBe(
      "Nothing is screening here: TV Movie is not a series genre.",
    );
    expect(discoverNoCounterpart(MOVIE, "Kids")).toBe(
      "Nothing is screening here: Kids is not a film genre.",
    );
  });

  test("the tag names the filter or Trending, and the count the kind prints", () => {
    expect(discoverTag(MOVIE, null, 20)).toBe("Trending / 20 films");
    expect(discoverTag(SERIES, null, 1)).toBe("Trending / 1 series");
    expect(discoverTag(MOVIE, "Action", 3)).toBe("Action / 3 films");
  });
});

describe("the Catalogs the no-credential arm draws", () => {
  test("every declared Catalog of both kinds, in the Addons' own order", () => {
    expect(catalogsOf(SNAPSHOT).map(({ catalog }) => catalog.id)).toEqual([
      "top",
      "shows",
    ]);
    expect(catalogsOf(null)).toEqual([]);
  });

  test("with no Catalog at all, says what a person can do", () => {
    expect(noCatalogState()).toEqual({
      title: "Nothing is screening.",
      body: "No configured Addon offers a Catalog. Add one in Addons.",
    });
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
