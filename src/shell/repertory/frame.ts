import type { Transition } from "motion/react";

import { fade, panel } from "./motion";

/**
 * The frame's decisions, kept out of the drawing (ADR-0032).
 *
 * The spine is the one permanent frame: the whole programme index lives in the
 * grid behind **All destinations**, and the spine lists at most
 * `SPINE_LIMIT` destinations before that control takes over. The two
 * transitions are here too, so the reduced-motion answer is a decision a test
 * can ask rather than a style buried in a component.
 */

/** How many destinations the spine prints before **All destinations** takes over. */
export const SPINE_LIMIT = 15;

/** The destinations the spine draws; the grid always holds the whole programme. */
export function spineDestinations<T>(destinations: readonly T[]): T[] {
  return destinations.slice(0, SPINE_LIMIT);
}

/** The label of the control that opens the whole index. */
export const ALL_DESTINATIONS = "All destinations";

/**
 * The spine's own movement. The width change is movement and snaps under
 * reduced motion; the label reveal is an opacity, so it keeps the one fade.
 */
export function spineWidthTransition(reducedMotion: boolean): Transition {
  return reducedMotion ? { duration: 0 } : panel();
}

export function spineLabelTransition(reducedMotion: boolean): Transition {
  return reducedMotion ? fade() : panel();
}

/** The base cross-fade on a destination switch (design record §6). */
export const DESTINATION_FADE_SECONDS = 0.24;

export function destinationTransition(): Transition {
  return { duration: DESTINATION_FADE_SECONDS, ease: fade().ease };
}
