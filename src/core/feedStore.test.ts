import { describe, expect, test } from "vitest";

import type { ActionOutcome } from "./answers";
import type { ActionError } from "./errors";
import { FeedStore, type FeedRow } from "./feedStore";
import type {
  Action,
  CatalogRow,
  DiscoverRow,
  MetaPreview,
  Response,
  SearchRow,
} from "./wire";

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((fulfil) => {
    resolve = fulfil;
  });
  return { promise, resolve };
}

function meta(id: string): MetaPreview {
  return {
    id,
    type: "movie",
    name: id,
    poster: null,
    posterShape: null,
    background: null,
    releaseInfo: null,
    imdbRating: null,
    genres: [],
    description: null,
  };
}

function discoverRow(metas: MetaPreview[], sent = metas.length): DiscoverRow {
  return { type: "movie", sent, metas, failure: null };
}

function response(answer: Response["answer"]): Response {
  return { snapshots: [], answer };
}

function outcome(responseBody: Response["answer"]): ActionOutcome {
  return { response: response(responseBody), error: null };
}

function discoverAnswer(rows: DiscoverRow[]): ActionOutcome {
  return outcome({ discover: rows });
}

function catalogAnswer(rows: CatalogRow[]): ActionOutcome {
  return outcome({ catalogs: rows });
}

function searchAnswer(row: SearchRow): ActionOutcome {
  return outcome({ search: row });
}

/** A fake door that holds each ask until the test answers it. */
function fakeAsk() {
  const calls: Action[] = [];
  const gates: Deferred<ActionOutcome>[] = [];
  const ask = (action: Action): Promise<ActionOutcome> => {
    calls.push(action);
    const gate = deferred<ActionOutcome>();
    gates.push(gate);
    return gate.promise;
  };
  return { ask, calls, gates };
}

async function flush(): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1) {
    await Promise.resolve();
  }
}

function gateAt(host: ReturnType<typeof fakeAsk>, index: number): Deferred<ActionOutcome> {
  const gate = host.gates[index];
  if (!gate) {
    throw new Error(`the store made no ask at ${index}`);
  }
  return gate;
}

async function settle(
  gate: Deferred<ActionOutcome>,
  result: ActionOutcome,
): Promise<void> {
  gate.resolve(result);
  await flush();
}

const FIRST: Action = { type: "discover", kind: "movie", page: 1 };

/** The next page from what a row has read. */
function nextDiscover(row: FeedRow): Action {
  return { type: "discover", kind: "movie", page: row.page + 1 };
}

