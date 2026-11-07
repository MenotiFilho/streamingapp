import type { ReactNode, Ref } from "react";

import { explain, type ActionError } from "../../core/errors";
import { Button } from "../../kit/Button";
import { RailGridHead } from "./RailGridHead";

/**
 * One editorial row opened as a whole: the cards the rail has read so far in
 * a wrapping grid, reached from the rail's More card (design record §8).
 *
 * It is a pushed level, so Back pops it to the More card that opened it and the
 * frame restores that card's focus. A feed grid is not a second read: its cards
 * come from the Session row the rail draws, and `FeedGrid` is what pages it on
 * (#264). A failure stays printed under the cards it did not replace, with the
 * one Try again the person pressed for.
 */
export function EditorialGrid({
  title,
  index,
  tag,
  failure,
  note,
  retry = false,
  onClose,
  onRetry,
  testId,
  containerRef,
  children,
}: {
  title: string;
  index?: string;
  tag?: string | null;
  failure?: ActionError | null;
  note?: string | null;
  /** Whether a failed page offers Try again — `gridPaging`'s decision. */
  retry?: boolean;
  onClose: () => void;
  /** Ask the failed page again; only a retry offers this. */
  onRetry?: () => void;
  testId?: string;
  /** The grid's root, so a paging trigger can measure its last card. */
  containerRef?: Ref<HTMLElement>;
  children: ReactNode;
}) {
  return (
    <section
      ref={containerRef}
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
      {retry && onRetry ? (
        <Button variant="ghost" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
      {note ? <p className="rep-rail-grid-note">{note}</p> : null}
    </section>
  );
}
