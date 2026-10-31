/**
 * The printed-program decisions Home makes from the Host's data.
 *
 * Home still draws from the same two places it always did: the Featured
 * catalog's ordinary row and the Host's Watch progress. These helpers only say
 * how that data reads in the repertory programme — a caption's parts, how much
 * room a long feature title gets, and the date on the programme.
 */

import type { MetaPreview } from "../../core/wire";

/** The parts of a poster caption, in the order the programme prints them. */
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
 * A caption's three parts. A Meta preview carries no runtime, so the prototype
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

/** The two-digit index a programme uses beside a row or a destination. */
export function programIndex(index: number): string {
  return String(index).padStart(2, "0");
}

/** The bookkeeping a row head prints: where the row came from and its count. */
export function rowTagOf(source: string, type: string, count: number): string {
  return `${source} / ${countLabel(type, count)}`;
}
