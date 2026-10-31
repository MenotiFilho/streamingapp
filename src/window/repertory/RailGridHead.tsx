import { Button } from "../../kit/Button";

/**
 * The head of a whole-row grid: the programme's index, the row's name, its
 * rule and bookkeeping, then Back. Home's catalog grid and an editorial feed's
 * grid open the same way; only the editorial grid takes focus on Back when it
 * arrives (design record §8).
 */
export function RailGridHead({
  title,
  index,
  tag,
  onClose,
  autoFocus = false,
}: {
  title: string;
  index?: string;
  tag?: string | null;
  onClose: () => void;
  autoFocus?: boolean;
}) {
  return (
    <header className="rep-rail-grid-head">
      {index ? <span className="rep-rail-grid-index">{index}</span> : null}
      <h2 className="rep-rail-grid-title">{title}</h2>
      <span className="rep-rail-grid-rule" aria-hidden="true" />
      {tag ? <span className="rep-rail-grid-tag">{tag}</span> : null}
      <Button
        variant="ghost"
        className="rep-rail-grid-close"
        autoFocus={autoFocus}
        onClick={onClose}
      >
        Back
      </Button>
    </header>
  );
}
