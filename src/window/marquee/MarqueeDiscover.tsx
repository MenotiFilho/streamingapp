import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import {
  blankFeed,
  feedState,
  type DiscoverKind,
  type DiscoverSource,
} from "../../core/discover";
import { explain } from "../../core/errors";
import { gridPaging } from "../../core/gridPaging";
import {
  gridFocusAheadForColumns,
  posterGridColumnsForViewport,
} from "../../core/marqueeLayout";
import {
  DISCOVER_TYPES,
  INITIAL_DISCOVER_FILTERS,
  discoverEmptyCopy,
  discoverGenreOptions,
  discoverGridBody,
  discoverNoKeyCopy,
  discoverReadOnCopy,
  discoverSortOptions,
  marqueeDiscoverRead,
  marqueeTmdbUnplayable,
  reconcileDiscoverFilters,
  type DiscoverSortKey,
} from "../../core/marqueeDiscover";
import { useGridEnd, type GridEndOptions } from "../../core/react/useGridEnd";
import type { MetaPreview } from "../../core/wire";
import { AddonNotice } from "../../kit/AddonNotice";
import { Dropdown } from "../../kit/Dropdown";
import { EmptyState } from "../../kit/EmptyState";
import { Poster } from "../../kit/Poster";
import { ScreenTitle } from "../../kit/ScreenTitle";
import { Spinner } from "../../kit/Spinner";
import { useShell } from "../context";
import { usePreviewData } from "../rehearsal/previewData";
import { lookHintHandlers, useLookHints } from "../useLookHints";
import {
  CINEMETA_MOVIE_GENRES,
  CINEMETA_SERIES_GENRES,
  PREVIEW_ADDON,
} from "../rehearsal/preview";
import { useMarqueeTitleOpener as useTitleOpener } from "./MarqueeTitle";
import "./browse.css";

type OpenMenu = "type" | "genre" | "sort" | null;

/**
 * Marquee Discover (`14.jpg`, `14b.jpg`, `15.jpg`):
 * - Single-kind Type dropdown (Movies / Series, ADR-0043 §4 amendment to ADR-0036 §1),
 *   per-kind Genre dropdown, and Sort dropdown passed to the `discover` Action.
 * - 7-column infinite-paging Poster grid backed by the Session `FeedStore`;
 *   the filters are the Session's too, so a destination change keeps them.
 * - Empty state when the Host holds no TMDB Credential (`15.jpg`), navigating to Settings.
 */
