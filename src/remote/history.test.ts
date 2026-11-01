import { describe, expect, test } from "vitest";

import { SENTINEL, armSentinel, decideHistory, isSentinel } from "./history";

describe("the Remote's browser history", () => {
  test("landing on the sentinel is a forward traversal, not a Back", () => {
    expect(decideHistory(SENTINEL, true, true)).toBe("ignore");
  });

  test("an unpaired page has no app to go back into", () => {
    expect(decideHistory(null, false, true)).toBe("ignore");
    expect(decideHistory(SENTINEL, false, true)).toBe("ignore");
  });

  test("a paired page with a level to pop takes the Back itself", () => {
    expect(decideHistory(null, true, true)).toBe("back");
    expect(decideHistory({ anything: "else" }, true, true)).toBe("back");
  });

  test("a paired page with nothing to pop lets the browser leave", () => {
    expect(decideHistory(null, true, false)).toBe("leave");
  });

  test("the sentinel is armed once, and only for a paired page", () => {
    const pushed: unknown[] = [];
    const history = {
      state: null as unknown,
      pushState: (state: unknown) => {
        pushed.push(state);
        history.state = state;
      },
    };

    expect(armSentinel(history, true)).toBe(true);
    expect(armSentinel(history, true)).toBe(false);
    expect(pushed).toEqual([SENTINEL]);
    expect(isSentinel(history.state)).toBe(true);

    const unpaired = { state: null as unknown, pushState: () => undefined };
    expect(armSentinel(unpaired, false)).toBe(false);
    expect(unpaired.state).toBeNull();
  });

  test("a browser that refuses history keeps its own Back", () => {
    const refusing = {
      state: null as unknown,
      pushState: () => {
        throw new Error("history is not available");
      },
    };

    expect(armSentinel(refusing, true)).toBe(false);
  });
});
