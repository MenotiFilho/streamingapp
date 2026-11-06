import { describe, expect, test } from "vitest";

import type { ActionOutcome } from "./answers";
import { CatalogSearchStore } from "./catalogSearch";
import type { ActionError } from "./errors";
import type { Action, CatalogRow, MetaPreview } from "./wire";

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

function row(addon: string, id: string): CatalogRow {
  return {
    addon,
    type: "movie",
    id,
    name: id,
    sent: 1,
    metas: [meta(`${addon}:${id}`)],
    failure: null,
  };
}

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((fulfil) => {
    resolve = fulfil;
  });
  return { promise, resolve };
}

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

async function settle(
  gate: Deferred<ActionOutcome>,
  outcome: ActionOutcome,
): Promise<void> {
  gate.resolve(outcome);
  await flush();
}

describe("the keyless search's answer store", () => {
  test("a return to the same query paints its rows instead of asking again", async () => {
    const host = fakeAsk();
    const store = new CatalogSearchStore(host.ask);

    store.search("dune");
    store.search("dune");
    expect(host.calls).toEqual([{ type: "search_catalogs", query: "dune" }]);

    await settle(host.gates[0]!, {
      response: { snapshots: [], answer: { catalogs: [row("cinemeta", "top")] } },
      error: null,
    });

    store.search("dune");
    expect(host.calls, "an answered query is not asked page 1 again").toHaveLength(1);
    expect(store.answer("dune").rows?.map((held) => held.id)).toEqual(["top"]);
  });

  test("a refused search keeps its Host words until the person asks again", async () => {
    const host = fakeAsk();
    const store = new CatalogSearchStore(host.ask);
    const failure: ActionError = { kind: "query", detail: "the Host will not search" };

    store.search("dune");
    await settle(host.gates[0]!, { response: null, error: failure });

    store.search("dune");
    expect(host.calls, "a failure waits for Try again, not a remount").toHaveLength(1);
    expect(store.answer("dune").failure).toEqual(failure);

    store.retry("dune");
    expect(host.calls).toHaveLength(2);
  });

  test("an answer to a query a person left does not land in the new one", async () => {
    const host = fakeAsk();
    const store = new CatalogSearchStore(host.ask);

    store.search("dune");
    store.search("matrix");
    await settle(host.gates[1]!, {
      response: { snapshots: [], answer: { catalogs: [row("cinemeta", "matrix")] } },
      error: null,
    });
    await settle(host.gates[0]!, {
      response: { snapshots: [], answer: { catalogs: [row("cinemeta", "dune")] } },
      error: null,
    });

    expect(store.answer("matrix").rows?.map((held) => held.id)).toEqual(["matrix"]);
    expect(store.answer("dune").rows?.map((held) => held.id)).toEqual(["dune"]);
  });
});
