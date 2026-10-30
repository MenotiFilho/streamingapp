import type { ReactNode } from "react";

import { explain, type ActionError } from "../../host-client";
import { FEED_RAIL_PAGE, FEED_RAIL_VISIBLE } from "./editorial";
import { RowTrack } from "./kit";

/**
 * One editorial feed row: Home's rail anatomy under a programme's numbered
 * head, with the row's own paging action and the failure that replaced a page.
 *
 * The row owns its paging and its failure (design record §8): a page that did
 * not answer leaves the cards already read where they are and prints its reason
 * under this row alone, never as the window's one alert. The rail scrolls with
 * Home's motion; the action beside the head asks the next page of the feed.
 */
export function EditorialRow({
  title,
  index,
  tag,
  action,
  failure,
  note,
  region,
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
        columns={FEED_RAIL_VISIBLE}
        page={FEED_RAIL_PAGE}
      >
        {children}
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
