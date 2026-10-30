import {
  genresOf,
  MOVIE,
  type DiscoverFeed,
  type DiscoverKind,
} from "../../discover";
import type { Action } from "../../host-client";
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
 * One filter a row can be narrowed by. `key` is the chip's identity, `value` is
 * what travels: TMDB's genre id where the Host answers, Cinemeta's own name in
 * the preview, whose catalogue takes the word rather than the id.
 */
export type GenreChoice = {
  key: string;
  name: string;
  value: number | string;
};

/** The genre row for the kind a person is looking at, in the source's own order. */
export function genresFor(source: FeedSource, kind: DiscoverKind): GenreChoice[] {
  if (source === "preview") {
    const names = kind === MOVIE ? CINEMETA_MOVIE_GENRES : CINEMETA_SERIES_GENRES;
    return names.map((name) => ({ key: name, name, value: name }));
  }
  return genresOf(kind).map((genre) => ({
    key: String(genre.id),
    name: genre.name,
    value: genre.id,
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
  genre: GenreChoice | null,
  skip: number,
): Action {
  return {
    type: "browse_catalog",
    addon: PREVIEW_ADDON,
    catalog: { type: kind, id: "top" },
    extra: [
      ...(genre ? [{ name: "genre", value: String(genre.value) }] : []),
      ...(skip > 0 ? [{ name: "skip", value: String(skip) }] : []),
    ],
  };
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

/** A Discover row's bookkeeping: the filter that made it, or Trending, and the count. */
export function discoverTag(
  kind: DiscoverKind,
  genre: GenreChoice | null,
  count: number,
): string {
  return rowTagOf(genre?.name ?? "Trending", kind, count);
}

/** The one line an empty Discover feed prints: what happened, and the way on. */
export function discoverEmptyNote(genre: GenreChoice | null): string {
  return genre
    ? `Nothing is screening under ${genre.name}. Choose another genre.`
    : "Nothing is screening in this feed.";
}

/**
 * The rows a keyless Search draws for one kind. The Host answers one row per
 * searchable Catalog, in its configured order; the repertory surface shows one
 * kind at a time while still asking both.
 */
export function rowsForKind<T extends { type: string }>(
  rows: readonly T[],
  kind: DiscoverKind,
): T[] {
  return rows.filter((row) => row.type === kind);
}
