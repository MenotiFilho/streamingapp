/**
 * The pure spatial-focus model.
 *
 * It is geometry in, a decision out: no DOM, no events, no React. The page
 * around it measures rectangles and paints focus; it never decides where focus
 * goes. The model is the one the `prototype/spatial-focus-51` artifact locked
 * (#51), lifted here so it can be tested rather than felt:
 *
 * - inside a region, movement is by geometry — lined-up candidates first, then
 *   the smallest sideways gap, the shortest step past `MIN_STEP`, and the
 *   closest centre across;
 * - between regions, focus crosses only to a sibling strictly in the direction
 *   that overlaps the origin on the cross axis (`gap <= ALIGNED`), so a short
 *   row cannot leak diagonally into a wider one below;
 * - entering a region lands on the item under the origin's middle, or the
 *   region's head when the origin is wider than the whole target;
 * - every edge stops: no wrap at a row's or the rail's end, and Up off the top
 *   of the content goes nowhere;
 * - a control that disappears steps focus back to the control before the gap,
 *   or falls back to the rail when the region emptied.
 *
 * The switches the prototype exhibited are kept as `Rules`, but the shell
 * always uses `DEFAULT_RULES`: the alternatives are there to be felt, never
 * switched on.
 */

/** Pixels a rect must clear the origin by to count as being "that way". */
export const MIN_STEP = 1;

/** Pixels two sideways gaps may differ by and still count as lined up. */
export const ALIGNED = 1;

/** A rectangle in the page's own coordinates. */
export type Rect = { x: number; y: number; w: number; h: number };

/** Which of the four directions a person asked for. */
export type Direction = "up" | "down" | "left" | "right";

/** Which kind of region this is; only a rail and a row have walls of their own. */
export type RegionKind = "rail" | "row" | "branch";

/** One region of a level: the rail, a row, or a branch that holds others. */
export type Region = {
  id: string;
  label: string;
  kind: RegionKind;
  /** The containing region, or null at the level's root. */
  parent: string | null;
  children: string[];
  rect: Rect;
  /** The focusable controls inside it, in DOM order. */
  itemRects: Rect[];
};

/** A level's regions, and where each region was last left. */
export type Layout = {
  regions: Record<string, Region>;
  memory: Record<string, number | undefined>;
};

/** Where focus is: a region and one of its controls. */
export type Focus = { regionId: string; index: number };

/**
 * The switches the prototype let a person feel. The shell uses
 * `DEFAULT_RULES`; the alternatives exist so a later screen never has to guess
 * what was rejected.
 */
export type Rules = {
  rowEnd: "stop" | "wrap";
  railEnd: "stop" | "wrap";
  upFromContent: "nothing" | "rail";
  entry: "align" | "remember";
  gone: "previous" | "place" | "head";
};

/** The locked answers, as #51 settled them. */
export const DEFAULT_RULES: Rules = {
  rowEnd: "stop",
  railEnd: "stop",
  upFromContent: "nothing",
  entry: "align",
  gone: "previous",
};

/** Where a movement landed, and enough of the decision to say why. */
export type MoveDecision =
  | {
      kind: "moved" | "crossed" | "wrapped";
      direction: Direction;
      regionId: string;
      index: number;
      why: string;
      landedBy?: string;
    }
  | { kind: "blocked"; direction: Direction; why: string };

/** Where focus goes when the control it was on disappears. */
export type Landing = { regionId: string; index: number; why: string };

/** Whether a direction moves on the y axis. */
export function isVertical(direction: Direction): boolean {
  return direction === "up" || direction === "down";
}

/**
 * How far past the origin's leading edge a rect begins, along the direction.
 * Negative when they overlap on that axis, or the rect is behind.
 */
export function step(from: Rect, to: Rect, direction: Direction): number {
  switch (direction) {
    case "down":
      return to.y - (from.y + from.h);
    case "up":
      return from.y - (to.y + to.h);
    case "right":
      return to.x - (from.x + from.w);
    default:
      return from.x - (to.x + to.w);
  }
}

