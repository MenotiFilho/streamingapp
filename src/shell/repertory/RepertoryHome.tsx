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
  pageable,
  type DeclaredCatalog,
  type Row,
} from "../../browse";
import { explain, type MetaPreview, type ResumeEntry } from "../../host-client";
import { cardName, cardNote, progressOf, resumable } from "../../library";
import { useShell } from "../context";
import { addonName, continueArt, featuredRow, heroSlides, type HeroSlide } from "../home";
import { FOCUSABLE } from "../layout";
import { focusAndReveal } from "../reveal";
import { useTitleOpener } from "../TitleScreen";
import { useReducedMotion } from "../useReducedMotion";
import { usePreviewData, useRepertorySettings } from "./context";
import { ProgramNote } from "./ProgramNote";
import {
  captionParts,
  countLabel,
  featureSlides,
  featureTitleDensity,
  programDate,
  programIndex,
} from "./program";
import type { RepertorySettings } from "./settings";
import "./repertory.css";

/** How long one feature holds before the programme moves on. */
export const FEATURE_ROTATION_MS = 24_000;

type NoteCard = {
  name: string;
  art: string | null;
  poster: string | null;
  year: string | null;
  rating: string | null;
  genres: string | null;
  description: string | null;
};

type FeatureItem = {
  slide: HeroSlide;
  meta: MetaPreview | null;
};

function noteFromMeta(meta: MetaPreview): NoteCard {
  const parts = captionParts(meta);
  return {
    name: meta.name,
    art: meta.background ?? null,
    poster: meta.poster,
    year: parts.year,
    rating: parts.rating,
    genres: parts.genres,
    description: meta.description,
  };
}

function noteFromSlide(slide: HeroSlide): NoteCard {
  return {
    name: slide.name,
    art: slide.art,
    poster: slide.poster,
    year: null,
    rating: null,
    genres: null,
    description: slide.description,
  };
}

function noteFromEntry(entry: ResumeEntry): NoteCard {
  return {
    name: cardName(entry),
    art: entry.title.background ?? null,
    poster: entry.title.poster,
    year: null,
    rating: null,
    genres: null,
    description: `Continue watching is sample progress in this prototype. In the real Host this card resumes the Video from ${cardNote(entry).toLowerCase()}.`,
  };
}

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
    <span className={className}>
      {parts.year ? <span>{parts.year}</span> : null}
      {parts.rating ? <span>{parts.rating}</span> : null}
      {parts.genres ? <span>{parts.genres}</span> : null}
    </span>
  );
}

function RowHead({ index, title, tag }: { index: string; title: string; tag: string }) {
  return (
    <header className="rep-row-head">
      <span className="rep-row-index">{index}</span>
      <h2 className="rep-row-title">{title}</h2>
      <span className="rep-rule" aria-hidden="true" />
      <span className="rep-row-tag">{tag}</span>
    </header>
  );
}

function ProgramPoster({ meta, onOpen }: { meta: MetaPreview; onOpen: () => void }) {
  const parts = captionParts(meta);
  return (
    <button
      type="button"
      className="rep-card"
      data-focusable
      onClick={onOpen}
      aria-label={`${meta.name}. Open the Title.`}
    >
      <span className="rep-poster">
        {meta.poster ? (
          <img src={meta.poster} alt="" loading="lazy" />
        ) : (
          <span className="rep-art-missing">{meta.name}</span>
        )}
      </span>
      <span className="rep-caption">
        <span className="rep-card-title">{meta.name}</span>
        {/*
         * At six columns the caption is ~230 px wide. Year and rating fit on
         * one mono line; genres do not, and a wrapped `| Comedy / Drama` reads
         * as debris. Genres stay on the feature and the program note.
         */}
        <MetaLine parts={{ ...parts, genres: null }} className="rep-card-meta" />
      </span>
    </button>
  );
}

function ContinueCard({ entry, onOpen }: { entry: ResumeEntry; onOpen: () => void }) {
  const playable = resumable(entry);
  const fraction = progressOf(entry);
  const art = continueArt(entry);
  return (
    <button
      type="button"
      className="rep-continue"
      data-focusable={playable ? true : undefined}
      data-unplayable={playable ? undefined : "true"}
      disabled={!playable}
      onClick={playable ? onOpen : undefined}
      aria-label={playable ? `${cardName(entry)}. Continue watching.` : cardName(entry)}
    >
      <span className="rep-continue-art">
        {art ? (
          <img src={art} alt="" loading="lazy" />
        ) : (
          <span className="rep-art-missing">{cardName(entry)}</span>
        )}
      </span>
      {fraction !== null ? (
        <span className="rep-continue-track" aria-hidden="true">
          <span style={{ width: `${Math.round(fraction * 100)}%` }} />
        </span>
      ) : null}
      <span className="rep-caption">
        <span className="rep-card-title">{cardName(entry)}</span>
        <span className="rep-card-meta">
          <span>{cardNote(entry)}</span>
        </span>
      </span>
    </button>
  );
}

