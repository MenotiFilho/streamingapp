import { AnimatePresence, motion } from "motion/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  MouseEvent as ReactMouseEvent,
  MutableRefObject,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from "react";

import {
  catalogKey,
  declaredCatalogs,
  keyOf,
  type DeclaredCatalog,
  type Row,
} from "../../core/browse";
import type { ContinueEntry, MetaPreview } from "../../core/wire";
import { explain } from "../../core/errors";
import { cardName, cardNote, progressOf, resumable } from "../../core/library";
import { useShell } from "../context";
import { continueArt, featuredRow, heroSlides, type HeroSlide } from "../../core/home";
import { FOCUSABLE } from "../layout";
import { focusAndReveal } from "../reveal";
import { useTitleOpener } from "../TitleScreen";
import { usePreviewData } from "./context";
import {
  FEATURE_CLOCK_MS,
  FEATURE_DRAG_IDLE,
  FEATURE_ROTATION_MS,
  FEATURE_START,
  HOME_RAIL_ITEMS,
  HOME_RAIL_PAGE,
  HOME_RAIL_VISIBLE,
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
  rowTag,
  type FeatureDrag,
  type FeatureProgramme,
} from "./homeProgramme";
import { Button } from "../../kit/Button";
import { ContinueWatchingCard } from "../../kit/ContinueWatchingCard";
import { PosterCard } from "../../kit/PosterCard";
import { RowTrack } from "../RowTrack";
import { fade, panel } from "../../core/react/motion";
import { useReducedMotion } from "../../core/react/useReducedMotion";
import { ProgrammeLine } from "./ProgrammeLine";
import { RailGrid } from "./RailGrid";
import { RailMoreCard } from "./RailMoreCard";
import { programIndex, yearOf } from "./program";
import "./repertory.css";

/** Re-exported for a screen test that wants the beat without the component. */
export { FEATURE_ROTATION_MS };

type FeatureItem = {
  slide: HeroSlide;
  meta: MetaPreview;
};

function MetaLine({
  parts,
  className,
}: {
  parts: { year: string | null; rating: string | null; genres: string | null };
  className: string;
}) {
  if (!parts.year && !parts.rating && !parts.genres) {
    return null;
  }
  return (
    <p className={className}>
      {parts.year ? <span>{parts.year}</span> : null}
      {parts.rating ? <span>{parts.rating}</span> : null}
      {parts.genres ? <span>{parts.genres}</span> : null}
    </p>
  );
}

/** One slide's art and copy, drawn the same in the current and the neighbour layer. */
function FeatureSlideBody({ item }: { item: FeatureItem }) {
  const name = item.slide.name;
  const parts = captionParts(item.meta);
  const density = featureTitleDensity(name);

  return (
    <>
      <div className="rep-feature-art" data-art={item.slide.art ? "image" : "plate"}>
        {item.slide.art ? (
          <img src={item.slide.art} alt="" loading="lazy" />
        ) : (
          <span className="rep-feature-plate" aria-hidden="true">
            {name}
          </span>
        )}
        <span className="rep-feature-scrim" aria-hidden="true" />
      </div>

      <div className="rep-feature-copy">
        <h2 className="rep-feature-title" data-density={density}>
          {name}
        </h2>
        <MetaLine parts={parts} className="rep-feature-meta" />
        {item.slide.description ? (
          <p className="rep-feature-description">{item.slide.description}</p>
        ) : null}
        <span className="rep-feature-action" aria-hidden="true">
          Open the Title
        </span>
      </div>
    </>
  );
}

/** The slides' position during a gesture: the offset, and the neighbour beside it. */
type FeatureTrack = { offset: number; direction: -1 | 1 | null };

/** A released gesture finishing its travel: to the neighbour, or back. */
type FeatureSettle = { direction: -1 | 1; target: number; commit: boolean };

