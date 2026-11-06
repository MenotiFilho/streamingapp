import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import {
  catalogKey,
  declaredCatalogs,
  keyOf,
  type DeclaredCatalog,
  type Row,
} from "../core/browse";
import type { Destination } from "../core/destinations";
import { explain } from "../core/errors";
import { continueArt, featuredRow, heroSlides, type HeroSlide } from "../core/home";
import {
  FEATURE_ROTATION_MS,
  featurePosition,
  featureStep,
  homeEmptyState,
  homeSectionIndex,
  programIndex,
  rowTag,
} from "../core/homeProgramme";
import { cardName, cardNote, progressOf, resumable } from "../core/library";
import type { NewLevel } from "../core/navigation";
import { useReducedMotion } from "../core/react/useReducedMotion";
import type { Session, SessionState } from "../core/session";
import type { MetaPreview, ResumeEntry } from "../core/wire";
import { Button } from "../kit/Button";
import { ContinueWatchingCard } from "../kit/ContinueWatchingCard";
import { PosterCard } from "../kit/PosterCard";
import { gridLevel } from "./grid";
import { RemoteRail } from "./RemoteRail";
import { MoreControl } from "./RemoteRow";
import { titleLevel, type RemotePayload, type RemoteTitle } from "./levels";

export type HomeProps = {
  /**
   * The Session the rows belong to. Home reads `session.home`, so leaving the
   * destination and coming back paints what this client already read instead
   * of asking again — the store outlives the screen, the screen does not.
   */
  session: Session;
  /** What the Host last published; the rows and the art all come from it. */
  state: SessionState;
  /** A press on a card pushes the Title level B6 will draw. */
  push: (level: NewLevel<RemotePayload>) => string;
  /** The empty programme's one way out, which `homeEmptyState` names. */
  choose: (destination: Destination) => void;
};

/**
 * Home, in a hand (ADR-0035 §1, §2).
 *
 * The same decisions the window's Home takes, drawn for a phone: the Featured
 * catalog's first slides as one feature that holds for 24 seconds, Continue
 * watching from the Host's Watch progress, and one rail per declared Catalog in
 * the Addons' order. The rows and their pages are the Session's `HomeStore`, so
 * a Catalog change keeps every surviving row and a return to the destination
 * keeps what was read — nothing here wipes the page.
 *
 * A press opens a Title and nothing more: B2 has no Title screen, so a card
 * pushes the level its identity names and a placeholder says whose drawing it
 * is. No `open_title` and no `resume` leaves this client yet.
 */
export function Home({ session, state, push, choose }: HomeProps) {
  const { home } = session;
  const snapshot = state.snapshot;
  const { rows, answered } = useSyncExternalStore(home.subscribe, home.getSnapshot);

  const catalogs = useMemo<DeclaredCatalog[]>(() => declaredCatalogs(snapshot), [snapshot]);
  const catalogFingerprint = useMemo(
    () => catalogs.map((catalog) => catalogKey(catalog)).join("|"),
    [catalogs],
  );
  const declaredKeys = useMemo(
    () => new Set(catalogs.map((catalog) => catalogKey(catalog))),
    [catalogs],
  );

  const featured = snapshot?.featuredCatalog ?? null;
  const featuredKey = featured
    ? keyOf({
        addon: featured.addon,
        type: featured.catalog.type,
        id: featured.catalog.id,
      })
    : null;

  // A return to the destination rejoins what is still in flight and re-asks
  // only what failed; a successful row is never fetched twice for the session.
  useEffect(() => {
    home.enter();
  }, [home]);

  useEffect(() => {
    home.sync(catalogs, featuredKey);
    // Keyed on the fingerprint: a new Snapshot with the same Catalogs must not
    // refetch what this client already holds.
  }, [home, catalogFingerprint, featuredKey]);

  const open = (title: RemoteTitle) => {
    push(titleLevel(title));
  };

  const openMeta = (addon: string, meta: MetaPreview) => {
    open({ addon, id: meta.id, type: meta.type, name: meta.name });
  };

  const openEntry = (entry: ResumeEntry) => {
    open({
      addon: entry.title.addon,
      id: entry.title.id,
      type: entry.title.type,
      name: entry.title.name,
    });
  };

  /**
   * A rail's More card opens the whole row as a pushed grid (#253). The level
   * reads the row from the Session's store, so a page the grid's head action
   * asks lands in the rail's own row and Back returns to it.
   */
  const openRow = (row: Row, index: string) => {
    push(
      gridLevel({
        title: row.name,
        index,
        tag: rowTag(snapshot, row),
        addon: row.addon,
        source: { kind: "home", rowKey: keyOf(row) },
      }),
    );
  };

  // The store drops a row when its Catalog leaves the snapshot, but only on the
  // next `sync`; a declared-key filter keeps the frame between them honest.
  const visibleRows = rows.filter((row) => declaredKeys.has(keyOf(row)));
  const featuredHeld = featuredRow(snapshot, visibleRows);
  const slides = featuredHeld ? heroSlides(featuredHeld.metas) : [];
  const continueWatching = snapshot?.watchProgress ?? [];
  const empty = homeEmptyState(snapshot, catalogs.length);
  const hasContinue = continueWatching.length > 0;

  const openContinue = () => {
    push(
      gridLevel({
        title: "Continue watching",
        index: programIndex(1),
        tag: `${continueWatching.length} in progress`,
        addon: null,
        source: { kind: "home", rowKey: null },
      }),
    );
  };

  return (
    <section className="remote-home" data-testid="remote-home">
      <header className="remote-screen-head">
        <h1 className="remote-screen-title">Home</h1>
        <span className="remote-screen-rule" aria-hidden="true" />
      </header>

      {featuredHeld && slides.length > 0 ? (
        <RemoteFeature
          slides={slides}
          addon={featuredHeld.addon}
          onOpen={(addon, slide) =>
            open({
              addon,
              id: slide.id,
              type: slide.type,
              name: slide.name,
            })
          }
        />
      ) : null}

      {hasContinue ? (
        <RemoteRail
          index={programIndex(1)}
          title="Continue watching"
          tag={`${continueWatching.length} in progress`}
          testId="remote-continue"
          action={<MoreControl label="Continue watching" onOpen={openContinue} />}
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
                onClick={playable ? () => openEntry(entry) : undefined}
              />
            );
          })}
        </RemoteRail>
      ) : null}

      {empty ? (
        <div className="remote-empty" data-testid="remote-empty">
          <h2 className="remote-empty-title">{empty.title}</h2>
          <p className="remote-empty-body">{empty.body}</p>
          <Button variant="primary" onClick={() => choose(empty.action)}>
            Open Addons
          </Button>
        </div>
      ) : null}

      {visibleRows.map((row, index) => {
        const key = keyOf(row);
        const waiting = !answered.has(key);
        return (
          <RemoteRail
            key={key}
            index={homeSectionIndex(index, hasContinue)}
            title={row.name}
            tag={rowTag(snapshot, row)}
            testId={`remote-row-${key}`}
            note={
              row.failure ? (
                <p role="alert" className="remote-rail-failure">
                  {explain(row.failure)}
                </p>
              ) : row.metas.length === 0 ? (
                <p role="status" className="remote-rail-quiet">
                  {waiting
                    ? "Reading the programme…"
                    : "The Addon answered with no Titles in this section."}
                </p>
              ) : null
            }
            action={
              row.metas.length > 0 ? (
                <MoreControl
                  label={row.name}
                  onOpen={() =>
                    openRow(row, homeSectionIndex(index, hasContinue))
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
                testId={`card-${row.addon}-${meta.id}`}
                onClick={() => openMeta(row.addon, meta)}
              />
            ))}
          </RemoteRail>
        );
      })}
    </section>
  );
}

