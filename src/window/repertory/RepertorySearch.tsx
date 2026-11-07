import {
  useEffect,
  useRef,
  useSyncExternalStore,
  type FormEvent,
} from "react";

import { keyOf } from "../../core/browse";
import { blankFeed, discoverPlayable, type DiscoverFeed } from "../../core/discover";
import type { CatalogRow, MetaPreview } from "../../core/wire";
import { explain } from "../../core/errors";
import { pageAttrs } from "../../core/pageLayout";
import {
  SEARCH_KINDS,
  queryOf,
  searchFeedKey,
  searchReads,
  type SearchKind,
} from "../../core/search";
import { EMPTY_SEARCH_VIEW } from "../../core/session";
import { useShell } from "../context";
import { addonLabel } from "../../core/home";
import { useTitleOpener } from "../TitleScreen";
import { usePreviewData } from "./context";
import { feedMore, feedState } from "../../core/discover";
import { FeedGrid } from "./FeedGrid";
import { EditorialGrid } from "./EditorialGrid";
import { EditorialRow, FeedPagingAction } from "./EditorialRow";
import { Button } from "../../kit/Button";
import { Field } from "../../kit/Field";
import { PosterCard } from "../../kit/PosterCard";
import { ProgrammeLine } from "./ProgrammeLine";
import { rowTagOf, yearOf } from "./program";
import { useFeedCards } from "./useFeedCards";
import "./repertory.css";

/**
 * Search as an editorial feed: one submit-only query bar drawn as a
 * display-serif line, and one row per answer.
 *
 * A query is asked both ways the Host offers, read from the Snapshot
 * (ADR-0010's amendment, ADR-0020): with a TMDB Credential it is asked once for
 * Movies and once for Series — both in flight, both drawn, Movies then Series —
 * and each row keeps its cards, its own failure and its own paging. There are
 * no kind chips (ADR-0036 §1). With no key it is `search_catalogs`, answered one
 * row per searchable Catalog in the Host's order, and a Catalog that failed
 * stays in its own row (ADR-0010). That arm is one page: the Action takes no
 * page, so a keyless row has no paging to offer. The bar submits, never asks
 * per keystroke.
 *
 * The field, the query and the rows live in the Session (#264): a whole-row
 * grid is a pushed level, and the screen must come back to the same words and
 * pages. A keyed row's grid reads the same Session row the rail draws, so a
 * page read there is in the rail after Back.
 *
 * The plain Vite preview has no Host and no TMDB network, so it always takes the
 * keyless arm even when the rehearsal Settings hold a key flag.
 */
