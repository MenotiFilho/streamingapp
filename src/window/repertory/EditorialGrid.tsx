import type { ReactNode } from "react";

import { explain, type ActionError } from "../../core/errors";
import { RailGridHead } from "./RailGridHead";

/**
 * One editorial row opened as a whole: the cards the rail has read so far in
 * a wrapping grid, reached from the rail's More card (design record §8).
 *
 * It is a pushed level, so Back pops it to the More card that opened it and the
 * frame restores that card's focus. The grid is the loaded row, not a second
 * read: the rail's own quiet action pages the feed on, and a failure stays
 * printed under the cards it did not replace.
 */
export function EditorialGrid({
  title,
  index,
  tag,
  failure,
  note,
  onClose,
  testId,
  children,
}: {
  title: string;
  index?: string;
  tag?: string | null;
  failure?: ActionError | null;
  note?: string | null;
  onClose: () => void;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <section
      className="rep-rail-grid"
      data-region="rail-grid"
      data-kind="branch"
      data-label={`All of ${title}`}
      aria-label={`All of ${title}`}
      data-testid={testId}
    >
      <RailGridHead
        title={title}
        index={index}
        tag={tag}
        onClose={onClose}
        autoFocus
      />

      <div className="rep-rail-grid-cards" data-rail="poster">
        {children}
      </div>

      {failure ? (
        <p role="alert" className="rep-rail-grid-note rep-rail-grid-note--failure">
          {explain(failure)}
        </p>
      ) : null}
      {note ? <p className="rep-rail-grid-note">{note}</p> : null}
    </section>
  );
}