export function MarqueeDiscover() {
  const preview = usePreviewData();
  const { snapshot, session, choose, setBaseIntentHandler, unplayable } = useShell();
  const { openTitle, openDiscoveredTitle } = useTitleOpener();
  const look = useLookHints();
  const feeds = useSyncExternalStore(
    session.feeds.subscribe,
    session.feeds.getSnapshot,
  );

  const keyed = snapshot?.protection.tmdbHeld ?? false;
  const source: DiscoverSource = preview ? "preview" : "host";
  const active = preview || keyed;

  const filters = useSyncExternalStore(
    session.discoverFilters.subscribe,
    session.discoverFilters.get,
  );
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null);
  const filtersRef = useRef<HTMLDivElement | null>(null);

  const previewGenres = useMemo(
    () =>
      filters.kind === "series" ? CINEMETA_SERIES_GENRES : CINEMETA_MOVIE_GENRES,
    [filters.kind],
  );
  const genres = useMemo(
    () => discoverGenreOptions(source, filters.kind, previewGenres),
    [source, filters.kind, previewGenres],
  );
  const sorts = useMemo(
    () => discoverSortOptions(source, filters.kind),
    [source, filters.kind],
  );

  const selectedGenre =
    genres.find((option) => option.id === filters.genreId) ?? genres[0]!;
  const selectedSort =
    sorts.find((option) => option.id === filters.sortId) ?? sorts[0]!;

  // Reset filters to defaults if the active arm/source changes (e.g. TMDB key toggled).
  const previous = useRef({ active, source });
  useEffect(() => {
    if (previous.current.active !== active || previous.current.source !== source) {
      session.discoverFilters.set(INITIAL_DISCOVER_FILTERS);
      setOpenMenu(null);
    }
    previous.current = { active, source };
  }, [active, source, session]);

  const read = useMemo(
    () =>
      marqueeDiscoverRead({
        source,
        kind: filters.kind,
        genre: selectedGenre,
        sort: selectedSort,
        previewAddonId: PREVIEW_ADDON,
      }),
    [source, filters.kind, selectedGenre, selectedSort],
  );

  useEffect(() => {
    // The effect above may have just reset the filters; this render's read is
    // still the old arm's and must not be asked.
    if (!active || session.discoverFilters.get() !== filters) {
      return;
    }
    session.feeds.read(read.key, read.first, read.next);
  }, [active, filters, read, session]);

  // A press outside the filters closes the open menu.
  useEffect(() => {
    if (openMenu === null) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !filtersRef.current?.contains(target)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [openMenu]);

  // Back and the D-pad stay inside an open menu, from the keys and the pad alike.
  useEffect(() => {
    const clear = setBaseIntentHandler((intent) => {
      if (openMenu === null) {
        return false;
      }
      if (intent === "back") {
        setOpenMenu(null);
        return true;
      }
      if (intent === "left" || intent === "right") {
        return true;
      }
      if (intent === "up" || intent === "down") {
        const options = Array.from(
          filtersRef.current?.querySelectorAll<HTMLElement>('[role="listbox"] [role="option"]') ??
            [],
        );
        if (options.length === 0) {
          return true;
        }
        const activeElement = document.activeElement;
        const currentIndex =
          activeElement instanceof HTMLElement ? options.indexOf(activeElement) : -1;
        const nextIndex =
          currentIndex < 0
            ? 0
            : intent === "down"
              ? Math.min(options.length - 1, currentIndex + 1)
              : Math.max(0, currentIndex - 1);
        options[nextIndex]?.focus();
        return true;
      }
      return false;
    });
    return clear;
  }, [openMenu, setBaseIntentHandler]);

  const feed = feeds.rows.get(read.key) ?? blankFeed();
  const loading = feeds.reading.has(read.key);
  const state = feedState(feed, loading);
  const paging = gridPaging({
    done: feed.done,
    failure: feed.failure,
    pageable: active,
    reading: loading,
    count: feed.items.length,
  });

  const watchedFilmKeys = useMemo(() => {
    const set = new Set<string>();
    for (const entry of snapshot?.watchProgress ?? []) {
      if (entry.watched && entry.title.type === "movie") {
        set.add(`${entry.title.type}:${entry.title.id}`);
      }
    }
    return set;
  }, [snapshot?.watchProgress]);

  const openCard = (meta: MetaPreview) => {
    if (source === "preview") {
      openTitle(PREVIEW_ADDON, meta);
      return;
    }
    void openDiscoveredTitle(meta);
  };

  const chooseType = (nextId: string) => {
    const nextKind: DiscoverKind = nextId === "series" ? "series" : "movie";
    const nextPreviewGenres =
      nextKind === "series" ? CINEMETA_SERIES_GENRES : CINEMETA_MOVIE_GENRES;
    session.discoverFilters.set(
      reconcileDiscoverFilters({
        nextKind,
        genreId: filters.genreId,
        sortId: filters.sortId,
        source,
        previewGenres: nextPreviewGenres,
      }),
    );
  };

  const noKey = discoverNoKeyCopy();
  const empty = discoverEmptyCopy(selectedGenre);
  const readOn = discoverReadOnCopy();
  const body = discoverGridBody(feed, state);
  const subtitle = keyed ? "From TMDB" : preview ? "Preview · Cinemeta" : undefined;

  return (
    <section
      className="mq-browse-screen mq-discover"
      data-testid="discover-screen"
      data-region="discover"
      data-kind="branch"
      data-label="Discover"
    >
      <div className="mq-browse-head">
        <ScreenTitle title="Discover" subtitle={subtitle} />
      </div>

      {snapshot === null && !preview ? (
        <p className="mq-browse-waiting mq-type-caption mq-text-faint" role="status">
          Waiting for the Host…
        </p>
      ) : null}

      {snapshot !== null && !preview && !keyed ? (
        <div className="mq-browse-empty-stage" data-testid="discover-no-key">
          <EmptyState
            icon="compass"
            title={noKey.title}
            body={noKey.body}
            action={{
              label: noKey.actionLabel,
              icon: "settings",
              onPress: () => choose("settings"),
            }}
          />
        </div>
      ) : null}

      {active ? (
        <>
          <div
            ref={filtersRef}
            className="mq-discover-filters"
            data-region="discover-filters"
            data-kind="row"
            data-label="Discover filters"
          >
            <Dropdown
              label="Type"
              options={DISCOVER_TYPES}
              selected={filters.kind}
              open={openMenu === "type"}
              onOpenChange={(open) => setOpenMenu(open ? "type" : null)}
              onSelect={chooseType}
            />
            <Dropdown
              label="Genre"
              options={genres}
              selected={selectedGenre.id}
              open={openMenu === "genre"}
              onOpenChange={(open) => setOpenMenu(open ? "genre" : null)}
              onSelect={(genreId) =>
                session.discoverFilters.set({ ...filters, genreId })
              }
            />
            <Dropdown
              label="Sort"
              options={sorts}
              selected={selectedSort.id}
              open={openMenu === "sort"}
              onOpenChange={(open) => setOpenMenu(open ? "sort" : null)}
              onSelect={(sortId) =>
                session.discoverFilters.set({
                  ...filters,
                  sortId: sortId as DiscoverSortKey,
                })
              }
            />
          </div>

          {openMenu !== null ? (
            <div
              className="mq-discover-dim"
              data-testid="discover-menu-dim"
              aria-hidden="true"
              onClick={() => setOpenMenu(null)}
            />
          ) : null}

          <DiscoverGridPort
            count={feed.items.length}
            page={paging.page}
            reading={paging.reading}
            onReach={() => session.feeds.more(read.key)}
            inert={openMenu !== null}
          >
            {body === "loading" ? (
              <div className="mq-browse-loading">
                <Spinner label="Reading Discover…" />
              </div>
            ) : null}

            {body === "cards" ? (
              <ul
                className="mq-poster-grid"
                data-testid="discover-grid"
                data-region="discover-grid"
                data-kind="branch"
                data-label="Discover results"
              >
                {feed.items.map((meta) => (
                  <li key={meta.id} className="mq-poster-grid-item">
                    <Poster
                      {...lookHintHandlers(look, {
                        addon: source === "preview" ? PREVIEW_ADDON : null,
                        type: meta.type,
                        id: meta.id,
                      })}
                      className="mq-browse-card"
                      data-grid-card
                      data-testid={`discover-card-${meta.id}`}
                      name={meta.name}
                      poster={meta.poster}
                      watched={watchedFilmKeys.has(`${meta.type}:${meta.id}`)}
                      unplayable={marqueeTmdbUnplayable(
                        snapshot?.addons ?? null,
                        filters.kind,
                        unplayable,
                        meta.id,
                      )}
                      onClick={() => openCard(meta)}
                    />
                  </li>
                ))}
              </ul>
            ) : null}

            {body === "empty" ? (
              <div className="mq-browse-empty-stage" data-testid="discover-empty">
                <EmptyState icon="compass" title={empty.title} body={empty.body} />
              </div>
            ) : null}

            {body === "read-on" ? (
              <div className="mq-browse-empty-stage">
                <EmptyState
                  icon="compass"
                  title={readOn.title}
                  body={readOn.body}
                  action={{
                    label: readOn.actionLabel,
                    onPress: () => session.feeds.more(read.key),
                  }}
                />
              </div>
            ) : null}

            {feed.failure ? (
              <div className="mq-browse-notice-wrap" data-testid="discover-failure">
                <AddonNotice
                  addon={source === "preview" ? "Cinemeta" : "TMDB"}
                  reason={explain(feed.failure)}
                  pending={loading}
                  onRetry={() => session.feeds.more(read.key)}
                />
              </div>
            ) : null}

            {feed.items.length > 0 && loading ? (
              <p
                className="mq-browse-inline-status mq-type-caption mq-text-faint"
                role="status"
              >
                Reading more…
              </p>
            ) : null}
          </DiscoverGridPort>
        </>
      ) : null}
    </section>
  );
}

/**
 * The grid's scrollport, which asks the next page near its end. A component of
 * its own because `useGridEnd` listens from its mount, and the port arrives only
 * once Discover has a feed to read.
 */
function DiscoverGridPort({
  inert,
  children,
  ...paging
}: GridEndOptions & { inert: boolean; children: ReactNode }) {
  const port = useGridEnd({
    ...paging,
    ahead: () =>
      gridFocusAheadForColumns(
        posterGridColumnsForViewport(window.innerWidth, window.innerHeight),
      ),
  });

  return (
    <section
      ref={port}
      className="mq-browse-grid-port"
      data-testid="discover-grid-port"
      inert={inert ? true : undefined}
    >
      {children}
    </section>
  );
}
