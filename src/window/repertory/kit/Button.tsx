import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cx } from "./cx";
import { PendingSpinner } from "./PendingSpinner";

/**
 * How a button reads: the brass primary, the brass-ink secondary, the quiet
 * ghost. `danger` is an ink colour, not a variant: the confirming side of a
 * destructive question is a primary in red.
 */
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
 * The repertory button: a line of type with a rule under it.
 *
 * `primary` is the one brass fill and always carries ink, never ivory (ivory on
 * brass is 1.95:1). `secondary` is brass ink with a rule; `ghost` is the quiet
 * action. A danger primary is the only red fill, and it carries ink too. Focus
 * is the shared ivory keyline — no fill inversion, no lift.
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
      className={cx("rep-kit-button", className)}
      data-focusable
      data-variant={variant}
      data-tone={danger ? "danger" : undefined}
      aria-pressed={pressed}
      aria-busy={pending || undefined}
      disabled={disabled || pending}
    >
      {pending ? <PendingSpinner /> : null}
      {children}
    </button>
  );
}
