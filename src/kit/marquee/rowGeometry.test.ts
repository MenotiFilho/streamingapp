import { describe, expect, test } from "vitest";

import { decideMove, type Direction, type Layout, type Rect } from "../../window/focus";

/*
 * Why a row's main button stands clear of the control beside it: the focus
 * engine takes a control for "that way" only when it starts more than
 * `MIN_STEP` past the origin's edge. The rectangles are the C7 sheet's, in its
 * own units, for a focused row: the main button, then the controls.
 */

const at = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

const ROWS = {
  "Addon row": (clear: number) => [
    at(18, 0, 520 - clear - 18, 112),
    ...[520, 576, 632, 688].map((x) => at(x, 32, 48, 48)),
    at(796, 39, 60, 34),
  ],
  "Ranked row": (clear: number) => [
    at(18, 0, 676 - clear - 18, 72),
    ...[676, 732, 788].map((x) => at(x, 12, 48, 48)),
  ],
};

/** The 1920x1080 frame, a 720p window, and the unit's floor. */
const UNITS = [1, 2 / 3, 0.5];

function walk(rects: Rect[], direction: Direction, from: number): number[] {
  const layout: Layout = {
    regions: {
      row: {
        id: "row",
        label: "Row",
        kind: "row",
        parent: null,
        children: [],
        rect: at(0, 0, 880, 112),
        itemRects: rects,
      },
    },
    memory: {},
  };
  const visited = [from];
  let index = from;
  for (;;) {
    const decision = decideMove(layout, { regionId: "row", index }, direction);
    if (decision.kind === "blocked") {
      return visited;
    }
    index = decision.index;
    visited.push(index);
  }
}

describe.each(Object.entries(ROWS))("the %s", (_name, row) => {
  const scaled = (clear: number, u: number) =>
    row(clear).map(({ x, y, w, h }) => at(x * u, y * u, w * u, h * u));

  test.each(UNITS)("at a unit of %s, 8u clear reaches every control both ways", (u) => {
    const rects = scaled(8, u);
    const all = rects.map((_, index) => index);

    expect(walk(rects, "right", 0)).toEqual(all);
    expect(walk(rects, "left", rects.length - 1)).toEqual([...all].reverse());
  });

  test("touching its first control, the main button loses it both ways", () => {
    const rects = scaled(0, 1);

    expect(walk(rects, "right", 0)).not.toContain(1);
    expect(walk(rects, "left", 1)).toEqual([1]);
  });
});
