/**
 * The bridge between the page and the pure focus model: measure the DOM into a
 * `Layout`, and keep the elements beside it so a decision can be painted.
 *
 * Regions and controls are described in markup — `data-region` on a container,
 * `data-focusable` on a control — and read in DOM order. Nothing here decides
 * where focus goes; `src/focus.ts` does that with the rectangles this module
 * measures.
 */

import type { Focus, Layout, Rect, Region } from "../focus";

/** How a region or control is measured; injectable so a test need not lay out a page. */
export type Measure = (element: Element) => Rect;

/** The page's own rectangles, with the webview's border box as the origin. */
export const measureRect: Measure = (element) => {
  const box = element.getBoundingClientRect();
  return { x: box.left, y: box.top, w: box.width, h: box.height };
};

/** One level as the page holds it: the model for the engine, the elements for the paint. */
export type LevelLayout = {
  layout: Layout;
  /** Each region's focusable controls, in the same order as `itemRects`. */
  elements: Record<string, HTMLElement[]>;
};

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
 * Measure one level into the model the engine reads.
 *
 * The root may itself be a region — the shell is — and `querySelectorAll` never
 * returns its own root, so it goes in first. `memory` is where each region was
 * last left; the caller owns it across moves and across a level's lifetime.
 */
export function readLevel(
  root: HTMLElement,
  memory: Record<string, number | undefined>,
  measure: Measure = measureRect,
): LevelLayout {  const layout: Layout = { regions: {}, memory };
  const elements: Record<string, HTMLElement[]> = {};

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
      kind: element.getAttribute("data-kind") ?? "row",
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
    const regionId = regionIdOf(element, root);
    const region = regionId ? layout.regions[regionId] : undefined;
    if (!regionId || !region) {
      continue;
    }
    region.itemRects.push(measure(element));
    elements[regionId]?.push(element);
  }

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

/** The first control a level offers, in DOM order. */
export function firstFocusable(root: HTMLElement): HTMLElement | null {
  return root.querySelector<HTMLElement>(FOCUSABLE);
}
