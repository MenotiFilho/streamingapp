import { useCallback, useEffect, useRef, useState } from "react";

import {
  blankFeed,
  discoverPlayable,
  feedWith,
  MOVIE,
  type DiscoverFeed,
  type DiscoverKind,
} from "../../core/discover";
import type { MetaPreview } from "../../core/wire";
import { answeredCatalogs, answeredDiscover } from "../../core/answers";
import { SERIES } from "../../core/title";
import tmdbLogo from "../../assets/tmdb-logo.svg";
import { useShell } from "../context";
import { useTitleOpener } from "../TitleScreen";
import { usePreviewData } from "./context";
import {
  discoverNoKey,
  discoverPageAsk,
  discoverRowNote,
  discoverRowTag,
  discoverTag,
  feedMore,
  feedState,
  genreAsk,
  genresFor,
  type GenreChoice,
} from "./editorial";
import { EditorialGrid } from "./EditorialGrid";
import { EditorialRow, FeedPagingAction } from "./EditorialRow";
import { Button } from "../../kit/Button";
import { ChoiceChip } from "../../kit/Chip";
import { PosterCard } from "../../kit/PosterCard";
import { PREVIEW_ADDON } from "./preview";
import { ProgrammeLine } from "./ProgrammeLine";
import { programIndex, yearOf } from "./program";
import { repertoryCredentialsLevel } from "./RepertorySettings";
import "./repertory.css";

/** The two rows Discover draws, Movies then Series, each asked and paged alone. */
const ROWS: ReadonlyArray<{ kind: DiscoverKind; label: string }> = [
  { kind: MOVIE, label: "Movies" },
  { kind: SERIES, label: "Series" },
];

type Feeds = Record<DiscoverKind, DiscoverFeed>;

function blankFeeds(): Feeds {
  return { movie: blankFeed(), series: blankFeed() };
}

function blankOffsets(): Record<DiscoverKind, number> {
  return { movie: 0, series: 0 };
}

/**
 * Discover as an editorial feed (design record §8, ADR-0036 §1): one programme
 * line, one genre row — the union of TMDB's film and series lists — then two
 * rows, Movies and Series. A genre chip filters both rows with the id each kind
 * is asked by; a kind with no counterpart keeps its row, drawn empty with a line
 * saying why, and asks nothing.
 *
 * With a TMDB Credential the Host answers `discover`, and a page is asked
 * fresh: this client keeps only what it has read (ADR-0005). Without a key the
 * screen says what powers it and where the key goes rather than disappearing
 * (ADR-0020); in the plain Vite window there is no Host, so the same two rows
 * are read from Cinemeta's Popular catalogue as a live stand-in.
 *
 * Each row pages and fails on its own: a page that fails prints under its own
 * row and keeps the cards already read, and `Read on` asks that row's next page.
 * Each row's More card opens the cards read so far as a pushed grid. A Title no
 * configured Addon could play keeps its Unplayable stamp and still opens
 * (ADR-0020).
 */
