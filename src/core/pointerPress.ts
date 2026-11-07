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

/**
 * How far past a port's edge a control may lie and still count as inside it.
 *
 * Layout is exact and a scrollport's client box is not: the browser snaps
 * `clientWidth`, `clientHeight`, `clientLeft` and `clientTop` to whole pixels,
 * while a control's `getBoundingClientRect()` keeps the fraction. A control
 * that fills its port — an episode row fills its list's width — overhangs the
 * snapped box by the remainder, under a pixel, and so read as cut off: its
 * first press only focused it and the second one opened it. The snap's error is
 * below one pixel and a person cannot see less than that missing, so anything
 * under a whole pixel is inside, and a whole pixel or more is a cut-off.
 */
const SNAP_SLACK = 1;

/**
 * Whether `target` lies fully inside `port`: edges included, and short of a
 * whole pixel past them, which is the snap's remainder and not a cut-off.
 */
export function insidePort(target: PressBox, port: PressBox): boolean {
  return (
    target.left > port.left - SNAP_SLACK &&
    target.top > port.top - SNAP_SLACK &&
    target.right < port.right + SNAP_SLACK &&
    target.bottom < port.bottom + SNAP_SLACK
  );
}

/** Whether `target` lies fully inside every port; no ports means no clipping. */
export function insidePorts(
  target: PressBox,
  ports: readonly PressBox[],
): boolean {
  return ports.every((port) => insidePort(target, port));
}
