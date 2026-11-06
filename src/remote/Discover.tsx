import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { answeredCatalogs, answeredDiscover } from "../core/answers";
import type { ActionOutcome } from "../core/answers";
import { blankRow, catalogKey, keyOf, rowWith, type Row } from "../core/browse";
import {
  blankFeed,
  DISCOVER_GENRES,
  discoverAsk,
  discoverPlayable,
  genreFilterFor,
  type DiscoverFeed,
  type DiscoverGenreChoice,
  type DiscoverKind,
} from "../core/discover";
import { programIndex, rowTag } from "../core/homeProgramme";
import type { NewLevel } from "../core/navigation";
import type { Session, SessionState } from "../core/session";
import type { Action, MetaPreview } from "../core/wire";
import { ChoiceChip } from "../kit/Chip";
import { PosterCard } from "../kit/PosterCard";
import { RemoteRail } from "./RemoteRail";
import { MoreControl, PagingControl, RowNote } from "./RemoteRow";
import {
  DISCOVER_ROWS,
  NO_CREDENTIAL_NOTE,
  catalogAsk,
  catalogMore,
  catalogNote,
  catalogPageAsk,
  catalogsOf,
  discoverNoCounterpart,
  discoverNote,
  discoverTag,
  feedTitle,
  noCatalogState,
} from "./discoverScreen";
import { feedAfter, feedMore, feedPhase, pageToAsk } from "./feed";
import { gridLevel } from "./grid";
import { titleLevelOf, type RemotePayload } from "./levels";

export type DiscoverProps = {
  /** The Session the asks go through, and the Titles it learned are unplayable. */
  session: Session;
  /** What the Host last published: the credential, the Addons, the marks. */
  state: SessionState;
  /** A press on a card pushes the Title level B6 will draw. */
  push: (level: NewLevel<RemotePayload>) => string;
};

/**
 * Discover, in a hand (#207, ADR-0036 §1).
 *
 * Two arms, and which one is drawn is the Host's fact: with a TMDB Credential
 * the screen shows one genre row — the union of TMDB's film and series lists —
 * then two rows, Movies and Series, each asked and paged on its own. Without a
 * credential it draws the Addons' own Catalog rows through `browse_catalog` —
 * the only rows a Host with no credential can answer. A credential gained or
 * cleared is a new pair of rows: the arm is a different question, so nothing of
 * the old one stays.
 *
 * A press opens a Title and nothing more: a Discovered Title carries no Addon
 * (TMDB named it before any Addon did), and B6 owns the request itself.
 */
export function Discover({ session, state, push }: DiscoverProps) {
  const snapshot = state.snapshot;
  // Which arm a person gets is the Host's fact. Before the first Snapshot it is
  // not a guess to make: the screen waits rather than asking the wrong Host.
  const credential = snapshot ? snapshot.protection.tmdbHeld : null;
  const [genre, setGenre] = useState<DiscoverGenreChoice | null>(null);
  const [arm, setArm] = useState(credential);

  // A credential gained or cleared is a new pair of rows: the filters of the
  // last arm are not filters of this one. It is done in the render that learns
  // the fact, so the new arm mounts on every genre rather than the old one's.
  if (arm !== credential) {
    setArm(credential);
    setGenre(null);
  }

  const open = (addon: string | null, meta: MetaPreview) => {
    push(titleLevelOf(addon, meta));
  };

  return (
    <section className="remote-discover" data-testid="remote-discover">
      <header className="remote-screen-head">
        <h1 className="remote-screen-title">Discover</h1>
        <span className="remote-screen-rule" aria-hidden="true" />
      </header>

      {credential === null ? null : credential ? (
        <KeyedDiscover
          session={session}
          state={state}
          genre={genre}
          chooseGenre={setGenre}
          open={open}
          push={push}
        />
      ) : (
        <CatalogDiscover
          session={session}
          state={state}
          open={open}
          push={push}
        />
      )}
    </section>
  );
}

type Feeds = Record<DiscoverKind, DiscoverFeed>;

function blankFeeds(): Feeds {
  return { movie: blankFeed(), series: blankFeed() };
}

/**
 * Discover over TMDB: one genre row, then Movies and Series, each a feed asked
 * page by page. A genre is a new pair of feeds and asks page 1 of each kind it
 * has a counterpart in; a kind with no counterpart keeps its row, drawn empty
 * with a line saying why. Each row's quiet head action asks the page after what
 * was read, or the page that failed, and the cards already read keep their
 * place either way (`feedWith`). The row's More card opens those cards as a
 * static whole-row grid.
 */
