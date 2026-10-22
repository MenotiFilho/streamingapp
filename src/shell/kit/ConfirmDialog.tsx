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
  onConfirm: () => void;
  onCancel?: () => void;
  testId?: string;
};

/**
 * The confirmation surface a destructive control pushes. It is a modal dialog
 * on the level stack: the shell owns the focus trap, Back and focus
 * restoration, and the primitive only paints the question, its two answers and
 * the initial focus on the safe answer.
 *
 * One deliberate exception to `aria-modal`: the window's fullscreen chrome is
 * drawn by the shell above this dialog's scrim (z-index 45 against the scrim's
 * 40) and stays reachable while the question is open. It is the shell's
 * control, outside the dialog's own content, and a fullscreen window must keep
 * a way out of itself (#125). The dialog's own controls remain trapped: the
 * exception is that one shell control and nothing else — anything the question
 * needs belongs inside it.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  onConfirm,
  onCancel,
  testId,
}: ConfirmDialogProps) {
  const titleId = useId();

  return (
    <div className="kit-dialog-scrim">
      <div
        className="kit-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid={testId}
      >
        <h2 id={titleId} className="kit-dialog-title">
          {title}
        </h2>
        {children ? <div className="kit-dialog-body">{children}</div> : null}
        <div className="kit-dialog-actions">
          {onCancel ? (
            <Button autoFocus onClick={onCancel}>
              {cancelLabel}
            </Button>
          ) : null}
          <Button variant="primary" danger={danger} autoFocus={!onCancel} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
