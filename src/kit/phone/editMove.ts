import { moveTarget } from "../../core/addons";

/**
 * Where Edit mode may put an Addon row (sheet `C8` Addon row; the Addons screen
 * draws it 76px tall with 12px between rows).
 *
 * The order is the Host's. This only says which position a drag or an arrow key
 * names, and that nothing moves past either end.
 */

/** One row plus the gap under it, in px. */
export const ADDON_ROW_PITCH = 88;

/** How far, in px, a row may be dragged from its slot. */
export function dragLimits(
  index: number,
  count: number,
  pitch: number = ADDON_ROW_PITCH,
): { min: number; max: number } {
  return {
    min: Math.min(0, -index * pitch) || 0,
    max: Math.max(0, (count - 1 - index) * pitch) || 0,
  };
}

/** The slot a drag of `offset` px from `index` names: the nearest one that exists. */
export function dragTarget(
  index: number,
  offset: number,
  count: number,
  pitch: number = ADDON_ROW_PITCH,
): number {
  const steps = pitch > 0 ? Math.round(offset / pitch) : 0;
  return Math.min(Math.max(0, count - 1), Math.max(0, index + steps));
}

/** The slot an arrow key names, or null for another key or the end of the list. */
export function keyTarget(key: string, index: number, count: number): number | null {
  if (key === "ArrowUp") {
    return moveTarget(index, -1, count);
  }
  if (key === "ArrowDown") {
    return moveTarget(index, 1, count);
  }
  return null;
}
