import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { keyOf } from "../browse";
import { blankFeed, discoverPlayable, feedWith, type DiscoverFeed } from "../discover";
import {
  answeredCatalogs,
  answeredSearch,
  explain,
  type ActionError,
  type CatalogRow,
  type MetaPreview,
} from "../host-client";
import { useShell } from "./context";
import { addonName } from "./home";
import { Button, PosterCard } from "./kit";
import { FOCUSABLE } from "./layout";
import { SEARCH_KINDS, searchAsk, type SearchKind } from "./search";
import { useTitleOpener } from "./TitleScreen";
import "./search.css";

/** One row per kind, in the order the keyed arm draws them. */
type KeyedRows = Record<SearchKind, DiscoverFeed>;

function blankKeyedRows(): KeyedRows {
  return { movie: blankFeed(), series: blankFeed() };
}

/** What one `search_catalogs` question has answered so far. */
type CatalogAnswer = {
  /** The rows the Host sent, in configured order, or null before an answer. */
  rows: CatalogRow[] | null;
  loading: boolean;
  failure: ActionError | null;
};

const NO_CATALOG_ANSWER: CatalogAnswer = {
  rows: null,
  loading: false,
  failure: null,
};

/**
 * Search: one submit-only query bar, and the answer drawn one row per answering
 * Catalog, or one row per kind when TMDB answers.
 *
 * Which arm answers is the Host's fact, read from
 * `Snapshot.protection.tmdbHeld` (ADR-0010's amendment, ADR-0020):
 *
 * - With a TMDB Credential held, a query is TMDB's. It is asked once for
 *   `movie` and once for `series` — both rows always show, there is no kind
 *   toggle — and each row pages on its own, holding the pages this client has
 *   already read (ADR-0005). A failed page, `429` included, is drawn inside its
 *   row. A hit is a Discovered Title and opens with `open_discovered_title`.
 * - With no credential, `SearchCatalogs` asks every configured Addon's
 *   Catalogs that declare `search`, in the order the Addons are configured; the
 *   answer is one row per answering Catalog, a failure staying in its own row,
 *   and a hit opens through its Addon with `open_title` (ADR-0010).
 *
 * The bar is submit-only: this screen sends nothing on a keystroke, because a
 * fan-out per character would spend a rate limit nothing promises capacity for.
 */
