import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type Ref,
} from "react";

import {
  blankFeed,
  feedState,
  type DiscoverKind,
} from "../core/discover";
import { explain } from "../core/errors";
import { gridPaging, type PageState } from "../core/gridPaging";
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
} from "../core/marqueeDiscover";
import type { NewLevel } from "../core/navigation";
import { useGridEnd } from "../core/react/useGridEnd";
import type { Session, SessionState } from "../core/session";
import type { MetaPreview } from "../core/wire";
import { Dropdown } from "../kit/Dropdown";
import { EmptyState } from "../kit/EmptyState";
import { PhoneAddonNotice } from "../kit/phone/PhoneAddonNotice";
import { PhonePoster } from "../kit/phone/PhonePoster";
import { titleLevelOf, type RemotePayload } from "./levels";

type OpenMenu = "type" | "genre" | "sort" | null;

export type DiscoverProps = {
  session: Session;
  state: SessionState;
  push: (level: NewLevel<RemotePayload>) => string;
  openSettings?: () => void;
};

export function Discover({ session, state, push, openSettings }: DiscoverProps) {
  const snapshot = state.snapshot;
  const feeds = useSyncExternalStore(
    session.feeds.subscribe,
    session.feeds.getSnapshot,
  );
  const filters = useSyncExternalStore(
    session.discoverFilters.subscribe,
    session.discoverFilters.get,
  );

  const keyed = snapshot?.protection.tmdbHeld ?? false;
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null);
  const filtersRef = useRef<HTMLDivElement | null>(null);

  const genres = useMemo(
    () => discoverGenreOptions("host", filters.kind),
    [filters.kind],
  );
  const sorts = useMemo(
    () => discoverSortOptions("host", filters.kind),
    [filters.kind],
  );

  const selectedGenre =
    genres.find((option) => option.id === filters.genreId) ?? genres[0]!;
  const selectedSort =
    sorts.find((option) => option.id === filters.sortId) ?? sorts[0]!;

  useEffect(() => {
    const next = reconcileDiscoverFilters({
      nextKind: filters.kind,
      genreId: filters.genreId,
      sortId: filters.sortId,
      source: "host",
    });
    if (next.genreId !== filters.genreId || next.sortId !== filters.sortId) {
      session.discoverFilters.set(next);
    }
  }, [filters.genreId, filters.kind, filters.sortId, session]);

  useEffect(() => {
    if (openMenu === null) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (
        filtersRef.current &&
        event.target instanceof Node &&
        !filtersRef.current.contains(event.target)
      ) {
        setOpenMenu(null);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [openMenu]);

  const readPlan = useMemo(
    () =>
      keyed
        ? marqueeDiscoverRead({
            source: "host",
            kind: filters.kind,
            genre: selectedGenre,
            sort: selectedSort,
            previewAddonId: "",
          })
        : null,
    [filters.kind, keyed, selectedGenre, selectedSort],
  );

  const hadKey = useRef<boolean | null>(null);
  useEffect(() => {
    if (snapshot === null) {
      return;
    }
    if (hadKey.current === false && keyed) {
      session.discoverFilters.set(INITIAL_DISCOVER_FILTERS);
    }
    hadKey.current = keyed;
  }, [keyed, session, snapshot]);

  useEffect(() => {
    if (!readPlan || session.discoverFilters.get() !== filters) {
      return;
    }
    session.feeds.read(readPlan.key, readPlan.first, readPlan.next);
  }, [filters, readPlan, session]);

  const watchedFilmKeys = useMemo(() => {
    const set = new Set<string>();
    for (const entry of snapshot?.watchProgress ?? []) {
      if (entry.watched && entry.title.type === "movie") {
        set.add(`${entry.title.type}:${entry.title.id}`);
      }
    }
    return set;
  }, [snapshot?.watchProgress]);

  const feed = (readPlan ? feeds.rows.get(readPlan.key) : null) ?? blankFeed();
  const reading = readPlan !== null && feeds.reading.has(readPlan.key);
  const stateOf = feedState(feed, reading);
  const body = discoverGridBody(feed, stateOf);
  const paging = gridPaging({
    done: feed.done,
    failure: feed.failure,
    pageable: true,
    reading,
    count: feed.items.length,
  });

  const pageTarget: PageState | null = readPlan !== null ? paging.page : null;
  const gridRef = useGridEnd({
    count: feed.items.length,
    page: pageTarget,
    reading: paging.reading,
    onReach: () => {
      if (readPlan !== null) {
        session.feeds.more(readPlan.key);
      }
    },
  });

  const pickKind = (nextKind: DiscoverKind) => {
    setOpenMenu(null);
    session.discoverFilters.set(
      reconcileDiscoverFilters({
        nextKind,
        genreId: filters.genreId,
        sortId: filters.sortId,
        source: "host",
      }),
    );
  };

  const pickGenre = (genreId: string) => {
    setOpenMenu(null);
    session.discoverFilters.set({ ...filters, genreId });
  };

  const pickSort = (sortId: string) => {
    setOpenMenu(null);
    session.discoverFilters.set({
      ...filters,
      sortId: sortId as DiscoverSortKey,
    });
  };

  const openMeta = (meta: MetaPreview) => {
    push(titleLevelOf(null, meta));
  };

  const noKeyCopy = discoverNoKeyCopy();
  const emptyCopy = discoverEmptyCopy(selectedGenre);
  const readOnCopy = discoverReadOnCopy();

  return (
    <section
      className="mq-remote-screen"
      aria-label="Discover"
      data-testid="remote-discover"
    >
      <header className="mq-remote-large-head">
        <div className="mq-remote-large-head-titles">
          <h1 className="mq-remote-large-title">Discover</h1>
          {keyed ? <p className="mq-remote-large-subtitle">From TMDB</p> : null}
        </div>
      </header>

      {snapshot === null ? (
        <p className="mq-remote-waiting" role="status">
          Waiting for the Host…
        </p>
      ) : !keyed ? (
        <div data-testid="discover-no-key">
          <EmptyState
            icon="compass"
            title={noKeyCopy.title}
            body={noKeyCopy.body}
            action={
              openSettings
                ? { label: "Open Settings", onPress: openSettings }
                : undefined
            }
          />
        </div>
      ) : (
        <>
          <div className="mq-remote-filters" ref={filtersRef} data-testid="discover-filters">
            <Dropdown
              label="Type"
              hideLabel
              open={openMenu === "type"}
              onOpenChange={(next) => setOpenMenu(next ? "type" : null)}
              options={DISCOVER_TYPES.map((item) => ({ id: item.id, label: item.label }))}
              selected={filters.kind}
              onSelect={(id) => pickKind(id as DiscoverKind)}
            />
            <Dropdown
              label="Genre"
              hideLabel
              open={openMenu === "genre"}
              onOpenChange={(next) => setOpenMenu(next ? "genre" : null)}
              options={genres.map((item) => ({ id: item.id, label: item.label }))}
              selected={selectedGenre.id}
              onSelect={pickGenre}
            />
            <Dropdown
              label="Sort"
              hideLabel
              open={openMenu === "sort"}
              onOpenChange={(next) => setOpenMenu(next ? "sort" : null)}
              options={sorts.map((item) => ({ id: item.id, label: item.label }))}
              selected={selectedSort.id}
              onSelect={pickSort}
            />
          </div>

          <DiscoverGridBodyView
            body={body}
            metas={feed.items}
            gridRef={gridRef as Ref<HTMLDivElement>}
            reading={reading}
            failureReason={feed.failure ? explain(feed.failure) : null}
            emptyCopy={emptyCopy}
            readOnCopy={readOnCopy}
            watchedFilmKeys={watchedFilmKeys}
            unplayable={state.unplayable}
            addons={snapshot.addons}
            kind={filters.kind}
            onOpen={openMeta}
            onRetry={() => {
              if (readPlan !== null) {
                session.feeds.more(readPlan.key);
              }
            }}
            onReadOn={() => {
              if (readPlan !== null) {
                session.feeds.more(readPlan.key);
              }
            }}
          />
        </>
      )}
    </section>
  );
}

function DiscoverGridBodyView({
  body,
  metas,
  gridRef,
  reading,
  failureReason,
  emptyCopy,
  readOnCopy,
  watchedFilmKeys,
  unplayable,
  addons,
  kind,
  onOpen,
  onRetry,
  onReadOn,
}: {
  body: ReturnType<typeof discoverGridBody>;
  metas: readonly MetaPreview[];
  gridRef: Ref<HTMLDivElement>;
  reading: boolean;
  failureReason: string | null;
  emptyCopy: { title: string; body: string };
  readOnCopy: { title: string; body: string; actionLabel: string };
  watchedFilmKeys: ReadonlySet<string>;
  unplayable: ReadonlySet<string>;
  addons: Parameters<typeof marqueeTmdbUnplayable>[0];
  kind: DiscoverKind;
  onOpen: (meta: MetaPreview) => void;
  onRetry: () => void;
  onReadOn: () => void;
}) {
  let content: ReactNode = null;

  if (body === "loading") {
    content = (
      <p className="mq-remote-waiting" role="status" data-testid="discover-loading">
        Reading Discover…
      </p>
    );
  } else if (body === "empty") {
    content = (
      <div data-testid="discover-empty">
        <EmptyState icon="compass" title={emptyCopy.title} body={emptyCopy.body} />
      </div>
    );
  } else if (body === "read-on") {
    content = (
      <div data-testid="discover-read-on">
        <EmptyState
          icon="compass"
          title={readOnCopy.title}
          body={readOnCopy.body}
          action={{ label: readOnCopy.actionLabel, onPress: onReadOn }}
        />
      </div>
    );
  } else if (body === "cards") {
    content = (
      <>
        <div className="mq-remote-grid" data-testid="discover-grid">
          {metas.map((meta) => {
            const watched = watchedFilmKeys.has(`${meta.type}:${meta.id}`);
            const isUnplayable = marqueeTmdbUnplayable(
              addons,
              kind,
              unplayable,
              meta.id,
            );
            return (
              <div
                key={meta.id}
                className="mq-remote-poster-slot"
                data-grid-card="true"
                data-watched={watched || undefined}
                data-unplayable={isUnplayable || undefined}
              >
                <PhonePoster
                  name={meta.name}
                  poster={meta.poster}
                  testId={`discover-card-${meta.id}`}
                  onPress={() => onOpen(meta)}
                />
                {isUnplayable ? (
                  <span className="mq-remote-poster-badge" aria-hidden="true">
                    Unplayable
                  </span>
                ) : watched ? (
                  <span
                    className="mq-remote-poster-badge"
                    data-tone="accent"
                    aria-hidden="true"
                  >
                    Watched
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>

        {reading ? (
          <p className="mq-remote-grid-status" role="status">
            Reading on…
          </p>
        ) : null}
      </>
    );
  }

  return (
    <div ref={gridRef}>
      {content}
      {failureReason ? (
        <div className="mq-remote-row-notice" data-testid="discover-failure">
          <PhoneAddonNotice
            title="Discover"
            reason={failureReason}
            disabled={reading}
            onRetry={onRetry}
          />
        </div>
      ) : null}
    </div>
  );
}
