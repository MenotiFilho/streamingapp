import type { ComponentPropsWithoutRef } from "react";

import { cx } from "./cx";

export type ContinueWatchingCardProps = Omit<
  ComponentPropsWithoutRef<"button">,
  "children" | "name"
> & {
  /** The Title's name, with the episode beside it where the Video is one. */
  name: string;
  /** What the Host's record says: how much is left, `Watched`, or why it is unplayable. */
  note: string;
  /** The 16:9 backdrop art. Absent art leaves the stage-coloured frame. */
  art?: string | null;
  /** How far through the Video the Host's record is, from 0 to 1; null hides the bar. */
  progress?: number | null;
  /** An entry whose Addon is gone: dashes, dims, and cannot be pressed. */
  unplayable?: boolean;
  /** A stable id for a screen's tests. */
  testId?: string;
};

/**
 * One 16:9 Continue watching card: backdrop art with the crimson progress bar
 * along its foot, the Title under it, and where the Video was left in tabular
 * figures. The unplayable treatment is dashed and dimmed, and the card is a
 * button a person cannot press — a mark, not a hiding.
 */
export function ContinueWatchingCard({
  name,
  note,
  art,
  progress,
  unplayable = false,
  testId,
  className,
  disabled,
  ...button
}: ContinueWatchingCardProps) {
  const fraction =
    progress === null || progress === undefined ? null : Math.max(0, Math.min(1, progress));

  return (
    <button
      {...button}
      type="button"
      className={cx("kit-continue", "kit-focus-lift", className)}
      // A card a person cannot press is not a target for the focus engine.
      data-focusable={unplayable ? undefined : true}
      data-testid={testId}
      data-unplayable={unplayable ? "true" : undefined}
      disabled={unplayable || disabled}
    >
      <span className="kit-continue-art-frame" data-aspect="16:9">
        {art ? (
          <img className="kit-continue-art" src={art} alt="" loading="lazy" />
        ) : (
          <span className="kit-continue-art kit-continue-art-empty" aria-hidden="true" />
        )}
        {fraction !== null ? (
          <span
            className="kit-continue-progress"
            data-testid={testId ? `${testId}-progress` : undefined}
            aria-hidden="true"
          >
            <span style={{ width: `${Math.round(fraction * 100)}%` }} />
          </span>
        ) : null}
      </span>
      <span className="kit-continue-info">
        <span className="kit-continue-name">{name}</span>
        <span
          className={
            unplayable ? "kit-continue-note kit-continue-note-warn" : "kit-continue-note kit-tabular"
          }
        >
          {note}
        </span>
      </span>
    </button>
  );
}