/**
 * The feature presentation: the backdrop between two hairlines, a two-gradient
 * ink scrim, the Title in display serif over it, one line of facts, the
 * description and one action.
 *
 * It walks the Featured catalog's first slides on its 15-second beat, one tick
 * per slide filling under it. A person's focus or a held pointer pauses the
 * fill — the focus the screen seats at launch does not, so the beat starts on
 * launch (#248) — Left/Right step it, a horizontal drag carries the slides
 * with the hand and commits or snaps back on release, and a tick jumps to its
 * slide; every interaction restarts that slide's time (ADR-0036 §2). The step,
 * jump, hold, drag and beat decisions are the core's programme; this screen
 * only holds it and reads it. The slides cross-fade with Motion, and reduced
 * motion keeps the beat and drops the drag's tracking — the tick's fill is the
 * only movement it leaves.
 */
function Feature({
  items,
  onOpen,
  frameRef,
  screenFocus,
}: {
  items: readonly FeatureItem[];
  onOpen: (item: FeatureItem) => void;
  /** The frame the screen seats at launch, so it can measure and focus it. */
  frameRef: RefObject<HTMLDivElement | null>;
  /**
   * True only while the screen itself is placing focus on the frame. That
   * focus is a courtesy of the screen, not a hand on the programme, so it must
   * not hold the fill (ADR-0036 §2): the beat has to start on launch.
   */
  screenFocus: MutableRefObject<boolean>;
}) {
  const [programme, setProgramme] = useState<FeatureProgramme>(FEATURE_START);
  const [track, setTrack] = useState<FeatureTrack | null>(null);
  const [settle, setSettle] = useState<FeatureSettle | null>(null);
  const { setBaseIntentHandler } = useShell();
  const frame = frameRef;
  const drag = useRef<FeatureDrag>(FEATURE_DRAG_IDLE);
  const width = useRef(0);
  const settleTimer = useRef<number | null>(null);
  const settleNow = useRef<FeatureSettle | null>(null);
  const reducedMotion = useReducedMotion();
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
      setProgramme((current) => featureStepThrough(current, items.length, held.direction));
    }
    setTrack(null);
    setSettle(null);
  }, [items.length, stopSettleTimer]);

  const beginSettle = (direction: -1 | 1, target: number, commit: boolean) => {
    const held: FeatureSettle = { direction, target, commit };
    settleNow.current = held;
    setSettle(held);
    stopSettleTimer();
    // Motion's spring is the same visual duration; the margin lets it land
    // before the programme swaps the slides.
    const milliseconds = Math.round((panel().visualDuration ?? 0.24) * 1000) + 20;
    settleTimer.current = window.setTimeout(finishSettle, milliseconds);
  };

  // Nothing of a gesture may outlive the screen that drew it.
  useEffect(() => {
    return () => stopSettleTimer();
  }, [stopSettleTimer]);

  // Focus and a held pointer both pause the fill. A pointer that lets go
  // releases it even where the press focused the frame: the press was the
  // pointer's, and the fill must not stay held until focus leaves (both
  // clients). Keyboard and D-pad focus still hold through `onFocus`.
  const hold = () => setProgramme(featureHold);
  const release = () => setProgramme(featureRelease);
  // The screen seats focus on the feature when Home mounts; that focus is the
  // screen's, not a person's hand, so the beat must not stop before it starts
  // (#248). Every later focus — a D-pad walk onto the frame, a pointer press
  // that focused it — still holds.
  const onFocus = () => {
    if (screenFocus.current) {
      screenFocus.current = false;
      return;
    }
    hold();
  };

  // The feature's Left/Right is one decision for the D-pad and the arrow keys:
  // both arrive here as intents. At the first slide Left is not consumed, so
  // the focus engine can cross to the spine; at the last slide Right stays.
  useEffect(() => {
    const clear = setBaseIntentHandler((intent) => {
      if (document.activeElement !== frame.current) {
        return false;
      }
      const direction = intent === "right" ? 1 : intent === "left" ? -1 : null;
      if (direction === null) {
        return false;
      }
      const next = featureStep(active, items.length, direction);
      if (next === null) {
        return direction === 1;
      }
      // The press steps to the slide `featureStep` named, and restarts that
      // slide's time. It never wraps: at the first slide Left is the frame's.
      finishSettle();
      setProgramme((current) => featureJump(current, items.length, next));
      return true;
    });
    return clear;
  }, [active, items.length, setBaseIntentHandler, finishSettle]);

  // A new Featured catalog starts its programme over at the first slide; a
  // focus that is still on the frame keeps holding the new programme. A
  // gesture in flight belongs to the old programme and is dropped.
  useEffect(() => {
    stopSettleTimer();
    settleNow.current = null;
    setTrack(null);
    setSettle(null);
    setProgramme((current) => ({ ...FEATURE_START, held: current.held }));
  }, [items.length, items[0]?.slide.id, stopSettleTimer]);

  // The clock: the core decides that a held programme spends nothing and that
  // a finished item wraps with its remainder. The ticks' fill is drawn from
  // the same elapsed time, so pause, jump and the beat all agree.
  useEffect(() => {
    if (!rotating || programme.held) {
      return;
    }
    const timer = window.setInterval(() => {
      setProgramme((current) => featureElapse(current, items.length, FEATURE_CLOCK_MS));
    }, FEATURE_CLOCK_MS);
    return () => window.clearInterval(timer);
  }, [rotating, programme.held, items.length]);

  // A hand lands: a settle still travelling finishes first, so a committed
  // step is never lost under the next press. The frame is held while the hand
  // is on it.
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
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
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
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
  // pointer has let go, so the fill resumes.
  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
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
        setProgramme((current) => featureStepThrough(current, items.length, direction));
        setTrack(null);
      } else {
        beginSettle(direction, direction === 1 ? -width.current : width.current, true);
      }
    } else if (track?.direction != null && items.length > 1) {
      if (reducedMotion) {
        setTrack(null);
      } else {
        beginSettle(track.direction, 0, false);
      }
    } else {
      setTrack(null);
    }
    release();
  };

  // The click a browser synthesises at the end of a drag is the drag's, not a
  // press on the feature: it must not open the Title. A keyboard click
  // (`detail === 0`) is never the drag's, and it clears a claim a drag left
  // behind, so a drag that produced no click cannot swallow the next Enter.
  const onClickCapture = (event: ReactMouseEvent<HTMLDivElement>) => {
    const click = featureDragClick(drag.current, event.detail);
    drag.current = click.drag;
    if (!click.ours) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  // A tick is a step like a swipe: it puts away a settle still travelling and
  // restarts the item's time.
  const jumpTo = (index: number) => {
    finishSettle();
    setProgramme((current) => featureJump(current, items.length, index));
  };

  if (!item) {
    return null;
  }

  const name = item.slide.name;
  const gestureMode = track !== null || settle !== null;
  const neighbourDirection = settle?.direction ?? track?.direction ?? null;
  const neighbour =
    neighbourDirection !== null && items.length > 1
      ? items[featureNeighbour(active, items.length, neighbourDirection)]
      : null;
  const currentX = settle ? settle.target : track?.offset ?? 0;
  const neighbourX = settle
    ? settle.target + (settle.direction === 1 ? width.current : -width.current)
    : track && track.direction !== null
      ? track.offset + (track.direction === 1 ? width.current : -width.current)
      : 0;
  const slideTransition = settle ? panel() : gestureMode ? { duration: 0 } : fade();

  return (
    <section
      className="rep-feature"
      data-region="home-feature"
      data-kind="branch"
      data-label="Feature presentation"
      aria-label="Feature presentation"
      data-testid="repertory-feature"
      data-active-slide={item.slide.id}
    >
      <div
        ref={frame}
        className="rep-feature-frame"
        role="button"
        tabIndex={0}
        data-focusable
        data-held={programme.held ? "true" : undefined}
        aria-label={`Open the Title: ${name}`}
        onFocus={onFocus}
        onBlur={release}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpen(item);
          }
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={onClickCapture}
        onClick={() => onOpen(item)}
      >
        <span className="rep-feature-wash" aria-hidden="true" />
        {/*
         * The current slide is always a Motion layer, so a gesture's neighbour
         * becomes it without a remount and then a later beat still cross-fades.
         * While a hand drags, x follows it with no transition; a released
         * gesture travels the rest of the way on the panel's duration.
         */}
        <AnimatePresence initial={false}>
          {neighbour ? (
            <motion.div
              key={neighbour.slide.id}
              className="rep-feature-slide"
              initial={false}
              animate={{ x: neighbourX }}
              transition={slideTransition}
              aria-hidden="true"
            >
              <FeatureSlideBody item={neighbour} />
            </motion.div>
          ) : null}
          <motion.div
            key={item.slide.id}
            className="rep-feature-slide"
            initial={gestureMode ? false : { opacity: 0 }}
            animate={{ x: currentX, opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={slideTransition}
          >
            <FeatureSlideBody item={item} />
          </motion.div>
        </AnimatePresence>
      </div>

      {/* One tick per slide, pointer and touch furniture outside the frame's
          own focus order: the arrows already step, and Enter opens. The current
          tick fills with the programme's elapsed time; the others are the
          programme's hairlines. A one-slide programme has nothing to choose
          between, so it draws no ticks. */}
      {items.length > 1 ? (
        <div className="rep-feature-ticks" role="group" aria-label="Feature programme">
          {items.map((tick, tickIndex) => (
            <button
              key={tick.slide.id}
              type="button"
              className="rep-feature-tick"
              tabIndex={-1}
              aria-label={`Show ${tick.slide.name}`}
              aria-current={tickIndex === active ? "step" : undefined}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => jumpTo(tickIndex)}
            >
              <span
                className="rep-feature-tick-fill"
                style={{ transform: `scaleX(${tickIndex === active ? progress : 0})` }}
              />
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

/**
 * The feature's reserved frame while the Featured catalog is still answering.
 *
 * It has the feature's own height and hairlines, so the page does not jump when
 * the real presentation arrives; the copy is a quiet programme note, not a
 * spinner or invented content.
 */
function FeaturePlaceholder() {
  return (
    <section className="rep-feature" aria-label="Feature presentation">
      <div
        className="rep-feature-frame rep-feature-placeholder"
        data-testid="repertory-feature-placeholder"
        role="status"
      >
        <div className="rep-feature-placeholder-copy">
          <p className="rep-feature-placeholder-title">Tonight&rsquo;s feature</p>
          <p className="rep-feature-placeholder-note">Reading the programme…</p>
        </div>
      </div>
    </section>
  );
}

/**
 * Home as tonight's programme: one feature presentation, Continue watching,
 * and one section per declared Catalog.
 *
 * The data is exactly what Home always reads — the Featured catalog's own row
 * and the Host's Continue watching list — so this screen is the same client
 * under a different frame, not a second one. The surface is repertory; the
 * Actions are untouched. Every card opens the real Title page over Home, and
 * Continue watching resumes the Host's own Video where there is a Host to ask.
 */
export function RepertoryHome() {
  const { snapshot, chosenDestination, choose, take, home, push, pop } = useShell();
  const { openTitle } = useTitleOpener();
  const preview = usePreviewData();
  const { rows, answered } = useSyncExternalStore(home.subscribe, home.getSnapshot);
  const root = useRef<HTMLElement | null>(null);
  const featureFrame = useRef<HTMLDivElement | null>(null);
  const screenFocus = useRef(false);
  const focusedAtLaunch = useRef(false);

  const catalogs = useMemo<DeclaredCatalog[]>(() => declaredCatalogs(snapshot), [snapshot]);
  const catalogFingerprint = useMemo(
    () => catalogs.map((catalog) => catalogKey(catalog)).join("|"),
    [catalogs],
  );
  const declaredKeys = useMemo(
    () => new Set(catalogs.map((catalog) => catalogKey(catalog))),
    [catalogs],
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

  useEffect(() => {
    home.enter();
  }, [home]);

  useEffect(() => {
    home.sync(declaredCatalogs(snapshot), featuredKey);
    // Keyed on the fingerprint: a new Snapshot with the same Catalogs must not
    // refetch what this client already holds.
  }, [home, catalogFingerprint, featuredKey]);

  const openEntry = useCallback(
    (entry: ContinueEntry) => {
      // A plain Vite window has no Host to resume from, so the Title page is the
      // preview's honest next step. The Tauri window resumes the Host's Video.
      if (preview && entry.title.addon) {
        openTitle(entry.title.addon, {
          id: entry.title.id,
          type: entry.title.type,
          name: entry.title.name,
          poster: entry.title.poster,
          background: entry.title.background,
        });
        return;
      }
      void take({ type: "resume", video: { type: entry.title.type, id: entry.video.id } });
    },
    [openTitle, preview, take],
  );

  /**
   * A rail's More card opens the whole row as a pushed level. The level reads
   * the row from the Home store itself, so the pages that land while it is open
   * are drawn; the grid's Back is the shell's pop, which restores the More card
   * exactly where it was.
   */
  const openRow = useCallback(
    (row: Row, section: string) => {
      push({
        name: `All of ${row.name}`,
        kind: "overlay",
        payload: {
          render: () => (
            <RailGrid
              source={{ kind: "home", rowKey: keyOf(row) }}
              title={row.name}
              index={section}
              onOpenMeta={openTitle}
              onOpenEntry={openEntry}
              onClose={pop}
            />
          ),
        },
      });
    },
    [openEntry, openTitle, pop, push],
  );

  const openContinue = useCallback(() => {
    push({
      name: "All of Continue watching",
      kind: "overlay",
      payload: {
        render: () => (
          <RailGrid
            source={{ kind: "continue" }}
            title="Continue watching"
            index={programIndex(1)}
            onOpenMeta={openTitle}
            onOpenEntry={openEntry}
            onClose={pop}
          />
        ),
      },
    });
  }, [openEntry, openTitle, pop, push]);

  const featured = featuredRow(snapshot, visibleRows);
  const featureMetas = featured?.metas ?? [];
  const featureItems: FeatureItem[] = heroSlides(featureMetas).flatMap((slide) => {
    const meta = featureMetas.find((held) => held.id === slide.id);
    return meta ? [{ slide, meta }] : [];
  });
  const continueWatching = snapshot?.continueWatching ?? [];
  const empty = homeEmptyState(snapshot, catalogs.length);
  const featuredDeclared =
    featuredKey !== null && catalogs.some((catalog) => catalogKey(catalog) === featuredKey);

  const hasContent =
    empty !== null ||
    featureItems.length > 0 ||
    continueWatching.length > 0 ||
    visibleRows.some((row) => row.metas.length > 0 || row.failure !== null);

  // The feature's row arrives after the Snapshot; hold launch focus until it
  // has answered, or the first card would be Continue watching and never move
  // to the feature.
  const heroPending = featuredKey !== null && featuredDeclared && !answered.has(featuredKey);

  useEffect(() => {
    if (chosenDestination || focusedAtLaunch.current || !hasContent || heroPending) {
      return;
    }
    // Launch focus is the programme's content, not a row's paging arrow: the
    // feature's frame first, then a Continue card or a poster.
    const first =
      featureFrame.current ??
      root.current?.querySelector<HTMLElement>(
        ".rep-kit-continue:not([disabled]), .rep-kit-poster, .rep-empty [data-focusable]",
      ) ??
      root.current?.querySelector<HTMLElement>(FOCUSABLE);
    if (!first) {
      return;
    }
    focusedAtLaunch.current = true;
    // The feature's own focus is the screen's, not a hand's: the frame reads
    // this flag in its focus handler and lets the beat start (#248). Focus that
    // lands anywhere else is not a hold either, so the flag is only set for the
    // frame.
    screenFocus.current = first === featureFrame.current;
    focusAndReveal(first);
    screenFocus.current = false;
  });

  const hasContinue = continueWatching.length > 0;

  return (
    <section className="rep-home" data-testid="home-screen" ref={root}>
      <h1 className="shell-visually-hidden">Home</h1>
      <ProgrammeLine name="Home" testId="home-programme-line" />

      {featureItems.length > 0 ? (
        <Feature
          items={featureItems}
          frameRef={featureFrame}
          screenFocus={screenFocus}
          onOpen={(item) => {
            if (featured) {
              openTitle(featured.addon, item.meta);
            }
          }}
        />
      ) : heroPending || snapshot === null ? (
        <FeaturePlaceholder />
      ) : null}

      {hasContinue ? (
        <div
          data-region="home-continue"
          data-kind="row"
          data-label="Continue watching"
          data-testid="home-continue"
        >
          <RowTrack
            title="Continue watching"
            index={programIndex(1)}
            tag={continueTag(continueWatching.length)}
            columns={HOME_RAIL_VISIBLE}
            page={HOME_RAIL_PAGE}
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
            <RailMoreCard
              key="more"
              title="Continue watching"
              aspect="16:9"
              testId="more-continue"
              onClick={openContinue}
            />
          </RowTrack>
        </div>
      ) : null}

      {empty ? (
        <div className="rep-empty" data-testid="home-empty">
          <h2 className="rep-empty-title">{empty.title}</h2>
          <p className="rep-empty-body">{empty.body}</p>
          <Button variant="primary" onClick={() => choose("addons")}>
            Open Addons
          </Button>
        </div>
      ) : null}

      {visibleRows.map((row, index) => {
        const key = keyOf(row);
        const isAnswered = answered.has(key);
        const section = homeSectionIndex(index, hasContinue);
        const tag = rowTag(snapshot, row, HOME_RAIL_ITEMS);
        return (
          <div
            key={key}
            data-testid={`home-row-${key}`}
            data-region={`home-row:${key}`}
            data-kind="row"
            data-label={row.name}
          >
            <RowTrack
              title={row.name}
              index={section}
              tag={tag}
              columns={HOME_RAIL_VISIBLE}
              page={HOME_RAIL_PAGE}
            >
              {row.metas.slice(0, HOME_RAIL_ITEMS).map((meta) => (
                <PosterCard
                  key={meta.id}
                  name={meta.name}
                  poster={meta.poster}
                  rating={meta.imdbRating?.trim() || null}
                  subtitle={yearOf(meta)}
                  testId={`card-${row.addon}-${meta.id}`}
                  onClick={() => openTitle(row.addon, meta)}
                />
              ))}
              {row.metas.length > 0 ? (
                <RailMoreCard
                  key="more"
                  title={row.name}
                  aspect="2:3"
                  testId={`more-${key}`}
                  onClick={() => openRow(row, section)}
                />
              ) : null}
            </RowTrack>
            {row.failure ? (
              <p role="alert" className="rep-home-note rep-home-note--failure">
                {explain(row.failure)}
              </p>
            ) : row.metas.length === 0 ? (
              <p className="rep-home-note">
                {isAnswered
                  ? "The Addon answered with no Titles in this section."
                  : "Reading the programme…"}
              </p>
            ) : null}
          </div>
        );
      })}

      {snapshot === null ? <p className="rep-home-waiting">Waiting for the Host…</p> : null}

      {preview ? (
        <p className="rep-preview-note">
          Preview data: the catalogue is live from Cinemeta. Continue watching is sample progress
          built from the same films. Artwork is served from Metahub and is not committed to the
          repository.
        </p>
      ) : null}
    </section>
  );
}