function KeyedDiscover({
  session,
  state,
  genre,
  chooseGenre,
  open,
  push,
}: {
  session: Session;
  state: SessionState;
  genre: DiscoverGenreChoice | null;
  chooseGenre: (genre: DiscoverGenreChoice | null) => void;
  open: (addon: string | null, meta: MetaPreview) => void;
  push: (level: NewLevel<RemotePayload>) => string;
}) {
  const snapshot = state.snapshot;
  const [feeds, setFeeds] = useState<Feeds>(blankFeeds);
  const [reading, setReading] = useState<DiscoverKind[]>([]);
  // Which genre owns both rows: an answer for a genre a person has left must
  // not land in the rows they are looking at.
  const serial = useRef(0);

  const read = useCallback(
    async (kind: DiscoverKind, page: number) => {
      const filter =
        genre === null ? { kind: "all" as const } : genreFilterFor(genre, kind);
      if (filter.kind === "none") {
        return;
      }
      const token = serial.current;
      setReading((held) => (held.includes(kind) ? held : [...held, kind]));
      const outcome = await session.ask(
        discoverAsk({
          kind,
          page,
          genre: filter.kind === "id" ? filter.id : null,
        }),
      );
      if (token !== serial.current) {
        return;
      }
      setReading((held) => held.filter((heldKind) => heldKind !== kind));
      if (outcome.error) {
        setFeeds((held) => ({
          ...held,
          [kind]: { ...held[kind], failure: outcome.error },
        }));
        return;
      }
      const answer = answeredDiscover(outcome.response)[0] ?? null;
      setFeeds((held) => ({ ...held, [kind]: feedAfter(held[kind], answer) }));
    },
    [session, genre],
  );

  // A genre is a new pair of feeds: the pages a person read for the last one
  // are not pages of these, and the old ask's answer is no longer wanted.
  useEffect(() => {
    serial.current += 1;
    setFeeds(blankFeeds());
    setReading([]);
    for (const { kind } of DISCOVER_ROWS) {
      void read(kind, 1);
    }
    return () => {
      serial.current += 1;
    };
  }, [read]);

  const openGrid = (kind: DiscoverKind, index: string) => {
    const feed = feeds[kind];
    if (feed.items.length === 0) {
      return;
    }
    push(
      gridLevel({
        title: feedTitle(kind),
        index,
        tag: discoverTag(kind, genre?.name ?? null, feed.items.length),
        addon: null,
        source: { kind: "discover", feedKind: kind, genre, feed },
      }),
    );
  };

  return (
    <>
      <div className="remote-filters" role="group" aria-label="Genres">
        <ChoiceChip pressed={genre === null} onClick={() => chooseGenre(null)}>
          All genres
        </ChoiceChip>
        {DISCOVER_GENRES.filter((choice) => !choice.all).map((choice) => (
          <ChoiceChip
            key={choice.name}
            pressed={genre?.name === choice.name}
            onClick={() => chooseGenre(choice)}
          >
            {choice.name}
          </ChoiceChip>
        ))}
      </div>

      {DISCOVER_ROWS.map(({ kind }, at) => {
        const feed = feeds[kind];
        const loading = reading.includes(kind);
        const filter =
          genre === null ? { kind: "all" as const } : genreFilterFor(genre, kind);
        const none = filter.kind === "none";
        const phase = feedPhase(feed, loading);
        const couldPlay = snapshot ? discoverPlayable(snapshot.addons, kind) : true;
        const title = feedTitle(kind);
        const index = programIndex(at + 1);
        const quiet =
          none && genre !== null
            ? discoverNoCounterpart(kind, genre.name)
            : discoverNote(phase, genre?.name ?? null);

        return (
          <RemoteRail
            key={kind}
            index={index}
            title={title}
            tag={
              none ? null : discoverTag(kind, genre?.name ?? null, feed.items.length)
            }
            testId={`remote-discover-row-${kind}`}
            note={<RowNote failure={feed.failure} quiet={quiet} />}
            action={
              <PagingControl
                failure={feed.failure}
                more={feedMore(feed)}
                loading={loading}
                onMore={() => void read(kind, pageToAsk(feed))}
              />
            }
            more={
              feed.items.length > 0 ? (
                <MoreControl label={title} onOpen={() => openGrid(kind, index)} />
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
                testId={`discover-card-${meta.id}`}
                onClick={() => open(null, meta)}
              />
            ))}
          </RemoteRail>
        );
      })}
    </>
  );
}

