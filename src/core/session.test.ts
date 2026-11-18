import { describe, expect, test } from "vitest";

import { actionKey } from "./actionKey";
import type { ActionError } from "./errors";
import type { HostLink, LinkState } from "./link";
import { Session } from "./session";
import type { Action, DeviceSummary, Response, Snapshot } from "./wire";

/** The Snapshot the fake Host holds before anything is published. */
function nothing(revision: number, address: string | null = null): Snapshot {
  return {
    revision,
    playback: {
      state: "idle",
      autoplay: null,
      picture: "in_window",
      failure: null,
      nowPlaying: null,
      episode: null,
      position: null,
      duration: null,
      buffered: null,
      tracks: [],
      chapters: [],
      chapter: null,
      speed: null,
      volume: null,
      muted: null,
      subtitleDelay: null,
      crop: null,
      aspect: null,
      resolution: null,
      statistics: null,
    },
    preferences: {
      subtitleLanguages: [],
      audioLanguages: [],
      subtitleColor: "#FFFFFF",
      subtitleScale: 1,
      streamBuffer: { seconds: 300, megabytes: 512 },
      torrentCache: { megabytes: 2000 },
      upNextPlayback: "direct",
      autoplay: true,
    },
    addons: [],
    featuredCatalog: null,
    protection: { backend: "file", tmdbHeld: false, stremioHeld: false },
    continueWatching: [],
    watchProgress: [],
    devices: [],
    pairingCode: "4K7Q2M",
    address,
  };
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((fulfil, refuse) => {
    resolve = fulfil;
    reject = refuse;
  });
  return { promise, resolve, reject };
}

type Answer = (action: Action) => Promise<Response> | Response;

/** The one door, as a test can hold it: what it answers, and what it was sent. */
function fakeHost(
  options: { held?: Snapshot; read?: () => Promise<Snapshot>; answer?: Answer } = {},
) {
  let held = options.held ?? nothing(1);
  let answer: Answer = options.answer ?? (() => ({ snapshots: [], answer: null }));
  let state: LinkState = { kind: "ready", device: null };
  const snapshots = new Set<(snapshot: Snapshot) => void>();
  const states = new Set<(state: LinkState) => void>();
  const actions: Action[] = [];
  const order: string[] = [];
  let reads = 0;

  const link: HostLink = {
    snapshot: async () => {
      reads += 1;
      order.push("snapshot");
      return options.read ? options.read() : held;
    },
    dispatch: async (action) => {
      actions.push(action);
      order.push(`dispatch:${action.type}`);
      return answer(action);
    },
    onSnapshot: (handler) => {
      order.push("onSnapshot");
      snapshots.add(handler);
      return () => {
        snapshots.delete(handler);
      };
    },
    onRevision: () => () => {},
    state: () => state,
    onState: (handler) => {
      order.push("onState");
      states.add(handler);
      return () => {
        states.delete(handler);
      };
    },
    close: () => {
      state = { kind: "closed", reason: "the test closed it" };
      for (const handler of [...states]) {
        handler(state);
      }
      snapshots.clear();
      states.clear();
    },
  };

  return {
    link,
    actions,
    order,
    reads: () => reads,
    snapshotListeners: () => snapshots.size,
    stateListeners: () => states.size,
    publish(snapshot: Snapshot) {
      held = snapshot;
      for (const handler of [...snapshots]) {
        handler(snapshot);
      }
    },
    reply(next: Answer) {
      answer = next;
    },
  };
}

