/**
 * The cut-off pointer press's decision (#245).
 *
 * A click or a tap is direct manipulation: a control that is fully visible
 * activates on the first press and shows nothing. A control cut off by its
 * scrollport cannot be used as a target yet — the browser would scroll it into
 * view and then activate whatever ended up under the pointer — so the first
 * press only focuses and reveals it, and the second press activates.
 *
 * The plan is pure and framework-free. The DOM half that records the press,
 * measures the scrollports and installs the listener lives in
 * `src/core/react/pointerPress.ts`, the core's one DOM pocket (ADR-0035 §1).
 */

/** The two answers a pointer press can have. */
export type PointerPressPlan = "activate" | "focus";

/**
 * What the next click does:
 *
 * - not inside a row: activate — a button, a rail item and a menu row are
 *   direct manipulation, and there is no horizontal walk to join;
 * - already focused at pointerdown: activate — this is the second press of a
 *   cut-off control, and the one that was aimed at;
 * - fully visible: activate — the first press already has the control;
 * - anything else: focus — the cut-off first press focuses and reveals.
 */
export function pointerPressPlan({
  inRow,
  wasFocused,
  fullyVisible,
}: {
  inRow: boolean;
  wasFocused: boolean;
  fullyVisible: boolean;
}): PointerPressPlan {
  if (!inRow || wasFocused || fullyVisible) {
    return "activate";
  }
  return "focus";
}

/** A rectangle in client coordinates, enough to judge a press. */
export type PressBox = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

/** Whether `target` lies fully inside `port`, edges included. */
export function insidePort(target: PressBox, port: PressBox): boolean {
  return (
    target.left >= port.left &&
    target.top >= port.top &&
    target.right <= port.right &&
    target.bottom <= port.bottom
  );
}

/** Whether `target` lies fully inside every port; no ports means no clipping. */
export function insidePorts(
  target: PressBox,
  ports: readonly PressBox[],
): boolean {
  return ports.every((port) => insidePort(target, port));
}