export function SearchScreen() {
  const { snapshot, ask, unplayable } = useShell();
  const { openTitle, openDiscoveredTitle } = useTitleOpener();

  const [draft, setDraft] = useState("");
  /** The query whose answers are on screen, or null before the first submit. */
  const [committed, setCommitted] = useState<string | null>(null);
  const [rows, setRows] = useState<KeyedRows>(blankKeyedRows);
  const [paging, setPaging] = useState<SearchKind[]>([]);
  const [catalogAnswer, setCatalogAnswer] = useState<CatalogAnswer>(NO_CATALOG_ANSWER);
  /**
   * Which query owns the screen. A submit moves it on, so an answer to a query
   * a person has left — or to a paged row of that query — is dropped rather
   * than landing in the rows of the new one.
   */
  const serial = useRef(0);
  /** The results container, so Down from the submit control can enter its head. */
  const results = useRef<HTMLDivElement | null>(null);

  const keyed = snapshot?.protection.tmdbHeld ?? false;

  /** Put the screen back to "no query has been asked", without touching the box. */
  const reset = useCallback(() => {
    serial.current += 1;
    setCommitted(null);
    setRows(blankKeyedRows());
    setPaging([]);
    setCatalogAnswer(NO_CATALOG_ANSWER);
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

  /**
   * Down from the submit control enters the first results row's head. The text
   * field gets that by geometry — it is wider than everything a row holds — but
   * the control beside it is not, so the bar's other half says it here rather
   * than landing on whichever card happens to sit under the button.
   */
  const downToResults = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowDown") {
      return;
    }
    const first = results.current?.querySelector<HTMLElement>(FOCUSABLE);
    if (!first) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    first.focus({ preventScroll: true });
  };

  const canSubmit = draft.trim().length > 0;

  return (
    <section
      className="search-screen"
      data-testid="search-screen"
      data-region="search-screen"
      data-kind="branch"
      data-label="Search"
    >
      <h1 className="shell-screen-title">Search</h1>

      {snapshot === null ? <p className="shell-note">Waiting for the Host…</p> : null}

      {snapshot !== null ? (
        <>
          <p className="shell-lede" data-testid="search-lede">
            {keyed
              ? "TMDB searches its Movies and Series together: both rows are asked, and each page is read fresh."
              : "Every Addon's Catalog that offers a search answers, in the order the Addons are configured."}
          </p>

          <form
            className="search-bar"
            role="search"
            aria-label="Search"
            data-region="search-bar"
            data-kind="row"
            data-label="Search"
            onSubmit={submit}
          >
            <label className="shell-visually-hidden" htmlFor="search-query">
              Search for a Title
            </label>
            <input
              id="search-query"
              className="search-input"
              type="search"
              autoComplete="off"
              placeholder={
                keyed
                  ? "Search TMDB for a film or a series"
                  : "Search the Addons' searchable Catalogs"
              }
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              data-focusable
            />
            <Button
              className="search-submit"
              type="submit"
              variant="primary"
              disabled={!canSubmit}
              onKeyDown={downToResults}
            >
              Search
            </Button>
          </form>

          {keyed && committed !== null ? (
            <div className="search-results" data-testid="search-results" ref={results}>
              {SEARCH_KINDS.map(({ kind, label }) => (
                <TmdbRow
                  key={kind}
                  kind={kind}
                  label={label}
                  query={committed}
                  feed={rows[kind]}
                  loading={paging.includes(kind)}
                  couldPlay={discoverPlayable(snapshot.addons, kind)}
                  unplayable={unplayable}
                  onMore={() => more(kind)}
                  onOpen={(meta) => void openDiscoveredTitle(meta)}
                />
              ))}
            </div>
          ) : null}

          {!keyed && committed !== null ? (
            <div className="search-results" data-testid="search-catalogs" ref={results}>
              {catalogAnswer.loading ? (
                <p
                  role="status"
                  className="search-row-note"
                  data-testid="search-catalogs-loading"
                >
                  Searching every searchable Catalog…
                </p>
              ) : null}

              {catalogAnswer.failure ? (
                <p
                  role="alert"
                  className="search-row-failure"
                  data-testid="search-catalogs-failure"
                >
                  {explain(catalogAnswer.failure)}
                </p>
              ) : null}

              {catalogAnswer.rows?.map((row) => (
                <AddonRow
                  key={keyOf(row)}
                  row={row}
                  addon={addonName(snapshot, row.addon) ?? row.addon}
                  onOpen={(meta) => void openTitle(row.addon, meta)}
                />
              ))}

              {!catalogAnswer.loading &&
              !catalogAnswer.failure &&
              catalogAnswer.rows?.length === 0 ? (
                <p className="search-row-note" data-testid="search-no-answer">
                  No Addon offers a Catalog that can be searched.
                </p>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

type ResultRowProps = {
  /** The row's identity in its own region and test ids: a kind, or a Catalog key. */
  name: string;
  label: string;
  tag: string;
  failure: ActionError | null;
  failureTestId: string;
  /** A waiting or empty note; it is drawn under the grid, never in place of it. */
  footnote?: ReactNode;
  children: ReactNode;
};

/**
 * One row's frame: heading, its Catalog or TMDB tag, the cards in a wrapping
 * grid, the failure that replaced a page where one did, and a footnote.
 */
function ResultRow({
  name,
  label,
  tag,
  failure,
  failureTestId,
  footnote,
  children,
}: ResultRowProps) {
  return (
    <section
      className="search-row"
      data-testid={`search-row-${name}`}
      data-region={`search-row:${name}`}
      data-kind="row"
      data-label={label}
    >
      <header className="search-row-header">
        <h2 className="search-row-title">{label}</h2>
        <span className="search-row-tag kit-tabular">{tag}</span>
      </header>

      {failure ? (
        <p role="alert" className="search-row-failure" data-testid={failureTestId}>
          {explain(failure)}
        </p>
      ) : null}

      <div className="search-grid">{children}</div>
      {footnote}
    </section>
  );
}

type TmdbRowProps = {
  kind: SearchKind;
  label: string;
  query: string;
  feed: DiscoverFeed;
  loading: boolean;
  couldPlay: boolean;
  unplayable: ReadonlySet<string>;
  onMore: () => void;
  onOpen: (meta: MetaPreview) => void;
};

/**
 * One kind's row: TMDB's hits, its own `More` while there is a page to ask for,
 * and the failure that replaced a page where one did. A failed page keeps the
 * cards already read and the place it failed at, so `More` asks that page again
 * (ADR-0020).
 *
 * `More` survives a page that answered items but none this Host could read:
 * that page still advanced `page`, and the next one follows it.
 */
function TmdbRow({
  kind,
  label,
  query,
  feed,
  loading,
  couldPlay,
  unplayable,
  onMore,
  onOpen,
}: TmdbRowProps) {
  const moreAvailable =
    !loading && !feed.done && (feed.page > 0 || feed.failure !== null);

  const note = loading ? (
    <p role="status" className="search-row-note" data-testid={`search-loading-${kind}`}>
      {feed.items.length === 0
        ? `Looking for ${label.toLowerCase()}…`
        : `Looking for more ${label.toLowerCase()}…`}
    </p>
  ) : !feed.failure && feed.done && feed.items.length === 0 ? (
    <p className="search-row-note" data-testid={`search-empty-${kind}`}>
      {`No ${label.toLowerCase()} matched “${query}”.`}
    </p>
  ) : null;

  return (
    <ResultRow
      name={kind}
      label={label}
      tag="TMDB"
      failure={feed.failure}
      failureTestId={`search-failure-${kind}`}
      footnote={note}
    >
      {feed.items.map((meta) => (
        <PosterCard
          key={meta.id}
          name={meta.name}
          poster={meta.poster}
          subtitle={meta.releaseInfo}
          description={meta.description}
          unplayable={!couldPlay || unplayable.has(meta.id)}
          testId={`search-card-${kind}-${meta.id}`}
          onClick={() => onOpen(meta)}
        />
      ))}

      {moreAvailable ? (
        <div className="search-more">
          <Button variant="ghost" onClick={onMore}>
            More
          </Button>
        </div>
      ) : null}
    </ResultRow>
  );
}

type AddonRowProps = {
  row: CatalogRow;
  addon: string;
  onOpen: (meta: MetaPreview) => void;
};

/**
 * One Catalog's answer on the keyless arm: its own heading and Addon tag, its
 * hits, and the reason it did not answer where it did not. A failure here is
 * one row's, never the search's (ADR-0010).
 */
function AddonRow({ row, addon, onOpen }: AddonRowProps) {
  const key = keyOf(row);

  return (
    <ResultRow
      name={key}
      label={row.name}
      tag={addon}
      failure={row.failure}
      failureTestId={`search-catalog-failure-${key}`}
      footnote={
        row.failure ? null : row.sent === 0 ? (
          <p className="search-row-note" data-testid={`search-catalog-empty-${key}`}>
            This Catalog answered with no match.
          </p>
        ) : row.metas.length === 0 ? (
          <p
            className="search-row-note"
            data-testid={`search-catalog-unreadable-${key}`}
          >
            This Catalog sent items the Host could not read.
          </p>
        ) : null
      }
    >
      {row.metas.map((meta) => (
        <PosterCard
          key={meta.id}
          name={meta.name}
          poster={meta.poster}
          subtitle={meta.releaseInfo}
          description={meta.description}
          testId={`search-card-${row.addon}-${meta.id}`}
          onClick={() => onOpen(meta)}
        />
      ))}
    </ResultRow>
  );
}
