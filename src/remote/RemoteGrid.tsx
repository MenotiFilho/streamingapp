import { useSyncExternalStore } from "react";

import { pageable } from "../core/browse";
import { explain } from "../core/errors";
import { continueArt } from "../core/home";
import { cardName, cardNote, progressOf, resumable } from "../core/library";
import type { NewLevel } from "../core/navigation";
import type { Session, SessionState } from "../core/session";
import { useGridEnd } from "../core/react/useGridEnd";
import type { MetaPreview, ResumeEntry } from "../core/wire";
import { Button } from "../kit/Button";
import { ContinueWatchingCard } from "../kit/ContinueWatchingCard";
import { PosterCard } from "../kit/PosterCard";
import {
  gridView,
  type RemoteGrid as Grid,
  type RemoteGridSource,
} from "./grid";
import { titleLevel, titleLevelOf, type RemotePayload } from "./levels";

/**
 * One rail opened as a whole (#253, #264, ADR-0036 §1, design system *Rail*).
 *
 * It draws the row the rail has read, and reads on by itself: when the last
 * cards come near the viewport, or focus reaches them, it asks that row's next
 * page into the same row the rail draws. A page that fails keeps the cards it
 * had and offers Try again; a page in flight or a done row is never asked
 * twice. Home and the keyless Discover row read the Session's `HomeStore`; a
 * keyed Discover or Search row reads the Session's feed store.
 */
export type RemoteGridProps = {
  grid: Grid;
  session: Session;
  state: SessionState;
  push: (level: NewLevel<RemotePayload>) => string;
  pop: () => void;
};

export function RemoteGrid({ grid, session, state, push, pop }: RemoteGridProps) {
  const home = useSyncExternalStore(session.home.subscribe, session.home.getSnapshot);
  const feeds = useSyncExternalStore(session.feeds.subscribe, session.feeds.getSnapshot);

  const snapshot = state.snapshot;
  const source: RemoteGridSource = grid.source;
  const view = gridView(grid, home.rows, feeds.rows, snapshot);
  const { addon, title, metas, entries, failure, couldPlay, row, feed } = view;

  const key = "rowKey" in source ? source.rowKey : "feedKey" in source ? source.feedKey : null;
  const reading =
    source.kind === "home"
      ? home.paging.has(source.rowKey)
      : key !== null
        ? feeds.reading.has(key)
        : false;
  const pageableNow =
    source.kind === "home"
      ? row !== null && pageable(snapshot, row) && !row.done
      : feed !== null && !feed.done;
  const retry = failure !== null && pageableNow && !reading;
  const page = pageableNow ? { done: false, failure } : null;

  const askMore = () => {
    if (source.kind === "home") {
      session.home.page(source.rowKey);
    } else if (key !== null) {
      session.feeds.more(key);
    }
  };

  const root = useGridEnd({
    count: metas.length,
    page,
    reading,
    onReach: askMore,
  });

  const openMeta = (meta: MetaPreview) => {
    push(titleLevelOf(addon, meta));
  };

  const openEntry = (entry: ResumeEntry) => {
    push(
      titleLevel({
        addon: entry.title.addon,
        id: entry.title.id,
        type: entry.title.type,
        name: entry.title.name,
      }),
    );
  };

  return (
    <section
      ref={root}
      className="remote-grid"
      aria-label={`All of ${title}`}
      data-testid="remote-grid"
    >
      <header className="remote-rail-head remote-grid-head">
        {grid.index ? <span className="remote-rail-index">{grid.index}</span> : null}
        <h2 className="remote-rail-title">{title}</h2>
        <span className="remote-rail-rule" aria-hidden="true" />
        {grid.tag ? <span className="remote-rail-tag">{grid.tag}</span> : null}
        <Button variant="ghost" onClick={pop}>
          Back
        </Button>
      </header>

      {entries ? (
        <div className="remote-grid-cards remote-grid-continue">
          {entries.map((entry) => {
            const playable = resumable(entry);
            return (
              <ContinueWatchingCard
                key={`${entry.title.type}/${entry.video.id}`}
                data-grid-card
                name={cardName(entry)}
                note={cardNote(entry)}
                art={continueArt(entry)}
                progress={progressOf(entry)}
                unplayable={!playable}
                testId={`grid-resume-${entry.video.id}`}
                onClick={playable ? () => openEntry(entry) : undefined}
              />
            );
          })}
        </div>
      ) : (
        <div className="remote-grid-cards">
          {metas.map((meta) => (
            <PosterCard
              key={meta.id}
              data-grid-card
              name={meta.name}
              poster={meta.poster}
              rating={meta.imdbRating?.trim() || null}
              subtitle={meta.releaseInfo}
              unplayable={!couldPlay || state.unplayable.has(meta.id)}
              testId={cardTestId(source, addon, meta)}
              onClick={() => openMeta(meta)}
            />
          ))}
        </div>
      )}

      {failure ? (
        <p role="alert" className="remote-rail-failure">
          {explain(failure)}
        </p>
      ) : null}
      {retry ? (
        <Button variant="ghost" onClick={askMore}>
          Try again
        </Button>
      ) : null}
      {reading ? <p role="status" className="remote-rail-quiet">Reading on…</p> : null}
      {!entries && metas.length === 0 && !reading && !failure && feed?.done ? (
        <p className="remote-rail-quiet">
          The Addon answered with no Titles in this section.
        </p>
      ) : null}
    </section>
  );
}

/** A grid card's stable test id, named as the window names its own grids. */
function cardTestId(
  source: RemoteGridSource,
  addon: string | null,
  meta: MetaPreview,
): string {
  switch (source.kind) {
    case "discover":
      return `discover-grid-card-${meta.id}`;
    case "search":
      return `search-grid-card-${source.feedKind}-${meta.id}`;
    default:
      return `grid-card-${addon}-${meta.id}`;
  }
}
