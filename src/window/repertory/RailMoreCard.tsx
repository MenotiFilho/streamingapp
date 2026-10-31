import { Icon } from "../../kit/icons";

export type RailMoreCardProps = {
  /** The row this card opens; its accessible name is `More <title>`. */
  title: string;
  /** The plate's shape: a poster rail's 2:3, Continue watching's 16:9. */
  aspect: "2:3" | "16:9";
  /** A stable id for a screen's tests. */
  testId?: string;
  onClick: () => void;
};

/**
 * The card at the foot of a rail that opens the whole row.
 *
 * It is drawn as one more card — the same 2:3 or 16:9 plate, focus keyline and
 * spotlight wash as the cards beside it — with the programme's grid mark where
 * a poster would be. It carries its own accessible name so the half card at
 * the rail's edge says what it opens, not merely "More".
 */
export function RailMoreCard({ title, aspect, testId, onClick }: RailMoreCardProps) {
  const label = `More ${title}`;
  const plate = (
    <span className="rep-more-plate" aria-hidden="true">
      <Icon name="more" className="rep-more-mark" />
    </span>
  );

  if (aspect === "16:9") {
    return (
      <button
        type="button"
        className="rep-kit-continue rep-more-card"
        data-focusable
        data-testid={testId}
        aria-label={label}
        onClick={onClick}
      >
        <span className="rep-kit-continue-art" data-aspect="16:9">
          <span className="rep-kit-continue-plate">{plate}</span>
        </span>
        <span className="rep-kit-continue-note">The whole row</span>
        <span className="rep-kit-continue-name">More</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      className="rep-kit-poster rep-more-card"
      data-focusable
      data-testid={testId}
      aria-label={label}
      onClick={onClick}
    >
      <span className="rep-kit-poster-art" data-aspect="2:3">
        <span className="rep-kit-poster-plate">{plate}</span>
      </span>
      <span className="rep-kit-poster-caption">
        <span className="rep-kit-poster-name">More</span>
      </span>
    </button>
  );
}
