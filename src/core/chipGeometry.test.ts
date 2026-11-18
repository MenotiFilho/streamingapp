import { describe, expect, test } from "vitest";

import { chipMarks } from "./chipGeometry";

describe("chipMarks", () => {
  test("with no drag nothing is marked", () => {
    expect(chipMarks(null, 0)).toEqual({ dragging: false, drop: false });
  });

  test("the lifted chip is dragging and the chip it is over is the drop", () => {
    const over = { from: 0, to: 2 };
    expect(chipMarks(over, 0)).toEqual({ dragging: true, drop: false });
    expect(chipMarks(over, 1)).toEqual({ dragging: false, drop: false });
    expect(chipMarks(over, 2)).toEqual({ dragging: false, drop: true });
  });

  test("over its own place a chip is dragging and not a drop", () => {
    expect(chipMarks({ from: 1, to: 1 }, 1)).toEqual({ dragging: true, drop: false });
  });
});
