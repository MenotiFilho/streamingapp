import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
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
  DISCOVER_TYPES,
  INITIAL_DISCOVER_FILTERS,
  discoverEmptyCopy,
  discoverGenreOptions,
  discoverInitialLoading,
  discoverNoKeyCopy,
  discoverSortOptions,
  marqueeDiscoverRead,
  reconcileDiscoverFilters,
  type DiscoverFilterState,
  type DiscoverSortKey,
} from "../../core/marqueeDiscover";
import { useGridEnd } from "../../core/react/useGridEnd";
import type { MetaPreview } from "../../core/wire";
import { AddonNotice } from "../../kit/marquee/AddonNotice";
import { Dropdown } from "../../kit/marquee/Dropdown";
import { EmptyState } from "../../kit/marquee/EmptyState";
import { Poster } from "../../kit/marquee/Poster";
import { ScreenTitle } from "../../kit/marquee/ScreenTitle";
import { Spinner } from "../../kit/marquee/Spinner";
import { useShell } from "../context";
import { usePreviewData } from "../repertory/context";
import { lookHintHandlers, useLookHints } from "../repertory/lookHint";
import {
  CINEMETA_MOVIE_GENRES,
  CINEMETA_SERIES_GENRES,
  PREVIEW_ADDON,
} from "../repertory/preview";
import { useTitleOpener } from "../TitleScreen";
import "./browse.css";

type OpenMenu = "type" | "genre" | "sort" | null;

/**
 * Marquee Discover (`14.jpg`, `14b.jpg`, `15.jpg`):
 * - Single-kind Type dropdown (Movies / Series, ADR-0043 §4 amendment to ADR-0036 §1),
 *   per-kind Genre dropdown, and Sort dropdown passed to the `discover` Action.
 * - 7-column infinite-paging Poster grid backed by the Session `FeedStore`.
 * - Empty state when the Host holds no TMDB Credential (`15.jpg`), navigating to Settings.
 */
export function MarqueeDiscover() {
  const preview = usePreviewData();
  const { snapshot, session, choose, setBaseIntentHandler } = useShell();
  const { openTitle, openDiscoveredTitle } = useTitleOpener();
  const look = useLookHints();
  const feeds = useSyncExternalStore(
    session.feeds.subscribe,
    session.feeds.getSnapshot,
  );

  const keyed = snapshot?.protection.tmdbHeld ?? false;
  const source: DiscoverSource = preview ? "preview" : "host";
  const active = preview || keyed;

  const [filters, setFilters] = useState<DiscoverFilterState>(INITIAL_DISCOVER_FILTERS);
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
      setFilters(INITIAL_DISCOVER_FILTERS);
      setOpenMenu(null);
    }
    previous.current = { active, source };
  }, [active, source]);

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
    if (!active) {
      return;
    }
    session.feeds.read(read.key, read.first, read.next);
  }, [active, read, session]);

  // Keep Back (Escape / Backspace) and D-pad navigation inside an open Dropdown menu.
  useEffect(() => {
    if (openMenu === null) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Backspace" || event.key === "GoBack") {
        event.preventDefault();
        event.stopPropagation();
        setOpenMenu(null);
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !filtersRef.current?.contains(target)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [openMenu]);

  useEffect(() => {
    const clear = setBaseIntentHandler((intent) => {
      if (openMenu === null) {
        return false;
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

  const gridPort = useGridEnd({
    count: feed.items.length,
    page: paging.page,
    reading: paging.reading,
    onReach: () => session.feeds.more(read.key),
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
    setFilters((current) =>
      reconcileDiscoverFilters({
        nextKind,
        genreId: current.genreId,
        sortId: current.sortId,
        source,
        previewGenres: nextPreviewGenres,
      }),
    );
  };

  const noKey = discoverNoKeyCopy();
  const empty = discoverEmptyCopy(selectedGenre);
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
              onSelect={(genreId) => setFilters((current) => ({ ...current, genreId }))}
            />
            <Dropdown
              label="Sort"
              options={sorts}
              selected={selectedSort.id}
              open={openMenu === "sort"}
              onOpenChange={(open) => setOpenMenu(open ? "sort" : null)}
              onSelect={(sortId) =>
                setFilters((current) => ({
                  ...current,
                  sortId: sortId as DiscoverSortKey,
                }))
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

          <section
            ref={gridPort}
            className="mq-browse-grid-port"
            data-testid="discover-grid-port"
            inert={openMenu !== null ? true : undefined}
          >
            {discoverInitialLoading(feed, state) ? (
              <div className="mq-browse-loading">
                <Spinner label="Reading Discover…" />
              </div>
            ) : null}

            {feed.items.length > 0 ? (
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
                      onClick={() => openCard(meta)}
                    />
                  </li>
                ))}
              </ul>
            ) : null}

            {!discoverInitialLoading(feed, state) &&
            feed.items.length === 0 &&
            !feed.failure ? (
              <div className="mq-browse-empty-stage" data-testid="discover-empty">
                <EmptyState icon="compass" title={empty.title} body={empty.body} />
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
          </section>
        </>
      ) : null}
    </section>
  );
}
