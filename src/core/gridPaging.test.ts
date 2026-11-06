import { describe, expect, test } from "vitest";

import { cardNearEnd, gridPageDue, nearingEnd } from "./gridPaging";

/**
 * The grid's own paging rule (#264): reaching the end of a whole-row grid asks
 * the row's next page, without a button, and only once.
 */
describe("the grid's approach to its end", () => {
  test("the last card counts as reached when it is inside the margin below the viewport", () => {
    expect(nearingEnd(760, 800, 480)).toBe(true);
    expect(nearingEnd(1281, 800, 480), "one screen further is not near").toBe(false);
  });

  test("a focused card among the last few is near the end", () => {
    expect(cardNearEnd(19, 20, 4), "the last card").toBe(true);
    expect(cardNearEnd(16, 20, 4), "the fourth from the end").toBe(true);
    expect(cardNearEnd(15, 20, 4), "the fifth from the end is not").toBe(false);
  });

  test("a page is due only when the grid has more, is done reading, and is near its end", () => {
    expect(
      gridPageDue({ done: false, failure: null }, { reading: false, near: true }),
    ).toBe(true);
    expect(
      gridPageDue({ done: false, failure: null }, { reading: true, near: true }),
      "a page in flight is not asked again",
    ).toBe(false);
    expect(
      gridPageDue({ done: true, failure: null }, { reading: false, near: true }),
      "a done row has no next page",
    ).toBe(false);
    expect(
      gridPageDue(
        { done: false, failure: { kind: "fetch", detail: "down" } },
        { reading: false, near: true },
      ),
      "a failed page waits for the person's Try again",
    ).toBe(false);
    expect(
      gridPageDue({ done: false, failure: null }, { reading: false, near: false }),
      "far from the end, nothing is asked",
    ).toBe(false);
  });
});