/**
 * The feature presentation at hand scale: the 16:9 art between two hairlines,
 * a two-gradient ink scrim, the Title in display serif, the kicker with the
 * programme's position, and the description. Its beat is the core's 24 seconds;
 * a slide with no 16:9 art is a typographic plate, never a stretched poster.
 */
function RemoteFeature({
  slides,
  addon,
  onOpen,
}: {
  slides: readonly HeroSlide[];
  /** The Addon whose Catalog answered the row: what `open_title` asks by. */
  addon: string;
  onOpen: (addon: string, slide: HeroSlide) => void;
}) {
  const [index, setIndex] = useState(0);
  const reducedMotion = useReducedMotion();
  const first = slides[0]?.id;
  const active = Math.min(index, Math.max(0, slides.length - 1));
  const slide = slides[active];

  // A new Featured Catalog starts its programme at the first slide again.
  useEffect(() => {
    setIndex(0);
  }, [first, slides.length]);

  // The beat: `featureStep` decides what the next slide is, and the end of the
  // programme starts it over, which is what a beat does and a press does not.
  useEffect(() => {
    if (reducedMotion || slides.length < 2) {
      return;
    }
    const timer = window.setInterval(() => {
      setIndex((current) => featureStep(current, slides.length, 1) ?? 0);
    }, FEATURE_ROTATION_MS);
    return () => window.clearInterval(timer);
  }, [reducedMotion, slides.length, first]);

  if (!slide) {
    return null;
  }

  return (
    <button
      type="button"
      className="remote-feature"
      data-focusable
      data-testid="remote-feature"
      data-art={slide.artKind}
      data-active-slide={slide.id}
      aria-label={`Open the Title: ${slide.name}`}
      onClick={() => onOpen(addon, slide)}
    >
      <span className="remote-feature-art" aria-hidden="true">
        {slide.art ? (
          <img className="remote-feature-image" src={slide.art} alt="" loading="lazy" />
        ) : (
          <span className="remote-feature-plate">{slide.name}</span>
        )}
        <span className="remote-feature-scrim" aria-hidden="true" />
      </span>

      <span className="remote-feature-copy">
        <span className="remote-feature-kicker">
          <span>Feature presentation</span>
          <span className="remote-feature-rule" aria-hidden="true" />
          <span>{featurePosition(active, slides.length)}</span>
        </span>
        <span className="remote-feature-name">{slide.name}</span>
        {slide.description ? (
          <span className="remote-feature-description">{slide.description}</span>
        ) : null}
      </span>
    </button>
  );
}
