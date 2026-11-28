import { animate, motion } from "motion/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { catalogKey, declaredCatalogs, keyOf, type DeclaredCatalog } from "../../core/browse";
import { explain } from "../../core/errors";
import { addonLabel, featuredRow } from "../../core/home";
import {
  HOME_RAIL_ITEMS,
  MARQUEE_HERO_SLIDES,
  heroDisplayFor,
  heroMode,
  heroRotatesInMode,
  heroTransitionOnFocus,
  heroWatchIntent,
  homeUsesPageLayout,
  marqueeHomeEmptyState,
  shouldReturnToRotatingHero,
  wideCardNote,
  type HeroFocusTarget,
  type MarqueeHeroMode,
} from "../../core/homeHero";
import {
  FEATURE_CLOCK_MS,
  FEATURE_DRAG_IDLE,
  FEATURE_START,
  clampItem,
  featureDragBegin,
  featureDragClick,
  featureDragEnd,
  featureDragMove,
  featureElapse,
  featureHold,
  featureJump,
  featureProgress,
  featureRelease,
  featureStepThrough,
  type FeatureDrag,
  type FeatureProgramme,
} from "../../core/homeProgramme";
import { inputModality, markNavigation } from "../../core/inputModality";
import { progressOf, resumable } from "../../core/library";
import type { LookHintTarget } from "../../core/lookHint";
import { useInputModality } from "../../core/react/useInputModality";
import type { ContinueEntry } from "../../core/wire";
import { Button } from "../../kit/Button";
import { CardCaption } from "../../kit/CardCaption";
import { useCalmMotion } from "../../kit/controlsFocus";
import { Hero } from "../../kit/Hero";
import { Icon } from "../../kit/icons";
import { panel } from "../../kit/motion";
import { Poster } from "../../kit/Poster";
import { RowHeader } from "../../kit/RowHeader";
import { WideCard } from "../../kit/WideCard";
import { useShell } from "../context";
import { FOCUSABLE } from "../layout";
import { useLookHints } from "../useLookHints";
import { focusAndReveal } from "../reveal";
import { useMarqueeTitleOpener as useTitleOpener } from "./MarqueeScreens";
import {
  clampRowsScrollTop,
  followingRowsViewportHeight,
  marqueeUnitPx,
  pageScrollTopFromNavigation,
  rowsShiftTransition,
} from "./frame";

/**
 * Marquee Home (`01.jpg`–`03.jpg`, `docs/design-system.md` §8):
 * - Rotating Featured hero with Watch now + Details + HeroTicks, transitioning
 *   to Following focus when focus moves into Continue watching or Catalog rows.
 * - Continue watching WideCards with Title wordmark (`logo`), UP NEXT, and
 *   `addon_disabled` / `addon_removed` unplayable marks.
 * - Catalog Poster rows, plus Host empty and error states.
 */
