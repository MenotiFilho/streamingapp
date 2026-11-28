import { AnimatePresence, motion, useDragControls, useReducedMotionConfig } from "motion/react";
import { useId, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

import { useReducedMotion } from "../../../core/react/useReducedMotion";
import { fade, panel } from "../motion";
import { PhoneIconButton } from "./controls";
import { shouldDismissSheet } from "./sheetDismiss";

export type BottomSheetProps = {
  /** Whether the sheet is up; a closed sheet draws nothing once it has left. */
  open: boolean;
  /** The heading, which is also the dialog's accessible name. */
  title: string;
  /** The close control's accessible name. */
  closeLabel?: string;
  /** Put it away: the close control, the scrim, a drag down, or the client's Back. */
  onClose: () => void;
  /** A fixed height in px or a CSS length; absent, it fits what it holds. */
  height?: CSSProperties["height"];
  children?: ReactNode;
  testId?: string;
};

/**
 * The one drawer every remote menu opens (sheet `C8`, "Bottom sheet"): it rises
 * from the bottom edge over a dim, and is dragged down or closed. Back is the
 * client's, so this listens for no key. Reduced motion keeps the fade and drops
 * the rise (ADR-0031 §5).
 */
export function BottomSheet({
  open,
  title,
  closeLabel = "Close",
  onClose,
  height,
  children,
  testId,
}: BottomSheetProps) {
  const titleId = useId();
  const configuredReduced = useReducedMotionConfig();
  const systemReduced = useReducedMotion();
  const reduced = configuredReduced === true || systemReduced;
  const drag = useDragControls();
  const below = reduced ? { y: 0, opacity: 0 } : { y: "100%", opacity: 1 };

  const grab = (event: ReactPointerEvent<HTMLElement>) => {
    if (!(event.target as Element).closest("button")) {
      drag.start(event);
    }
  };

  return (
    <AnimatePresence>
      {open ? (
        <div key="sheet" className="mq-ph-sheet-layer">
          <motion.div
            className="mq-ph-sheet-scrim"
            data-testid={testId ? `${testId}-scrim` : undefined}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={fade()}
            onClick={onClose}
          />
          <motion.div
            className="mq-ph-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            data-testid={testId}
            style={height === undefined ? undefined : { height }}
            initial={below}
            animate={{ y: 0, opacity: 1 }}
            exit={below}
            transition={reduced ? fade() : panel()}
            drag="y"
            dragListener={false}
            dragControls={drag}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 1 }}
            dragTransition={{ bounceStiffness: 600, bounceDamping: 50 }}
            onDragEnd={(_event, info) => {
              if (shouldDismissSheet(info.offset.y, info.velocity.y)) {
                onClose();
              }
            }}
          >
            <div className="mq-ph-sheet-head" onPointerDown={grab}>
              <span className="mq-ph-sheet-grabber" aria-hidden="true" />
              <h2 id={titleId} className="mq-ph-sheet-title">
                {title}
              </h2>
              <PhoneIconButton
                className="mq-ph-sheet-close"
                kind="secondary"
                label={closeLabel}
                icon="x"
                autoFocus
                onClick={onClose}
              />
            </div>
            <div className="mq-ph-sheet-body">{children}</div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
