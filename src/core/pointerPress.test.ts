import { describe, expect, test } from "vitest";

import { insidePort, insidePorts, pointerPressPlan, type PressBox } from "./pointerPress";

/** A 600x400 port at the origin. */
const row: PressBox = { left: 0, top: 0, right: 600, bottom: 400 };

describe("the cut-off pointer press plan", () => {
  test("a cut-off control inside a row focuses on the first press", () => {
    expect(
      pointerPressPlan({ inRow: true, wasFocused: false, fullyVisible: false }),
    ).toBe("focus");
  });

  test("a fully visible control inside a row activates on the first press", () => {
    expect(
      pointerPressPlan({ inRow: true, wasFocused: false, fullyVisible: true }),
    ).toBe("activate");
  });

  test("the second press on the now-focused control activates", () => {
    expect(
      pointerPressPlan({ inRow: true, wasFocused: true, fullyVisible: false }),
    ).toBe("activate");
  });

  test("a control outside a row is direct manipulation", () => {
    expect(
      pointerPressPlan({ inRow: false, wasFocused: false, fullyVisible: false }),
    ).toBe("activate");
  });
});

describe("the press's visibility", () => {
  test("a control wholly inside every port is fully visible", () => {
    expect(
      insidePorts({ left: 100, top: 80, right: 260, bottom: 320 }, [row]),
    ).toBe(true);
  });

  test("a control on a port's edge is still fully visible", () => {
    expect(
      insidePorts({ left: 0, top: 0, right: 600, bottom: 400 }, [row]),
    ).toBe(true);
  });

  test("a control cut off on any side is not fully visible", () => {
    const target: PressBox = { left: 100, top: 80, right: 260, bottom: 320 };

    expect(insidePort({ ...target, left: -1 }, row)).toBe(false);
    expect(insidePort({ ...target, top: -1 }, row)).toBe(false);
    expect(insidePort({ ...target, right: 601 }, row)).toBe(false);
    expect(insidePort({ ...target, bottom: 401 }, row)).toBe(false);
  });

  test("every port has to hold the control, not only the innermost", () => {
    const page: PressBox = { left: 0, top: 0, right: 1000, bottom: 600 };
    const target: PressBox = { left: 700, top: 80, right: 860, bottom: 320 };

    expect(insidePorts(target, [row, page]), "the row clips it").toBe(false);
    expect(
      insidePorts({ ...target, left: 100, right: 260 }, [row, page]),
      "inside the row and the page",
    ).toBe(true);
  });

  test("no ports means nothing clips the control", () => {
    expect(insidePorts(row, [])).toBe(true);
  });
});
