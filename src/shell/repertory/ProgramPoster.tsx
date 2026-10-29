import type { MetaPreview } from "../../host-client";
import { ratingOf, yearOf } from "./program";

/**
 * One unfinished poster in the programme: the picture, the title running under
 * it, the year as a small stamp beside the title, and the Addon's rating over
 * the art. Home's rows and the editorial feeds draw the same card, so a Title
 * looks the same wherever it is met.
 *
 * A feed can mark a Title no configured Addon could play (ADR-0020). The mark
 * sits on the poster; the card still opens, because that is where a person
 * learns what TMDB knows about it.
 */
export function ProgramPoster({
  meta,
  onOpen,
  testId,
  unplayable = false,
}: {
  meta: MetaPreview;
  onOpen: () => void;
  testId?: string;
  unplayable?: boolean;
}) {
  const year = yearOf(meta);
  const rating = ratingOf(meta);
  const label = `${meta.name}${year ? `, ${year}` : ""}${rating ? `, ${rating}` : ""}${
    unplayable ? ". Unplayable by the configured Addons." : ""
  }. Open the Title.`;

  return (
    <button
      type="button"
      className="rep-card"
      data-focusable
      data-testid={testId}
      data-unplayable={unplayable ? "true" : undefined}
      onClick={onOpen}
      aria-label={label}
    >
      <span className="rep-poster">
        {meta.poster ? (
          <img src={meta.poster} alt="" loading="lazy" />
        ) : (
          <span className="rep-art-missing">{meta.name}</span>
        )}
        {rating ? <span className="rep-rating-badge">{rating}</span> : null}
        {unplayable ? <span className="rep-unplayable-badge">Unplayable</span> : null}
      </span>
      <span className="rep-caption">
        <span className="rep-caption-line">
          <span className="rep-card-title">{meta.name}</span>
          {year ? <span className="rep-year-badge">{year}</span> : null}
        </span>
      </span>
    </button>
  );
}
