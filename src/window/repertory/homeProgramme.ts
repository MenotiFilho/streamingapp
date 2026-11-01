import { RAIL_PAGE, RAIL_VISIBLE } from "./rail";

/**
 * Home's ten-foot rail, and the shared programme decisions it re-exports.
 *
 * The beat, the feature's position, the section numbering, a row's tag and the
 * empty programme's words are the client core's now: both clients decide them
 * the same way, so the ticket that drew the Remote's Home moved them rather
 * than copying them (ADR-0035 §1). What stays here is how many cards a ten-foot
 * view holds and how far an arrow page moves, because that is this window's
 * layout and not a decision the Remote shares.
 */

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

export {
  FEATURE_ROTATION_MS,
  featurePosition,
  featureStep,
  homeEmptyState,
  homeSectionIndex,
  rowTag,
} from "../../core/homeProgramme";
export type { HomeEmptyState } from "../../core/homeProgramme";
