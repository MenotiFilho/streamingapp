import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cx } from "./cx";

/** The status tones a chip can carry; `neutral` is the unstyled default. */
export type ChipTone = "neutral" | "accent" | "warn" | "danger" | "ok";

/** The attribute a tone writes; neutral has no attribute at all. */
function toneAttribute(tone: ChipTone): ChipTone | undefined {
  return tone === "neutral" ? undefined : tone;
}

export type ChipProps = {
  tone?: ChipTone;
  className?: string;
  children: ReactNode;
};

/** A static badge: a resolution, a warning, or the amber Unmapped mark. */
export function Chip({ tone = "neutral", className, children }: ChipProps) {
  return (
    <span className={cx("kit-chip", className)} data-tone={toneAttribute(tone)}>
      {children}
    </span>
  );
}

export type ChoiceChipProps = Omit<ComponentPropsWithoutRef<"button">, "children"> & {
  /** The selected state, announced as `aria-pressed` and drawn without a size shift. */
  pressed: boolean;
  children: ReactNode;
};

/** A chip that is a control: a season, a filter, a track choice. */
export function ChoiceChip({
  pressed,
  className,
  children,
  type = "button",
  ...button
}: ChoiceChipProps) {
  return (
    <button
      {...button}
      type={type}
      className={cx("kit-choice", "kit-focus-invert", className)}
      data-focusable
      aria-pressed={pressed}
    >
      {children}
    </button>
  );
}
