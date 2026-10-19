import { describe, expect, test } from "vitest";

import {
  DEFAULT_RULES,
  decideMove,
  nearest,
  rehome,
  type Layout,
  type Rect,
  type Region,
} from "./focus";

const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

function region(
  id: string,
  options: {
    kind?: string;
    label?: string;
    parent?: string | null;
    rect?: Rect;
    items?: Rect[];
    children?: string[];
  } = {},
): Region {
  return {
    id,
    label: options.label ?? id,
    kind: options.kind ?? "row",
    parent: options.parent ?? null,
    children: options.children ?? [],
    rect: options.rect ?? rect(0, 0, 0, 0),
    itemRects: options.items ?? [],
  };
}

function layout(regions: Region[], memory: Record<string, number> = {}): Layout {
  return {
    regions: Object.fromEntries(regions.map((held) => [held.id, held])),
    memory,
  };
}

describe("nearest, the geometry inside a region", () => {
  test("takes the shortest step among the candidates lined up with the origin", () => {
    const from = rect(0, 0, 100, 100);
    const cards = [from, rect(120, 0, 100, 100), rect(240, 0, 100, 100)];

    expect(nearest(from, cards, "right")).toBe(1);
  });

  test("prefers a lined-up candidate over a diagonal one with a shorter step", () => {
    const from = rect(0, 0, 100, 100);
    const cards = [
      from,
      rect(10, 120, 100, 100), // lined up, twenty pixels below
      rect(300, 105, 100, 100), // five pixels below, but far to the side
    ];

    expect(nearest(from, cards, "down")).toBe(1);
  });

  test("breaks a tie on the sideways gap by the shorter step, then the closer centre", () => {
    const from = rect(0, 0, 100, 100);
    const shorter = [from, rect(0, 120, 100, 100), rect(0, 400, 100, 100)];
    expect(nearest(from, shorter, "down")).toBe(1);

    const closerCentre = [from, rect(50, 120, 100, 100), rect(-30, 120, 100, 100)];
    expect(nearest(from, closerCentre, "down")).toBe(2);
  });

  test("does not count a rect that does not clear the origin by a step", () => {
    const from = rect(0, 0, 100, 100);
    expect(nearest(from, [from, rect(100, 0, 100, 100)], "right")).toBe(-1);
  });

  test("answers -1 when nothing lies that way", () => {
    const from = rect(100, 100, 100, 100);
    expect(nearest(from, [from], "up")).toBe(-1);
  });
});

/**
 * The shell the browser draws: a rail down the left, and a content screen with
 * stacked rows. The rail spans the content's height; each row spans its width.
 */
function shell(rows: Array<{ id: string; y: number; items: Rect[] }>): Layout {
  const screen: Region = region("screen", {
    kind: "branch",
    label: "the content",
    parent: "shell",
    rect: rect(120, 0, 800, 600),
    children: rows.map((row) => row.id),
  });
  const rail = region("rail", {
    kind: "rail",
    label: "the rail",
    parent: "shell",
    rect: rect(0, 0, 100, 600),
    items: Array.from({ length: 6 }, (_, index) => rect(0, index * 90, 100, 80)),
  });
  const shellRegion = region("shell", {
    kind: "branch",
    label: "the shell",
    rect: rect(0, 0, 1000, 600),
    children: ["rail", "screen"],
  });

  return layout([
    shellRegion,
    rail,
    screen,
    ...rows.map((row) =>
      region(row.id, {
        label: row.id,
        parent: "screen",
        rect: rect(120, row.y, 800, 100),
        items: row.items,
      }),
    ),
  ]);
}

const cards = (y: number, count: number, width = 100) =>
  Array.from({ length: count }, (_, index) => rect(120 + index * (width + 20), y, width, 100));

describe("decideMove inside a region", () => {
  test("moves by geometry to the nearest card, and says where it went", () => {
    const rows = [{ id: "row:one", y: 0, items: cards(0, 3) }];
    const decision = decideMove(
      shell(rows),
      { regionId: "row:one", index: 0 },
      "right",
      DEFAULT_RULES,
    );

    expect(decision).toMatchObject({ kind: "moved", regionId: "row:one", index: 1 });
  });
});

describe("crossing between regions", () => {
  test("crosses down to the row below and enters the card under the origin's middle", () => {
    const rows = [
      { id: "row:top", y: 0, items: cards(0, 2) },
      { id: "row:bottom", y: 120, items: cards(120, 8) },
    ];
    const decision = decideMove(
      shell(rows),
      { regionId: "row:top", index: 0 },
      "down",
      DEFAULT_RULES,
    );

    expect(decision).toMatchObject({
      kind: "crossed",
      regionId: "row:bottom",
      index: 0,
      landedBy: "the card under your middle",
    });
  });

  test("crosses left from a card to the full-height rail at the matching height", () => {
    const rows = [{ id: "row:one", y: 0, items: cards(0, 3) }];
    const decision = decideMove(
      shell(rows),
      { regionId: "row:one", index: 0 },
      "left",
      DEFAULT_RULES,
    );

    expect(decision).toMatchObject({ kind: "crossed", regionId: "rail", index: 0 });
  });

  test("does not leak Right from a short row into a wider row below", () => {
    // Continue watching has three cards; the row beneath has eight. Right at
    // the end of the short row must stop, not fall diagonally into the row
    // below, even though a card down there is to the right of where we are.
    const rows = [
      { id: "row:short", y: 0, items: cards(0, 3) },
      { id: "row:wide", y: 120, items: cards(120, 8) },
    ];
    const decision = decideMove(
      shell(rows),
      { regionId: "row:short", index: 2 },
      "right",
      DEFAULT_RULES,
    );

    expect(decision.kind).toBe("blocked");
    expect(decision.kind === "blocked" && decision.why).toContain("end of the row");
  });
});

