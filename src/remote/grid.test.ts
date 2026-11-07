import { describe, expect, test } from "vitest";

import type { Row } from "../core/browse";
import { blankFeed } from "../core/discover";
import type { FeedRow } from "../core/feedStore";
import type {
  AddonManifest,
  MetaPreview,
  ResumeEntry,
  Snapshot,
} from "../core/wire";
import {
  gridCouldPlay,
  gridEmptyNote,
  gridFeed,
  gridLevel,
  gridView,
  type RemoteGrid,
  type RemoteGridSource,
} from "./grid";

/**
 * The whole-row grid's decisions (#253, #264, ADR-0036 §1, design system
 * *Rail*).
 *
 * The grid is the row the rail has read and shares with it: Home and the
 * keyless Discover arm read the Session's Home store, a keyed Discover or
 * Search row the Session's feed store. A grid therefore copies no row into the
 * level; it decides what to draw from the store and how its page is read.
 */

function meta(id: string, name: string): MetaPreview {
  return {
    id,
    type: "movie",
    name,
    poster: null,
    posterShape: "poster",
    background: null,
    releaseInfo: "2026",
    imdbRating: null,
    genres: [],
    description: null,
  };
}

const ADDON: AddonManifest = {
  id: "cinemeta",
  name: "Cinemeta",
  version: "3.0.14",
  resources: [{ name: "stream", types: ["movie", "series"], idPrefixes: ["tt"] }],
  types: ["movie", "series"],
  catalogs: [],
  idPrefixes: ["tt"],
  behaviorHints: { configurable: false, configurationRequired: false },
};

const SNAPSHOT = {
  addons: [ADDON],
  featuredCatalog: null,
  watchProgress: [],
} as unknown as Snapshot;

const CATALOG_ROW: Row = {
  addon: "cinemeta",
  type: "movie",
  id: "top",
  name: "Popular",
  metas: [meta("tt1", "One")],
  offset: 1,
  failure: null,
  done: false,
};

const FEED: FeedRow = {
  ...blankFeed(),
  page: 1,
  items: [meta("tmdb:1", "One")],
  offset: 1,
};

const CONTINUE: ResumeEntry = {
  video: { id: "tt1:1:1", name: "Pilot", season: 1, episode: 1, thumbnail: null, airDate: null },
  title: {
    addon: "cinemeta",
    id: "tt1",
    type: "series",
    name: "One",
    poster: null,
    background: null,
  },
  position: 300,
  duration: 600,
  watched: false,
  unplayable: null,
};

describe("a whole-row grid", () => {
  test("names the level for the row it opens", () => {
    expect(
      gridLevel({
        title: "Popular",
        index: "02",
        tag: "Cinemeta / 1 film",
        addon: "cinemeta",
        source: { kind: "home", rowKey: "cinemeta/movie/top" },
      }),
    ).toEqual({
      name: "All of Popular",
      kind: "overlay",
      payload: {
        kind: "grid",
        grid: {
          title: "Popular",
          index: "02",
          tag: "Cinemeta / 1 film",
          addon: "cinemeta",
          source: { kind: "home", rowKey: "cinemeta/movie/top" },
        },
      },
    });
  });
});

