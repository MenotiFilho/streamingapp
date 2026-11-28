import { motion, useIsPresent } from "motion/react";
import { useId, useLayoutEffect, useRef } from "react";

import { useReducedMotion } from "../../core/react/useReducedMotion";
import { cx } from "./cx";
import { formsPanel } from "./formsMotion";
import { Icon } from "./icons";
import { fade } from "./motion";

export type DropdownOption = {
  id: string;
  label: string;
};

export type DropdownMenuProps = {
  /** The accessible name: what is being chosen. */
  label: string;
  options: ReadonlyArray<DropdownOption>;
  /** The chosen option's id. */
  selected: string;
  onSelect: (id: string) => void;
  /** Take the focus on arrival, on the chosen option. */
  autoFocus?: boolean;
  /** Draw this option focused, for a caller that holds the focus itself. */
  focusedId?: string;
  className?: string;
};

/** How far the menu travels as it arrives (`docs/design-system.md` §6). */
const RISE = 12;

/**
 * The list under a Dropdown: the chosen option carries the lavender check, and
 * focus is white. It pops in with a short rise and a fade, and takes no focus
 * once it is on its way out.
 */
export function DropdownMenu({
  label,
  options,
  selected,
  onSelect,
  autoFocus = false,
  focusedId,
  className,
}: DropdownMenuProps) {
  const id = useId();
  const present = useIsPresent();
  const reduced = useReducedMotion();
  // The chosen option is where a person starts; a value no option names falls
  // back to the first, so the menu never arrives with nothing focused.
  const start = options.some((option) => option.id === selected) ? selected : options[0]?.id;
  const first = useRef<HTMLButtonElement>(null);

  // On each arrival, including one that interrupts its own way out. Not on a
  // later render: the person may have walked on to another option.
  useLayoutEffect(() => {
    if (autoFocus && present) {
      first.current?.focus();
    }
  }, [autoFocus, present]);

  return (
    <motion.div
      className={cx("mq-c7-menu", className)}
      role="listbox"
      aria-label={label}
      data-region={`menu:${id}`}
      data-kind="branch"
      data-label={label}
      inert={present ? undefined : true}
      initial={{ opacity: 0, y: RISE }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: RISE }}
      transition={{ ...formsPanel(reduced), opacity: fade() }}
    >
      {options.map((option) => {
        const chosen = option.id === selected;
        return (
          <button
            key={option.id}
            ref={option.id === start ? first : undefined}
            type="button"
            role="option"
            aria-selected={chosen}
            className="mq-c7-menu-option"
            data-focusable
            data-focused={option.id === focusedId || undefined}
            onClick={() => onSelect(option.id)}
          >
            <span className="mq-c7-ellipsis">{option.label}</span>
            {chosen ? (
              <Icon
                name="check"
                weight="bold"
                size="calc(var(--mq-u) * 20)"
                className="mq-c7-menu-check"
              />
            ) : null}
          </button>
        );
      })}
    </motion.div>
  );
}
