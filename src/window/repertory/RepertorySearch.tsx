import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { keyOf } from "../../core/browse";
import {
  blankFeed,
  discoverPlayable,
  feedWith,
  type DiscoverFeed,
} from "../../core/discover";
import type { CatalogRow, MetaPreview } from "../../core/wire";
import { explain, type ActionError } from "../../core/errors";
import { answeredCatalogs, answeredSearch } from "../../core/answers";
import { SEARCH_KINDS, searchAsk, type SearchKind } from "../../core/search";
import { useShell } from "../context";
import { addonLabel } from "../../core/home";
import { useTitleOpener } from "../TitleScreen";
import { usePreviewData } from "./context";
import { feedMore, feedState } from "./editorial";
import { EditorialGrid } from "./EditorialGrid";
import { EditorialRow, FeedPagingAction } from "./EditorialRow";
import { Button } from "../../kit/Button";
import { Field } from "../../kit/Field";
import { PosterCard } from "../../kit/PosterCard";
import { ProgrammeLine } from "./ProgrammeLine";
import { rowTagOf, yearOf } from "./program";
import "./repertory.css";

type KeyedFeeds = Record<SearchKind, DiscoverFeed>;

function blankKeyedFeeds(): KeyedFeeds {
  return { movie: blankFeed(), series: blankFeed() };
}

/** What one `search_catalogs` question has answered so far. */
type CatalogAnswer = {
  rows: CatalogRow[] | null;
  loading: boolean;
  failure: ActionError | null;
};

const CATALOG_NOT_ASKED: CatalogAnswer = {
  rows: null,
  loading: false,
  failure: null,
};

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
 * The plain Vite preview has no Host and no TMDB network, so it always takes the
 * keyless arm even when the rehearsal Settings hold a key flag.
 */
export function RepertorySearchScreen() {
  const preview = usePreviewData();
  const { snapshot, ask, push, pop, unplayable } = useShell();
  const { openTitle, openDiscoveredTitle } = useTitleOpener();
  const [draft, setDraft] = useState("");
  /** The query whose answers are on screen, or null before the first submit. */
  const [committed, setCommitted] = useState<string | null>(null);
  const [rows, setRows] = useState<KeyedFeeds>(blankKeyedFeeds);
  const [paging, setPaging] = useState<SearchKind[]>([]);
  const [catalogAnswer, setCatalogAnswer] = useState<CatalogAnswer>(CATALOG_NOT_ASKED);
  /**
   * Which query owns the screen. A submit moves it on, so an answer to a query
   * a person has left — or to a paged row of that query — is dropped rather
   * than landing in the rows of the new one.
   */
  const serial = useRef(0);

  const keyed = !preview && (snapshot?.protection.tmdbHeld ?? false);

  const reset = useCallback(() => {
    serial.current += 1;
    setCommitted(null);
    setRows(blankKeyedFeeds());
    setPaging([]);
    setCatalogAnswer(CATALOG_NOT_ASKED);
  }, []);

  // A credential added or cleared changes which arm a query takes. The rows of
  // the old arm are not answers to the new one, so they go.
  useEffect(() => {
    reset();
  }, [keyed, reset]);

  /** Ask TMDB for one row's page and fold its answer into that row alone. */
  const loadRow = useCallback(
    async (query: string, kind: SearchKind, page: number) => {
      const token = serial.current;
      setPaging((held) => (held.includes(kind) ? held : [...held, kind]));
      const { response, error } = await ask(searchAsk({ query, kind, page }));
      if (token !== serial.current) {
        return;
      }
      setPaging((held) => held.filter((heldKind) => heldKind !== kind));

      const answer = error ? null : answeredSearch(response);
      setRows((held) => ({
        ...held,
        [kind]: error
          ? { ...held[kind], failure: error }
          : answer
            ? feedWith(held[kind], answer)
            : { ...held[kind], done: true },
      }));
    },
    [ask],
  );

  /** Ask every searchable Catalog in one Action, and draw the rows it answers. */
  const loadCatalogs = useCallback(
    async (query: string) => {
      const token = serial.current;
      setCatalogAnswer({ rows: null, loading: true, failure: null });
      const { response, error } = await ask({ type: "search_catalogs", query });
      if (token !== serial.current) {
        return;
      }
      setCatalogAnswer({
        rows: error ? null : answeredCatalogs(response),
        loading: false,
        failure: error,
      });
    },
    [ask],
  );

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = draft.trim();
    if (!query) {
      return;
    }

    reset();
    setCommitted(query);
    if (keyed) {
      // Both kinds are asked for one page each: there is no kind toggle, and
      // not asking one of them would leave a row that is simply absent.
      for (const { kind } of SEARCH_KINDS) {
        void loadRow(query, kind, 1);
      }
    } else {
      void loadCatalogs(query);
    }
  };

  /** Page one keyed row on from where it has read to. */
  const more = (kind: SearchKind) => {
    if (!committed || paging.includes(kind)) {
      return;
    }
    void loadRow(committed, kind, rows[kind].page + 1);
  };

  const canSubmit = draft.trim().length > 0;

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
    const feed = rows[kind];
    push({
      name: `All of ${label}`,
      kind: "overlay",
      payload: {
        render: () => (
          <EditorialGrid
            title={label}
            tag={rowTagOf("TMDB", kind, feed.items.length)}
            failure={feed.failure}
            note={rowNote(feed, paging.includes(kind), kind, committed ?? "")}
            onClose={pop}
            testId="search-grid"
          >
            {feed.items.map((meta) =>
              keyedCard(
                meta,
                `search-grid-card-${kind}-${meta.id}`,
                couldPlay(kind),
              ),
            )}
          </EditorialGrid>
        ),
      },
    });
  };

  const keyedAction = (kind: SearchKind) => {
    const feed = rows[kind];
    return (
      <FeedPagingAction
        failure={feed.failure}
        more={feedMore(feed)}
        loading={paging.includes(kind)}
        onMore={() => more(kind)}
      />
    );
  };

  const catalogCard = (row: CatalogRow, meta: MetaPreview, testId: string) => (
    <PosterCard
      key={meta.id}
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

  return (
    <section
      className="rep-feed rep-feed--search"
      data-testid="search-screen"
      data-region="search-screen"
      data-kind="branch"
      data-label="Search"
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

          {keyed && committed !== null ? (
            <div className="rep-search-results" data-testid="search-results">
              {SEARCH_KINDS.map(({ kind, label }) => {
                const feed = rows[kind];
                return (
                  <EditorialRow
                    key={kind}
                    title={label}
                    tag={rowTagOf("TMDB", kind, feed.items.length)}
                    action={keyedAction(kind)}
                    failure={feed.failure}
                    note={rowNote(feed, paging.includes(kind), kind, committed)}
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
              {catalogAnswer.loading ? (
                <p
                  role="status"
                  className="rep-feed-note"
                  data-testid="search-catalogs-loading"
                >
                  Searching every searchable Catalog…
                </p>
              ) : null}

              {catalogAnswer.failure ? (
                <p
                  role="alert"
                  className="rep-feed-failure"
                  data-testid="search-catalogs-failure"
                >
                  {explain(catalogAnswer.failure)}
                </p>
              ) : null}

              {catalogAnswer.rows?.map((row) => (
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
                        onClick={() => committed && void loadCatalogs(committed)}
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

              {!catalogAnswer.loading &&
              !catalogAnswer.failure &&
              catalogAnswer.rows?.length === 0 ? (
                <p className="rep-feed-note" data-testid="search-no-answer">
                  No Addon offers a Catalog that can be searched.
                </p>
              ) : null}

            </div>
          ) : null}
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
