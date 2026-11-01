import { useId, type ReactNode } from "react";

import { Button } from "./Button";

export type SheetProps = {
  /** Whether the sheet is on screen; a closed sheet draws nothing. */
  open: boolean;
  /** The heading, which is also the dialog's accessible name. */
  title: string;
  /** The close control's label: `Close`, `Done`. */
  closeLabel?: string;
  /** Put the sheet away: the close control, the scrim, or the client's Back. */
  onClose: () => void;
  children: ReactNode;
  testId?: string;
};

/**
 * A plate that sits on the bottom edge of the screen (ADR-0035 §2).
 *
 * The phone's one sheet primitive: a scrim, a modal panel anchored to the
 * bottom, a heading, a close control, and whatever rows the screen draws. It is
 * screen-agnostic — it knows no Host, no player and no word of either — and the
 * panel is its own focus region, so a client's Back closes the surface and the
 * focus underneath comes back where it was.
 */
export function Sheet({
  open,
  title,
  closeLabel = "Close",
  onClose,
  children,
  testId,
}: SheetProps) {
  const titleId = useId();
  // The panel is its own focus region, nested beside the screen beneath it.
  const region = `sheet:${titleId}`;

  if (!open) {
    return null;
  }

  return (
    <div className="rep-kit-sheet-scrim" onClick={onClose}>
      <div
        className="rep-kit-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-region={region}
        data-testid={testId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="rep-kit-sheet-head">
          <h2 id={titleId} className="rep-kit-sheet-title">
            {title}
          </h2>
          <Button variant="ghost" autoFocus onClick={onClose}>
            {closeLabel}
          </Button>
        </div>
        <div className="rep-kit-sheet-body">{children}</div>
      </div>
    </div>
  );
}
