import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";

import { keyOf, pageable } from "../core/browse";
import {
  DISCOVER_GENRES,
  blankFeed,
  discoverAsk,
  discoverFeedKey,
  discoverPlayable,
  genreFilterFor,
  type DiscoverGenreChoice,
  type DiscoverKind,
} from "../core/discover";
import { programIndex, rowTag } from "../core/homeProgramme";
import type { NewLevel } from "../core/navigation";
import type { Session, SessionState } from "../core/session";
import type { MetaPreview } from "../core/wire";
import { ChoiceChip } from "../kit/Chip";
import { PosterCard } from "../kit/PosterCard";
import { RemoteRail } from "./RemoteRail";
import { MoreControl, PagingControl, RowNote } from "./RemoteRow";
import {
  DISCOVER_ROWS,
  NO_CREDENTIAL_NOTE,
  catalogNote,
  catalogsOf,
  discoverNoCounterpart,
  discoverNote,
  discoverTag,
  feedTitle,
  noCatalogState,
} from "./discoverScreen";
import { feedMore, feedPhase } from "./feed";
import { gridLevel } from "./grid";
import { titleLevelOf, type RemotePayload } from "./levels";

export type DiscoverProps = {
  /** The Session the asks go through, and the Titles it learned are unplayable. */
  session: Session;
  /** What the Host last published: the credential, the Addons, the marks. */
  state: SessionState;
  /** A press on a card pushes the Title level B6 will draw. */
  push: (level: NewLevel<RemotePayload>) => string;
};

/**
 * Discover, in a hand (#207, ADR-0036 §1).
 *
 * Two arms, and which one is drawn is the Host's fact: with a TMDB Credential
 * the screen shows one genre row — the union of TMDB's film and series lists —
 * then two rows, Movies and Series, each asked and paged on its own. Without a
 * credential it draws the Addons' own Catalog rows through `browse_catalog` —
 * the only rows a Host with no credential can answer. A credential gained or
 * cleared is a new pair of rows: the arm is a different question, so the old
 * one's filter goes.
 *
 * The rows and the chosen genre live in the Session (#264): a Title or a grid
 * is a pushed level that unmounts this screen, and Back must return to the same
 * rows at the same page, without asking page 1 again. Both arms share their
 * rows with the row's own grid, so a page read in a grid is in the rail after
 * Back.
 *
 * A press opens a Title and nothing more: a Discovered Title carries no Addon
 * (TMDB named it before any Addon did), and B6 owns the request itself.
 */
export function Discover({ session, state, push }: DiscoverProps) {
  const snapshot = state.snapshot;
  // Which arm a person gets is the Host's fact. Before the first Snapshot it is
  // not a guess to make: the screen waits rather than asking the wrong Host.
  const credential = snapshot ? snapshot.protection.tmdbHeld : null;
  const genreKey = useSyncExternalStore(
    session.discoverGenre.subscribe,
    session.discoverGenre.get,
  );

  // A credential gained or cleared is a new pair of rows: the filters of the
  // last arm are not filters of this one. The first Snapshot only settles which
  // arm this is; it is not a change from one arm to the other.
  const previous = useRef<boolean | null>(null);
  useEffect(() => {
    if (credential === null) {
      return;
    }
    if (previous.current !== null && previous.current !== credential) {
      session.discoverGenre.set(null);
    }
    previous.current = credential;
  }, [credential, session]);

  const genre =
    genreKey === null
      ? null
      : (DISCOVER_GENRES.find((choice) => !choice.all && choice.name === genreKey) ?? null);
  const chooseGenre = (next: DiscoverGenreChoice | null) =>
    session.discoverGenre.set(next?.name ?? null);

  const open = (addon: string | null, meta: MetaPreview) => {
    push(titleLevelOf(addon, meta));
  };

  return (
    <section className="remote-discover" data-testid="remote-discover">
      <header className="remote-screen-head">
        <h1 className="remote-screen-title">Discover</h1>
        <span className="remote-screen-rule" aria-hidden="true" />
      </header>

      {credential === null ? null : credential ? (
        <KeyedDiscover
          session={session}
          state={state}
          genre={genre}
          genreKey={genreKey}
          chooseGenre={chooseGenre}
          open={open}
          push={push}
        />
      ) : (
        <CatalogDiscover
          session={session}
          state={state}
          open={open}
          push={push}
        />
      )}
    </section>
  );
}

