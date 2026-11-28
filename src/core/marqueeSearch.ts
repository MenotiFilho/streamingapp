/**
 * Pure decisions for Marquee Search (`16.jpg`, ADR-0043 §4):
 * querying Addons' searchable Catalogs (`search_catalogs`) and TMDB
 * (`search` for Movies and Series) together, keeping Movies and Series
 * together in rows, and deriving row status copy.
 *
 * Framework-free (`src/core` per ADR-0035 §1, ADR-0032).
 */

import { feedMore, type DiscoverFeed, type FeedState } from "./discover";
import { SEARCH_KINDS, searchReads, type SearchFeedRead, type SearchKind } from "./search";
import type { CatalogRow } from "./wire";

export type MarqueeSearchPlan = {
  /** Always ask Addons' searchable Catalogs (Host skips disabled Addons). */
  catalogsQuery: string;
  /** Also ask TMDB Movies and Series when a TMDB Credential is held. */
  tmdbFeeds: SearchFeedRead[];
};

/**
 * Plan what Marquee Search asks for a committed query: Addons' searchable
 * Catalogs always, plus TMDB Movies and Series when `keyed` is true.
 */
export function marqueeSearchPlan(keyed: boolean, query: string): MarqueeSearchPlan {
  const tmdb = searchReads(keyed, query);
  return {
    catalogsQuery: query,
    tmdbFeeds: tmdb.arm === "keyed" ? tmdb.feeds : [],
  };
}

function catalogKindWord(type: string): string {
  if (type === "series") {
    return "series";
  }
  if (type === "movie") {
    return "movies";
  }
  return "titles";
}

function kindTitle(type: string): string {
  const known = SEARCH_KINDS.find((entry) => entry.kind === type)?.label;
  return known ?? `${type.charAt(0).toUpperCase()}${type.slice(1)}`;
}

/**
 * The titles of the Addons' Catalog rows, in row order (`16.jpg`): the kind, as
 * Cinemeta names its film and series Catalogs alike. The Catalog's name is added
 * only where one Addon answers with two rows of one kind.
 */
export function searchCatalogRowTitles(rows: readonly CatalogRow[]): string[] {
  const group = (row: CatalogRow) => JSON.stringify([row.addon, row.type]);
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(group(row), (counts.get(group(row)) ?? 0) + 1);
  }
  return rows.map((row) =>
    (counts.get(group(row)) ?? 0) > 1
      ? `${kindTitle(row.type)} \u00b7 ${row.name}`
      : kindTitle(row.type),
  );
}

/**
 * Whether a TMDB row offers **Read on**: it has a next page and no failure,
 * which has its own retry. A page that brought nothing readable still pages on.
 */
export function searchCanReadOn(feed: DiscoverFeed): boolean {
  return feedMore(feed) && !feed.failure;
}

/**
 * Status note for an Addon's searchable Catalog row when it returned no cards
 * (`16.jpg`: `No series match “hunger games”.`). Failures render via `AddonNotice`.
 */
export function searchCatalogRowNote(row: CatalogRow, query: string): string | null {
  if (row.failure) {
    return null;
  }
  if (row.sent === 0) {
    return `No ${catalogKindWord(row.type)} match \u201c${query}\u201d.`;
  }
  if (row.metas.length === 0) {
    return "This Catalog sent items the Host could not read.";
  }
  return null;
}

/** Status note for a TMDB Search row while reading or when empty. */
export function searchTmdbRowNote(
  feed: DiscoverFeed,
  state: FeedState,
  kind: SearchKind,
  query: string,
): string | null {
  const label = SEARCH_KINDS.find((entry) => entry.kind === kind)?.label.toLowerCase() ?? kind;
  switch (state) {
    case "reading":
      return `Looking for ${label}…`;
    case "reading-more":
      return `Looking for more ${label}…`;
    case "empty":
      return feed.items.length === 0 ? `No ${label} match \u201c${query}\u201d.` : null;
    default:
      return null;
  }
}

/** Initial prompt before a person submits a search query. */
export function searchPromptCopy(keyed: boolean): { title: string; body: string } {
  return {
    title: "Search for a Title",
    body: keyed
      ? "Search your Addons’ Catalogs and TMDB for movies and series."
      : "Search your Addons’ searchable Catalogs for movies and series.",
  };
}

/** Note when no configured enabled Addon offers a searchable Catalog. */
export function searchNoCatalogsNote(keyed: boolean): string | null {
  return keyed ? null : "No Addon offers a Catalog that can be searched.";
}
