import { useEffect, useMemo, useRef, useSyncExternalStore, type FormEvent } from "react";

import { keyOf } from "../core/browse";
import { blankFeed, feedState } from "../core/discover";
import { explain } from "../core/errors";
import { addonLabel } from "../core/home";
import { marqueeTmdbUnplayable } from "../core/marqueeDiscover";
import {
  marqueeSearchPlan,
  searchCanReadOn,
  searchCatalogRowNote,
  searchCatalogRowTitles,
  searchNoCatalogsNote,
  searchPromptCopy,
  searchTmdbRowNote,
} from "../core/marqueeSearch";
import type { NewLevel } from "../core/navigation";
import { queryOf, searchFeedKey, type SearchKind } from "../core/search";
import { EMPTY_SEARCH_VIEW, type Session, type SessionState } from "../core/session";
import type { AddonManifest, MetaPreview } from "../core/wire";
import { EmptyState } from "../kit/marquee/EmptyState";
import { SearchField } from "../kit/marquee/SearchField";
import { PhoneAddonNotice } from "../kit/marquee/phone/PhoneAddonNotice";
import { PhonePoster } from "../kit/marquee/phone/PhonePoster";
import { PhoneRowHeader } from "../kit/marquee/phone/PhoneRowHeader";
import { PhoneButton } from "../kit/marquee/phone/controls";
import { titleLevelOf, type RemotePayload } from "./levels";

export type SearchProps = {
  session: Session;
  state: SessionState;
  push: (level: NewLevel<RemotePayload>) => string;
};

