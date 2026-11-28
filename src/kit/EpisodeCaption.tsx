import { cx } from "./cx";

export type EpisodeCaptionProps = {
  /** The episode's number; drawn as the `EPISODE N` overline. */
  episode?: number | null;
  title: string;
  /** The date and length line, already formatted. */
  note?: string | null;
  /** The episode's own description, two lines at most. */
  description?: string | null;
  className?: string;
};

/**
 * What sits under an episode card (sheet C3). Placed straight after the card,
 * it moves down by the card's growth while that card shows focus.
 */
export function EpisodeCaption({
  episode,
  title,
  note,
  description,
  className,
}: EpisodeCaptionProps) {
  return (
    <div className={cx("mq-episode-caption", className)}>
      {episode === null || episode === undefined ? null : (
        <p className="mq-episode-caption-number">Episode {episode}</p>
      )}
      <p className="mq-episode-caption-title">{title}</p>
      {note ? <p className="mq-episode-caption-note">{note}</p> : null}
      {description ? (
        <p className="mq-episode-caption-description">{description}</p>
      ) : null}
    </div>
  );
}
