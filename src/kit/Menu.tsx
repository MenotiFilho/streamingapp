import { Fragment, type ReactNode } from "react";

import { cx } from "./cx";
import { PendingSpinner } from "./PendingSpinner";

export type MenuGroupProps = {
  /** The mono caps label over the group's rows. */
  title: string;
  children: ReactNode;
};

/**
 * One headed group of menu rows: a popover's section on the window and a
 * sheet's section on the Remote. The gate marker `data-group` is the window's
 * focus contract and is inert elsewhere.
 */
export function MenuGroup({ title, children }: MenuGroupProps) {
  return (
    <div className="rep-kit-menu-group">
      <h3 className="rep-kit-menu-group-title" data-group>
        {title}
      </h3>
      {children}
    </div>
  );
}

export type MenuRowProps = {
  /** The accessible name, where the visible text is a glyph. */
  label?: string;
  /** The row's own words. */
  children?: ReactNode;
  /** The container's marks about a choice — embedded, forced, default. */
  marks?: string[];
  /** A choice's state; `false` still announces a choice, `undefined` is an action. */
  pressed?: boolean;
  disabled?: boolean;
  /** Whether the Action this row asked for is still in flight (#137). */
  pending?: boolean;
  onPress?: () => void;
  testId?: string;
  className?: string;
};

/**
 * One full-width menu row: a real button, a hairline apart from its neighbours,
 * with the kit's ivory keyline and no fill inversion. A choice announces
 * `aria-pressed`; an action leaves it off.
 */
export function MenuRow({
  label,
  children,
  marks,
  pressed,
  disabled,
  pending = false,
  onPress,
  testId,
  className,
}: MenuRowProps) {
  return (
    <button
      type="button"
      className={cx("rep-kit-menu-row", className)}
      data-focusable
      data-testid={testId}
      aria-label={label}
      aria-pressed={pressed}
      aria-busy={pending || undefined}
      disabled={disabled || pending}
      onClick={onPress}
    >
      <span className="rep-kit-menu-row-label">{children}</span>
      {marks && marks.length > 0 ? (
        <span className="rep-kit-menu-row-marks">{marks.join(" · ")}</span>
      ) : null}
      {pending ? <PendingSpinner /> : null}
    </button>
  );
}

export type MenuReadoutProps = {
  /** The accessible name, where the visible text is not one. */
  label?: string;
  /** A single line of readout. */
  value?: ReactNode;
  /** The Player's statistics, as label/value pairs. */
  lines?: ReadonlyArray<{ label: string; value: string }>;
  testId?: string;
};

/**
 * A readout: a value the Player published, never a press. The statistics lines
 * are the one readout with structure — a definition list, so a screen reader
 * reads each label with its number.
 */
export function MenuReadout({ label, value, lines, testId }: MenuReadoutProps) {
  if (lines) {
    return (
      <dl className="rep-kit-menu-statistics" data-testid={testId} aria-label={label}>
        {lines.map((line) => (
          <Fragment key={line.label}>
            <dt>{line.label}</dt>
            <dd>{line.value}</dd>
          </Fragment>
        ))}
      </dl>
    );
  }

  return (
    <p className="rep-kit-menu-readout" data-testid={testId} aria-label={label}>
      {value}
    </p>
  );
}
