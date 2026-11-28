/**
 * The seek bar's arithmetic (#367, `docs/design-system.md` §8): where a pointer
 * is in a Stream, what a key asks for, and where a level is on its track. Pure,
 * so `SeekBar` and the volume level in `PlayerControls` decide nothing in JSX.
 */

/** One Left/Right press, the same step as the −10s and +10s transport buttons. */
export const SEEK_STEP_SECONDS = 10;
/** One Page Up/Page Down press. */
export const SEEK_PAGE_SECONDS = 60;

/** The horizontal part of a track's rectangle. */
export type TrackRect = { left: number; width: number };

/** Whether a Stream says how long it is, so a moment in it can be named. */
export function seekable(duration: number | null): duration is number {
  return duration !== null && Number.isFinite(duration) && duration > 0;
}

/** `seconds` held inside the Stream. */
export function clampSeconds(seconds: number, duration: number): number {
  if (!Number.isFinite(seconds)) {
    return 0;
  }
  return Math.min(duration, Math.max(0, seconds));
}

/** How far along `rect` the pointer is, 0 to 1; `null` for a track not laid out. */
export function pointerFraction(clientX: number, rect: TrackRect): number | null {
  if (!Number.isFinite(clientX) || !Number.isFinite(rect.width) || rect.width <= 0) {
    return null;
  }
  return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
}

/** The moment of the Stream under the pointer, or `null` where there is none to name. */
export function secondsAt(
  clientX: number,
  rect: TrackRect,
  duration: number | null,
): number | null {
  const fraction = pointerFraction(clientX, rect);
  if (fraction === null || !seekable(duration)) {
    return null;
  }
  return fraction * duration;
}

/**
 * The moment one key asks for, from `from`, or `null` where the key is not the
 * bar's. Up and Down are never the bar's: they are the player's own ladder.
 */
export function seekKeyTarget(
  key: string,
  from: number,
  duration: number | null,
  step: number = SEEK_STEP_SECONDS,
  page: number = SEEK_PAGE_SECONDS,
): number | null {
  if (!seekable(duration)) {
    return null;
  }
  switch (key) {
    case "ArrowLeft":
      return clampSeconds(from - step, duration);
    case "ArrowRight":
      return clampSeconds(from + step, duration);
    case "PageDown":
      return clampSeconds(from - page, duration);
    case "PageUp":
      return clampSeconds(from + page, duration);
    case "Home":
      return 0;
    case "End":
      return duration;
    default:
      return null;
  }
}

/** The volume under the pointer on a 0..`max` level, in whole steps of the Host's scale. */
export function levelAt(clientX: number, rect: TrackRect, max: number): number | null {
  const fraction = pointerFraction(clientX, rect);
  return fraction === null ? null : Math.round(fraction * max);
}

/**
 * The volume a key asks for, or `null` where the key is not the level's. Left,
 * Right, Up and Down are left to the focus engine: in the player they move
 * between controls, and the pad's volume faces step the volume (#57, #120).
 */
export function levelKeyTarget(
  key: string,
  from: number,
  max: number,
  step: number,
): number | null {
  const held = (value: number) => Math.min(max, Math.max(0, Math.round(value)));
  switch (key) {
    case "PageDown":
      return held(from - step);
    case "PageUp":
      return held(from + step);
    case "Home":
      return 0;
    case "End":
      return max;
    default:
      return null;
  }
}
