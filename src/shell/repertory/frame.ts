import type { Transition } from "motion/react";

import { DEFAULT_RULES, type Rules } from "../../focus";
import { fade, panel } from "./motion";

/**
 * The frame's decisions, kept out of the drawing (ADR-0032).
 *
 * The spine is the one permanent frame: the whole programme index lives in the
 * grid behind the More card, and the spine lists at most `SPINE_LIMIT`
 * destinations before that card takes over. The two transitions are here too,
 * so the reduced-motion answer is a decision a test can ask rather than a
 * style buried in a component.
 */

/** How many destinations the spine prints before the More card takes over. */
export const SPINE_LIMIT = 15;

/** The destinations the spine draws; the grid always holds the whole programme. */
export function spineDestinations<T>(destinations: readonly T[]): T[] {
  return destinations.slice(0, SPINE_LIMIT);
}

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

/**
 * The repertory's edge rules: the rail's Left is a wall, and its Right returns
 * to the control the content was left on (or the first card when there is no
 * history); entering a row from outside a row starts at its first card; and
 * the window chrome's Left and Right both enter the programme's first control.
 * Everything else is the shell's settled rule.
 */
export const REPERTORY_RULES: Rules = {
  ...DEFAULT_RULES,
  railExit: "last",
  chromeExit: "hero",
  rowEntry: "first",
};
