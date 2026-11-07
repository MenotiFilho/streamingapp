/**
 * Search: the two kinds a query is asked by, and the pure asks the window and
 * the Remote draw their keyed rows from.
 *
 * Search is key-gated (ADR-0010's amendment, ADR-0020). With a TMDB Credential
 * held it is TMDB's own two kinds — Movies and Series, always both, each paged
 * on its own — and with none it is every configured Addon's Catalogs that
 * declare `search`, in the order the Addons are configured. A hit from the
 * first arm is a Discovered Title; a hit from the second is an Addon's Title.
 *
 * Nothing here decides which Catalogs can answer a keyless search: that rule is
 * the Host's, and a second copy of it in the window is how the two would drift
 * (ADR-0010, `src/browse.ts`). This module only names what a person asked of
 * TMDB, and what a Search screen reads for it — both clients read the same
 * decision.
 */

import { DISCOVER_ROWS, type DiscoverKind } from "./discover";
import type { Action } from "./wire";

/** One of the two kinds TMDB's search is asked by, one row each. */
export type SearchKind = DiscoverKind;

/**
 * The two kinds the keyed arm asks, in the order it asks them. A query is asked
 * once per kind and both answers are held; every client draws both rows, Movies
 * then Series, with no kind chips (ADR-0010's amendment, ADR-0036 §1). The list
 * is Discover's, because a kind's label is the kind's, not the screen's.
 */
export const SEARCH_KINDS: ReadonlyArray<{ kind: SearchKind; label: string }> =
  DISCOVER_ROWS;

/** One page of one kind: the query, the kind, and the 1-based page. */
export type SearchPage = {
  query: string;
  kind: SearchKind;
  page: number;
};

/**
 * A Search feed's identity in the Session's feed store (#264). The query is
 * part of the key, so two queries keep their own pages and an answer to one
 * cannot land in the other; a return to a query finds its rows where it left.
 */
export function searchFeedKey(query: string, kind: SearchKind): string {
  return `search/${query}/${kind}`;
}

/**
 * The ask for one page. TMDB's answer is a `SearchRow` — the shape a
 * `DiscoverRow` is — and the Host judges the query and the page (ADR-0020).
 */
export function searchAsk({ query, kind, page }: SearchPage): Action {
  return { type: "search", query, kind, page };
}

/**
 * The query a submit asks, or null when there is nothing to ask.
 *
 * The bar submits and never asks per keystroke, so an empty or blank field is
 * not a question about every Title in the world: it sends nothing at all. One
 * copy for both clients, so the window's submit and the Remote's cannot drift.
 */
export function queryOf(draft: string): string | null {
  const query = draft.trim();
  return query.length === 0 ? null : query;
}

/** One keyed row a Search screen reads: its Session key and its first ask. */
export type SearchFeedRead = {
  kind: SearchKind;
  key: string;
  first: Action;
  next: (row: { page: number }) => Action;
};

/**
 * What a Search screen reads for a query: both TMDB kinds, or the one keyless
 * `search_catalogs` ask. The arm is the Host's fact, passed in; what each arm
 * reads is this decision, so the two Search screens cannot drift.
 */
export type SearchRead =
  | { arm: "keyed"; feeds: SearchFeedRead[] }
  | { arm: "catalogs"; query: string };

export function searchReads(keyed: boolean, query: string): SearchRead {
  if (!keyed) {
    return { arm: "catalogs", query };
  }
  return {
    arm: "keyed",
    feeds: SEARCH_KINDS.map(({ kind }) => ({
      kind,
      key: searchFeedKey(query, kind),
      first: searchAsk({ query, kind, page: 1 }),
      next: (row) => searchAsk({ query, kind, page: row.page + 1 }),
    })),
  };
}
