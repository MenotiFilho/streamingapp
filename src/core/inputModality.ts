/**
 * The input modality: which device last asked the client to do something.
 *
 * Focus is both a navigation instrument and a pointer side effect (#245, #392).
 * A click, tap, wheel scroll, or mouse move is direct manipulation: it shows
 * no focus decoration and keeps Home as a whole-window scrollable page. An
 * arrow key or a pad intent is navigation: the control is decorated, the
 * movement's axis is brought into view, and Home's hero follows focus. `Tab`,
 * `Shift+Tab`, and `Enter` work in pointer modality without forcing navigation
 * or following mode.
 *
 * The state is here, framework-free, because both clients read it (ADR-0035
 * §1). The installer takes the page root rather than reaching for a global
 * document, so the rule itself stays out of the platform; the entries pass
 * `document.documentElement` and the tests pass a fake root.
 */

import { isNavigationKey, isTypingTarget } from "./input";

/** Which device last asked for something. */
export type InputModality = "pointer" | "navigation";

/**
 * The page root the installer needs: the document element it listens on and
 * whose `data-input` attribute the stylesheets read. A real `HTMLElement`
 * fits.
 */
export type ModalityRoot = {
  dataset: DOMStringMap;
  addEventListener(
    type: "keydown" | "pointerdown" | "pointermove" | "wheel",
    listener: (event: Event) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener(
    type: "keydown" | "pointerdown" | "pointermove" | "wheel",
    listener: (event: Event) => void,
    options?: boolean | EventListenerOptions,
  ): void;
};

/**
 * Pointer until a key or a pad intent says otherwise. This is what makes a
 * click on a control that was focused at mount paint nothing: the room opens
 * in pointer mode and only a navigation input dresses it.
 */
let current: InputModality = "pointer";

const listeners = new Set<(modality: InputModality) => void>();

/** The roots the attribute is written on; more than one page in tests. */
const roots = new Set<ModalityRoot>();

/** The page root each installed teardown belongs to, so install is idempotent. */
const installed = new WeakMap<ModalityRoot, () => void>();

function writeAttribute(root: ModalityRoot): void {
  root.dataset.input = current;
}

function announce(): void {
  for (const root of roots) {
    writeAttribute(root);
  }
  for (const listener of listeners) {
    listener(current);
  }
}

/** Which device last asked. */
export function inputModality(): InputModality {
  return current;
}

/** A key or a pad intent chose navigation: decoration and centring are back. */
export function markNavigation(): void {
  if (current === "navigation") {
    return;
  }
  current = "navigation";
  announce();
}

/** A pointer press is direct manipulation, whatever was focused before it. */
export function markPointer(): void {
  if (current === "pointer") {
    return;
  }
  current = "pointer";
  announce();
}

/** Watch the modality change; returns the unsubscribe. */
export function subscribeInputModality(
  listener: (modality: InputModality) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Make the last input the page's modality. Arrow keys (outside a text input)
 * mean navigation; `Tab`, `Shift+Tab`, `Enter`, and typing keys do not force
 * navigation. Any `pointerdown`, `wheel`, or real mouse `pointermove` (with
 * changed pointer coordinates, ignoring stationary synthetic layout-scroll
 * events) means pointer. Capture, so the attribute is right before the browser
 * moves focus.
 *
 * Idempotent per root and cleanable: a second install returns the first
 * teardown rather than listening twice. The pad has no key event; the focus
 * engine calls `markNavigation` itself.
 */
export function installInputModality(root: ModalityRoot): () => void {
  const existing = installed.get(root);
  if (existing) {
    return existing;
  }

  let lastPointerPos: { x: number; y: number } | null = null;

  const onKeyDown = (event: Event) => {
    const keyEvent = event as KeyboardEvent;
    if (typeof keyEvent.key !== "string") {
      return;
    }
    if (isNavigationKey(keyEvent.key, isTypingTarget(event.target))) {
      markNavigation();
    }
  };

  const onPointerDown = (event: Event) => {
    const pointer = event as PointerEvent;
    if (typeof pointer.clientX === "number" && typeof pointer.clientY === "number") {
      lastPointerPos = { x: pointer.clientX, y: pointer.clientY };
    }
    markPointer();
  };

  const onPointerMove = (event: Event) => {
    const pointer = event as PointerEvent;
    if (pointer.pointerType === "touch") {
      return;
    }
    if (typeof pointer.clientX === "number" && typeof pointer.clientY === "number") {
      const x = pointer.clientX;
      const y = pointer.clientY;
      if (lastPointerPos !== null) {
        if (x === lastPointerPos.x && y === lastPointerPos.y) {
          return;
        }
      } else if (x === 0 && y === 0 && (pointer.movementX ?? 0) === 0 && (pointer.movementY ?? 0) === 0) {
        return;
      }
      lastPointerPos = { x, y };
    }
    markPointer();
  };

  const onWheel = () => {
    markPointer();
  };

  root.addEventListener("keydown", onKeyDown, true);
  root.addEventListener("pointerdown", onPointerDown, true);
  root.addEventListener("pointermove", onPointerMove, { capture: true, passive: true });
  root.addEventListener("wheel", onWheel, { capture: true, passive: true });
  roots.add(root);
  writeAttribute(root);

  const teardown = () => {
    root.removeEventListener("keydown", onKeyDown, true);
    root.removeEventListener("pointerdown", onPointerDown, true);
    root.removeEventListener("pointermove", onPointerMove, true);
    root.removeEventListener("wheel", onWheel, true);
    roots.delete(root);
    installed.delete(root);
  };
  installed.set(root, teardown);
  return teardown;
}
