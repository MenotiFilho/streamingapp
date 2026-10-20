import type { ComponentPropsWithoutRef } from "react";

import { cx } from "./cx";

export type PosterCardProps = Omit<ComponentPropsWithoutRef<"button">, "children" | "name"> & {
  /** The Title's name, as the card reads it under the poster. */
  name: string;
  /** The poster art. Absent art leaves the stage-coloured frame, never a broken image. */
  poster?: string | null;
  /** The year, rating or episode code under the name, read in tabular figures. */
  subtitle?: string | null;
  /**
   * The item's own description, where it has one. For a catalog of releases it
   * is often the filename — the only field that tells two entries with one
   * poster and one title apart (ADR-0010) — so it is clamped on the card and
   * carried whole in the tooltip.
   */
  description?: string | null;
  /** An Unmapped Title keeps its amber mark; unmapped is a mark, not a hiding. */
  unmapped?: boolean;
  /**
   * A Title no configured Addon could answer for is marked, not hidden: it can
   * still be opened for what TMDB knows, and the mark says why it will not play
   * (ADR-0020).
   */
  unplayable?: boolean;
  /** A stable id for a screen's tests. */
  testId?: string;
};

/**
 * One 2:3 poster card: the art, the name, an optional tabular subtitle, the
 * item's description where the source sent one, and the amber Unmapped badge.
 * It is a button because a press is how a person opens a Title, and it carries
 * `data-focusable` so the shell's focus treatment finds it.
 */
export function PosterCard({
  name,
  poster,
  subtitle,
  description,
  unmapped = false,
  unplayable = false,
  testId,
  className,
  ...button
}: PosterCardProps) {
  return (
    <button
      {...button}
      type="button"
      className={cx("kit-poster", "kit-focus-lift", className)}
      data-focusable
      data-testid={testId}
      data-unmapped={unmapped ? "true" : undefined}
      data-unplayable={unplayable ? "true" : undefined}
    >
      <span className="kit-poster-art-frame" data-aspect="2:3">
        {poster ? (
          <img className="kit-poster-art" src={poster} alt="" loading="lazy" />
        ) : (
          <span className="kit-poster-art kit-poster-art-empty" aria-hidden="true" />
        )}
        {unmapped ? <span className="kit-badge-unmapped">Unmapped</span> : null}
        {unplayable ? <span className="kit-badge-unplayable">Unplayable</span> : null}
      </span>
      <span className="kit-poster-info">
        <span className="kit-poster-name">{name}</span>
        {subtitle ? <span className="kit-poster-sub kit-tabular">{subtitle}</span> : null}
        {description ? (
          <span className="kit-poster-note" title={description}>
            {description}
          </span>
        ) : null}
      </span>
    </button>
  );
}
