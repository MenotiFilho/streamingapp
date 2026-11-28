import type { Transition } from "motion/react";

import { fade, panel } from "../../kit/marquee/motion";
import { SETTINGS_LEVEL_PREFIX } from "../../core/settingsRegister";
import { DEFAULT_RULES, type Rules } from "../focus";
import type { ShellLevel } from "../navigation";

/**
 * Marquee frame decisions, kept out of the drawing (ADR-0032).
 *
 * Uses Marquee's own motion presets (`src/kit/marquee/motion.ts`) reading
 * `--mq-motion-*` tokens. Under reduced motion, movement snaps (`{ duration: 0 }`)
 * while opacity keeps the one fade (`ADR-0031 §5`).
 */

/** Base cross-fade duration on a destination switch (`docs/design-system.md` §6). */
export const DESTINATION_FADE_SECONDS = 0.24;

export function destinationTransition(): Transition {
  return { duration: DESTINATION_FADE_SECONDS, ease: fade().ease };
}

/** How far a pushed overlay enters from the trailing edge, in px. */
export const LEVEL_PUSH_PX = 24;

/** Which levels enter from the trailing edge; the player and popovers do not. */
export function levelPushed(kind: ShellLevel["kind"]): boolean {
  return kind === "overlay";
}

/** How far an OSD popover rises from its anchor, in px. */
export const POPOVER_RISE_PX = 14;

/** Which levels rise from their anchor. */
export function levelRises(kind: ShellLevel["kind"]): boolean {
  return kind === "popover";
}

/** Whether a level is a Settings sub-level that keeps the nav rail live beside it. */
export function isSettingsLeaf(level: Pick<ShellLevel, "id"> | null | undefined): boolean {
  return level?.id.startsWith(SETTINGS_LEVEL_PREFIX) ?? false;
}

/** How the Home rows shift up/down between rotating and following hero modes. */
export function rowsShiftTransition(calm: boolean): Transition {
  return {
    "--mq-rows-shift": calm ? { duration: 0 } : panel(),
  } as Transition;
}

/**
 * Marquee's spatial-focus edge rules:
 * - Right from the rail returns to the last content control (or the first when none).
 * - Left/Right from WindowChrome enters the first content control.
 * - Entering a row from outside a row starts at its first card.
 */
export const MARQUEE_RULES: Rules = {
  ...DEFAULT_RULES,
  railExit: "last",
  chromeExit: "hero",
  rowEntry: "first",
};
