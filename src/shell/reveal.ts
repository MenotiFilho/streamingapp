/**
 * The reveal: keep a focused control fully inside every scrollport it lives in
 * (#127).
 *
 * `scrollIntoView({ block: "nearest" })` aligns the layout box to the
 * scrollport's edge and knows nothing about the focus ring, the lift or the
 * fixed chrome. The geometry here is a pure decision — the minimal scroll that
 * leaves the control `REVEAL_MARGIN` inside the visible box — and the DOM walk
 * only feeds it rectangles and applies the deltas. No smooth behavior: a
 * direction press moves focus and the scroll in the same frame.
 *
 * The margin accounts for the decorated focus treatment: the engine measures
 * the layout box, while the ring, the 4px lift and the 1.04 scale sit outside
 * it. The shell's own scrollports also clear the fixed chrome's band; a row
 * track, a seasons strip, a popover menu and the player's OSD have no chrome.
 */

import type { Rect } from "../focus";

/** Pixels every reveal keeps between a control and its scrollport's edge. */
export const REVEAL_MARGIN = 24;

/**
 * The fixed chrome's band over the shell's scrollports: 64px, the same number
 * as `--window-chrome-clearance` in `shell.css` (4rem at the 16px root) and
 * pinned to it by `ShellFrame.test.tsx`. A port that draws no strip — the
 * player, an OSD popover, a plain browser — gets no inset.
 */
export const CHROME_CLEARANCE = 64;

/** What one scrollport must change to keep the target inside it. */
export type RevealOffsets = { left: number; top: number };

/**
 * The minimal scroll on one axis for `target` to clear `margin` inside the
 * usable part of `viewport`, once the chrome inset has taken its bite at the
 * top.
 *
 * A target larger than the usable box is aligned to its start: its head is the
 * part a person needs, and alternating edges on a re-render would jitter.
 */
function minimalScroll(
  start: number,
  size: number,
  portStart: number,
  portSize: number,
  before: number,
  after: number,
): number {
  const from = portStart + before;
  const to = portStart + portSize - after;
  if (size > to - from || start < from) {
    return start - from;
  }
  if (start + size > to) {
    return start + size - to;
  }
  return 0;
}

/**
 * The scroll `viewport` needs so `target` sits `margin` inside its padding
 * box, with the fixed chrome narrowing the top first. Negative means scroll
 * up/left.
 */
export function revealOffsets(
  viewport: Rect,
  target: Rect,
  margin: number = REVEAL_MARGIN,
  insetTop: number = 0,
): RevealOffsets {
  return {
    left: minimalScroll(target.x, target.w, viewport.x, viewport.w, margin, margin),
    top: minimalScroll(
      target.y,
      target.h,
      viewport.y,
      viewport.h,
      margin + insetTop,
      margin,
    ),
  };
}

/** The least of an element the reveal reads a rectangle from. */
export type RevealBoxed = {
  getBoundingClientRect: () => { left: number; top: number; width: number; height: number };
};

/** One scrollport the DOM loop can move, with the chrome's band over its top. */
export type RevealScrollport = {
  /** The visible padding box in client coordinates; read fresh each pass. */
  visible: () => Rect;
  /** The fixed chrome covering this port's top, in px. */
  insetTop: number;
  /**
   * Whether scrolling this port moves the control. A fixed panel is not moved
   * by the page or the level behind it, so those ports stay where they are.
   */
  moves: boolean;
  /** Apply the deltas; the browser clamps them at the port's own ends. */
  scrollBy: (left: number, top: number) => void;
};

function boxOf(box: {
  left: number;
  top: number;
  width: number;
  height: number;
}): Rect {
  return { x: box.left, y: box.top, w: box.width, h: box.height };
}

/**
 * Reveal `target` in each port, innermost first, recomputing its rectangle
 * after every scroll: a row's horizontal move changes the card's client rect
 * before the page decides whether it also has to move vertically.
 */
