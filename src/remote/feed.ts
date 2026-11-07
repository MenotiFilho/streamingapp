import type { DiscoverFeed, FeedState } from "../core/discover";
import { feedWith } from "../core/discover";
import type { DiscoverRow } from "../core/wire";

/**
 * A feed's own paging decisions, for whichever screen is drawing one (#207).
 *
 * The state a feed draws and whether it has another page are the core's
 * (`discover.ts`, `feedState` and `feedMore`) so the window's rail, the
 * Remote's rail and both grids read one rule. What is here is the page-to-ask
 * arithmetic the Remote's own controls still name, and the fold with no answer
 * at all.
 */

/** What a feed is doing, for the line its row prints under the cards. */
export type FeedPhase = FeedState;

export { feedMore, feedState as feedPhase } from "../core/discover";

/**
 * The page a press asks: one on from what was read, or the page that failed.
 * A feed that failed before its first page asks page 1 again.
 */
export function pageToAsk(feed: DiscoverFeed): number {
  return feed.page + 1;
}

/**
 * The feed with one page folded in, or ended where the answer carried no page
 * at all. A failure is the caller's, because it has to keep every card the
 * feed already read (`feedWith` does the same for a page that failed).
 */
export function feedAfter(
  feed: DiscoverFeed,
  answer: DiscoverRow | null,
): DiscoverFeed {
  return answer ? feedWith(feed, answer) : { ...feed, done: true };
}
