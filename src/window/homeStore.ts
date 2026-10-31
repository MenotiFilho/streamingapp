/**
 * The Home store: one session's Catalog rows, their pages, and the asks that
 * fill them.
 *
 * Home is remounted every time a person leaves the destination and comes back,
 * but what this client has read must not be thrown away with it — the rows are
 * this client's own browse, never the Host's state (ADR-0005). So the store
 * lives in `Shell`, outlives `HomeScreen`'s unmount, and keeps at most four
 * `browse_catalog` asks in flight at once (#112): the Featured Catalog first,
 * then the content rows in the Addons' configured order, four at a time, with
 * `More` sharing the same budget.
 *
 * It calls no React and no Tauri itself: the Shell hands in its `ask`, Home
 * reads a snapshot through `useSyncExternalStore`, and a test can hold the
 * answers and drive the queue without a page.
 */

import {
  blankRow,
  catalogKey,
  rowWith,
  SKIP,
  unaskable,
  type DeclaredCatalog,
  type Row,
} from "../browse";
import {
  answeredCatalogs,
  asActionError,
  type Action,
  type ActionError,
  type Extra,
  type Response,
} from "../host-client";
import type { ActionOutcome } from "./context";

/**
 * How many `browse_catalog` asks Home has in flight at once, `More` included.
 * Four is the batch the ticket draws: the Featured Catalog plus the first three
 * content rows, and it bounds what one client does to a Host that now answers
 * questions concurrently (ADR-0022).
 */
export const HOME_ASK_LIMIT = 4;

/** What Home draws: the rows in declared order, and what is being asked. */
export type HomeSnapshot = {
  /**
   * One row per declared Catalog that answered or is still waiting, in the
   * Addons' configured order. A Catalog the Host refuses is not a row.
   */
  rows: Row[];
  /**
   * The keys whose first answer has landed — a row, a failure, or a refusal.
   * Home reads this to hold launch focus until the Featured row is settled.
   */
  answered: ReadonlySet<string>;
  /**
   * The keys with a `browse_catalog` ask queued or running. `More` is disabled
   * for these, and paging that is waiting for a slot is already one of them.
   */
  paging: ReadonlySet<string>;
};

/** The Shell's one door, as the store needs it. */
type Ask = (action: Action) => Promise<ActionOutcome>;

/** Whether an ask is a catalog's first page or a page on from where it read. */
type AskKind = "first" | "page";

type PendingAsk = {
  key: string;
  kind: AskKind;
  action: Action;
  /**
   * The Catalog declaration this ask was made against. A key that leaves the
   * snapshot bumps its epoch, so an answer already on its way can be told apart
   * from one asked against the declaration that replaced it.
   */
  epoch: number;
  running: boolean;
};

/**
 * The session's Home rows, keyed by `addon/type/id`, with a FIFO queue four asks
 * wide. A method mutates, then publishes one new snapshot; a subscriber reading
 * `getSnapshot` between changes always gets the same object.
 */
export class HomeStore {
  private rows = new Map<string, Row>();
  /** Keys whose first answer landed, whether it made a row or not. */
  private answeredKeys = new Set<string>();
  /** Keys in draw order: every declared Catalog that is still a row. */
  private order: string[] = [];
  /** The Catalogs this store is currently asked about. */
  private declared = new Set<string>();
  /**
   * A per-key generation, bumped when a Catalog leaves the snapshot. An ask
   * names the epoch it was made in, so a re-added Catalog starts a fresh row
   * and an old answer cannot land in it.
   */
  private epochs = new Map<string, number>();
  /**
   * Keys with no row at all: a first page the Host refused (ADR-0010) or one
   * that answered nothing. They are not asked again for the session.
   */
  private dropped = new Set<string>();
  /**
   * The `extra` each failed row failed on, so a return repeats that request —
   * the first page with no values, or the page a later failure was asking for.
   * `row.offset` cannot say which request failed on its own; the ask is kept.
   */
  private failedAsks = new Map<string, Extra[]>();
  private queue: string[] = [];
  private pending = new Map<string, PendingAsk>();
  private running = 0;
  private snapshot: HomeSnapshot = {
    rows: [],
    answered: new Set(),
    paging: new Set(),
  };
  private listeners = new Set<() => void>();

