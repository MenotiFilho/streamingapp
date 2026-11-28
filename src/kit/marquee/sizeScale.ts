/**
 * Where the knob sits on the Subtitle size stepper's track, 0 at the smallest
 * size and 1 at the largest. The ladder itself, its bounds and its steps are the
 * core's (`stepScale`, ADR-0044 §5).
 */

import { SUBTITLE_SCALE_MAX, SUBTITLE_SCALE_MIN } from "../../core/controls";

export function sizeFraction(scale: number): number {
  if (!Number.isFinite(scale)) {
    return 0;
  }
  const share = (scale - SUBTITLE_SCALE_MIN) / (SUBTITLE_SCALE_MAX - SUBTITLE_SCALE_MIN);
  return Math.min(1, Math.max(0, share));
}
