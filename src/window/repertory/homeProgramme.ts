import type { Row } from "../../browse";
import type { Snapshot } from "../../host-client";
import { addonLabel } from "../home";
import { programIndex, rowTagOf } from "./program";
import { RAIL_PAGE, RAIL_VISIBLE } from "./rail";

/**
 * Home's programme decisions, kept out of the drawing (ADR-0032).
 *
 * The feature's beat, the one view of cards a row holds, the position the
 * kicker prints, and the words an empty programme uses are all rules. They live
 * here so a test asks the decision rather than a rendered element.
 */

/** How long one feature holds before the programme moves on. */
export const FEATURE_ROTATION_MS = 24_000;

/**
 * One view of a rail holds five whole cards and the half card that says there
 * is more. The half is where the right arrow sits, so the rail never ends on a
 * clipped card with nothing behind it.
 */
export const HOME_RAIL_VISIBLE = RAIL_VISIBLE;

/**
 * One arrow press moves five cards, card and gap together. The rail pages by
 * cards rather than by the viewport, so the half card at the edge never changes
 * the step and two presses read ten more cards, not ten and a sliver.
 */
export const HOME_RAIL_PAGE = RAIL_PAGE;

/**
 * The rail keeps its first twenty films even after the grid has read on. The
 * grid is the whole row; the rail is the programme's short list, and reading it
 * through the grid must not turn one row into an endless rail.
 */
export const HOME_RAIL_ITEMS = 20;

/**
 * The label a row's section head carries: the Addon a person reads it by and
 * the count it shows. The count is not a total — the Host never sends one — and
 * a rail prints its capped count while the grid prints the whole loaded row.
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