/**
 * The gap between two rects on the axis across the direction: zero when they
 * overlap, so "the card below" beats "the card below and off to the side".
 */
export function gap(from: Rect, to: Rect, direction: Direction): number {
  if (isVertical(direction)) {
    return Math.max(Math.max(from.x, to.x) - Math.min(from.x + from.w, to.x + to.w), 0);
  }
  return Math.max(Math.max(from.y, to.y) - Math.min(from.y + from.h, to.y + to.h), 0);
}

/**
 * Centre-to-centre distance on the axis across the direction: the last
 * tie-break, so Down from a full-width hero lands on the card nearest its
 * middle rather than whichever card happens to be first.
 */
export function across(from: Rect, to: Rect, direction: Direction): number {
  if (isVertical(direction)) {
    return Math.abs(from.x + from.w / 2 - (to.x + to.w / 2));
  }
  return Math.abs(from.y + from.h / 2 - (to.y + to.h / 2));
}

/**
 * The nearest rect in `direction`, or -1 when nothing is that way.
 *
 * The candidates are ordered by the locked model: a smaller sideways gap wins
 * only by more than `ALIGNED`; inside that band the shorter step wins, and
 * then the closer centre.
 */
export function nearest(from: Rect, rects: readonly Rect[], direction: Direction): number {
  let best = -1;
  let bestGap = 0;
  let bestStep = 0;
  let bestAcross = 0;

  for (let index = 0; index < rects.length; index += 1) {
    const to = rects[index];
    if (!to) {
      continue;
    }
    const ahead = step(from, to, direction);
    if (ahead <= MIN_STEP) {
      continue;
    }
    const sideways = gap(from, to, direction);
    const acrossBy = across(from, to, direction);
    const linedUp = Math.abs(sideways - bestGap) <= ALIGNED;
    const better =
      best === -1 ||
      sideways < bestGap - ALIGNED ||
      (linedUp && ahead < bestStep - ALIGNED) ||
      (linedUp && Math.abs(ahead - bestStep) <= ALIGNED && acrossBy < bestAcross);
    if (better) {
      best = index;
      bestGap = sideways;
      bestStep = ahead;
      bestAcross = acrossBy;
    }
  }

  return best;
}

/**
 * A sibling region we may cross into this way: strictly in the direction, and
 * overlapping where we are on the other axis. The overlap test is the whole
 * guard against a short row leaking focus diagonally into the row below.
 */
function siblingInDirection(
  regions: Record<string, Region>,
  region: Region,
  from: Rect,
  direction: Direction,
): Region | null {
  const parent = region.parent ? regions[region.parent] : undefined;
  if (!parent) {
    return null;
  }

  let best: Region | null = null;
  let bestStep = 0;
  for (const id of parent.children) {
    const sibling = regions[id];
    if (!sibling || sibling.id === region.id) {
      continue;
    }
    const ahead = step(from, sibling.rect, direction);
    if (ahead <= MIN_STEP) {
      continue;
    }
    if (gap(from, sibling.rect, direction) > ALIGNED) {
      continue;
    }
    if (!best || ahead < bestStep) {
      best = sibling;
      bestStep = ahead;
    }
  }

  return best;
}

/** A remembered index clamped to the controls a region actually has. */
export function clampIndex(index: number, length: number): number {
  if (length <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(index, length - 1));
}

/** The extent of a rect across the direction: x for a vertical move, y for a horizontal one. */
function crossExtent(rect: Rect, direction: Direction): { lo: number; hi: number } {
  if (isVertical(direction)) {
    return { lo: rect.x, hi: rect.x + rect.w };
  }
  return { lo: rect.y, hi: rect.y + rect.h };
}

/**
 * A thing wider than everything the target region holds has no middle worth
 * aiming at: Down from the hero gets the row's head, not its last card.
 */
