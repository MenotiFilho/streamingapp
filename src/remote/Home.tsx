import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";

import {
  catalogKey,
  declaredCatalogs,
  keyOf,
  pageable,
  type DeclaredCatalog,
  type Row,
} from "../core/browse";
import type { Destination } from "../core/destinations";
import { explain } from "../core/errors";
import { continueArt, featuredRow, heroSlides, type HeroSlide } from "../core/home";
import {
  FEATURE_CLOCK_MS,
  FEATURE_DRAG_IDLE,
  FEATURE_START,
  captionParts,
  clampItem,
  continueTag,
  featureDragBegin,
  featureDragClick,
  featureDragEnd,
  featureDragMove,
  featureElapse,
  featureHold,
  featureJump,
  featureNeighbour,
  featureProgress,
  featureRelease,
  featureRotates,
  featureStep,
  featureStepThrough,
  featureTitleDensity,
  homeEmptyState,
  homeSectionIndex,
  programIndex,
  rowTag,
  type FeatureDrag,
  type FeatureProgramme,
} from "../core/homeProgramme";
import { cardName, cardNote, progressOf, resumable } from "../core/library";
import type { NewLevel } from "../core/navigation";
import { isTypingTarget, keyIntent } from "../core/input";
import { panel } from "../core/react/motion";
import { useReducedMotion } from "../core/react/useReducedMotion";
import type { Session, SessionState } from "../core/session";
import type { MetaPreview, ResumeEntry } from "../core/wire";
import { Button } from "../kit/Button";
import { ContinueWatchingCard } from "../kit/ContinueWatchingCard";
import { Icon } from "../kit/icons";
import { PosterCard } from "../kit/PosterCard";
import { gridLevel } from "./grid";
import { RemoteRail } from "./RemoteRail";
import { MoreControl, PagingControl } from "./RemoteRow";
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
 * catalog's first slides as one feature that holds for 15 seconds, Continue
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
  const { rows, answered, paging } = useSyncExternalStore(home.subscribe, home.getSnapshot);

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
   * reads the row from the Session's store, so a page the rail's head action
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
  const featureItems: FeatureItem[] = featuredHeld
    ? heroSlides(featuredHeld.metas).flatMap((slide) => {
        const meta = featuredHeld.metas.find((held) => held.id === slide.id);
        return meta ? [{ slide, meta }] : [];
      })
    : [];
  const continueWatching = snapshot?.watchProgress ?? [];
  const empty = homeEmptyState(snapshot, catalogs.length);
  const hasContinue = continueWatching.length > 0;

  const openContinue = () => {
    push(
      gridLevel({
        title: "Continue watching",
        index: programIndex(1),
        tag: continueTag(continueWatching.length),
        addon: null,
        source: { kind: "continue" },
      }),
    );
  };

  return (
    <section className="remote-home" data-testid="remote-home">
      <header className="remote-screen-head">
        <h1 className="remote-screen-title">Home</h1>
        <span className="remote-screen-rule" aria-hidden="true" />
      </header>

      {featuredHeld && featureItems.length > 0 ? (
        <RemoteFeature
          items={featureItems}
          addon={featuredHeld.addon}
          onOpen={(addon, item) =>
            open({
              addon,
              id: item.meta.id,
              type: item.meta.type,
              name: item.meta.name,
            })
          }
        />
      ) : null}

      {hasContinue ? (
        <RemoteRail
          index={programIndex(1)}
          title="Continue watching"
          tag={continueTag(continueWatching.length)}
          testId="remote-continue"
          more={<MoreControl label="Continue watching" onOpen={openContinue} />}
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
        const canPage = pageable(snapshot, row) && !row.done;
        const section = homeSectionIndex(index, hasContinue);
        return (
          <RemoteRail
            key={key}
            index={section}
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
              <PagingControl
                failure={row.failure}
                more={canPage}
                loading={paging.has(key)}
                onMore={() => home.page(key)}
              />
            }
            more={
              row.metas.length > 0 ? (
                <MoreControl label={row.name} onOpen={() => openRow(row, section)} />
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

/** One hero slide with the Meta it was drawn from, so the caption can print. */
type FeatureItem = {
  slide: HeroSlide;
  meta: MetaPreview;
};

/** The slides' position during a gesture: the offset, and the neighbour beside it. */
type FeatureTrack = { offset: number; direction: -1 | 1 | null };

/** A released gesture finishing its travel: to the neighbour, or back. */
type FeatureSettle = {
  direction: -1 | 1;
  target: number;
  commit: boolean;
  /** The slide a commit lands on, so it does not fade in again after the travel. */
  arrival: string | null;
};

/** One slide's art and copy, drawn the same in the current and the neighbour layer. */
function FeatureSlide({ item }: { item: FeatureItem }) {
  const name = item.slide.name;
  const parts = captionParts(item.meta);
  const density = featureTitleDensity(name);

  return (
    <>
      <span className="remote-feature-art" aria-hidden="true">
        {item.slide.art ? (
          <img className="remote-feature-image" src={item.slide.art} alt="" loading="lazy" />
        ) : (
          <span className="remote-feature-plate">{name}</span>
        )}
        <span className="remote-feature-scrim" aria-hidden="true" />
      </span>

      <span className="remote-feature-copy">
        <span className="remote-feature-name" data-density={density}>
          {name}
        </span>
        {parts.year || parts.rating || parts.genres ? (
          <span className="remote-feature-meta">
            {parts.year ? <span>{parts.year}</span> : null}
            {parts.rating ? <span>{parts.rating}</span> : null}
            {parts.genres ? <span>{parts.genres}</span> : null}
          </span>
        ) : null}
        {item.slide.description ? (
          <span className="remote-feature-description">{item.slide.description}</span>
        ) : null}
        <span className="remote-feature-action" aria-hidden="true">
          Open the Title
        </span>
      </span>
    </>
  );
}

/**
 * The feature presentation at hand scale, with the window's anatomy: the 16:9
 * art between two hairlines, a two-gradient ink scrim, the Title in display
 * serif, one line of facts, the description, and the action below it. Its beat
 * is the core's 15 seconds; a slide with no 16:9 art is a typographic plate,
 * never a stretched poster.
 *
 * The window's own programme, in a hand (ADR-0036 §2): one tick per slide under
 * the frame fills over the item's time, the previous/next arrows and Left/Right
 * step it, a tap on a tick jumps to its slide, and a finger held on the hero
 * pauses the fill. A horizontal swipe carries the slides with the finger and
 * commits to the neighbour or snaps back on release; the seam in the core
 * decides all three (ADR-0035 §1, ADR-0032). Every step, swipe and tick
 * restarts that slide's time. Reduced motion keeps the beat and drops the
 * tracking — a committed swipe is the fade alone. The ticks and arrows are
 * pointer furniture, outside the frame's press: they never open the Title.
 */
function RemoteFeature({
  items,
  addon,
  onOpen,
}: {
  items: readonly FeatureItem[];
  addon: string;
  /** The Addon whose Catalog answered the row: what `open_title` asks by. */
  onOpen: (addon: string, item: FeatureItem) => void;
}) {
  const [programme, setProgramme] = useState<FeatureProgramme>(FEATURE_START);
  const [track, setTrack] = useState<FeatureTrack | null>(null);
  const [settle, setSettle] = useState<FeatureSettle | null>(null);
  const drag = useRef<FeatureDrag>(FEATURE_DRAG_IDLE);
  const width = useRef(0);
  const feature = useRef<HTMLElement | null>(null);
  const settleTimer = useRef<number | null>(null);
  const settleNow = useRef<FeatureSettle | null>(null);
  const gestureArrival = useRef<string | null>(null);
  const reducedMotion = useReducedMotion();
  const first = items[0]?.slide.id;
  const active = clampItem(programme.index, items.length);
  const item = items[active];
  const rotating = featureRotates(items.length);
  const progress = featureProgress(programme);

  settleNow.current = settle;

  const stopSettleTimer = useCallback(() => {
    if (settleTimer.current !== null) {
      window.clearTimeout(settleTimer.current);
      settleTimer.current = null;
    }
  }, []);

  /**
   * Finish a released gesture at once: a commit lands its step, a snap leaves
   * the programme where it was. A second gesture or a step taken while the
   * slides are still travelling finishes it here rather than losing it.
   */
  const finishSettle = useCallback(() => {
    stopSettleTimer();
    const held = settleNow.current;
    settleNow.current = null;
    if (held?.commit) {
      gestureArrival.current = held.arrival;
      setProgramme((current) => featureStepThrough(current, items.length, held.direction));
    }
    setTrack(null);
    setSettle(null);
  }, [items.length, stopSettleTimer]);

  // Nothing of a gesture may outlive the screen that drew it.
  useEffect(() => {
    return () => stopSettleTimer();
  }, [stopSettleTimer]);

  const beginSettle = (
    direction: -1 | 1,
    target: number,
    commit: boolean,
    arrival: string | null,
  ) => {
    const held: FeatureSettle = { direction, target, commit, arrival };
    settleNow.current = held;
    setSettle(held);
    stopSettleTimer();
    // The stylesheet's transition is the same duration; the margin lets the
    // last frame land before the programme swaps the slides.
    const milliseconds = Math.round((panel().visualDuration ?? 0.24) * 1000) + 20;
    settleTimer.current = window.setTimeout(finishSettle, milliseconds);
  };

  // A new Featured Catalog starts its programme at the first slide again, and
  // drops whatever gesture was in flight.
  useEffect(() => {
    stopSettleTimer();
    settleNow.current = null;
    setProgramme(FEATURE_START);
    setTrack(null);
    setSettle(null);
  }, [first, items.length, stopSettleTimer]);

  // The clock: the core decides that a held programme spends nothing and that
  // a finished item wraps with its remainder. The ticks' fill is drawn from the
  // same elapsed time, so a hold, a jump and the beat all agree.
  useEffect(() => {
    if (!rotating || programme.held) {
      return;
    }
    const timer = window.setInterval(() => {
      setProgramme((current) => featureElapse(current, items.length, FEATURE_CLOCK_MS));
    }, FEATURE_CLOCK_MS);
    return () => window.clearInterval(timer);
  }, [rotating, programme.held, items.length]);

  // A finger landing on the hero holds the fill where it is. A settle still
  // travelling is finished first, so a committed step is never lost under the
  // next press.
  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }
    finishSettle();
    width.current = event.currentTarget.getBoundingClientRect().width;
    drag.current = featureDragBegin(event.clientX, event.clientY, event.timeStamp);
    setTrack(null);
    setProgramme(featureHold);
  };

  // The seam decides where the slides sit: across more than down, past the
  // slop, the current slide follows the hand 1:1 and the neighbour is named.
  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const moved = featureDragMove(
      drag.current,
      event.clientX,
      event.clientY,
      event.timeStamp,
      width.current,
    );
    drag.current = moved.drag;
    if (moved.drag.axis !== "across") {
      return;
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    if (reducedMotion || items.length < 2) {
      return;
    }
    setTrack({ offset: moved.offset, direction: moved.direction });
  };

  // The release: past the share or fast enough it commits to the neighbour and
  // the slides finish the journey; short and slow it snaps back. Either way the
  // finger has let go, so the fill resumes.
  const endSwipe = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag.current.active) {
      return;
    }
    const ended = featureDragEnd(drag.current, width.current, event.timeStamp);
    drag.current = ended.drag;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }

    const direction = ended.direction;
    if (direction !== null && items.length > 1) {
      if (reducedMotion) {
        gestureArrival.current = null;
        setProgramme((current) => featureStepThrough(current, items.length, direction));
        setTrack(null);
      } else {
        const arrival = items[featureNeighbour(active, items.length, direction)]?.slide.id ?? null;
        beginSettle(direction, direction === 1 ? -width.current : width.current, true, arrival);
      }
    } else if (track?.direction != null && items.length > 1) {
      if (reducedMotion) {
        setTrack(null);
      } else {
        beginSettle(track.direction, 0, false, null);
      }
    } else {
      setTrack(null);
    }
    setProgramme(featureRelease);
  };

  // The click a browser synthesises at the end of a swipe is the swipe's, not a
  // press on the feature: it must not open the Title. A keyboard click
  // (`detail === 0`) is never the swipe's, and it clears a claim a swipe left
  // behind, so a swipe that produced no click cannot swallow the next Enter.
  const onClickCapture = (event: ReactMouseEvent<HTMLButtonElement>) => {
    const click = featureDragClick(drag.current, event.detail);
    drag.current = click.drag;
    if (!click.ours) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  // A tick or an arrow is a step like a swipe: the same seam, the same wrapping
  // and restart. It also puts away any settle still travelling.
  const stepBy = (direction: -1 | 1) => {
    finishSettle();
    gestureArrival.current = null;
    setProgramme((current) =>
      featureJump(current, items.length, featureNeighbour(active, items.length, direction)),
    );
  };

  const jumpTo = (index: number) => {
    finishSettle();
    gestureArrival.current = null;
    setProgramme((current) => featureJump(current, items.length, index));
  };

  // Left/Right step the programme from the feature or from nowhere, the way the
  // window's feature takes the arrows when it holds the focus: a phone has no
  // keyboard, and a desktop browser has no focus engine here to hand them to
  // the feature. A rail card keeps its own arrows, a text field keeps its caret,
  // and a key with a modifier is the browser's (Alt+Left is Back). A step at
  // either end is left alone rather than wrapping — the arrows and the swipe
  // are the ones that wrap — and the step restarts the item the seam names.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return;
      }
      const intent = keyIntent(event.key, isTypingTarget(event.target));
      if (intent !== "left" && intent !== "right") {
        return;
      }
      const focused = document.activeElement;
      const onFeature = focused !== null && feature.current?.contains(focused);
      const onNothing =
        focused === null ||
        focused === document.body ||
        focused === document.documentElement;
      if (!onFeature && !onNothing) {
        return;
      }
      const direction = intent === "right" ? 1 : -1;
      const next = featureStep(active, items.length, direction);
      if (next === null) {
        return;
      }
      event.preventDefault();
      finishSettle();
      gestureArrival.current = null;
      setProgramme((current) => featureJump(current, items.length, next));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, items.length, finishSettle]);

  if (!item) {
    return null;
  }

  const name = item.slide.name;
  const neighbourDirection = settle?.direction ?? track?.direction ?? null;
  const neighbour =
    neighbourDirection !== null && items.length > 1
      ? items[featureNeighbour(active, items.length, neighbourDirection)]
      : null;
  const currentTransform = settle
    ? `translateX(${settle.target}px)`
    : track
      ? `translateX(${track.offset}px)`
      : undefined;
  const neighbourTransform = settle
    ? `translateX(calc(${settle.target}px ${settle.direction === 1 ? "+" : "-"} 100%))`
    : track && track.direction !== null
      ? `translateX(calc(${track.offset}px ${track.direction === 1 ? "+" : "-"} 100%))`
      : undefined;

  return (
    <section
      ref={feature}
      className="remote-feature"
      data-testid="remote-feature"
      data-active-slide={item.slide.id}
      data-art={item.slide.artKind}
      aria-label="Feature presentation"
    >
      <button
        type="button"
        className="remote-feature-frame"
        data-focusable
        data-held={programme.held ? "true" : undefined}
        data-gesture={track !== null || settle !== null ? "true" : undefined}
        aria-label={`Open the Title: ${name}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endSwipe}
        onPointerCancel={endSwipe}
        onClickCapture={onClickCapture}
        onClick={() => onOpen(addon, item)}
      >
        {neighbour ? (
          <span
            key={neighbour.slide.id}
            className="remote-feature-slide"
            data-tracking="true"
            data-settling={settle ? "true" : undefined}
            style={{ transform: neighbourTransform }}
            aria-hidden="true"
          >
            <FeatureSlide item={neighbour} />
          </span>
        ) : null}
        <span
          key={item.slide.id}
          className="remote-feature-slide"
          data-tracking={
            track !== null || gestureArrival.current === item.slide.id ? "true" : undefined
          }
          data-settling={settle ? "true" : undefined}
          style={{ transform: currentTransform }}
        >
          <FeatureSlide item={item} />
        </span>
      </button>

      {/* Previous and next, each a step that wraps like the swipe. They are
          pointer furniture like the ticks, and sit outside the frame's press so
          they never open the Title. */}
      {items.length > 1 ? (
        <>
          <button
            type="button"
            className="remote-feature-arrow remote-feature-arrow--previous"
            tabIndex={-1}
            aria-label="Previous feature"
            onClick={() => stepBy(-1)}
          >
            <Icon name="back" />
          </button>
          <button
            type="button"
            className="remote-feature-arrow remote-feature-arrow--next"
            tabIndex={-1}
            aria-label="Next feature"
            onClick={() => stepBy(1)}
          >
            <Icon name="chevron" />
          </button>
        </>
      ) : null}

      {/* One tick per slide under the frame, the current one filling over its
          item's time. The ticks are the feature's own furniture, outside the
          frame's press, and a one-slide programme has nothing to choose
          between. */}
      {items.length > 1 ? (
        <div className="remote-feature-ticks" role="group" aria-label="Feature programme">
          {items.map((tick, tickIndex) => (
            <button
              key={tick.slide.id}
              type="button"
              className="remote-feature-tick"
              tabIndex={-1}
              aria-label={`Show ${tick.slide.name}`}
              aria-current={tickIndex === active ? "step" : undefined}
              onClick={() => jumpTo(tickIndex)}
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
