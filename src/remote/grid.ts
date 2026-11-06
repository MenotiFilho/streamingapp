import { answeredCatalogs, answeredDiscover, answeredSearch } from "../core/answers";
import type { ActionOutcome } from "../core/answers";
import { rowWith, type Row } from "../core/browse";
import {
  discoverAsk,
  genreFilterFor,
  type DiscoverFeed,
  type DiscoverGenreChoice,
  type DiscoverKind,
} from "../core/discover";
import type { NewLevel } from "../core/navigation";
import { searchAsk, type SearchKind } from "../core/search";
import type { Action } from "../core/wire";
import { catalogPageAsk } from "./discoverScreen";
import { feedAfter, pageToAsk } from "./feed";

/**
 * One rail opened as a whole (#253, ADR-0036 §1, design system *Rail*).
 *
 * The grid is the row the rail has read so far, not a second read: its head
 * action asks the same row for its next page, and the page appends to the same
 * accumulated cards. It never asks a page on mount. A Home row is read from
 * the Session's `HomeStore`, so the rail and the grid are one row; the feeds
 * the Discover and Search screens hold are carried into the level, because
 * those screens unmount under a pushed level.
 *
 * The type and the two pure decisions live here; `RemoteGrid` draws them.
 */

/** Where a grid's cards come from, and the page its head action asks. */
export type RemoteGridSource =
  | { kind: "home"; rowKey: string | null }
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
  /** The cards and the row they page. */
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
 * The page a grid's head action asks, or null where the row pages through a
 * store instead of an Action (Home, and Continue watching's own record).
 */
export function gridPageAsk(source: RemoteGridSource): Action | null {
  switch (source.kind) {
    case "home":
      return null;
    case "catalog":
      return catalogPageAsk(source.row);
    case "discover": {
      const filter =
        source.genre === null
          ? { kind: "all" as const }
          : genreFilterFor(source.genre, source.feedKind);
      if (filter.kind === "none") {
        return null;
      }
      return discoverAsk({
        kind: source.feedKind,
        page: pageToAsk(source.feed),
        genre: filter.kind === "id" ? filter.id : null,
      });
    }
    case "search":
      return searchAsk({
        query: source.query,
        kind: source.feedKind,
        page: pageToAsk(source.feed),
      });
  }
}

/**
 * The source with one page answer folded in. A failure keeps every card the
 * row already read and leaves the page where it was, so the same press asks
 * that page again (ADR-0020). Home is untouched: its page comes through the
 * store, which is the row the rail draws.
 */
export function gridWithPage(
  source: RemoteGridSource,
  outcome: ActionOutcome,
): RemoteGridSource {
  switch (source.kind) {
    case "home":
      return source;
    case "catalog": {
      if (outcome.error) {
        return { ...source, row: { ...source.row, failure: outcome.error } };
      }
      const answer = answeredCatalogs(outcome.response)[0] ?? null;
      return {
        ...source,
        row: answer
          ? rowWith(source.row, answer)
          : { ...source.row, done: true },
      };
    }
    case "discover": {
      if (outcome.error) {
        return {
          ...source,
          feed: { ...source.feed, failure: outcome.error },
        };
      }
      const answer = answeredDiscover(outcome.response)[0] ?? null;
      return { ...source, feed: feedAfter(source.feed, answer) };
    }
    case "search": {
      if (outcome.error) {
        return {
          ...source,
          feed: { ...source.feed, failure: outcome.error },
        };
      }
      return {
        ...source,
        feed: feedAfter(source.feed, answeredSearch(outcome.response)),
      };
    }
  }
}
