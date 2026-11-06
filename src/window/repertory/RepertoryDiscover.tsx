import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";

import {
  blankFeed,
  discoverFeedKey,
  discoverPlayable,
  type DiscoverKind,
} from "../../core/discover";
import type { MetaPreview } from "../../core/wire";
import { pageFit } from "../../core/pageLayout";
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
import { FeedGrid } from "./FeedGrid";
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
  { kind: "movie", label: "Movies" },
  { kind: SERIES, label: "Series" },
];

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
 * The rows and the chosen genre live in the Session (#264), so a whole-row grid
 * pages the same row the rail draws and Back keeps the cards. Each row pages and
 * fails on its own: a page that fails prints under its own row and keeps the
 * cards already read, and `Read on` asks that row's next page. Each row's More
 * card opens the cards read so far as a pushed grid, which reads on by itself
 * near its end. A Title no configured Addon could play keeps its Unplayable
 * stamp and still opens (ADR-0020).
 */
export function RepertoryDiscoverScreen() {
  const preview = usePreviewData();
  const { snapshot, session, push, pop, unplayable } = useShell();
  const { openTitle, openDiscoveredTitle } = useTitleOpener();
  const genreKey = useSyncExternalStore(
    session.discoverGenre.subscribe,
    session.discoverGenre.get,
  );
  const feeds = useSyncExternalStore(session.feeds.subscribe, session.feeds.getSnapshot);

  const keyed = snapshot?.protection.tmdbHeld ?? false;
  const source = preview ? "preview" : "host";
  const active = preview || keyed;
  const genres = useMemo(() => genresFor(source), [source]);
  const genre = genreKey === null
    ? null
    : (genres.find((held) => held.key === genreKey) ?? null);

  // The arm or the source changed: the chips of the last feed are not chips of
  // this one, and the old genre's pages are not its pages.
  const previous = useRef({ active, source });
  useEffect(() => {
    if (previous.current.active !== active || previous.current.source !== source) {
      session.discoverGenre.set(null);
    }
    previous.current = { active, source };
  }, [active, source, session]);

  // A key, a genre, or the surface itself is a different pair of feeds. The
  // Session store joins a page already in flight and never asks an answered row
  // again, so mounting after a Title or a grid is free (#264).
  useEffect(() => {
    if (!active) {
      return;
    }
    // The arm or the source changed in the effect above; this render's closure
    // still holds the chip of the old feed, and it must not ask it again.
    if (session.discoverGenre.get() !== (genre?.key ?? null)) {
      return;
    }
    for (const { kind } of ROWS) {
      const first = discoverPageAsk({ source, kind, genre, page: 1, skip: 0 });
      if (!first) {
        continue;
      }
      const key = discoverFeedKey(source, genre?.key ?? null, kind);
      session.feeds.read(key, first, (row) =>
        discoverPageAsk({
          source,
          kind,
          genre,
          page: row.page + 1,
          skip: row.offset,
        }),
      );
    }
  }, [active, genre, session, source]);

  const chooseGenre = (next: GenreChoice | null) => {
    session.discoverGenre.set(next?.key ?? null);
  };

  const retry = (kind: DiscoverKind) => {
    const key = discoverFeedKey(source, genre?.key ?? null, kind);
    session.feeds.more(key);
  };

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
      data-grid-card
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
  const fit = pageFit("discover");

  /**
   * The rail's More card opens that row as a pushed grid. The grid reads the
   * same Session row on every render, so a page it asks is in the rail after
   * Back and a page the rail asked is in the grid (#264). Back returns to the
   * More card (design record §8).
   */
  const openGrid = (kind: DiscoverKind, label: string, index: string) => {
    const key = discoverFeedKey(source, genre?.key ?? null, kind);
    const feed = feeds.rows.get(key);
    push({
      name: `All of ${label}`,
      kind: "overlay",
      payload: {
        render: () => (
          <FeedGrid
            feedKey={key}
            title={label}
            index={index}
            tag={discoverTag(kind, genre, feed?.items.length ?? 0)}
            renderCard={(meta) =>
              posterCard(meta, kind, `discover-grid-card-${meta.id}`)
            }
            onClose={pop}
            testId="discover-grid"
          />
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
      data-page={fit.fitted ? "fitted" : undefined}
      data-panel={fit.panel ?? undefined}
    >
      <ProgrammeLine name="Discover" testId="discover-programme-line" />

      {snapshot === null && !preview ? (
        <p className="rep-home-waiting">Waiting for the Host…</p>
      ) : null}

      {active ? (
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
      ) : null}

      <div className="rep-page-panel">
        {snapshot !== null && !preview && !keyed ? (
          <section className="rep-feed-empty" data-testid="discover-no-key">
            <h2 className="rep-feed-empty-title">{noKey.title}</h2>
            <p className="rep-feed-empty-body">{noKey.body}</p>
            <Button variant="primary" onClick={() => push(repertoryCredentialsLevel())}>
              {noKey.action}
            </Button>
          </section>
        ) : null}

        {active
          ? ROWS.map(({ kind, label }, at) => {
              const key = discoverFeedKey(source, genre?.key ?? null, kind);
              const feed = feeds.rows.get(key) ?? blankFeed();
              const loading = feeds.reading.has(key);
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
            })
          : null}
      </div>

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
