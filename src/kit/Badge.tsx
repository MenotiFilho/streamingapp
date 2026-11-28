import type { ComponentPropsWithRef, ReactNode } from "react";

import { cx } from "./cx";

export type BadgeTone = "neutral" | "accent" | "imdb" | "ok" | "warn" | "danger";

export type BadgeProps = Omit<ComponentPropsWithRef<"span">, "children"> & {
  tone?: BadgeTone;
  /** Printed verbatim: an Addon's own words are never re-cased. */
  children: ReactNode;
};

/** A stream fact, tag or state. A mark, never a control. */
export function Badge({ tone = "neutral", className, children, ...span }: BadgeProps) {
  return (
    <span {...span} className={cx("mq-badge", className)} data-tone={tone}>
      {children}
    </span>
  );
}
