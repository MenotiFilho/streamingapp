import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { answeredCatalogs, answeredSearch } from "../core/answers";
import type { ActionOutcome } from "../core/answers";
import { keyOf } from "../core/browse";
import { discoverPlayable, type DiscoverFeed } from "../core/discover";
import { explain, type ActionError } from "../core/errors";
import { addonLabel } from "../core/home";
import { programIndex, rowTagOf } from "../core/homeProgramme";
import type { NewLevel } from "../core/navigation";
import { SEARCH_KINDS, searchAsk, type SearchKind } from "../core/search";
import type { Session, SessionState } from "../core/session";
import type { CatalogRow, MetaPreview } from "../core/wire";
import { Button } from "../kit/Button";
import { Field } from "../kit/Field";
import { PosterCard } from "../kit/PosterCard";
import { RemoteRail } from "./RemoteRail";
import { MoreControl, RowNote } from "./RemoteRow";
import { gridLevel } from "./grid";
import { feedAfter, feedPhase } from "./feed";
import { titleLevelOf, type RemotePayload } from "./levels";
import {
  CATALOGS_READING,
  NO_SEARCHABLE_CATALOGS,
  blankFeeds,
  kindLabel,
  queryOf,
  rowNote,
  searchNote,
  searchPlaceholder,
} from "./searchScreen";

export type SearchProps = {
  /** The Session the asks go through, and the Titles it learned are unplayable. */
  session: Session;
  /** What the Host last published: the credential, the Addons, the marks. */
  state: SessionState;
  /** A press on a card pushes the Title level B6 will draw. */
  push: (level: NewLevel<RemotePayload>) => string;
};

