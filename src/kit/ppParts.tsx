/**
 * Kit B's private parts (#367): the mockup's `Button`, `Icon button` and
 * `Badge` exactly as sheets C5 and C6 use them.
 *
 * Kit A (#366) builds the public primitives in parallel, so this sheet keeps its
 * own, prefixed `mq-pp-` to stay out of their way. Nothing outside
 * `panels-player` components should import this module.
 */

import type { ButtonHTMLAttributes, Ref } from "react";

import { cx } from "./cx";
import { Icon, type IconName, type IconWeight } from "./icons";

/** A measurement of the 1920×1080 reference frame, as a CSS length. */
export function u(measure: number): string {
  return `calc(var(--mq-u) * ${measure})`;
}

/**
 * The `data-focused` a forced focus paints. A control that refuses a press,
 * disabled or pending, takes no focus treatment.
 */
export function forcedFocus({
  focused,
  disabled,
  pending,
}: {
  focused?: boolean;
  disabled?: boolean;
  pending?: boolean;
}): "true" | undefined {
  return focused && !disabled && !pending ? "true" : undefined;
}

type ControlProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & {
  /** Draw the focus treatment whatever the input modality. */
  focused?: boolean;
  /** The Action this control asked for is still in flight. */
  pending?: boolean;
  ref?: Ref<HTMLButtonElement>;
};

export type PpKind = "primary" | "secondary" | "ghost";

const BUTTON_ICON = { L: 22, M: 18 } as const;
const ICON_BUTTON_GLYPH = { XL: 34, L: 26, M: 22 } as const;

export type PpButtonProps = ControlProps & {
  kind?: PpKind;
  size?: keyof typeof BUTTON_ICON;
  icon?: IconName;
  iconWeight?: IconWeight;
};

/** The pill button: L 60 or M 48, with an optional leading icon. */
export function PpButton({
  kind = "secondary",
  size = "M",
  icon,
  iconWeight = "regular",
  focused,
  pending = false,
  disabled,
  className,
  children,
  ...rest
}: PpButtonProps) {
  return (
    <button
      {...rest}
      type="button"
      className={cx("mq-pp-btn", className)}
      data-kind={kind}
      data-size={size}
      data-focusable
      data-focused={forcedFocus({ focused, disabled, pending })}
      aria-busy={pending || undefined}
      disabled={disabled || pending}
    >
      {icon ? <Icon name={icon} weight={iconWeight} size={u(BUTTON_ICON[size])} /> : null}
      <span>{children}</span>
    </button>
  );
}

export type PpIconButtonProps = Omit<ControlProps, "children" | "aria-label"> & {
  kind?: PpKind;
  size?: keyof typeof ICON_BUTTON_GLYPH;
  icon: IconName;
  iconWeight?: IconWeight;
  /** The accessible name: the control draws only a glyph. */
  label: string;
  /** The surface this control opens is up: it stays white. */
  open?: boolean;
};

/** The round button: XL 80, L 56 or M 48. */
export function PpIconButton({
  kind = "secondary",
  size = "L",
  icon,
  iconWeight = "regular",
  label,
  open,
  focused,
  pending = false,
  disabled,
  className,
  ...rest
}: PpIconButtonProps) {
  return (
    <button
      {...rest}
      type="button"
      className={cx("mq-pp-iconbtn", className)}
      data-kind={kind}
      data-size={size}
      data-focusable
      data-focused={forcedFocus({ focused, disabled, pending })}
      data-open={open ? "true" : undefined}
      aria-label={label}
      aria-busy={pending || undefined}
      disabled={disabled || pending}
    >
      <Icon name={icon} weight={iconWeight} size={u(ICON_BUTTON_GLYPH[size])} />
    </button>
  );
}

/** The 28u tag: a Stream's own words (`neutral`) or the one lavender state. */
export function PpBadge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: "neutral" | "accent";
  className?: string;
  children: string;
}) {
  return (
    <span className={cx("mq-pp-badge", className)} data-tone={tone}>
      {children}
    </span>
  );
}
