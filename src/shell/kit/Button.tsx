import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cx } from "./cx";

/** How a button reads: the accent primary, the raised secondary, the quiet ghost. */
export type ButtonVariant = "primary" | "secondary" | "ghost";

export type ButtonProps = Omit<ComponentPropsWithoutRef<"button">, "children"> & {
  variant?: ButtonVariant;
  /** Set on a toggle-like control; `false` is still a pressed state to announce. */
  pressed?: boolean;
  /** The destructive treatment a confirmation's confirming control takes. */
  danger?: boolean;
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
  className,
  children,
  type = "button",
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
      aria-pressed={pressed}
    >
      {children}
    </button>
  );
}
