import { describe, expect, test } from "vitest";

import { chipRects } from "./chipRects";

describe("chipRects", () => {
  test("reads each chip's box in the order they are drawn, and none from nothing", () => {
    const field = document.createElement("div");
    for (const left of [0, 100]) {
      const chip = document.createElement("span");
      chip.setAttribute("data-chip-index", String(left / 100));
      chip.getBoundingClientRect = () => ({ left, top: 5, width: 90, height: 40 }) as DOMRect;
      field.append(chip);
    }
    expect(chipRects(field)).toEqual([
      { x: 0, y: 5, w: 90, h: 40 },
      { x: 100, y: 5, w: 90, h: 40 },
    ]);
    expect(chipRects(null)).toEqual([]);
  });
});
