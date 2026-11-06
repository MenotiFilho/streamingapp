/**
 * Home's programme decisions, and the programme arithmetic every screen prints.
 *
 * The feature's programme and its drag, the section a row is numbered, the tag a
 * row's head carries, the caption a feature prints, and the words an empty
 * programme uses are rules both clients share (ADR-0035 §1). They live in the
 * core so a test asks the decision rather than a rendered element (ADR-0032).
 *
 * The ten-foot rail's measurements are not here: how many cards a view holds is
 * the window's layout, and it stays with the window that draws it.
 */

import type { Row } from "./browse";
import { addonLabel } from "./home";
import type { MetaPreview, Snapshot } from "./wire";

/** How long one feature holds before the programme moves on. */
export const FEATURE_ROTATION_MS = 24_000;

/**
 * How often the programme's clock is read while the feature is on screen.
 * Both clients read the same tick, so a paused fill and a beat agree to a
 * hundredth of a second (ADR-0036 §2).
 */
export const FEATURE_CLOCK_MS = 100;

/**
 * How far a horizontal drag or swipe travels before it steps one item. A
 * gesture that has not travelled this far, or that travelled further down than
 * across, is not the feature's: the page keeps it.
 */
export const FEATURE_DRAG_PX = 40;

/**
 * The label a row's section head carries: the Addon a person reads it by and
 * the count it shows. The count is not a total — the Host never sends one — and
 * a caller that draws a capped row passes its cap while one drawing the whole
 * row prints everything it has loaded.
 */
export function rowTag(snapshot: Snapshot | null, row: Row, limit?: number): string {
  const count = limit === undefined ? row.metas.length : Math.min(row.metas.length, limit);
  return rowTagOf(addonLabel(snapshot, row.addon), row.type, count);
}

/**
 * The slide a Left/Right press steps to, or null at an end. Null is the frame's
 * cue to leave the key alone: the focus engine still has to be able to cross
 * from the first slide into the spine. A beat that moves on by itself wraps
 * where a press does not, so it reads this and starts again at zero.
 */
export function featureStep(
  index: number,
  count: number,
  direction: -1 | 1,
): number | null {
  const next = index + direction;
  return next >= 0 && next < count ? next : null;
}

/**
 * The feature's programme: the item on screen, how much of its time has passed,
 * and whether a hand is holding it.
 *
 * The window and the served Remote steer the same programme (ADR-0036 §2). The
 * decisions — what a step, a tick, a drag, a hold and the beat do to the item
 * and its time — live here so a test asks the programme rather than a rendered
 * tick (ADR-0032).
 */
export type FeatureProgramme = {
  /** The item on screen. */
  index: number;
  /** How much of the item's time has passed, held stretches left out. */
  elapsed: number;
  /** Whether focus or a finger is holding the programme. */
  held: boolean;
};

/** A programme on its first item with the whole 24 seconds ahead of it. */
export const FEATURE_START: FeatureProgramme = { index: 0, elapsed: 0, held: false };

/**
 * Whether the feature's beat turns at all.
 *
 * ADR-0036 §2 supersedes the design record's "reduced motion stops it" for this
 * one component: the programme keeps turning, and reduced motion only takes the
 * change's movement away. The question is still asked here so a caller reads
 * that exception rather than discovering it.
 */
export function featureRotates(count: number): boolean {
  return count > 1;
}

/** Focus or a finger lands on the feature: the fill stops where it is. */
export function featureHold(programme: FeatureProgramme): FeatureProgramme {
  return programme.held ? programme : { ...programme, held: true };
}

/** The hand lets go: the fill carries on from where it stopped. */
export function featureRelease(programme: FeatureProgramme): FeatureProgramme {
  return programme.held ? { ...programme, held: false } : programme;
}

/**
 * The clock: spend `by` milliseconds on the current item. A held programme
 * spends nothing; when the item's time is up the programme wraps to the next
 * item and keeps the remainder. One item has nowhere to turn.
 */
export function featureElapse(
  programme: FeatureProgramme,
  count: number,
  by: number,
): FeatureProgramme {
  if (programme.held || count < 2 || by <= 0) {
    return programme;
  }
  const total = programme.elapsed + by;
  const moved = Math.floor(total / FEATURE_ROTATION_MS);
  const index = (clampItem(programme.index, count) + moved) % count;
  return { ...programme, index, elapsed: total - moved * FEATURE_ROTATION_MS };
}

/**
 * A step that wraps — a drag or a swipe takes it — restarting the item's time.
 * A keyboard press uses `featureStep` instead: at either end the focus engine
 * still has to be able to cross out of the feature.
 */
export function featureStepThrough(
  programme: FeatureProgramme,
  count: number,
  direction: -1 | 1,
): FeatureProgramme {
  const index = count > 0 ? (clampItem(programme.index, count) + direction + count) % count : 0;
  return { ...programme, index, elapsed: 0 };
}

/** A tick press: jump to the item it names and restart that item's time. */
export function featureJump(
  programme: FeatureProgramme,
  count: number,
  index: number,
): FeatureProgramme {
  return { ...programme, index: clampItem(index, count), elapsed: 0 };
}

/** How much of the current item's time has passed, from 0 to 1. */
export function featureProgress(programme: FeatureProgramme): number {
  const share = programme.elapsed / FEATURE_ROTATION_MS;
  return Math.min(1, Math.max(0, share));
}

/** One item's index, held inside a programme of `count` items. */
export function clampItem(index: number, count: number): number {
  return Math.min(Math.max(0, Math.trunc(index)), Math.max(0, count - 1));
}