/** Let the Session's first read settle. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const PAIR: Action = { type: "pair_device", code: "4K7Q2M", name: "Phone" };
const DEVICE: DeviceSummary = { id: "device-1", name: "Phone", pairedAt: 1_700_000_000_000 };

describe("the Session", () => {
  test("subscribes before it asks the link where things stand", async () => {
    const host = fakeHost();
    const session = new Session(host.link, () => 42);
    const stop = session.start();

    expect(host.order).toEqual(["onSnapshot", "onState", "snapshot"]);

    await flush();
    expect(session.getState().snapshot).toEqual(nothing(1));
    expect(session.getState().receivedAt).toBe(42);
    stop();
  });

  test("a rejected first read becomes the window's alert", async () => {
    const host = fakeHost({
      read: async () => {
        throw new Error("the Host is not there");
      },
    });
    const session = new Session(host.link);
    const stop = session.start();

    await flush();
    expect(session.getState().error).toEqual({
      kind: "unreachable",
      detail: "Error: the Host is not there",
    });
    stop();
  });

  test("an older revision never replaces a newer one", async () => {
    const host = fakeHost();
    let now = 100;
    const session = new Session(host.link, () => now);
    const stop = session.start();
    await flush();

    now = 200;
    host.publish(nothing(5, "192.168.1.9:8090"));
    expect(session.getState().snapshot?.revision).toBe(5);
    expect(session.getState().receivedAt).toBe(200);

    now = 300;
    host.publish(nothing(3, "192.168.1.8:8090"));
    expect(session.getState().snapshot?.revision).toBe(5);
    expect(session.getState().receivedAt).toBe(200);

    stop();
  });

  test("an equal revision replaces what the client held", async () => {
    const host = fakeHost();
    const session = new Session(host.link);
    const stop = session.start();
    await flush();

    host.publish(nothing(5, "192.168.1.9:8090"));
    host.publish(nothing(5, null));

    expect(session.getState().snapshot?.revision).toBe(5);
    expect(session.getState().snapshot?.address).toBeNull();
    stop();
  });

  test("ask returns a refusal to its caller and leaves the alert alone", async () => {
    const refusal: ActionError = { kind: "invalid_volume", level: "999" };
    const host = fakeHost({
      answer: () => {
        throw refusal;
      },
    });
    const session = new Session(host.link);
    const action: Action = { type: "set_volume", level: 999 };

    const outcome = await session.ask(action);

    expect(outcome).toEqual({ response: null, error: refusal });
    expect(session.getState().error).toBeNull();
    expect(host.actions).toEqual([action]);
  });

  test("take raises the alert, clears it again, and answers null on a refusal", async () => {
    const refusal: ActionError = { kind: "invalid_volume", level: "999" };
    let refuses = true;
    const host = fakeHost({
      answer: () => {
        if (refuses) {
          throw refusal;
        }
        return { snapshots: [], answer: null };
      },
    });
    const session = new Session(host.link);
    const action: Action = { type: "set_volume", level: 999 };

    expect(await session.take(action)).toBeNull();
    expect(session.getState().error).toEqual(refusal);

    refuses = false;
    expect(await session.take({ type: "set_volume", level: 50 })).toEqual({
      snapshots: [],
      answer: null,
    });
    expect(session.getState().error).toBeNull();
  });

  test("report raises the same one alert for a refusal read through ask", () => {
    // A screen that handles a refusal itself — Play opening the Streams picker
    // for an Up next (#276) — reports only what it did not act on.
    const refusal: ActionError = { kind: "no_up_next_stream", detail: "nothing playable" };
    const host = fakeHost();
    const session = new Session(host.link);

    session.report(refusal);
    expect(session.getState().error).toEqual(refusal);

    session.report(null);
    expect(session.getState().error).toBeNull();
  });

  test("hint is fire-and-forget: no wait, no answer, and a refusal is not an alert", async () => {
    const refusal: ActionError = { kind: "malformed", detail: "not a hint" };
    let refuses = true;
    const host = fakeHost({
      answer: () => {
        if (refuses) {
          throw refusal;
        }
        return { snapshots: [], answer: null };
      },
    });
    const session = new Session(host.link);
    const hint: Action = {
      type: "look_hint",
      addon: "cinemeta",
      title: { type: "movie", id: "tt1" },
    };

    session.hint(hint);
    await flush();

    expect(host.actions, "the hint reaches the one door").toEqual([hint]);
    expect(session.getState().pending.size, "nothing is waiting on an answer").toBe(0);
    expect(session.getState().error, "resting is not asking").toBeNull();

    refuses = false;
    session.hint({ ...hint, addon: null });
    await flush();

    expect(host.actions).toHaveLength(2);
    expect(session.getState().error).toBeNull();
  });

  test("one dispatch per key, and a joined caller sees the same answer", async () => {
    const gates: Array<Deferred<Response>> = [];
    const host = fakeHost({
      answer: () => {
        const gate = deferred<Response>();
        gates.push(gate);
        return gate.promise;
      },
    });
    const session = new Session(host.link);
    const action: Action = { type: "set_paused", paused: true };

    const first = session.ask(action);
    const second = session.ask(action);

    expect(host.actions).toEqual([action]);
    expect(session.getState().pending.has(actionKey(action))).toBe(true);

    const response: Response = { snapshots: [], answer: null };
    gates[0]?.resolve(response);

    const [one, two] = await Promise.all([first, second]);
    expect(one).toEqual({ response, error: null });
    expect(two).toBe(one);
    expect(host.actions).toEqual([action]);
    expect(session.getState().pending.has(actionKey(action))).toBe(false);
  });

  test("a repeated Action bypasses the wait and the pending set", async () => {
    const gates: Array<Deferred<Response>> = [];
    const host = fakeHost({
      answer: () => {
        const gate = deferred<Response>();
        gates.push(gate);
        return gate.promise;
      },
    });
    const session = new Session(host.link);
    const action: Action = { type: "seek", target: { kind: "by", seconds: 10 } };

    const first = session.ask(action);
    const second = session.ask(action);

    expect(host.actions).toEqual([action, action]);
    expect(session.getState().pending.size).toBe(0);

    for (const gate of gates) {
      gate.resolve({ snapshots: [], answer: null });
    }
    await Promise.all([first, second]);
  });

  test("a refusal frees its pending key", async () => {
    const refusal: ActionError = { kind: "invalid_volume", level: "999" };
    const gates: Array<Deferred<Response>> = [];
    const host = fakeHost({
      answer: () => {
        const gate = deferred<Response>();
        gates.push(gate);
        return gate.promise;
      },
    });
    const session = new Session(host.link);
    const action: Action = { type: "set_volume", level: 999 };

    const asked = session.ask(action);
    expect(session.getState().pending.has(actionKey(action))).toBe(true);
    gates[0]?.reject(refusal);

    expect(await asked).toEqual({ response: null, error: refusal });
    expect(session.getState().pending.size).toBe(0);
    expect(session.getState().error).toBeNull();
  });

  test("markUnplayable keeps the set when nothing changed and copies it when it did", () => {
    const host = fakeHost();
    const session = new Session(host.link);
    const before = session.getState();

    session.markUnplayable("tt1", false);
    expect(session.getState().unplayable).toBe(before.unplayable);

    session.markUnplayable("tt1", true);
    const marked = session.getState().unplayable;
    expect(marked.has("tt1")).toBe(true);

    session.markUnplayable("tt1", true);
    expect(session.getState().unplayable).toBe(marked);

    session.markUnplayable("tt1", false);
    expect(session.getState().unplayable.has("tt1")).toBe(false);
    expect(session.getState().unplayable).not.toBe(marked);
  });

  test("Home asks through the Session's alert-free ask", async () => {
    const refusal: ActionError = { kind: "catalog", detail: "no answer" };
    const host = fakeHost({
      answer: () => {
        throw refusal;
      },
    });
    const session = new Session(host.link);
    const stop = session.start();
    await flush();

    session.home.sync(
      [
        {
          addon: "cinemeta",
          catalog: { type: "movie", id: "top", name: "Popular", extra: [] },
        },
      ],
      "cinemeta/movie/top",
    );
    await flush();

    expect(host.actions).toContainEqual({
      type: "browse_catalog",
      addon: "cinemeta",
      catalog: { type: "movie", id: "top" },
      extra: [],
    });
    expect(session.home.getSnapshot().rows[0]?.failure).toEqual(refusal);
    expect(session.getState().error).toBeNull();
    stop();
  });

  test("a resolved Response never carries a Device token", async () => {
    // A transport that still leaks the token, as an older one did.
    const leaked = {
      snapshots: [],
      answer: { paired: { device: DEVICE, token: "secret" } },
    } as unknown as Response;
    const host = fakeHost({ answer: () => leaked });
    const session = new Session(host.link);

    const response = await session.take(PAIR);

    expect(response).not.toBeNull();
    const answer = response?.answer ?? null;
    expect(answer).not.toBeNull();
    if (answer && "paired" in answer) {
      expect(answer.paired).toEqual({ device: DEVICE });
      expect("token" in answer.paired).toBe(false);
    }
  });

  test("start is idempotent and stop unsubscribes without closing the link", async () => {
    const host = fakeHost();
    const session = new Session(host.link);

    const first = session.start();
    const second = session.start();
    expect(host.snapshotListeners()).toBe(1);
    expect(host.stateListeners()).toBe(1);
    expect(host.reads()).toBe(1);

    first();
    expect(host.snapshotListeners()).toBe(1);
    second();
    expect(host.snapshotListeners()).toBe(0);
    expect(host.stateListeners()).toBe(0);
    expect(host.link.state().kind).toBe("ready");

    const again = session.start();
    expect(host.snapshotListeners()).toBe(1);
    // The Snapshot a ready link owes is asked for once, not once per mount.
    expect(host.reads()).toBe(1);
    again();
    expect(host.snapshotListeners()).toBe(0);

    await flush();
    expect(session.getState().snapshot?.revision).toBe(1);
  });
});
