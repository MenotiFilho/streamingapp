/**
 * Pure decisions for Marquee Discover (`14.jpg`, `14b.jpg`, `15.jpg`):
 * single-kind Type picker (ADR-0043 amendment to ADR-0036 §1), per-kind Genre
 * and Sort options passed to `discover` (with live Cinemeta fallback for the
 * plain-Vite rehearsal), filter reconciliation on Type switch, and empty/no-key
 * states.
 *
 * Framework-free (`src/core` per ADR-0035 §1, ADR-0032).
 */

import {
  MOVIE,
  discoverPlayable,
  genresOf,
  type DiscoverFeed,
  type DiscoverKind,
  type DiscoverSource,
  type FeedState,
} from "./discover";
import { SERIES } from "./title";
import type { Action, AddonManifest } from "./wire";

export type DiscoverTypeOption = {
  id: DiscoverKind;
  label: string;
};

/** The two kinds Discover switches between, one at a time (ADR-0043 §4). */
export const DISCOVER_TYPES: readonly DiscoverTypeOption[] = [
  { id: MOVIE, label: "Movies" },
  { id: SERIES, label: "Series" },
];

export type DiscoverSortKey = "popular" | "rating" | "newest" | "votes" | "title";

export type DiscoverSortOption = {
  id: DiscoverSortKey;
  label: string;
  /** TMDB `sort_by` value passed in `Action::Discover`, or `null` in preview. */
  sort: string | null;
  /** Preview Cinemeta catalog id used when `source === "preview"`. */
  previewCatalogId?: string;
};

const HOST_MOVIE_SORTS: readonly DiscoverSortOption[] = [
  { id: "popular", label: "Most popular", sort: "popularity.desc" },
  { id: "rating", label: "Highest rated", sort: "vote_average.desc" },
  { id: "newest", label: "Newest", sort: "primary_release_date.desc" },
  { id: "votes", label: "Most voted", sort: "vote_count.desc" },
  { id: "title", label: "Title (A–Z)", sort: "title.asc" },
];

const HOST_SERIES_SORTS: readonly DiscoverSortOption[] = [
  { id: "popular", label: "Most popular", sort: "popularity.desc" },
  { id: "rating", label: "Highest rated", sort: "vote_average.desc" },
  { id: "newest", label: "Newest", sort: "first_air_date.desc" },
  { id: "votes", label: "Most voted", sort: "vote_count.desc" },
  { id: "title", label: "Title (A–Z)", sort: "name.asc" },
];

const PREVIEW_SORTS: readonly DiscoverSortOption[] = [
  { id: "popular", label: "Most popular", sort: null, previewCatalogId: "top" },
  { id: "rating", label: "Highest rated", sort: null, previewCatalogId: "imdbRating" },
];

/**
 * Valid Sort choices for the active source and kind.
 * Host sorts map 1:1 to `tmdb.rs`'s per-kind `MOVIE_SORTS` / `TV_SORTS` enums.
 */
export function discoverSortOptions(
  source: DiscoverSource,
  kind: DiscoverKind,
): readonly DiscoverSortOption[] {
  if (source === "preview") {
    return PREVIEW_SORTS;
  }
  return kind === SERIES ? HOST_SERIES_SORTS : HOST_MOVIE_SORTS;
}

export const ALL_GENRES_OPTION_ID = "all";

export type DiscoverGenreOption = {
  id: string;
  label: string;
  tmdbId: number | null;
  previewName: string | null;
};

/**
 * Genre choices for the active source and single kind: `All genres` first,
 * followed by TMDB's list for that kind (or Cinemeta's genres in rehearsal).
 */
export function discoverGenreOptions(
  source: DiscoverSource,
  kind: DiscoverKind,
  previewGenres: readonly string[] = [],
): DiscoverGenreOption[] {
  const all: DiscoverGenreOption = {
    id: ALL_GENRES_OPTION_ID,
    label: "All genres",
    tmdbId: null,
    previewName: null,
  };
  if (source === "preview") {
    return [
      all,
      ...previewGenres.map((name) => ({
        id: name,
        label: name,
        tmdbId: null,
        previewName: name,
      })),
    ];
  }
  return [
    all,
    ...genresOf(kind).map((genre) => ({
      id: String(genre.id),
      label: genre.name,
      tmdbId: genre.id,
      previewName: null,
    })),
  ];
}

export type DiscoverFilterState = {
  kind: DiscoverKind;
  genreId: string;
  sortId: DiscoverSortKey;
};

export const INITIAL_DISCOVER_FILTERS: DiscoverFilterState = {
  kind: MOVIE,
  genreId: ALL_GENRES_OPTION_ID,
  sortId: "popular",
};

/**
 * Reconcile Genre and Sort when switching Type (`movie` <-> `series`).
 * Keeps selections that exist in the new kind (including semantic sorts like
 * `newest` -> `first_air_date.desc` / `primary_release_date.desc`), and resets
 * kind-specific genres (like `Horror` or `Kids`) back to `All genres`.
 */
