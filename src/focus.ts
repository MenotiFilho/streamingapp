/**
 * The pure spatial-focus model.
 *
 * It is geometry in, a decision out: no DOM, no events, no React. The page
 * around it measures rectangles and paints focus; it never decides where focus
 * goes. The model is the one the `prototype/spatial-focus-51` artifact locked
 * (#51), lifted here so it can be tested rather than felt:
 *
 * - inside a region, movement is direct-first: a control lined up with the
 *   origin (`gap <= ALIGNED`) wins, and the shortest step wins among those.
 *   Only when nothing is lined up does the closest control win, measured by
 *   `hypot(step, gap)`, with the closer centre across as the tie-break. This is
 *   the settled `edge: "nearest"` rule (#128); `edge: "stop"` keeps #51's
 *   gap-first ranking beside it for comparison;
 * - a region's own controls lead into its children: when nothing inside the
 *   region lies that way, a child that is strictly in the direction and
 *   overlaps the origin on the cross axis is entered before any sibling is
 *   considered — a branch's Back sits above the rows it leads to;
 * - when the focused region has nothing at all on that side, focus crosses to
 *   the closest control anywhere in the same active level, choosing that
 *   control's region and landing there by the covering/head rules. That
 *   reverses #51's anti-leak walls: a short row can now cross into a wider one
 *   below, and a sibling or child can be entered off to the side when it holds
 *   the closest control. The window's full-width strip adds its own box to that
 *   search beside its one control, so Up from any top-row card still reaches it;
 *   the dialog's safe-head landing still applies. The rail's vertical ends stay
 *   walls, and a row's end stops only when no control exists on that side
 *   (#128, ADR-0025);
 * - `edge: "stop"` keeps the old crossing guard: only a sibling overlapping the
 *   band the control sits in on the cross axis (`gap <= ALIGNED`) is entered,
 *   with no level-wide fallback, so the same layout can be compared against
 *   #51. The window's strip is the one kind allowed to speak for its full width
 *   in that sibling step, which is what reaches the dialog centred under its
 *   one button at the right;
 * - entering a region lands on the item under the origin's middle, the
 *   region's head when what came from is wider than the whole target, and
 *   otherwise the nearest — except a dialog with nothing under the origin,
 *   which lands on its head (the safe answer) rather than whichever answer is
 *   nearest;
 * - a control that disappears steps focus back to the control before the gap,
 *   or falls back to the rail when the region emptied.
 *
 * The switches the prototype exhibited are kept as `Rules`, beside the edge
 * rule #128 added; the shell always uses `DEFAULT_RULES`, and the alternatives
 * are there to be felt, never switched on.
 */

/** Pixels a rect must clear the origin by to count as being "that way". */
export const MIN_STEP = 1;

/** Pixels two sideways gaps may differ by and still count as lined up. */
export const ALIGNED = 1;

/** A rectangle in the page's own coordinates. */
export type Rect = { x: number; y: number; w: number; h: number };

/** Which of the four directions a person asked for. */
export type Direction = "up" | "down" | "left" | "right";

/**
 * Which kind of region this is. Only a rail and a row have walls of their own;
 * a window is the strip that carries the window's control, and a dialog is the
 * panel that asks a question. Those two kinds carry the scoped crossing rules:
 * only the strip's full-width box speaks for the cross-axis guard, and only a
 * dialog gets the safe-head landing when nothing in it lies under the origin.
 */
export type RegionKind = "rail" | "row" | "branch" | "window" | "dialog";

/**
 * One region of a level: the rail, a row, a branch that holds others, the
 * window's strip, or a dialog panel.
 *
 * A branch may hold focusable controls of its own as well as children — the
 * Streams level's Back sits above its Addon groups, and a Title's Back above
 * its seasons — and those controls lead into the children: a move that finds
 * nothing inside the branch and one of the branch's own children in the
 * direction enters that child before any sibling is tried.
 */
