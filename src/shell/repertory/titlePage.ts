import type { MetaPreview, Title } from "../../host-client";
import { isSeries, releaseOf, seasonsOf, type Season } from "../../title";

/**
 * The Title page's programme decisions, kept out of the drawing (ADR-0032).
 *
 * A Title is one screen: the facts a person reads before deciding, the brass
 * Unmapped mark when no TMDB record met it, and what the right rail offers next
 * — a film's one action, or a series' seasons. What season is folded out and
 * which episode is chosen stay the client's own state; these helpers decide
 * what the page is, not what is open.
 */

/** One piece of the page's bookkeeping, in the record's printed order. */
export type TitleFact = {
  role: "rating" | "year" | "runtime" | "genre";
  text: string;
};

/**
 * The facts the programme page prints: IMDb, the year, the runtime, then the
 * Addon's genres. A fact the Host was not told is not printed, and the card a
 * person opened carries the year for a sparse meta answer (ADR-0011).
 */
export function titleFacts(
  title: Title,
  preview?: Partial<Pick<MetaPreview, "releaseInfo">> | null,
): TitleFact[] {
  const facts: TitleFact[] = [];
  const rating = title.imdbRating?.trim();
  if (rating) {
    facts.push({ role: "rating", text: `IMDb ${rating}` });
  }

  const year = releaseOf(title, preview)?.trim();
  if (year) {
    facts.push({ role: "year", text: year });
  }

  const runtime = title.runtime?.trim();
  if (runtime) {
    facts.push({ role: "runtime", text: runtime });
  }

  for (const genre of title.genres) {
    facts.push({ role: "genre", text: genre });
  }

  return facts;
}

/**
 * Whether the page stamps Unmapped: an Addon-keyed Title met no TMDB record, so
 * it is keyed by its Addon. The mark is a stamp, not an error — red stays
 * status-only (design record §9).
 */
export function unmappedOf(title: Title): boolean {
  return title.key.kind === "addon";
}

/**
 * What the right rail offers next: a film's one action, a series' season
 * index, or the honest note that a series listed no episodes (which must never
 * read as a film with one Video).
 */
export type TitleSide =
  | { kind: "film"; kicker: string; note: string }
  | { kind: "series"; seasons: Season[] }
  | { kind: "series-empty"; kicker: string; note: string };

export function titleSide(title: Title): TitleSide {
  if (!isSeries(title)) {
    return {
      kind: "film",
      kicker: "One Video · the film itself",
      note: "The film is one Video. Find the Addons' Streams for it.",
    };
  }

  const seasons = seasonsOf(title);
  if (seasons.length === 0) {
    return {
      kind: "series-empty",
      kicker: "A series with no episodes",
      note: "This series' Addon listed no episodes, so there is nothing to ask Streams of.",
    };
  }

  return { kind: "series", seasons };
}
