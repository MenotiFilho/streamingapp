import type { Action } from "../host-client";

/**
 * The Action's own shape, with object keys in one order.
 *
 * Two controls that ask for the same thing produce the same key whatever order
 * they built the object in. Arrays keep their order: a Stream's warnings are a
 * list, and two lists in different orders are two different facts (#137).
 */
export function actionKey(action: Action): string {
  return JSON.stringify(ordered(action));
}

function ordered(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(ordered);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, ordered((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

/**
 * Whether an Action means "one more step" rather than "make it so".
 *
 * Two identical relative Actions are two steps: a second rewind while the first
 * is in flight must reach the Host, and a second chapter step must move again.
 * An autocrop is a toggle, so two presses are two toggles. These are never
 * joined; everything else may be (#137).
 */
export function repeats(action: Action): boolean {
  switch (action.type) {
    case "seek":
    case "next_chapter":
    case "previous_chapter":
    case "autocrop":
      return true;
    default:
      return false;
  }
}
