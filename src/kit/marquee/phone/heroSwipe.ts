/**
 * The phone's hero turns on a sideways swipe (sheet `C8`, "swipe sideways or
 * wait"): leftward asks for the next featured Title, rightward for the previous.
 * A gesture that is mostly vertical is the page scrolling.
 */

/** How far sideways, in px, a finger must travel. */
export const HERO_SWIPE_DISTANCE = 40;

export type HeroStep = "next" | "previous";

export function heroSwipe(dx: number, dy: number): HeroStep | null {
  if (Math.abs(dx) < HERO_SWIPE_DISTANCE || Math.abs(dx) <= Math.abs(dy)) {
    return null;
  }
  return dx < 0 ? "next" : "previous";
}
