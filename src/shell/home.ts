/**
 * The Home model: what the Featured catalog draws a hero from, and which art a
 * Continue watching card prefers.
 *
 * Home is drawn from two places, and neither is a new Host call: the Host's
 * `featuredCatalog` preference names one configured Catalog, and Home reads the
 * first items of that Catalog's ordinary `browse_catalog` answer; Continue
 * watching is the Host's Watch progress directly on the Snapshot. The decisions
 * here are pure so the fallbacks are tested without a page.
 */

import type { MetaPreview, ResumeEntry, Snapshot } from "../host-client";
import type { Row } from "../browse";
import type { OpenablePreview } from "../title";

/** How many of the Featured catalog's first items a hero shows (#52). */
export const HERO_SLIDES = 4;

/** Where a slide's billboard art came from, which is also what a test reads. */
export type HeroArtKind = "background" | "landscape" | "text";

/** One hero slide, drawn from a Catalog item. */
export type HeroSlide = {
  id: string;
  type: string;
  name: string;
  description: string | null;
  /** The 16:9 billboard art, or null for a text slide. */
  art: string | null;
  artKind: HeroArtKind;
  /** The item's own poster, kept even when the hero does not use it. */
  poster: string | null;
  /** The item's own backdrop, kept for the Title a press opens. */
  background: string | null;
};

/**
 * The art a hero may use for one item: its backdrop, else a landscape poster,
 * else nothing. An ordinary 2:3 poster is never stretched into the hero — a
 * text slide with the name and description is the honest fallback (#59).
 */
export function heroArt(meta: MetaPreview): { art: string | null; kind: HeroArtKind } {
  if (meta.background) {
    return { art: meta.background, kind: "background" };
  }
  if (meta.posterShape === "landscape" && meta.poster) {
    return { art: meta.poster, kind: "landscape" };
  }
  return { art: null, kind: "text" };
}

/**
 * What a card knows before the Host answers `open_title`: the same identity and
 * art every card carries into the Title screen (ADR-0011), under Home's name.
 */
export type HomeCard = OpenablePreview;

/** The first four items of the Featured catalog's row as hero slides. */
export function heroSlides(metas: readonly MetaPreview[]): HeroSlide[] {
  return metas.slice(0, HERO_SLIDES).map((meta) => {
    const fallback = heroArt(meta);
    return {
      id: meta.id,
      type: meta.type,
      name: meta.name,
      description: meta.description,
      art: fallback.art,
      artKind: fallback.kind,
      poster: meta.poster,
      background: meta.background ?? null,
    };
  });
}

/**
 * The Featured catalog's row, once Home has its answer. The preference names
 * the Addon as well as the Catalog because a catalog id is only unique within
 * the Addon that declared it.
 */
export function featuredRow(snapshot: Snapshot | null, rows: readonly Row[]): Row | null {
  const featured = snapshot?.featuredCatalog;
  if (!featured) {
    return null;
  }
  return (
    rows.find(
      (row) =>
        row.addon === featured.addon &&
        row.type === featured.catalog.type &&
        row.id === featured.catalog.id,
    ) ?? null
  );
}

/** A Continue watching card's 16:9 art: the card's backdrop, else its poster. */
export function continueArt(entry: ResumeEntry): string | null {
  return entry.title.background ?? entry.title.poster ?? null;
}

/** The Addon a Catalog row belongs to, as a person reads it in the row's tag. */
export function addonName(snapshot: Snapshot | null, addon: string): string | null {
  return snapshot?.addons.find((held) => held.id === addon)?.name ?? null;
}
