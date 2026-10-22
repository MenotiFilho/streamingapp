import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";

import {
  catalogKey,
  declaredCatalogs,
  keyOf,
  pageable,
  type Row,
} from "../browse";
import { explain } from "../host-client";
import { cardName, cardNote, progressOf, resumable } from "../library";
import { useShell } from "./context";
import { addonName, continueArt, featuredRow, heroSlides, type HomeCard } from "./home";
import { HomeHero } from "./HomeHero";
import { Button, ContinueWatchingCard, PosterCard, RowTrack } from "./kit";
import { FOCUSABLE } from "./layout";
import { focusAndReveal } from "./reveal";
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
 *
 * The rows themselves live in the Shell's `HomeStore`, not here: this screen
 * unmounts whenever a person leaves the destination, and a return must paint
 * what was already read instead of asking every Catalog again (#112).
 */
export function HomeScreen() {
  const { snapshot, chosenDestination, choose, take, home } = useShell();
  const { openTitle: openTitleLevel } = useTitleOpener();
  const { rows, answered, paging } = useSyncExternalStore(
    home.subscribe,
    home.getSnapshot,
  );
  const root = useRef<HTMLElement | null>(null);
  const focusedAtLaunch = useRef(false);

  const catalogFingerprint = useMemo(
    () => declaredCatalogs(snapshot).map(catalogKey).join("|"),
    [snapshot],
  );
  // The store drops a removed Catalog in its sync effect, which runs after this
  // render; filtering here keeps a removed row from painting for one frame.
  const declaredKeys = useMemo(
    () => new Set(declaredCatalogs(snapshot).map(catalogKey)),
    [catalogFingerprint],
  );
  const visibleRows = rows.filter((row) => declaredKeys.has(keyOf(row)));
  const featuredCatalog = snapshot?.featuredCatalog;
  const featuredKey = featuredCatalog
    ? keyOf({
        addon: featuredCatalog.addon,
        type: featuredCatalog.catalog.type,
        id: featuredCatalog.catalog.id,
      })
    : null;

  // A return to Home, and only a return: paint what the store holds, join the
  // asks still in flight, and re-ask the rows that failed. A fingerprint or
  // Featured change is not a return and must not spend the four-ask budget on
  // failed rows.
  useEffect(() => {
    home.enter();
  }, [home]);

  // The store owns the rows, so a Catalog the store already holds is not asked
  // again: a preference change publishes a new Snapshot, and only a Catalog
  // that is new to the fingerprint is fetched. The effect is keyed on the
  // fingerprint and the Featured key rather than on every revision.
  useEffect(() => {
    home.sync(declaredCatalogs(snapshot), featuredKey);
    // Deliberately keyed on the fingerprint: reading `snapshot` here is how
    // the Catalogs are listed, but a new Snapshot with the same Catalogs in it
    // must not refetch what this client already holds.
  }, [home, catalogFingerprint, featuredKey]);

  const page = useCallback((row: Row) => home.page(keyOf(row)), [home]);

  /** Open a Title's card, then push its screen over Home. */
  const openTitle = useCallback(
    (addon: string, card: HomeCard) => openTitleLevel(addon, card),
    [openTitleLevel],
  );

  const featured = featuredRow(snapshot, visibleRows);
  const slides = heroSlides(featured?.metas ?? []);
  const continueWatching = snapshot?.watchProgress ?? [];
  const catalogs = declaredCatalogs(snapshot);
  const empty = snapshot !== null && catalogs.length === 0;
  const featuredDeclared =
    featuredKey !== null && catalogs.some((catalog) => catalogKey(catalog) === featuredKey);

  const hasContent =
    slides.length > 0 ||
    continueWatching.some(resumable) ||
    visibleRows.some((row) => row.metas.length > 0);

  // The hero is drawn from a row that arrives after the Snapshot does, so a
  // launch with Continue watching is a race: the cards exist first. Wait for
  // the Featured row's answer before choosing, or focus would land on Continue
  // watching and never move to the hero.
  const heroPending =
    featuredKey !== null && featuredDeclared && !answered.has(featuredKey);

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
    focusAndReveal(first);
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

      {visibleRows.map((row) => (
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
                  disabled={paging.has(keyOf(row))}
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
