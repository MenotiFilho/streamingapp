import { describe, expect, test } from "vitest";

import type { ActionOutcome } from "../core/answers";
import type { Row } from "../core/browse";
import { blankFeed } from "../core/discover";
import type { CatalogRow, DiscoverRow, MetaPreview } from "../core/wire";
import {
  gridLevel,
  gridPageAsk,
  gridWithPage,
  type RemoteGridSource,
} from "./grid";

/**
 * The grid's own decisions (#253, ADR-0036 §1).
 *
 * A row opened as a whole is the cards the rail has read, and the grid's head
 * action asks that same row for its next page — never a page of the grid's own.
 * These cases hold the pure half: the level it pushes, the ask, and the fold.
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

function catalogRow(
  id: string,
  metas: MetaPreview[],
  sent = metas.length,
  failure: CatalogRow["failure"] = null,
): CatalogRow {
  return {
    addon: "cinemeta",
    type: "movie",
    id,
    name: "Popular",
    sent,
    metas,
    failure,
  };
}

function discoverRow(
  metas: MetaPreview[],
  sent = metas.length,
  failure: DiscoverRow["failure"] = null,
): DiscoverRow {
  return { type: "movie", sent, metas, failure };
}

function catalogAnswer(row: CatalogRow): ActionOutcome {
  return {
    response: { snapshots: [], answer: { catalogs: [row] } },
    error: null,
  };
}

function discoverAnswer(row: DiscoverRow): ActionOutcome {
  return {
    response: { snapshots: [], answer: { discover: [row] } },
    error: null,
  };
}

function searchAnswer(row: DiscoverRow): ActionOutcome {
  return {
    response: { snapshots: [], answer: { search: row } },
    error: null,
  };
}

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

  test("a catalog's head action asks the page after what the row has read", () => {
    expect(gridPageAsk({ kind: "catalog", row: CATALOG_ROW })).toEqual({
      type: "browse_catalog",
      addon: "cinemeta",
      catalog: { type: "movie", id: "top" },
      extra: [{ name: "skip", value: "1" }],
    });
  });

  test("a catalog page appends to the cards the rail already read", () => {
    const source: RemoteGridSource = { kind: "catalog", row: CATALOG_ROW };

    const next = gridWithPage(
      source,
      catalogAnswer(catalogRow("top", [meta("tt2", "Two")], 1)),
    );

    expect(next).toMatchObject({
      kind: "catalog",
      row: {
        metas: [meta("tt1", "One"), meta("tt2", "Two")],
        offset: 2,
        done: false,
      },
    });
  });

  test("a failed catalog page keeps the cards and asks that page again", () => {
    const source: RemoteGridSource = { kind: "catalog", row: CATALOG_ROW };
    const failure = { kind: "fetch", detail: "timed out" } as const;

    const next = gridWithPage(source, { response: null, error: failure });

    expect(next).toMatchObject({
      kind: "catalog",
      row: { metas: [meta("tt1", "One")], failure },
    });
    expect(gridPageAsk(next)).toEqual({
      type: "browse_catalog",
      addon: "cinemeta",
      catalog: { type: "movie", id: "top" },
      extra: [{ name: "skip", value: "1" }],
    });
  });

  test("a Discover feed's head action asks one page on, by the kind's own genre id", () => {
    const feed = { ...blankFeed(), page: 1, items: [meta("tmdb:1", "One")] };
    const source: RemoteGridSource = {
      kind: "discover",
      feedKind: "series",
      genre: { name: "Action", movie: 28, series: 10759, all: false },
      feed,
    };

    expect(gridPageAsk(source)).toEqual({
      type: "discover",
      kind: "series",
      page: 2,
      genre: 10759,
    });
  });

  test("a grid under a genre its kind has no counterpart in has no page to ask", () => {
    const source: RemoteGridSource = {
      kind: "discover",
      feedKind: "series",
      genre: { name: "TV Movie", movie: 10770, series: null, all: false },
      feed: { ...blankFeed(), page: 1, items: [meta("tmdb:1", "One")] },
    };

    expect(gridPageAsk(source)).toBeNull();
  });

  test("a Discover page appends to the feed, and a failure keeps what it read", () => {
    const feed = { ...blankFeed(), page: 1, items: [meta("tmdb:1", "One")] };
    const source: RemoteGridSource = {
      kind: "discover",
      feedKind: "movie",
      genre: null,
      feed,
    };

    const next = gridWithPage(
      source,
      discoverAnswer(discoverRow([meta("tmdb:2", "Two")], 1)),
    );
    expect(next).toMatchObject({
      kind: "discover",
      feed: {
        page: 2,
        items: [meta("tmdb:1", "One"), meta("tmdb:2", "Two")],
      },
    });

    const failure = { kind: "tmdb", detail: "TMDB answered with status 429" } as const;
    const failed = gridWithPage(next, { response: null, error: failure });
    expect(failed).toMatchObject({
      kind: "discover",
      feed: { page: 2, items: [meta("tmdb:1", "One"), meta("tmdb:2", "Two")], failure },
    });
    expect(gridPageAsk(failed)).toEqual({
      type: "discover",
      kind: "movie",
      page: 3,
    });
  });

  test("a Search page appends to the feed the query has read", () => {
    const feed = { ...blankFeed(), page: 1, items: [meta("tmdb:1", "One")] };
    const source: RemoteGridSource = {
      kind: "search",
      feedKind: "movie",
      query: "the",
      feed,
    };

    const next = gridWithPage(
      source,
      searchAnswer(discoverRow([meta("tmdb:2", "Two")], 1)),
    );

    expect(next).toEqual({
      kind: "search",
      feedKind: "movie",
      query: "the",
      feed: {
        page: 2,
        items: [meta("tmdb:1", "One"), meta("tmdb:2", "Two")],
        failure: null,
        done: false,
      },
    });
  });

  test("a search asks the same page again when it failed", () => {
    const failure = { kind: "fetch", detail: "timed out" } as const;
    const source: RemoteGridSource = {
      kind: "search",
      feedKind: "movie",
      query: "the",
      feed: { ...blankFeed(), failure },
    };

    expect(gridPageAsk(source)).toEqual({
      type: "search",
      query: "the",
      kind: "movie",
      page: 1,
    });
  });
});
