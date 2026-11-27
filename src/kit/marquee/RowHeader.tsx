import type { ComponentPropsWithRef } from "react";

import { cx } from "./cx";

export type RowHeaderProps = Omit<ComponentPropsWithRef<"div">, "children" | "title"> & {
  title: string;
  /** The Addon the row comes from. */
  source?: string | null;
};

/** The head over every row (sheet C3). */
export function RowHeader({ title, source, className, ...div }: RowHeaderProps) {
  return (
    <div {...div} className={cx("mq-row-header", className)}>
      <h2 className="mq-row-header-title">{title}</h2>
      {source ? <span className="mq-row-header-source">{source}</span> : null}
    </div>
  );
}
