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
  /** The 16:9 backdrop art. Absent art becomes a typographic plate. */
  art?: string | null;
  /** How far through the Video the Host's record is, from 0 to 1; null hides the bar. */
  progress?: number | null;
  /** An entry whose Addon is gone: marked, dimmed, and not pressable. */
  unplayable?: boolean;
  /** A stable id for a screen's tests. */
  testId?: string;
};

/**
 * One 16:9 Continue watching card: the still, a 2px brass progress line under
 * it, the mono note (remaining time or episode), then the Title in sans. An
 * entry whose Addon was removed keeps its picture, takes the status-red stamp,
 * and is not a target: it is a mark, not a hiding.
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
    progress === null || progress === undefined || !Number.isFinite(progress)
      ? null
      : Math.max(0, Math.min(1, progress));

  return (
    <button
      {...button}
      type="button"
      className={cx("rep-kit-continue", className)}
      // A card a person cannot press is not a target for the focus engine.
      data-focusable={unplayable ? undefined : true}
      data-testid={testId}
      data-unplayable={unplayable ? "true" : undefined}
      disabled={unplayable || disabled}
    >
      <span className="rep-kit-continue-art" data-aspect="16:9">
        {art ? (
          <img className="rep-kit-continue-image" src={art} alt="" loading="lazy" />
        ) : (
          <span className="rep-kit-continue-plate" aria-hidden="true">
            {name}
          </span>
        )}
        {unplayable ? (
          <span className="rep-kit-continue-unplayable">Unplayable</span>
        ) : null}
      </span>

      {fraction !== null ? (
        <span
          className="rep-kit-continue-progress"
          data-testid={testId ? `${testId}-progress` : undefined}
          role="progressbar"
          aria-label={`Watch progress for ${name}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(fraction * 100)}
        >
          <span style={{ width: `${Math.round(fraction * 100)}%` }} />
        </span>
      ) : null}

      <span className="rep-kit-continue-note">{note}</span>
      <span className="rep-kit-continue-name">{name}</span>
    </button>
  );
}
