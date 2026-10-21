import { describe, expect, test } from "vitest";

import { keyOf, type DeclaredCatalog } from "../browse";
import type {
  Action,
  ActionError,
  CatalogRow,
  MetaPreview,
} from "../host-client";
import type { ActionOutcome } from "./context";
import { HOME_ASK_LIMIT, HomeStore } from "./homeStore";

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

function catalog(addon: string, id: string): DeclaredCatalog {
  return {
    addon,
    catalog: {
      type: "movie",
      id,
      name: id,
      extra: [{ name: "skip", isRequired: false, options: [], optionsLimit: 1 }],
    },
  };
}

/** The key a `browse_catalog` Action names, as the store keys its rows. */
function asked(action: Action): string {
  if (action.type !== "browse_catalog") {
    throw new Error(`not a browse ask: ${action.type}`);
  }
  return keyOf({
    addon: action.addon,
    type: action.catalog.type,
    id: action.catalog.id,
  });
}

/** A fake Host door that opens one gate per ask, in the order they are taken. */
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

function callAt(host: ReturnType<typeof fakeAsk>, index: number): Action {
  const call = host.calls[index];
  if (!call) {
    throw new Error(`the store made no ask at ${index}`);
  }
  return call;
}

function gateAt(host: ReturnType<typeof fakeAsk>, index: number): Deferred<ActionOutcome> {
  const gate = host.gates[index];
  if (!gate) {
    throw new Error(`the store made no ask at ${index}`);
  }
  return gate;
}

/** The answer shape a `browse_catalog` question comes back with. */
function answered(row: CatalogRow): ActionOutcome {
  return { response: { snapshots: [], answer: { catalogs: [row] } }, error: null };
}

function rowFor(
  action: Action,
  metas: MetaPreview[],
  failure: ActionError | null = null,
): CatalogRow {
  if (action.type !== "browse_catalog") {
    throw new Error(`not a browse ask: ${action.type}`);
  }
  return {
    addon: action.addon,
    type: action.catalog.type,
    id: action.catalog.id,
    name: action.catalog.id,
    sent: metas.length,
    metas,
    failure,
  };
}

/** Let the store's continuations run; no timer is involved. */
async function flush(): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1) {
    await Promise.resolve();
  }
}

async function settle(gate: Deferred<ActionOutcome>, outcome: ActionOutcome): Promise<void> {
  gate.resolve(outcome);
  await flush();
}