export function reconcileDiscoverFilters(params: {
  nextKind: DiscoverKind;
  genreId: string;
  sortId: DiscoverSortKey;
  source: DiscoverSource;
  previewGenres?: readonly string[];
}): DiscoverFilterState {
  const genres = discoverGenreOptions(params.source, params.nextKind, params.previewGenres);
  const sorts = discoverSortOptions(params.source, params.nextKind);
  const keepGenre = genres.some((option) => option.id === params.genreId);
  const keepSort = sorts.some((option) => option.id === params.sortId);
  return {
    kind: params.nextKind,
    genreId: keepGenre ? params.genreId : ALL_GENRES_OPTION_ID,
    sortId: keepSort ? params.sortId : "popular",
  };
}

/** Session `FeedStore` key for one (source, kind, genre, sort) combination. */
export function marqueeDiscoverFeedKey(params: {
  source: DiscoverSource;
  kind: DiscoverKind;
  genreId: string;
  sortId: DiscoverSortKey;
}): string {
  return `marquee-discover/${params.source}/${params.kind}/${params.genreId}/${params.sortId}`;
}

export type MarqueeDiscoverRead = {
  key: string;
  first: Action;
  next: (row: { page: number; offset: number }) => Action;
};

/** Build the first and next-page Actions for the chosen Discover filters. */
export function marqueeDiscoverRead(params: {
  source: DiscoverSource;
  kind: DiscoverKind;
  genre: DiscoverGenreOption;
  sort: DiscoverSortOption;
  previewAddonId: string;
}): MarqueeDiscoverRead {
  const key = marqueeDiscoverFeedKey({
    source: params.source,
    kind: params.kind,
    genreId: params.genre.id,
    sortId: params.sort.id,
  });

  if (params.source === "preview") {
    const catalogId = params.sort.previewCatalogId ?? "top";
    const baseExtra = params.genre.previewName
      ? [{ name: "genre", value: params.genre.previewName }]
      : [];
    return {
      key,
      first: {
        type: "browse_catalog",
        addon: params.previewAddonId,
        catalog: { type: params.kind, id: catalogId },
        extra: baseExtra,
      },
      next: (row) => ({
        type: "browse_catalog",
        addon: params.previewAddonId,
        catalog: { type: params.kind, id: catalogId },
        extra: [
          ...baseExtra,
          ...(row.offset > 0 ? [{ name: "skip", value: String(row.offset) }] : []),
        ],
      }),
    };
  }

  const askPage = (page: number): Action => ({
    type: "discover",
    kind: params.kind,
    page,
    ...(params.genre.tmdbId === null ? {} : { genre: params.genre.tmdbId }),
    ...(params.sort.sort === null ? {} : { sort: params.sort.sort }),
  });

  return {
    key,
    first: askPage(1),
    next: (row) => askPage(row.page + 1),
  };
}

export type DiscoverNoKeyCopy = {
  title: string;
  body: string;
  actionLabel: string;
};

/** Copy for Discover when the Host holds no TMDB Credential (`15.jpg`). */
export function discoverNoKeyCopy(): DiscoverNoKeyCopy {
  return {
    title: "Discover needs a TMDB key",
    body: "Add your TMDB key in Settings → Credentials to browse TMDB’s catalogue here.",
    actionLabel: "Open Settings",
  };
}

/** Empty-result copy when Discover answers with zero items. */
export function discoverEmptyCopy(genre: DiscoverGenreOption): {
  title: string;
  body: string;
} {
  if (genre.id !== ALL_GENRES_OPTION_ID) {
    return {
      title: `Nothing in ${genre.label}`,
      body: "Choose another genre or sort to see more titles.",
    };
  }
  return {
    title: "Nothing is screening here",
    body: "TMDB returned no titles for this selection.",
  };
}

/** What the grid under the filters draws; a failure's notice is drawn beside it. */
export type DiscoverGridBody = "cards" | "loading" | "empty" | "read-on" | "none";

/**
 * Nothing is "empty" until the feed says so: before the first read there is
 * nothing to draw. A page that answered with no readable card leaves a feed that
 * can still page on, with no card for the grid's own paging to approach.
 */
export function discoverGridBody(feed: DiscoverFeed, state: FeedState): DiscoverGridBody {
  if (feed.items.length > 0) {
    return "cards";
  }
  if (state === "reading") {
    return "loading";
  }
  if (state === "empty") {
    return "empty";
  }
  return !feed.failure && feed.page > 0 && !feed.done ? "read-on" : "none";
}

/** Copy for a page that answered with nothing the Host could read. */
export function discoverReadOnCopy(): { title: string; body: string; actionLabel: string } {
  return {
    title: "Nothing to show yet",
    body: "This page held no titles the Host could read.",
    actionLabel: "Read on",
  };
}

/**
 * The unplayable mark of a TMDB card (ADR-0020): no configured Addon could ever
 * answer for its kind, or this client learned that none did. `addons` is `null`
 * before the Host's first Snapshot, which says nothing about the Addons.
 */
export function marqueeTmdbUnplayable(
  addons: readonly AddonManifest[] | null,
  kind: DiscoverKind,
  learned: ReadonlySet<string>,
  id: string,
): boolean {
  return (addons !== null && !discoverPlayable(addons, kind)) || learned.has(id);
}
