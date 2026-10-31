import { describe, expect, test } from "vitest";

import { pagedOffset } from "./rowPaging";

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
