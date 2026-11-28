/**
 * Pure decisions for Marquee's Home hero, following-focus mode, Continue
 * watching captions, empty state, and collapsible navigation rail (#358).
 *
 * Framework-free (`src/core` per ADR-0035 §1, ADR-0032): no React, no DOM,
 * no Motion imports. The window's components read these decisions and pass
 * them into the Marquee kit primitives.
 */

import type { Row } from "./browse";
import { heroArt, type HeroSlide } from "./home";
import type { InputModality } from "./inputModality";
import { resumable } from "./library";
import type { Action, ContinueEntry, MetaPreview, Snapshot } from "./wire";

/** How many Featured catalog items Marquee's rotating hero cycles through (`01.jpg`). */
export const MARQUEE_HERO_SLIDES = 5;

/** The two modes of the Home hero (`docs/design-system.md` §8). */
export type MarqueeHeroMode = "rotating" | "following";

/** What a focused row card tells the hero to display in following mode. */
export type HeroFocusTarget =
  | { kind: "continue"; entry: ContinueEntry }
  | { kind: "catalog"; addon: string; meta: MetaPreview };

/** What happens to the following-focus target when focus lands somewhere on Home. */
export type HeroFocusEvent =
  | { kind: "hero-action" }
  | { kind: "row-card"; target: HeroFocusTarget }
  | { kind: "rail" };

/** Resolved artwork and copy handed to the `Hero` kit primitive. */
export type HeroDisplay = {
  mode: MarqueeHeroMode;
  titleKey: string;
  name: string;
  logo: string | null;
  backdrop: string | null;
  poster: string | null;
  meta:
    | {
        rating: string | null;
        year: string | null;
        runtime: string | null;
        genres: readonly string[];
      }
    | undefined;
  synopsis: string | null;
};

/**
 * Whether the nav rail expands when one of its items takes focus (ADR-0037):
 * navigation focus reveals labels and dims the stage; pointer focus stays
 * collapsed so a click does not flare open.
 */
export function railOpensOn(modality: InputModality): boolean {
  return modality === "navigation";
}

/** Whether the nav rail is expanded right now. */
export function railShouldExpand(state: {
  hovered: boolean;
  focusedInRail: boolean;
  modality: InputModality;
}): boolean {
  if (state.hovered) {
    return true;
  }
  return state.focusedInRail && railOpensOn(state.modality);
}

/** Format the nav rail's foot clock in 24-hour `HH:MM` (`01.jpg`: `21:42`). */
export function formatNavClock(now: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
}

