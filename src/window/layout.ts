/**
 * The bridge between the page and the pure focus model: measure the DOM into a
 * `Layout`, and keep the elements beside it so a decision can be painted.
 *
 * Regions and controls are described in markup — `data-region` on a container,
 * `data-focusable` on a control — and read in DOM order. Nothing here decides
 * where focus goes; `src/focus.ts` does that with the rectangles this module
 * measures.
 */

import type { Focus, Layout, Rect, Region, RegionKind } from "./focus";

/** How a region or control is measured; injectable so a test need not lay out a page. */
export type Measure = (element: Element) => Rect;

/** The least of a thing a measurement needs: its border box. */
export type Measurable = Pick<Element, "getBoundingClientRect">;

/** The page's own rectangles, with the webview's border box as the origin. */
export const measureRect = (element: Measurable): Rect => {
  const box = element.getBoundingClientRect();
  return { x: box.left, y: box.top, w: box.width, h: box.height };
};

/** One level as the page holds it: the model for the engine, the elements for the paint. */
export type LevelLayout = {
  layout: Layout;
  /** Each region's focusable controls, in the same order as `itemRects`. */
  elements: Record<string, HTMLElement[]>;
};

/**
 * The kind a region declares. A region with no `data-kind` is a row — it holds
 * a line of controls and stops at its own end — and an unknown spelling is
 * treated the same rather than inventing a wall. `window` and `dialog` are the
 * two scoped kinds the crossing rules single out.
 */
export function regionKind(declared: string | null): RegionKind {
  switch (declared) {
    case "rail":
    case "branch":
    case "window":
    case "dialog":
      return declared;
    default:
      return "row";
  }
}

/** The nearest `data-region` ancestor of a node, stopping at the level's root. */
export function regionIdOf(node: Element, root: HTMLElement): string | null {
  let walk: Element | null = node.parentElement;
  while (walk && walk !== root.parentElement) {
    const id = walk.getAttribute("data-region");
    if (id) {
      return id;
    }
    walk = walk.parentElement;
  }
  return null;
}

/** The controls the focus engine may take: a disabled one is not a target. */
export const FOCUSABLE = "[data-focusable]:not([disabled])";

/**
 * Drop every region that cannot hold focus: one with no controls of its own and
 * no surviving child, recursively, rebuilding each parent's `children` from the
 * survivors. An Addon group that answered nothing is a note, not a target, and
 * must not swallow a move on the way to the next group; a branch left with only
 * such groups goes too. Every region left in the level can hold focus. A pruned
 * region is forgotten from `memory` as well, so one that returns starts fresh.
 */
function prune(layout: Layout, elements: Record<string, HTMLElement[]>): void {
  const survives = (id: string): boolean => {
    const region = layout.regions[id];
    if (!region) {
      return false;
    }
    region.children = region.children.filter(survives);
    return region.itemRects.length > 0 || region.children.length > 0;
  };

  for (const id of Object.keys(layout.regions)) {
    if (!survives(id)) {
      delete layout.regions[id];
      delete elements[id];
      delete layout.memory[id];
    }
  }
}

/**
 * Measure one level into the model the engine reads.
 *
 * The root may itself be a region — the shell is — and `querySelectorAll` never
 * returns its own root, so it goes in first. `memory` is where each region was
 * last left; the caller owns it across moves and across a level's lifetime, and
 * a region that is pruned is removed from it.
 *
 * While the rects are read the root is marked `data-measuring`, which the kit
 * uses to set the focus decoration aside (the lift is a transform, and
 * `getBoundingClientRect` includes it). The mark comes off in a `finally`, so a
 * thrown `Measure` cannot leave the page measured as if it were focused.
 */
export function readLevel(
  root: HTMLElement,
  memory: Record<string, number | undefined>,
  measure: Measure = measureRect,
): LevelLayout {
  const layout: Layout = { regions: {}, memory };
  const elements: Record<string, HTMLElement[]> = {};

  root.setAttribute("data-measuring", "");
  try {
    const regionElements: Element[] = root.hasAttribute("data-region") ? [root] : [];
    regionElements.push(...Array.from(root.querySelectorAll("[data-region]")));

    for (const element of regionElements) {
      const id = element.getAttribute("data-region");
      if (!id) {
        continue;
      }
      const region: Region = {
        id,
        label: element.getAttribute("data-label") ?? id,
        kind: regionKind(element.getAttribute("data-kind")),
        parent: regionIdOf(element, root),
        children: [],
        rect: measure(element),
        itemRects: [],
      };
      layout.regions[id] = region;
      elements[id] = [];
    }

    for (const region of Object.values(layout.regions)) {
      if (region.parent) {
        layout.regions[region.parent]?.children.push(region.id);
      }
    }

    for (const element of Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))) {
      // A level below the top is inert, and so is the base while a level is
      // open. The window's spine can stay live beside a Settings leaf, so the
      // root may contain both the spine and the level; inert subtrees are not
      // targets.
      if (element.closest("[inert]")) {
        continue;
      }
      const regionId = regionIdOf(element, root);
      const region = regionId ? layout.regions[regionId] : undefined;
      if (!regionId || !region) {
        continue;
      }
      region.itemRects.push(measure(element));
      elements[regionId]?.push(element);
    }
  } finally {
    root.removeAttribute("data-measuring");
  }

  prune(layout, elements);
  return { layout, elements };
}

/** Which control an element is, by the level's own regions and DOM order. */
export function focusOf(
  element: HTMLElement | null,
  elements: Record<string, HTMLElement[]>,
): Focus | null {
  if (!element) {
    return null;
  }
  for (const [regionId, controls] of Object.entries(elements)) {
    const index = controls.indexOf(element);
    if (index >= 0) {
      return { regionId, index };
    }
  }
  return null;
}

/** The first control a level offers, in DOM order, skipping inert subtrees. */
export function firstFocusable(root: HTMLElement): HTMLElement | null {
  for (const element of root.querySelectorAll<HTMLElement>(FOCUSABLE)) {
    if (!element.closest("[inert]")) {
      return element;
    }
  }
  return null;
}