/** The one field the bar draws. */
const SEARCH_LABEL = "Search for a Title";

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
 * Search, in a hand (#207, ADR-0035 §1).
 *
 * The bar submits, never asks per keystroke, and an empty field is not a
 * question: it sends nothing. Which arm a query takes is the Host's fact, read
 * from the Snapshot — with a TMDB Credential both kinds are asked for page 1,
 * held separately and drawn as Movies then Series, each with its own failure
 * and paging; without one, a single `search_catalogs` ask answers one row per
 * searchable Catalog. There are no kind chips (ADR-0036 §1). A credential
 * gained or cleared is a new feed: the old arm's rows are dropped rather than
 * mixed with the new one's.
 *
 * A press opens a Title and nothing more: a keyed hit is a Discovered Title
 * (TMDB named it, so it carries no Addon) and a keyless one carries the Addon
 * whose Catalog answered it. B6 owns the request itself.
 */
export function Search({ session, state, push }: SearchProps) {
  const snapshot = state.snapshot;
  // Which arm a query takes is the Host's fact. Before the first Snapshot it is
  // not a guess to make: the bar waits rather than asking the wrong Host.
  const credential = snapshot ? snapshot.protection.tmdbHeld : null;
  const keyed = credential ?? false;

  const [draft, setDraft] = useState("");
  /** The query whose answers are on screen, or null before the first submit. */
  const [committed, setCommitted] = useState<string | null>(null);
  const [feeds, setFeeds] = useState<Record<SearchKind, DiscoverFeed>>(blankFeeds);
  const [paging, setPaging] = useState<ReadonlySet<SearchKind>>(() => new Set());
  const [catalogs, setCatalogs] = useState<CatalogAnswer>(CATALOG_NOT_ASKED);
  /**
   * Which query owns the screen. A submit moves it on, so an answer to a query
   * a person has left — or to a paged row of that query — is dropped rather
   * than landing in the rows of the new one.
   */
  const serial = useRef(0);

  const reset = useCallback(() => {
    serial.current += 1;
    setCommitted(null);
    setFeeds(blankFeeds());
    setPaging(new Set());
    setCatalogs(CATALOG_NOT_ASKED);
  }, []);

  // A credential added or cleared changes which arm a query takes. The rows of
  // the old arm are not answers to the new one, so they go.
  useEffect(() => {
    reset();
  }, [credential, reset]);

  /** Ask TMDB for one row's page and fold its answer into that row alone. */
  const loadRow = useCallback(
    async (query: string, at: SearchKind, page: number) => {
      const token = serial.current;
      setPaging((held) => new Set(held).add(at));
      const outcome = await session.ask(searchAsk({ query, kind: at, page }));
      if (token !== serial.current) {
        return;
      }
      setPaging((held) => {
        const next = new Set(held);
        next.delete(at);
        return next;
      });
      setFeeds((held) => ({ ...held, [at]: settled(held[at], outcome) }));
    },
    [session],
  );

  /** Ask every searchable Catalog in one Action, and draw the rows it answers. */
  const loadCatalogs = useCallback(
    async (query: string) => {
      const token = serial.current;
      setCatalogs({ rows: null, loading: true, failure: null });
      const outcome = await session.ask({ type: "search_catalogs", query });
      if (token !== serial.current) {
        return;
      }
      setCatalogs({
        rows: outcome.error ? null : answeredCatalogs(outcome.response),
        loading: false,
        failure: outcome.error,
      });
    },
    [session],
  );

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = queryOf(draft);
    if (query === null) {
      return;
    }

    reset();
    setCommitted(query);
    if (keyed) {
      // Both kinds are asked for one page each: not asking one of them would
      // leave a row simply absent, and each row is held and paged alone
      // (ADR-0010's amendment, ADR-0036 §1).
      for (const { kind } of SEARCH_KINDS) {
        void loadRow(query, kind, 1);
      }
    } else {
      void loadCatalogs(query);
    }
  };

  /** Open one kind's feed as a whole-row grid (#253). */
  const openGrid = (at: SearchKind) => {
    if (!committed || feeds[at].items.length === 0) {
      return;
    }
    push(
      gridLevel({
        title: kindLabel(at),
        index: programIndex(1),
        tag: rowTagOf("TMDB", at, feeds[at].items.length),
        addon: null,
        source: {
          kind: "search",
          feedKind: at,
          query: committed,
          feed: feeds[at],
        },
      }),
    );
  };

  const open = (addon: string | null, meta: MetaPreview) => {
    push(titleLevelOf(addon, meta));
  };

  const query = committed ?? "";

  return (
    <section className="remote-search" data-testid="remote-search">
      <header className="remote-screen-head">
        <h1 className="remote-screen-title">Search</h1>
        <span className="remote-screen-rule" aria-hidden="true" />
      </header>

      {credential === null ? null : (
        <>
          <form className="remote-search-form" role="search" onSubmit={submit}>
            <Field
              id="remote-search-query"
              label={SEARCH_LABEL}
              value={draft}
              onChange={setDraft}
              placeholder={searchPlaceholder(keyed)}
              autoComplete="off"
              trailing={
                <Button
                  type="submit"
                  variant="primary"
                  disabled={queryOf(draft) === null}
                >
                  Search
                </Button>
              }
            />
          </form>

          {keyed && committed !== null ? (
            SEARCH_KINDS.map(({ kind, label }, index) => {
              const feed = feeds[kind];
              const phase = feedPhase(feed, paging.has(kind));
              const couldPlay = snapshot
                ? discoverPlayable(snapshot.addons, kind)
                : true;
              return (
                <RemoteRail
                  key={kind}
                  index={programIndex(index + 1)}
                  title={label}
                  tag={rowTagOf("TMDB", kind, feed.items.length)}
                  testId={`remote-search-row-${kind}`}
                  note={
                    <RowNote
                      failure={feed.failure}
                      quiet={searchNote(phase, kind, query)}
                    />
                  }
                  action={
                    feed.items.length > 0 ? (
                      <MoreControl
                        label={label}
                        onOpen={() => openGrid(kind)}
                      />
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
                      testId={`search-card-${kind}-${meta.id}`}
                      onClick={() => open(null, meta)}
                    />
                  ))}
                </RemoteRail>
              );
            })
          ) : null}

          {!keyed && committed !== null ? (
            <div
              className="remote-search-catalogs"
              data-testid="remote-search-catalogs"
            >
              {catalogs.loading ? (
                <p role="status" className="remote-quiet">
                  {CATALOGS_READING}
                </p>
              ) : null}

              {catalogs.failure ? (
                <>
                  <p role="alert" className="remote-failure">
                    {explain(catalogs.failure)}
                  </p>
                  <Button variant="ghost" onClick={() => void loadCatalogs(query)}>
                    Search again
                  </Button>
                </>
              ) : null}

              {catalogs.rows?.map((row, index) => (
                <RemoteRail
                  key={keyOf(row)}
                  index={programIndex(index + 1)}
                  title={row.name}
                  tag={rowTagOf(
                    addonLabel(snapshot, row.addon),
                    row.type,
                    row.metas.length,
                  )}
                  testId={`remote-search-catalog-${keyOf(row)}`}
                  note={<RowNote failure={row.failure} quiet={rowNote(row)} />}
                >
                  {row.metas.map((meta) => (
                    <PosterCard
                      key={meta.id}
                      name={meta.name}
                      poster={meta.poster}
                      rating={meta.imdbRating?.trim() || null}
                      subtitle={meta.releaseInfo}
                      unplayable={state.unplayable.has(meta.id)}
                      testId={`search-card-${row.addon}-${meta.id}`}
                      onClick={() => open(row.addon, meta)}
                    />
                  ))}
                </RemoteRail>
              ))}

              {!catalogs.loading &&
              !catalogs.failure &&
              catalogs.rows?.length === 0 ? (
                <p role="status" className="remote-quiet">
                  {NO_SEARCHABLE_CATALOGS}
                </p>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

/** One search answer folded into the kind's own row. */
function settled(feed: DiscoverFeed, outcome: ActionOutcome): DiscoverFeed {
  if (outcome.error) {
    return { ...feed, failure: outcome.error };
  }
  return feedAfter(feed, answeredSearch(outcome.response));
}
