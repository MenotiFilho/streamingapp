import { blankFeed, type DiscoverFeed } from "../core/discover";
import { SEARCH_KINDS, type SearchKind } from "../core/search";
import type { CatalogRow } from "../core/wire";
import type { FeedPhase } from "./feed";

/**
 * Search's own decisions and its own copy (#207, ADR-0035 §1).
 *
 * The two kinds and the ask are the core's (`search.ts`), and a search page is
 * a `DiscoverRow` by the core's own type, so the feed is folded and paged by
 * `feedWith` and the feed's phase. What lives here is what only this screen
 * says: the query a submit actually asks, the two blank rows a keyed query
 * fills, the words a row prints, and the kind a keyless answer is narrowed to.
 */

/** The label the core gives one kind's row: `Movies` and `Series`. */
export function kindLabel(kind: SearchKind): string {
  return SEARCH_KINDS.find(({ kind: held }) => held === kind)?.label ?? "Movies";
}

/**
 * The kind in the two cases a line prints it: `Movie`/`Series` for a Catalog's
 * own name for itself, and the lower-case plural for what matched nothing.
 */
function kindWords(kind: SearchKind): { one: string; many: string } {
  return kind === "movie"
    ? { one: "Movie", many: "movies" }
    : { one: "Series", many: "series" };
}

/** The two feeds a keyed query is answered with, one per kind, both blank. */
export function blankFeeds(): Record<SearchKind, DiscoverFeed> {
  return { movie: blankFeed(), series: blankFeed() };
}

/**
 * The query a submit asks, or null when there is nothing to ask.
 *
 * The bar submits and never asks per keystroke, so an empty or blank field is
 * not a question about every Title in the world: it sends nothing at all.
 */
export function queryOf(draft: string): string | null {
  const query = draft.trim();
  return query.length === 0 ? null : query;
}

/** The field's hint, which differs by the arm the Host's credential picks. */
export function searchPlaceholder(keyed: boolean): string {
  return keyed
    ? "Search TMDB for a film or a series"
    : "Search the Addons' searchable Catalogs";
}

/**
 * The rows a keyless Search draws for the kind a person chose. The Host answers
 * one row per searchable Catalog, in its configured order; the screen shows one
 * kind at a time behind the two chips (ADR-0010's amendment).
 */
export function rowsForKind(
  rows: readonly CatalogRow[],
  kind: SearchKind,
): CatalogRow[] {
  return rows.filter((row) => row.type === kind);
}

/** The one line a keyed kind prints when nothing matched the query. */
export function noMatches(kind: SearchKind, query: string): string {
  return `No ${kindWords(kind).many} matched “${query}”.`;
}

/** What a keyed row is doing, in the words its line prints; null while it has cards. */
export function searchNote(
  phase: FeedPhase,
  kind: SearchKind,
  query: string,
): string | null {
  switch (phase) {
    case "reading":
      return `Looking for ${kindWords(kind).many}…`;
    case "reading-more":
      return `Looking for more ${kindWords(kind).many}…`;
    case "empty":
      return noMatches(kind, query);
    default:
      return null;
  }
}

/** The one line a keyless Search prints while its single ask is out. */
export const CATALOGS_READING = "Searching every searchable Catalog…";

/** The one line a keyless Search prints when no Catalog can be searched at all. */
export const NO_SEARCHABLE_CATALOGS =
  "No Addon offers a Catalog that can be searched.";

/** The one line a keyless Search prints when no Catalog of the chosen kind answered. */
export function kindEmpty(kind: SearchKind, query: string): string {
  return `No ${kindWords(kind).one} Catalog answered “${query}”.`;
}

/**
 * What one keyless Catalog's own row says where its cards would be. A refusal
 * is the Host's words through `explain`, so it is not here.
 */
export function rowNote(row: CatalogRow): string | null {
  if (row.failure) {
    return null;
  }
  if (row.sent === 0) {
    return "This Catalog answered with no match.";
  }
  if (row.metas.length === 0) {
    return "This Catalog sent items the Host could not read.";
  }
  return null;
}
