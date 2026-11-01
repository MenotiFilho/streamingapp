import { describe, expect, test } from "vitest";

import { blankFeed, MOVIE, type DiscoverFeed } from "../core/discover";
import type { DiscoverRow } from "../core/wire";
import { feedAfter, feedMore, feedPhase, pageToAsk } from "./feed";

/**
 * A feed's own decisions (#207, ADR-0032).
 *
 * The folding is the core's (`feedWith`) and is tested there; what is asked
 * here is the rule both screens read off it: when the feed is reading, when it
 * has a page to ask for, which page that is, and what an answer that carried no
 * page does to it.
 */

function feed(overrides: Partial<DiscoverFeed> = {}): DiscoverFeed {
  return { ...blankFeed(), ...overrides };
}

function row(
  metas: DiscoverRow["metas"] = [],
  sent = metas.length,
  failure: DiscoverRow["failure"] = null,
): DiscoverRow {
  return { type: MOVIE, sent, metas, failure };
}

function meta(id: string) {
  return {
    id,
    type: MOVIE,
    name: "The Matrix",
    poster: null,
    posterShape: null,
    background: null,
    releaseInfo: "1999",
    imdbRating: null,
    genres: [],
    description: null,
  };
}

describe("a feed's phase", () => {
  test("a first page reads, a later page reads on, and a failed page is a failure", () => {
    expect(feedPhase(feed(), true)).toBe("reading");
    expect(feedPhase(feed({ page: 1 }), true)).toBe("reading-more");
    expect(feedPhase(feed({ failure: { kind: "fetch", detail: "down" } }), false)).toBe(
      "failed",
    );
  });

  test("an empty feed is only empty after TMDB answered nothing", () => {
    expect(feedPhase(feed(), false)).toBe("ready");
    expect(feedPhase(feed({ done: true }), false)).toBe("empty");
    expect(feedPhase(feed({ done: true, items: [meta("tmdb:1")] }), false)).toBe(
      "ready",
    );
  });
});

describe("a feed's paging", () => {
  test("More is offered only after a first page, or to retry a page that failed", () => {
    expect(feedMore(feed())).toBe(false);
    expect(feedMore(feed({ failure: { kind: "fetch", detail: "down" } }))).toBe(true);
    expect(feedMore(feed({ page: 1 }))).toBe(true);
    expect(feedMore(feed({ page: 1, done: true }))).toBe(false);
  });

  test("the press asks the page after the one read, or the page that failed", () => {
    expect(pageToAsk(feed())).toBe(1);
    expect(pageToAsk(feed({ failure: { kind: "fetch", detail: "down" } }))).toBe(1);
    expect(pageToAsk(feed({ page: 2 }))).toBe(3);
  });
});

describe("a page folded into a feed", () => {
  test("an answer is appended and the next press asks the next page", () => {
    const once = feedAfter(feed(), row([meta("tmdb:1"), meta("tmdb:2")]));

    expect(once.page).toBe(1);
    expect(once.items.map((item) => item.id)).toEqual(["tmdb:1", "tmdb:2"]);
    expect(feedMore(once)).toBe(true);
    expect(pageToAsk(once)).toBe(2);
  });

  test("an answer that carried no page at all ends the feed where it read", () => {
    const once = feedAfter(feed({ page: 1 }), null);

    expect(once.done).toBe(true);
    expect(once.page).toBe(1);
    expect(feedMore(once)).toBe(false);
  });
});