describe("the feed store", () => {
  test("a read asks the first page once, and a return joins it rather than asking again", async () => {
    const host = fakeAsk();
    const store = new FeedStore(host.ask);

    store.read("discover/movie", FIRST, nextDiscover);
    store.read("discover/movie", FIRST, nextDiscover);

    expect(host.calls, "the second read joins the ask in flight").toEqual([FIRST]);

    await settle(gateAt(host, 0), discoverAnswer([discoverRow([meta("tmdb:1")])]));

    store.read("discover/movie", FIRST, nextDiscover);
    expect(host.calls, "an answered row is not asked for its first page again").toEqual([
      FIRST,
    ]);
    expect(store.feed("discover/movie").items.map((held) => held.id)).toEqual([
      "tmdb:1",
    ]);
  });

  test("more asks the next page once and ignores presses while that page is in flight", async () => {
    const host = fakeAsk();
    const store = new FeedStore(host.ask);
    store.read("discover/movie", FIRST, nextDiscover);
    await settle(gateAt(host, 0), discoverAnswer([discoverRow([meta("tmdb:1")])]));

    store.more("discover/movie");
    store.more("discover/movie");
    expect(host.calls.at(-1)).toEqual({
      type: "discover",
      kind: "movie",
      page: 2,
    });
    expect(host.calls).toHaveLength(2);

    await settle(gateAt(host, 1), discoverAnswer([discoverRow([meta("tmdb:2")])]));

    expect(store.feed("discover/movie").items.map((held) => held.id)).toEqual([
      "tmdb:1",
      "tmdb:2",
    ]);
    expect(store.getSnapshot().reading).toEqual(new Set());
  });

  test("a page that answered nothing ends the row, and a done row is never asked again", async () => {
    const host = fakeAsk();
    const store = new FeedStore(host.ask);
    store.read("discover/movie", FIRST, nextDiscover);
    await settle(gateAt(host, 0), discoverAnswer([discoverRow([meta("tmdb:1")])]));

    store.more("discover/movie");
    await settle(gateAt(host, 1), discoverAnswer([discoverRow([], 0)]));

    expect(store.feed("discover/movie").done).toBe(true);
    store.more("discover/movie");
    expect(host.calls, "a done row has no page to ask for").toHaveLength(2);
  });

  test("a failed page keeps the cards already read, and the next more asks that page again", async () => {
    const host = fakeAsk();
    const store = new FeedStore(host.ask);
    store.read("discover/movie", FIRST, nextDiscover);
    await settle(gateAt(host, 0), discoverAnswer([discoverRow([meta("tmdb:1")])]));

    store.more("discover/movie");
    const failure: ActionError = { kind: "fetch", detail: "timed out" };
    await settle(gateAt(host, 1), { response: null, error: failure });

    expect(store.feed("discover/movie").items.map((held) => held.id)).toEqual([
      "tmdb:1",
    ]);
    expect(store.feed("discover/movie").failure).toEqual(failure);

    store.more("discover/movie");

    expect(host.calls.at(-1), "the failed page is the one asked again").toEqual({
      type: "discover",
      kind: "movie",
      page: 2,
    });
    await settle(gateAt(host, 2), discoverAnswer([discoverRow([meta("tmdb:2")])]));

    expect(store.feed("discover/movie").failure, "a good page clears the record").toBeNull();
    expect(store.feed("discover/movie").items.map((held) => held.id)).toEqual([
      "tmdb:1",
      "tmdb:2",
    ]);
  });

  test("a page with nothing new ends the row even when the source counted items", async () => {
    const host = fakeAsk();
    const store = new FeedStore(host.ask);
    store.read("discover/movie", FIRST, nextDiscover);
    await settle(gateAt(host, 0), discoverAnswer([discoverRow([meta("tmdb:1")])]));

    store.more("discover/movie");
    await settle(gateAt(host, 1), discoverAnswer([discoverRow([meta("tmdb:1")])]));

    expect(store.feed("discover/movie").done).toBe(true);
    store.more("discover/movie");
    expect(host.calls, "a live feed that repeats itself is not asked forever").toHaveLength(2);
  });

  test("an answer of the wrong shape is a failure the row shows, with the page to try again", async () => {
    const host = fakeAsk();
    const store = new FeedStore(host.ask);
    store.read("discover/movie", FIRST, nextDiscover);
    await settle(gateAt(host, 0), discoverAnswer([discoverRow([meta("tmdb:1")])]));

    store.more("discover/movie");
    // The Action asked for a Discover page and the Host answered with a Title:
    // there is no page in it to fold (ADR-0020).
    await settle(gateAt(host, 1), outcome({ title: null } as unknown as Response["answer"]));

    expect(
      store.feed("discover/movie").done,
      "an unreadable answer is not the end of the row",
    ).toBe(false);
    expect(store.feed("discover/movie").failure).toMatchObject({ kind: "answer" });
    expect(store.feed("discover/movie").items).toHaveLength(1);

    store.more("discover/movie");
    expect(host.calls.at(-1), "More asks the same page again").toEqual({
      type: "discover",
      kind: "movie",
      page: 2,
    });
  });

  test("the answer is read from the Action's own arm: catalog and search rows fold the same way", async () => {
    const host = fakeAsk();
    const store = new FeedStore(host.ask);

    store.read(
      "catalog/cinemeta/movie/top",
      { type: "browse_catalog", addon: "cinemeta", catalog: { type: "movie", id: "top" }, extra: [] },
      (row) => ({
        type: "browse_catalog",
        addon: "cinemeta",
        catalog: { type: "movie", id: "top" },
        extra: [{ name: "skip", value: String(row.offset) }],
      }),
    );
    store.read(
      "search/dune/movie",
      { type: "search", query: "dune", kind: "movie", page: 1 },
      (row) => ({ type: "search", query: "dune", kind: "movie", page: row.page + 1 }),
    );

    await settle(
      gateAt(host, 0),
      catalogAnswer([
        { addon: "cinemeta", type: "movie", id: "top", name: "Popular", sent: 2, metas: [meta("tt1"), meta("tt2")], failure: null },
      ]),
    );
    await settle(gateAt(host, 1), searchAnswer(discoverRow([meta("tmdb:1")])));

    expect(store.feed("catalog/cinemeta/movie/top").items).toHaveLength(2);
    expect(store.feed("catalog/cinemeta/movie/top").offset).toBe(2);
    expect(store.feed("search/dune/movie").items.map((held) => held.id)).toEqual([
      "tmdb:1",
    ]);
  });

  test("a row an Addon answers with its own failure keeps what it had and does not count the page", async () => {
    const host = fakeAsk();
    const store = new FeedStore(host.ask);
    store.read("discover/movie", FIRST, nextDiscover);
    await settle(gateAt(host, 0), discoverAnswer([discoverRow([meta("tmdb:1")])]));

    store.more("discover/movie");
    const failure: ActionError = { kind: "tmdb", detail: "rate limited" };
    await settle(
      gateAt(host, 1),
      discoverAnswer([{ type: "movie", sent: 1, metas: [], failure }]),
    );

    expect(store.feed("discover/movie")).toMatchObject({
      page: 1,
      failure,
      done: false,
    });
    expect(store.feed("discover/movie").items.map((held) => held.id)).toEqual([
      "tmdb:1",
    ]);
  });
});
