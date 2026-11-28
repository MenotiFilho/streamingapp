import {
  useEffect,
  useMemo,
  useSyncExternalStore,
  type FormEvent,
} from "react";

import { keyOf } from "../../core/browse";
import { blankFeed, feedMore, feedState } from "../../core/discover";
import { explain } from "../../core/errors";
import { addonLabel } from "../../core/home";
import {
  marqueeSearchPlan,
  searchCatalogRowNote,
  searchNoCatalogsNote,
  searchPromptCopy,
  searchTmdbRowNote,
} from "../../core/marqueeSearch";
import { queryOf, searchFeedKey, type SearchKind } from "../../core/search";
import { AddonNotice } from "../../kit/marquee/AddonNotice";
import { Button } from "../../kit/marquee/Button";
import { EmptyState } from "../../kit/marquee/EmptyState";
import { Poster } from "../../kit/marquee/Poster";
import { RowHeader } from "../../kit/marquee/RowHeader";
import { SearchField } from "../../kit/marquee/SearchField";
import { useShell } from "../context";
import { usePreviewData } from "../repertory/context";
import { lookHintHandlers, useLookHints } from "../repertory/lookHint";
import { useTitleOpener } from "../TitleScreen";
import "./browse.css";

/**
 * Marquee Search (`16.jpg`, ADR-0043 §4):
 * - Single SearchField querying Addons' searchable Catalogs (`search_catalogs`)
 *   and TMDB (`search` for Movies and Series when a key is held) together.
 * - Keeps Movies and Series together in rows (ADR-0036 §1).
 * - Disabled Addons are already skipped by the Host (`ADR-0044 §2`).
 */