export function RepertoryDiscoverScreen() {
  const preview = usePreviewData();
  const { snapshot, ask, push, pop, unplayable } = useShell();
  const { openTitle, openDiscoveredTitle } = useTitleOpener();
  const [genre, setGenre] = useState<GenreChoice | null>(null);
  const [feeds, setFeeds] = useState<Feeds>(blankFeeds);
  const [offsets, setOffsets] = useState<Record<DiscoverKind, number>>(blankOffsets);
  const [paging, setPaging] = useState<DiscoverKind[]>([]);
  // Which genre owns both rows: an answer for a genre a person has left must
  // not land in the rows they are looking at.
  const serial = useRef(0);

  const keyed = snapshot?.protection.tmdbHeld ?? false;
  const source = preview ? "preview" : "host";
  const active = preview || keyed;

  /** Ask one row's page and fold its answer into that row alone. */
  const load = useCallback(
    async (kind: DiscoverKind, page: number, skip: number) => {
      const action = discoverPageAsk({ source, kind, genre, page, skip });
      if (!action) {
        return;
      }
      const token = serial.current;
      setPaging((held) => (held.includes(kind) ? held : [...held, kind]));
      const outcome = await ask(action);
      if (token !== serial.current) {
        return;
      }
      setPaging((held) => held.filter((heldKind) => heldKind !== kind));
      if (outcome.error) {
        setFeeds((held) => ({
          ...held,
          [kind]: { ...held[kind], failure: outcome.error },
        }));
        return;
      }
      const answer =
        source === "preview"
          ? (answeredCatalogs(outcome.response)[0] ?? null)
          : (answeredDiscover(outcome.response)[0] ?? null);
      if (!answer) {
        setFeeds((held) => ({ ...held, [kind]: { ...held[kind], done: true } }));
        return;
      }
      if (source === "preview" && !answer.failure) {
        setOffsets((held) => ({ ...held, [kind]: held[kind] + answer.sent }));
      }
      setFeeds((held) => ({ ...held, [kind]: feedWith(held[kind], answer) }));
    },
    [ask, genre, source],
  );

  // A key, a genre, or the surface itself is a new pair of feeds: the pages a
  // person read for the last one are not pages of these.
  useEffect(() => {
    serial.current += 1;
    setFeeds(blankFeeds());
    setOffsets(blankOffsets());
    setPaging([]);
    if (!active) {
      return;
    }
    for (const { kind } of ROWS) {
      void load(kind, 1, 0);
    }
    return () => {
      serial.current += 1;
    };
  }, [active, load]);

  const chooseGenre = (next: GenreChoice | null) => {
    if ((genre?.key ?? null) !== (next?.key ?? null)) {
      setGenre(next);
    }
  };

  const retry = (kind: DiscoverKind) =>
    void load(kind, feeds[kind].page + 1, offsets[kind]);

  const open = (meta: MetaPreview) => {
    if (source === "preview") {
      openTitle(PREVIEW_ADDON, meta);
      return;
    }
    void openDiscoveredTitle(meta);
  };

  const posterCard = (meta: MetaPreview, kind: DiscoverKind, testId: string) => (
    <PosterCard
      key={meta.id}
      name={meta.name}
      poster={meta.poster}
      rating={meta.imdbRating?.trim() || null}
      subtitle={yearOf(meta)}
      unplayable={
        (snapshot === null ? false : !discoverPlayable(snapshot.addons, kind)) ||
        unplayable.has(meta.id)
      }
      testId={testId}
      onClick={() => open(meta)}
    />
  );

  const noKey = discoverNoKey();
  const genres = genresFor(source);

  /**
   * The rail's More card opens that row's loaded cards as a pushed grid. It is
   * the same cards, captured at the press; Back returns to the More card (design
   * record §8). The row's quiet action is what asks its next page.
   */
  const openGrid = (kind: DiscoverKind, label: string, index: string) => {
    const feed = feeds[kind];
    push({
      name: `All of ${label}`,
      kind: "overlay",
      payload: {
        render: () => (
          <EditorialGrid
            title={label}
            index={index}
            tag={discoverTag(kind, genre, feed.items.length)}
            failure={feed.failure}
            onClose={pop}
            testId="discover-grid"
          >
            {feed.items.map((meta) =>
              posterCard(meta, kind, `discover-grid-card-${meta.id}`),
            )}
          </EditorialGrid>
        ),
      },
    });
  };

  return (
    <section
      className="rep-feed rep-feed--discover"
      data-testid="discover-screen"
      data-region="discover"
      data-kind="branch"
      data-label="Discover"
    >
      <ProgrammeLine name="Discover" testId="discover-programme-line" />

      {snapshot === null && !preview ? (
        <p className="rep-home-waiting">Waiting for the Host…</p>
      ) : null}

      {snapshot !== null && !preview && !keyed ? (
        <section className="rep-feed-empty" data-testid="discover-no-key">
          <h2 className="rep-feed-empty-title">{noKey.title}</h2>
          <p className="rep-feed-empty-body">{noKey.body}</p>
          <Button variant="primary" onClick={() => push(repertoryCredentialsLevel())}>
            {noKey.action}
          </Button>
        </section>
      ) : null}

      {active ? (
        <>
          <div
            className="rep-kind-filter"
            data-region="discover-genres"
            data-kind="row"
            data-label="Genres"
          >
            <ChoiceChip pressed={genre === null} onClick={() => chooseGenre(null)}>
              All genres
            </ChoiceChip>
            {genres.map((held) => (
              <ChoiceChip
                key={held.key}
                pressed={genre?.key === held.key}
                onClick={() => chooseGenre(held)}
              >
                {held.name}
              </ChoiceChip>
            ))}
          </div>

          {ROWS.map(({ kind, label }, at) => {
            const feed = feeds[kind];
            const loading = paging.includes(kind);
            const ask = genreAsk(genre, kind);
            const state = feedState(feed, loading);
            const tag = discoverRowTag(feed, kind, genre, ask);
            const note = discoverRowNote(state, kind, genre, ask);
            const index = programIndex(at + 1);
            return (
              <EditorialRow
                key={kind}
                title={label}
                index={index}
                tag={tag}
                action={
                  <FeedPagingAction
                    failure={feed.failure}
                    more={feedMore(feed)}
                    loading={loading}
                    onMore={() => retry(kind)}
                  />
                }
                failure={feed.failure}
                note={note}
                region={`discover:${kind}`}
                onOpenRow={
                  feed.items.length > 0
                    ? () => openGrid(kind, label, index)
                    : undefined
                }
                testId={`discover-section-${kind}`}
              >
                {feed.items.map((meta) =>
                  posterCard(meta, kind, `discover-card-${meta.id}`),
                )}
              </EditorialRow>
            );
          })}
        </>
      ) : null}

      {preview ? (
        <p className="rep-preview-note">
          Preview data: the catalogue is live from Cinemeta. The Tauri window asks the
          Host for TMDB&rsquo;s Discover feed instead. Artwork is served from Metahub
          and is not committed to the repository.
        </p>
      ) : null}

      <footer className="rep-credit" data-testid="discover-tmdb-credit">
        <img
          className="rep-credit-logo"
          src={tmdbLogo}
          alt="TMDB"
          data-testid="discover-tmdb-logo"
        />
        <p className="rep-credit-notice" data-testid="discover-tmdb-notice">
          This product uses the TMDB API but is not endorsed or certified by TMDB
        </p>
      </footer>
    </section>
  );
}