describe("the Home store", () => {
  test("keys Rows by addon/type/id, in declared order, with a blank Row per Catalog", () => {
    const host = fakeAsk();
    const store = new HomeStore(host.ask);

    store.sync(
      [catalog("one", "top"), catalog("one", "new"), catalog("two", "popular")],
      "one/movie/new",
    );

    const first = store.getSnapshot();
    expect(first.rows.map(keyOf)).toEqual([
      "one/movie/top",
      "one/movie/new",
      "two/movie/popular",
    ]);
    for (const row of first.rows) {
      expect(row).toMatchObject({ metas: [], offset: 0, failure: null, done: false });
    }

    // The Featured Catalog is asked first, then the content Rows in the order
    // the Addons were configured; one four-wide batch holds all three.
    expect(host.calls.map(asked)).toEqual([
      "one/movie/new",
      "one/movie/top",
      "two/movie/popular",
    ]);
    expect(store.getSnapshot(), "a snapshot is stable between changes").toBe(first);
  });

  test("returns and syncs while a Row is in flight join the ask rather than sending another", () => {
    const host = fakeAsk();
    const store = new HomeStore(host.ask);
    const catalogs = [catalog("one", "top")];

    store.sync(catalogs, null);
    store.enter();
    store.enter();
    store.sync(catalogs, null);

    expect(host.calls).toHaveLength(1);
  });

  test("a successful Row is not asked again on a return, and a failed Row is", async () => {
    const host = fakeAsk();
    const store = new HomeStore(host.ask);
    store.sync([catalog("one", "ok"), catalog("one", "bad")], null);
    expect(host.calls).toHaveLength(2);

    await settle(gateAt(host, 0), answered(rowFor(callAt(host, 0), [meta("tt1")])));
    await settle(gateAt(host, 1), {
      response: null,
      error: { kind: "catalog", detail: "down" },
    });

    const before = store.getSnapshot();
    expect(before.rows[0]?.metas.map((held) => held.id)).toEqual(["tt1"]);
    expect(before.rows[1]?.failure).toEqual({ kind: "catalog", detail: "down" });
    expect(before.answered).toEqual(new Set(["one/movie/ok", "one/movie/bad"]));

    store.enter();

    expect(host.calls).toHaveLength(3);
    expect(host.calls.filter((action) => asked(action) === "one/movie/ok")).toHaveLength(1);
    const retry = callAt(host, 2);
    expect(asked(retry)).toBe("one/movie/bad");
    if (retry.type !== "browse_catalog") {
      throw new Error("the retry is a browse ask");
    }
    expect(retry.extra, "a first page that failed is asked with no values").toEqual([]);
  });

  test("a Row whose later page failed is re-asked from the page that failed", async () => {
    const host = fakeAsk();
    const store = new HomeStore(host.ask);
    store.sync([catalog("one", "top")], null);
    await settle(
      gateAt(host, 0),
      answered(rowFor(callAt(host, 0), [meta("tt1"), meta("tt2")])),
    );

    store.page("one/movie/top");
    expect(host.calls).toHaveLength(2);
    await settle(gateAt(host, 1), {
      response: null,
      error: { kind: "fetch", detail: "offline" },
    });

    expect(store.getSnapshot().rows[0]).toMatchObject({
      offset: 2,
      failure: { kind: "fetch", detail: "offline" },
    });

    store.enter();
    const retry = callAt(host, 2);
    expect(asked(retry)).toBe("one/movie/top");
    if (retry.type !== "browse_catalog") {
      throw new Error("the retry is a browse ask");
    }
    expect(retry.extra).toEqual([{ name: "skip", value: "2" }]);
  });

  test("a page refused after the row was read keeps what the row already holds", async () => {
    const host = fakeAsk();
    const store = new HomeStore(host.ask);
    store.sync([catalog("one", "top")], null);
    await settle(gateAt(host, 0), answered(rowFor(callAt(host, 0), [meta("tt1")])));

    store.page("one/movie/top");
    await settle(gateAt(host, 1), {
      response: null,
      error: { kind: "extra", detail: "the catalog no longer takes skip" },
    });

    const row = store.getSnapshot().rows[0];
    expect(row?.metas.map((held) => held.id)).toEqual(["tt1"]);
    expect(row?.failure, "a refused page is not a row failure").toBeNull();
    expect(row?.done).toBe(false);

    // The row was not dropped, so it can still be asked again.
    store.page("one/movie/top");
    expect(host.calls).toHaveLength(3);
  });

  test("an answer for a removed Catalog cannot land in the row of its re-added self", async () => {
    const host = fakeAsk();
    const store = new HomeStore(host.ask);
    const a = catalog("one", "a");
    const b = catalog("one", "b");

    store.sync([a], null);
    await settle(gateAt(host, 0), answered(rowFor(callAt(host, 0), [meta("tt-a1")])));

    // A page of A is on its way when A leaves the snapshot...
    store.page("one/movie/a");
    expect(host.calls).toHaveLength(2);
    store.sync([b], null);
    // ...and comes back while that page is still in flight. A re-added Catalog
    // is asked from its first page, not joined to the ask it superseded.
    store.sync([a], null);

    const readded = callAt(host, 3);
    expect(asked(readded)).toBe("one/movie/a");
    if (readded.type !== "browse_catalog") {
      throw new Error("the re-added ask is a browse ask");
    }
    expect(readded.extra).toEqual([]);

    // The old page answers now; it belongs to the declaration A no longer has.
    await settle(
      gateAt(host, 1),
      answered(rowFor(callAt(host, 1), [meta("tt-stale")])),
    );
    const before = store.getSnapshot().rows.find((row) => row.id === "a");
    expect(before?.metas, "the stale page did not land").toEqual([]);
    expect(before?.offset).toBe(0);

    await settle(gateAt(host, 3), answered(rowFor(readded, [meta("tt-fresh")])));
    const after = store.getSnapshot().rows.find((row) => row.id === "a");
    expect(after?.metas.map((held) => held.id)).toEqual(["tt-fresh"]);
    expect(after?.offset).toBe(1);

    // Leave no ask unresolved.
    await settle(gateAt(host, 2), answered(rowFor(callAt(host, 2), [meta("tt-b1")])));
  });

  test("a fingerprint change keeps the survivors, asks only new keys and drops removed ones", async () => {
    const host = fakeAsk();
    const store = new HomeStore(host.ask);
    const a = catalog("one", "a");
    const b = catalog("one", "b");
    const d = catalog("one", "d");

    store.sync([a, b, d], null);
    await settle(gateAt(host, 0), answered(rowFor(callAt(host, 0), [meta("tt-a1")])));
    await settle(gateAt(host, 1), answered(rowFor(callAt(host, 1), [meta("tt-b1")])));
    await settle(gateAt(host, 2), answered(rowFor(callAt(host, 2), [meta("tt-d1")])));
    store.page("one/movie/a");
    await settle(gateAt(host, 3), answered(rowFor(callAt(host, 3), [meta("tt-a2")])));

    const askedBefore = host.calls.length;
    store.sync([b, a, catalog("one", "c")], null);

    const snapshot = store.getSnapshot();
    expect(snapshot.rows.map(keyOf)).toEqual(["one/movie/b", "one/movie/a", "one/movie/c"]);
    expect(host.calls, "only the new key is fetched").toHaveLength(askedBefore + 1);
    expect(asked(callAt(host, askedBefore))).toBe("one/movie/c");

    const rowA = snapshot.rows.find((row) => row.id === "a");
    const rowB = snapshot.rows.find((row) => row.id === "b");
    expect(rowA?.metas.map((held) => held.id)).toEqual(["tt-a1", "tt-a2"]);
    expect(rowA?.offset).toBe(2);
    expect(rowB?.metas.map((held) => held.id)).toEqual(["tt-b1"]);
    expect(snapshot.rows.some((row) => row.id === "d"), "a removed key is not a row").toBe(
      false,
    );
    expect(snapshot.answered).toEqual(new Set(["one/movie/a", "one/movie/b"]));
  });

  test("a first-page failure is retried with no values and leaves a clean row", async () => {
    const host = fakeAsk();
    const store = new HomeStore(host.ask);
    store.sync([catalog("one", "top")], null);

    // The Host's failure shape: a failed page carries no items and counts none.
    const failed = rowFor(callAt(host, 0), [], {
      kind: "catalog",
      detail: "the page was unreadable",
    });
    await settle(gateAt(host, 0), answered(failed));

    store.enter();
    const retry = callAt(host, 1);
    expect(asked(retry)).toBe("one/movie/top");
    if (retry.type !== "browse_catalog") {
      throw new Error("the retry is a browse ask");
    }
    expect(retry.extra).toEqual([]);

    await settle(gateAt(host, 1), answered(rowFor(retry, [meta("tt1")])));
    const retried = store.getSnapshot().rows[0];
    expect(retried?.metas.map((held) => held.id)).toEqual(["tt1"]);
    expect(retried?.offset).toBe(1);
    expect(retried?.failure).toBeNull();
  });

  test("a Catalog the Host refuses is not a row, and is not asked again", async () => {
    const host = fakeAsk();
    const store = new HomeStore(host.ask);
    const hidden = catalog("one", "hidden");

    store.sync([hidden], null);
    await settle(gateAt(host, 0), {
      response: null,
      error: { kind: "extra", detail: "that catalog needs a genre" },
    });

    expect(store.getSnapshot().rows).toEqual([]);
    expect(store.getSnapshot().answered.has("one/movie/hidden")).toBe(true);

    store.enter();
    store.sync([hidden], null);
    expect(host.calls).toHaveLength(1);
  });

  test("a first page with no answer at all is not a row; a page with none keeps the row", async () => {
    const host = fakeAsk();
    const store = new HomeStore(host.ask);
    store.sync([catalog("one", "gone"), catalog("one", "kept")], null);

    await settle(gateAt(host, 0), { response: null, error: null });
    expect(store.getSnapshot().rows.map(keyOf)).toEqual(["one/movie/kept"]);

    await settle(
      gateAt(host, 1),
      answered(rowFor(callAt(host, 1), [meta("tt1"), meta("tt2")])),
    );
    store.page("one/movie/kept");
    await settle(gateAt(host, 2), { response: null, error: null });

    const kept = store.getSnapshot().rows[0];
    expect(kept?.metas.map((held) => held.id)).toEqual(["tt1", "tt2"]);
    expect(kept?.offset).toBe(2);
  });

  test("exactly four asks run at once, and a freed slot starts the next", async () => {
    const host = fakeAsk();
    const store = new HomeStore(host.ask);
    const catalogs = Array.from({ length: 8 }, (_, index) =>
      catalog("one", `c${index}`),
    );

    store.sync(catalogs, null);

    expect(HOME_ASK_LIMIT).toBe(4);
    expect(host.calls.map(asked)).toEqual([
      "one/movie/c0",
      "one/movie/c1",
      "one/movie/c2",
      "one/movie/c3",
    ]);

    await settle(gateAt(host, 0), answered(rowFor(callAt(host, 0), [meta("tt0")])));

    expect(host.calls).toHaveLength(5);
    expect(asked(callAt(host, 4))).toBe("one/movie/c4");
  });

  test("More waits for a slot and counts against the same four", async () => {
    const host = fakeAsk();
    const store = new HomeStore(host.ask);
    const catalogs = Array.from({ length: 8 }, (_, index) =>
      catalog("one", `c${index}`),
    );
    store.sync(catalogs, null);

    // Release the first four: the second four take their slots.
    for (let index = 0; index < 4; index += 1) {
      await settle(
        gateAt(host, index),
        answered(rowFor(callAt(host, index), [meta(`tt${index}`)])),
      );
    }
    expect(host.calls).toHaveLength(8);

    store.page("one/movie/c0");
    expect(host.calls, "all four slots are taken, so More waits").toHaveLength(8);
    expect(store.getSnapshot().paging.has("one/movie/c0")).toBe(true);

    await settle(gateAt(host, 4), answered(rowFor(callAt(host, 4), [meta("tt4")])));

    expect(host.calls).toHaveLength(9);
    const paged = callAt(host, 8);
    expect(asked(paged)).toBe("one/movie/c0");
    if (paged.type !== "browse_catalog") {
      throw new Error("paging is a browse ask");
    }
    expect(paged.extra).toEqual([{ name: "skip", value: "1" }]);
  });
});
