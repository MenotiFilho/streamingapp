/**
 * The shape the Session's stores share (ADR-0035 §1).
 *
 * Home's Catalog rows, Discover's and Search's feeds, and the keyless Search's
 * answers are three different questions, but a screen reads every one of them
 * the same way: a snapshot through `useSyncExternalStore`, published to a
 * listener set only when something moved. Keeping the mechanism here means a
 * change to it cannot land in one store and not the others, and no store grows
 * a second copy of `subscribe`, `getSnapshot` or the set comparison.
 */

import type { ActionOutcome } from "./answers";
import type { Action } from "./wire";

/** The Shell's one door, as a store needs it. */
export type Ask = (action: Action) => Promise<ActionOutcome>;

/** One store's snapshot and the listeners a screen reads it through. */
export class SnapshotStore<Snapshot> {
  private snapshot: Snapshot;
  private readonly listeners = new Set<() => void>();

  protected constructor(initial: Snapshot) {
    this.snapshot = initial;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): Snapshot => this.snapshot;

  /**
   * Move the snapshot to `next` and tell the listeners, unless `unchanged` says
   * the previous snapshot still answers. A store builds `next` from its own
   * fields and asks here whether anything moved; an unchanged publish keeps the
   * same object, so a render does not see a new one.
   */
  protected publishSnapshot(
    next: Snapshot,
    unchanged: (previous: Snapshot) => boolean,
  ): void {
    const previous = this.snapshot;
    if (unchanged(previous)) {
      return;
    }
    this.snapshot = next;
    for (const listener of this.listeners) {
      listener();
    }
  }
}

/** Whether two sets hold the same members — what a store compares cheaply. */
export function sameSet<T>(left: ReadonlySet<T>, right: ReadonlySet<T>): boolean {
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