/**
 * One gesture on the feature: where a hand landed and what it has done since.
 * The window's drag and the Remote's swipe are the same gesture, so the rule
 * that decides a step lives here rather than in either client's handler
 * (ADR-0035 §1, ADR-0036 §2).
 */
export type FeatureDrag = {
  active: boolean;
  x: number;
  y: number;
  /** Whether this gesture has already stepped the programme. */
  stepped: boolean;
};

/** A gesture that has not begun. */
export const FEATURE_DRAG_IDLE: FeatureDrag = {
  active: false,
  x: 0,
  y: 0,
  stepped: false,
};

/** A hand lands on the frame at a point. */
export function featureDragBegin(x: number, y: number): FeatureDrag {
  return { active: true, x, y, stepped: false };
}

/**
 * A hand moves: the direction it steps, if this gesture has travelled far
 * enough and travelled further across than down. A long gesture steps once —
 * `stepped` is set in the returned state, so the rest of its travel is spent.
 */
export function featureDragMove(
  drag: FeatureDrag,
  x: number,
  y: number,
): { drag: FeatureDrag; direction: -1 | 1 | null } {
  if (!drag.active || drag.stepped) {
    return { drag, direction: null };
  }
  const dx = x - drag.x;
  const dy = y - drag.y;
  if (Math.abs(dx) < FEATURE_DRAG_PX || Math.abs(dx) <= Math.abs(dy)) {
    return { drag, direction: null };
  }
  return { drag: { ...drag, stepped: true }, direction: dx < 0 ? 1 : -1 };
}

/** A hand lets go: the gesture is over, and a later move is not a step. */
export function featureDragEnd(drag: FeatureDrag): FeatureDrag {
  return drag.active ? { ...drag, active: false } : drag;
}

/**
 * What a click after a gesture means. A browser synthesises a click at the end
 * of a drag, and that click is the drag's — except for a keyboard activation,
 * which carries `detail === 0`. A keyboard click is never the drag's, and it
 * clears a step flag the drag left behind: a swipe that produced no click must
 * not swallow the next Enter (both clients).
 */
export function featureDragClick(
  drag: FeatureDrag,
  detail: number,
): { drag: FeatureDrag; ours: boolean } {
  if (!drag.stepped) {
    return { drag, ours: false };
  }
  return { drag: { ...drag, stepped: false }, ours: detail !== 0 };
}

/** A Home section's number, after the feature: Continue watching is 01 when it is drawn. */
export function homeSectionIndex(index: number, hasContinueWatching: boolean): string {
  return programIndex(index + (hasContinueWatching ? 2 : 1));
}

/** The words a programme with no Catalogs uses: one title, one line, one way out. */
export type HomeEmptyState = {
  title: string;
  body: string;
  action: "addons";
};

export function homeEmptyState(
  snapshot: Snapshot | null,
  catalogCount: number,
): HomeEmptyState | null {
  if (!snapshot || catalogCount > 0) {
    return null;
  }
  return {
    title: "Nothing is screening tonight.",
    body:
      snapshot.addons.length === 0
        ? "Add an Addon to open the programme."
        : "No Addon offers a Catalog to print.",
    action: "addons",
  };
}

/** The parts of a feature's or a poster's caption, in the order the programme prints them. */
export type CaptionParts = {
  year: string | null;
  rating: string | null;
  genres: string | null;
};

/** The rating as a programme reads it, or null when the Addon did not say. */
export function ratingOf(meta: Pick<MetaPreview, "imdbRating">): string | null {
  const rating = meta.imdbRating?.trim();
  return rating ? `IMDb ${rating}` : null;
}

/** The year the Addon published, trimmed of the range's trailing dash where one exists. */
export function yearOf(meta: Pick<MetaPreview, "releaseInfo">): string | null {
  const year = meta.releaseInfo?.trim().replace(/[–-]$/, "").trim();
  return year || null;
}

/**
 * A caption's three parts. A Meta preview carries no runtime, so the programme
 * prints year and rating and leaves runtime to the Titles that can tell it.
 */
export function captionParts(meta: MetaPreview): CaptionParts {
  const genres = meta.genres.slice(0, 2).join(" / ") || null;
  return {
    year: yearOf(meta),
    rating: ratingOf(meta),
    genres,
  };
}

/**
 * How much display type a feature title can carry. The research puts the
 * repertory hero at 72–96 px for a short name and 48–64 px for a long one;
 * these three bands are the prototype's reading of that rule.
 */
export function featureTitleDensity(name: string): "regular" | "long" | "very-long" {
  const length = name.trim().length;
  if (length <= 24) {
    return "regular";
  }
  return length <= 40 ? "long" : "very-long";
}

/** The two-digit index a programme uses beside a row or a destination. */
export function programIndex(index: number): string {
  return String(index).padStart(2, "0");
}

/** The count a row prints at its right end, e.g. `49 films`. */
export function countLabel(type: string, count: number): string {
  if (type === "movie") {
    return `${count} ${count === 1 ? "film" : "films"}`;
  }
  if (type === "series") {
    return `${count} ${count === 1 ? "series" : "series"}`;
  }
  return `${count} ${count === 1 ? "title" : "titles"}`;
}

/** Continue watching's bookkeeping: the entries the Host holds, one phrase. */
export function continueTag(count: number): string {
  return `${count} in progress`;
}

/** The bookkeeping a row head prints: where the row came from and its count. */
export function rowTagOf(source: string, type: string, count: number): string {
  return `${source} / ${countLabel(type, count)}`;
}
