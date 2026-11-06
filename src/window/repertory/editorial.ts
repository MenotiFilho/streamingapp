import {
  DISCOVER_GENRES,
  discoverAsk,
  MOVIE,
  type DiscoverFeed,
  type DiscoverKind,
} from "../../core/discover";
import type { Action } from "../../core/wire";
import { CINEMETA_MOVIE_GENRES, CINEMETA_SERIES_GENRES, PREVIEW_ADDON } from "./preview";
import { rowTagOf } from "./program";

/**
 * The editorial feed's decisions, kept out of the drawing (ADR-0032).
 *
 * Discover and Search draw one row per feed with Home's rail anatomy. These
 * helpers say which genres a surface offers, how the preview's stand-in is
 * asked, when a row can page on, what a row's bookkeeping prints, and the words
 * an empty feed uses. The asks themselves stay in `discover.ts` and `search.ts`.
 */

/** Where a feed's items come from: the Host's TMDB Actions, or the plain Vite preview. */
export type FeedSource = "host" | "preview";

/**
 * One chip of Discover's one genre row. `key` is the chip's identity; `movie`
 * and `series` are what each row is asked by in the source's own vocabulary —
 * TMDB's id where the Host answers, Cinemeta's name in the preview — or null
 * where that kind has no such genre (ADR-0036 §1).
 */
export type GenreChoice = {
  key: string;
  name: string;
  movie: number | string | null;
  series: number | string | null;
};

/** What a chosen genre asks one kind by: nothing, no counterpart, or a value. */
export type GenreAsk =
  | { kind: "all" }
  | { kind: "none" }
  | { kind: "value"; value: number | string };

const CINEMETA_FILMS: ReadonlySet<string> = new Set(CINEMETA_MOVIE_GENRES);

/**
 * Discover's one genre row: the union of the source's two lists, by name, in
 * the film list's order with the series-only names after it. All genres is the
 * chip that clears the filter and is drawn apart, so it is not one of these.
 */
export function genresFor(source: FeedSource): GenreChoice[] {
  if (source === "preview") {
    return CINEMETA_SERIES_GENRES.map((name) => ({
      key: name,
      name,
      movie: CINEMETA_FILMS.has(name) ? name : null,
      series: name,
    }));
  }
  return DISCOVER_GENRES.filter((genre) => !genre.all).map((genre) => ({
    key: genre.name,
    name: genre.name,
    movie: genre.movie,
    series: genre.series,
  }));
}

/**
 * What a chip asks one kind by. All genres filters nothing, which is not the
 * same answer as a kind with no counterpart: the latter draws its row empty
 * with a line saying so rather than asking the kind unfiltered (ADR-0036 §1).
 */
export function genreAsk(choice: GenreChoice | null, kind: DiscoverKind): GenreAsk {
  if (choice === null) {
    return { kind: "all" };
  }
  const value = kind === MOVIE ? choice.movie : choice.series;
  return value === null ? { kind: "none" } : { kind: "value", value };
}

/**
 * The preview's stand-in for a Discover page: Cinemeta's Popular catalogue,
 * narrowed by its own genre name and paged by `skip`. The plain Vite window has
 * no TMDB Credential, so this is the same editorial feed drawn from the one
 * public catalogue it can read; the Tauri window asks `discover`.
 */
export function previewDiscoverAsk(
  kind: DiscoverKind,
  genre: number | string | null,
  skip: number,
): Action {
  return {
    type: "browse_catalog",
    addon: PREVIEW_ADDON,
    catalog: { type: kind, id: "top" },
    extra: [
      ...(genre === null ? [] : [{ name: "genre", value: String(genre) }]),
      ...(skip > 0 ? [{ name: "skip", value: String(skip) }] : []),
    ],
  };
}

/** One page a Discover row is asked for, under the genre the person chose. */
export type DiscoverPageAsk = {
  source: FeedSource;
  kind: DiscoverKind;
  genre: GenreChoice | null;
  page: number;
  skip: number;
};

/**
 * The Action that asks one row's page, or null where the chosen genre has no
 * counterpart in that kind: such a row is drawn empty and asks nothing, because
 * an ask without the genre would answer the unfiltered feed instead.
 */
export function discoverPageAsk(page: DiscoverPageAsk): Action | null {
  const ask = genreAsk(page.genre, page.kind);
  if (ask.kind === "none") {
    return null;
  }
  const value = ask.kind === "value" ? ask.value : null;
  return page.source === "preview"
    ? previewDiscoverAsk(page.kind, value, page.skip)
    : discoverAsk({
        kind: page.kind,
        page: page.page,
        genre: typeof value === "number" ? value : null,
      });
}

/** Whether a feed has a page to ask for: the next one, or the failed one again. */
export function feedMore(feed: DiscoverFeed): boolean {
  return !feed.done && (feed.page > 0 || feed.failure !== null);
}

/** What a feed is doing, for the line a row prints under its cards. */
export type FeedState = "reading" | "reading-more" | "empty" | "ready" | "failed";

export function feedState(feed: DiscoverFeed, loading: boolean): FeedState {
  if (loading) {
    return feed.page === 0 ? "reading" : "reading-more";
  }
  if (feed.failure) {
    return "failed";
  }
  if (feed.done && feed.items.length === 0) {
    return "empty";
  }
  return "ready";
}

/** A Discover feed's bookkeeping: the filter that made it, or Trending, and the count. */
export function discoverTag(
  kind: DiscoverKind,
  genre: GenreChoice | null,
  count: number,
): string {
  return rowTagOf(genre?.name ?? "Trending", kind, count);
}

/**
 * A row's bookkeeping as it is drawn: Reading before its first answer, then its
 * filter and count. A row with no counterpart has no feed and so no tag.
 */
export function discoverRowTag(
  feed: DiscoverFeed,
  kind: DiscoverKind,
  genre: GenreChoice | null,
  ask: GenreAsk,
): string | null {
  if (ask.kind === "none") {
    return null;
  }
  if (feed.page === 0 && !feed.failure) {
    return "Reading";
  }
  return discoverTag(kind, genre, feed.items.length);
}

/**
 * Why a row is drawn empty: the chosen genre is one the source does not list
 * for that kind, and the row says so instead of hiding (ADR-0036 §1).
 */
export function discoverNoCounterpart(kind: DiscoverKind, genre: string): string {
  return `Nothing is screening here: ${genre} is not a ${
    kind === MOVIE ? "film" : "series"
  } genre.`;
}

/**
 * What a row prints under its cards: why it cannot have any, or its state's
 * line. A failure is the Host's own words through `explain`, so it is not here.
 */
export function discoverRowNote(
  state: FeedState,
  kind: DiscoverKind,
  genre: GenreChoice | null,
  ask: GenreAsk,
): string | null {
  if (ask.kind === "none" && genre !== null) {
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
export function discoverEmptyNote(genre: GenreChoice | null): string {
  return genre
    ? `Nothing is screening under ${genre.name}. Choose another genre.`
    : "Nothing is screening in this feed.";
}
