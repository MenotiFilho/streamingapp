import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";

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
  FEATURE_START,
  featureElapse,
  featureHold,
  featureJump,
  featurePosition,
  featureProgress,
  featureRelease,
  featureRotates,
  featureStep,
  featureStepThrough,
  homeEmptyState,
  homeSectionIndex,
  programIndex,
  rowTag,
  type FeatureProgramme,
} from "../core/homeProgramme";
import { cardName, cardNote, progressOf, resumable } from "../core/library";
import type { NewLevel } from "../core/navigation";
import { isTypingTarget } from "../core/input";
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

/** How often the programme's clock is read while the feature is on screen. */
const FEATURE_CLOCK_MS = 100;

/** How far a horizontal swipe travels before it steps one item. */
const FEATURE_SWIPE_PX = 40;

/** One gesture on the hero: where it started and what it has done. */
type FeatureSwipe = {
  active: boolean;
  x: number;
  y: number;
  /** Whether this gesture has already stepped the programme. */
  stepped: boolean;
};

/**
 * The feature presentation at hand scale: the 16:9 art between two hairlines,
 * a two-gradient ink scrim, the Title in display serif, the kicker with the
 * programme's position, and the description. Its beat is the core's 24 seconds;
 * a slide with no 16:9 art is a typographic plate, never a stretched poster.
 *
 * The window's own programme, in a hand (ADR-0036 §2): one tick per slide fills
 * over the item's time, Left/Right and a horizontal swipe step it, a tap on a
 * tick jumps to its slide, and a finger held on the hero pauses the fill. Every
 * step, swipe and tick restarts that slide's time. The decisions are the core's
 * programme, so the Remote asks the same seam the window does rather than
 * keeping a second copy (ADR-0035 §1, ADR-0032). The slide change is a fade,
 * and reduced motion keeps the beat — the tick's fill is the only movement it
 * leaves.
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
  const [programme, setProgramme] = useState<FeatureProgramme>(FEATURE_START);
  const reducedMotion = useReducedMotion();
  const drag = useRef<FeatureSwipe>({ active: false, x: 0, y: 0, stepped: false });
  const first = slides[0]?.id;
  const active = Math.min(programme.index, Math.max(0, slides.length - 1));
  const slide = slides[active];
  const rotating = featureRotates(slides.length, reducedMotion);
  const progress = featureProgress(programme);

  // A new Featured Catalog starts its programme at the first slide again.
  useEffect(() => {
    setProgramme(FEATURE_START);
  }, [first, slides.length]);

  // The clock: the core decides that a held programme spends nothing and that
  // a finished item wraps with its remainder. The ticks' fill is drawn from the
  // same elapsed time, so a hold, a jump and the beat all agree.
  useEffect(() => {
    if (!rotating || programme.held) {
      return;
    }
    const timer = window.setInterval(() => {
      setProgramme((current) => featureElapse(current, slides.length, FEATURE_CLOCK_MS));
    }, FEATURE_CLOCK_MS);
    return () => window.clearInterval(timer);
  }, [rotating, programme.held, slides.length]);

  // A finger landing on the hero holds the fill where it is. The click that
  // opens the Title still happens on release, as it did before.
  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }
    drag.current = { active: true, x: event.clientX, y: event.clientY, stepped: false };
    setProgramme(featureHold);
  };

  // A swipe steps once, when it has travelled far enough and travelled further
  // across than down; a long swipe does not run through the whole programme.
  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag.current.active || drag.current.stepped) {
      return;
    }
    const dx = event.clientX - drag.current.x;
    const dy = event.clientY - drag.current.y;
    if (Math.abs(dx) < FEATURE_SWIPE_PX || Math.abs(dx) <= Math.abs(dy)) {
      return;
    }
    drag.current.stepped = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setProgramme((current) => featureStepThrough(current, slides.length, dx < 0 ? 1 : -1));
  };

  const endSwipe = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag.current.active) {
      return;
    }
    drag.current.active = false;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    setProgramme(featureRelease);
  };

  // The click a browser synthesises at the end of a swipe is the swipe's, not a
  // press on the feature: it must not open the Title. A fresh pointerdown
  // clears the flag, so a swipe that never produced a click cannot eat the next
  // press.
  const onClickCapture = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (!drag.current.stepped) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    drag.current.stepped = false;
  };

  // Left/Right step the programme from anywhere on Home, the way the window's
  // feature takes the arrows when it holds the focus: a phone has no keyboard,
  // and a desktop browser has no focus engine here to hand them to the feature.
  // A step at either end is left alone rather than wrapping — the swipe is the
  // one that wraps — and a text field keeps its caret. The step restarts the
  // item the seam names.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) {
        return;
      }
      const direction = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : null;
      if (direction === null) {
        return;
      }
      const next = featureStep(active, slides.length, direction);
      if (next === null) {
        return;
      }
      event.preventDefault();
      setProgramme((current) => featureJump(current, slides.length, next));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, slides.length]);

  if (!slide) {
    return null;
  }

  return (
    <section
      className="remote-feature"
      data-testid="remote-feature"
      data-active-slide={slide.id}
      data-art={slide.artKind}
      aria-label="Feature presentation"
    >
      <button
        type="button"
        className="remote-feature-frame"
        data-focusable
        data-held={programme.held ? "true" : undefined}
        aria-label={`Open the Title: ${slide.name}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endSwipe}
        onPointerCancel={endSwipe}
        onPointerLeave={endSwipe}
        onClickCapture={onClickCapture}
        onClick={() => onOpen(addon, slide)}
      >
        <span key={slide.id} className="remote-feature-slide">
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
        </span>
      </button>

      {/* One tick per slide, the current one filling over its item's time. The
          ticks are the feature's own furniture, outside the frame's press, and
          a one-slide programme has nothing to choose between. */}
      {slides.length > 1 ? (
        <div className="remote-feature-ticks" role="group" aria-label="Feature programme">
          {slides.map((tick, tickIndex) => (
            <button
              key={tick.id}
              type="button"
              className="remote-feature-tick"
              aria-label={`Show ${tick.name}`}
              aria-current={tickIndex === active ? "step" : undefined}
              onClick={() => setProgramme((current) => featureJump(current, slides.length, tickIndex))}
            >
              <span
                className="remote-feature-tick-fill"
                style={{ transform: `scaleX(${tickIndex === active ? progress : 0})` }}
              />
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
