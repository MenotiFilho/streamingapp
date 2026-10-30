import type { ComponentPropsWithoutRef } from "react";

import { cx } from "./cx";

export type PosterCardProps = Omit<ComponentPropsWithoutRef<"button">, "children" | "name"> & {
  /** The Title's name, the card's only running text. */
  name: string;
  /** The poster art. Absent art becomes a typographic plate, never a grey box. */
  poster?: string | null;
  /**
   * The surface the card is drawn on. The repertory kit always draws the
   * repertory anatomy; the prop stays because the Velvet screens pass it, and
   * an accepted value is not a second drawing.
   */
  variant?: "velvet" | "repertory";
  /** The Addon's rating, stamped over the art only when the Host has one. */
  rating?: string | null;
  /** The year, read as a small mono stamp after the name. */
  subtitle?: string | null;
  /**
   * The item's own description. The repertory card does not draw it: the
   * record gives a poster caption two lines and the Title alone runs there
   * (design record §8).
   */
  description?: string | null;
  /** An Unmapped Title keeps its brass mark; unmapped is a mark, not a hiding. */
  unmapped?: boolean;
  /**
   * A Title no configured Addon could answer for is marked, not hidden: it can
   * still be opened for what TMDB knows (ADR-0020).
   */
  unplayable?: boolean;
  /** A stable id for a screen's tests. */
  testId?: string;
};

/**
 * One unframed 2:3 poster card: the art, the Title in sans under it, the year
 * as a small mono stamp after the name, and the rating and status marks over
 * the art. The focus keyline is drawn inside the art's edge so a scrollport
 * never crops it, and a brass spotlight wash appears on the focused art only.
 * It is a button because a press opens the Title.
 */
export function PosterCard({
  name,
  poster,
  variant = "repertory",
  rating,
  subtitle,
  description: _description,
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
      className={cx("rep-kit-poster", className)}
      data-focusable
      data-variant={variant}
      data-testid={testId}
      data-unmapped={unmapped ? "true" : undefined}
      data-unplayable={unplayable ? "true" : undefined}
    >
      <span className="rep-kit-poster-art" data-aspect="2:3">
        {poster ? (
          <img className="rep-kit-poster-image" src={poster} alt="" loading="lazy" />
        ) : (
          <span className="rep-kit-poster-plate" aria-hidden="true">
            {name}
          </span>
        )}
        {rating ? <span className="rep-kit-poster-rating">{`IMDb ${rating}`}</span> : null}
        {unmapped ? <span className="rep-kit-poster-unmapped">Unmapped</span> : null}
        {unplayable ? <span className="rep-kit-poster-unplayable">Unplayable</span> : null}
      </span>
      <span className="rep-kit-poster-caption">
        <span className="rep-kit-poster-name">{name}</span>
        {subtitle ? <span className="rep-kit-poster-year">{subtitle}</span> : null}
      </span>
    </button>
  );
}