export function revealIn(target: RevealBoxed, ports: readonly RevealScrollport[]): void {
  for (const port of ports) {
    if (!port.moves) {
      continue;
    }
    const viewport = port.visible();
    if (viewport.w <= 0 || viewport.h <= 0) {
      continue;
    }
    const { left, top } = revealOffsets(
      viewport,
      boxOf(target.getBoundingClientRect()),
      REVEAL_MARGIN,
      port.insetTop,
    );
    if (left !== 0 || top !== 0) {
      port.scrollBy(left, top);
    }
  }
}

/**
 * The box a scrollport actually shows, scrollbar aside. The window's scrolling
 * element scrolls the viewport; its own rectangle moves with the page (its top
 * goes negative as the base scrolls), so reading that as the visible box would
 * judge every control against the document's first screen. The root's client
 * box is the viewport, wherever the page is scrolled to.
 */
function visibleBox(element: Element): Rect {
  if (element === document.scrollingElement || element === document.documentElement) {
    const root = document.documentElement;
    return { x: 0, y: 0, w: root.clientWidth, h: root.clientHeight };
  }
  const box = element.getBoundingClientRect();
  return {
    x: box.left + element.clientLeft,
    y: box.top + element.clientTop,
    w: element.clientWidth,
    h: element.clientHeight,
  };
}

/** Whether an element can scroll at all, on either axis. */
function scrolls(element: Element): boolean {
  const style = getComputedStyle(element);
  const scrollable = (value: string) =>
    value === "auto" || value === "scroll" || value === "overlay";
  return scrollable(style.overflowX) || scrollable(style.overflowY);
}

/**
 * The fixed chrome's band over a scrollport, in px. A port clears it only when
 * the strip is actually drawn inside it: the base and a pushed overlay level
 * draw the chrome, while the player, an OSD popover, and a plain browser draw
 * none. Reading the drawn strip rather than the surface's name keeps the two
 * in step when a level's chrome is taken away.
 */
function chromeInset(element: Element): number {
  return element.querySelector(".shell-window-chrome") ? CHROME_CLEARANCE : 0;
}

/** Whether a fixed element lies between the control and the port. */
function fixedBetween(control: Element, port: Element): boolean {
  for (let node: Element | null = control; node && node !== port; node = node.parentElement) {
    if (getComputedStyle(node).position === "fixed") {
      return true;
    }
  }
  return false;
}

function portOf(element: Element, control: Element): RevealScrollport {
  return {
    visible: () => visibleBox(element),
    insetTop: chromeInset(element),
    moves: !fixedBetween(control, element),
    scrollBy: (left, top) => {
      if (left !== 0) {
        element.scrollLeft += left;
      }
      if (top !== 0) {
        element.scrollTop += top;
      }
    },
  };
}

/**
 * Every scrollport between a control and the window, innermost first. The
 * window's scrolling element is always last: the base screen scrolls there even
 * though its computed `overflow` is `visible`.
 */
export function scrollportsOf(control: Element): RevealScrollport[] {
  const ports: RevealScrollport[] = [];
  const seen = new Set<Element>();
  const add = (element: Element) => {
    if (seen.has(element)) {
      return;
    }
    seen.add(element);
    ports.push(portOf(element, control));
  };

  for (let node = control.parentElement; node; node = node.parentElement) {
    if (scrolls(node)) {
      add(node);
    }
  }
  const page = document.scrollingElement ?? document.documentElement;
  if (page) {
    add(page);
  }
  return ports;
}

/** Reveal a control in every scrollport it lives in, instantly. */
export function reveal(control: Element): void {
  revealIn(control, scrollportsOf(control));
}

/**
 * Paint focus the one way the shell does: put focus there without the
 * browser's own scroll, then reveal it with the margin (#127). The focus moves
 * outside the focus engine go through here. A no-op when there is no control.
 */
export function focusAndReveal(control: HTMLElement | null | undefined): void {
  if (!control) {
    return;
  }
  control.focus({ preventScroll: true });
  reveal(control);
}
