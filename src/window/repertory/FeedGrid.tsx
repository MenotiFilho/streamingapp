import { useSyncExternalStore, type ReactNode } from "react";

import { gridPaging } from "../../core/gridPaging";
import type { FeedRow } from "../../core/feedStore";
import { useGridEnd } from "../../core/react/useGridEnd";
import type { MetaPreview } from "../../core/wire";
import { useShell } from "../context";
import { EditorialGrid } from "./EditorialGrid";

export type FeedGridProps = {
  /** The Session feed store key the rail and the grid share (#264). */
  feedKey: string;
  title: string;
  index?: string;
  /** The bookkeeping the head prints, read from the row on every render. */
  tag?: (feed: FeedRow) => string | null;
  /** Draw one card; the caller owns the test id and what a press opens. */
  renderCard: (meta: MetaPreview) => ReactNode;
  onClose: () => void;
  testId?: string;
};

/**
 * A keyed editorial row opened as a whole (#264). The cards are the Session's
 * row — the same one the rail draws — so a page read here is in the rail after
 * Back and a page the rail asked is in the grid. Reaching the last cards asks
 * the next page with no control; a failed page keeps its cards and offers the
 * one Try again the person pressed for. What the grid shows for that page is
 * `gridPaging`'s decision, shared with every other grid.
 */
export function FeedGrid({
  feedKey,
  title,
  index,
  tag,
  renderCard,
  onClose,
  testId,
}: FeedGridProps) {
  const { session } = useShell();
  const { rows, reading } = useSyncExternalStore(
    session.feeds.subscribe,
    session.feeds.getSnapshot,
  );
  const feed = rows.get(feedKey);
  const loading = reading.has(feedKey);
  const paging = gridPaging({
    done: feed?.done ?? false,
    failure: feed?.failure ?? null,
    pageable: feed !== undefined,
    reading: loading,
    count: feed?.items.length ?? 0,
  });

  const root = useGridEnd({
    count: feed?.items.length ?? 0,
    page: paging.page,
    reading: paging.reading,
    onReach: () => session.feeds.more(feedKey),
  });

  return (
    <EditorialGrid
      title={title}
      index={index}
      tag={feed ? (tag?.(feed) ?? null) : null}
      failure={feed?.failure ?? null}
      note={paging.reading ? "Reading the programme…" : null}
      retry={paging.retry}
      onRetry={() => session.feeds.more(feedKey)}
      onClose={onClose}
      testId={testId}
      containerRef={root}
    >
      {(feed?.items ?? []).map(renderCard)}
    </EditorialGrid>
  );
}
