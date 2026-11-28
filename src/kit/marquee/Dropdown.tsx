import { AnimatePresence } from "motion/react";
import { useLayoutEffect, useRef } from "react";

import { cx } from "./cx";
import { DropdownMenu, type DropdownOption } from "./DropdownMenu";
import { Icon } from "./icons";

export type DropdownProps = {
  /** What it filters: the faint words before the value, and its accessible name. */
  label: string;
  /** Omit the faint words, as the phone does. */
  hideLabel?: boolean;
  options: ReadonlyArray<DropdownOption>;
  /** The chosen option's id. */
  selected: string;
  /** Whether its menu is down. The caller holds it, so Back can close it. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (id: string) => void;
  /** Draw the pill focused, for a caller that holds the focus itself. */
  focused?: boolean;
  className?: string;
};

/**
 * A filter that holds one value: a pill that drops its menu under itself.
 * Choosing closes the menu and puts the focus back on the pill, and so does the
 * caller closing it while the focus is inside.
 */
export function Dropdown({
  label,
  hideLabel = false,
  options,
  selected,
  open,
  onOpenChange,
  onSelect,
  focused,
  className,
}: DropdownProps) {
  const trigger = useRef<HTMLButtonElement>(null);
  const drop = useRef<HTMLDivElement>(null);
  const value = options.find((option) => option.id === selected)?.label ?? "";

  // The caller closed it (Back): the menu is on its way out and can hold no
  // focus. A focus that is already elsewhere stays there.
  useLayoutEffect(() => {
    if (!open && drop.current?.contains(document.activeElement)) {
      trigger.current?.focus();
    }
  }, [open]);

  return (
    <div className={cx("mq-c7-dropdown", className)}>
      <button
        ref={trigger}
        type="button"
        className="mq-c7-dropdown-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${value}`}
        data-focusable
        data-focused={focused || undefined}
        onClick={() => onOpenChange(!open)}
      >
        {hideLabel ? null : <span className="mq-c7-dropdown-label">{label}</span>}
        <span className="mq-c7-dropdown-value">{value}</span>
        <Icon name="caret-down" size="calc(var(--mq-u) * 18)" className="mq-c7-dropdown-caret" />
      </button>
      <AnimatePresence>
        {open ? (
          <div key="menu" ref={drop} className="mq-c7-dropdown-drop">
            <DropdownMenu
              label={label}
              options={options}
              selected={selected}
              autoFocus
              onSelect={(id) => {
                trigger.current?.focus();
                onSelect(id);
                onOpenChange(false);
              }}
            />
          </div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
