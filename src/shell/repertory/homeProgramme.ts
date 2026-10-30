import type { Snapshot } from "../../host-client";
import { programIndex } from "./program";

/**
 * Home's programme decisions, kept out of the drawing (ADR-0032).
 *
 * The feature's beat, the one view of cards a row holds, the position the
 * kicker prints, and the words an empty programme uses are all rules. They live
 * here so a test asks the decision rather than a rendered element.
 */

/** How long one feature holds before the programme moves on. */
export const FEATURE_ROTATION_MS = 24_000;

/** One view of Continue watching holds four 16:9 cards. */
export const HOME_CONTINUE_COLUMNS = 4;

/** One view of a Catalog row holds six posters, as the prototype measured. */
export const HOME_ROW_COLUMNS = 6;

/** The feature's position in the programme: `01 / 04`, or one showing. */
export function featurePosition(index: number, count: number): string {
  return count > 1 ? `${programIndex(index + 1)} / ${programIndex(count)}` : "One showing";
}

/**
 * The slide a Left/Right press steps to, or null at an end. Null is the frame's
 * cue to leave the key alone: the focus engine still has to be able to cross
 * from the first slide into the spine.
 */
export function featureStep(
  index: number,
  count: number,
  direction: -1 | 1,
): number | null {
  const next = index + direction;
  return next >= 0 && next < count ? next : null;
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