/**
 * Discover over TMDB: one genre row, then Movies and Series, each a feed asked
 * page by page. A genre is a different pair of rows in the Session's feed store
 * and asks page 1 of each kind it has a counterpart in; a kind with no
 * counterpart keeps its row, drawn empty with a line saying why. Each row's
 * quiet head action asks the page after what was read, or the page that failed,
 * and the cards already read keep their place either way (`feedWith`). The
 * row's More card opens the same row as a whole-row grid, which reads on by
 * itself (#264).
 */
function KeyedDiscover({
  session,
  state,
  genre,
  genreKey,
  chooseGenre,
  open,
  push,
}: {
  session: Session;
  state: SessionState;
  genre: DiscoverGenreChoice | null;
  genreKey: string | null;
  chooseGenre: (genre: DiscoverGenreChoice | null) => void;
  open: (addon: string | null, meta: MetaPreview) => void;
  push: (level: NewLevel<RemotePayload>) => string;
}) {
  const snapshot = state.snapshot;
  const feeds = useSyncExternalStore(session.feeds.subscribe, session.feeds.getSnapshot);

  // A genre asks page 1 of each kind with a counterpart; the Session store
  // joins a page already in flight and never asks an answered row again.
  useEffect(() => {
    for (const { kind } of DISCOVER_ROWS) {
      const filter =
        genre === null ? { kind: "all" as const } : genreFilterFor(genre, kind);
      if (filter.kind === "none") {
        continue;
      }
      const key = discoverFeedKey("host", genreKey, kind);
      const ask = (page: number) =>
        discoverAsk({
          kind,
          page,
          genre: filter.kind === "id" ? filter.id : null,
        });
      session.feeds.read(key, ask(1), (row) => ask(row.page + 1));
    }
  }, [genre, genreKey, session]);

  const openGrid = (kind: DiscoverKind, index: string) => {
    const key = discoverFeedKey("host", genreKey, kind);
    const feed = feeds.rows.get(key);
    if (!feed || feed.items.length === 0) {
      return;
    }
    push(
      gridLevel({
        title: feedTitle(kind),
        index,
        tag: discoverTag(kind, genre?.name ?? null, feed.items.length),
        addon: null,
        source: {
          kind: "discover",
          feedKind: kind,
          genreKey,
          feedKey: key,
        },
      }),
    );
  };

  return (
    <>
      <div className="remote-filters" role="group" aria-label="Genres">
        <ChoiceChip pressed={genre === null} onClick={() => chooseGenre(null)}>
          All genres
        </ChoiceChip>
        {DISCOVER_GENRES.filter((choice) => !choice.all).map((choice) => (
          <ChoiceChip
            key={choice.name}
            pressed={genre?.name === choice.name}
            onClick={() => chooseGenre(choice)}
          >
            {choice.name}
          </ChoiceChip>
        ))}
      </div>

      <div className="remote-page-panel">
        {DISCOVER_ROWS.map(({ kind }, at) => {
          const key = discoverFeedKey("host", genreKey, kind);
          const feed = feeds.rows.get(key) ?? blankFeed();
          const loading = feeds.reading.has(key);
          const filter =
            genre === null ? { kind: "all" as const } : genreFilterFor(genre, kind);
          const none = filter.kind === "none";
          const phase = feedPhase(feed, loading);
          const couldPlay = snapshot ? discoverPlayable(snapshot.addons, kind) : true;
          const title = feedTitle(kind);
          const index = programIndex(at + 1);
          const quiet =
            none && genre !== null
              ? discoverNoCounterpart(kind, genre.name)
              : discoverNote(phase, genre?.name ?? null);

          return (
            <RemoteRail
              key={kind}
              index={index}
              title={title}
              tag={
                none ? null : discoverTag(kind, genre?.name ?? null, feed.items.length)
              }
              testId={`remote-discover-row-${kind}`}
              note={<RowNote failure={feed.failure} quiet={quiet} />}
              action={
                <PagingControl
                  failure={feed.failure}
                  more={feedMore(feed)}
                  loading={loading}
                  onMore={() => session.feeds.more(key)}
                />
              }
              more={
                feed.items.length > 0 ? (
                  <MoreControl label={title} onOpen={() => openGrid(kind, index)} />
                ) : null
              }
            >
              {feed.items.map((meta) => (
                <PosterCard
                  key={meta.id}
                  name={meta.name}
                  poster={meta.poster}
                  rating={meta.imdbRating?.trim() || null}
                  subtitle={meta.releaseInfo}
                  unplayable={!couldPlay || state.unplayable.has(meta.id)}
                  testId={`discover-card-${meta.id}`}
                  onClick={() => open(null, meta)}
                />
              ))}
            </RemoteRail>
          );
        })}
      </div>
    </>
  );
}

