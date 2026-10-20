import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  blankRow,
  catalogKey,
  declaredCatalogs,
  keyOf,
  pageable,
  rowWith,
  SKIP,
  unaskable,
  type Row,
} from "../browse";
import { answeredCatalogs, explain, type Extra } from "../host-client";
import { cardName, cardNote, progressOf, resumable } from "../library";
import { useShell } from "./context";
import { addonName, continueArt, featuredRow, heroSlides, type HomeCard } from "./home";
import { HomeHero } from "./HomeHero";
import { Button, ContinueWatchingCard, PosterCard, RowTrack } from "./kit";
import { FOCUSABLE } from "./layout";
import { useTitleOpener } from "./TitleScreen";
import "./home.css";

/**
 * Home: the Host's Featured catalog as a cinematic hero, Continue watching, and
 * one row per declared Catalog, in the Addons' configured order.
 *
 * Nothing here is a second copy of the Host's state. The hero is the first four
 * items of the Featured catalog's ordinary `browse_catalog` answer — the same
 * answer the row needs, so drawing Home costs no extra call and no `open_title`.
 * Continue watching is `Snapshot.watchProgress` in the order the Host publishes
 * it. A Catalog row accumulates its pages in this client, because what one
 * client is looking at must not move what another one is looking at (ADR-0005).
 */
