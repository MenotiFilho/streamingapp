import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import { keyOf } from "../../browse";
import {
  blankFeed,
  discoverPlayable,
  feedWith,
  MOVIE,
  type DiscoverFeed,
} from "../../discover";
import {
  answeredCatalogs,
  answeredSearch,
  explain,
  type ActionError,
  type CatalogRow,
} from "../../host-client";
import { SERIES } from "../../title";
import { SEARCH_KINDS, searchAsk, type SearchKind } from "../search";
import { useShell } from "../context";
import { addonName } from "../home";
import { FOCUSABLE } from "../layout";
import { focusAndReveal } from "../reveal";
import { useTitleOpener } from "../TitleScreen";
import { usePreviewData } from "./context";
import { feedMore, feedState, rowsForKind } from "./editorial";
import { EditorialRow } from "./EditorialRow";
import { Button, ChoiceChip, PosterCard } from "./kit";
import { ProgrammeLine } from "./ProgrammeLine";
import { countLabel, yearOf } from "./program";
import "./repertory.css";

type KeyedRows = Record<SearchKind, DiscoverFeed>;

function blankKeyedRows(): KeyedRows {
  return { movie: blankFeed(), series: blankFeed() };
}

/** What one `search_catalogs` question has answered so far. */
type CatalogAnswer = {
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
 * Search as an editorial feed: one submit-only query bar drawn as a
 * display-serif line, the two single-select kind chips, and one row per answer.
 *
 * A query is asked both ways the Host offers, read from the Snapshot
 * (ADR-0010's amendment, ADR-0020): with a TMDB Credential it is asked once for
 * Movies and once for Series — both in flight, one shown at a time, so a chip
 * switch is instant — and each page keeps its cards and its own failure. With
 * no key it is `search_catalogs`, answered one row per searchable Catalog in
 * the Host's order, and a Catalog that failed stays in its own row (ADR-0010).
 * The bar submits, never asks per keystroke.
 *
 * The plain Vite preview has no Host and no TMDB network, so it always takes the
 * keyless arm even when the rehearsal Settings hold a key flag.
 */
export function RepertorySearchScreen() {
  const preview = usePreviewData();
  const { snapshot, ask, unplayable } = useShell();
  const { openTitle, openDiscoveredTitle } = useTitleOpener();
  const [draft, setDraft] = useState("");
  /** The kind the repertory feed shows; the query still asks both kinds. */
  const [shownKind, setShownKind] = useState<SearchKind>(MOVIE);
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

  const keyed = !preview && (snapshot?.protection.tmdbHeld ?? false);

  const reset = useCallback(() => {
    serial.current += 1;
    setCommitted(null);
    setRows(blankKeyedRows());
    setPaging([]);
    setCatalogAnswer(NO_CATALOG_ANSWER);
  }, []);

  // A credential added or cleared changes which arm a query takes. The rows of
  // the old arm are not answers to the new one, so they go, and the feed starts
  // on Movie again.
  useEffect(() => {
    reset();
    setShownKind(MOVIE);
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
    // The first card of the first result row, not the row's paging action that
    // sits above it in the head.
    const first =
      results.current?.querySelector<HTMLElement>(
        ".rep-kit-row-track [data-focusable]",
      ) ?? results.current?.querySelector<HTMLElement>(FOCUSABLE);
    if (!first) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    focusAndReveal(first);
  };

  const canSubmit = draft.trim().length > 0;
  // The keyless arm answers one row per Catalog; the repertory surface shows
  // the kind a person chose.
  const catalogRows =
    catalogAnswer.rows === null
      ? null
      : rowsForKind(catalogAnswer.rows, shownKind);
  const shownLabel =
    SEARCH_KINDS.find(({ kind }) => kind === shownKind)?.label ?? "Movies";
  const shownLower = shownLabel.toLowerCase();

  const rowNote = (feed: DiscoverFeed, loading: boolean, query: string) => {
    switch (feedState(feed, loading)) {
      case "reading":
        return `Looking for ${shownLower}…`;
      case "reading-more":
        return `Looking for more ${shownLower}…`;
      case "empty":
        return `No ${shownLower} matched \u201c${query}\u201d.`;
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

  const shownFeed = rows[shownKind];
  const shownLoading = paging.includes(shownKind);

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
          <form
            className="rep-search-bar"
            role="search"
            aria-label="Search"
            data-region="search-bar"
            data-kind="row"
            data-label="Search"
            onSubmit={submit}
          >
            <label className="shell-visually-hidden" htmlFor="rep-search-query">
              Search for a Title
            </label>
            <input
              id="rep-search-query"
              className="rep-search-input"
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
              className="rep-search-submit"
              type="submit"
              variant="primary"
              disabled={!canSubmit}
              onKeyDown={downToResults}
            >
              Search
            </Button>
          </form>

          <div
            className="rep-kind-filter"
            data-region="search-kinds"
            data-kind="row"
            data-label="Kind"
          >
            <ChoiceChip
              pressed={shownKind === MOVIE}
              data-testid="search-kind-movie"
              onClick={() => setShownKind(MOVIE)}
            >
              Movie
            </ChoiceChip>
            <ChoiceChip
              pressed={shownKind === SERIES}
              data-testid="search-kind-series"
              onClick={() => setShownKind(SERIES)}
            >
              Series
            </ChoiceChip>
          </div>

          {keyed && committed !== null ? (
            <div className="rep-search-results" data-testid="search-results" ref={results}>
              <EditorialRow
                title={shownLabel}
                tag={`TMDB / ${countLabel(shownKind, shownFeed.items.length)}`}
                action={
                  feedMore(shownFeed) ? (
                    <Button
                      variant="ghost"
                      disabled={shownLoading}
                      onClick={() => more(shownKind)}
                    >
                      More
                    </Button>
                  ) : null
                }
                failure={shownFeed.failure}
                note={rowNote(shownFeed, shownLoading, committed)}
                region={`search-row:${shownKind}`}
                testId={`search-row-${shownKind}`}
              >
                {shownFeed.items.map((meta) => (
                  <PosterCard
                    key={meta.id}
                    name={meta.name}
                    poster={meta.poster}
                    rating={meta.imdbRating?.trim() || null}
                    subtitle={yearOf(meta)}
                    unplayable={!discoverPlayable(snapshot.addons, shownKind) ||
                      unplayable.has(meta.id)}
                    testId={`search-card-${shownKind}-${meta.id}`}
                    onClick={() => void openDiscoveredTitle(meta)}
                  />
                ))}
              </EditorialRow>
            </div>
          ) : null}

          {!keyed && committed !== null ? (
            <div className="rep-search-results" data-testid="search-catalogs" ref={results}>
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

              {catalogRows?.map((row) => (
                <EditorialRow
                  key={keyOf(row)}
                  title={row.name}
                  tag={`${addonName(snapshot, row.addon) ?? row.addon} / ${countLabel(
                    row.type,
                    row.metas.length,
                  )}`}
                  failure={row.failure}
                  note={catalogNote(row)}
                  region={`search-row:${keyOf(row)}`}
                  testId={`search-row-${keyOf(row)}`}
                >
                  {row.metas.map((meta) => (
                    <PosterCard
                      key={meta.id}
                      name={meta.name}
                      poster={meta.poster}
                      rating={meta.imdbRating?.trim() || null}
                      subtitle={yearOf(meta)}
                      unplayable={unplayable.has(meta.id)}
                      testId={`search-card-${row.addon}-${meta.id}`}
                      onClick={() => void openTitle(row.addon, meta)}
                    />
                  ))}
                </EditorialRow>
              ))}

              {!catalogAnswer.loading &&
              !catalogAnswer.failure &&
              catalogAnswer.rows?.length === 0 ? (
                <p className="rep-feed-note" data-testid="search-no-answer">
                  No Addon offers a Catalog that can be searched.
                </p>
              ) : null}

              {!catalogAnswer.loading &&
              !catalogAnswer.failure &&
              catalogRows?.length === 0 &&
              (catalogAnswer.rows?.length ?? 0) > 0 ? (
                <p className="rep-feed-note" data-testid="search-kind-empty">
                  {`No ${
                    shownKind === MOVIE ? "Movie" : "Series"
                  } Catalog answered \u201c${committed}\u201d.`}
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
