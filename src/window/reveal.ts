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

import type { Rect } from "./focus";
import { measureRect, type Measurable } from "./layout";

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

/** How a focused control is placed in its scrollports. */
export type RevealMode = "nearest" | "center";

/**
 * The scroll that centres `target` in the usable part of `viewport`, on both
 * axes. A target larger than the usable box is aligned to its start, for the
 * same reason the nearest policy does: the head is what a person needs.
 *
 * This is the repertory spine's navigation rule — the picture being read stays
 * in the middle of the room — while the Velvet screens keep the minimal reveal.
 */
export function centeredOffsets(
  viewport: Rect,
  target: Rect,
  margin: number = REVEAL_MARGIN,
  insetTop: number = 0,
): RevealOffsets {
  const fromX = viewport.x + margin;
  const toX = viewport.x + viewport.w - margin;
  const fromY = viewport.y + margin + insetTop;
  const toY = viewport.y + viewport.h - margin;

  return {
    left:
      target.w > toX - fromX
        ? target.x - fromX
        : target.x + target.w / 2 - (fromX + (toX - fromX) / 2),
    top:
      target.h > toY - fromY
        ? target.y - fromY
        : target.y + target.h / 2 - (fromY + (toY - fromY) / 2),
  };
}

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
  /** Whether this port may move horizontally; the page never does. */
  horizontal?: boolean;
  /** Apply the deltas; the browser clamps them at the port's own ends. */
  scrollBy: (left: number, top: number) => void;
};

/**
 * Reveal `target` in each port, innermost first, recomputing its rectangle
 * after every scroll: a row's horizontal move changes the card's client rect
 * before the page decides whether it also has to move vertically.
 */
export function revealIn(
  target: Measurable,
  ports: readonly RevealScrollport[],
  mode: RevealMode = "nearest",
): void {
  for (const port of ports) {
    if (!port.moves) {
      continue;
    }
    const viewport = port.visible();
    if (viewport.w <= 0 || viewport.h <= 0) {
      continue;
    }
    const offsets =
      mode === "center"
        ? centeredOffsets(viewport, measureRect(target), REVEAL_MARGIN, port.insetTop)
        : revealOffsets(viewport, measureRect(target), REVEAL_MARGIN, port.insetTop);
    if (port.horizontal === false) {
      offsets.left = 0;
    }
    if (offsets.left !== 0 || offsets.top !== 0) {
      port.scrollBy(offsets.left, offsets.top);
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
  return scrollableStyle(style.overflowX) || scrollableStyle(style.overflowY);
}

function scrollableStyle(value: string): boolean {
  return value === "auto" || value === "scroll" || value === "overlay";
}

/** Whether an element can move horizontally. The page is the one that cannot. */
function scrollsHorizontally(element: Element): boolean {
  if (element === document.scrollingElement || element === document.documentElement) {
    return false;
  }
  return scrollableStyle(getComputedStyle(element).overflowX);
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
    horizontal: scrollsHorizontally(element),
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
  const marker = control.closest("[data-reveal]");
  const mode = marker?.getAttribute("data-reveal");

  // The hero is the top of the programme: focusing it puts the page back at
  // its first frame so the whole top of the screen is in view, not a centred
  // crop of it. Only the repertory surface marks this.
  if (mode === "top") {
    const page = document.scrollingElement ?? document.documentElement;
    if (page) {
      page.scrollTop = 0;
    }
    return;
  }

  revealIn(control, scrollportsOf(control), mode === "center" ? "center" : "nearest");
}

/**
 * The element a focus attempt actually landed in: the control itself, or an
 * element inside it when the control is a wrapper whose `focus()` delegates to
 * a child. Null means focus was refused — a hidden, disabled, inert or detached
 * control leaves the active element elsewhere — and revealing it would measure
 * a 0x0 rectangle, read as above/left of the margin, and jolt the page for a
 * focus that never landed.
 */
export function focusLanded(control: HTMLElement): HTMLElement | null {
  if (!control.isConnected) {
    return null;
  }
  const active = document.activeElement;
  if (active === control) {
    return control;
  }
  return active instanceof HTMLElement && control.contains(active) ? active : null;
}

/** Told when `focusAndReveal` has focused a control and revealed it. */
type RevealedListener = (control: HTMLElement) => void;

const revealedListeners = new Set<RevealedListener>();

/** The last direct reveal no listener heard about yet. */
let unreportedReveal: HTMLElement | null = null;

/**
 * Watch the controls `focusAndReveal` has focused and revealed, so a focus
 * engine can take that reveal into its own guard and not repeat it on the next
 * render. Returns the unsubscribe.
 *
 * A subscriber that arrives after a direct reveal is told about it once: a
 * child's mount effect can focus before the engine's effects are bound, and
 * that first reveal is still one the engine must not repeat.
 */
export function onRevealed(listener: RevealedListener): () => void {
  revealedListeners.add(listener);
  const late = unreportedReveal;
  unreportedReveal = null;
  // A reveal only belongs to the engine while its control is still here and
  // still holds focus. Once focus has moved on, the guard would make the engine
  // skip the next real focus on that control, so the stale reveal is dropped.
  if (late && late.isConnected && document.activeElement === late) {
    listener(late);
  }
  return () => {
    revealedListeners.delete(listener);
  };
}

/**
 * Paint focus the one way the shell does: put focus there without the
 * browser's own scroll, then reveal it with the margin (#127). The focus moves
 * outside the focus engine go through here. A no-op when there is no control,
 * when focus is refused, or when the control takes no focus at all.
 */
export function focusAndReveal(control: HTMLElement | null | undefined): void {
  if (!control) {
    return;
  }
  control.focus({ preventScroll: true });
  // Focus can be refused — a hidden, disabled, inert or detached control — and
  // its 0x0 rectangle would read as above/left of the margin, jolting the page
  // for a focus that never landed. A wrapper may delegate its focus to a child,
  // so the element to reveal is the one that now holds it.
  const landed = focusLanded(control);
  if (!landed) {
    return;
  }
  reveal(landed);
  if (revealedListeners.size === 0) {
    unreportedReveal = landed;
    return;
  }
  for (const listener of revealedListeners) {
    listener(landed);
  }
}