export function Search({ session, state, push }: SearchProps) {
  const snapshot = state.snapshot;
  const credential = snapshot ? snapshot.protection.tmdbHeld : null;
  const keyed = credential ?? false;

  const view = useSyncExternalStore(
    session.searchView.subscribe,
    session.searchView.get,
  );
  const catalogAnswers = useSyncExternalStore(
    session.searchCatalogs.subscribe,
    session.searchCatalogs.getSnapshot,
  );

  const { draft, query: committed } = view;
  const setDraft = (next: string) => session.searchView.set({ draft: next, query: committed });

  const previous = useRef<boolean | null>(null);
  useEffect(() => {
    if (credential === null) {
      return;
    }
    if (previous.current !== null && previous.current !== credential) {
      session.searchView.set(EMPTY_SEARCH_VIEW);
    }
    previous.current = credential;
  }, [credential, session]);

  useEffect(() => {
    if (committed === null || credential === null) {
      return;
    }
    const plan = marqueeSearchPlan(credential, committed);
    session.searchCatalogs.search(plan.catalogsQuery);
    for (const feed of plan.tmdbFeeds) {
      session.feeds.read(feed.key, feed.first, feed.next);
    }
  }, [committed, credential, session]);

  const watchedFilmKeys = useMemo(() => {
    const set = new Set<string>();
    for (const entry of snapshot?.watchProgress ?? []) {
      if (entry.watched && entry.title.type === "movie") {
        set.add(`${entry.title.type}:${entry.title.id}`);
      }
    }
    return set;
  }, [snapshot?.watchProgress]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = queryOf(draft);
    if (query === null) {
      return;
    }
    session.searchView.set({ draft, query });
  };

  const openTitle = (addon: string | null, meta: MetaPreview) => {
    push(titleLevelOf(addon, meta));
  };

  const answer = committed === null ? null : catalogAnswers.answers.get(committed);
  const catalogRows = answer?.rows ?? null;
  const catalogTitles = searchCatalogRowTitles(catalogRows ?? []);
  const catalogFailure = answer?.failure ?? null;
  const catalogLoading = committed !== null && catalogAnswers.reading.has(committed);
  const prompt = searchPromptCopy(keyed);
  const noCatalogs = searchNoCatalogsNote(keyed);
  const plan = committed !== null ? marqueeSearchPlan(keyed, committed) : null;

  return (
    <section
      className="mq-remote-screen"
      aria-label="Search"
      data-testid="remote-search"
    >
      <h1 className="mq-remote-visually-hidden">Search</h1>

      {snapshot === null ? (
        <p className="mq-remote-waiting" role="status">
          Waiting for the Host…
        </p>
      ) : (
        <>
          <form
            className="mq-remote-search-bar"
            role="search"
            aria-label="Search"
            onSubmit={submit}
          >
            <SearchField
              label="Search for a Title"
              placeholder={
                keyed
                  ? "Search movies and series"
                  : "Search Addons’ searchable Catalogs"
              }
              value={draft}
              onChange={setDraft}
            />
          </form>

          {committed === null ? (
            <div data-testid="search-prompt">
              <EmptyState icon="search" title={prompt.title} body={prompt.body} />
            </div>
          ) : (
            <div className="mq-remote-search-results" data-testid="search-results">
              {catalogLoading && !catalogRows ? (
                <p className="mq-remote-row-note" role="status" data-testid="search-catalogs-loading">
                  Searching every searchable Catalog…
                </p>
              ) : null}

              {catalogFailure ? (
                <div className="mq-remote-row-notice" data-testid="search-catalogs-failure">
                  <PhoneAddonNotice
                    title="Catalogs"
                    reason={explain(catalogFailure)}
                    disabled={catalogLoading}
                    onRetry={() => session.searchCatalogs.retry(committed)}
                  />
                </div>
              ) : null}

              {catalogRows?.map((row, index) => {
                const rowKey = keyOf(row);
                const source = addonLabel(snapshot, row.addon);
                const title = catalogTitles[index] ?? row.name;
                const note = searchCatalogRowNote(row, committed);
                return (
                  <section
                    key={rowKey}
                    className="mq-remote-row"
                    data-testid={`search-row-${rowKey}`}
                  >
                    <div className="mq-remote-row-head">
                      <PhoneRowHeader title={title} source={source} />
                    </div>

                    {row.metas.length > 0 ? (
                      <div className="mq-remote-track">
                        {row.metas.map((meta) => {
                          const watched = watchedFilmKeys.has(`${meta.type}:${meta.id}`);
                          const unplayable = state.unplayable.has(meta.id);
                          return (
                            <div
                              key={meta.id}
                              className="mq-remote-poster-slot"
                              data-watched={watched || undefined}
                              data-unplayable={unplayable || undefined}
                            >
                              <PhonePoster
                                name={meta.name}
                                poster={meta.poster}
                                testId={`search-card-${row.addon}-${meta.id}`}
                                onPress={() => openTitle(row.addon, meta)}
                              />
                              {unplayable ? (
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
                    ) : null}

                    {row.failure ? (
                      <div className="mq-remote-row-notice">
                        <PhoneAddonNotice
                          title={source}
                          reason={explain(row.failure)}
                          disabled={catalogLoading}
                          onRetry={() => session.searchCatalogs.retry(committed)}
                        />
                      </div>
                    ) : note ? (
                      <p className="mq-remote-row-note">{note}</p>
                    ) : null}
                  </section>
                );
              })}

              {!catalogLoading && !catalogFailure && catalogRows?.length === 0 && noCatalogs ? (
                <p className="mq-remote-row-note" data-testid="search-no-answer">
                  {noCatalogs}
                </p>
              ) : null}

              {plan?.tmdbFeeds.map(({ kind }) => (
                <TmdbSearchRow
                  key={kind}
                  kind={kind}
                  query={committed}
                  session={session}
                  addons={snapshot.addons}
                  watchedFilmKeys={watchedFilmKeys}
                  unplayable={state.unplayable}
                  onOpen={(meta) => openTitle(null, meta)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function TmdbSearchRow({
  kind,
  query,
  session,
  addons,
  watchedFilmKeys,
  unplayable,
  onOpen,
}: {
  kind: SearchKind;
  query: string;
  session: Session;
  addons: readonly AddonManifest[];
  watchedFilmKeys: ReadonlySet<string>;
  unplayable: ReadonlySet<string>;
  onOpen: (meta: MetaPreview) => void;
}) {
  const feeds = useSyncExternalStore(session.feeds.subscribe, session.feeds.getSnapshot);
  const feedKey = searchFeedKey(query, kind);
  const feed = feeds.rows.get(feedKey) ?? blankFeed();
  const reading = feeds.reading.has(feedKey);
  const phase = feedState(feed, reading);
  const title = kind === "movie" ? "Movies" : "Series";
  const note = searchTmdbRowNote(feed, phase, kind, query);
  const canMore = searchCanReadOn(feed);

  return (
    <section className="mq-remote-row" data-testid={`remote-search-row-${kind}`}>
      <div className="mq-remote-row-head">
        <PhoneRowHeader title={title} source="TMDB" />
      </div>

      {feed.items.length > 0 ? (
        <div className="mq-remote-track">
          {feed.items.map((meta) => {
            const watched = watchedFilmKeys.has(`${meta.type}:${meta.id}`);
            const isUnplayable = marqueeTmdbUnplayable(addons, kind, unplayable, meta.id);
            return (
              <div
                key={meta.id}
                className="mq-remote-poster-slot"
                data-watched={watched || undefined}
                data-unplayable={isUnplayable || undefined}
              >
                <PhonePoster
                  name={meta.name}
                  poster={meta.poster}
                  testId={`search-card-${kind}-${meta.id}`}
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
      ) : null}

      {canMore ? (
        <div className="mq-remote-read-on">
          <PhoneButton
            kind="secondary"
            disabled={reading}
            onClick={() => session.feeds.more(feedKey)}
          >
            {reading ? "Reading on…" : "Read on"}
          </PhoneButton>
        </div>
      ) : null}

      {feed.failure ? (
        <div className="mq-remote-row-notice">
          <PhoneAddonNotice
            title="TMDB"
            reason={explain(feed.failure)}
            disabled={reading}
            onRetry={() => session.feeds.more(feedKey)}
          />
        </div>
      ) : note ? (
        <p className="mq-remote-row-note">{note}</p>
      ) : null}
    </section>
  );
}
