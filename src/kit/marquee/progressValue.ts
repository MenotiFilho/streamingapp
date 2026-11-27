/**
 * A progress reading as a bar draws it: a share from 0 to 1, or `null` where
 * there is nothing to draw (no reading, or one that is not a number).
 */
export function clampFraction(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  return Math.min(1, Math.max(0, value));
}
