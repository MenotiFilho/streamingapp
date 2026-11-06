import { describe, expect, test, vi } from "vitest";

import { Selection } from "./selection";

/**
 * The session-scoped selection a screen leaves outside its own mount (#264):
 * Discover's genre and Search's query are the person's place, not the screen's.
 */
describe("a session-scoped selection", () => {
  test("holds the last value a person chose, and notifies only when it moves", () => {
    const selection = new Selection<string | null>(null);
    const seen = vi.fn();
    const stop = selection.subscribe(seen);

    expect(selection.get()).toBeNull();
    selection.set("Drama");
    selection.set("Drama");

    expect(selection.get()).toBe("Drama");
    expect(seen, "an unchanged value is not news").toHaveBeenCalledOnce();
    stop();
    selection.set(null);
    expect(seen).toHaveBeenCalledOnce();
  });
});
