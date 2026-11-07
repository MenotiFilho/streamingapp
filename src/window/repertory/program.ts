/**
 * The printed-program decisions Home makes from the Host's data.
 *
 * Home still draws from the same two places it always did: the Featured
 * catalog's ordinary row and the Host's Watch progress. These helpers only say
 * how that data reads in the repertory programme — a caption's parts, how much
 * room a long feature title gets, and the date on the programme.
 */

/**
 * The programme's index and its row-tag arithmetic now live in the client core,
 * beside Home's decisions, because the Remote prints the same tag and the same
 * feature caption (ADR-0035 §1). They are re-exported here so this window's
 * screens keep importing the module they always have.
 */
export {
  captionParts,
  countLabel,
  featureTitleDensity,
  programIndex,
  ratingOf,
  rowTagOf,
  yearOf,
} from "../../core/homeProgramme";
export type { CaptionParts } from "../../core/homeProgramme";

/** The programme's date, as a repertory bill would print it: `Thursday 29 October`. */
export function programDate(now: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(now);
}

/** The same date where the frame has one narrow column: `Thu 29 Oct`. */
export function programShortDate(now: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(now);
}

/** The house clock, in the mono face: `21:41`. */
export function programTime(now: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
}
