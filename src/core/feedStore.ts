/**
 * The Session's feeds: Discover's and Search's rows, their pages, and the asks
 * that fill them (#264).
 *
 * A row a screen reads belongs to the Session, not to the screen: a Title or a
 * whole-row grid is a pushed level that unmounts Discover or Search on the
 * Remote, and the return must paint the same rows, at the same page, without
 * asking page 1 again. A page read in a grid lands in that same row, so Back
 * keeps the cards the grid read. It is this client's own browse, never the
 * Host's state (ADR-0005), and it calls no React: a screen reads a snapshot
 * through `useSyncExternalStore` and a test drives the store without a page.
 */

import {
  answeredCatalogs,
  answeredDiscover,
  answeredSearch,
  type ActionOutcome,
} from "./answers";
import { blankFeed, feedWith, type DiscoverFeed } from "./discover";
import { asActionError } from "./errors";
import { SnapshotStore, sameSet, type Ask } from "./store";
import type { Action, Response } from "./wire";

/** One feed as this client has read it: the page, the items and the skip it read to. */
export type FeedRow = DiscoverFeed & {
  /**
   * What the source has sent so far — the `skip` a preview catalog pages by.
   * A TMDB page asks by page number and keeps this for the same bookkeeping.
   */
  offset: number;
};

/** The page after what a row read, or null where it has no next ask. */
export type NextAsk = (row: FeedRow) => Action | null;

/** What every screen drawing a feed reads: the rows and which are in flight. */
export type FeedSnapshot = {
  rows: ReadonlyMap<string, FeedRow>;
  reading: ReadonlySet<string>;
};

const BLANK: FeedRow = { ...blankFeed(), offset: 0 };

/**
 * The Session's keyed feeds, each read once and paged by the caller's own next
 * ask. A key names the whole question — Discover's genre and kind, Search's
 * query and kind, a preview's source — so a different question is a different
 * row and an old answer cannot land in it.
 */
export class FeedStore extends SnapshotStore<FeedSnapshot> {
  private rows = new Map<string, FeedRow>();
  /** Keys whose first ask was already sent. A return joins it; it is not a retry. */
  private started = new Set<string>();
  private running = new Map<string, Action>();
  private nextAsks = new Map<string, NextAsk>();

  constructor(private readonly ask: Ask) {
    super({ rows: new Map(), reading: new Set() });
  }

  /** The row under a key, or a shared blank before its first ask. */
  feed = (key: string): FeedRow => this.rows.get(key) ?? BLANK;

  /**
   * Ask a key's first page, once for the Session. A screen that mounts again
   * after a Title or a grid calls this and joins what the Store already holds.
   */
  read(key: string, action: Action, next: NextAsk): void {
    if (this.started.has(key) || this.running.has(key)) {
      return;
    }
    this.started.add(key);
    this.nextAsks.set(key, next);
    if (!this.rows.has(key)) {
      this.rows.set(key, BLANK);
    }
    this.send(key, action);
  }

  /**
   * Ask the page after what the row read, or the page that failed. The store
   * drops the press while that page is in flight and once the row is done; a
   * grid's approach and a rail's quiet action both come through here, so the
   * two can never ask twice.
   */
  more(key: string): void {
    const row = this.rows.get(key);
    const next = this.nextAsks.get(key);
    if (!row || !next || row.done || this.running.has(key)) {
      return;
    }
    const action = next(row);
    if (!action) {
      return;
    }
    this.send(key, action);
  }

  private send(key: string, action: Action): void {
    this.running.set(key, action);
    this.publish();
    void this.resolve(key, action);
  }

  private async resolve(key: string, action: Action): Promise<void> {
    let outcome: ActionOutcome;
    try {
      outcome = await this.ask(action);
    } catch (caught) {
      outcome = { response: null, error: asActionError(caught) };
    }
    // A key can be asked again only after this one lets go; keep the action on
    // record so a late answer is the answer to the ask still running.
    if (this.running.get(key) === action) {
      this.running.delete(key);
    }
    const row = this.rows.get(key) ?? BLANK;
    this.rows.set(key, settled(row, action, outcome));
    this.publish();
  }

  private publish(): void {
    const reading = new Set(this.running.keys());
    this.publishSnapshot({ rows: new Map(this.rows), reading }, (previous) =>
      previous.rows.size === this.rows.size &&
      [...this.rows].every(([key, row]) => previous.rows.get(key) === row) &&
      sameSet(previous.reading, reading));
  }
}

/**
 * One answer folded into the row it asked for. `feedWith` keeps every card a
 * failed page did not replace and only moves the page on a page that answered;
 * the offset moves by what the source sent, unreadable items included.
 *
 * A page that carries nothing new — every item a repeat — ends the row even
 * where the source counted items: a live feed that repeats itself must not be
 * asked forever. A page with nothing this Host could read repeats nothing, so
 * the next one still follows it (`feedWith`). A failure is not the end: it
 * keeps its cards and its way to ask that page again (ADR-0020).
 */
function settled(row: FeedRow, action: Action, outcome: ActionOutcome): FeedRow {
  if (outcome.error) {
    return { ...row, failure: outcome.error };
  }
  const answer = answerOf(action, outcome.response);
  if (!answer) {
    // An answer of the wrong shape is not the end of the row: under ADR-0020 it
    // is a failure the row shows, with Try again, exactly as a page that could
    // not be read. Ending here would hide a Host or transport fault as "no more
    // pages".
    return { ...row, failure: WRONG_ANSWER };
  }
  const next = feedWith(row, answer);
  return {
    ...next,
    offset: row.offset + (answer.failure ? 0 : answer.sent),
    done:
      next.done ||
      (!answer.failure && answer.metas.length > 0 && next.items.length === row.items.length),
  };
}

/**
 * The client's own words for an answer that carried no page at all. It is not a
 * Host refusal — the Host never sent one — so it is named outside the Host's
 * vocabulary, the way `unreachable` is.
 */
const WRONG_ANSWER = {
  kind: "answer",
  detail: "the Host's answer carried no page",
} as const;

/** The page an answer carries, read by the arm of the Action that asked. */
function answerOf(action: Action, response: Response | null) {
  switch (action.type) {
    case "discover":
      return answeredDiscover(response)[0] ?? null;
    case "search":
      return answeredSearch(response);
    case "browse_catalog":
      return answeredCatalogs(response)[0] ?? null;
    default:
      return null;
  }
}