export function HomeScreen() {
  const { snapshot, chosenDestination, choose, ask, take } = useShell();
  const { openTitle: openTitleLevel } = useTitleOpener();
  const [rows, setRows] = useState<Row[]>([]);
  const [paging, setPaging] = useState<string[]>([]);
  const [answered, setAnswered] = useState<string[]>([]);
  const root = useRef<HTMLElement | null>(null);
  const focusedAtLaunch = useRef(false);

  const catalogFingerprint = useMemo(
    () => declaredCatalogs(snapshot).map(catalogKey).join("|"),
    [snapshot],
  );

  /** Ask the Host for one page of a row, and fold its answer into that row. */
  const load = useCallback(
    async (row: Row, extra: Extra[]): Promise<Row | null> => {
      const { response, error } = await ask({
        type: "browse_catalog",
        addon: row.addon,
        catalog: { type: row.type, id: row.id },
        extra,
      });
      if (error) {
        // A Catalog the Host refuses to ask for is not a row at all; anything
        // else is a row that says what went wrong, so one Addon's trouble does
        // not take the rest of Home with it (ADR-0010).
        return unaskable(error) ? null : { ...row, failure: error };
      }
      const answer = answeredCatalogs(response)[0] ?? null;
      return answer ? rowWith(row, answer) : null;
    },
    [ask],
  );

  // One row per Catalog the Addons declare, in the Addons' configured order.
  // The rows are laid down before any answer so the order does not wait on a
  // slow Addon; each answer then fills its own row. Keyed on which Catalogs
  // there are, not on every revision: a preference change publishes a new
  // Snapshot and must not throw away the pages a person has read.
  useEffect(() => {
    const catalogs = declaredCatalogs(snapshot);
    setRows(catalogs.map(blankRow));
    setAnswered([]);
    if (catalogs.length === 0) {
      return;
    }

    // The Featured row is asked first so the hero can be drawn as soon as the
    // one answer it needs exists; every other row follows in configured order.
    const featured = snapshot?.featuredCatalog;
    const featuredKey = featured
      ? keyOf({
          addon: featured.addon,
          type: featured.catalog.type,
          id: featured.catalog.id,
        })
      : null;
    const ordered = catalogs
      .slice()
      .sort((left, right) =>
        catalogKey(left) === featuredKey ? -1 : catalogKey(right) === featuredKey ? 1 : 0,
      );

    let cancelled = false;
    void (async () => {
      for (const catalog of ordered) {
        if (cancelled) {
          return;
        }
        const key = catalogKey(catalog);
        const first = await load(blankRow(catalog), []);
        if (cancelled) {
          return;
        }
        setAnswered((held) => (held.includes(key) ? held : [...held, key]));
        setRows((held) =>
          first
            ? held.map((row) => (keyOf(row) === key ? first : row))
            : held.filter((row) => keyOf(row) !== key),
        );
      }
    })();

    return () => {
      cancelled = true;
    };
    // Deliberately keyed on the fingerprint: reading `snapshot` here is how
    // the Catalogs are listed, but a new Snapshot with the same Catalogs in it
    // must not refetch what this client already holds.
  }, [catalogFingerprint, load]);

  const page = useCallback(
    (row: Row) => {
      const key = keyOf(row);
      setPaging((held) => (held.includes(key) ? held : [...held, key]));
      void load(row, [{ name: SKIP, value: String(row.offset) }]).then((answered) => {
        setPaging((held) => held.filter((held) => held !== key));
        if (answered) {
          setRows((held) =>
            held.map((held) => (keyOf(held) === key ? answered : held)),
          );
        }
      });
    },
    [load],
  );

  /** Open a Title's card, then push its screen over Home. */
  const openTitle = useCallback(
    (addon: string, card: HomeCard) => openTitleLevel(addon, card),
    [openTitleLevel],
  );

  const featured = featuredRow(snapshot, rows);
  const slides = heroSlides(featured?.metas ?? []);
  const continueWatching = snapshot?.watchProgress ?? [];
  const catalogs = declaredCatalogs(snapshot);
  const empty = snapshot !== null && catalogs.length === 0;
  const featuredKey = snapshot?.featuredCatalog
    ? keyOf({
        addon: snapshot.featuredCatalog.addon,
        type: snapshot.featuredCatalog.catalog.type,
        id: snapshot.featuredCatalog.catalog.id,
      })
    : null;
  const featuredDeclared =
    featuredKey !== null && catalogs.some((catalog) => catalogKey(catalog) === featuredKey);

  const hasContent =
    slides.length > 0 ||
    continueWatching.some(resumable) ||
    rows.some((row) => row.metas.length > 0);

  // The hero is drawn from a row that arrives after the Snapshot does, so a
  // launch with Continue watching is a race: the cards exist first. Wait for
  // the Featured row's answer before choosing, or focus would land on Continue
  // watching and never move to the hero.
  const heroPending = featuredDeclared && !answered.includes(featuredKey);

  // Launch focus is Home's content, not the rail: hero slide 1, otherwise the
  // first pressable card of the first row. Only the launch — a destination a
  // person chose keeps the rail item they chose (#79).
  useEffect(() => {
    if (chosenDestination || focusedAtLaunch.current || !hasContent || heroPending) {
      return;
    }
    const first = root.current?.querySelector<HTMLElement>(FOCUSABLE);
    if (!first) {
      return;
    }
    focusedAtLaunch.current = true;
    first.focus({ preventScroll: true });
  });

  return (
    <section className="home-screen" data-testid="home-screen" ref={root}>
      <h1 className="shell-visually-hidden">Home</h1>

      {slides.length > 0 ? (
        <HomeHero
          slides={slides}
          catalogName={featured?.name ?? null}
          onOpen={(slide) => {
            if (!featured) {
              return;
            }
            void openTitle(featured.addon, {
              id: slide.id,
              type: slide.type,
              name: slide.name,
              poster: slide.poster,
              background: slide.background,
            });
          }}
        />
      ) : null}

      {continueWatching.length > 0 ? (
        <div
          data-region="home-continue"
          data-kind="row"
          data-label="Continue watching"
        >
          <RowTrack
            title="Continue watching"
            tag="Host Watch progress"
            columns={4}
            testId="home-continue"
          >
            {continueWatching.map((entry) => {
              const playable = resumable(entry);
              return (
                <ContinueWatchingCard
                  key={`${entry.title.type}/${entry.video.id}`}
                  name={cardName(entry)}
                  note={cardNote(entry)}
                  art={continueArt(entry)}
                  progress={progressOf(entry)}
                  unplayable={!playable}
                  testId={`resume-${entry.video.id}`}
                  onClick={
                    playable
                      ? () =>
                          void take({
                            type: "resume",
                            video: { type: entry.title.type, id: entry.video.id },
                          })
                      : undefined
                  }
                />
              );
            })}
          </RowTrack>
        </div>
      ) : null}

      {empty ? (
        <div className="home-empty" data-testid="home-empty">
          <h2 className="home-empty-title">
            {snapshot.addons.length === 0
              ? "No Addons are configured"
              : "No Catalogs are configured"}
          </h2>
          <p className="home-empty-body">
            {snapshot.addons.length === 0
              ? "Home draws its rows from the Catalogs Addons offer. Add an Addon to start browsing."
              : "The configured Addons offer no Catalogs, so Home has no rows to draw. Choose an Addon that offers one."}
          </p>
          <Button variant="primary" onClick={() => choose("addons")}>
            Open Addons
          </Button>
        </div>
      ) : null}

      {rows.map((row) => (
        <div
          className="home-row"
          key={keyOf(row)}
          data-testid={`home-row-${keyOf(row)}`}
          data-region={`home-row:${keyOf(row)}`}
          data-kind="row"
          data-label={row.name}
        >
          <RowTrack
            title={row.name}
            tag={addonName(snapshot, row.addon)}
            columns={7}
            testId={`row-${keyOf(row)}`}
          >
            {/*
             * A preview carries no TitleKey, so Home cannot know whether a
             * card is an Unmapped Title until the Host answers `open_title`.
             * The amber mark belongs to the Title screen (#81), where the
             * Host's answer carries that key; Home never guesses it.
             */}
            {row.metas.map((meta) => (
              <PosterCard
                key={meta.id}
                name={meta.name}
                poster={meta.poster}
                subtitle={meta.releaseInfo}
                description={meta.description}
                testId={`card-${row.addon}-${meta.id}`}
                onClick={() => void openTitle(row.addon, meta)}
              />
            ))}
            {pageable(snapshot, row) &&
            !row.done &&
            (row.metas.length > 0 || row.failure !== null) ? (
              <div className="home-more">
                <Button
                  variant="ghost"
                  disabled={paging.includes(keyOf(row))}
                  onClick={() => page(row)}
                >
                  More
                </Button>
              </div>
            ) : null}
          </RowTrack>
          {row.failure ? (
            <p
              role="alert"
              className="home-row-failure"
              data-testid={`row-failure-${keyOf(row)}`}
            >
              {explain(row.failure)}
            </p>
          ) : null}
        </div>
      ))}

      {snapshot === null ? <p className="home-waiting">Waiting for the Host…</p> : null}
    </section>
  );
}
