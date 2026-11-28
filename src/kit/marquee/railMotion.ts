import type { Transition } from "motion/react";

import { fade, panel } from "./motion";

/**
 * How the rail changes state (ADR-0031, `docs/design-system.md` §6). The width
 * (`--mq-rail-open`) and the dim, panel and labels (`--mq-rail-fade`) move on
 * the panel spring. With movement left out the width snaps and the rest still
 * fades.
 */
export function railTransition(calm: boolean): Transition {
  return {
    "--mq-rail-open": calm ? { duration: 0 } : panel(),
    "--mq-rail-fade": calm ? fade() : panel(),
  } as Transition;
}
