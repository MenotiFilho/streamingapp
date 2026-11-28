import type { ComponentPropsWithRef } from "react";

import { defaultIconWeight } from "./controlIcons";
import { forcedFocus } from "./controlsFocus";
import { cx } from "./cx";
import { Icon, type IconName, type IconWeight } from "./icons";

/**
 * `glass` is the mockup's secondary; `solid` is its opaque stand-in for places
 * a translucent circle would not read.
 */
export type IconButtonKind = "solid" | "glass" | "ghost" | "primary" | "danger";

/** `lg` is the mockup's XL (80), `md` its L (56), `sm` its M (48). */
export type IconButtonSize = "lg" | "md" | "sm";

export type IconButtonProps = Omit<
  ComponentPropsWithRef<"button">,
  "children" | "aria-label"
> & {
  icon: IconName;
  /** The accessible name: the control has no text of its own. */
  label: string;
  kind?: IconButtonKind;
  size?: IconButtonSize;
  iconWeight?: IconWeight;
  /** Draw the focus treatment whatever the input modality says. */
  focused?: boolean;
};

/** A circular control for back, close, transport and the player's menus. */
export function IconButton({
  icon,
  label,
  kind = "glass",
  size = "md",
  iconWeight,
  focused,
  className,
  type = "button",
  ...button
}: IconButtonProps) {
  return (
    <button
      {...button}
      type={type}
      className={cx("mq-icon-button", className)}
      aria-label={label}
      data-focusable
      data-focused={forcedFocus({ focused, disabled: button.disabled })}
      data-kind={kind}
      data-size={size}
    >
      <Icon
        name={icon}
        weight={iconWeight ?? defaultIconWeight(icon)}
        className="mq-icon-button-icon"
      />
    </button>
  );
}
