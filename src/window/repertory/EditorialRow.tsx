import { Children, type ReactNode } from "react";

import { explain, type ActionError } from "../../core/errors";
import { Button } from "../../kit/Button";
import { RowTrack } from "../RowTrack";
import { RAIL_PAGE, RAIL_VISIBLE } from "./rail";
import { RailMoreCard } from "./RailMoreCard";

/**
 * One editorial feed row: Home's rail anatomy under a programme's numbered
 * head, with the row's own paging action and the failure that replaced a page.
 *
 * The row owns its paging and its failure (design record §8): a page that did
 * not answer leaves the cards already read where they are and prints its reason
 * under this row alone, never as the window's one alert. The rail scrolls with
 * Home's motion; the quiet action beside the head asks the next page of the
 * feed, and the More card at the rail's end opens the loaded row as a grid.
 */
export function EditorialRow({
  title,
  index,
  tag,
  action,
  failure,
  note,
  region,
  onOpenRow,
  testId,
  children,
}: {
  title: string;
  index?: string;
  tag?: string | null;
  action?: ReactNode;
  failure?: ActionError | null;
  note?: string | null;
  /** The row's identity in the focus model. */
  region: string;
  /** Open the row's loaded cards as a pushed grid, where it has any. */
  onOpenRow?: () => void;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <div
      className="rep-feed-row"
      data-region={region}
      data-kind="row"
      data-label={title}
      data-testid={testId}
    >
      <RowTrack
        title={title}
        index={index}
        tag={tag}
        action={action}
        columns={RAIL_VISIBLE}
        page={RAIL_PAGE}
      >
        {children}
        {onOpenRow && Children.count(children) > 0 ? (
          <RailMoreCard
            key="more"
            title={title}
            aspect="2:3"
            testId={`more-${region}`}
            onClick={onOpenRow}
          />
        ) : null}
      </RowTrack>
      {failure ? (
        <p role="alert" className="rep-feed-failure">
          {explain(failure)}
        </p>
      ) : null}
      {note ? <p className="rep-feed-note">{note}</p> : null}
    </div>
  );
}

/**
 * A feed row's paging action: the next page when there is one, or the failed
 * page again. The control is quiet; the wait disables it rather than drawing a
 * spinner on a line a person can still read (design record §9).
 */
export function FeedPagingAction({
  failure,
  more,
  loading,
  onMore,
}: {
  failure?: ActionError | null;
  more: boolean;
  loading: boolean;
  onMore: () => void;
}) {
  if (!failure && !more) {
    return null;
  }
  return (
    <Button variant="ghost" disabled={loading} onClick={onMore}>
      {failure ? "Try again" : "Read on"}
    </Button>
  );
}
