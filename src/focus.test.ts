import { describe, expect, test } from "vitest";

import {
  DEFAULT_RULES,
  decideMove,
  nearest,
  rehome,
  type Layout,
  type Rect,
  type Region,
  type RegionKind,
} from "./focus";

const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

function region(
  id: string,
  options: {
    kind?: RegionKind;
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

/**
 * A confirm dialog under the window's chrome: the strip spans the level with
 * its one button at the right, the panel and its answers sit centred below it
 * (#125). The button is nowhere near the answers, which is the point.
 */
function chromeOverDialog(): Layout {
  return layout([
    region("level", {
      kind: "branch",
      label: "the level",
      rect: rect(0, 0, 1200, 900),
      children: ["dialog", "window"],
    }),
    region("dialog", {
      kind: "dialog",
      label: "Remove Example?",
      parent: "level",
      rect: rect(344, 260, 512, 240),
      items: [rect(420, 400, 120, 44), rect(560, 400, 120, 44)],
    }),
    region("window", {
      kind: "window",
      label: "Window",
      parent: "level",
      rect: rect(0, 0, 1200, 56),
      items: [rect(1140, 8, 40, 40)],
    }),
  ]);
}

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

  test("does not cross into a sibling that is below and off to the side", () => {
    // The overlap guard is what makes the rule above hold: a region that is
    // strictly to the right and below, but does not overlap us across the way,
    // is not a sibling to cross into. Without the guard this test would land
    // in the wide row's first card.
    const rows = [
      { id: "row:short", y: 0, items: cards(0, 3) },
      { id: "row:wide", y: 120, items: cards(120, 8) },
    ];
    const held = shell(rows);
    const wide = held.regions["row:wide"];
    if (!wide) {
      throw new Error("the fixture has no wide row");
    }
    wide.rect = rect(1200, 120, 800, 100);
    wide.itemRects = cards(120, 8).map((card) => ({ ...card, x: card.x + 1080 }));

    const decision = decideMove(
      held,
      { regionId: "row:short", index: 2 },
      "right",
      DEFAULT_RULES,
    );

    expect(decision.kind).toBe("blocked");
  });

  test("a normal row with nothing under the origin keeps the nearest landing, not the head", () => {
    // The dialog's safe-head landing is scoped to dialogs (#125). A row with no
    // item under the control keeps the locked geometry: Down from a card at the
    // right edge lands on the nearest card, not on the row's first.
    const rows = [
      { id: "row:top", y: 0, items: [rect(900, 0, 100, 100)] },
      { id: "row:bottom", y: 120, items: cards(120, 3) },
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
      index: 2,
      landedBy: "the nearest card — nothing lined up",
    });
  });

  test("a wide branch does not widen the anti-leak guard with its own box", () => {
    // The Streams branch's box is wide enough to hold the target row, but the
    // move starts on its narrow Back control at the top left. Only the window
    // kind may speak for its full width; a branch's box must not turn an
    // off-axis sibling into a landing (#51).
    const held = branchWithBack([]);
    held.regions["below"] = region("below", {
      kind: "row",
      label: "the row below",
      parent: "level",
      rect: rect(400, 400, 700, 120),
      items: [rect(400, 410, 700, 90)],
    });
    held.regions["level"]?.children.push("below");

    const decision = decideMove(
      held,
      { regionId: "streams", index: 0 },
      "down",
      DEFAULT_RULES,
    );

    expect(decision.kind).toBe("blocked");
  });

  test("crosses from the full-width strip into the dialog under it, at its head", () => {
    // The strip's button is at the right, the dialog is centred: the button is
    // over neither answer, so the nearest would be the confirming one. Only the
    // window kind gets the full-width band, and only the dialog kind turns
    // "nothing under you" into its head, the safe answer (#125).
    const decision = decideMove(
      chromeOverDialog(),
      { regionId: "window", index: 0 },
      "down",
      DEFAULT_RULES,
    );

    expect(decision).toMatchObject({
      kind: "crossed",
      regionId: "dialog",
      index: 0,
      landedBy: "the region's head — nothing in it lies under you",
    });
  });

  test("crosses back up from the dialog's first answer to the strip", () => {
    const decision = decideMove(
      chromeOverDialog(),
      { regionId: "dialog", index: 0 },
      "up",
      DEFAULT_RULES,
    );

    expect(decision).toMatchObject({ kind: "crossed", regionId: "window", index: 0 });
  });
});