function widerThan(from: Rect, rects: readonly Rect[], direction: Direction): boolean {
  const origin = crossExtent(from, direction);
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const rect of rects) {
    const extent = crossExtent(rect, direction);
    if (extent.lo < lo) {
      lo = extent.lo;
    }
    if (extent.hi > hi) {
      hi = extent.hi;
    }
  }
  return origin.hi - origin.lo > hi - lo + ALIGNED;
}

/**
 * The rect whose span covers the middle of `from`, if one does: the card you
 * are actually standing over, rather than the nearest one by arithmetic.
 */
function covering(from: Rect, rects: readonly Rect[], direction: Direction): number {
  const origin = crossExtent(from, direction);
  const middle = (origin.lo + origin.hi) / 2;
  let best = -1;
  let bestStep = 0;

  for (let index = 0; index < rects.length; index += 1) {
    const rect = rects[index];
    if (!rect) {
      continue;
    }
    const extent = crossExtent(rect, direction);
    if (middle < extent.lo || middle > extent.hi) {
      continue;
    }
    const ahead = step(from, rect, direction);
    if (ahead <= MIN_STEP) {
      continue;
    }
    if (best < 0 || ahead < bestStep) {
      best = index;
      bestStep = ahead;
    }
  }

  return best;
}

const LANDED = {
  aligned: "the card under your middle",
  nearest: "the nearest card — nothing lined up",
  head: "the region's head — what you came from is wider than the whole region",
  memory: "the region's memory",
} as const;

type LandingKind = keyof typeof LANDED;

/**
 * Where focus lands arriving in a leaf region: the item under the middle of
 * where it came from, else the nearest, unless the rules say to trust the
 * region's memory first.
 */
function enter(
  layout: Layout,
  region: Region,
  from: Rect,
  direction: Direction,
  rules: Rules,
): { index: number; how: LandingKind } {
  const remembered = layout.memory[region.id];
  if (rules.entry === "remember" && remembered !== undefined) {
    return { index: clampIndex(remembered, region.itemRects.length), how: "memory" };
  }
  if (region.itemRects.length === 0) {
    return { index: 0, how: "head" };
  }
  if (widerThan(from, region.itemRects, direction)) {
    return { index: 0, how: "head" };
  }
  const under = covering(from, region.itemRects, direction);
  if (under >= 0) {
    return { index: under, how: "aligned" };
  }
  const lined = nearest(from, region.itemRects, direction);
  if (lined >= 0) {
    return { index: lined, how: "nearest" };
  }
  if (remembered !== undefined) {
    return { index: clampIndex(remembered, region.itemRects.length), how: "memory" };
  }
  return { index: 0, how: "head" };
}

/**
 * Arriving in a region; if it is a branch (the screen), walk down to the child
 * region that lines up first.
 */
function land(
  layout: Layout,
  region: Region,
  from: Rect,
  direction: Direction,
  rules: Rules,
): { regionId: string; index: number; how: LandingKind } {
  if (region.children.length === 0) {
    const landing = enter(layout, region, from, direction, rules);
    return { regionId: region.id, index: landing.index, how: landing.how };
  }

  const children = region.children
    .map((id) => layout.regions[id])
    .filter((child): child is Region => child !== undefined);
  const pick = nearest(
    from,
    children.map((child) => child.rect),
    direction,
  );
  const child = children[pick >= 0 ? pick : 0];
  return child
    ? land(layout, child, from, direction, rules)
    : { regionId: region.id, index: 0, how: "head" };
}

function findRail(layout: Layout): Region | null {
  for (const region of Object.values(layout.regions)) {
    if (region.kind === "rail" && region.itemRects.length > 0) {
      return region;
    }
  }
  return null;
}

/**
 * One intent, one answer.
 *
 * `layout` is what the page measured, `focus` is where its people are, and
 * `rules` are the locked answers. The decision never mutates either.
 */