/**
 * Discover with no TMDB Credential: the Addons' own Catalog rows of both kinds,
 * in the Addons' order, each asked page by page. The genre row is TMDB's and
 * stays away — an Addon's `genre` values are the Addon's own, and sending
 * TMDB's ids for them would be a second table that lies (ADR-0010, ADR-0020).
 *
 * The rows are the Session's Home store because they are the same Catalog rows
 * Home reads (#264): a grid opened here pages that row, and the rail after Back
 * draws the page, exactly as Home's whole-row grid does.
 */
function CatalogDiscover({
  session,
  state,
  open,
  push,
}: {
  session: Session;
  state: SessionState;
  open: (addon: string | null, meta: MetaPreview) => void;
  push: (level: NewLevel<RemotePayload>) => string;
}) {
  const snapshot = state.snapshot;
  const catalogs = useMemo(() => catalogsOf(snapshot), [snapshot]);
  const featured = snapshot?.featuredCatalog ?? null;
  const featuredKey = featured
    ? keyOf({ addon: featured.addon, type: featured.catalog.type, id: featured.catalog.id })
    : null;
  const { rows, paging } = useSyncExternalStore(
    session.home.subscribe,
    session.home.getSnapshot,
  );

  // The Catalogs are a new set of rows: the store asks page 1 of each in the
  // Addons' order, joining any ask already in flight. A return after a level
  // paints what the Session already holds (#264). `sync` is idempotent: a
  // Snapshot with the same declarations cannot ask an answered row again.
  useEffect(() => {
    session.home.sync(catalogs, featuredKey);
  }, [session, catalogs, featuredKey]);

  if (catalogs.length === 0) {
    const empty = noCatalogState();
    return (
      <div className="remote-empty" data-testid="discover-no-catalogs">
        <h2 className="remote-empty-title">{empty.title}</h2>
        <p className="remote-empty-body">{empty.body}</p>
      </div>
    );
  }

  return (
    <>
      <p className="remote-quiet">{NO_CREDENTIAL_NOTE}</p>
      <div className="remote-page-panel">
        {rows.map((row, index) => {
          const key = keyOf(row);
          return (
            <RemoteRail
              key={key}
              index={programIndex(index + 1)}
              title={row.name}
              tag={rowTag(snapshot, row)}
              testId={`discover-row-${key}`}
              note={<RowNote failure={row.failure} quiet={catalogNote(row)} />}
              action={
                <PagingControl
                  failure={row.failure}
                  more={
                    pageable(snapshot, row) &&
                    !row.done &&
                    (row.offset > 0 || row.failure !== null)
                  }
                  loading={paging.has(key)}
                  onMore={() => session.home.page(key)}
                />
              }
              more={
                row.metas.length > 0 ? (
                  <MoreControl
                    label={row.name}
                    onOpen={() =>
                      push(
                        gridLevel({
                          title: row.name,
                          index: programIndex(index + 1),
                          tag: rowTag(snapshot, row),
                          addon: row.addon,
                          source: { kind: "home", rowKey: key },
                        }),
                      )
                    }
                  />
                ) : null
              }
            >
              {row.metas.map((meta) => (
                <PosterCard
                  key={meta.id}
                  name={meta.name}
                  poster={meta.poster}
                  rating={meta.imdbRating?.trim() || null}
                  subtitle={meta.releaseInfo}
                  unplayable={state.unplayable.has(meta.id)}
                  testId={`discover-card-${meta.id}`}
                  onClick={() => open(row.addon, meta)}
                />
              ))}
            </RemoteRail>
          );
        })}
      </div>
    </>
  );
}
