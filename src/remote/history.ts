/**
 * The browser's Back, kept for the app (ADR-0035 §1, #185).
 *
 * A browser hands the phone's Back gesture to its history, and a page with one
 * entry gives that gesture nothing to pop: the Remote would be left by the same
 * gesture every Android user makes to go up. The page therefore sits on one
 * opaque entry of its own — the sentinel — and reads the history's Back as one
 * more `back()` for the level stack.
 *
 * The decision is here, pure, because it is the rule rather than the drawing:
 * a forward traversal onto the sentinel is not a Back, an unpaired page has no
 * app to go back into, and a page with nothing to pop lets the browser have the
 * gesture. `RemoteApp` is the only caller that touches `window.history`.
 */

/** The one marker the sentinel entry carries. */
export const SENTINEL = { remote: "sentinel" } as const;

/** Whether a history entry is the Remote's own sentinel. */
export function isSentinel(state: unknown): boolean {
  return (
    typeof state === "object" &&
    state !== null &&
    (state as { remote?: unknown }).remote === SENTINEL.remote
  );
}

/** What a history event means to the app. */
export type HistoryDecision =
  /** Not a Back: a forward traversal, or a page that has not paired. */
  | "ignore"
  /** Back inside the app: pop the level stack and re-arm the sentinel. */
  | "back"
  /** Nothing to pop: the browser's own Back is the right one. */
  | "leave";

/**
 * What one `popstate` means.
 *
 * `state` is the entry the browser landed on. Landing on the sentinel is a
 * forward traversal — the app had already gone back, and the entry it pushed is
 * the one being re-entered — so it is not a second Back.
 */
export function decideHistory(
  state: unknown,
  paired: boolean,
  canGoBack: boolean,
): HistoryDecision {
  if (!paired) {
    return "ignore";
  }
  if (isSentinel(state)) {
    return "ignore";
  }
  return canGoBack ? "back" : "leave";
}

/** The two history calls arming the sentinel needs; `window.history` has them. */
export type HistoryLike = {
  state: unknown;
  pushState(state: unknown, unused: string): void;
};

/**
 * Sit the page on a sentinel entry, unless it already is one.
 *
 * Returns whether it pushed. A browser that refuses history — a page in a
 * sandbox, a storage-less private window — keeps its own Back, which is exactly
 * what a page with no sentinel has anyway, so a refusal is not an error.
 */
export function armSentinel(history: HistoryLike, paired: boolean): boolean {
  if (!paired || isSentinel(history.state)) {
    return false;
  }
  try {
    history.pushState(SENTINEL, "");
    return true;
  } catch {
    return false;
  }
}
