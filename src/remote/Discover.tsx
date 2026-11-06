import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { answeredCatalogs, answeredDiscover } from "../core/answers";
import type { ActionOutcome } from "../core/answers";
import { blankRow, catalogKey, keyOf, rowWith, type Row } from "../core/browse";
import {
  blankFeed,
  discoverAsk,
  discoverPlayable,
  genresOf,
  MOVIE,
  type DiscoverFeed,
  type DiscoverKind,
} from "../core/discover";
import { programIndex, rowTag } from "../core/homeProgramme";
import type { NewLevel } from "../core/navigation";
import type { Session, SessionState } from "../core/session";
import type { Action, MetaPreview } from "../core/wire";
import { ChoiceChip } from "../kit/Chip";
import { PosterCard } from "../kit/PosterCard";
import { RemoteRail } from "./RemoteRail";
import { MoreControl, RowNote } from "./RemoteRow";
import {
  ALL_GENRES,
  DISCOVER_KINDS,
  NO_CREDENTIAL_NOTE,
  catalogAsk,
  catalogNote,
  catalogsOf,
  discoverNote,
  discoverTag,
  feedTitle,
  noCatalogState,
} from "./discoverScreen";
import { feedAfter, feedPhase } from "./feed";
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
 * Discover, in a hand (#207, ADR-0035 §1).
 *
 * Two arms, and which one is drawn is the Host's fact: with a TMDB Credential
 * the screen asks `discover` for the kind and genre a person chose, and without
 * one it draws the Addons' own Catalog rows through `browse_catalog` — the only
 * rows a Host with no credential can answer. A credential gained or cleared is
 * a new feed: the arm is a different question, so nothing of the old one stays.
 *
 * A press opens a Title and nothing more: a Discovered Title carries no Addon
 * (TMDB named it before any Addon did), and B6 owns the request itself.
 */
export function Discover({ session, state, push }: DiscoverProps) {
  const snapshot = state.snapshot;
  // Which arm a person gets is the Host's fact. Before the first Snapshot it is
  // not a guess to make: the screen waits rather than asking the wrong Host.
  const credential = snapshot ? snapshot.protection.tmdbHeld : null;
  const [kind, setKind] = useState<DiscoverKind>(MOVIE);
  const [genre, setGenre] = useState<number | null>(null);
  const [arm, setArm] = useState(credential);

  // A credential gained or cleared is a new feed: the filters of the last arm
  // are not filters of this one, so the screen starts on Movie again. It is
  // done in the render that learns the fact, so the new arm mounts on Movie
  // rather than asking the old kind first.
  if (arm !== credential) {
    setArm(credential);
    setKind(MOVIE);
    setGenre(null);
  }

  const chooseKind = (next: DiscoverKind) => {
    if (next === kind) {
      return;
    }
    // TMDB's two genre lists are not the same set, so a film's genre is not a
    // series' filter. A kind change starts from the whole new feed.
    setKind(next);
    setGenre(null);
  };

  const open = (addon: string | null, meta: MetaPreview) => {
    push(titleLevelOf(addon, meta));
  };

  return (
    <section className="remote-discover" data-testid="remote-discover">
      <header className="remote-screen-head">
        <h1 className="remote-screen-title">Discover</h1>
        <span className="remote-screen-rule" aria-hidden="true" />
      </header>

      {credential === null ? null : (
        <>
          <div className="remote-filters" role="group" aria-label="Kind">
            {DISCOVER_KINDS.map(({ kind: entry, label }) => (
              <ChoiceChip
                key={entry}
                pressed={kind === entry}
                onClick={() => chooseKind(entry)}
              >
                {label}
              </ChoiceChip>
            ))}
          </div>

          {credential ? (
            <KeyedDiscover
              session={session}
              state={state}
              kind={kind}
              genre={genre}
              chooseGenre={setGenre}
              open={open}
              push={push}
            />
          ) : (
            <CatalogDiscover
              session={session}
              state={state}
              kind={kind}
              open={open}
              push={push}
            />
          )}
        </>
      )}
    </section>
  );
}

/**
 * Discover over TMDB: the genre rail for the kind, and one feed asked page by
 * page. A kind or a genre is a new feed and asks page 1; the rail's More card
 * opens the feed as a whole-row grid, whose head asks the next page (or the
 * page that failed) into the same cards (`feedWith`).
 */
function KeyedDiscover({
  session,
  state,
  kind,
  genre,
  chooseGenre,
  open,
  push,
}: {
  session: Session;
  state: SessionState;
  kind: DiscoverKind;
  genre: number | null;
  chooseGenre: (genre: number | null) => void;
  open: (addon: string | null, meta: MetaPreview) => void;
  push: (level: NewLevel<RemotePayload>) => string;
}) {
  const snapshot = state.snapshot;
  const [feed, setFeed] = useState<DiscoverFeed>(blankFeed);
  const [reading, setReading] = useState(false);
  // Which ask owns the feed: an answer for a kind or a genre a person has left
  // must not land in the one they are looking at.
  const serial = useRef(0);

  const read = useCallback(
    async (page: number) => {
      const token = (serial.current += 1);
      setReading(true);
      const outcome = await session.ask(discoverAsk({ kind, page, genre }));
      if (token !== serial.current) {
        return;
      }
      setReading(false);
      if (outcome.error) {
        setFeed((held) => ({ ...held, failure: outcome.error }));
        return;
      }
      const answer = answeredDiscover(outcome.response)[0] ?? null;
      setFeed((held) => feedAfter(held, answer));
    },
    [session, kind, genre],
  );

  // A kind or a genre is a new feed: the page a person read for the last one is
  // not a page of this one, and the old ask's answer is no longer wanted.
  useEffect(() => {
    serial.current += 1;
    setFeed(blankFeed());
    void read(1);
    return () => {
      serial.current += 1;
    };
  }, [read]);

  const genreName = genresOf(kind).find((held) => held.id === genre)?.name ?? null;
  const phase = feedPhase(feed, reading);
  const couldPlay = snapshot ? discoverPlayable(snapshot.addons, kind) : true;

  const openGrid = () => {
    push(
      gridLevel({
        title: feedTitle(kind),
        index: programIndex(1),
        tag: discoverTag(kind, genreName, feed.items.length),
        addon: null,
        source: { kind: "discover", feedKind: kind, genre, feed },
      }),
    );
  };

  return (
    <>
      <div className="remote-filters" role="group" aria-label="Genres">
        <ChoiceChip pressed={genre === null} onClick={() => chooseGenre(null)}>
          {ALL_GENRES}
        </ChoiceChip>
        {genresOf(kind).map((held) => (
          <ChoiceChip
            key={held.id}
            pressed={genre === held.id}
            onClick={() => chooseGenre(held.id)}
          >
            {held.name}
          </ChoiceChip>
        ))}
      </div>

      <RemoteRail
        index={programIndex(1)}
        title={feedTitle(kind)}
        tag={discoverTag(kind, genreName, feed.items.length)}
        testId="remote-discover-feed"
        note={
          <RowNote failure={feed.failure} quiet={discoverNote(phase, genreName)} />
        }
        action={
          feed.items.length > 0 ? (
            <MoreControl label={feedTitle(kind)} onOpen={openGrid} />
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
    </>
  );
}

/**
 * Discover with no TMDB Credential: the Addons' own Catalog rows, of the kind a
 * person chose, each asked page by page. The genre rail is TMDB's and stays
 * away — an Addon's `genre` values are the Addon's own, and sending TMDB's ids
 * for them would be a second table that lies (ADR-0010, ADR-0020).
 */
function CatalogDiscover({
  session,
  state,
  kind,
  open,
  push,
}: {
  session: Session;
  state: SessionState;
  kind: DiscoverKind;
  open: (addon: string | null, meta: MetaPreview) => void;
  push: (level: NewLevel<RemotePayload>) => string;
}) {
  const snapshot = state.snapshot;
  const catalogs = useMemo(() => catalogsOf(snapshot, kind), [snapshot, kind]);
  const fingerprint = catalogs.map((catalog) => catalogKey(catalog)).join("|");
  const [rows, setRows] = useState<Row[]>([]);
  // Which kind owns the rows: an answer to the kind a person left is dropped
  // rather than landing in a row that is no longer drawn.
  const serial = useRef(0);

  const run = useCallback(
    async (key: string, action: Action) => {
      const token = serial.current;
      const outcome = await session.ask(action);
      if (token !== serial.current) {
        return;
      }
      setRows((held) =>
        held.map((row) => (keyOf(row) === key ? settled(row, outcome) : row)),
      );
    },
    [session],
  );

  // A kind, or the Catalogs it names, is a new feed: page 1 of each, in the
  // Addons' order, and nothing carried over from the last one.
  useEffect(() => {
    serial.current += 1;
    setRows(catalogs.map((catalog) => blankRow(catalog)));
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
    const empty = noCatalogState(kind);
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