export type Region = {
  id: string;
  label: string;
  kind: RegionKind;
  /** The containing region, or null at the level's root. */
  parent: string | null;
  /** The child regions, in DOM order. */
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
 * The switches the prototype let a person feel, plus the edge rule #128 added.
 * The shell uses `DEFAULT_RULES`; the alternatives exist so a later screen
 * never has to guess what was rejected.
 */
export type Rules = {
  rowEnd: "stop" | "wrap";
  railEnd: "stop" | "wrap";
  /**
   * What Right does from the rail. `nearest` is the geometric rule the rest of
   * the level uses; `first` enters the first control in the content, in DOM
   * order, which is the programme's first card rather than whichever row
   * action happens to sit nearest the spine's item.
   */
  railExit: "nearest" | "first";
  upFromContent: "nothing" | "rail";
  entry: "align" | "remember";
  gone: "previous" | "place" | "head";
  /**
   * How a move ranks the controls on the side it is going. `nearest` is the
   * settled rule (#128): direct-first, then the closest by edge distance.
   * `stop` keeps #51's gap-first ranking and its overlap-guarded crossing, so
   * the two models can be compared without a second implementation.
   */
  edge: "stop" | "nearest";
};

/** The locked answers, as #51 settled them and #128 amended the edge. */
export const DEFAULT_RULES: Rules = {
  rowEnd: "stop",
  railEnd: "stop",
  railExit: "nearest",
  upFromContent: "nothing",
  entry: "align",
  gone: "previous",
  edge: "nearest",
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
 * `nearest` is direct-first: a control lined up with the origin
 * (`gap <= ALIGNED`) wins outright, and the shortest step wins among those.
 * Only when nothing is lined up does the closest by edge distance —
 * `hypot(step, gap)` — win, with the closer centre across as the tie-break.
 * That is what lets a move cross a hole to the next occupied control instead of
 * giving up on the smallest gap (#128).
 *
 * `stop` keeps #51's ranking — the smallest sideways gap first, then the
 * shortest step inside the aligned band, then the closer centre — so the old
 * walls can be felt beside the new rule.
 */
export function nearest(
  from: Rect,
  rects: readonly Rect[],
  direction: Direction,
  edge: Rules["edge"] = "nearest",
): number {
  return edge === "stop"
    ? nearestByGap(from, rects, direction)
    : nearestDirect(from, rects, direction);
}

/** #51's ranking: the smallest sideways gap first, then step, then centre. */
function nearestByGap(from: Rect, rects: readonly Rect[], direction: Direction): number {
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

/** The settled ranking: a lined-up control first, else the closest by distance. */
function nearestDirect(from: Rect, rects: readonly Rect[], direction: Direction): number {
  let aligned = -1;
  let alignedStep = 0;
  let alignedAcross = 0;
  let closest = -1;
  let closestDistance = 0;
  let closestAcross = 0;

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

    if (sideways <= ALIGNED) {
      const better =
        aligned === -1 ||
        ahead < alignedStep - ALIGNED ||
        (Math.abs(ahead - alignedStep) <= ALIGNED && acrossBy < alignedAcross);
      if (better) {
        aligned = index;
        alignedStep = ahead;
        alignedAcross = acrossBy;
      }
      continue;
    }

    const distance = Math.hypot(ahead, sideways);
    const better =
      closest === -1 ||
      distance < closestDistance - ALIGNED ||
      (Math.abs(distance - closestDistance) <= ALIGNED && acrossBy < closestAcross);
    if (better) {
      closest = index;
      closestDistance = distance;
      closestAcross = acrossBy;
    }
  }

  return aligned >= 0 ? aligned : closest;
}

/**
 * The nearest region among `ids` that lies strictly in the direction and
 * overlaps `band` on the other axis: the guard both a crossing to a sibling and
 * a descent into a child use, so a short row cannot leak diagonally into a
 * wider one and a child off to the side is not entered. The step is always
 * taken from the focused control; `band` says which line across it counts, and
 * defaults to the control itself.
 */
function overlappingInDirection(
  regions: Record<string, Region>,
  ids: readonly string[],
  from: Rect,
  direction: Direction,
  band: Rect = from,
): Region | null {
  let best: Region | null = null;
  let bestStep = 0;
  for (const id of ids) {
    const candidate = regions[id];
    if (!candidate) {
      continue;
    }
    const ahead = step(from, candidate.rect, direction);
    if (ahead <= MIN_STEP) {
      continue;
    }
    if (gap(band, candidate.rect, direction) > ALIGNED) {
      continue;
    }
    if (!best || ahead < bestStep) {
      best = candidate;
      bestStep = ahead;
    }
  }

  return best;
}

/**
 * Whether `box` has real area and holds every control in `rects`: the guard the
 * window strip's box must pass before it may speak for the region. A box drawn
 * tighter than its controls, or measured as nothing, claims no reach it did not
 * draw.
 */
function holdsControls(box: Rect, rects: readonly Rect[]): boolean {
  return (
    box.w > 0 &&
    box.h > 0 &&
    rects.every(
      (rect) =>
        box.x <= rect.x &&
        box.y <= rect.y &&
        box.x + box.w >= rect.x + rect.w &&
        box.y + box.h >= rect.y + rect.h,
    )
  );
}

/**
 * The line a control in the window's strip sits in: that strip's own full-width
 * box, when the box really holds the control. Only the window kind may widen
 * the cross-axis guard this way — its one button at the right must still reach
 * a dialog centred below (#125). A row or branch never gets this, so a wide
 * box cannot leak into a sibling that is off to the side of the control, which
 * is the anti-leak guard #51 locked, and `edge: "stop"` keeps it. A strip with
 * no box (an unmeasured page), or a measured box drawn tighter than the control,
 * leaves the control as its own line instead of claiming a band it never drew.
 */
function windowBand(region: Region, from: Rect): Rect {
  if (region.kind !== "window") {
    return from;
  }
  const box = region.rect;
  return holdsControls(box, [from]) ? box : from;
}

/**
 * The strip's box when it really holds the controls it claims, or null. The
 * level-wide search may speak for the strip by this box; a window region drawn
 * tighter than its controls (or measured as nothing) does not get that reach.
 */
function windowBox(region: Region): Rect | null {
  if (region.kind !== "window" || region.itemRects.length === 0) {
    return null;
  }
  const box = region.rect;
  return holdsControls(box, region.itemRects) ? box : null;
}

/**
 * A sibling region we may cross into this way under `edge: "stop"`: the old
 * overlap guard.
 *
 * The direction is the control's: the move starts where its focus is. The
 * alignment is the band's: for the window's strip that is the strip itself, the
 * line a person is on, and a full-width strip reaches the dialog centred under
 * it even though the strip's one button at the right does not (#125). Every
 * other kind is guarded by the control alone, so a wide row or branch cannot
 * widen the wall this guard exists for. `edge: "nearest"` does not use this
 * step; it searches the whole active level instead.
 */
function siblingInDirection(
  regions: Record<string, Region>,
  region: Region,
  from: Rect,
  direction: Direction,
  band: Rect,
): Region | null {
  const parent = region.parent ? regions[region.parent] : undefined;
  if (!parent) {
    return null;
  }

  return overlappingInDirection(
    regions,
    parent.children.filter((id) => id !== region.id),
    from,
    direction,
    band,
  );
}

/** One of the region's own children we may descend into this way. */
function childInDirection(
  regions: Record<string, Region>,
  region: Region,
  from: Rect,
  direction: Direction,
): Region | null {
  return overlappingInDirection(regions, region.children, from, direction);
}

/** One control in the active level: where it lives and which of its region's controls it is. */
type LevelTarget = { region: Region; index: number };

/** A candidate in the level-wide search: a control, or the strip's box standing for it. */
type LevelCandidate = LevelTarget & { rect: Rect };

/** The root of the tree a region belongs to: the level's own region. */
function levelRoot(regions: Record<string, Region>, region: Region): Region {
  let node = region;
  const seen = new Set<string>();
  while (node.parent && !seen.has(node.id)) {
    seen.add(node.id);
    const parent = regions[node.parent];
    if (!parent) {
      break;
    }
    node = parent;
  }
  return node;
}

/**
 * The closest control anywhere in the focused region's active level, outside
 * the focused region itself. This is the cross-region half of `edge: "nearest"`
 * (#128): one level-wide search, direct-first then closest, finds the control
 * on that side even when it sits in a region the old overlap guard did not
 * reach — an off-side child or sibling — rather than stopping at the region's
 * wall.
 */
function controlInLevel(
  layout: Layout,
  focused: Region,
  from: Rect,
  direction: Direction,
): LevelTarget | null {
  const regions: Region[] = [];
  const visit = (region: Region) => {
    regions.push(region);
    for (const id of region.children) {
      const child = layout.regions[id];
      if (child) {
        visit(child);
      }
    }
  };
  visit(levelRoot(layout.regions, focused));

  const candidates: LevelCandidate[] = [];
  for (const region of regions) {
    if (region.id === focused.id) {
      continue;
    }
    // The window strip is a direct region, not merely the control it draws:
    // its full-width box is what reaches a top-row card anywhere along the row
    // and the dialog centred under its one button (#125). Only this kind gets
    // the proxy; every other region is searched by its controls. The strip's
    // button stays a candidate beside the box, so the box adds reach rather
    // than replacing the control.
    const box = windowBox(region);
    if (box) {
      candidates.push({ region, index: 0, rect: box });
    }
    for (let index = 0; index < region.itemRects.length; index += 1) {
      const rect = region.itemRects[index];
      if (!rect) {
        continue;
      }
      candidates.push({ region, index, rect });
    }
  }

  const pick = nearest(
    from,
    candidates.map((candidate) => candidate.rect),
    direction,
  );
  if (pick < 0) {
    return null;
  }
  const chosen = candidates[pick];
  return chosen ? { region: chosen.region, index: chosen.index } : null;
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
  nearest: "nothing under your middle",
  head: "the region's head — what you came from is wider than the whole region",
  outside: "the region's head — nothing in it lies under you",
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
  // A dialog is the one region with a safe landing when nothing in it lies
  // under the control at all: the chrome's one button above a centred panel is
  // not above either answer, and the nearest would be whichever answer happens
  // to be on that side — on a destructive question, often the dangerous one.
  // Every other region keeps the locked nearest/covering geometry (#51).
  if (
    region.kind === "dialog" &&
    !region.itemRects.some((item) => gap(from, item, direction) <= ALIGNED)
  ) {
    return { index: 0, how: "outside" };
  }
  const lined = nearest(from, region.itemRects, direction, rules.edge);
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
    rules.edge,
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
/**
 * The first control in the content to the right, in region and DOM order.
 *
 * The rail is the programme's edge: its Right goes into the first line of the
 * content, not to whichever row action is geometrically closest to the item.
 * Window and dialog regions are not content; the rail itself is skipped.
 */
function firstControlRight(
  layout: Layout,
  region: Region,
  from: Rect,
): LevelTarget | null {
  for (const candidate of Object.values(layout.regions)) {
    if (
      candidate.id === region.id ||
      candidate.kind === "window" ||
      candidate.kind === "dialog"
    ) {
      continue;
    }
    for (let index = 0; index < candidate.itemRects.length; index += 1) {
      const to = candidate.itemRects[index];
      if (to && step(from, to, "right") > MIN_STEP) {
        return { region: candidate, index };
      }
    }
  }
  return null;
}

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

  // 1. Inside the region, by geometry alone: direct-first, then the closest.
  const inside = nearest(from, region.itemRects, direction, rules.edge);
  if (inside >= 0) {
    return {
      kind: "moved",
      direction,
      regionId: region.id,
      index: inside,
      why: `the nearest control ${direction} inside ${region.label}`,
    };
  }

  // 2. Down into one of this region's own children, if one lines up. A branch's
  //    Back sits above the rows it leads to; finding nothing beside it must not
  //    be the end of the move.
  const child = childInDirection(layout.regions, region, from, direction);
  if (child) {
    const target = land(layout, child, from, direction, rules);
    return {
      kind: "crossed",
      direction,
      regionId: target.regionId,
      index: target.index,
      landedBy: LANDED[target.how],
      why: `nothing ${direction} inside ${region.label}, so focus descended into ${child.label}`,
    };
  }

  // 3a. The rail's vertical ends are walls even though the rest of the level
  //     may hold controls beyond them: the six destinations are a list, and
  //     Down on Settings must not fall into whatever content sits beside it.
  const railWall = (): MoveDecision | null => {
    if (region.kind !== "rail" || !isVertical(direction)) {
      return null;
    }
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
  };

  // 3b. Out to a sibling that overlaps the band the control sits in. This is
  //     #51's crossing and `edge: "stop"` keeps it exact; under
  //     `edge: "nearest"` the level-wide fallback below takes its place and
  //     picks the closest control, not merely the first region that lines up.
  if (rules.edge === "stop") {
    const band = windowBand(region, from);
    let node = region;
    while (node.parent) {
      const sibling = siblingInDirection(layout.regions, node, from, direction, band);
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
  }

  const wall = railWall();
  if (wall) {
    return wall;
  }

  // The rail is the left edge of the room: Left leaves the programme index
  // into nothing, never back into the content beside it. Right is the one way
  // out, and the level-wide search below lands on the closest control there.
  if (region.kind === "rail" && direction === "left") {
    return {
      kind: "blocked",
      direction,
      why: "the rail is the left edge, and the rail rule says stop",
    };
  }

  // The programme's Right enters the first card of the content, in DOM order,
  // rather than the nearest control (which may be a row's More in the head).
  if (region.kind === "rail" && direction === "right" && rules.railExit === "first") {
    const first = firstControlRight(layout, region, from);
    if (first) {
      return {
        kind: "crossed",
        direction,
        regionId: first.region.id,
        index: first.index,
        why: `the rail's Right enters the first control in ${first.region.label}`,
      };
    }
  }

  if (rules.edge === "nearest") {
    // 4. The focused region has nothing at all on that side: take the closest
    //    control anywhere in the active level, direct-first, then closest.
    const found = controlInLevel(layout, region, from, direction);
    if (found) {
      // A control in a branch is that branch's own control, not a request to
      // descend into one of its children. `land` would do the latter and return
      // a different control than the search chose: the ancestor case is the
      // Title's Back above its seasons, and a sibling branch with a Back is the
      // same hole.
      if (found.region.children.length > 0) {
        return {
          kind: "crossed",
          direction,
          regionId: found.region.id,
          index: found.index,
          why: `nothing ${direction} inside ${region.label}, so focus crossed to the closest control in ${found.region.label}`,
        };
      }
      const target = land(layout, found.region, from, direction, rules);
      return {
        kind: "crossed",
        direction,
        regionId: target.regionId,
        index: target.index,
        landedBy: LANDED[target.how],
        why: `nothing ${direction} inside ${region.label}, so focus crossed to the closest control in ${found.region.label}`,
      };
    }
  }

  // 5. The end of a row: a wall, or the wrap the rules ask for. Under
  //    `edge: "nearest"` this is reached only when no control exists on that
  //    side anywhere in the level (#128).
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
      why: "the end of the row, and the row rule says stop",
    };
  }

  // 6. The one wall a rule can fill: up out of the content, to the rail.
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
