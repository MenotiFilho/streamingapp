import { useEffect, useRef, useSyncExternalStore, type FormEvent } from "react";

import { keyOf } from "../core/browse";
import { discoverPlayable } from "../core/discover";
import { explain } from "../core/errors";
import { addonLabel } from "../core/home";
import { programIndex, rowTagOf } from "../core/homeProgramme";
import type { NewLevel } from "../core/navigation";
import {
  SEARCH_KINDS,
  searchAsk,
  searchFeedKey,
  type SearchKind,
} from "../core/search";
import { EMPTY_SEARCH_VIEW, type Session, type SessionState } from "../core/session";
import type { MetaPreview } from "../core/wire";
import { Button } from "../kit/Button";
import { Field } from "../kit/Field";
import { PosterCard } from "../kit/PosterCard";
import { RemoteRail } from "./RemoteRail";
import { MoreControl, PagingControl, RowNote } from "./RemoteRow";
import { gridLevel } from "./grid";
import { feedMore, feedPhase } from "./feed";
import { titleLevelOf, type RemotePayload } from "./levels";
import {
  CATALOGS_READING,
  NO_SEARCHABLE_CATALOGS,
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

/**
 * Search, in a hand (#207, ADR-0035 §1).
 *
 * The bar submits, never asks per keystroke, and an empty field is not a
 * question: it sends nothing. Which arm a query takes is the Host's fact, read
 * from the Snapshot — with a TMDB Credential both kinds are asked for page 1,
 * held separately and drawn as Movies then Series, each with its own failure
 * and paging; without one, a single `search_catalogs` ask answers one row per
 * searchable Catalog. There are no kind chips (ADR-0036 §1). A credential
 * gained or cleared is a new feed: the old arm's query is dropped rather than
 * answered by the new one.
 *
 * The field, the query and the rows live in the Session (#264): pushing a Title
 * or a grid unmounts this screen, and Back returns to the same words, rows and
 * pages without asking page 1 again. A keyed row's More opens that row as a
 * whole-row grid, which reads on by itself.
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

  const view = useSyncExternalStore(
    session.searchView.subscribe,
    session.searchView.get,
  );
  const { draft, query } = view;

  const setDraft = (next: string) => session.searchView.set({ draft: next, query });

  // A credential gained or cleared changes which arm a query takes. The words
  // and rows of the old arm are not answers to the new one, so they go. The
  // first Snapshot only settles which arm this is; it is not a change.
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

  // The rows live outside this screen: a mount joins what the Session already
  // holds, and only a query with no answer asks the Host again.
  useEffect(() => {
    if (query === null) {
      return;
    }
    // A credential change resets the view in the effect above; this render's
    // closure still holds the old query, and it must not ask the new arm.
    if (session.searchView.get().query !== query) {
      return;
    }
    if (keyed) {
      for (const { kind } of SEARCH_KINDS) {
        const key = searchFeedKey(query, kind);
        session.feeds.read(
          key,
          searchAsk({ query, kind, page: 1 }),
          (row) => searchAsk({ query, kind, page: row.page + 1 }),
        );
      }
    } else {
      session.searchCatalogs.search(query);
    }
  }, [keyed, query, session]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = queryOf(draft);
    if (next === null) {
      return;
    }
    session.searchView.set({ draft, query: next });
  };

  const openGrid = (at: SearchKind) => {
    if (query === null) {
      return;
    }
    const key = searchFeedKey(query, at);
    const feed = session.feeds.feed(key);
    if (feed.items.length === 0) {
      return;
    }
    push(
      gridLevel({
        title: kindLabel(at),
        index: programIndex(1),
        tag: rowTagOf("TMDB", at, feed.items.length),
        addon: null,
        source: {
          kind: "search",
          feedKind: at,
          query,
          feedKey: key,
        },
      }),
    );
  };

  const open = (addon: string | null, meta: MetaPreview) => {
    push(titleLevelOf(addon, meta));
  };

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

          <div className="remote-page-panel">
            {keyed && query !== null ? (
              <KeyedRows
                session={session}
                state={state}
                query={query}
                open={open}
                openGrid={openGrid}
              />
            ) : null}

            {!keyed && query !== null ? (
              <CatalogRows session={session} state={state} query={query} open={open} />
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}

/** The two keyed rows, read from the Session's feed store (#264). */
function KeyedRows({
  session,
  state,
  query,
  open,
  openGrid,
}: {
  session: Session;
  state: SessionState;
  query: string;
  open: (addon: string | null, meta: MetaPreview) => void;
  openGrid: (at: SearchKind) => void;
}) {
  const snapshot = state.snapshot;
  const feeds = useSyncExternalStore(session.feeds.subscribe, session.feeds.getSnapshot);

  return (
    <>
      {SEARCH_KINDS.map(({ kind, label }, index) => {
        const key = searchFeedKey(query, kind);
        const feed = feeds.rows.get(key);
        if (!feed) {
          return null;
        }
        const loading = feeds.reading.has(key);
        const phase = feedPhase(feed, loading);
        const couldPlay = snapshot ? discoverPlayable(snapshot.addons, kind) : true;
        return (
          <RemoteRail
            key={kind}
            index={programIndex(index + 1)}
            title={label}
            tag={rowTagOf("TMDB", kind, feed.items.length)}
            testId={`remote-search-row-${kind}`}
            note={
              <RowNote failure={feed.failure} quiet={searchNote(phase, kind, query)} />
            }
            action={
              <PagingControl
                failure={feed.failure}
                more={feedMore(feed)}
                loading={loading}
                onMore={() => session.feeds.more(key)}
              />
            }
            more={
              feed.items.length > 0 ? (
                <MoreControl label={label} onOpen={() => openGrid(kind)} />
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
      })}
    </>
  );
}

/** The keyless arm: one `search_catalogs` answer, kept by the Session (#264). */
function CatalogRows({
  session,
  state,
  query,
  open,
}: {
  session: Session;
  state: SessionState;
  query: string;
  open: (addon: string | null, meta: MetaPreview) => void;
}) {
  const snapshot = state.snapshot;
  const answer = useSyncExternalStore(
    session.searchCatalogs.subscribe,
    session.searchCatalogs.getSnapshot,
  );
  const held = answer.answers.get(query) ?? { rows: null, failure: null };
  const reading = answer.reading.has(query);

  return (
    <div className="remote-search-catalogs" data-testid="remote-search-catalogs">
      {reading ? (
        <p role="status" className="remote-quiet">
          {CATALOGS_READING}
        </p>
      ) : null}

      {held.failure ? (
        <>
          <p role="alert" className="remote-failure">
            {explain(held.failure)}
          </p>
          <Button variant="ghost" onClick={() => session.searchCatalogs.retry(query)}>
            Search again
          </Button>
        </>
      ) : null}

      {held.rows?.map((row, index) => (
        <RemoteRail
          key={keyOf(row)}
          index={programIndex(index + 1)}
          title={row.name}
          tag={rowTagOf(addonLabel(snapshot, row.addon), row.type, row.metas.length)}
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

      {!reading && !held.failure && held.rows?.length === 0 ? (
        <p role="status" className="remote-quiet">
          {NO_SEARCHABLE_CATALOGS}
        </p>
      ) : null}
    </div>
  );
}
