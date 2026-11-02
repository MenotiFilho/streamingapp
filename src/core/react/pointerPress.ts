/**
 * The cut-off pointer press's DOM half (#245).
 *
 * The plan is pure (`src/core/pointerPress.ts`); this is the one part that has
 * to read the page: where the control was at `pointerdown`, whether it was
 * already focused, and whether every scrollport between it and the viewport
 * holds it. It records at `pointerdown` capture — before the browser's native
 * focus scroll — and acts at `click` capture, where the record is still the
 * truth.
 *
 * It lives in `src/core/react/`, the core's one DOM pocket (ADR-0035 §1), so
 * the window and the served Remote can install the same rule without the core
 * itself reaching for a document.
 */

import { DRAG_SLOP } from "../input";
import {
  insidePort,
  pointerPressPlan,
  type PointerPressPlan,
  type PressBox,
} from "../pointerPress";

/** The control's border box, the one the browser hit-tests and scrolls to. */
function borderBox(element: Element): PressBox {
  const box = element.getBoundingClientRect();
  return {
    left: box.left,
    top: box.top,
    right: box.right,
    bottom: box.bottom,
  };
}

/**
 * The box a scrollport actually shows, scrollbar aside. The window's scrolling
 * element shows the viewport, wherever the page is scrolled to; every other
 * port is its client box at its current client position.
 */
function visibleBox(element: Element): PressBox {
  const page = element.ownerDocument;
  if (element === page.scrollingElement || element === page.documentElement) {
    const root = page.documentElement;
    return { left: 0, top: 0, right: root.clientWidth, bottom: root.clientHeight };
  }
  const box = element.getBoundingClientRect();
  const left = box.left + element.clientLeft;
  const top = box.top + element.clientTop;
  return {
    left,
    top,
    right: left + element.clientWidth,
    bottom: top + element.clientHeight,
  };
}

function scrollableStyle(value: string): boolean {
  return value === "auto" || value === "scroll" || value === "overlay";
}

function scrolls(element: Element): boolean {
  const style = getComputedStyle(element);
  return scrollableStyle(style.overflowX) || scrollableStyle(style.overflowY);
}

/**
 * Whether a control is fully inside every scrollport between it and the
 * viewport, read before the browser's native focus scroll can move any of
 * them. A fixed panel is the last clipper: the OSD and the dock sit over a page
 * that may be scrolled elsewhere, and the ports above the panel do not move it.
 */
export function pressIsFullyVisible(control: Element): boolean {
  const target = borderBox(control);
  const page = visibleBox(control.ownerDocument.documentElement);

  // A fixed control is positioned against the viewport; the scrollports above
  // it do not move or clip it.
  if (getComputedStyle(control).position === "fixed") {
    return insidePort(target, page);
  }

  for (let node = control.parentElement; node; node = node.parentElement) {
    if (getComputedStyle(node).position === "fixed") {
      if (scrolls(node) && !insidePort(target, visibleBox(node))) {
        return false;
      }
      break;
    }
    if (scrolls(node) && !insidePort(target, visibleBox(node))) {
      return false;
    }
  }
  return insidePort(target, page);
}

/** The page root the installer listens on; a real `HTMLElement` fits. */
export type PointerPressRoot = {
  ownerDocument: {
    activeElement: Element | null;
    scrollingElement: Element | null;
    documentElement: Element;
  };
  addEventListener(
    type: "pointerdown" | "click",
    listener: (event: Event) => void,
    capture?: boolean,
  ): void;
  removeEventListener(
    type: "pointerdown" | "click",
    listener: (event: Event) => void,
    capture?: boolean,
  ): void;
};

export type PointerPressOptions = {
  /** Focus the held control and bring it in minimally; never activate it. */
  focusAndReveal: (control: HTMLElement) => void;
};

/** What the pointerdown recorded; the click either matches it or does not. */
type PendingPress = {
  control: HTMLElement;
  plan: PointerPressPlan;
  /** Where the press began, so a row drag is not mistaken for a press on a card. */
  x: number;
  y: number;
};

/** One installed teardown per root, so two entries cannot double-handle a press. */
const installed = new WeakMap<PointerPressRoot, () => void>();

/**
 * Make a cut-off first press focus instead of activate. A press on anything
 * that is not a `[data-focusable]` control clears the record, so a click
 * synthesised elsewhere never uses a stale one.
 */
export function installPointerPress(
  root: PointerPressRoot,
  { focusAndReveal }: PointerPressOptions,
): () => void {
  const existing = installed.get(root);
  if (existing) {
    return existing;
  }

  let pending: PendingPress | null = null;

  const onPointerDown = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      pending = null;
      return;
    }
    const control = target.closest<HTMLElement>("[data-focusable]");
    if (!control) {
      pending = null;
      return;
    }
    const active = root.ownerDocument.activeElement;
    const point = event as MouseEvent;
    pending = {
      control,
      plan: pointerPressPlan({
        inRow: control.closest('[data-kind="row"]') !== null,
        wasFocused: active !== null && control.contains(active),
        fullyVisible: pressIsFullyVisible(control),
      }),
      x: point.clientX ?? 0,
      y: point.clientY ?? 0,
    };
  };

  const onClick = (event: Event) => {
    const held = pending;
    pending = null;
    if (!held || held.plan !== "focus") {
      return;
    }
    const target = event.target;
    if (!(target instanceof Node) || !held.control.contains(target)) {
      return;
    }
    // A row drag ends with a click the browser synthesises over the card; it is
    // the drag's, not a press, and the row's own handler must be the one to
    // swallow it (it also clears its drag flag there).
    if (event instanceof MouseEvent) {
      const moved = Math.hypot(event.clientX - held.x, event.clientY - held.y);
      if (moved > DRAG_SLOP) {
        return;
      }
    }
    // The control is cut off: swallow the activation, focus it, and let the
    // second press — with the control now focused — do what the person aimed
    // at. `stopPropagation` keeps a screen's own click from firing; the focus
    // engine's document-level click listener has already run above this
    // capture, and the focusin path remembers the control anyway.
    event.preventDefault();
    event.stopPropagation();
    focusAndReveal(held.control);
  };

  root.addEventListener("pointerdown", onPointerDown, true);
  root.addEventListener("click", onClick, true);

  const teardown = () => {
    root.removeEventListener("pointerdown", onPointerDown, true);
    root.removeEventListener("click", onClick, true);
    installed.delete(root);
  };
  installed.set(root, teardown);
  return teardown;
}
