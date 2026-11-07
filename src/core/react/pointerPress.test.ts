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

  test("a row that fills its scrollport is fully visible though the port's client box is snapped", () => {
    // The Title's episode list as Chromium measured it at 1536x864 and a 1.25
    // device scale (#275): the list's client box is the whole pixels 725x683,
    // and its rows fill it with their exact width of 725.375. Every row
    // overhangs the snapped box by 0.375px and was read as cut off, so the
    // first press only focused it.
    const page = document.documentElement;
    const list = document.createElement("div");
    const row = document.createElement("button");
    const lower = document.createElement("button");
    list.style.overflowY = "auto";
    list.append(row, lower);
    document.body.append(list);

    list.getBoundingClientRect = () => box(776.0625, 151.875, 1511.4375, 836.359375);
    Object.defineProperty(list, "clientWidth", { configurable: true, value: 725 });
    Object.defineProperty(list, "clientHeight", { configurable: true, value: 683 });
    Object.defineProperty(list, "clientTop", { configurable: true, value: 1 });
    row.getBoundingClientRect = () => box(776.0625, 152.875, 1501.4375, 270.671875);
    // A row the bottom of the list really does cut off.
    lower.getBoundingClientRect = () => box(776.0625, 780, 1501.4375, 897.796875);
    Object.defineProperty(page, "clientWidth", { configurable: true, value: 1536 });
    Object.defineProperty(page, "clientHeight", { configurable: true, value: 864 });

    try {
      expect(
        pressIsFullyVisible(row),
        "the row fills the list's width, and the port's whole pixels do not make it cut off",
      ).toBe(true);
      expect(
        pressIsFullyVisible(lower),
        "a row that runs past the list's bottom edge is still cut off",
      ).toBe(false);
    } finally {
      list.remove();
      Object.defineProperty(page, "clientWidth", { configurable: true, value: 0 });
      Object.defineProperty(page, "clientHeight", { configurable: true, value: 0 });
    }
  });
});
