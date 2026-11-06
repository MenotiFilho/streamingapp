import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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
import type { Session, SessionState } from "../core/session";
import type { MetaPreview, ResumeEntry } from "../core/wire";
import { Button } from "../kit/Button";
import { ContinueWatchingCard } from "../kit/ContinueWatchingCard";
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

/**
 * The feature presentation at hand scale, with the window's anatomy: the 16:9
 * art between two hairlines, a two-gradient ink scrim, the Title in display
 * serif, one line of facts, the description, and one action. Its beat is the
 * core's 24 seconds; a slide with no 16:9 art is a typographic plate, never a
 * stretched poster.
 *
 * The window's own programme, in a hand (ADR-0036 §2): one tick per slide under
 * the frame fills over the item's time, Left/Right and a horizontal swipe step
 * it, a tap on a tick jumps to its slide, and a finger held on the hero pauses
 * the fill. Every step, swipe and tick restarts that slide's time. The
 * decisions are the core's programme and drag seam, so the Remote asks the same
 * seam the window does rather than keeping a second copy (ADR-0035 §1,
 * ADR-0032). The slide change is a fade, and reduced motion keeps the beat —
 * the tick's fill is the only movement it leaves.
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
  const drag = useRef<FeatureDrag>(FEATURE_DRAG_IDLE);
  const feature = useRef<HTMLElement | null>(null);
  const first = items[0]?.slide.id;
  const active = clampItem(programme.index, items.length);
  const item = items[active];
  const rotating = featureRotates(items.length);
  const progress = featureProgress(programme);

  // A new Featured Catalog starts its programme at the first slide again.
  useEffect(() => {
    setProgramme(FEATURE_START);
  }, [first, items.length]);

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

  // A finger landing on the hero holds the fill where it is. The click that
  // opens the Title still happens on release, as it did before.
  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }
    drag.current = featureDragBegin(event.clientX, event.clientY);
    setProgramme(featureHold);
  };

  // The rule that decides a swipe is the core's: far enough across, further
  // across than down, and only once per gesture. A long swipe does not run
  // through the whole programme.
  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const moved = featureDragMove(drag.current, event.clientX, event.clientY);
    drag.current = moved.drag;
    const { direction } = moved;
    if (direction === null) {
      return;
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setProgramme((current) => featureStepThrough(current, items.length, direction));
  };

  const endSwipe = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag.current.active) {
      return;
    }
    drag.current = featureDragEnd(drag.current);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    setProgramme(featureRelease);
  };

  // The click a browser synthesises at the end of a swipe is the swipe's, not a
  // press on the feature: it must not open the Title. A keyboard click
  // (`detail === 0`) is never the swipe's, and it clears a step flag a swipe
  // left behind, so a swipe that produced no click cannot swallow the next
  // Enter.
  const onClickCapture = (event: ReactMouseEvent<HTMLButtonElement>) => {
    const click = featureDragClick(drag.current, event.detail);
    drag.current = click.drag;
    if (!click.ours) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  // Left/Right step the programme from the feature or from nowhere, the way the
  // window's feature takes the arrows when it holds the focus: a phone has no
  // keyboard, and a desktop browser has no focus engine here to hand them to
  // the feature. A rail card keeps its own arrows, a text field keeps its caret,
  // and a key with a modifier is the browser's (Alt+Left is Back). A step at
  // either end is left alone rather than wrapping — the swipe is the one that
  // wraps — and the step restarts the item the seam names.
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
      setProgramme((current) => featureJump(current, items.length, next));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, items.length]);

  if (!item) {
    return null;
  }

  const name = item.slide.name;
  const parts = captionParts(item.meta);
  const density = featureTitleDensity(name);

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
        aria-label={`Open the Title: ${name}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endSwipe}
        onPointerCancel={endSwipe}
        onPointerLeave={endSwipe}
        onClickCapture={onClickCapture}
        onClick={() => onOpen(addon, item)}
      >
        <span key={item.slide.id} className="remote-feature-slide">
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
          </span>
        </span>

        <span className="remote-feature-action" aria-hidden="true">
          Open the Title
        </span>
      </button>

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
              onClick={() =>
                setProgramme((current) => featureJump(current, items.length, tickIndex))
              }
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