/** The first five items of the Featured catalog's row as Marquee hero slides. */
export function marqueeHeroSlides(metas: readonly MetaPreview[]): HeroSlide[] {
  return metas.slice(0, MARQUEE_HERO_SLIDES).map((meta) => {
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
 * Which mode the Home hero is in. Without a Featured catalog (or while its
 * Addon is disabled — ADR-0044 §2), no hero is drawn, so `heroModeForFocus`
 * stays `"rotating"` as the resting value and the caller omits the hero.
 */
export function heroModeForFocus(
  hasFeatured: boolean,
  target: HeroFocusTarget | null,
): MarqueeHeroMode {
  return hasFeatured && target !== null ? "following" : "rotating";
}

/**
 * Update the hero's following-focus target. Focusing a hero action returns to
 * rotating; focusing a row card switches to following that card; entering the
 * nav rail preserves whatever the hero was showing so the stage behind the
 * rail's dim does not jump.
 */
export function heroTransitionOnFocus(
  current: HeroFocusTarget | null,
  event: HeroFocusEvent,
): HeroFocusTarget | null {
  switch (event.kind) {
    case "hero-action":
      return null;
    case "row-card":
      return event.target;
    case "rail":
      return current;
  }
}

/**
 * Whether the rotating hero advances on its 15s timer. It rotates only when
 * more than one featured item exists, the hero is in `rotating` mode, and no
 * pointer gesture/press is holding it.
 */
export function heroRotatesInMode(
  slideCount: number,
  mode: MarqueeHeroMode,
  held: boolean,
): boolean {
  return slideCount > 1 && mode === "rotating" && !held;
}

/**
 * Whether pressing `Up` in the rows returns focus to the rotating hero's
 * actions: true when in `following` mode and currently on the topmost row that
 * holds focusable cards.
 */
export function shouldReturnToRotatingHero(state: {
  mode: MarqueeHeroMode;
  activeRowId: string | null;
  firstFocusableRowId: string | null;
}): boolean {
  return (
    state.mode === "following" &&
    state.activeRowId !== null &&
    state.activeRowId === state.firstFocusableRowId
  );
}

function findMatchingMeta(
  type: string,
  id: string,
  rows: readonly Row[],
): MetaPreview | null {
  for (const row of rows) {
    for (const meta of row.metas) {
      if (meta.type === type && meta.id === id) {
        return meta;
      }
    }
  }
  return null;
}

function findMatchingContinueLogo(
  type: string,
  id: string,
  continueWatching: readonly ContinueEntry[],
): string | null {
  const match = continueWatching.find(
    (entry) => entry.title.type === type && entry.title.id === id,
  );
  return match?.title.logo ?? null;
}

function landscapePoster(meta: MetaPreview): string | null {
  return meta.posterShape === "landscape" ? meta.poster : null;
}

/** Resolve the title, artwork, logo and facts the Hero renders. */
export function heroDisplayFor(params: {
  mode: MarqueeHeroMode;
  rotatingItem: MetaPreview | null;
  target: HeroFocusTarget | null;
  continueWatching: readonly ContinueEntry[];
  rows: readonly Row[];
}): HeroDisplay | null {
  const { mode, rotatingItem, target, continueWatching, rows } = params;

  if (mode === "following" && target !== null) {
    if (target.kind === "continue") {
      const { entry } = target;
      const matched = findMatchingMeta(entry.title.type, entry.title.id, rows);
      return {
        mode: "following",
        titleKey: `continue:${entry.title.type}:${entry.title.id}`,
        name: entry.title.name,
        logo: entry.title.logo ?? null,
        backdrop: entry.title.background ?? matched?.background ?? null,
        poster: matched ? landscapePoster(matched) : null,
        meta: matched
          ? {
              rating: matched.imdbRating,
              year: matched.releaseInfo,
              runtime: null,
              genres: matched.genres,
            }
          : undefined,
        synopsis: matched?.description ?? null,
      };
    }

    const { addon, meta } = target;
    return {
      mode: "following",
      titleKey: `catalog:${addon}:${meta.type}:${meta.id}`,
      name: meta.name,
      logo: findMatchingContinueLogo(meta.type, meta.id, continueWatching),
      backdrop: meta.background ?? null,
      poster: landscapePoster(meta),
      meta: {
        rating: meta.imdbRating,
        year: meta.releaseInfo,
        runtime: null,
        genres: meta.genres,
      },
      synopsis: meta.description,
    };
  }

  if (!rotatingItem) {
    return null;
  }

  return {
    mode: "rotating",
    titleKey: `featured:${rotatingItem.type}:${rotatingItem.id}`,
    name: rotatingItem.name,
    logo: findMatchingContinueLogo(rotatingItem.type, rotatingItem.id, continueWatching),
    backdrop: rotatingItem.background ?? null,
    poster: landscapePoster(rotatingItem),
    meta: {
      rating: rotatingItem.imdbRating,
      year: rotatingItem.releaseInfo,
      runtime: null,
      genres: rotatingItem.genres,
    },
    synopsis: rotatingItem.description,
  };
}

/**
 * What pressing **Watch now** on the rotating hero asks of the Host:
 * resume directly when the Title has a resumable Watch-progress entry, else
 * open its Title so Streams can be chosen.
 */
export type HeroWatchIntent =
  | { kind: "resume"; action: Extract<Action, { type: "resume" }> }
  | { kind: "open_title"; addon: string; preview: MetaPreview };

export function heroWatchIntent(
  meta: MetaPreview,
  addon: string,
  continueWatching: readonly ContinueEntry[],
): HeroWatchIntent {
  const match = continueWatching.find(
    (entry) =>
      entry.title.type === meta.type &&
      entry.title.id === meta.id &&
      resumable(entry) &&
      !entry.watched &&
      entry.position !== null,
  );
  if (match) {
    return {
      kind: "resume",
      action: {
        type: "resume",
        video: { type: match.title.type, id: match.video.id },
      },
    };
  }
  return { kind: "open_title", addon, preview: meta };
}

/** Format a whole duration in Marquee's short caption style (`31 min`, `1 h 51 min`). */
function formatShortDuration(seconds: number): string {
  const totalMinutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) {
    return `${minutes} min`;
  }
  if (minutes === 0) {
    return `${hours} h`;
  }
  return `${hours} h ${minutes} min`;
}

function episodeTagOf(entry: ContinueEntry): string | null {
  const { season, episode } = entry.video;
  if (season === null && episode === null) {
    return null;
  }
  const parts: string[] = [];
  if (season !== null) {
    parts.push(`S${season}`);
  }
  if (episode !== null) {
    parts.push(`E${episode}`);
  }
  return parts.join(" ");
}

/**
 * The secondary line under a Continue watching WideCard (`01.jpg`):
 * `S2 E3 · 31 min left`, `1 h 51 min left`, `S1 E5 · Up next`, or the
 * unplayable cause when its Addon is disabled or removed (ADR-0044 §2).
 */
export function wideCardNote(entry: ContinueEntry): string {
  const episode = episodeTagOf(entry);

  if (entry.unplayable) {
    const why =
      entry.unplayable.reason === "addon_disabled"
        ? "Unplayable · Addon disabled"
        : "Unplayable · Addon removed";
    return episode ? `${episode} · ${why}` : why;
  }

  let status: string;
  if (entry.upNext && entry.position === null) {
    status = "Up next";
  } else if (entry.watched) {
    status = "Watched";
  } else if (entry.position === null) {
    status = "Not started";
  } else if (entry.duration === null) {
    status = `${formatShortDuration(entry.position)} in`;
  } else {
    const remaining = Math.max(0, entry.duration - entry.position);
    status = `${formatShortDuration(remaining)} left`;
  }

  return episode ? `${episode} · ${status}` : status;
}

/** Empty state when Home has no declared Catalogs (`docs/design-system.md` §10). */
export type MarqueeHomeEmptyState = {
  title: string;
  body: string;
  action: "addons";
};

export function marqueeHomeEmptyState(
  snapshot: Snapshot | null,
  catalogCount: number,
): MarqueeHomeEmptyState | null {
  if (!snapshot || catalogCount > 0) {
    return null;
  }
  return snapshot.addons.length === 0
    ? {
        title: "No Addons configured",
        body: "Add an Addon to browse Catalogs on Home.",
        action: "addons",
      }
    : {
        title: "No Catalogs available",
        body: "Enable an Addon with a Catalog, or add one in Addons.",
        action: "addons",
      };
}
