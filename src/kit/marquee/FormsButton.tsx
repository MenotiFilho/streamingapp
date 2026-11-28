/**
 * The buttons C7's components draw inside themselves, at C1's geometry: the
 * L and M pill and the M icon circle.
 *
 * Private to Kit C (#368). The public Button and Icon button are Kit A's, built
 * beside this; nothing outside C7 should import these.
 */

import type { ButtonHTMLAttributes, Ref } from "react";

import { cx } from "./cx";
import { Icon, type IconName } from "./icons";

type NativeProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type">;

export type FormsButtonProps = NativeProps & {
  kind: "primary" | "secondary" | "danger";
  size: "L" | "M";
  icon?: IconName | null;
  /** Draw it focused, for a caller that holds the focus itself. */
  focused?: boolean;
  ref?: Ref<HTMLButtonElement>;
};

export function FormsButton({
  kind,
  size,
  icon,
  focused,
  className,
  children,
  ...rest
}: FormsButtonProps) {
  return (
    <button
      {...rest}
      type="button"
      className={cx("mq-c7-btn", className)}
      data-kind={kind}
      data-size={size}
      data-focusable
      data-focused={(focused && !rest.disabled) || undefined}
    >
      {icon ? (
        <Icon name={icon} size={`calc(var(--mq-u) * ${size === "L" ? 22 : 18})`} />
      ) : null}
      {children}
    </button>
  );
}

export type FormsIconButtonProps = NativeProps & {
  /** The accessible name: the circle carries a glyph and no words. */
  label: string;
  icon: IconName;
  focused?: boolean;
  ref?: Ref<HTMLButtonElement>;
};

export function FormsIconButton({
  label,
  icon,
  focused,
  className,
  ...rest
}: FormsIconButtonProps) {
  return (
    <button
      {...rest}
      type="button"
      className={cx("mq-c7-icon-btn", className)}
      aria-label={label}
      data-focusable
      data-focused={(focused && !rest.disabled) || undefined}
    >
      <Icon name={icon} size="calc(var(--mq-u) * 22)" />
    </button>
  );
}
