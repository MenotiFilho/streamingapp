import {
  DISCOVER_GENRES,
  discoverAsk,
  discoverNoCounterpart,
  type DiscoverGenreChoice,
  type DiscoverFeed,
  type DiscoverKind,
  type DiscoverSource,
  type FeedState,
  type GenreFilter,
} from "../../core/discover";
import type { Action } from "../../core/wire";
import { CINEMETA_MOVIE_GENRES, CINEMETA_SERIES_GENRES, PREVIEW_ADDON } from "./preview";
import { rowTagOf } from "./program";

/**
 * The editorial feed's decisions, kept out of the drawing (ADR-0032).
 *
 * Discover and Search draw one row per feed with Home's rail anatomy. What lives
 * here is what only the window says — the preview's stand-in genres and asks,
 * what a row's bookkeeping prints, and the words an empty feed uses. The kinds,
 * the genre filter, the feed key, the pages a screen reads and the feed's state
 * are the core's (`discover.ts`, `search.ts`), shared with the Remote.
 */

/**
 * Discover's one genre row in the window's own vocabulary: TMDB's union where
 * the Host answers, Cinemeta's own names in the preview. All genres is the chip
 * that clears the filter and is drawn apart, so it is not one of these.
 */
export function genresFor(
  source: DiscoverSource,
): DiscoverGenreChoice<number | string>[] {
  if (source === "preview") {
    const films: ReadonlySet<string> = new Set(CINEMETA_MOVIE_GENRES);
    return CINEMETA_SERIES_GENRES.map((name) => ({
      name,
      movie: films.has(name) ? name : null,
      series: name,
      all: false,
    }));
  }
  return DISCOVER_GENRES.filter((genre) => !genre.all).map((genre) => ({
    name: genre.name,
    movie: genre.movie,
    series: genre.series,
    all: false,
  }));
}

/**
 * The preview's stand-in for a Discover page: Cinemeta's Popular catalogue,
 * narrowed by its own genre name and paged by `skip`. The plain Vite window has
 * no TMDB Credential, so this is the same editorial feed drawn from the one
 * public catalogue it can read; the Tauri window asks `discover`.
 */
export function previewDiscoverAsk(
  kind: DiscoverKind,
  genre: string | null,
  skip: number,
): Action {
  return {
    type: "browse_catalog",
    addon: PREVIEW_ADDON,
    catalog: { type: kind, id: "top" },
    extra: [
      ...(genre === null ? [] : [{ name: "genre", value: genre }]),
      ...(skip > 0 ? [{ name: "skip", value: String(skip) }] : []),
    ],
  };
}

/** One page a Discover row is asked for, under the genre the person chose. */
export type DiscoverPageAsk = {
  source: DiscoverSource;
  kind: DiscoverKind;
  filter: GenreFilter<number | string>;
  page: number;
  skip: number;
};

/**
 * The Action that asks one row's page, or null where the chosen genre has no
 * counterpart in that kind: such a row is drawn empty and asks nothing, because
 * an ask without the genre would answer the unfiltered feed instead.
 */
export function discoverPageAsk(page: DiscoverPageAsk): Action | null {
  if (page.filter.kind === "none") {
    return null;
  }
  const value = page.filter.kind === "id" ? page.filter.id : null;
  return page.source === "preview"
    ? previewDiscoverAsk(
        page.kind,
        typeof value === "string" ? value : null,
        page.skip,
      )
    : discoverAsk({
        kind: page.kind,
        page: page.page,
        genre: typeof value === "number" ? value : null,
      });
}

/**
 * A row's bookkeeping as it is drawn: Reading before its first answer, then its
 * filter and count. A row with no counterpart has no feed and so no tag.
 */
export function discoverRowTag(
  feed: DiscoverFeed,
  kind: DiscoverKind,
  genre: DiscoverGenreChoice<number | string> | null,
  filter: GenreFilter<number | string>,
): string | null {
  if (filter.kind === "none") {
    return null;
  }
  if (feed.page === 0 && !feed.failure) {
    return "Reading";
  }
  return rowTagOf(genre?.name ?? "Trending", kind, feed.items.length);
}

/**
 * What a row prints under its cards: why it cannot have any, or its state's
 * line. A failure is the Host's own words through `explain`, so it is not here.
 */
export function discoverRowNote(
  state: FeedState,
  kind: DiscoverKind,
  genre: DiscoverGenreChoice<number | string> | null,
  filter: GenreFilter<number | string>,
): string | null {
  if (filter.kind === "none" && genre !== null) {
    return discoverNoCounterpart(kind, genre.name);
  }
  switch (state) {
    case "reading":
      return "Reading the programme…";
    case "reading-more":
      return "Reading on…";
    case "empty":
      return discoverEmptyNote(genre);
    default:
      return null;
  }
}

/**
 * Discover with no TMDB Credential: the words the screen prints so it says what
 * powers it and where the key goes rather than disappearing (ADR-0020). The
 * copy is the state's rule, so it lives here and a test asks the seam.
 */
export type DiscoverNoKey = {
  title: string;
  body: string;
  action: string;
};

export function discoverNoKey(): DiscoverNoKey {
  return {
    title: "Discover is powered by TMDB",
    body:
      "TMDB supplies the weekly Trending feed and the genres it can be filtered by. Add a TMDB API key in Settings → Credentials to browse it.",
    action: "Open Settings → Credentials",
  };
}

/** The one line an empty Discover feed prints: what happened, and the way on. */
export function discoverEmptyNote(
  genre: DiscoverGenreChoice<number | string> | null,
): string {
  return genre
    ? `Nothing is screening under ${genre.name}. Choose another genre.`
    : "Nothing is screening in this feed.";
}
