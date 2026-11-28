import { motion, useIsPresent } from "motion/react";
import { useId, type ReactNode } from "react";

import { useReducedMotion } from "../../core/react/useReducedMotion";
import { cx } from "./cx";
import { FormsButton } from "./FormsButton";
import { formsPanel } from "./formsMotion";
import type { IconName } from "./icons";
import { fade } from "./motion";

export type ConfirmProps = {
  /** What it asks, naming the thing: `Remove MediaFusion?`. */
  title: string;
  /** The consequence, in the Host's words. */
  body: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** A destructive answer: the red fill. */
  danger?: boolean;
  /** The confirming control's glyph: a trash can on a destructive one; `null` for none. */
  icon?: IconName | null;
  /** The Action the answer asked for is still in flight. */
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Draw Cancel focused, for a caller that holds the focus itself. */
  focused?: boolean;
  className?: string;
};

/** How far the card travels as it arrives (`docs/design-system.md` §6). */
const RISE = 16;

/**
 * The question asked before anything is removed, over a dim. Focus starts on
 * Cancel (`docs/design-system.md` §8).
 *
 * Cancel leads in the document and the sheet draws it second: the focus engine
 * lands on a dialog's first control when nothing lies under the origin, and on
 * a destructive question that has to be the safe one. The Level, its focus
 * trap and Back belong to the caller. On its way out it is inert: the answer
 * is already given.
 */
export function Confirm({
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  icon,
  pending = false,
  onConfirm,
  onCancel,
  focused,
  className,
}: ConfirmProps) {
  const id = useId();
  const present = useIsPresent();
  const reduced = useReducedMotion();
  const titleId = `${id}-title`;
  const bodyId = `${id}-body`;
  const glyph = icon === undefined ? (danger ? "trash" : null) : icon;

  return (
    <motion.div
      className="mq-c7-confirm-scrim"
      inert={present ? undefined : true}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={fade()}
    >
      <motion.div
        className={cx("mq-c7-confirm", className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        data-region={`dialog:${id}`}
        data-kind="dialog"
        data-label={title}
        initial={{ y: RISE }}
        animate={{ y: 0 }}
        exit={{ y: RISE }}
        transition={formsPanel(reduced)}
      >
        <h2 id={titleId} className="mq-c7-confirm-title">
          {title}
        </h2>
        <div id={bodyId} className="mq-c7-confirm-body">
          {body}
        </div>
        <div className="mq-c7-confirm-actions">
          <FormsButton
            kind="secondary"
            size="L"
            autoFocus
            focused={focused}
            onClick={onCancel}
          >
            {cancelLabel}
          </FormsButton>
          <FormsButton
            kind={danger ? "danger" : "primary"}
            size="L"
            icon={glyph}
            disabled={pending}
            aria-busy={pending || undefined}
            onClick={onConfirm}
          >
            {confirmLabel}
          </FormsButton>
        </div>
      </motion.div>
    </motion.div>
  );
}