export function decideMove(
  layout: Layout,
  focus: Focus,
  direction: Direction,
  rules: Rules = DEFAULT_RULES,
): MoveDecision {
  const region = layout.regions[focus.regionId];
  if (!region || region.itemRects.length === 0) {
    return { kind: "blocked", direction, why: "the focused region is gone or has nothing in it" };
  }

  const from = region.itemRects[focus.index] ?? region.itemRects[0];
  if (!from) {
    return { kind: "blocked", direction, why: "the focused region has nothing in it" };
  }

  // 1. Inside the region, by geometry alone.
  const inside = nearest(from, region.itemRects, direction);
  if (inside >= 0) {
    return {
      kind: "moved",
      direction,
      regionId: region.id,
      index: inside,
      why: `the nearest control ${direction} inside ${region.label}`,
    };
  }

  // 2. Out to a sibling, if one overlaps us across the way.
  let node = region;
  while (node.parent) {
    const sibling = siblingInDirection(layout.regions, node, from, direction);
    if (sibling) {
      const target = land(layout, sibling, from, direction, rules);
      return {
        kind: "crossed",
        direction,
        regionId: target.regionId,
        index: target.index,
        landedBy: LANDED[target.how],
        why: `nothing ${direction} inside ${node.label}, so focus crossed into ${sibling.label}`,
      };
    }
    const parent = layout.regions[node.parent];
    if (!parent) {
      break;
    }
    node = parent;
  }

  // 3. The end of a list: a wall, or the wrap the rules ask for.
  if (region.kind === "rail" && isVertical(direction)) {
    if (rules.railEnd === "wrap") {
      return {
        kind: "wrapped",
        direction,
        regionId: region.id,
        index: direction === "down" ? 0 : region.itemRects.length - 1,
        why: "the end of the rail, and the rail rule says wrap to the other end",
      };
    }
    return {
      kind: "blocked",
      direction,
      why: "the end of the rail, and the rail rule says stop",
    };
  }

  if (region.kind === "row" && !isVertical(direction)) {
    if (rules.rowEnd === "wrap") {
      return {
        kind: "wrapped",
        direction,
        regionId: region.id,
        index: direction === "right" ? 0 : region.itemRects.length - 1,
        why: "the end of the row, and the row rule says wrap to the other end",
      };
    }
    return {
      kind: "blocked",
      direction,
      why: "the end of the row, and the row rule says stop — it does not fall into the row below",
    };
  }

  // 4. The one wall a rule can fill: up out of the content, to the rail.
  if (direction === "up" && rules.upFromContent === "rail") {
    const rail = findRail(layout);
    if (rail) {
      const landing = enter(layout, rail, from, "up", rules);
      return {
        kind: "crossed",
        direction,
        regionId: rail.id,
        index: landing.index,
        landedBy: LANDED[landing.how],
        why: "the top of the content, and the rule says up goes to the rail",
      };
    }
  }

  return {
    kind: "blocked",
    direction,
    why:
      direction === "up"
        ? "nothing above, and no rule sends Up anywhere"
        : "nothing that way, and no rule sends focus anywhere",
  };
}

/**
 * A control is gone. The rules pick between stepping back, keeping the place
 * and starting over; and if the whole region went with it, focus falls back to
 * the rail.
 */
export function rehome(
  layout: Layout,
  focus: Focus,
  rules: Rules = DEFAULT_RULES,
): Landing | null {
  const region = layout.regions[focus.regionId];
  if (region && region.itemRects.length > 0) {
    if (rules.gone === "head") {
      return {
        regionId: region.id,
        index: 0,
        why: "the control went away, and the rule says the region's head",
      };
    }
    if (rules.gone === "previous") {
      return {
        regionId: region.id,
        index: clampIndex(focus.index - 1, region.itemRects.length),
        why: "the control went away; focus stepped back to the control before the gap",
      };
    }
    return {
      regionId: region.id,
      index: clampIndex(focus.index, region.itemRects.length),
      why: "the control went away; focus stayed in place and the next control slid into it",
    };
  }

  const rail = findRail(layout);
  if (rail) {
    const remembered = layout.memory[rail.id];
    return {
      regionId: rail.id,
      index: clampIndex(remembered ?? 0, rail.itemRects.length),
      why: "the whole region went away, so focus fell back to the rail",
    };
  }

  return null;
}
