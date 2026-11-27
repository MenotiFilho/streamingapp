import { motion, type MotionStyle } from "motion/react";
import type { ReactNode } from "react";

import { cardScale, type CardKind } from "./cards";
import { useCalmMotion } from "./controlsFocus";
import { quick } from "./motion";

/**
 * The part of a card that grows under focus, on the quick spring. The button
 * around it keeps the resting footprint, so neighbours do not move.
 *
 * With movement left out the change is instant: the sheet zeroes the spring's
 * duration, which Motion reads as unset and replaces with its own default.
 *
 * `--mq-card-zoom` tells the sheet the scale, so the outline, shadow, radius
 * and play mark keep the mockup's own sizes once grown. No CSS transition names
 * `transform` here: the spring is the only thing moving it.
 */
export function CardFrame({
  kind,
  shown,
  children,
}: {
  kind: CardKind;
  shown: boolean;
  children: ReactNode;
}) {
  const calm = useCalmMotion();
  const scale = cardScale(kind, { shown, calm });

  return (
    <motion.span
      className="mq-card-frame"
      initial={false}
      animate={{ scale }}
      transition={calm ? { duration: 0 } : quick()}
      style={{ "--mq-card-zoom": scale } as MotionStyle}
    >
      {children}
    </motion.span>
  );
}
