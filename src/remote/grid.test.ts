import { describe, expect, test } from "vitest";

import type { Row } from "../core/browse";
import { blankFeed } from "../core/discover";
import type {
  AddonManifest,
  MetaPreview,
  ResumeEntry,
  Snapshot,
} from "../core/wire";
import {
  gridCouldPlay,
  gridLevel,
  gridView,
  type RemoteGrid,
  type RemoteGridSource,
} from "./grid";

/**
 * The whole-row grid's decisions (#253, ADR-0036 §1, design system *Rail*).
 *
 * The grid is the cards the rail has read: paging belongs to the rail's quiet
 * head action, so the grid decides only what it draws — the row it shares with
 * the store, the Continue watching record, the tag the rail printed, and
 * whether a Discovered Title can play. Its paging rules live with their own
 * seams (`feed.ts`, `discoverScreen.ts`).
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

const CONTINUE: ResumeEntry = {
  video: { id: "tt1:1:1", name: "Pilot", season: 1, episode: 1, thumbnail: null },
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
        source: { kind: "catalog", row: CATALOG_ROW },
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
          source: { kind: "catalog", row: CATALOG_ROW },
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
      SNAPSHOT,
    );

    expect(view.row).toBeNull();
    expect(view.title).toBe("Popular");
    expect(view.addon).toBe("cinemeta");
  });

  test("Continue watching is its own source, carrying the Host's entries", () => {
    const snapshot = { ...SNAPSHOT, watchProgress: [CONTINUE] } as Snapshot;
    const view = gridView(grid({ kind: "continue" }, "1 in progress"), [], snapshot);

    expect(view.entries).toEqual([CONTINUE]);
    expect(view.metas).toEqual([]);
    expect(view.row).toBeNull();
  });

  test("a Discovered grid's Titles are judged by the Addon that can play their kind", () => {
    const discover: RemoteGridSource = {
      kind: "discover",
      feedKind: "movie",
      genre: null,
      feed: { ...blankFeed(), page: 1, items: [meta("tmdb:1", "One")] },
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
      gridCouldPlay({ kind: "catalog", row: CATALOG_ROW }, { ...SNAPSHOT, addons: [] }),
      "a Catalog card has its own Addon",
    ).toBe(true);
  });

  test("the tag is the string the rail printed, not a second decision", () => {
    const view = gridView(
      grid({ kind: "catalog", row: CATALOG_ROW }, "Cinemeta / 1 film"),
      [],
      SNAPSHOT,
    );
    expect(view.metas).toEqual(CATALOG_ROW.metas);
    expect(grid({ kind: "catalog", row: CATALOG_ROW }, "Cinemeta / 1 film").tag).toBe(
      "Cinemeta / 1 film",
    );
  });
});