/**
 * Discover with no TMDB Credential: the Addons' own Catalog rows of both kinds,
 * in the Addons' order, each asked page by page. The genre row is TMDB's and
 * stays away — an Addon's `genre` values are the Addon's own, and sending
 * TMDB's ids for them would be a second table that lies (ADR-0010, ADR-0020).
 */
function CatalogDiscover({
  session,
  state,
  open,
  push,
}: {
  session: Session;
  state: SessionState;
  open: (addon: string | null, meta: MetaPreview) => void;
  push: (level: NewLevel<RemotePayload>) => string;
}) {
  const snapshot = state.snapshot;
  const catalogs = useMemo(() => catalogsOf(snapshot), [snapshot]);
  const fingerprint = catalogs.map((catalog) => catalogKey(catalog)).join("|");
  const [rows, setRows] = useState<Row[]>([]);
  const [reading, setReading] = useState<ReadonlySet<string>>(() => new Set());
  // Which Catalogs own the rows: an answer to the last set is dropped rather
  // than landing in a row that is no longer drawn.
  const serial = useRef(0);

  const run = useCallback(
    async (key: string, action: Action) => {
      const token = serial.current;
      setReading((held) => new Set(held).add(key));
      const outcome = await session.ask(action);
      if (token !== serial.current) {
        return;
      }
      setReading((held) => {
        const next = new Set(held);
        next.delete(key);
        return next;
      });
      setRows((held) =>
        held.map((row) => (keyOf(row) === key ? settled(row, outcome) : row)),
      );
    },
    [session],
  );

  // The Catalogs are a new set of rows: page 1 of each, in the Addons' order,
  // and nothing carried over from the last one.
  useEffect(() => {
    serial.current += 1;
    setRows(catalogs.map((catalog) => blankRow(catalog)));
    setReading(new Set());
    for (const catalog of catalogs) {
      void run(catalogKey(catalog), catalogAsk(catalog));
    }
    return () => {
      serial.current += 1;
    };
    // The fingerprint stands in for the Catalogs: a new Snapshot with the same
    // declarations must not refetch rows this client already holds.
  }, [fingerprint, run]);

  if (catalogs.length === 0) {
    const empty = noCatalogState();
    return (
      <div className="remote-empty" data-testid="discover-no-catalogs">
        <h2 className="remote-empty-title">{empty.title}</h2>
        <p className="remote-empty-body">{empty.body}</p>
      </div>
    );
  }

  return (
    <>
      <p className="remote-quiet">{NO_CREDENTIAL_NOTE}</p>
      {rows.map((row, index) => {
        const key = keyOf(row);
        return (
          <RemoteRail
            key={key}
            index={programIndex(index + 1)}
            title={row.name}
            tag={rowTag(snapshot, row)}
            testId={`discover-row-${key}`}
            note={
              <RowNote failure={row.failure} quiet={catalogNote(row)} />
            }
            action={
              <PagingControl
                failure={row.failure}
                more={catalogMore(snapshot, row)}
                loading={reading.has(key)}
                onMore={() => void run(key, catalogPageAsk(row))}
              />
            }
            more={
              row.metas.length > 0 ? (
                <MoreControl
                  label={row.name}
                  onOpen={() =>
                    push(
                      gridLevel({
                        title: row.name,
                        index: programIndex(index + 1),
                        tag: rowTag(snapshot, row),
                        addon: row.addon,
                        source: { kind: "catalog", row },
                      }),
                    )
                  }
                />
              ) : null
            }
          >
            {row.metas.map((meta) => (
              <PosterCard
                key={meta.id}
                name={meta.name}
                poster={meta.poster}
                rating={meta.imdbRating?.trim() || null}
                subtitle={meta.releaseInfo}
                unplayable={state.unplayable.has(meta.id)}
                testId={`discover-card-${meta.id}`}
                onClick={() => open(row.addon, meta)}
              />
            ))}
          </RemoteRail>
        );
      })}
    </>
  );
}

/**
 * One Catalog answer folded into the row it belongs to. A refusal keeps what
 * the row already read and says why; a page that answered nothing ends it.
 */
function settled(row: Row, outcome: ActionOutcome): Row {
  if (outcome.error) {
    return { ...row, failure: outcome.error };
  }
  const answer = answeredCatalogs(outcome.response)[0] ?? null;
  return answer ? rowWith(row, answer) : { ...row, done: true };
}
