import { describe, expect, test } from "vitest";

import type { ActionError } from "./errors";
import { cardNearEnd, gridPageDue, gridPaging, nearingEnd } from "./gridPaging";

/**
 * The grid's own paging rule (#264): reaching the end of a whole-row grid asks
 * the row's next page, without a button, and only once. What the grid draws for
 * that page — Try again, the reading line, the empty line — is one decision here
 * rather than a copy in each component (S2).
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

/**
 * The view a grid draws for its row's paging: whether there is a next page to
 * watch, whether Try again is offered, whether the row is reading and whether it
 * ended before it read a card.
 */
describe("what a grid shows for its row's page", () => {
  const failure: ActionError = { kind: "fetch", detail: "down" };

  test("a pageable row watches its real done and failure", () => {
    const reading = gridPaging({
      done: false,
      failure: null,
      pageable: true,
      reading: true,
      count: 20,
    });

    expect(reading.page).toEqual({ done: false, failure: null });
    expect(reading.reading, "a page in flight prints the reading line").toBe(true);
    expect(reading.retry, "nothing failed, so there is nothing to try again").toBe(false);
    expect(reading.empty).toBe(false);
  });

  test("a done row carries its real done, so gridPageDue is what refuses it", () => {
    const done = gridPaging({
      done: true,
      failure: null,
      pageable: true,
      reading: false,
      count: 20,
    });
    expect(done.page, "the row's real done, not a caller's false").toEqual({
      done: true,
      failure: null,
    });
    expect(
      gridPageDue(done.page!, { reading: false, near: true }),
      "a finished row is never asked for a page it does not have",
    ).toBe(false);
  });

  test("a failed page offers Try again once it is not in flight", () => {
    const failed = gridPaging({
      done: false,
      failure,
      pageable: true,
      reading: false,
      count: 20,
    });
    expect(failed.retry).toBe(true);
    expect(failed.page).toEqual({ done: false, failure });

    expect(
      gridPaging({ done: false, failure, pageable: true, reading: true, count: 20 }).retry,
      "a retry already in flight is not offered twice",
    ).toBe(false);
  });

  test("a row with no paging at all never offers Try again", () => {
    const catalog = gridPaging({
      done: false,
      failure,
      pageable: false,
      reading: false,
      count: 0,
    });
    expect(catalog.page).toBeNull();
    expect(catalog.retry, "a Catalog with no skip has no page to ask again").toBe(false);
  });

  test("a row that ended before it read a card is the empty grid", () => {
    expect(
      gridPaging({ done: true, failure: null, pageable: true, reading: false, count: 0 })
        .empty,
      "a done row with no cards says so",
    ).toBe(true);
    expect(
      gridPaging({ done: false, failure: null, pageable: true, reading: true, count: 0 })
        .empty,
      "a row still reading is not empty",
    ).toBe(false);
    expect(
      gridPaging({ done: true, failure, pageable: true, reading: false, count: 0 }).empty,
      "a failure is said inline, not as an empty feed",
    ).toBe(false);
  });
});