export function MarqueeHome() {
  const { snapshot, chosenDestination, choose, home, take, setBaseIntentHandler } = useShell();
  const { openTitle, openDiscoveredTitle } = useTitleOpener();
  const look = useLookHints();
  const calm = useCalmMotion();
  const { rows, answered } = useSyncExternalStore(home.subscribe, home.getSnapshot);

  const root = useRef<HTMLElement | null>(null);
  const rowsScroll = useRef<HTMLDivElement | null>(null);
  const rowNodes = useRef(new Map<string, HTMLElement>());
  const scrollAnim = useRef<{ stop: () => void } | null>(null);
  const watchNowButton = useRef<HTMLButtonElement | null>(null);
  const focusedAtLaunch = useRef(false);
  const pendingHeroFocus = useRef(false);
  const drag = useRef<FeatureDrag>(FEATURE_DRAG_IDLE);
  const heroWidth = useRef(0);
  const homeScrollTopRef = useRef(0);
  const rowsScrollTopRef = useRef(0);
  const lastFocusedCardRef = useRef<{
    element: HTMLElement;
    rowId: string;
    heroTarget: HeroFocusTarget;
  } | null>(null);

  const modality = useInputModality();
  const isPageLayout = homeUsesPageLayout(modality);
  const [programme, setProgramme] = useState<FeatureProgramme>(FEATURE_START);
  const [focusTarget, setFocusTarget] = useState<HeroFocusTarget | null>(null);
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null);

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
  }, [home, catalogFingerprint, featuredKey]);

  const featured = featuredRow(snapshot, visibleRows);
  const featuredMetas = useMemo(
    () => (featured?.metas ?? []).slice(0, MARQUEE_HERO_SLIDES),
    [featured],
  );
  const featuredDeclared =
    featuredKey !== null && catalogs.some((catalog) => catalogKey(catalog) === featuredKey);
  const heroPending = featuredKey !== null && featuredDeclared && !answered.has(featuredKey);
  const hasFeatured = featuredMetas.length > 0;
  const hasHeroStage = hasFeatured || heroPending || snapshot === null;

  const activeIndex = clampItem(programme.index, featuredMetas.length);
  const rotatingItem = featuredMetas[activeIndex] ?? null;
  const currentHeroMode = heroMode(modality, hasFeatured, focusTarget);
  const rotating = heroRotatesInMode(featuredMetas.length, currentHeroMode, programme.held);
  const progress = featureProgress(programme);

  const prevLayoutRef = useRef<{ page: boolean; heroMode: MarqueeHeroMode }>({
    page: isPageLayout,
    heroMode: currentHeroMode,
  });

  const continueWatching = snapshot?.continueWatching ?? [];
  const hasContinue = continueWatching.length > 0;
  const empty = marqueeHomeEmptyState(snapshot, catalogs.length);

  // Reset the rotating programme when the Featured catalog itself changes.
  useEffect(() => {
    setProgramme(FEATURE_START);
  }, [featuredKey, featuredMetas[0]?.id]);

  useEffect(() => {
    if (!rotating) {
      return;
    }
    const timer = window.setInterval(() => {
      setProgramme((current) => featureElapse(current, featuredMetas.length, FEATURE_CLOCK_MS));
    }, FEATURE_CLOCK_MS);
    return () => window.clearInterval(timer);
  }, [rotating, featuredMetas.length]);

  const openEntry = useCallback(
    (entry: ContinueEntry) => {
      const preview = {
        id: entry.title.id,
        type: entry.title.type,
        name: entry.title.name,
        poster: entry.title.poster,
        background: entry.title.background,
      };
      if (entry.title.addon) {
        openTitle(entry.title.addon, preview);
        return;
      }
      void openDiscoveredTitle(preview);
    },
    [openDiscoveredTitle, openTitle],
  );

  // Identify the first row that actually owns a focusable card, so pressing Up
  // from it returns focus to the rotating hero's Watch now button.
  const firstFocusableRowId = useMemo(() => {
    if (continueWatching.some((entry) => resumable(entry))) {
      return "home-continue";
    }
    for (const row of visibleRows) {
      if (row.metas.length > 0) {
        return `home-row:${keyOf(row)}`;
      }
    }
    return null;
  }, [continueWatching, visibleRows]);

  useEffect(() => {
    const clear = setBaseIntentHandler((intent) => {
      if (intent !== "up" || currentHeroMode !== "following") {
        return false;
      }
      const active = document.activeElement;
      const activeRegion =
        active instanceof HTMLElement ? active.closest("[data-region]") : null;
      const activeRowId = activeRegion?.getAttribute("data-region") ?? null;
      if (
        !shouldReturnToRotatingHero({
          mode: currentHeroMode,
          activeRowId,
          firstFocusableRowId,
        })
      ) {
        return false;
      }
      markNavigation();
      pendingHeroFocus.current = true;
      lastFocusedCardRef.current = null;
      setFocusedRowId(null);
      setFocusTarget((current) => heroTransitionOnFocus(current, { kind: "hero-action" }));
      return true;
    });
    return clear;
  }, [currentHeroMode, firstFocusableRowId, setBaseIntentHandler]);

  const attachRow = useCallback((id: string) => (node: HTMLElement | null) => {
    if (node) {
      rowNodes.current.set(id, node);
    } else {
      rowNodes.current.delete(id);
    }
  }, []);

  // Keep scroll position seamless when switching between pointer page layout and
  // navigation following mode (#392).
  useLayoutEffect(() => {
    const prev = prevLayoutRef.current;
    prevLayoutRef.current = { page: isPageLayout, heroMode: currentHeroMode };
    if (prev.page === isPageLayout) {
      return;
    }

    const homeEl = root.current;
    const port = rowsScroll.current;

    if (isPageLayout) {
      scrollAnim.current?.stop();
      scrollAnim.current = null;
      const unitPx = marqueeUnitPx(window.innerWidth, window.innerHeight);
      const rawShift = calm ? "" : port?.style.getPropertyValue("--mq-rows-shift");
      const parsedShift = rawShift ? Number.parseFloat(rawShift) : Number.NaN;
      const rowsShiftNow = Number.isFinite(parsedShift)
        ? parsedShift
        : prev.heroMode === "following"
          ? 0
          : 1;
      const targetHomeTop = pageScrollTopFromNavigation({
        hasHeroStage,
        rowsScrollTop: rowsScrollTopRef.current,
        rowsShift: rowsShiftNow,
        unitPx,
      });
      if (port) {
        port.style.removeProperty("--mq-rows-shift");
        port.scrollTop = 0;
      }
      rowsScrollTopRef.current = 0;
      if (homeEl) {
        homeEl.scrollTop = targetHomeTop;
        homeScrollTopRef.current = homeEl.scrollTop;
      } else {
        homeScrollTopRef.current = targetHomeTop;
      }
      setFocusedRowId(null);
      setFocusTarget(null);
      return;
    }

    const seeded = homeScrollTopRef.current;
    if (homeEl) {
      homeEl.scrollTop = 0;
    }
    homeScrollTopRef.current = 0;
    if (port) {
      port.scrollTop = seeded;
      rowsScrollTopRef.current = port.scrollTop;
    } else {
      rowsScrollTopRef.current = seeded;
    }

    const active = document.activeElement;
    const card = lastFocusedCardRef.current;
    if (
      card &&
      active instanceof HTMLElement &&
      (active === card.element || card.element.contains(active))
    ) {
      setFocusedRowId(card.rowId);
      setFocusTarget(card.heroTarget);
    }
  }, [calm, currentHeroMode, hasHeroStage, isPageLayout]);

  // Align the focused row's RowHeader to the top of the rows viewport (`y=480`)
  // in navigation modality so no previous row's captions peek in above it (`02.jpg`, `03.jpg`).
  useEffect(() => {
    const port = rowsScroll.current;
    if (!port || isPageLayout) {
      scrollAnim.current?.stop();
      scrollAnim.current = null;
      return;
    }
    const unitPx = marqueeUnitPx(window.innerWidth, window.innerHeight);
    const viewportHeight = followingRowsViewportHeight({
      hasHeroStage,
      homeHeight: root.current?.clientHeight ?? 0,
      portClientHeight: port.clientHeight,
      unitPx,
    });
    const targetTop = clampRowsScrollTop({
      focusedRowId,
      rowOffsetTop: focusedRowId ? (rowNodes.current.get(focusedRowId)?.offsetTop ?? 0) : 0,
      scrollHeight: port.scrollHeight,
      viewportHeight,
    });
    scrollAnim.current?.stop();
    if (calm) {
      port.scrollTop = targetTop;
      rowsScrollTopRef.current = port.scrollTop;
      return;
    }
    scrollAnim.current = animate(port.scrollTop, targetTop, {
      ...panel(),
      onUpdate: (value) => {
        port.scrollTop = value;
        rowsScrollTopRef.current = port.scrollTop;
      },
      onComplete: () => {
        scrollAnim.current = null;
        rowsScrollTopRef.current = port.scrollTop;
      },
    });
    return () => {
      scrollAnim.current?.stop();
      scrollAnim.current = null;
    };
  }, [calm, focusedRowId, hasHeroStage, isPageLayout]);

  useLayoutEffect(() => {
    if (!pendingHeroFocus.current) {
      return;
    }
    if (currentHeroMode !== "rotating" || !hasFeatured) {
      pendingHeroFocus.current = false;
      return;
    }
    if (!watchNowButton.current) {
      return;
    }
    pendingHeroFocus.current = false;
    focusAndReveal(watchNowButton.current);
  }, [currentHeroMode, hasFeatured]);

  const hasContent =
    empty !== null ||
    hasFeatured ||
    continueWatching.length > 0 ||
    visibleRows.some((row) => row.metas.length > 0 || row.failure !== null);

  useEffect(() => {
    if (chosenDestination || focusedAtLaunch.current || !hasContent || heroPending) {
      return;
    }
    const first =
      watchNowButton.current ??
      root.current?.querySelector<HTMLElement>(FOCUSABLE);
    if (!first) {
      return;
    }
    focusedAtLaunch.current = true;
    focusAndReveal(first);
  });

  const display = heroDisplayFor({
    mode: currentHeroMode,
    rotatingItem,
    target: focusTarget,
    continueWatching,
    rows: visibleRows,
  });

  const jumpTo = useCallback(
    (index: number) => {
      setProgramme((current) => featureJump(current, featuredMetas.length, index));
    },
    [featuredMetas.length],
  );

  const onHeroPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (currentHeroMode !== "rotating" || (event.pointerType === "mouse" && event.button !== 0)) {
      return;
    }
    heroWidth.current = event.currentTarget.getBoundingClientRect().width;
    drag.current = featureDragBegin(event.clientX, event.clientY, event.timeStamp);
    setProgramme(featureHold);
  };

  const onHeroPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const moved = featureDragMove(
      drag.current,
      event.clientX,
      event.clientY,
      event.timeStamp,
      heroWidth.current,
    );
    drag.current = moved.drag;
    if (moved.drag.axis === "across") {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
  };

  const endHeroDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current.active) {
      return;
    }
    const ended = featureDragEnd(drag.current, heroWidth.current, event.timeStamp);
    drag.current = ended.drag;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    if (ended.direction !== null && featuredMetas.length > 1) {
      const direction = ended.direction;
      setProgramme((current) => featureStepThrough(current, featuredMetas.length, direction));
    }
    setProgramme(featureRelease);
  };

  const onHeroClickCapture = (event: ReactMouseEvent<HTMLDivElement>) => {
    const click = featureDragClick(drag.current, event.detail);
    drag.current = click.drag;
    if (!click.ours) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  const watchedFilmKeys = useMemo(() => {
    const set = new Set<string>();
    for (const entry of snapshot?.watchProgress ?? []) {
      if (entry.watched && entry.title.type === "movie") {
        set.add(`${entry.title.type}:${entry.title.id}`);
      }
    }
    return set;
  }, [snapshot?.watchProgress]);

  const cardFocusProps = (
    rowId: string,
    target: LookHintTarget,
    heroTarget: HeroFocusTarget | null,
  ) => ({
    onFocus: (event: React.FocusEvent<HTMLElement>) => {
      look.rest("focus", target);
      if (heroTarget) {
        lastFocusedCardRef.current = {
          element: event.currentTarget,
          rowId,
          heroTarget,
        };
        if (inputModality() === "navigation") {
          setFocusedRowId(rowId);
          setFocusTarget((current) =>
            heroTransitionOnFocus(current, { kind: "row-card", target: heroTarget }),
          );
        }
      } else {
        lastFocusedCardRef.current = null;
      }
    },
    onBlur: () => look.left("focus"),
    onPointerEnter: () => look.rest("pointer", target),
    onPointerLeave: () => look.left("pointer"),
  });

  const rowsShift = currentHeroMode === "rotating" ? 1 : 0;

  return (
    <section
      ref={root}
      className="mq-home"
      data-testid="home-screen"
      data-home-layout={isPageLayout ? "page" : "navigation"}
      data-reveal-axis={isPageLayout ? undefined : "x"}
      data-has-hero={hasHeroStage ? "true" : "false"}
      data-hero-mode={hasHeroStage ? currentHeroMode : undefined}
      onScroll={(event) => {
        if (isPageLayout) {
          homeScrollTopRef.current = event.currentTarget.scrollTop;
        }
      }}
    >
      <h1 className="mq-visually-hidden">Home</h1>

      {display ? (
        <div
          className="mq-home-hero"
          data-testid="marquee-hero"
          data-region="home-hero"
          data-kind="branch"
          data-label="Featured"
          data-active-slide={rotatingItem?.id}
          onPointerDown={onHeroPointerDown}
          onPointerMove={onHeroPointerMove}
          onPointerUp={endHeroDrag}
          onPointerCancel={endHeroDrag}
          onClickCapture={onHeroClickCapture}
        >
          <Hero
            mode={display.mode}
            titleKey={display.titleKey}
            name={display.name}
            logo={display.logo}
            backdrop={display.backdrop}
            poster={display.poster}
            meta={display.meta}
            synopsis={display.synopsis}
            actions={
              rotatingItem && featured ? (
                <>
                  <Button
                    ref={watchNowButton}
                    kind="primary"
                    size="lg"
                    icon="play"
                    onFocus={() => {
                      lastFocusedCardRef.current = null;
                      setFocusedRowId(null);
                      setFocusTarget((current) =>
                        heroTransitionOnFocus(current, { kind: "hero-action" }),
                      );
                    }}
                    onClick={() => {
                      const intent = heroWatchIntent(
                        rotatingItem,
                        featured.addon,
                        continueWatching,
                      );
                      if (intent.kind === "resume") {
                        void take(intent.action);
                      } else {
                        openTitle(intent.addon, intent.preview);
                      }
                    }}
                  >
                    Watch now
                  </Button>
                  <Button
                    kind="secondary"
                    size="lg"
                    icon="info"
                    onFocus={() => {
                      lastFocusedCardRef.current = null;
                      setFocusedRowId(null);
                      setFocusTarget((current) =>
                        heroTransitionOnFocus(current, { kind: "hero-action" }),
                      );
                    }}
                    onClick={() => openTitle(featured.addon, rotatingItem)}
                  >
                    Details
                  </Button>
                </>
              ) : undefined
            }
            ticks={
              featuredMetas.length > 1
                ? {
                    count: featuredMetas.length,
                    active: activeIndex,
                    progress,
                    labels: featuredMetas.map((item) => `Show ${item.name}`),
                    onSelect: jumpTo,
                  }
                : undefined
            }
          />
        </div>
      ) : hasHeroStage ? (
        <div
          className="mq-home-hero-placeholder"
          data-testid="marquee-hero-placeholder"
          role="status"
          aria-label="Loading featured titles"
        />
      ) : null}

      <motion.div
        ref={rowsScroll}
        className="mq-home-rows"
        initial={false}
        animate={hasHeroStage && !isPageLayout ? { "--mq-rows-shift": rowsShift } : undefined}
        transition={rowsShiftTransition(calm)}
        onScroll={(event) => {
          if (!isPageLayout) {
            rowsScrollTopRef.current = event.currentTarget.scrollTop;
          }
        }}
      >
        {hasContinue ? (
          <section
            ref={attachRow("home-continue")}
            className="mq-home-row mq-home-row--continue"
            data-testid="home-continue"
            data-region="home-continue"
            data-kind="row"
            data-label="Continue watching"
          >
            <RowHeader title="Continue watching" className="mq-home-row-head" />
            <ul className="mq-row-track mq-row-track--wide">
              {continueWatching.map((entry) => {
                const playable = resumable(entry);
                const hintTarget: LookHintTarget = {
                  addon: entry.title.addon,
                  type: entry.title.type,
                  id: entry.title.id,
                };
                return (
                  <li key={`${entry.title.type}/${entry.video.id}`} className="mq-home-wide-item">
                    <WideCard
                      {...cardFocusProps(
                        "home-continue",
                        hintTarget,
                        playable ? { kind: "continue", entry } : null,
                      )}
                      name={entry.title.name}
                      backdrop={entry.title.background ?? null}
                      still={entry.video.thumbnail ?? null}
                      logo={entry.title.logo ?? null}
                      progress={progressOf(entry)}
                      upNext={entry.upNext}
                      unplayable={entry.unplayable?.reason ?? null}
                      data-testid={`resume-${entry.video.id}`}
                      onClick={playable ? () => openEntry(entry) : undefined}
                    />
                    <CardCaption title={entry.title.name} note={wideCardNote(entry)} />
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {empty ? (
          <div className="mq-empty-state" data-testid="home-empty">
            <span className="mq-empty-state-disc" aria-hidden="true">
              <Icon name="puzzle" className="mq-empty-state-icon" />
            </span>
            <h2 className="mq-type-heading mq-empty-state-title">{empty.title}</h2>
            <p className="mq-type-body mq-text-muted mq-empty-state-body">{empty.body}</p>
            <Button kind="primary" size="lg" onClick={() => choose("addons")}>
              Open Addons
            </Button>
          </div>
        ) : null}

        {visibleRows.map((row) => {
          const key = keyOf(row);
          const isAnswered = answered.has(key);
          const source = addonLabel(snapshot, row.addon);
          const items = row.metas.slice(0, HOME_RAIL_ITEMS);
          const rowRegionId = `home-row:${key}`;
          return (
            <section
              key={key}
              ref={attachRow(rowRegionId)}
              className="mq-home-row"
              data-testid={`home-row-${key}`}
              data-region={rowRegionId}
              data-kind="row"
              data-label={row.name}
            >
              <RowHeader title={row.name} source={source} className="mq-home-row-head" />
              {items.length > 0 ? (
                <ul className="mq-row-track mq-row-track--poster">
                  {items.map((meta) => (
                    <li key={meta.id} className="mq-home-poster-item">
                      <Poster
                        {...cardFocusProps(
                          rowRegionId,
                          { addon: row.addon, type: meta.type, id: meta.id },
                          { kind: "catalog", addon: row.addon, meta },
                        )}
                        name={meta.name}
                        poster={meta.poster}
                        watched={watchedFilmKeys.has(`${meta.type}:${meta.id}`)}
                        data-testid={`card-${row.addon}-${meta.id}`}
                        onClick={() => openTitle(row.addon, meta)}
                      />
                    </li>
                  ))}
                </ul>
              ) : null}
              {row.failure ? (
                <div role="alert" className="mq-row-notice mq-row-notice--danger">
                  <Icon name="triangle-alert" className="mq-row-notice-icon" />
                  <div className="mq-row-notice-copy">
                    <span className="mq-type-label">{`${source} did not answer`}</span>
                    <span className="mq-type-caption mq-text-faint">{explain(row.failure)}</span>
                  </div>
                </div>
              ) : row.metas.length === 0 ? (
                <p className="mq-row-status mq-type-caption mq-text-faint">
                  {isAnswered
                    ? "The Addon answered with no Titles in this Catalog."
                    : "Reading Catalog…"}
                </p>
              ) : null}
            </section>
          );
        })}

        {snapshot === null ? (
          <p className="mq-home-waiting mq-type-caption mq-text-faint" role="status">
            Waiting for the Host…
          </p>
        ) : null}
      </motion.div>
    </section>
  );
}
