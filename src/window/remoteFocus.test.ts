import { describe, expect, test } from "vitest";

import remotePage from "../../crates/host-wire/remote/index.html?raw";
import { nearest, type Direction, type Rect } from "./focus";

type PickNearest = (from: Rect, rects: readonly Rect[], direction: Direction) => number;

/**
 * The Remote page inlines the window's pure focus geometry because it has no
 * build step. Lift `nearest` and the helpers it needs out of the template and
 * run the real page code against the window's tests, so the two clients cannot
 * drift on the ranking (#128).
 */
function remoteNearest(): PickNearest {
  const start = remotePage.indexOf("const MIN_STEP = 1;");
  const end = remotePage.indexOf("function focusables(", start);
  if (start < 0 || end < 0) {
    throw new Error("the Remote page carries the pure focus geometry");
  }
  const source = remotePage.slice(start, end);
  return new Function(`${source}\nreturn nearest;`)() as PickNearest;
}

const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

describe("the Remote's nearest ranking", () => {
  test("prefers a lined-up control even when a diagonal one is closer", () => {
    const from = rect(0, 0, 100, 100);
    const cards = [
      from,
      rect(101, 400, 100, 100), // lined up, far below
      rect(160, 120, 100, 100), // diagonal, a much shorter step
    ];

    expect(remoteNearest()(from, cards, "down")).toBe(1);
  });

  test("with nothing aligned, takes the closest by edge distance, not the smallest gap", () => {
    const from = rect(0, 0, 100, 100);
    const cards = [
      from,
      rect(120, 300, 100, 100), // smallest sideways gap, but far away
      rect(250, 110, 100, 100), // bigger gap, but the closest edge
    ];

    expect(remoteNearest()(from, cards, "down")).toBe(2);
  });

  test("matches the window's decisions in every direction", () => {
    const remote = remoteNearest();
    const from = rect(0, 0, 100, 100);
    const cards = [
      rect(120, 0, 100, 100), // 0: right
      rect(0, 120, 100, 100), // 1: down
      rect(-120, 0, 100, 100), // 2: left
      rect(0, -120, 100, 100), // 3: up
      rect(160, 160, 100, 100),
      rect(-160, -160, 100, 100),
      rect(105, 400, 100, 100),
      rect(400, 105, 100, 100),
    ];
    const expected: Record<Direction, number> = { up: 3, down: 1, left: 2, right: 0 };

    for (const direction of Object.keys(expected) as Direction[]) {
      const pick = remote(from, cards, direction);
      expect(pick, direction).toBe(expected[direction]);
      expect(pick, direction).toBe(nearest(from, cards, direction));
    }
  });
});