/**
 * A pushed level shaped like Streams or a series' Title: a branch with its own
 * Back control above the child rows it leads to.
 */
function branchWithBack(
  rows: Array<{ id: string; y: number; x?: number; items: Rect[] }>,
): Layout {
  return layout([
    region("level", {
      kind: "branch",
      label: "the level",
      rect: rect(0, 0, 1200, 900),
      children: ["streams"],
    }),
    region("streams", {
      kind: "branch",
      label: "the Streams level",
      parent: "level",
      rect: rect(24, 24, 1150, 850),
      items: [rect(40, 40, 120, 44)],
      children: rows.map((row) => row.id),
    }),
    ...rows.map((row) =>
      region(row.id, {
        kind: "row",
        parent: "streams",
        rect: rect(row.x ?? 40, row.y, 1000, 120),
        items: row.items,
      }),
    ),
  ]);
}

describe("descending into a branch's own children", () => {
  test("Down from Back lands on the first child's first control", () => {
    const held = branchWithBack([
      { id: "group:one", y: 120, items: [rect(40, 130, 1000, 90)] },
      { id: "group:two", y: 360, items: [rect(40, 370, 1000, 90)] },
    ]);

    const decision = decideMove(
      held,
      { regionId: "streams", index: 0 },
      "down",
      DEFAULT_RULES,
    );

    expect(decision).toMatchObject({
      kind: "crossed",
      regionId: "group:one",
      index: 0,
      landedBy: "the card under your middle",
    });
  });

  test("does not enter a child that is below but off to the side", () => {
    const held = branchWithBack([
      { id: "group:aside", y: 120, x: 400, items: [rect(400, 130, 700, 90)] },
    ]);

    expect(
      decideMove(held, { regionId: "streams", index: 0 }, "down", DEFAULT_RULES),
    ).toMatchObject({ kind: "blocked" });
  });

  test("moves inside the branch before descending", () => {
    const held = branchWithBack([
      { id: "group:one", y: 200, items: [rect(40, 210, 1000, 90)] },
    ]);
    held.regions["streams"]?.itemRects.push(rect(40, 100, 120, 44));

    const decision = decideMove(
      held,
      { regionId: "streams", index: 0 },
      "down",
      DEFAULT_RULES,
    );

    expect(decision).toMatchObject({ kind: "moved", regionId: "streams", index: 1 });
  });

  test("descends before crossing to a sibling of the branch", () => {
    const held = branchWithBack([
      { id: "group:one", y: 120, items: [rect(40, 130, 1000, 90)] },
    ]);
    held.regions["below"] = region("below", {
      kind: "row",
      label: "the row below",
      parent: "level",
      rect: rect(40, 400, 1000, 120),
      items: [rect(40, 410, 1000, 90)],
    });
    held.regions["level"]?.children.push("below");

    const decision = decideMove(
      held,
      { regionId: "streams", index: 0 },
      "down",
      DEFAULT_RULES,
    );

    expect(decision).toMatchObject({ kind: "crossed", regionId: "group:one", index: 0 });
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
    // The row sits below three rail items, so the rail's nearest item is not
    // its head: the rule hands Up to the rail, and the landing is nearest.
    const rows = [{ id: "row:top", y: 300, items: cards(300, 3) }];
    const decision = decideMove(
      shell(rows),
      { regionId: "row:top", index: 0 },
      "up",
      { ...DEFAULT_RULES, upFromContent: "rail" },
    );

    expect(decision).toMatchObject({
      kind: "crossed",
      regionId: "rail",
      index: 2,
      landedBy: "the nearest card — nothing lined up",
    });
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
