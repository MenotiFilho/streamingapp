import { keyOf, type Row } from "../core/browse";
import {
  discoverPlayable,
  type DiscoverFeed,
  type DiscoverGenreChoice,
  type DiscoverKind,
} from "../core/discover";
import type { ActionError } from "../core/errors";
import type { NewLevel } from "../core/navigation";
import type { SearchKind } from "../core/search";
import type { MetaPreview, ResumeEntry, Snapshot } from "../core/wire";

/**
 * One rail opened as a whole (#253, ADR-0036 §1, design system *Rail*).
 *
 * The grid is the row the rail has read so far, not a second read: it never
 * asks a page of its own. Paging belongs to the rail's quiet head action, which
 * asks the next page into the same accumulated cards; More opens those cards.
 * A Home row is read from the Session's `HomeStore`, so the rail and the grid
 * are one row; the feeds the Discover and Search screens hold are carried into
 * the level, because those screens unmount under a pushed level.
 *
 * The type and the pure decisions live here; `RemoteGrid` draws them. The page
 * a rail asks is its own seam (`feed.ts`, `discoverScreen.ts`) because paging
 * belongs to the rail, not to the grid.
 */

/** Where a grid's cards come from. */
export type RemoteGridSource =
  | { kind: "home"; rowKey: string }
  | { kind: "continue" }
  | { kind: "catalog"; row: Row }
  | {
      kind: "discover";
      feedKind: DiscoverKind;
      /** The genre chip the row was asked under, or null for All genres. */
      genre: DiscoverGenreChoice | null;
      feed: DiscoverFeed;
    }
  | {
      kind: "search";
      feedKind: SearchKind;
      query: string;
      feed: DiscoverFeed;
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
    : source.kind === "catalog"
      ? source.row
      : null;
}

/** The Continue watching entries a grid draws, or null for a poster row. */
export function gridEntries(
  source: RemoteGridSource,
  snapshot: Snapshot | null,
): ResumeEntry[] | null {
  return source.kind === "continue" ? (snapshot?.watchProgress ?? []) : null;
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
  entries: ResumeEntry[] | null;
  metas: MetaPreview[];
  addon: string | null;
  title: string;
  failure: ActionError | null;
  couldPlay: boolean;
};

export function gridView(
  grid: RemoteGrid,
  rows: readonly Row[],
  snapshot: Snapshot | null,
): GridView {
  const { source } = grid;
  const row = gridRow(source, rows);
  const feed = source.kind === "discover" || source.kind === "search" ? source.feed : null;
  return {
    row,
    entries: gridEntries(source, snapshot),
    metas: row?.metas ?? feed?.items ?? [],
    addon: row?.addon ?? grid.addon,
    title: row?.name ?? grid.title,
    failure: row?.failure ?? feed?.failure ?? null,
    couldPlay: gridCouldPlay(source, snapshot),
  };
}