export function MarqueeSearch() {
  const preview = usePreviewData();
  const { snapshot, session } = useShell();
  const { openTitle, openDiscoveredTitle } = useTitleOpener();
  const look = useLookHints();

  const view = useSyncExternalStore(
    session.searchView.subscribe,
    session.searchView.get,
  );
  const feeds = useSyncExternalStore(
    session.feeds.subscribe,
    session.feeds.getSnapshot,
  );
  const catalogAnswers = useSyncExternalStore(
    session.searchCatalogs.subscribe,
    session.searchCatalogs.getSnapshot,
  );

  const { draft, query: committed } = view;
  const keyed = !preview && (snapshot?.protection.tmdbHeld ?? false);

  useEffect(() => {
    if (snapshot === null || committed === null) {
      return;
    }
    const plan = marqueeSearchPlan(keyed, committed);
    session.searchCatalogs.search(plan.catalogsQuery);
    for (const feed of plan.tmdbFeeds) {
      session.feeds.read(feed.key, feed.first, feed.next);
    }
  }, [committed, keyed, session, snapshot]);

  const watchedFilmKeys = useMemo(() => {
    const set = new Set<string>();
    for (const entry of snapshot?.watchProgress ?? []) {
      if (entry.watched && entry.title.type === "movie") {
        set.add(`${entry.title.type}:${entry.title.id}`);
      }
    }
    return set;
  }, [snapshot?.watchProgress]);

  const setDraft = (next: string) =>
    session.searchView.set({ draft: next, query: committed });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = queryOf(draft);
    if (query === null) {
      return;
    }
    session.searchView.set({ draft, query });
  };

  const answer = committed === null ? null : catalogAnswers.answers.get(committed);
  const catalogRows = answer?.rows ?? null;
  const catalogFailure = answer?.failure ?? null;
  const catalogLoading =
    committed !== null && catalogAnswers.reading.has(committed);
  const prompt = searchPromptCopy(keyed);
  const noCatalogs = searchNoCatalogsNote(keyed);

  const plan = committed !== null ? marqueeSearchPlan(keyed, committed) : null;

  return (
    <section
      className="mq-browse-screen mq-search"
      data-testid="search-screen"
      data-region="search-screen"
      data-kind="branch"
      data-label="Search"
    >
      <h1 className="mq-visually-hidden">Search</h1>

      {snapshot === null ? (
        <p className="mq-browse-waiting mq-type-caption mq-text-faint" role="status">
          Waiting for the Host…
        </p>
      ) : (
        <>
          <form
            className="mq-search-bar"
            role="search"
            aria-label="Search"
            data-region="search-bar"
            data-kind="branch"
            data-label="Search"
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

          <div className="mq-search-results-port" data-testid="search-results">
            {committed === null ? (
              <div className="mq-search-prompt" data-testid="search-prompt">
                <EmptyState icon="search" title={prompt.title} body={prompt.body} />
              </div>
            ) : (
              <>
                <div data-testid="search-catalogs">
                  {catalogLoading && !catalogRows ? (
                    <p
                      role="status"
                      className="mq-search-status mq-type-caption mq-text-faint"
                      data-testid="search-catalogs-loading"
                    >
                      Searching every searchable Catalog…
                    </p>
                  ) : null}

                  {catalogFailure ? (
                    <div
                      className="mq-search-row-notice"
                      data-testid="search-catalogs-failure"
                    >
                      <AddonNotice
                        addon="Catalogs"
                        reason={explain(catalogFailure)}
                        pending={catalogLoading}
                        retryLabel="Search again"
                        onRetry={() => session.searchCatalogs.retry(committed)}
                      />
                    </div>
                  ) : null}

                  {catalogRows?.map((row) => {
                    const rowKey = keyOf(row);
                    const source = addonLabel(snapshot, row.addon);
                    const note = searchCatalogRowNote(row, committed);
                    return (
                      <section
                        key={rowKey}
                        className="mq-search-row"
                        data-testid={`search-row-${rowKey}`}
                        data-region={`search-row:${rowKey}`}
                        data-kind="row"
                        data-label={`${row.name} (${source})`}
                      >
                        <div className="mq-search-row-head">
                          <RowHeader title={row.name} source={source} />
                        </div>

                        {row.metas.length > 0 ? (
                          <ul className="mq-browse-track mq-browse-track--poster">
                            {row.metas.map((meta) => (
                              <li key={meta.id} className="mq-browse-track-item">
                                <Poster
                                  {...lookHintHandlers(look, {
                                    addon: row.addon,
                                    type: meta.type,
                                    id: meta.id,
                                  })}
                                  className="mq-browse-card"
                                  data-testid={`search-card-${row.addon}-${meta.id}`}
                                  name={meta.name}
                                  poster={meta.poster}
                                  watched={watchedFilmKeys.has(
                                    `${meta.type}:${meta.id}`,
                                  )}
                                  onClick={() => openTitle(row.addon, meta)}
                                />
                              </li>
                            ))}
                          </ul>
                        ) : null}

                        {row.failure ? (
                          <div className="mq-search-row-notice">
                            <AddonNotice
                              addon={source}
                              reason={explain(row.failure)}
                              pending={catalogLoading}
                              retryLabel="Search again"
                              onRetry={() => session.searchCatalogs.retry(committed)}
                            />
                          </div>
                        ) : note ? (
                          <p className="mq-search-row-status mq-type-caption mq-text-faint">
                            {note}
                          </p>
                        ) : null}
                      </section>
                    );
                  })}

                  {!catalogLoading &&
                  !catalogFailure &&
                  catalogRows?.length === 0 &&
                  noCatalogs ? (
                    <p
                      className="mq-search-status mq-type-caption mq-text-faint"
                      data-testid="search-no-answer"
                    >
                      {noCatalogs}
                    </p>
                  ) : null}
                </div>

                {plan && plan.tmdbFeeds.length > 0 ? (
                  <div data-testid="search-tmdb">
                    {plan.tmdbFeeds.map(({ kind }) => (
                      <TmdbSearchRow
                        key={kind}
                        kind={kind}
                        query={committed}
                        feedKey={searchFeedKey(committed, kind)}
                        feeds={feeds}
                        watchedFilmKeys={watchedFilmKeys}
                        onMore={() => session.feeds.more(searchFeedKey(committed, kind))}
                        onOpen={(meta) => void openDiscoveredTitle(meta)}
                        look={look}
                      />
                    ))}
                  </div>
                ) : null}
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function TmdbSearchRow({
  kind,
  query,
  feedKey,
  feeds,
  watchedFilmKeys,
  onMore,
  onOpen,
  look,
}: {
  kind: SearchKind;
  query: string;
  feedKey: string;
  feeds: ReturnType<typeof useShell>["session"]["feeds"]["getSnapshot"] extends () => infer S
    ? S
    : never;
  watchedFilmKeys: ReadonlySet<string>;
  onMore: () => void;
  onOpen: (meta: Parameters<ReturnType<typeof useTitleOpener>["openDiscoveredTitle"]>[0]) => void;
  look: ReturnType<typeof useLookHints>;
}) {
  const feed = feeds.rows.get(feedKey) ?? blankFeed();
  const loading = feeds.reading.has(feedKey);
  const state = feedState(feed, loading);
  const note = searchTmdbRowNote(feed, state, kind, query);
  const title = kind === "movie" ? "Movies" : "Series";
  const canMore = feedMore(feed) && !loading && !feed.failure && feed.items.length > 0;

  return (
    <section
      className="mq-search-row"
      data-testid={`search-row-${kind}`}
      data-region={`search-row:${kind}`}
      data-kind="row"
      data-label={`${title} (TMDB)`}
    >
      <div className="mq-search-row-head">
        <RowHeader title={title} source="TMDB" />
        {canMore ? (
          <Button kind="ghost" size="md" onClick={onMore}>
            Read on
          </Button>
        ) : null}
      </div>

      {feed.items.length > 0 ? (
        <ul className="mq-browse-track mq-browse-track--poster">
          {feed.items.map((meta) => (
            <li key={meta.id} className="mq-browse-track-item">
              <Poster
                {...lookHintHandlers(look, {
                  addon: null,
                  type: meta.type,
                  id: meta.id,
                })}
                className="mq-browse-card"
                data-testid={`search-card-${kind}-${meta.id}`}
                name={meta.name}
                poster={meta.poster}
                watched={watchedFilmKeys.has(`${meta.type}:${meta.id}`)}
                onClick={() => onOpen(meta)}
              />
            </li>
          ))}
        </ul>
      ) : null}

      {feed.failure ? (
        <div className="mq-search-row-notice">
          <AddonNotice
            addon="TMDB"
            reason={explain(feed.failure)}
            pending={loading}
            onRetry={onMore}
          />
        </div>
      ) : note ? (
        <p className="mq-search-row-status mq-type-caption mq-text-faint">{note}</p>
      ) : null}
    </section>
  );
}
