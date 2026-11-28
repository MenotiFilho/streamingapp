/**
 * The arithmetic of the phone's two sliders: the seek bar and the volume box
 * (sheet `C8`). A finger answers with a fraction of a track; these turn it into
 * the moment or the level a client commits.
 */

/** How far one arrow key moves the playhead, in seconds. */
export const SEEK_KEY_STEP = 10;

/** How far one arrow key moves the volume, in the Player's levels. */
export const VOLUME_KEY_STEP = 5;

/** A fraction held inside 0..1; anything unreadable is the start. */
export function clampRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) {
    return 0;
  }
  return Math.min(1, Math.max(0, ratio));
}

/** Where along a track a pointer is, as a fraction of its width. */
export function pointerRatio(clientX: number, left: number, width: number): number {
  return width > 0 ? clampRatio((clientX - left) / width) : 0;
}

/** The level a fraction of the volume track names, on the Player's scale. */
export function levelAt(ratio: number, max: number): number {
  return Math.round(clampRatio(ratio) * Math.max(0, max));
}

/** Where a key takes the playhead, or null for a key that is not the bar's. */
export function seekKeyTarget(key: string, position: number, duration: number): number | null {
  const held = (seconds: number) => Math.min(duration, Math.max(0, seconds));
  switch (key) {
    case "ArrowLeft":
      return held(position - SEEK_KEY_STEP);
    case "ArrowRight":
      return held(position + SEEK_KEY_STEP);
    case "Home":
      return 0;
    case "End":
      return held(duration);
    default:
      return null;
  }
}

/** Where a key takes the volume, or null for a key that is not the slider's. */
export function volumeKeyTarget(key: string, level: number, max: number): number | null {
  const held = (next: number) => Math.min(max, Math.max(0, next));
  switch (key) {
    case "ArrowLeft":
    case "ArrowDown":
      return held(level - VOLUME_KEY_STEP);
    case "ArrowRight":
    case "ArrowUp":
      return held(level + VOLUME_KEY_STEP);
    case "Home":
      return 0;
    case "End":
      return max;
    default:
      return null;
  }
}
