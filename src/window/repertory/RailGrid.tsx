import { useEffect, useSyncExternalStore } from "react";

import { keyOf, pageable } from "../../core/browse";
import type { MetaPreview, ResumeEntry } from "../../core/wire";
import { explain } from "../../core/errors";
import { cardName, cardNote, progressOf, resumable } from "../../core/library";
import { useShell } from "../context";
import { continueArt } from "../../core/home";
import { rowTag } from "./homeProgramme";
import { ContinueWatchingCard, PosterCard } from "./kit";
import { yearOf } from "./program";
import { RailGridHead } from "./RailGridHead";

export type RailGridProps = {
  /**
   * The catalog row to draw as a grid, or null for Continue watching. The row
   * is read from the Home store on every render, so pages that land while the
   * grid is open are drawn as they arrive.
   */
  rowKey: string | null;
  /** The row's name while the store has no row object yet. */
  title: string;
  /** The programme's numbered section head, as the rail printed it. */
  index?: string;
  /** A card opens its Title through the Addon that answered the row. */
  onOpenMeta: (addon: string, meta: MetaPreview) => void;
  onOpenEntry: (entry: ResumeEntry) => void;
  onClose: () => void;
};

/**
 * One rail opened as a whole: every item a Catalog has answered, or every
 * entry in Continue watching, in a responsive grid rather than one line of
 * five-and-a-half.
 *
 * It is a pushed level, so Back pops it to the More card that opened it and the
 * frame restores that card's focus. A catalog row is paged on through the same
 * `home.page` the Home rail used to call from its header; the load stops at the
 * row's `done`, at a failure (which is drawn), and at a Catalog that declares no
 * `skip`. Continue watching is the snapshot's own record and has no more pages.
 * A card opens through the same Title opener Home uses, so the whole row and
 * the rail reach the same programme page.
 */
export function RailGrid({
  rowKey,
  title,
  index,
  onOpenMeta,
  onOpenEntry,
  onClose,
}: RailGridProps) {
  const { home, snapshot } = useShell();
  const { rows } = useSyncExternalStore(home.subscribe, home.getSnapshot);
  const row = rowKey ? (rows.find((held) => keyOf(held) === rowKey) ?? null) : null;
  const name = row?.name ?? title;
  const tag =
    rowKey === null
      ? `${snapshot?.watchProgress.length ?? 0} in progress`
      : row
        ? rowTag(snapshot, row)
        : null;
  const canLoadMore =
    row !== null && pageable(snapshot, row) && !row.done && row.failure === null;
  const loading = canLoadMore;

  // The grid is the whole row, so it reads on until the Addon stops answering.
  // A page in flight is already in the store's queue; the guard in `page` keeps
  // this from becoming a second ask, and a failure stops the run so a down
  // Addon is not hammered. `row` is a dependency because the store keeps the
  // same object until a page lands: without it the grid would stop after one.
  useEffect(() => {
    if (rowKey && canLoadMore) {
      home.page(rowKey);
    }
  }, [home, rowKey, row, canLoadMore]);

  return (
    <section
      className="rep-rail-grid"
      data-region="rail-grid"
      data-kind="branch"
      data-label={`All of ${name}`}
      aria-label={`All of ${name}`}
    >
      <RailGridHead title={name} index={index} tag={tag} onClose={onClose} />

      {rowKey === null ? (
        <div className="rep-rail-grid-cards" data-rail="continue">
          {(snapshot?.watchProgress ?? []).map((entry) => {
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
                onClick={playable ? () => onOpenEntry(entry) : undefined}
              />
            );
          })}
        </div>
      ) : row ? (
        <>
          <div className="rep-rail-grid-cards" data-rail="poster">
            {row.metas.map((meta) => (
              <PosterCard
                key={meta.id}
                name={meta.name}
                poster={meta.poster}
                rating={meta.imdbRating?.trim() || null}
                subtitle={yearOf(meta)}
                testId={`grid-card-${row.addon}-${meta.id}`}
                onClick={() => onOpenMeta(row.addon, meta)}
              />
            ))}
          </div>
          {row.metas.length === 0 && !loading && !row.failure ? (
            <p className="rep-rail-grid-note">
              The Addon answered with no Titles in this section.
            </p>
          ) : null}
        </>
      ) : null}

      {row?.failure ? (
        <p role="alert" className="rep-rail-grid-note rep-rail-grid-note--failure">
          {explain(row.failure)}
        </p>
      ) : null}
      {loading ? <p className="rep-rail-grid-note">Reading the programme…</p> : null}
    </section>
  );
}