describe("entering a region", () => {
  test("lands on the head when what came from is wider than the whole target region", () => {
    // Down from a full-width hero or search box has no meaningful middle to
    // stand over: the row's head is the honest landing.
    const rows = [{ id: "row:results", y: 120, items: cards(120, 3) }];
    const rowsLayout = shell(rows);
    rowsLayout.regions["hero"] = region("hero", {
      label: "the hero",
      parent: "screen",
      rect: rect(120, 0, 800, 80),
      items: [rect(120, 0, 800, 80)],
    });
    rowsLayout.regions["screen"]?.children.push("hero");

    const decision = decideMove(
      rowsLayout,
      { regionId: "hero", index: 0 },
      "down",
      DEFAULT_RULES,
    );

    expect(decision).toMatchObject({
      kind: "crossed",
      regionId: "row:results",
      index: 0,
      landedBy: "the region's head — what you came from is wider than the whole region",
    });
  });

  test("remembers where a region was left when the rules ask it to", () => {
    const rows = [
      { id: "row:top", y: 0, items: cards(0, 2) },
      { id: "row:bottom", y: 120, items: cards(120, 8) },
    ];
    const remembered = layout(Object.values(shell(rows).regions), {
      "row:bottom": 4,
    });
    const decision = decideMove(
      remembered,
      { regionId: "row:top", index: 0 },
      "down",
      { ...DEFAULT_RULES, entry: "remember" },
    );

    expect(decision).toMatchObject({ kind: "crossed", regionId: "row:bottom", index: 4 });
  });
});

describe("the walls", () => {
  test("a row's end stops rather than wrapping", () => {
    const rows = [{ id: "row:one", y: 0, items: cards(0, 3) }];
    expect(
      decideMove(shell(rows), { regionId: "row:one", index: 2 }, "right", DEFAULT_RULES),
    ).toMatchObject({ kind: "blocked" });
  });

  test("the rail's end stops rather than wrapping", () => {
    const rows = [{ id: "row:one", y: 0, items: cards(0, 3) }];
    expect(
      decideMove(shell(rows), { regionId: "rail", index: 5 }, "down", DEFAULT_RULES),
    ).toMatchObject({ kind: "blocked" });
  });

  test("Up from the top of the content goes nowhere, and no rule sends it to the rail", () => {
    const rows = [{ id: "row:top", y: 120, items: cards(120, 3) }];
    const decision = decideMove(
      shell(rows),
      { regionId: "row:top", index: 0 },
      "up",
      DEFAULT_RULES,
    );

    expect(decision).toMatchObject({ kind: "blocked" });
  });

  test("Up out of the content can be handed to the rail when a rule says so", () => {
    const rows = [{ id: "row:top", y: 120, items: cards(120, 3) }];
    const decision = decideMove(
      shell(rows),
      { regionId: "row:top", index: 0 },
      "up",
      { ...DEFAULT_RULES, upFromContent: "rail" },
    );

    expect(decision).toMatchObject({ kind: "crossed", regionId: "rail" });
  });
});

describe("rehome when the focused control disappears", () => {
  const choices = (count: number) => cards(0, count);

  test("steps back to the control before the gap", () => {
    const rows = [{ id: "row:one", y: 0, items: choices(5) }];
    const landing = rehome(
      shell(rows),
      { regionId: "row:one", index: 3 },
      DEFAULT_RULES,
    );

    expect(landing).toMatchObject({ regionId: "row:one", index: 2 });
    expect(landing?.why).toContain("stepped back");
  });

  test("clamps the step-back to the remaining controls", () => {
    const rows = [{ id: "row:one", y: 0, items: choices(1) }];
    const landing = rehome(
      shell(rows),
      { regionId: "row:one", index: 3 },
      DEFAULT_RULES,
    );

    expect(landing).toMatchObject({ regionId: "row:one", index: 0 });
  });

  test("falls back to the rail when the whole region emptied", () => {
    const rows = [{ id: "row:one", y: 0, items: [] }];
    const landing = rehome(
      shell(rows),
      { regionId: "row:one", index: 2 },
      DEFAULT_RULES,
    );

    expect(landing).toMatchObject({ regionId: "rail" });
    expect(landing?.why).toContain("fell back to the rail");
  });
});
