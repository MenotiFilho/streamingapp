import { useSyncExternalStore } from "react";

import { keyOf, pageable } from "../../core/browse";
import type { ContinueEntry, MetaPreview } from "../../core/wire";
import { explain } from "../../core/errors";
import { gridPaging } from "../../core/gridPaging";
import { cardName, cardNote, progressOf, resumable } from "../../core/library";
import { useShell } from "../context";
import { continueArt } from "../../core/home";
import { continueTag, rowTag } from "./homeProgramme";
import { ContinueWatchingCard } from "../../kit/ContinueWatchingCard";
import { PosterCard } from "../../kit/PosterCard";
import { Button } from "../../kit/Button";
import { useGridEnd } from "../../core/react/useGridEnd";
import { yearOf } from "./program";
import { RailGridHead } from "./RailGridHead";
import { useLookHints, lookHintHandlers } from "./lookHint";
import type { LookHintTarget } from "../../core/lookHint";

/** Where a Home whole-row grid's cards come from. */
export type RailGridSource =
  | { kind: "home"; rowKey: string }
  | { kind: "continue" };

export type RailGridProps = {
  /**
   * The row to draw as a grid: a Home Catalog row by the key its store holds,
   * or Continue watching. The row is read from the Home store on every render,
   * so pages that land while the grid is open are drawn as they arrive.
   */
  source: RailGridSource;
  /** The row's name while the store has no row object yet. */
  title: string;
  /** The programme's numbered section head, as the rail printed it. */
  index?: string;
  /** A card opens its Title through the Addon that answered the row. */
  onOpenMeta: (addon: string, meta: MetaPreview) => void;
  onOpenEntry: (entry: ContinueEntry) => void;
  onClose: () => void;
};

/**
 * One Home rail opened as a whole: every item a Catalog has answered, or every
 * entry in Continue watching, in a responsive grid rather than one line of
 * five-and-a-half.
 *
 * It is a pushed level, so Back pops it to the More card that opened it and the
 * frame restores that card's focus. The grid reads on by itself (#264): when
 * the last cards come near the viewport, or focus reaches them, it asks the
 * row's next page into the same accumulated row the Home rail draws. A page in
 * flight is never asked twice, a done row has no more, and a page that failed
 * keeps its cards and offers Try again. Continue watching is the snapshot's own
 * record and has no more pages. A card opens through the same Title opener Home
 * uses, so the whole row and the rail reach the same programme page.
 */
export function RailGrid({
  source,
  title,
  index,
  onOpenMeta,
  onOpenEntry,
  onClose,
}: RailGridProps) {
  const { home, snapshot } = useShell();
  const look = useLookHints();
  const { rows, paging } = useSyncExternalStore(home.subscribe, home.getSnapshot);

  const row =
    source.kind === "home"
      ? (rows.find((held) => keyOf(held) === source.rowKey) ?? null)
      : null;
  const name = row?.name ?? title;
  const tag =
    source.kind === "continue"
      ? continueTag(snapshot?.continueWatching.length ?? 0)
      : row
        ? rowTag(snapshot, row)
        : null;
  const metas = row?.metas ?? [];
  const failure = row?.failure ?? null;
  const reading = source.kind === "home" ? paging.has(source.rowKey) : false;
  const lookAt = (target: LookHintTarget) => lookHintHandlers(look, target);
  const pagingView = gridPaging({
    done: source.kind === "home" ? (row?.done ?? false) : false,
    failure,
    pageable: source.kind === "home" && row !== null && pageable(snapshot, row),
    reading,
    count: source.kind === "continue" ? (snapshot?.continueWatching.length ?? 0) : metas.length,
  });

  const askMore = () => {
    if (source.kind === "home") {
      home.page(source.rowKey);
    }
  };

  const root = useGridEnd({
    count: metas.length,
    page: pagingView.page,
    reading: pagingView.reading,
    onReach: askMore,
  });

  return (
    <section
      ref={root}
      className="rep-rail-grid"
      data-region="rail-grid"
      data-kind="branch"
      data-label={`All of ${name}`}
      aria-label={`All of ${name}`}
    >
      <RailGridHead title={name} index={index} tag={tag} onClose={onClose} />

      {source.kind === "continue" ? (
        <div className="rep-rail-grid-cards" data-rail="continue">
          {(snapshot?.continueWatching ?? []).map((entry) => {
            const playable = resumable(entry);
            return (
              <ContinueWatchingCard
                key={`${entry.title.type}/${entry.video.id}`}
                {...lookAt({
                  addon: entry.title.addon,
                  type: entry.title.type,
                  id: entry.title.id,
                })}
                data-grid-card
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
      ) : (
        <div className="rep-rail-grid-cards" data-rail="poster">
          {metas.map((meta) => (
            <PosterCard
              key={meta.id}
              {...lookAt({ addon: row?.addon ?? null, type: meta.type, id: meta.id })}
              data-grid-card
              name={meta.name}
              poster={meta.poster}
              rating={meta.imdbRating?.trim() || null}
              subtitle={yearOf(meta)}
              testId={`grid-card-${row?.addon ?? ""}-${meta.id}`}
              onClick={() => onOpenMeta(row?.addon ?? "", meta)}
            />
          ))}
        </div>
      )}

      {failure ? (
        <p role="alert" className="rep-rail-grid-note rep-rail-grid-note--failure">
          {explain(failure)}
        </p>
      ) : null}
      {pagingView.retry ? (
        <Button variant="ghost" onClick={askMore}>
          Try again
        </Button>
      ) : null}
      {pagingView.reading ? (
        <p className="rep-rail-grid-note">Reading the programme…</p>
      ) : null}
      {pagingView.empty ? (
        <p className="rep-rail-grid-note">
          The Addon answered with no Titles in this section.
        </p>
      ) : null}
    </section>
  );
}
