import { describe, expect, test } from "vitest";

import { GRID_FOCUS_AHEAD } from "./gridPaging";
import {
  gridFocusAheadForColumns,
  marqueeUnitPx,
  posterGridAvailableWidth,
  posterGridColumns,
  posterGridColumnsForViewport,
} from "./marqueeLayout";

describe("Marquee reference-frame unit", () => {
  test("equals 1px at 1920x1080, floors at 0.5px, and scales without ceiling", () => {
    expect(marqueeUnitPx(1920, 1080)).toBe(1);
    expect(marqueeUnitPx(1280, 800)).toBeCloseTo(2 / 3, 5);
    expect(marqueeUnitPx(2560, 1080)).toBe(1);
    expect(marqueeUnitPx(3440, 1440)).toBeCloseTo(4 / 3, 5);
    expect(marqueeUnitPx(800, 600)).toBe(0.5);
    expect(marqueeUnitPx(3840, 2160)).toBe(2);
    expect(marqueeUnitPx(0, 1080)).toBe(1);
  });
});

describe("poster grid column count from window width", () => {
  test("keeps 7 columns at 1920x1080 and 1280x800", () => {
    expect(posterGridColumnsForViewport(1920, 1080)).toBe(7);
    expect(posterGridColumnsForViewport(1280, 800)).toBe(7);
  });

  test("gains columns on ultrawide viewports (2560x1080 and 3440x1440)", () => {
    expect(posterGridColumnsForViewport(2560, 1080)).toBe(9);
    expect(posterGridColumnsForViewport(3440, 1440)).toBe(10);
  });

  test("never returns fewer than 1 column even in narrow containers", () => {
    expect(posterGridColumns({ availableWidth: 0, unitPx: 1 })).toBe(1);
    expect(posterGridColumns({ availableWidth: 150, unitPx: 1 })).toBe(1);
    expect(posterGridColumns({ availableWidth: 444, unitPx: 1 })).toBe(2);
    expect(posterGridAvailableWidth(100, 1)).toBe(0);
  });

  test("scales focus-ahead paging window with wider grids", () => {
    expect(gridFocusAheadForColumns(7)).toBe(7);
    expect(gridFocusAheadForColumns(10)).toBe(10);
    expect(gridFocusAheadForColumns(2)).toBe(GRID_FOCUS_AHEAD);
    expect(gridFocusAheadForColumns(0)).toBe(GRID_FOCUS_AHEAD);
  });
});
