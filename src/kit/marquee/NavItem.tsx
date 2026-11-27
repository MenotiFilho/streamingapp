import type { ComponentPropsWithRef } from "react";

import { navIconWeight } from "./controlIcons";
import { useShownFocus } from "./controlsFocus";
import { cx } from "./cx";
import { Icon, type IconName } from "./icons";

export type NavItemProps = Omit<
  ComponentPropsWithRef<"button">,
  "children" | "aria-label" | "aria-current"
> & {
  icon: IconName;
  /** The destination's name: drawn when expanded, and always the accessible name. */
  label: string;
  /** The 280px pill with its label, rather than the 56px circle. */
  expanded?: boolean;
  /** The destination being shown: lavender, and `aria-current="page"`. */
  active?: boolean;
  /** Draw the focus treatment whatever the input modality says. */
  focused?: boolean;
};

/** One destination of the rail (sheet C2). Active is lavender, focus is white. */
export function NavItem({
  icon,
  label,
  expanded = false,
  active = false,
  focused,
  className,
  type = "button",
  onFocus,
  onBlur,
  ...button
}: NavItemProps) {
  const focus = useShownFocus<HTMLButtonElement>({ focused, onFocus, onBlur });

  return (
    <button
      {...button}
      {...focus.focusProps}
      type={type}
      className={cx("mq-nav-item", className)}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      data-focusable
      data-expanded={expanded ? "true" : "false"}
    >
      <Icon
        name={icon}
        weight={navIconWeight({ active, focusShown: focus.shown })}
        className="mq-nav-item-icon"
      />
      <span className="mq-nav-item-label" aria-hidden="true">
        {label}
      </span>
    </button>
  );
}
