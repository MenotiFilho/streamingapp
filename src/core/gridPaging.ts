/**
 * The grid's approach to its end (#264): a whole-row grid asks the row's next
 * page by itself, without a button, when the person scrolls or moves focus near
 * the last cards. The geometry, the "is a page due" decision and what the grid
 * draws for that page live here so a test asks the rule rather than a rendered
 * list (ADR-0032), and the two clients cannot drift from one another (S2).
 */

import type { ActionError } from "./errors";

/** How far below the viewport's bottom the last card still counts as reached. */
export const GRID_APPROACH_PX = 480;

/** How many cards from the end a focused card counts as near the end. */
export const GRID_FOCUS_AHEAD = 4;

/** Whether the last card's bottom is within `margin` of the viewport's bottom. */
export function nearingEnd(
  lastCardBottom: number,
  viewportBottom: number,
  margin: number = GRID_APPROACH_PX,
): boolean {
  return lastCardBottom <= viewportBottom + margin;
}

/** Whether a focused card, by its place in the grid, is among the last few. */
export function cardNearEnd(
  index: number,
  count: number,
  ahead: number = GRID_FOCUS_AHEAD,
): boolean {
  return count > 0 && index >= count - ahead;
}

/** What a row knows about its next page. */
export type PageState = {
  /** The row has no more pages, an Addon said so or a page came back empty. */
  done: boolean;
  /** Why the last page failed; a failure waits for the person, not the scroll. */
  failure: ActionError | null;
};

/**
 * Whether the grid should ask its next page now: there is one, it is not
 * already in flight, and the grid is at or near its end. A failure is the
 * person's to retry (ADR-0020), so the scroll alone never hammers a down Addon.
 */
export function gridPageDue(
  row: PageState,
  place: { reading: boolean; near: boolean },
): boolean {
  return place.near && !place.reading && !row.done && row.failure === null;
}

/** What a grid knows about the row it draws. */
export type GridRowState = {
  /** The row has no more pages. */
  done: boolean;
  /** Why the last page failed, or null where none did. */
  failure: ActionError | null;
  /** Whether the row can page at all: a Catalog declares `skip`, a feed is a page. */
  pageable: boolean;
  /** Whether the row's page is already in flight. */
  reading: boolean;
  /** How many cards the grid draws, in total and including any entries. */
  count: number;
};

/** What a grid draws for its row's paging. */
export type GridPaging = {
  /** The row's own state for `useGridEnd`, or null when there is no next page. */
  page: PageState | null;
  /** Whether a page is in flight, so the quiet reading line prints. */
  reading: boolean;
  /** Whether Try again is offered: a failure, a next page, and nothing in flight. */
  retry: boolean;
  /** Whether the row ended before it read a card. */
  empty: boolean;
};

/**
 * One grid's paging view from the row it shares with the rail. Every grid —
 * Home's, Discover's and Search's — reads this rather than deciding again;
 * `page.done` is the row's real `done`, so `gridPageDue` is what refuses a
 * finished row rather than a caller's hard-coded `false`. A row with no page at
 * all — a Catalog that declares no `skip` — has no `PageState`.
 */
export function gridPaging(row: GridRowState): GridPaging {
  const more = row.pageable && !row.done;
  return {
    page: row.pageable ? { done: row.done, failure: row.failure } : null,
    reading: more && row.reading,
    retry: more && row.failure !== null && !row.reading,
    empty: row.done && row.count === 0 && !row.reading && row.failure === null,
  };
}
