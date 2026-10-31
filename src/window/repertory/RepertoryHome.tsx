import { AnimatePresence, motion } from "motion/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  catalogKey,
  declaredCatalogs,
  keyOf,
  type DeclaredCatalog,
  type Row,
} from "../../core/browse";
import type { MetaPreview, ResumeEntry } from "../../core/wire";
import { explain } from "../../core/errors";
import { cardName, cardNote, progressOf, resumable } from "../../core/library";
import { useShell } from "../context";
import { continueArt, featuredRow, heroSlides, type HeroSlide } from "../../core/home";
import { FOCUSABLE } from "../layout";
import { focusAndReveal } from "../reveal";
import { useTitleOpener } from "../TitleScreen";
import { useReducedMotion } from "../useReducedMotion";
import { usePreviewData } from "./context";
import {
  FEATURE_ROTATION_MS,
  HOME_RAIL_ITEMS,
  HOME_RAIL_PAGE,
  HOME_RAIL_VISIBLE,
  featurePosition,
  featureStep,
  homeEmptyState,
  homeSectionIndex,
  rowTag,
} from "./homeProgramme";
import { Button } from "../../kit/Button";
import { ContinueWatchingCard } from "../../kit/ContinueWatchingCard";
import { PosterCard } from "../../kit/PosterCard";
import { RowTrack } from "../RowTrack";
import { fade } from "../../core/react/motion";
import { ProgrammeLine } from "./ProgrammeLine";
import { RailGrid } from "./RailGrid";
import { RailMoreCard } from "./RailMoreCard";
import { captionParts, featureTitleDensity, programIndex, yearOf } from "./program";
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

/**
 * The feature presentation: the backdrop between two hairlines, a two-gradient
 * ink scrim, the Title in display serif over it, the mono kicker with the
 * programme's position, one line of facts, the description and one action.
 *
 * It walks the Featured catalog's first slides every 24 seconds while the
 * action is unfocused; focus holds it, Left/Right step it, and reduced motion
 * stops the beat. The slides cross-fade with Motion, and the action is one
 * persistent control, so stepping never takes focus away from it.
 */
function Feature({
  items,
  onOpen,
}: {
  items: readonly FeatureItem[];
  onOpen: (item: FeatureItem) => void;
}) {
  const [index, setIndex] = useState(0);
  const [held, setHeld] = useState(false);
  const reducedMotion = useReducedMotion();
  const { setBaseIntentHandler } = useShell();
  const frame = useRef<HTMLDivElement | null>(null);
  const active = Math.min(index, Math.max(0, items.length - 1));
  const item = items[active];
  const rotating = items.length > 1 && !reducedMotion;

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
      setIndex(next);
      return true;
    });
    return clear;
  }, [active, items.length, setBaseIntentHandler]);

  useEffect(() => {
    setIndex(0);
  }, [items.length, items[0]?.slide.id]);

  useEffect(() => {
    if (!rotating || held || items.length < 2) {
      return;
    }
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % items.length);
    }, FEATURE_ROTATION_MS);
    return () => window.clearInterval(timer);
  }, [rotating, held, items.length, index]);

  if (!item) {
    return null;
  }

  const name = item.slide.name;
  const parts = captionParts(item.meta);
  const density = featureTitleDensity(name);

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
        data-held={held ? "true" : undefined}
        aria-label={`Open the Title: ${name}`}
        onFocus={() => setHeld(true)}
        onBlur={() => setHeld(false)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpen(item);
          }
        }}
        onClick={() => onOpen(item)}
      >
        <span className="rep-feature-wash" aria-hidden="true" />
        <AnimatePresence initial={false}>
          <motion.div
            key={item.slide.id}
            className="rep-feature-slide"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={fade()}
          >
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
              <div className="rep-feature-kicker">
                <span>Feature presentation</span>
                <span className="rep-rule" aria-hidden="true" />
                <span>{featurePosition(active, items.length)}</span>
              </div>
              <h2 className="rep-feature-title" data-density={density}>
                {name}
              </h2>
              <MetaLine parts={parts} className="rep-feature-meta" />
              {item.slide.description ? (
                <p className="rep-feature-description">{item.slide.description}</p>
              ) : null}
            </div>
          </motion.div>
        </AnimatePresence>

        <span className="rep-feature-action" aria-hidden="true">
          Open the Title
        </span>
      </div>
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
          <div className="rep-feature-kicker">
            <span>Feature presentation</span>
            <span className="rep-rule" aria-hidden="true" />
            <span>—</span>
          </div>
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
 * and the Host's Watch progress — so this screen is the same client under a
 * different frame, not a second one. The surface is repertory; the Actions are
 * untouched. Every card opens the real Title page over Home, and Continue
 * watching resumes the Host's own Video where there is a Host to ask.
 */
export function RepertoryHome() {
  const { snapshot, chosenDestination, choose, take, home, push, pop } = useShell();
  const { openTitle } = useTitleOpener();
  const preview = usePreviewData();
  const { rows, answered } = useSyncExternalStore(home.subscribe, home.getSnapshot);
  const root = useRef<HTMLElement | null>(null);
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
    (entry: ResumeEntry) => {
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
              rowKey={keyOf(row)}
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
            rowKey={null}
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
  const continueWatching = snapshot?.watchProgress ?? [];
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
    // feature's action first, then a Continue card or a poster.
    const first =
      root.current?.querySelector<HTMLElement>(
        ".rep-feature-frame[data-focusable], .rep-kit-continue:not([disabled]), .rep-kit-poster, .rep-empty [data-focusable]",
      ) ?? root.current?.querySelector<HTMLElement>(FOCUSABLE);
    if (!first) {
      return;
    }
    focusedAtLaunch.current = true;
    focusAndReveal(first);
  });

  const hasContinue = continueWatching.length > 0;

  return (
    <section className="rep-home" data-testid="home-screen" ref={root}>
      <h1 className="shell-visually-hidden">Home</h1>
      <ProgrammeLine name="Home" testId="home-programme-line" />

      {featureItems.length > 0 ? (
        <Feature
          items={featureItems}
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
            tag={`${continueWatching.length} in progress`}
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
