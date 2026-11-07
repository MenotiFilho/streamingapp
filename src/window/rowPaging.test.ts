import { describe, expect, test } from "vitest";

import { itemsPerView, pagedOffset, type ItemSpan } from "./rowPaging";

/** Spans for items of the given widths, laid end to end with no gap. */
function spans(...widths: number[]): ItemSpan[] {
  let start = 0;
  return widths.map((width) => {
    const item = { start, width };
    start += width;
    return item;
  });
}

describe("the rail's paging decision", () => {
  test("moves whole card pitches, not the viewport", () => {
    // Five cards of 100px and a 24px gap: one press is five pitches, 620px,
    // even though the view shows five and a half cards.
    expect(pagedOffset(0, 5_000, 124, 5, 1)).toBe(620);
    expect(pagedOffset(620, 5_000, 124, 5, -1)).toBe(0);
  });

  test("the half card at the edge does not change the step", () => {
    // The same pitch pages the same distance from the start and from a page on.
    expect(pagedOffset(620, 5_000, 124, 5, 1)).toBe(1_240);
  });

  test("clamps at the rail's own ends", () => {
    expect(pagedOffset(0, 300, 124, 5, 1)).toBe(300);
    expect(pagedOffset(100, 300, 124, 5, -1)).toBe(0);
  });

  test("an unmeasured rail does not move", () => {
    expect(pagedOffset(0, 300, 0, 5, 1)).toBe(0);
    expect(pagedOffset(0, 300, 124, 0, 1)).toBe(0);
  });
});

describe("the rail's paging over items of varying width", () => {
  test("a view holds the whole items that fit, not the one it cuts", () => {
    // 80 + 120 + 100 + 60 = 360 inside a 400px view; the 200px chip is cut.
    const chips = spans(80, 120, 100, 60, 200);
    expect(itemsPerView(chips, 0, 400)).toBe(4);

    // From the 200px chip's leading edge it is the only one that fits whole.
    expect(itemsPerView(chips, 360, 400), "the cut chip is not a page").toBe(1);
  });

  test("a view narrower than one chip still pages one chip", () => {
    expect(itemsPerView(spans(200, 100), 0, 120)).toBe(1);
  });

  test("pages to the leading edge of the chip a view on", () => {
    // Starts 0, 80, 200, 300, 360, 560, 650. Four chips land on the fifth.
    const chips = spans(80, 120, 100, 60, 200, 90, 110);
    expect(pagedOffset(0, 1_000, chips, 4, 1)).toBe(360);
    expect(pagedOffset(360, 1_000, chips, 2, 1)).toBe(650);
    expect(pagedOffset(650, 1_000, chips, 2, -1)).toBe(360);
  });

  test("clamps at the ends of a varying-width track", () => {
    const chips = spans(80, 120, 100);
    expect(pagedOffset(0, 500, chips, 2, -1)).toBe(0);
    expect(pagedOffset(200, 500, chips, 2, 1)).toBe(500);
  });

  test("an unmeasured content rail does not move", () => {
    expect(pagedOffset(0, 500, spans(0, 0, 0), 2, 1)).toBe(0);
  });
});
