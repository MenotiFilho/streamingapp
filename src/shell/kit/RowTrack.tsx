import { Children, isValidElement, useId, type ReactNode } from "react";

import { cx } from "./cx";

export type RowTrackProps = {
  /** The row's heading: a Catalog's name, or `Continue watching`. */
  title: string;
  /** The Addon attribution beside the heading, where the row has one. */
  tag?: string | null;
  /** The `More` control, where the row can page on. */
  action?: ReactNode;
  /** The cards. Each becomes one item in the horizontal track. */
  children: ReactNode;
  className?: string;
  /** A stable id for a screen's tests. */
  testId?: string;
};

/**
 * One horizontal row track: a heading with its optional Addon tag and trailing
 * action, over a scrolling track of cards. The track is the carousel — it
 * scrolls rather than wraps, so a row stays one line at any window width — and
 * its block padding leaves the focus halo room to show.
 *
 * It is named `RowTrack` rather than `Row` because the browse model already
 * owns `Row` (`src/browse.ts`): a screen holds a Catalog's answer as a `Row` and
 * draws it with a `RowTrack`, and neither name is ambiguous at the call site.
 */
export function RowTrack({ title, tag, action, children, className, testId }: RowTrackProps) {
  const headingId = useId();
  const items = Children.toArray(children);

  return (
    <section
      className={cx("kit-row", className)}
      aria-labelledby={headingId}
      data-testid={testId}
    >
      <header className="kit-row-header">
        <div className="kit-row-heading-group">
          <h2 id={headingId} className="kit-row-title">
            {title}
          </h2>
          {tag ? <span className="kit-row-tag kit-tabular">{tag}</span> : null}
        </div>
        {action ? <div className="kit-row-action">{action}</div> : null}
      </header>
      <ul className="kit-row-track">
        {items.map((item, index) => {
          const key = isValidElement(item) && item.key !== null ? item.key : index;
          return (
            <li className="kit-row-item" key={key}>
              {item}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