  constructor(private readonly ask: Ask) {}

  /**
   * Follow the Catalog fingerprint. A surviving key keeps its row untouched —
   * items, offset, `done`, failure, answered — and only a key this store has
   * never asked for is fetched. A removed key's row is dropped, and a reordering
   * moves rows without asking anything.
   */
  sync(catalogs: DeclaredCatalog[], featuredKey: string | null): void {
    const declared = new Set(catalogs.map(catalogKey));

    // The declarations gone since the last sync are no longer this store's
    // browse: a Catalog that comes back later is a new key and is asked fresh.
    // Its epoch moves even while an ask is still on its way, so the answer
    // cannot land in the row the re-added Catalog will build.
    for (const key of this.declared) {
      if (declared.has(key)) {
        continue;
      }
      this.epochs.set(key, this.epochOf(key) + 1);
      this.pending.delete(key);
      this.answeredKeys.delete(key);
      this.dropped.delete(key);
      this.failedAsks.delete(key);
    }
    this.declared = declared;

    const rows = new Map<string, Row>();
    const order: string[] = [];
    for (const catalog of catalogs) {
      const key = catalogKey(catalog);
      const held = this.rows.get(key);
      if (held) {
        rows.set(key, held);
        order.push(key);
      } else if (!this.answeredKeys.has(key)) {
        // A key the Host refused is answered without a row; it is not a row at
        // all, and asking it again would only be refused again.
        rows.set(key, blankRow(catalog));
        order.push(key);
      }
    }
    this.rows = rows;
    this.order = order;

    // A queued ask whose Catalog is gone has nothing to answer into. The asks
    // already sent are left to finish; their answers are ignored on arrival
    // because their epoch is no longer the key's.
    this.queue = this.queue.filter((key) => declared.has(key));

    // First paint: the Featured Catalog first, then the content Rows in the
    // Addons' configured order. The queue is FIFO and four wide, so the first
    // batch is the Featured row plus the first three content rows — or the
    // first four content rows where nothing is featured.
    const firstPaint = featuredKey
      ? [...order].sort((left, right) =>
          left === featuredKey ? -1 : right === featuredKey ? 1 : 0,
        )
      : [...order];
    for (const key of firstPaint) {
      if (!this.answeredKeys.has(key)) {
        this.enqueue(key, "first", []);
      }
    }

    this.publish();
  }

  /**
   * A return to Home: paint what the store already holds, join whatever is
   * still in flight, and re-ask only the rows that failed. A successful row is
   * never fetched again for the session.
   */
  enter(): void {
    for (const key of this.order) {
      if (this.pending.has(key)) {
        continue;
      }
      const row = this.rows.get(key);
      if (!row) {
        continue;
      }
      if (row.failure) {
        // The request that failed: a first page with no values, or the page a
        // later failure was asking for.
        const extra = this.failedAsks.get(key) ?? [];
        this.enqueue(key, extra.length === 0 ? "first" : "page", extra);
      } else if (!this.answeredKeys.has(key)) {
        this.enqueue(key, "first", []);
      }
    }
    this.publish();
  }

  /** Page one row on, through the same four-wide queue as first paint. */
  page(key: string): void {
    const row = this.rows.get(key);
    if (!row || row.done) {
      return;
    }
    this.enqueue(key, "page", [{ name: SKIP, value: String(row.offset) }]);
    this.publish();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): HomeSnapshot => this.snapshot;

  private enqueue(key: string, kind: AskKind, extra: Extra[]): void {
    const held = this.pending.get(key);
    if (held && held.epoch === this.epochOf(key)) {
      return;
    }
    if (this.dropped.has(key)) {
      return;
    }
    const row = this.rows.get(key);
    if (!row) {
      return;
    }
    this.pending.set(key, {
      key,
      kind,
      epoch: this.epochOf(key),
      running: false,
      action: {
        type: "browse_catalog",
        addon: row.addon,
        catalog: { type: row.type, id: row.id },
        extra,
      },
    });
    this.queue.push(key);
    this.pump();
  }

  /** The Catalog generation a key is in, starting at zero. */
  private epochOf(key: string): number {
    return this.epochs.get(key) ?? 0;
  }

