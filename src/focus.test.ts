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

  test("takes the shortest step among lined-up candidates, then the closer centre across", () => {
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

  test("prefers an aligned control even when a diagonal one is closer", () => {
    const from = rect(0, 0, 100, 100);
    const cards = [
      from,
      rect(101, 400, 100, 100), // lined up, far below
      rect(160, 120, 100, 100), // diagonal, a much shorter step
    ];

    expect(nearest(from, cards, "down")).toBe(1);
  });

  test("with nothing aligned, takes the closest by edge distance, not the smallest gap", () => {
    const from = rect(0, 0, 100, 100);
    const cards = [
      from,
      rect(120, 300, 100, 100), // smallest sideways gap, but far away
      rect(250, 110, 100, 100), // bigger gap, but the closest edge
    ];

    expect(nearest(from, cards, "down")).toBe(2);
  });

  test("breaks a closest-distance tie by the closer centre", () => {
    const from = rect(0, 0, 100, 100);
    const cards = [
      from,
      rect(180, 160, 100, 100), // hypot(60, 80) = 100, centre 230
      rect(160, 180, 100, 100), // hypot(80, 60) = 100, centre 210
    ];

    expect(nearest(from, cards, "down")).toBe(2);
  });

  test("the stop rule keeps #51's gap-first ranking for comparison", () => {
    const from = rect(0, 0, 100, 100);
    const cards = [
      from,
      rect(120, 300, 100, 100), // the smallest sideways gap
      rect(250, 110, 100, 100), // the closest edge distance
    ];

    expect(nearest(from, cards, "down", "stop")).toBe(1);
  });

  test("the stop rule breaks a gap tie by the shorter step, then the closer centre", () => {
    const from = rect(0, 0, 100, 100);
    // Both cards sit 20px to the side; the second is much closer below.
    const steps = [from, rect(120, 300, 100, 100), rect(120, 120, 100, 100)];
    expect(nearest(from, steps, "down", "stop")).toBe(2);

    // Same gap and same step on both sides; the narrower card's centre is
    // closer to the origin's.
    const centres = [from, rect(120, 120, 100, 100), rect(-60, 120, 40, 100)];
    expect(nearest(from, centres, "down", "stop")).toBe(2);
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

/**
 * The shell above, plus the window's full-width strip at the top: the fixed
 * chrome whose one button sits at the right (#125).
 */
function withChrome(held: Layout): Layout {
  held.regions["window"] = region("window", {
    kind: "window",
    label: "Window",
    parent: "shell",
    rect: rect(0, 0, 1000, 56),
    items: [rect(940, 8, 40, 40)],
  });
  held.regions["shell"]?.children.push("window");
  return held;
}

/**
 * A mid-row card under a narrow window strip, with the rail's top item above and
 * to its left. The strip's one button is far right (≈560px) and the rail item is
 * much closer (≈45px): only the strip's own box, which spans the card, can make
 * the strip the region the search chooses. `window` is passed so a test can draw
 * the box tighter than the button.
 */
function midRowUnderStrip(window: Rect): Layout {
  const held = shell([{ id: "row:mid", y: 64, items: [rect(200, 64, 100, 100)] }]);
  const rail = held.regions["rail"];
  if (!rail) {
    throw new Error("the fixture has no rail");
  }
  rail.rect = rect(0, 0, 45, 600);
  rail.itemRects = [rect(0, 0, 45, 40)];
  held.regions["window"] = region("window", {
    kind: "window",
    label: "Window",
    parent: "shell",
    rect: window,
    items: [rect(560, 8, 40, 40)],
  });
  held.regions["shell"]?.children.push("window");
  return held;
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

  test("Right at the end of a short row crosses to the closest control in the row below", () => {
    // Continue watching has three cards; the row beneath has eight. Right at
    // the end of the short row now crosses to the next occupied card on that
    // side (#128): the fourth card of the wide row, below and to the right.
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

    expect(decision).toMatchObject({
      kind: "crossed",
      regionId: "row:wide",
      index: 3,
      landedBy: "nothing under your middle",
    });
  });

  test("edge stop keeps the short row's old anti-leak wall", () => {
    // The same layout under #51's rule: focus stops at the short row's end
    // rather than crossing diagonally into the wider row below.
    const rows = [
      { id: "row:short", y: 0, items: cards(0, 3) },
      { id: "row:wide", y: 120, items: cards(120, 8) },
    ];
    const decision = decideMove(
      shell(rows),
      { regionId: "row:short", index: 2 },
      "right",
      { ...DEFAULT_RULES, edge: "stop" },
    );

    expect(decision.kind).toBe("blocked");
    expect(decision.kind === "blocked" && decision.why).toContain("end of the row");
  });

  test("crosses into a sibling that is below and off to the side when it is closest", () => {
    // The same sibling the overlap guard used to reject is now the closest
    // control on that side, so it is entered. The wide row's box and cards are
    // both pushed right of the source control.
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

    expect(decision).toMatchObject({ kind: "crossed", regionId: "row:wide", index: 0 });
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
      landedBy: "nothing under your middle",
    });
  });

  test("a branch below and off to the side is entered when it holds the closest control below", () => {
    // The Streams branch's Back sits at the top left; the row below starts far
    // to the right. Under the settled rule the row is still the closest thing
    // below, so Down enters it; only the old overlap guard rejected it.
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

    expect(decision).toMatchObject({ kind: "crossed", regionId: "below", index: 0 });
  });

  test("edge stop keeps the branch's anti-leak wall", () => {
    // The same off-side row under #51's rule: the branch's narrow Back does
    // not widen the cross-axis guard, so Down stops.
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
      { ...DEFAULT_RULES, edge: "stop" },
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

  test("edge stop keeps the strip/dialog crossing", () => {
    // The old rule stays selectable, and its #125 reach is part of what it
    // keeps: the strip's box is the band for the dialog below, and the dialog's
    // answers still reach the strip above.
    const rules = { ...DEFAULT_RULES, edge: "stop" as const };
    const down = decideMove(
      chromeOverDialog(),
      { regionId: "window", index: 0 },
      "down",
      rules,
    );
    const up = decideMove(
      chromeOverDialog(),
      { regionId: "dialog", index: 0 },
      "up",
      rules,
    );

    expect(down).toMatchObject({
      kind: "crossed",
      regionId: "dialog",
      index: 0,
      landedBy: "the region's head — nothing in it lies under you",
    });
    expect(up).toMatchObject({ kind: "crossed", regionId: "window", index: 0 });
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

  test("enters a child that is below but off to the side when it is the closest control below", () => {
    const held = branchWithBack([
      { id: "group:aside", y: 120, x: 400, items: [rect(400, 130, 700, 90)] },
    ]);

    expect(
      decideMove(held, { regionId: "streams", index: 0 }, "down", DEFAULT_RULES),
    ).toMatchObject({ kind: "crossed", regionId: "group:aside", index: 0 });
  });

  test("edge stop still refuses a child that is below but off to the side", () => {
    const held = branchWithBack([
      { id: "group:aside", y: 120, x: 400, items: [rect(400, 130, 700, 90)] },
    ]);

    expect(
      decideMove(held, { regionId: "streams", index: 0 }, "down", {
        ...DEFAULT_RULES,
        edge: "stop",
      }),
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

  test("the repertory rail's Right enters the first content control, not the nearest", () => {
    const rail = region("rail", { kind: "rail", items: [rect(0, 200, 45, 40)] });
    const first = region("row:first", { items: [rect(100, 0, 100, 100)] });
    const nearest = region("row:nearest", { items: [rect(100, 200, 100, 100)] });
    const decision = decideMove(
      layout([rail, first, nearest]),
      { regionId: "rail", index: 0 },
      "right",
      { ...DEFAULT_RULES, railExit: "first" },
    );
    expect(decision).toMatchObject({ kind: "crossed", regionId: "row:first" });
  });

  test("the rail's left edge is a wall, not a crossing back into content", () => {
    const rows = [{ id: "row:one", y: 0, items: cards(0, 3) }];
    const decision = decideMove(shell(rows), { regionId: "rail", index: 0 }, "left", DEFAULT_RULES);
    expect(decision).toMatchObject({ kind: "blocked", direction: "left" });
  });

  test("the rail's end stops rather than wrapping", () => {
    const rows = [{ id: "row:one", y: 0, items: cards(0, 3) }];
    expect(
      decideMove(shell(rows), { regionId: "rail", index: 5 }, "down", DEFAULT_RULES),
    ).toMatchObject({ kind: "blocked" });
  });

  test("the rail's bottom stops even when content lies below it", () => {
    // The level-wide search may not turn the rail's six destinations into a
    // list that leaks into whatever content happens to be beside it.
    const rows = [{ id: "row:below", y: 600, items: cards(600, 3) }];
    const decision = decideMove(
      shell(rows),
      { regionId: "rail", index: 5 },
      "down",
      DEFAULT_RULES,
    );

    expect(decision.kind).toBe("blocked");
    expect(decision.kind === "blocked" && decision.why).toContain("end of the rail");
  });

  test("a true edge still blocks when nothing exists anywhere on that side", () => {
    const held = layout([
      region("only", {
        kind: "row",
        label: "the only row",
        items: [rect(0, 0, 100, 100), rect(120, 0, 100, 100)],
      }),
    ]);

    expect(
      decideMove(held, { regionId: "only", index: 0 }, "up", DEFAULT_RULES),
    ).toMatchObject({ kind: "blocked" });
    expect(
      decideMove(held, { regionId: "only", index: 1 }, "right", DEFAULT_RULES),
    ).toMatchObject({ kind: "blocked" });
  });

  test("Up from the top of the content crosses to the closest control above, the rail", () => {
    // The rail item above and to the left is the closest control on that side;
    // the old `upFromContent: "nothing"` wall no longer wins over it (#128).
    const rows = [{ id: "row:top", y: 120, items: cards(120, 3) }];
    const decision = decideMove(
      shell(rows),
      { regionId: "row:top", index: 0 },
      "up",
      DEFAULT_RULES,
    );

    expect(decision).toMatchObject({
      kind: "crossed",
      regionId: "rail",
      index: 0,
      landedBy: "nothing under your middle",
    });
  });

  test("Up out of the content can be handed to the rail under edge stop", () => {
    // Under #51's rule the level-wide search is off, so the rule is what sends
    // Up to the rail. The row sits below three rail items, so the landing is
    // the nearest one, not the rail's head.
    const rows = [{ id: "row:top", y: 300, items: cards(300, 3) }];
    const decision = decideMove(
      shell(rows),
      { regionId: "row:top", index: 0 },
      "up",
      { ...DEFAULT_RULES, edge: "stop", upFromContent: "rail" },
    );

    expect(decision).toMatchObject({
      kind: "crossed",
      regionId: "rail",
      index: 2,
      landedBy: "nothing under your middle",
    });
  });

  test("Up from the top row reaches the fixed chrome strip", () => {
    const held = withChrome(
      shell([{ id: "row:top", y: 64, items: cards(64, 3) }]),
    );
    const decision = decideMove(
      held,
      { regionId: "row:top", index: 2 },
      "up",
      DEFAULT_RULES,
    );

    expect(decision).toMatchObject({ kind: "crossed", regionId: "window", index: 0 });
  });

  test("the full-width strip reaches a top-row card at the far right", () => {
    // The strip's one button is at the right; a card whose right edge passes
    // it is not "below the button", but the strip as a region still spans the
    // whole window (#125). Up from that card must reach the strip.
    const held = withChrome(
      shell([{ id: "row:top", y: 64, items: [rect(900, 64, 100, 100)] }]),
    );
    const decision = decideMove(
      held,
      { regionId: "row:top", index: 0 },
      "up",
      DEFAULT_RULES,
    );

    expect(decision).toMatchObject({ kind: "crossed", regionId: "window", index: 0 });
  });

  test("the strip's box decides the region when its button is farther than the rail", () => {
    // The mid-row card is 200–300px across; the rail's top item is at 0–45px and
    // the strip's button at 560–600px. The rail item is the closer control on
    // its own (≈157px vs ≈260px), so only the strip's box, which spans the
    // card, can make the strip the region the level-wide search chooses.
    const decision = decideMove(
      midRowUnderStrip(rect(0, 0, 600, 56)),
      { regionId: "row:mid", index: 0 },
      "up",
      DEFAULT_RULES,
    );

    expect(decision).toMatchObject({ kind: "crossed", regionId: "window", index: 0 });
  });

  test("a strip box drawn tighter than its button does not claim the reach", () => {
    // The box ends at 550px, left of the button's 560px edge: it does not hold
    // the control it claims, so the search falls back to the rail item above.
    const decision = decideMove(
      midRowUnderStrip(rect(0, 0, 550, 56)),
      { regionId: "row:mid", index: 0 },
      "up",
      DEFAULT_RULES,
    );

    expect(decision).toMatchObject({ kind: "crossed", regionId: "rail", index: 0 });
  });

  test("a control below the fold is still chosen by distance", () => {
    const rows = [
      { id: "row:top", y: 64, items: cards(64, 2) },
      { id: "row:far", y: 4000, items: cards(4000, 2) },
    ];
    const decision = decideMove(
      shell(rows),
      { regionId: "row:top", index: 0 },
      "down",
      DEFAULT_RULES,
    );

    expect(decision).toMatchObject({ kind: "crossed", regionId: "row:far", index: 0 });
  });

  test("in a wrapped grid with a hole, the next occupied control on that side is chosen", () => {
    const grid = region("grid", {
      kind: "row",
      label: "the grid",
      rect: rect(0, 0, 400, 200),
      items: [
        rect(0, 0, 100, 100),
        rect(110, 0, 100, 100),
        // The hole is where a third card at (220, 0) would sit.
        rect(0, 110, 100, 100),
        rect(110, 110, 100, 100),
        rect(220, 110, 100, 100),
      ],
    });

    const decision = decideMove(
      layout([grid]),
      { regionId: "grid", index: 1 },
      "right",
      DEFAULT_RULES,
    );

    expect(decision).toMatchObject({ kind: "moved", regionId: "grid", index: 4 });
  });

  test("Up from a branch's child lands on the branch's own control above it", () => {
    // The Title's Back is in the branch that holds the season row. The
    // level-wide search finds it, and the landing is direct: `land` must not
    // descend back into the row the person is leaving.
    const held = branchWithBack([
      { id: "group:one", y: 120, items: [rect(40, 130, 1000, 90)] },
    ]);

    const decision = decideMove(
      held,
      { regionId: "group:one", index: 0 },
      "up",
      DEFAULT_RULES,
    );

    expect(decision).toMatchObject({ kind: "crossed", regionId: "streams", index: 0 });
  });

  test("a non-ancestor branch's own control is a direct landing too", () => {
    // The level-wide search can reach any branch's Back, not only one that
    // holds the focused region. `land` would descend into that branch's child
    // instead of returning the control the search actually chose.
    const held = branchWithBack([
      { id: "group:one", y: 120, items: [rect(40, 130, 1000, 90)] },
    ]);
    held.regions["other"] = region("other", {
      kind: "branch",
      label: "the other branch",
      parent: "level",
      rect: rect(600, 24, 500, 300),
      items: [rect(700, 40, 120, 44)],
      children: ["other:row"],
    });
    held.regions["other:row"] = region("other:row", {
      kind: "row",
      label: "the other row",
      parent: "other",
      rect: rect(600, 200, 500, 80),
      items: [rect(600, 210, 500, 60)],
    });
    held.regions["level"]?.children.push("other");

    const decision = decideMove(
      held,
      { regionId: "group:one", index: 0 },
      "up",
      DEFAULT_RULES,
    );

    expect(decision).toMatchObject({ kind: "crossed", regionId: "other", index: 0 });
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
