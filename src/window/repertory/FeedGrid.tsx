import { useSyncExternalStore, type ReactNode } from "react";

import { useShell } from "../context";
import { useGridEnd } from "../../core/react/useGridEnd";
import type { MetaPreview } from "../../core/wire";
import { EditorialGrid } from "./EditorialGrid";

export type FeedGridProps = {
  /** The Session feed store key the rail and the grid share (#264). */
  feedKey: string;
  title: string;
  index?: string;
  tag?: string | null;
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
 * one Try again the person pressed for.
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
  const failure = feed?.failure ?? null;
  const page = feed && !feed.done ? { done: false, failure } : null;

  const root = useGridEnd({
    count: feed?.items.length ?? 0,
    page,
    reading: loading,
    onReach: () => session.feeds.more(feedKey),
  });

  return (
    <EditorialGrid
      title={title}
      index={index}
      tag={tag}
      failure={failure}
      note={loading ? "Reading the programme…" : null}
      onClose={onClose}
      onRetry={() => session.feeds.more(feedKey)}
      testId={testId}
      containerRef={root}
    >
      {(feed?.items ?? []).map(renderCard)}
    </EditorialGrid>
  );
}
