import type { CSSProperties } from "react";

import { cx } from "./cx";
import { clampFraction } from "./progressValue";

export type HeroTicksProps = {
  /** How many titles the hero turns through; under two there is nothing to mark. */
  count: number;
  /** The index of the title shown, from 0. */
  active: number;
  /** How much of the active title's time has passed, from 0 to 1. */
  progress?: number;
  /** Makes each tick a pointer control that jumps to its title. */
  onSelect?: (index: number) => void;
  /** The accessible name of each tick, in order. */
  labels?: readonly string[];
  className?: string;
};

/**
 * Which featured title the hero shows (sheet C2); the long tick fills until the
 * hero rotates. Ticks are pointer and touch furniture outside the focus order:
 * the arrows already step the hero, and a press leaves focus where it was.
 */
export function HeroTicks({
  count,
  active,
  progress = 0,
  onSelect,
  labels,
  className,
}: HeroTicksProps) {
  if (count < 2) {
    return null;
  }

  const fill = {
    "--mq-tick-progress": clampFraction(progress) ?? 0,
  } as CSSProperties;

  const ticks = Array.from({ length: count }, (_, index) => {
    const current = index === active;
    const bar = (
      <span className="mq-hero-tick" data-active={current ? "true" : undefined}>
        {current ? <span className="mq-hero-tick-fill" style={fill} /> : null}
      </span>
    );

    return onSelect ? (
      <button
        key={index}
        type="button"
        className="mq-hero-tick-button"
        tabIndex={-1}
        aria-label={labels?.[index] ?? `Show featured title ${index + 1}`}
        aria-current={current ? "step" : undefined}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onSelect(index)}
      >
        {bar}
      </button>
    ) : (
      <span key={index} className="mq-hero-tick-button">
        {bar}
      </span>
    );
  });

  return (
    <div
      className={cx("mq-hero-ticks", className)}
      {...(onSelect
        ? { role: "group", "aria-label": "Featured titles" }
        : { role: "img", "aria-label": `Featured title ${active + 1} of ${count}` })}
    >
      {ticks}
    </div>
  );
}
