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
import { inputModality } from "../core/inputModality";

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
 * Which axis the centring owns. A D-pad move centres the axis it moved on and
 * minimally reveals the other; a mount, a Back restore or a destination change
 * centres both (ADR-0037).
 */
export type RevealAxis = "x" | "y" | "both";

/**
 * `target` widened vertically to include `anchor`, when a row's head must stay
 * in view with the card focused (#257). The horizontal box is the card's: a
 * row's head spans the panel and has no place in a rail's sideways scroll.
 */
function withAnchor(target: Rect, anchor: Rect | undefined): Rect {
  if (!anchor) {
    return target;
  }
  const top = Math.min(target.y, anchor.y);
  const bottom = Math.max(target.y + target.h, anchor.y + anchor.h);
  return { ...target, y: top, h: bottom - top };
}

/**
 * The scroll that centres `target` in the usable part of `viewport`, on the
 * chosen axes. A target larger than the usable box is aligned to its start, for
 * the same reason the nearest policy does: the head is what a person needs.
 *
 * This is the repertory spine's navigation rule — the picture being read stays
 * in the middle of the room — while the Velvet screens keep the minimal reveal.
 * With `axis: "x"` the vertical scroll is the minimal one, and `"y"` the
 * reverse: a horizontal move must not recentre a two-line title vertically.
 * An `anchor` (a rail's head) joins the vertical box, so a card's reveal never
 * scrolls its own row's heading away.
 */
export function centeredOffsets(
  viewport: Rect,
  target: Rect,
  margin: number = REVEAL_MARGIN,
  insetTop: number = 0,
  axis: RevealAxis = "both",
  anchor?: Rect,
): RevealOffsets {
  const fromX = viewport.x + margin;
  const toX = viewport.x + viewport.w - margin;
  const fromY = viewport.y + margin + insetTop;
  const toY = viewport.y + viewport.h - margin;
  const vertical = withAnchor(target, anchor);

  const centred = {
    left:
      target.w > toX - fromX
        ? target.x - fromX
        : target.x + target.w / 2 - (fromX + (toX - fromX) / 2),
    top:
      vertical.h > toY - fromY
        ? vertical.y - fromY
        : vertical.y + vertical.h / 2 - (fromY + (toY - fromY) / 2),
  };

  if (axis === "x") {
    return {
      left: centred.left,
      top: revealOffsets(viewport, target, margin, insetTop, anchor).top,
    };
  }
  if (axis === "y") {
    return {
      left: revealOffsets(viewport, target, margin, insetTop).left,
      top: centred.top,
    };
  }
  return centred;
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
 * up/left. An `anchor` (a rail's head) widens the vertical box so the heading
 * stays in view with its card.
 */
export function revealOffsets(
  viewport: Rect,
  target: Rect,
  margin: number = REVEAL_MARGIN,
  insetTop: number = 0,
  anchor?: Rect,
): RevealOffsets {
  const vertical = withAnchor(target, anchor);
  return {
    left: minimalScroll(target.x, target.w, viewport.x, viewport.w, margin, margin),
    top: minimalScroll(
      vertical.y,
      vertical.h,
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
  /** Whether this port may move vertically; screens that own their own scroll spring set this false. */
  vertical?: boolean;
  /** Whether this port holds an anchor element, such as a row's head. */
  contains?: (element: Element) => boolean;
  /** Apply the deltas; the browser clamps them at the port's own ends. */
  scrollBy: (left: number, top: number) => void;
};

/**
 * Reveal `target` in each port, innermost first, recomputing its rectangle
 * after every scroll: a row's horizontal move changes the card's client rect
 * before the page decides whether it also has to move vertically.
 *
 * `anchor` is a control's row head: a port that holds it keeps it in view with
 * the control, so a reveal into a rail never scrolls that rail's heading off.
 */
export function revealIn(
  target: Measurable,
  ports: readonly RevealScrollport[],
  mode: RevealMode = "nearest",
  axis: RevealAxis = "both",
  anchor?: Element,
): void {
  for (const port of ports) {
    if (!port.moves) {
      continue;
    }
    const viewport = port.visible();
    if (viewport.w <= 0 || viewport.h <= 0) {
      continue;
    }
    const held = anchor && port.contains?.(anchor) ? measureRect(anchor) : undefined;
    const offsets =
      mode === "center"
        ? centeredOffsets(
            viewport,
            measureRect(target),
            REVEAL_MARGIN,
            port.insetTop,
            axis,
            held,
          )
        : revealOffsets(viewport, measureRect(target), REVEAL_MARGIN, port.insetTop, held);
    if (port.horizontal === false) {
      offsets.left = 0;
    }
    if (port.vertical === false) {
      offsets.top = 0;
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

function verticalScrollAllowed(control: Element): boolean {
  return control.closest("[data-reveal-axis]")?.getAttribute("data-reveal-axis") !== "x";
}

function portOf(element: Element, control: Element): RevealScrollport {
  return {
    visible: () => visibleBox(element),
    insetTop: chromeInset(element),
    moves: !fixedBetween(control, element),
    horizontal: scrollsHorizontally(element),
    vertical: verticalScrollAllowed(control),
    contains: (held) => element.contains(held),
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

/** How a reveal is asked for: the marker's mode unless overridden. */
export type RevealOptions = {
  /** Force centring or the minimal reveal; the `data-reveal` marker when omitted. */
  mode?: RevealMode;
  /** Which axis the centre owns; both when omitted. */
  axis?: RevealAxis;
  /**
   * Reveal even in pointer modality. The one pointer scroll is the cut-off
   * first press, which focuses and brings the control in minimally.
   */
  force?: boolean;
};

/**
 * Reveal a control in every scrollport it lives in, instantly. A pointer press
 * reveals nothing: the room is direct manipulation, and only the cut-off first
 * press asks for the one exception with `force` (ADR-0037).
 */
export function reveal(control: Element, options: RevealOptions = {}): void {
  if (!options.force && inputModality() === "pointer") {
    return;
  }


  const marker = control.closest("[data-reveal]");
  const markerMode = marker?.getAttribute("data-reveal");

  // The hero is the top of the programme: focusing it puts the page back at
  // its first frame so the whole top of the screen is in view, not a centred
  // crop of it. Only the repertory surface marks this.
  if (markerMode === "top") {
    const page = document.scrollingElement ?? document.documentElement;
    if (page) {
      page.scrollTop = 0;
    }
    return;
  }

  const mode =
    options.mode ??
    (markerMode === "center" ? "center" : "nearest");
  // A card in a rail reveals its row's head with it (#257): the heading, tag
  // and quiet action are the row's identity, and scrolling them off the panel's
  // top leaves a person looking at pictures with no name over them.
  const row = control.closest(".rep-kit-row");
  const head = row?.querySelector(":scope > .rep-kit-row-head") ?? null;
  revealIn(
    control,
    scrollportsOf(control),
    mode,
    options.axis ?? "both",
    head ?? undefined,
  );
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
 *
 * In pointer modality focus moves with `preventScroll` and nothing else: no
 * scroll, no listener, no decoration. The cut-off first press is the one
 * exception and asks for it with `force` (ADR-0037).
 */
export function focusAndReveal(
  control: HTMLElement | null | undefined,
  options: RevealOptions = {},
): void {
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
  if (!options.force && inputModality() === "pointer") {
    return;
  }
  reveal(landed, options);
  if (revealedListeners.size === 0) {
    unreportedReveal = landed;
    return;
  }
  for (const listener of revealedListeners) {
    listener(landed);
  }
}
