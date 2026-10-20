/**
 * Search: the two kinds a query is asked by, and the pure ask the window draws
 * its keyed rows from.
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
 * TMDB, which is the question the Host judges and answers.
 */

import { MOVIE, type DiscoverKind } from "../discover";
import type { Action } from "../host-client";
import { SERIES } from "../title";

/** One of the two kinds TMDB's search is asked by, one row each. */
export type SearchKind = DiscoverKind;

/**
 * The rows the keyed arm always draws, in the order it draws them. There is no
 * kind toggle: a query is asked once per kind and both answers stand side by
 * side (ADR-0010's amendment).
 */
export const SEARCH_KINDS: ReadonlyArray<{ kind: SearchKind; label: string }> = [
  { kind: MOVIE, label: "Movies" },
  { kind: SERIES, label: "Series" },
];

/** One page of one kind: the query, the kind, and the 1-based page. */
export type SearchPage = {
  query: string;
  kind: SearchKind;
  page: number;
};

/**
 * The ask for one page. TMDB's answer is a `SearchRow` — the shape a
 * `DiscoverRow` is — and the Host judges the query and the page (ADR-0020).
 */
export function searchAsk({ query, kind, page }: SearchPage): Action {
  return { type: "search", query, kind, page };
}
