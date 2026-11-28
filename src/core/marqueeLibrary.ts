/**
 * Pure decisions for Marquee Library (`17.jpg`, `17b.jpg`):
 * All / Movies / Series filter chips, watched & progress marks on Library cards,
 * and signed-out / empty-state copy.
 *
 * Framework-free (`src/core` per ADR-0035 §1, ADR-0032).
 */

import { MOVIE } from "./discover";
import { SERIES } from "./title";
import type { LibraryEntry, ResumeEntry } from "./wire";

export type LibraryFilter = "all" | typeof MOVIE | typeof SERIES;

export const LIBRARY_FILTERS: ReadonlyArray<{ id: LibraryFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: MOVIE, label: "Movies" },
  { id: SERIES, label: "Series" },
];

/** Filter the account Library entries while preserving the Host's `_mtime` order. */
export function filterLibraryEntries(
  entries: readonly LibraryEntry[],
  filter: LibraryFilter,
): LibraryEntry[] {
  if (filter === "all") {
    return [...entries];
  }
  return entries.filter((entry) => entry.type === filter);
}

/** Whether a Library film is marked watched in the Host's Watch progress. */
export function libraryEntryWatched(
  entry: Pick<LibraryEntry, "id" | "type">,
  watchProgress: readonly ResumeEntry[],
): boolean {
  if (entry.type !== MOVIE) {
    return false;
  }
  return watchProgress.some(
    (progress) =>
      progress.watched &&
      progress.title.type === MOVIE &&
      progress.title.id === entry.id,
  );
}

/**
 * Fractional progress (0–1) for a Library poster card's bottom bar, or null
 * when watched or unstarted (`17.jpg`: watched posters omit the bar).
 */
export function libraryEntryProgress(
  entry: Pick<LibraryEntry, "position" | "duration">,
  watched: boolean,
): number | null {
  if (watched || entry.position === null || entry.duration === null || entry.duration <= 0) {
    return null;
  }
  return Math.max(0, Math.min(1, entry.position / entry.duration));
}

export const LIBRARY_SUBTITLE = "From your Stremio account";

export const LIBRARY_SIGNED_OUT_BODY =
  "Your Library holds the Titles saved in your Stremio account. Sign in to Stremio to read the account's collection.";

/** Empty-state copy for the Library screen or an empty filter slice. */
export function libraryEmptyCopy(filter: LibraryFilter): {
  title: string;
  body: string;
  canReset: boolean;
} {
  switch (filter) {
    case MOVIE:
      return {
        title: "No movies in your Library",
        body: "Movies saved in your Stremio account will appear here.",
        canReset: true,
      };
    case SERIES:
      return {
        title: "No series in your Library",
        body: "Series saved in your Stremio account will appear here.",
        canReset: true,
      };
    case "all":
      return {
        title: "Nothing in your Library yet",
        body: "Titles saved in your Stremio account will appear here.",
        canReset: false,
      };
  }
}
