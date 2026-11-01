import {
  declaredCatalogs,
  pageable,
  SKIP,
  type DeclaredCatalog,
  type Row,
} from "../core/browse";
import { MOVIE, type DiscoverKind } from "../core/discover";
import { rowTagOf } from "../core/homeProgramme";
import { SERIES } from "../core/title";
import type { Action, Snapshot } from "../core/wire";
import type { FeedPhase } from "./feed";

/**
 * Discover's own decisions and its own copy (#207, ADR-0035 §1).
 *
 * The genres, the ask and the feed are the core's (`discover.ts`); what lives
 * here is what only this screen says — the two kind chips, the words a feed
 * prints while it reads or comes back empty, the tag beside its head, and the
 * Catalog rows the screen draws where no TMDB Credential is held. The feed's
 * own paging decisions are `feed.ts`'s, because the search screen reads the
 * same rule rather than growing a second copy of it.
 */

/** The two kind chips, in the order a person reads them; Movie is where a person lands. */
export const DISCOVER_KINDS: ReadonlyArray<{ kind: DiscoverKind; label: string }> = [
  { kind: MOVIE, label: "Movie" },
  { kind: SERIES, label: "Series" },
];

/**
 * The chip that clears the genre filter: TMDB's whole weekly feed. The genre
 * chips after it are `genresOf(kind)` untouched — one list, never a curated
 * second one (design record §11).
 */
export const ALL_GENRES = "All genres";

/** A feed's head: the kind it holds, in the plural a rail prints. */
export function feedTitle(kind: DiscoverKind): string {
  return kind === MOVIE ? "Movies" : "Series";
}

/**
 * What Discover says where a feed is reading or came back empty. A failure is
 * the Host's own words through `explain`, so it is not here.
 */
export function discoverNote(
  phase: FeedPhase,
  genre: string | null,
): string | null {
  switch (phase) {
    case "reading":
      return "Reading the programme…";
    case "reading-more":
      return "Reading on…";
    case "empty":
      return genre
        ? `Nothing is screening under ${genre}. Choose another genre.`
        : "Nothing is screening in this feed.";
    default:
      return null;
  }
}

/** A feed's bookkeeping: the filter that made it, or Trending, and the count. */
export function discoverTag(
  kind: DiscoverKind,
  genre: string | null,
  count: number,
): string {
  return rowTagOf(genre ?? "Trending", kind, count);
}

/**
 * The Catalogs Discover draws where no TMDB Credential is held: every declared
 * Catalog of the kind a person chose, in the Addons' own order. They are the
 * only rows a Host with no credential can answer, and narrowing them to the
 * kind is what keeps the two chips meaningful in this arm too (ADR-0020).
 */
export function catalogsOf(
  snapshot: Snapshot | null,
  kind: DiscoverKind,
): DeclaredCatalog[] {
  return declaredCatalogs(snapshot).filter(
    ({ catalog }) => catalog.type === kind,
  );
}

/** The first page of one Catalog's row: no values, the Catalog in its own order. */
export function catalogAsk({ addon, catalog }: DeclaredCatalog): Action {
  return {
    type: "browse_catalog",
    addon,
    catalog: { type: catalog.type, id: catalog.id },
    extra: [],
  };
}

/**
 * The ask a row pages on by: the `skip` it has read to. A row that has read
 * nothing asks its first page again rather than `skip=0`, because a page that
 * failed before its first answer is retried, not paged past (`rowWith`).
 */
export function catalogPageAsk(row: Row): Action {
  return {
    type: "browse_catalog",
    addon: row.addon,
    catalog: { type: row.type, id: row.id },
    extra: row.offset > 0 ? [{ name: SKIP, value: String(row.offset) }] : [],
  };
}

/**
 * Whether a Catalog row has a page to ask for: the Catalog declares `skip`, and
 * the row has either read a page or failed one. A row that answered nothing is
 * done and offers no control (`rowWith`).
 */
export function catalogMore(snapshot: Snapshot | null, row: Row): boolean {
  return (
    !row.done &&
    pageable(snapshot, row) &&
    (row.offset > 0 || row.failure !== null)
  );
}

/**
 * The one line the no-credential arm prints above the Addons' own rows, so the
 * screen says what powers Discover rather than looking like a second Home
 * (CONTEXT.md, ADR-0020).
 */
export const NO_CREDENTIAL_NOTE =
  "Discover is TMDB's feed. With no TMDB Credential held, these are the Addons' own Catalogs.";

/** One empty state's words: what happened, and the way on. */
export type CatalogEmpty = { title: string; body: string };

/** What Discover says where no Addon offers a Catalog of the chosen kind. */
export function noCatalogState(kind: DiscoverKind): CatalogEmpty {
  return {
    title: "Nothing is screening in this kind.",
    body: `No configured Addon offers a ${
      kind === MOVIE ? "film" : "series"
    } Catalog. Add one in Addons, or look at the other kind.`,
  };
}

/**
 * The quiet line a Catalog row prints where its cards would be: that it is
 * still reading, or that it answered with nothing. A failure is the Host's
 * words through `explain`, and a row with cards has nothing to say.
 */
export function catalogNote(row: Row): string | null {
  if (row.failure || row.metas.length > 0) {
    return null;
  }
  return row.done
    ? "The Catalog answered with no Titles."
    : "Reading the programme…";
}
