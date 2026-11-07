import { describe, expect, test, vi } from "vitest";

import { SnapshotStore, sameSet } from "./store";

/** One store with a snapshot a test can move, as the Session's three are. */
class Counter extends SnapshotStore<number> {
  constructor(initial: number) {
    super(initial);
  }

  set(next: number): void {
    this.publishSnapshot(next, (previous) => previous === next);
  }
}

/**
 * The shape the Session's stores share (ADR-0035 §1): one snapshot a screen
 * reads through `useSyncExternalStore`, one listener set, and a publish that
 * leaves the snapshot alone when nothing changed.
 */
describe("a Session store's snapshot", () => {
  test("subscribe returns the unsubscribe, and a publish tells every listener once", () => {
    const store = new Counter(0);
    const first = vi.fn();
    const second = vi.fn();
    const stop = store.subscribe(first);
    store.subscribe(second);

    store.set(1);

    expect(store.getSnapshot()).toBe(1);
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();

    stop();
    store.set(2);
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledTimes(2);
  });

  test("an unchanged publish keeps the same snapshot object and tells nobody", () => {
    const store = new Counter(1);
    const listener = vi.fn();
    store.subscribe(listener);

    store.set(1);

    expect(store.getSnapshot()).toBe(1);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("sameSet", () => {
  test("two sets with the same members compare equal whatever their order", () => {
    expect(sameSet(new Set(["a", "b"]), new Set(["b", "a"]))).toBe(true);
    expect(sameSet(new Set<string>(), new Set<string>())).toBe(true);
  });

  test("a missing or an extra member is a difference", () => {
    expect(sameSet(new Set(["a"]), new Set(["a", "b"]))).toBe(false);
    expect(sameSet(new Set(["a", "b"]), new Set(["a"]))).toBe(false);
    expect(sameSet(new Set(["a"]), new Set(["b"]))).toBe(false);
  });
});
