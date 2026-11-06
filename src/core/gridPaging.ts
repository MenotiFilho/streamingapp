/**
 * The grid's approach to its end (#264): a whole-row grid asks the row's next
 * page by itself, without a button, when the person scrolls or moves focus near
 * the last cards. The geometry and the "is a page due" decision live here so a
 * test asks the rule rather than a rendered list (ADR-0032).
 */

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
  failure: unknown;
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
