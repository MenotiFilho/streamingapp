import { useId, type ReactNode } from "react";

import { Button } from "./Button";

export type ConfirmDialogProps = {
  /** What the dialog asks, read as its accessible name. */
  title: string;
  /** The consequence or detail under the title. */
  children?: ReactNode;
  /** The confirming control's label: `Remove`, `Revoke`, `Clear`. */
  confirmLabel?: string;
  /** The cancelling control's label. Omit `onCancel` for a one-button notice. */
  cancelLabel?: string;
  /** Draw the confirming control in the destructive treatment. */
  danger?: boolean;
  /** Whether the Action the question confirms is still in flight (#137). */
  pending?: boolean;
  onConfirm: () => void;
  onCancel?: () => void;
  testId?: string;
};

/**
 * The confirmation surface a destructive control pushes. It is a modal dialog
 * on the level stack: the shell owns the focus trap, Back and focus
 * restoration, and the primitive only paints the question, its answers and the
 * initial focus on the safe answer.
 *
 * The panel is its own focus region, labelled by the question: its answers are
 * items of it rather than of the level root, which is what lets the D-pad come
 * back down from the strip onto the safe answer. `data-kind="dialog"` is what
 * gives that descent its safe landing: with the strip's button over neither
 * answer, the dialog takes its head (Cancel) rather than the nearest one.
 *
 * The confirming side is a danger primary — the only red fill in the system —
 * and it carries ink, never ivory.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  pending = false,
  onConfirm,
  onCancel,
  testId,
}: ConfirmDialogProps) {
  const titleId = useId();
  // The panel is its own focus region, a sibling of the window's strip (#125).
  const region = `dialog:${titleId}`;

  return (
    <div className="rep-kit-dialog-scrim">
      <div
        className="rep-kit-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-region={region}
        data-kind="dialog"
        data-label={title}
        data-testid={testId}
      >
        <h2 id={titleId} className="rep-kit-dialog-title">
          {title}
        </h2>
        {children ? <div className="rep-kit-dialog-body">{children}</div> : null}
        <div className="rep-kit-dialog-actions">
          {onCancel ? (
            <Button autoFocus onClick={onCancel}>
              {cancelLabel}
            </Button>
          ) : null}
          <Button
            variant="primary"
            danger={danger}
            pending={pending}
            autoFocus={!onCancel}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