function Feature({
  items,
  addon,
  catalog,
  mode,
  onOpen,
}: {
  items: readonly FeatureItem[];
  addon: string | null;
  catalog: string;
  mode: RepertorySettings["feature"];
  onOpen: (item: FeatureItem) => void;
}) {
  const [index, setIndex] = useState(0);
  const [held, setHeld] = useState(false);
  const reducedMotion = useReducedMotion();
  const active = Math.min(index, Math.max(0, items.length - 1));
  const item = items[active];
  const rotating = mode === "rotates" && items.length > 1 && !reducedMotion;

  useEffect(() => {
    setIndex(0);
  }, [mode, items.length, items[0]?.slide.id]);

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
  const parts = item.meta ? captionParts(item.meta) : { year: null, rating: null, genres: null };
  const density = featureTitleDensity(name);

  const step = (delta: number) => {
    setIndex((current) => Math.max(0, Math.min(items.length - 1, current + delta)));
  };

  return (
    <section
      className="rep-feature"
      data-region="home-feature"
      data-kind="row"
      data-label="Featured"
      aria-roledescription={rotating ? "carousel" : undefined}
      aria-label="Featured"
    >
      <div className="rep-feature-kicker">
        <span>Feature presentation</span>
        <span className="rep-rule" aria-hidden="true" />
        <span>
          {rotating ? `${programIndex(active + 1)} / ${programIndex(items.length)}` : "One showing"}
        </span>
      </div>
      <button
        type="button"
        className="rep-feature-card"
        data-focusable
        data-testid="repertory-feature"
        aria-label={`Featured: ${name}. Open the Title.`}
        onFocus={() => setHeld(true)}
        onBlur={() => setHeld(false)}
        onKeyDown={(event) => {
          if (items.length < 2) {
            return;
          }
          if (event.key === "ArrowRight") {
            event.preventDefault();
            event.stopPropagation();
            step(1);
          } else if (event.key === "ArrowLeft") {
            event.preventDefault();
            event.stopPropagation();
            step(-1);
          }
        }}
        onClick={() => onOpen(item)}
      >
        <span className="rep-feature-art" data-art={item.slide.art ? "image" : "text"}>
          {item.slide.art ? (
            <img key={item.slide.id} src={item.slide.art} alt="" />
          ) : (
            <span className="rep-feature-art-empty">{name}</span>
          )}
        </span>
        <span className="rep-feature-plate">
          <span className="rep-feature-eyebrow">
            {addon ? `From ${addon}` : "Tonight's feature"} / {catalog}
          </span>
          <span className="rep-feature-title" data-density={density}>
            {name}
          </span>
          <MetaLine parts={parts} className="rep-feature-meta" />
          {item.slide.description ? (
            <span className="rep-feature-description">{item.slide.description}</span>
          ) : null}
          <span className="rep-feature-cta">Open the Title</span>
        </span>
      </button>
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
 * untouched.
 */
export function RepertoryHome() {
  const { snapshot, chosenDestination, choose, take, home, push, pop } = useShell();
  const { openTitle: openTitleLevel } = useTitleOpener();
  const preview = usePreviewData();
  const { settings } = useRepertorySettings();
  const { rows, answered, paging } = useSyncExternalStore(home.subscribe, home.getSnapshot);
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

  const page = useCallback((row: Row) => home.page(keyOf(row)), [home]);

  const openNote = useCallback(
    (card: NoteCard) => {
      push({
        name: "Program note",
        kind: "overlay",
        render: () => (
          <ProgramNote
            name={card.name}
            art={card.art}
            poster={card.poster}
            year={card.year}
            rating={card.rating}
            genres={card.genres}
            description={card.description}
            onClose={pop}
          />
        ),
      });
    },
    [pop, push],
  );

  const openMeta = useCallback(
    (addon: string, meta: MetaPreview) => {
      if (preview) {
        openNote(noteFromMeta(meta));
        return;
      }
      openTitleLevel(addon, meta);
    },
    [openNote, openTitleLevel, preview],
  );

  const openEntry = useCallback(
    (entry: ResumeEntry) => {
      if (preview) {
        openNote(noteFromEntry(entry));
        return;
      }
      void take({ type: "resume", video: { type: entry.title.type, id: entry.video.id } });
    },
    [openNote, preview, take],
  );

  const featured = featuredRow(snapshot, visibleRows);
  const allSlides = heroSlides(featured?.metas ?? []);
  const slides = featureSlides(allSlides, settings.feature);
  const featureItems: FeatureItem[] = slides.map((slide) => ({
    slide,
    meta: featured?.metas.find((meta) => meta.id === slide.id) ?? null,
  }));
  const continueWatching = snapshot?.watchProgress ?? [];
  const empty = snapshot !== null && catalogs.length === 0;
  const featuredDeclared =
    featuredKey !== null && catalogs.some((catalog) => catalogKey(catalog) === featuredKey);

  const hasContent =
    allSlides.length > 0 ||
    continueWatching.some(resumable) ||
    visibleRows.some((row) => row.metas.length > 0);

  // The feature's row arrives after the Snapshot; hold launch focus until it
  // has answered, or the first card would be Continue watching and never move
  // to the feature.
  const heroPending = featuredKey !== null && featuredDeclared && !answered.has(featuredKey);

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

  const sectionOffset = continueWatching.length > 0 ? 2 : 1;

  return (
    <section className="rep-home" data-testid="home-screen" ref={root}>
      <header className="rep-home-head">
        <h1 className="rep-home-title">Tonight&rsquo;s program</h1>
        <p className="rep-home-date">{programDate(new Date())}</p>
      </header>

      <Feature
        items={featureItems}
        addon={featured ? addonName(snapshot, featured.addon) : null}
        catalog={featured?.name ?? "Featured"}
        mode={settings.feature}
        onOpen={(item) => {
          if (!featured) {
            return;
          }
          if (item.meta) {
            openMeta(featured.addon, item.meta);
          } else {
            openNote(noteFromSlide(item.slide));
          }
        }}
      />

      {continueWatching.length > 0 ? (
        <section
          className="rep-section"
          data-region="home-continue"
          data-kind="row"
          data-label="Continue watching"
          data-testid="home-continue"
        >
          <RowHead
            index={programIndex(1)}
            title="Continue watching"
            tag={`${continueWatching.length} in progress`}
          />
          <div className="rep-row-track">
            {continueWatching.map((entry) => (
              <ContinueCard
                key={`${entry.title.type}/${entry.video.id}`}
                entry={entry}
                onOpen={() => openEntry(entry)}
              />
            ))}
          </div>
        </section>
      ) : null}

      {empty ? (
        <div className="rep-empty" data-testid="home-empty">
          <h2 className="rep-empty-title">
            {snapshot.addons.length === 0
              ? "No Addons are configured"
              : "No Catalogs are configured"}
          </h2>
          <p className="rep-empty-body">
            {snapshot.addons.length === 0
              ? "Tonight's program is drawn from the Catalogs Addons offer. Add an Addon to begin."
              : "The configured Addons offer no Catalogs, so the program has no sections to print. Choose an Addon that offers one."}
          </p>
          <button
            type="button"
            className="rep-button"
            data-focusable
            onClick={() => choose("addons")}
          >
            Open Addons
          </button>
        </div>
      ) : null}

      {visibleRows.map((row, index) => {
        const key = keyOf(row);
        const isAnswered = answered.has(key);
        return (
          <section
            className="rep-section"
            key={key}
            data-testid={`home-row-${key}`}
            data-region={`home-row:${key}`}
            data-kind="row"
            data-label={row.name}
          >
            <RowHead
              index={programIndex(index + sectionOffset)}
              title={row.name}
              tag={`${addonName(snapshot, row.addon) ?? row.addon} / ${countLabel(row.type, row.metas.length)}`}
            />
            {row.metas.length > 0 ? (
              <div className="rep-row-track">
                {row.metas.map((meta) => (
                  <ProgramPoster
                    key={meta.id}
                    meta={meta}
                    onOpen={() => openMeta(row.addon, meta)}
                  />
                ))}
                {pageable(snapshot, row) && !row.done ? (
                  <button
                    type="button"
                    className="rep-row-more"
                    data-focusable
                    disabled={paging.has(key)}
                    onClick={() => page(row)}
                  >
                    {paging.has(key) ? "Reading…" : "More"}
                  </button>
                ) : null}
              </div>
            ) : (
              <p className="rep-row-note" role={row.failure ? "alert" : undefined}>
                {row.failure
                  ? explain(row.failure)
                  : isAnswered
                    ? "The Addon answered with no Titles in this section."
                    : "Reading the program…"}
              </p>
            )}
          </section>
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
