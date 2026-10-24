import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cx } from "./cx";
import { PendingSpinner } from "./PendingSpinner";

/** How a button reads: the accent primary, the raised secondary, the quiet ghost. */
export type ButtonVariant = "primary" | "secondary" | "ghost";

export type ButtonProps = Omit<ComponentPropsWithoutRef<"button">, "children"> & {
  variant?: ButtonVariant;
  /** Set on a toggle-like control; `false` is still a pressed state to announce. */
  pressed?: boolean;
  /** The destructive treatment a confirmation's confirming control takes. */
  danger?: boolean;
  /**
   * Whether the Action this control asked for is still in flight. A pending
   * control is disabled, announces `aria-busy`, and draws a spinner beside its
   * label — the wait a person sees instead of a press that seemed to do nothing
   * (#137).
   */
  pending?: boolean;
  children: ReactNode;
};

/**
 * The kit's button. Focus inverts it to the solid Signal Crimson fill with the
 * ivory border; a pressed button takes the crimson border and soft fill without
 * changing its box. Both are the locked focus treatment, not a screen's choice.
 */
export function Button({
  variant = "secondary",
  pressed,
  danger = false,
  pending = false,
  className,
  children,
  type = "button",
  disabled,
  ...button
}: ButtonProps) {
  return (
    <button
      {...button}
      type={type}
      className={cx("kit-button", "kit-focus-invert", className)}
      data-focusable
      data-variant={variant}
      data-tone={danger ? "danger" : undefined}
      data-pending={pending ? "true" : undefined}
      aria-pressed={pressed}
      aria-busy={pending || undefined}
      disabled={disabled || pending}
    >
      {pending ? <PendingSpinner /> : null}
      {children}
    </button>
  );
}
