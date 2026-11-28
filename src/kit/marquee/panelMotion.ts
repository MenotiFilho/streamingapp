/**
 * How a panel arrives and leaves (ADR-0031 §4–§5, `docs/design-system.md` §6):
 * the side panel slides in from its edge and a floating panel rises, both with
 * a fade. Reduced motion keeps the fade and drops the movement.
 */

import type { TargetAndTransition, Transition } from "motion/react";

import { fade, panel } from "./motion";

export type PanelPlacement = "side" | "floating";

/** The rise of a floating panel, inside the record's 12–16px. */
export const PANEL_RISE = 14;

export type PanelMotion = {
  initial: TargetAndTransition;
  animate: TargetAndTransition;
  exit: TargetAndTransition;
};

export function panelMotion(placement: PanelPlacement, reducedMotion: boolean): PanelMotion {
  let away: TargetAndTransition = { opacity: 0 };
  let here: TargetAndTransition = { opacity: 1 };
  if (!reducedMotion) {
    if (placement === "side") {
      away = { opacity: 0, x: "100%" };
      here = { opacity: 1, x: 0 };
    } else {
      away = { opacity: 0, y: PANEL_RISE };
      here = { opacity: 1, y: 0 };
    }
  }
  return { initial: away, animate: here, exit: away };
}

/**
 * The panel spring for movement and the one fade for opacity, read at call time.
 * Under reduced motion movement is an explicit instant tween: a spring told to
 * last no time falls back to Motion's own default spring.
 */
export function panelTransition(reducedMotion: boolean): Transition {
  return {
    default: reducedMotion ? { type: "tween", duration: 0 } : panel(),
    opacity: fade(),
  };
}
