/**
 * When a drag on the bottom sheet puts it away (sheet `C8`, "drag it down or
 * close it"): far enough down, or a quick flick down. A drag upward, or a short
 * slow one, springs back.
 */

/** How far down, in px, a slow drag must go. */
export const SHEET_DISMISS_OFFSET = 96;

/** How fast downward, in px per second, a flick must be. */
export const SHEET_DISMISS_VELOCITY = 500;

export function shouldDismissSheet(offsetY: number, velocityY: number): boolean {
  if (offsetY <= 0) {
    return false;
  }
  return offsetY >= SHEET_DISMISS_OFFSET || velocityY >= SHEET_DISMISS_VELOCITY;
}
