import { describe, expect, test } from "vitest";

import { pressIsFullyVisible } from "./pointerPress";

/** A DOMRect-shaped box for the one geometry walk the page owns. */
function box(left: number, top: number, right: number, bottom: number): DOMRect {
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

describe("the press's DOM geometry", () => {
  test("a fixed panel is the last clipper, not the page port above it", () => {
    // The OSD and the dock are fixed bands over a page that may be scrolled
    // elsewhere: the panel's own box decides, and the port above it does not
    // clip the control while the viewport still holds it.
    const page = document.documentElement;
    const outer = document.createElement("div");
    const panel = document.createElement("div");
    const control = document.createElement("button");
    outer.style.overflowX = "auto";
    panel.style.position = "fixed";
    panel.append(control);
    outer.append(panel);
    document.body.append(outer);

    outer.getBoundingClientRect = () => box(0, 0, 50, 50);
    Object.defineProperty(outer, "clientWidth", { configurable: true, value: 50 });
    Object.defineProperty(outer, "clientHeight", { configurable: true, value: 500 });
    panel.getBoundingClientRect = () => box(0, 0, 400, 400);
    Object.defineProperty(panel, "clientWidth", { configurable: true, value: 400 });
    Object.defineProperty(panel, "clientHeight", { configurable: true, value: 400 });
    control.getBoundingClientRect = () => box(100, 100, 200, 200);
    Object.defineProperty(page, "clientWidth", { configurable: true, value: 1000 });
    Object.defineProperty(page, "clientHeight", { configurable: true, value: 1000 });

    try {
      expect(
        pressIsFullyVisible(control),
        "the fixed panel holds it; the page port above the panel does not",
      ).toBe(true);
    } finally {
      outer.remove();
      Object.defineProperty(page, "clientWidth", { configurable: true, value: 0 });
      Object.defineProperty(page, "clientHeight", { configurable: true, value: 0 });
    }
  });
});
