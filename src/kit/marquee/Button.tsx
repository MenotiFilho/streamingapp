import type { ComponentPropsWithRef, ReactNode } from "react";

import { defaultIconWeight } from "./controlIcons";
import { cx } from "./cx";
import { Icon, type IconName, type IconWeight } from "./icons";

export type ButtonKind = "primary" | "secondary" | "ghost" | "danger";

/** `lg` is the mockup's L (60), `md` its M (48). */
export type ButtonSize = "lg" | "md";

export type ButtonProps = Omit<ComponentPropsWithRef<"button">, "children"> & {
  kind?: ButtonKind;
  size?: ButtonSize;
  /** An optional leading glyph. */
  icon?: IconName;
  /** Defaults to fill for transport, bold for a check, regular otherwise. */
  iconWeight?: IconWeight;
  /** Draw the focus treatment whatever the input modality says. */
  focused?: boolean;
  children: ReactNode;
};

/**
 * The Marquee pill button (sheet C1). Lavender is the primary action at rest,
 * glass the secondary, red the destructive one. Navigation focus turns every
 * kind white with ink content (`docs/design-system.md` §5).
 */
export function Button({
  kind = "secondary",
  size = "lg",
  icon,
  iconWeight,
  focused,
  className,
  children,
  type = "button",
  ...button
}: ButtonProps) {
  return (
    <button
      {...button}
      type={type}
      className={cx("mq-button", className)}
      data-focusable
      data-focused={focused ? "true" : undefined}
      data-kind={kind}
      data-size={size}
    >
      {icon ? (
        <Icon
          name={icon}
          weight={iconWeight ?? defaultIconWeight(icon)}
          className="mq-button-icon"
        />
      ) : null}
      <span className="mq-button-label">{children}</span>
    </button>
  );
}
