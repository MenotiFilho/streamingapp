import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { keyOf, pageable, type Row } from "../core/browse";
import { discoverPlayable, genresOf } from "../core/discover";
import { continueArt } from "../core/home";
import { rowTag, rowTagOf } from "../core/homeProgramme";
import { cardName, cardNote, progressOf, resumable } from "../core/library";
import type { NewLevel } from "../core/navigation";
import type { Session, SessionState } from "../core/session";
import type { MetaPreview, ResumeEntry } from "../core/wire";
import { Button } from "../kit/Button";
import { ContinueWatchingCard } from "../kit/ContinueWatchingCard";
import { PosterCard } from "../kit/PosterCard";
import { discoverTag } from "./discoverScreen";
import { feedMore } from "./feed";
import {
  gridPageAsk,
  gridWithPage,
  type RemoteGrid as Grid,
  type RemoteGridSource,
} from "./grid";
import { titleLevel, titleLevelOf, type RemotePayload } from "./levels";
import { RowNote } from "./RemoteRow";

/**
 * One rail opened as a whole (#253, ADR-0036 §1, design system *Rail*).
 *
 * It draws the cards the rail has read so far, in a wrapping grid, with Back in
 * the head. The head's quiet action asks the same row for its next page — the
 * grid never asks one on mount — so a page lands in the row the rail draws and
 * Back returns to it. A Home row is read from the Session's `HomeStore`; the
 * Discover and Search grids carry their feed because those screens unmount
 * under a pushed level.
 */
export type RemoteGridProps = {
  grid: Grid;
  session: Session;
  state: SessionState;
  push: (level: NewLevel<RemotePayload>) => string;
  pop: () => void;
};

export function RemoteGrid({ grid, session, state, push, pop }: RemoteGridProps) {
  const { rows, paging } = useSyncExternalStore(
    session.home.subscribe,
    session.home.getSnapshot,
  );
  const [source, setSource] = useState<RemoteGridSource>(grid.source);
  const [reading, setReading] = useState(false);
  const open = useRef(true);

  useEffect(
    () => () => {
      open.current = false;
    },
    [],
  );

  const snapshot = state.snapshot;
  const homeKey = source.kind === "home" ? source.rowKey : null;
  const homeRow =
    homeKey === null ? null : (rows.find((row) => keyOf(row) === homeKey) ?? null);
  const row = source.kind === "catalog" ? source.row : homeRow;
  const feed =
    source.kind === "discover" || source.kind === "search" ? source.feed : null;
  const entries =
    source.kind === "home" && source.rowKey === null
      ? (snapshot?.watchProgress ?? [])
      : null;
  const metas = row?.metas ?? feed?.items ?? [];
  const addon = row?.addon ?? grid.addon;
  const title = row?.name ?? grid.title;
  const tag = tagOf(source, row, entries, snapshot);
  const failure = row?.failure ?? feed?.failure ?? null;
  const couldPlay =
    source.kind === "discover" || source.kind === "search"
      ? snapshot
        ? discoverPlayable(snapshot.addons, source.feedKind)
        : true
      : true;
  const more =
    source.kind === "home"
      ? source.rowKey !== null &&
        row !== null &&
        pageable(snapshot, row) &&
        !row.done
      : source.kind === "catalog"
        ? pageable(snapshot, source.row) && !source.row.done
        : feed !== null && feedMore(feed);
  const waiting =
    source.kind === "home" && source.rowKey !== null
      ? paging.has(source.rowKey)
      : reading;

  const page = async () => {
    if (waiting) {
      return;
    }
    if (source.kind === "home") {
      if (source.rowKey !== null) {
        session.home.page(source.rowKey);
      }
      return;
    }
    const action = gridPageAsk(source);
    if (!action) {
      return;
    }
    setReading(true);
    const outcome = await session.ask(action);
    if (!open.current) {
      return;
    }
    setReading(false);
    setSource((held) => gridWithPage(held, outcome));
  };

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
        {grid.index ? (
          <span className="remote-rail-index">{grid.index}</span>
        ) : null}
        <h2 className="remote-rail-title">{title}</h2>
        <span className="remote-rail-rule" aria-hidden="true" />
        {tag ? <span className="remote-rail-tag">{tag}</span> : null}
        {more ? (
          <Button variant="ghost" disabled={waiting} onClick={() => void page()}>
            {failure ? "Try again" : "Read on"}
          </Button>
        ) : null}
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

      <RowNote failure={failure} quiet={waiting ? "Reading on…" : null} />
    </section>
  );
}

/**
 * The bookkeeping beside the grid's name, recomputed from the row it is showing
 * so a page that lands moves the count with the cards.
 */
function tagOf(
  source: RemoteGridSource,
  row: Row | null,
  entries: ResumeEntry[] | null,
  snapshot: SessionState["snapshot"],
): string | null {
  if (source.kind === "home" && source.rowKey === null) {
    return `${entries?.length ?? 0} in progress`;
  }
  if (source.kind === "discover") {
    const genre =
      genresOf(source.feedKind).find((held) => held.id === source.genre)?.name ??
      null;
    return discoverTag(source.feedKind, genre, source.feed.items.length);
  }
  if (source.kind === "search") {
    return rowTagOf("TMDB", source.feedKind, source.feed.items.length);
  }
  return row ? rowTag(snapshot, row) : null;
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
