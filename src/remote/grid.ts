import { keyOf, type Row } from "../core/browse";
import {
  discoverPlayable,
  type DiscoverKind,
} from "../core/discover";
import type { ActionError } from "../core/errors";
import type { FeedRow } from "../core/feedStore";
import { continueTag, rowTag, rowTagOf } from "../core/homeProgramme";
import type { NewLevel } from "../core/navigation";
import type { SearchKind } from "../core/search";
import type { ContinueEntry, MetaPreview, Snapshot } from "../core/wire";

/**
 * One rail opened as a whole (#253, ADR-0036 §1, design system *Rail*).
 *
 * The grid is the row the rail has read, and it reads on by itself (#264): when
 * the last cards come near the viewport, or focus reaches them, it asks that
 * row's next page. A page it reads lands in the same accumulated row the rail
 * draws, so Back keeps those cards and a page the rail asked is in the grid.
 *
 * A Home row and a keyless Discover row are read from the Session's `HomeStore`;
 * a keyed Discover or Search row from the Session's feed store, by the key its
 * feed was asked under. Nothing of the row is copied into the level, because a
 * copied row would not move when a page landed.
 *
 * The type and the pure decisions live here; `RemoteGrid` draws them.
 */

/** Where a grid's cards come from. */
export type RemoteGridSource =
  | { kind: "home"; rowKey: string }
  | { kind: "continue" }
  | {
      kind: "discover";
      feedKind: DiscoverKind;
      /** The genre chip the row was asked under, by the name both clients print. */
      genreKey: string | null;
      /** The Session feed store key the row is read under. */
      feedKey: string;
    }
  | {
      kind: "search";
      feedKind: SearchKind;
      query: string;
      /** The Session feed store key the row is read under. */
      feedKey: string;
    };

/** One whole-row grid as a level carries it. */
export type RemoteGrid = {
  /** The row's name, as the rail printed it. */
  title: string;
  /** The programme's numbered section head, as the rail printed it. */
  index?: string;
  /** The bookkeeping beside the name, as the rail printed it. */
  tag: string | null;
  /** The Addon that answered a poster row, or null for a Discovered Title. */
  addon: string | null;
  /** The cards the rail has read. */
  source: RemoteGridSource;
};

/** The payload a pushed grid level carries. */
export type GridPayload = { kind: "grid"; grid: RemoteGrid };

/**
 * The level a rail's More card pushes. It is an overlay named as the window
 * names it, so Back unwinds it to the rail (ADR-0034) and a test reads the
 * same name on both clients.
 */
export function gridLevel(grid: RemoteGrid): NewLevel<GridPayload> {
  return {
    name: `All of ${grid.title}`,
    kind: "overlay",
    payload: { kind: "grid", grid },
  };
}

/**
 * The row a Home grid shares with its rail: the store's row for the key, or
 * null where the Catalog has gone since the level was pushed.
 */
export function gridRow(source: RemoteGridSource, rows: readonly Row[]): Row | null {
  return source.kind === "home"
    ? (rows.find((row) => keyOf(row) === source.rowKey) ?? null)
    : null;
}

/** The feed a keyed grid shares with its rail, or null for a poster Home row. */
export function gridFeed(
  source: RemoteGridSource,
  feeds: ReadonlyMap<string, FeedRow>,
): FeedRow | null {
  return source.kind === "discover" || source.kind === "search"
    ? (feeds.get(source.feedKey) ?? null)
    : null;
}

/** The Continue watching entries a grid draws, or null for a poster row. */
export function gridEntries(
  source: RemoteGridSource,
  snapshot: Snapshot | null,
): ContinueEntry[] | null {
  return source.kind === "continue" ? (snapshot?.continueWatching ?? []) : null;
}

/**
 * Whether the grid's Titles can be played. A Catalog row's cards carry their
 * own Addon, so only a Discovered Title depends on an Addon being able to play
 * its kind; before the first Snapshot the screen does not guess.
 */
export function gridCouldPlay(
  source: RemoteGridSource,
  snapshot: Snapshot | null,
): boolean {
  if (source.kind !== "discover" && source.kind !== "search") {
    return true;
  }
  return snapshot ? discoverPlayable(snapshot.addons, source.feedKind) : true;
}

/** What a grid draws, decided once from its source and the rows the client holds. */
export type GridView = {
  row: Row | null;
  feed: FeedRow | null;
  entries: ContinueEntry[] | null;
  metas: MetaPreview[];
  addon: string | null;
  title: string;
  /** The bookkeeping beside the name, drawn live from the row (#264). */
  tag: string | null;
  failure: ActionError | null;
  couldPlay: boolean;
};

export function gridView(
  grid: RemoteGrid,
  rows: readonly Row[],
  feeds: ReadonlyMap<string, FeedRow>,
  snapshot: Snapshot | null,
): GridView {
  const { source } = grid;
  const row = gridRow(source, rows);
  const feed = gridFeed(source, feeds);
  return {
    row,
    feed,
    entries: gridEntries(source, snapshot),
    metas: row?.metas ?? feed?.items ?? [],
    addon: row?.addon ?? grid.addon,
    title: row?.name ?? grid.title,
    tag: gridTag(grid, row, feed, snapshot),
    failure: row?.failure ?? feed?.failure ?? null,
    couldPlay: gridCouldPlay(source, snapshot),
  };
}

/**
 * The bookkeeping beside the grid's name, read from the row where it is still
 * held: a grid opened at twenty titles prints twenty, and sixty once the row
 * has read on. The level's own string is only the fallback for a row that has
 * gone since the grid was pushed.
 */
function gridTag(
  grid: RemoteGrid,
  row: Row | null,
  feed: FeedRow | null,
  snapshot: Snapshot | null,
): string | null {
  const { source } = grid;
  switch (source.kind) {
    case "home":
      return row ? rowTag(snapshot, row) : grid.tag;
    case "continue":
      return continueTag(snapshot?.continueWatching.length ?? 0);
    case "discover":
      return feed
        ? rowTagOf(source.genreKey ?? "Trending", source.feedKind, feed.items.length)
        : grid.tag;
    case "search":
      return feed
        ? rowTagOf("TMDB", source.feedKind, feed.items.length)
        : grid.tag;
  }
}

/**
 * What a grid says where its row ended before it read a card. A TMDB row is not
 * an Addon's (CONTEXT.md), so the Addon's words are only the Home grid's.
 */
export function gridEmptyNote(source: RemoteGridSource): string {
  switch (source.kind) {
    case "discover":
      return "Nothing is screening in this feed.";
    case "search":
      return "No Titles matched the query.";
    default:
      return "The Addon answered with no Titles in this section.";
  }
}
