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
 * The window's fullscreen chrome is drawn by the shell beside this dialog,
 * inside the same level and above the scrim (z-index 45 against the scrim's
 * 40), so a pointer or the D-pad can still reach it while the question is open.
 * The chrome is the shell's control, not one of the dialog's answers: it is
 * outside the dialog's `aria-modal` accessibility scope, so a screen-reader
 * user exits fullscreen with F11 instead of finding it in the dialog. The
 * dialog's own controls remain trapped; anything the question needs belongs
 * inside it. The chrome stays reachable because a fullscreen window must keep
 * a way out of itself (#125).
 *
 * The panel is its own focus region, labelled by the question: its answers are
 * items of it rather than of the level root, which is what lets the D-pad come
 * back down from the strip onto the safe answer. `data-kind="dialog"` is what
 * gives that descent its safe landing: with the strip's button over neither
 * answer, the dialog takes its head (Cancel) rather than the nearest one.
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
  // The panel is its own focus region, a sibling of the window's strip. Its
  // answers are items of this region, so the D-pad crosses down from the strip
  // into them and up from them back to the strip; without it the answers would
  // be items of the level root, which the chrome (a child region) cannot reach
  // on the way back down (#125).
  const region = `dialog:${titleId}`;

  return (
    <div className="kit-dialog-scrim">
      <div
        className="kit-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-region={region}
        data-kind="dialog"
        data-label={title}
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