export function RepertorySearchScreen() {
  const preview = usePreviewData();
  const { snapshot, session, push, pop, unplayable } = useShell();
  const { openTitle, openDiscoveredTitle } = useTitleOpener();
  const view = useSyncExternalStore(
    session.searchView.subscribe,
    session.searchView.get,
  );
  const feeds = useSyncExternalStore(session.feeds.subscribe, session.feeds.getSnapshot);
  const catalogAnswers = useSyncExternalStore(
    session.searchCatalogs.subscribe,
    session.searchCatalogs.getSnapshot,
  );
  const { draft, query: committed } = view;

  const keyed = !preview && (snapshot?.protection.tmdbHeld ?? false);
  const { panel, style, chrome } = useFeedCards(keyed ? SEARCH_KINDS.length : 0);

  // A credential added or cleared changes which arm a query takes. The rows of
  // the old arm are not answers to the new one, so they go.
  const previous = useRef(keyed);
  useEffect(() => {
    if (previous.current !== keyed) {
      session.searchView.set(EMPTY_SEARCH_VIEW);
    }
    previous.current = keyed;
  }, [keyed, session]);

  // A mount joins the Session's rows; only a query with no answer asks page 1.
  // Which asks a query makes is the core's one decision (`searchReads`), shared
  // with the Remote.
  useEffect(() => {
    if (committed === null) {
      return;
    }
    // A credential change resets the view in the effect above; this render's
    // closure still holds the old query, and it must not ask the new arm.
    if (session.searchView.get().query !== committed) {
      return;
    }
    const read = searchReads(keyed, committed);
    if (read.arm === "catalogs") {
      session.searchCatalogs.search(read.query);
      return;
    }
    for (const feed of read.feeds) {
      session.feeds.read(feed.key, feed.first, feed.next);
    }
  }, [committed, keyed, session]);

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

  /** Page one keyed row on from where it has read to. */
  const more = (kind: SearchKind) => {
    if (committed === null) {
      return;
    }
    session.feeds.more(searchFeedKey(committed, kind));
  };

  const canSubmit = queryOf(draft) !== null;

  const rowNote = (
    feed: DiscoverFeed,
    loading: boolean,
    kind: SearchKind,
    query: string,
  ) => {
    const lower = kind === "movie" ? "movies" : "series";
    switch (feedState(feed, loading)) {
      case "reading":
        return `Looking for ${lower}…`;
      case "reading-more":
        return `Looking for more ${lower}…`;
      case "empty":
        return `No ${lower} matched \u201c${query}\u201d.`;
      default:
        return null;
    }
  };

  const catalogNote = (row: CatalogRow) => {
    if (row.failure) {
      return null;
    }
    if (row.sent === 0) {
      return "This Catalog answered with no match.";
    }
    if (row.metas.length === 0) {
      return "This Catalog sent items the Host could not read.";
    }
    return null;
  };

  /** Whether a Title of one kind can be opened against the configured Addons. */
  const couldPlay = (kind: SearchKind) =>
    snapshot === null ? false : discoverPlayable(snapshot.addons, kind);

  const keyedCard = (meta: MetaPreview, testId: string, playable: boolean) => (
    <PosterCard
      key={meta.id}
      data-grid-card
      name={meta.name}
      poster={meta.poster}
      rating={meta.imdbRating?.trim() || null}
      subtitle={yearOf(meta)}
      unplayable={!playable || unplayable.has(meta.id)}
      testId={testId}
      onClick={() => void openDiscoveredTitle(meta)}
    />
  );

  const openKeyedGrid = (kind: SearchKind, label: string) => {
    if (committed === null) {
      return;
    }
    const key = searchFeedKey(committed, kind);
    push({
      name: `All of ${label}`,
      kind: "overlay",
      payload: {
        render: () => (
          <FeedGrid
            feedKey={key}
            title={label}
            tag={(feed) => rowTagOf("TMDB", kind, feed.items.length)}
            renderCard={(meta) =>
              keyedCard(
                meta,
                `search-grid-card-${kind}-${meta.id}`,
                couldPlay(kind),
              )
            }
            onClose={pop}
            testId="search-grid"
          />
        ),
      },
    });
  };

  const keyedAction = (kind: SearchKind) => {
    const key = searchFeedKey(committed ?? "", kind);
    const feed = feeds.rows.get(key) ?? blankFeed();
    const loading = feeds.reading.has(key);
    return (
      <FeedPagingAction
        failure={feed.failure}
        more={feedMore(feed)}
        loading={loading}
        onMore={() => more(kind)}
      />
    );
  };

  const catalogCard = (row: CatalogRow, meta: MetaPreview, testId: string) => (
    <PosterCard
      key={meta.id}
      data-grid-card
      name={meta.name}
      poster={meta.poster}
      rating={meta.imdbRating?.trim() || null}
      subtitle={yearOf(meta)}
      unplayable={unplayable.has(meta.id)}
      testId={testId}
      onClick={() => void openTitle(row.addon, meta)}
    />
  );

  const catalogTag = (row: CatalogRow) =>
    rowTagOf(addonLabel(snapshot, row.addon), row.type, row.metas.length);

  const openCatalogGrid = (row: CatalogRow) => {
    push({
      name: `All of ${row.name}`,
      kind: "overlay",
      payload: {
        render: () => (
          <EditorialGrid
            title={row.name}
            tag={catalogTag(row)}
            failure={row.failure}
            note={catalogNote(row)}
            onClose={pop}
            testId="search-catalog-grid"
          >
            {row.metas.map((meta) =>
              catalogCard(row, meta, `search-grid-card-${row.addon}-${meta.id}`),
            )}
          </EditorialGrid>
        ),
      },
    });
  };

  const answer = committed === null ? null : catalogAnswers.answers.get(committed);
  const catalogRows = answer?.rows ?? null;
  const catalogFailure = answer?.failure ?? null;
  const catalogLoading = committed !== null && catalogAnswers.reading.has(committed);

  return (
    <section
      className="rep-feed rep-feed--search"
      data-testid="search-screen"
      data-region="search-screen"
      data-kind="branch"
      data-label="Search"
      data-chrome={chrome}
      {...pageAttrs("search")}
    >
      <ProgrammeLine name="Search" testId="search-programme-line" />

      {snapshot === null ? <p className="rep-home-waiting">Waiting for the Host…</p> : null}

      {snapshot !== null ? (
        <>
          {/* The bar is a branch, not a row: Down from it enters the first
              result row's first card by the shell's rowEntry rule. */}
          <form
            className="rep-search-bar"
            role="search"
            aria-label="Search"
            data-region="search-bar"
            data-kind="branch"
            data-label="Search"
            onSubmit={submit}
          >
            <Field
              id="rep-search-query"
              label="Search for a Title"
              type="search"
              autoComplete="off"
              placeholder={
                keyed
                  ? "Search TMDB for a film or a series"
                  : "Search the Addons' searchable Catalogs"
              }
              value={draft}
              onChange={setDraft}
              trailing={
                <Button type="submit" variant="primary" disabled={!canSubmit}>
                  Search
                </Button>
              }
            />
          </form>

          <div className="rep-page-panel" ref={panel} style={style}>
            {keyed && committed !== null ? (
              <div className="rep-search-results" data-testid="search-results">
                {SEARCH_KINDS.map(({ kind, label }) => {
                  const key = searchFeedKey(committed, kind);
                  const feed = feeds.rows.get(key) ?? blankFeed();
                  const loading = feeds.reading.has(key);
                  return (
                    <EditorialRow
                      key={kind}
                      title={label}
                      tag={rowTagOf("TMDB", kind, feed.items.length)}
                      action={keyedAction(kind)}
                      failure={feed.failure}
                      note={rowNote(feed, loading, kind, committed)}
                      region={`search-row:${kind}`}
                      onOpenRow={
                        feed.items.length > 0
                          ? () => openKeyedGrid(kind, label)
                          : undefined
                      }
                      testId={`search-row-${kind}`}
                    >
                      {feed.items.map((meta) =>
                        keyedCard(
                          meta,
                          `search-card-${kind}-${meta.id}`,
                          couldPlay(kind),
                        ),
                      )}
                    </EditorialRow>
                  );
                })}
              </div>
            ) : null}

            {!keyed && committed !== null ? (
              <div className="rep-search-results" data-testid="search-catalogs">
                {catalogLoading ? (
                  <p
                    role="status"
                    className="rep-feed-note"
                    data-testid="search-catalogs-loading"
                  >
                    Searching every searchable Catalog…
                  </p>
                ) : null}

                {catalogFailure ? (
                  <>
                    <p
                      role="alert"
                      className="rep-feed-failure"
                      data-testid="search-catalogs-failure"
                    >
                      {explain(catalogFailure)}
                    </p>
                    <Button
                      variant="ghost"
                      onClick={() => session.searchCatalogs.retry(committed)}
                    >
                      Search again
                    </Button>
                  </>
                ) : null}

                {catalogRows?.map((row) => (
                  <EditorialRow
                    key={keyOf(row)}
                    title={row.name}
                    tag={catalogTag(row)}
                    failure={row.failure}
                    note={catalogNote(row)}
                    action={
                      row.failure ? (
                        <Button
                          variant="ghost"
                          onClick={() => session.searchCatalogs.retry(committed)}
                        >
                          Search again
                        </Button>
                      ) : null
                    }
                    region={`search-row:${keyOf(row)}`}
                    onOpenRow={row.metas.length > 0 ? () => openCatalogGrid(row) : undefined}
                    testId={`search-row-${keyOf(row)}`}
                  >
                    {row.metas.map((meta) =>
                      catalogCard(row, meta, `search-card-${row.addon}-${meta.id}`),
                    )}
                  </EditorialRow>
                ))}

                {!catalogLoading &&
                !catalogFailure &&
                catalogRows?.length === 0 ? (
                  <p className="rep-feed-note" data-testid="search-no-answer">
                    No Addon offers a Catalog that can be searched.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      {preview ? (
        <p className="rep-preview-note">
          Preview data: a query searches Cinemeta&rsquo;s Popular catalogues in this
          window. The Tauri window asks TMDB through the Host when a credential is
          held.
        </p>
      ) : null}
    </section>
  );
}