describe("what a grid draws", () => {
  function grid(source: RemoteGridSource, tag: string | null = null): RemoteGrid {
    return { title: "Popular", index: "02", tag, addon: "cinemeta", source };
  }

  test("a Home grid shares the store's row, so a page the rail read is drawn", () => {
    const view = gridView(
      grid({ kind: "home", rowKey: "cinemeta/movie/top" }),
      [CATALOG_ROW],
      new Map(),
      SNAPSHOT,
    );

    expect(view.row).toBe(CATALOG_ROW);
    expect(view.metas).toEqual(CATALOG_ROW.metas);
    expect(view.title).toBe("Popular");
    expect(view.addon).toBe("cinemeta");
  });

  test("a Home row that has gone falls back to the name the rail printed", () => {
    const view = gridView(
      grid({ kind: "home", rowKey: "cinemeta/movie/top" }),
      [],
      new Map(),
      SNAPSHOT,
    );

    expect(view.row).toBeNull();
    expect(view.title).toBe("Popular");
    expect(view.addon).toBe("cinemeta");
  });

  test("a keyed Discover or Search grid reads the feed the rail drew", () => {
    const source: RemoteGridSource = {
      kind: "discover",
      feedKind: "movie",
      genreKey: "Drama",
      feedKey: "discover/host/Drama/movie",
    };
    const view = gridView(
      grid(source),
      [],
      new Map([["discover/host/Drama/movie", FEED]]),
      SNAPSHOT,
    );

    expect(view.feed).toBe(FEED);
    expect(view.metas).toEqual(FEED.items);
    expect(gridFeed(source, new Map([[source.feedKey, FEED]]))).toBe(FEED);
  });

  test("Continue watching is its own source, carrying the Host's entries", () => {
    const snapshot = { ...SNAPSHOT, watchProgress: [CONTINUE] } as Snapshot;
    const view = gridView(
      grid({ kind: "continue" }, "1 in progress"),
      [],
      new Map(),
      snapshot,
    );

    expect(view.entries).toEqual([CONTINUE]);
    expect(view.metas).toEqual([]);
    expect(view.row).toBeNull();
  });

  test("a Discovered grid's Titles are judged by the Addon that can play their kind", () => {
    const discover: RemoteGridSource = {
      kind: "discover",
      feedKind: "movie",
      genreKey: null,
      feedKey: "discover/host/all/movie",
    };
    expect(gridCouldPlay(discover, SNAPSHOT)).toBe(true);
    expect(
      gridCouldPlay(discover, null),
      "before the first Snapshot the screen does not guess",
    ).toBe(true);
    expect(
      gridCouldPlay(discover, { ...SNAPSHOT, addons: [] }),
      "no Addon can play the kind",
    ).toBe(false);
    expect(
      gridCouldPlay({ kind: "home", rowKey: "cinemeta/movie/top" }, { ...SNAPSHOT, addons: [] }),
      "a Catalog card has its own Addon",
    ).toBe(true);
  });

  test("the tag is read live from the row, not frozen when the grid was pushed", () => {
    const source: RemoteGridSource = { kind: "home", rowKey: "cinemeta/movie/top" };
    const stale: RemoteGrid = {
      title: "Popular",
      index: "02",
      tag: "Cinemeta / 20 films",
      addon: "cinemeta",
      source,
    };
    const view = gridView(stale, [CATALOG_ROW], new Map(), SNAPSHOT);

    expect(view.tag, "the row has read one, whatever the level was pushed with").toBe(
      "Cinemeta / 1 film",
    );
  });

  test("a keyed feed's tag is live too, and names its genre and count", () => {
    const source: RemoteGridSource = {
      kind: "discover",
      feedKind: "movie",
      genreKey: "Drama",
      feedKey: "discover/host/Drama/movie",
    };
    const view = gridView(
      {
        title: "Movies",
        index: "01",
        tag: "Drama / 20 films",
        addon: null,
        source,
      },
      [],
      new Map([[source.feedKey, FEED]]),
      SNAPSHOT,
    );

    expect(view.tag).toBe("Drama / 1 film");
  });

  test("a grid that ended before reading a card says what its source is", () => {
    expect(gridEmptyNote({ kind: "discover", feedKind: "movie", genreKey: null, feedKey: "x" })).toBe(
      "Nothing is screening in this feed.",
    );
    expect(
      gridEmptyNote({ kind: "search", feedKind: "movie", query: "dune", feedKey: "x" }),
      "Discover and Search are not an Addon's rows",
    ).toBe("No Titles matched the query.");
    expect(gridEmptyNote({ kind: "home", rowKey: "cinemeta/movie/top" })).toBe(
      "The Addon answered with no Titles in this section.",
    );
  });
});
