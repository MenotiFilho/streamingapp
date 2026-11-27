import type { ComponentPropsWithRef, ReactNode } from "react";

import { cx } from "./cx";
import { Icon } from "./icons";

export type ChipProps = Omit<
  ComponentPropsWithRef<"button">,
  "children" | "aria-pressed"
> & {
  /** Announced as `aria-pressed`; a chosen chip is lavender and keeps a check. */
  selected: boolean;
  /** Draw the focus treatment whatever the input modality says. */
  focused?: boolean;
  children: ReactNode;
};

/**
 * A filter or season chip (sheet C1). Selection is not focus: a chosen chip
 * that also has focus turns white and keeps its check.
 */
export function Chip({
  selected,
  focused,
  className,
  children,
  type = "button",
  ...button
}: ChipProps) {
  return (
    <button
      {...button}
      type={type}
      className={cx("mq-chip", className)}
      aria-pressed={selected}
      data-focusable
      data-focused={focused ? "true" : undefined}
    >
      {selected ? <Icon name="check" weight="bold" className="mq-chip-check" /> : null}
      <span className="mq-chip-label">{children}</span>
    </button>
  );
}
