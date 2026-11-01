import type { DiscoverFeed } from "../core/discover";
import { feedWith } from "../core/discover";
import type { DiscoverRow } from "../core/wire";

/**
 * A feed's own decisions, for whichever screen is drawing one (#207).
 *
 * A search page is a `DiscoverRow` by the core's own type, so the paging rule
 * `feedWith` implies is one rule for both screens and not a copy per screen:
 * Discover asks TMDB's page and Search asks one kind's page, and both fold,
 * page and end the same way. The copy stays with the screen that says it.
 */

/** What a feed is doing, for the line its row prints under the cards. */
export type FeedPhase = "reading" | "reading-more" | "empty" | "failed" | "ready";

export function feedPhase(feed: DiscoverFeed, reading: boolean): FeedPhase {
  if (reading) {
    return feed.page === 0 ? "reading" : "reading-more";
  }
  if (feed.failure) {
    return "failed";
  }
  if (feed.done && feed.items.length === 0) {
    return "empty";
  }
  return "ready";
}

/**
 * Whether the feed has a page to ask for: the next one, or the page that
 * failed. `feedWith` never moves `page` on a failure, so the same press is
 * both "page on" and "ask that page again" (ADR-0020).
 */
export function feedMore(feed: DiscoverFeed): boolean {
  return !feed.done && (feed.page > 0 || feed.failure !== null);
}

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
