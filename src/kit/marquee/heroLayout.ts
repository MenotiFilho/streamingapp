/**
 * The decisions the hero is drawn from (sheet C4, `docs/design-system.md` §6,
 * §8): what each mode shows, and what moves or fades between two states.
 */

import type { Transition } from "motion/react";

import { fade, panel } from "./motion";

/** The two modes of the one hero. */
export type HeroMode = "rotating" | "following";

/** Following focus drops the actions and the ticks: the rows hold focus. */
export function heroShows(mode: HeroMode): { actions: boolean; ticks: boolean } {
  const rotating = mode === "rotating";
  return { actions: rotating, ticks: rotating };
}

/** How far the backdrop has moved to the right: 0 rotating, 1 following. */
export function heroShift(mode: HeroMode): 0 | 1 {
  return mode === "following" ? 1 : 0;
}

/**
 * What cross-fades. The title, facts and logo are replaced on every new title
 * and mode. The backdrop is replaced on a new title, inside a frame that stays
 * and slides between modes, even when the title changes with the mode. With
 * movement left out the frame cannot slide, so a new mode replaces it and the
 * switch is a fade.
 */
export function heroLayerKeys(
  mode: HeroMode,
  titleKey: string,
  calm: boolean,
): { frame: string; art: string; copy: string } {
  return {
    frame: calm ? mode : "art",
    art: titleKey,
    copy: `${mode}:${titleKey}`,
  };
}

/** The frame fades, and slides on the panel spring where movement is allowed. */
export function heroArtTransition(calm: boolean): Transition {
  return {
    opacity: fade(),
    "--mq-hero-shift": calm ? { duration: 0 } : panel(),
  } as Transition;
}
