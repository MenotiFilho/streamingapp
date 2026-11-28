import type { Transition } from "motion/react";

import { panel } from "./motion";

/**
 * C7's movement on the panel spring: the confirm card's and the menu's rise, and
 * an Addon row riding along its list. Under reduced motion it is an explicit
 * instant, never a spring of zero duration, which Motion runs at its default
 * length (ADR-0031 §5). Fades are not movement and do not come through here.
 */
export function formsPanel(reduced: boolean): Transition {
  return reduced ? { duration: 0 } : panel();
}
