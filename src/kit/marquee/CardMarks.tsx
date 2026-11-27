import { Icon } from "./icons";
import { clampFraction } from "./progressValue";

/** The check on an ink disc at a card's top right. */
export function WatchedMark() {
  return (
    <span className="mq-card-watched" aria-hidden="true">
      <Icon name="check" weight="bold" className="mq-card-watched-check" />
    </span>
  );
}

/** The watch progress along a card's foot; nothing where there is no reading. */
export function CardProgress({
  name,
  progress,
}: {
  name: string;
  progress: number | null | undefined;
}) {
  const fraction = clampFraction(progress);
  if (fraction === null) {
    return null;
  }

  return (
    <span
      className="mq-card-progress"
      role="progressbar"
      aria-label={`Watch progress for ${name}`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(fraction * 100)}
    >
      <span className="mq-card-progress-fill" style={{ width: `${fraction * 100}%` }} />
    </span>
  );
}