  private pump(): void {
    while (this.running < HOME_ASK_LIMIT && this.queue.length > 0) {
      const key = this.queue.shift();
      if (key === undefined) {
        return;
      }
      const task = this.pending.get(key);
      if (!task || task.running) {
        continue;
      }
      task.running = true;
      this.running += 1;
      void this.resolve(task);
    }
  }

  private async resolve(task: PendingAsk): Promise<void> {
    let outcome: ActionOutcome;
    try {
      outcome = await this.ask(task.action);
    } catch (caught) {
      // `ask` already turns a refused Action into an outcome; this is the
      // window's own failure to reach the Host at all.
      outcome = { response: null, error: asActionError(caught) };
    }
    this.running -= 1;
    // A re-added Catalog may already have a new ask under the same key; only
    // the task still on record is the one this resolution may remove.
    if (this.pending.get(task.key) === task) {
      this.pending.delete(task.key);
    }
    this.settle(task, outcome.response, outcome.error);
    this.pump();
    this.publish();
  }

  private settle(task: PendingAsk, response: Response | null, error: ActionError | null): void {
    // A row whose Catalog left the snapshot while its ask was in flight has
    // nowhere to land, and a Catalog that comes back is asked fresh: its epoch
    // moved, so this answer is stale however the declaration stands now.
    if (task.epoch !== this.epochOf(task.key) || !this.declared.has(task.key)) {
      return;
    }
    this.answeredKeys.add(task.key);

    if (error) {
      // A first-page refusal is not a row and not an error a person is shown;
      // any other failure is that row saying what went wrong, and is asked
      // again on the next return (ADR-0010). A *page* refusal is not a reason
      // to throw away what the row already read: the row keeps its items.
      if (unaskable(error)) {
        if (task.kind === "first") {
          this.drop(task.key);
        }
        return;
      }
      this.failedAsks.set(task.key, extraOf(task.action));
      const row = this.rows.get(task.key);
      if (row) {
        this.rows.set(task.key, { ...row, failure: error });
      }
      return;
    }

    const answer = answeredCatalogs(response)[0] ?? null;
    const row = this.rows.get(task.key);
    if (!row) {
      return;
    }
    if (!answer) {
      // A first page with no Catalog answer at all is not a row. A later page
      // that answered nothing ends the row with what it already holds; leaving
      // it open would make a reader ask forever for an answer that is not coming.
      if (task.kind === "first") {
        this.drop(task.key);
      } else {
        this.rows.set(task.key, { ...row, done: true });
      }
      return;
    }
    // A first page is the whole row: a retry after a first-page failure starts
    // from nothing read, so an earlier failure that counted items cannot make
    // the next page skip over them. A later page folds into what is held.
    const base =
      task.kind === "first"
        ? { ...row, metas: [], offset: 0, done: false }
        : row;
    this.rows.set(task.key, rowWith(base, answer));
    if (answer.failure) {
      // The Addon could not answer the page itself, so the row says why and a
      // return repeats that request; a good page clears the record.
      this.failedAsks.set(task.key, extraOf(task.action));
    } else {
      this.failedAsks.delete(task.key);
    }
  }

  private drop(key: string): void {
    this.rows.delete(key);
    this.order = this.order.filter((held) => held !== key);
    this.dropped.add(key);
    this.failedAsks.delete(key);
  }

  private publish(): void {
    const rows = this.order
      .map((key) => this.rows.get(key))
      .filter((row): row is Row => row !== undefined);
    const answered = new Set(this.answeredKeys);
    const paging = new Set(this.pending.keys());

    const previous = this.snapshot;
    if (
      rows.length === previous.rows.length &&
      rows.every((row, index) => row === previous.rows[index]) &&
      sameSet(previous.answered, answered) &&
      sameSet(previous.paging, paging)
    ) {
      return;
    }

    this.snapshot = { rows, answered, paging };
    for (const listener of this.listeners) {
      listener();
    }
  }
}

/** The values a browse ask carried, which a failed row repeats on a return. */
function extraOf(action: Action): Extra[] {
  return action.type === "browse_catalog" ? action.extra : [];
}

/** Whether two sets hold the same members — what `publish` compares cheaply. */
function sameSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const member of left) {
    if (!right.has(member)) {
      return false;
    }
  }
  return true;
}
