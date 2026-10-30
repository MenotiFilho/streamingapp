import type { ReactNode } from "react";

export type PopoverProps = {
  /** The accessible name of the popover surface. */
  label: string;
  /** The small heading at the surface's top, where it has one. */
  heading?: ReactNode;
  /** Which edge of its anchor the surface aligns to. */
  align?: "start" | "end";
  children: ReactNode;
  testId?: string;
};

/**
 * A non-modal popover surface, anchored to the control that opened it: an
 * ink-raised plate with a 2px brass top rule, a display-serif heading, and the
 * consumer's rows beneath it. The OSD's per-icon menus and the player's track
 * lists are this primitive; the shell owns which one is open and when Back
 * closes it.
 */
export function Popover({ label, heading, align = "start", children, testId }: PopoverProps) {
  return (
    <div
      className="rep-kit-popover"
      role="dialog"
      aria-label={label}
      data-align={align}
      data-testid={testId}
    >
      {heading ? <div className="rep-kit-popover-heading">{heading}</div> : null}
      <div className="rep-kit-popover-body">{children}</div>
    </div>
  );
}
