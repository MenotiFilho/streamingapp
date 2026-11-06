/**
 * Home's programme decisions, and the programme arithmetic every screen prints.
 *
 * The feature's beat and its position, the section a row is numbered, the tag a
 * row's head carries, and the words an empty programme uses are rules both
 * clients share (ADR-0035 §1). They live in the core so a test asks the
 * decision rather than a rendered element (ADR-0032).
 *
 * The ten-foot rail's measurements are not here: how many cards a view holds is
 * the window's layout, and it stays with the window that draws it.
 */

import type { Row } from "./browse";
import { addonLabel } from "./home";
import type { Snapshot } from "./wire";

/** How long one feature holds before the programme moves on. */
export const FEATURE_ROTATION_MS = 24_000;

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

/** The feature's position in the programme: `01 / 04`, or one showing. */
export function featurePosition(index: number, count: number): string {
  return count > 1 ? `${programIndex(index + 1)} / ${programIndex(count)}` : "One showing";
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

/** Whether the feature's beat turns at all. */
export function featureRotates(count: number, reducedMotion: boolean): boolean {
  // ADR-0036 §2 supersedes the design record's "reduced motion stops it" for
  // this one component: the programme keeps turning, and reduced motion only
  // takes the change's movement away. The question is still asked here so the
  // exception is read, not discovered by a caller.
  void reducedMotion;
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
function clampItem(index: number, count: number): number {
  return Math.min(Math.max(0, Math.trunc(index)), Math.max(0, count - 1));
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

/** The bookkeeping a row head prints: where the row came from and its count. */
export function rowTagOf(source: string, type: string, count: number): string {
  return `${source} / ${countLabel(type, count)}`;
}
