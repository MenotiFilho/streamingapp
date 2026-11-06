import { useSyncExternalStore } from "react";

import { continueArt } from "../core/home";
import { cardName, cardNote, progressOf, resumable } from "../core/library";
import type { NewLevel } from "../core/navigation";
import type { Session, SessionState } from "../core/session";
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
import { RowNote } from "./RemoteRow";

/**
 * One rail opened as a whole (#253, ADR-0036 §1, design system *Rail*).
 *
 * It draws the cards the rail has read so far, in a wrapping grid, with Back in
 * the head. The grid is static: it asks no page of its own, because paging
 * belongs to the rail's quiet head action (design system *Rail*). A Home row is
 * read from the Session's `HomeStore`, so a page the rail asks while the grid
 * is open lands in the same row and is drawn; Discover and Search carry their
 * feed into the level because those screens unmount under a pushed level.
 */
export type RemoteGridProps = {
  grid: Grid;
  session: Session;
  state: SessionState;
  push: (level: NewLevel<RemotePayload>) => string;
  pop: () => void;
};

export function RemoteGrid({ grid, session, state, push, pop }: RemoteGridProps) {
  const { rows } = useSyncExternalStore(session.home.subscribe, session.home.getSnapshot);

  const snapshot = state.snapshot;
  const source: RemoteGridSource = grid.source;
  const view = gridView(grid, rows, snapshot);
  const { addon, title, metas, entries, failure, couldPlay } = view;

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

      <RowNote failure={failure} quiet={null} />
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
