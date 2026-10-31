/**
 * The browse model: one row of a catalog, as the window is showing it, and the
 * pure decisions that go with it.
 *
 * A row's own state is local to the client, on purpose — what one client is
 * looking at must not move what another one is looking at (ADR-0005) — so paging
 * through a row here moves nothing on any other device and never travels as a
 * Snapshot.
 *
 * Nothing here decides *what a catalog needs*: the Host is the client of the
 * addon protocol, so it is the Host that fills in the values a catalog requires
 * and the Host that refuses a catalog it will not answer. This module only asks,
 * draws, and pages on (ADR-0010).
 */

import type { AddonCatalog, CatalogRow, Extra, MetaPreview, Snapshot } from "./wire";
import type { ActionError } from "./errors";

/** The `extra` a row is asked with to page on from where it has read to. */
export const SKIP = "skip";

/** One catalog row, as the window is showing it. */
export type Row = {
  addon: string;
  type: string;
  id: string;
  name: string;
  /** The items so far, in the Addon's own order, one of each id. */
  metas: MetaPreview[];
  /**
   * How far into the catalog the window has read: the `skip` for the next page.
   * It counts what the Addon sent rather than what is held, because an item the
   * Host could not read was still sent and the next page starts after it.
   */
  offset: number;
  failure: ActionError | null;
  /** Set when the last page brought nothing new, so there is no more to ask for. */
  done: boolean;
};

/** One catalog an Addon declares, whatever it is. */
export type DeclaredCatalog = { addon: string; catalog: AddonCatalog };

/** An Addon's catalogs, in the Addon's own order. */
export function declaredCatalogs(snapshot: Snapshot | null): DeclaredCatalog[] {
  if (!snapshot) {
    return [];
  }
  return snapshot.addons.flatMap((addon) =>
    addon.catalogs.map((catalog) => ({ addon: addon.id, catalog })),
  );
}

/** A row with nothing in it yet. */
export function blankRow({ addon, catalog }: DeclaredCatalog): Row {
  return {
    addon,
    type: catalog.type,
    id: catalog.id,
    name: catalog.name,
    metas: [],
    offset: 0,
    failure: null,
    done: false,
  };
}

/** The same row, with one answer folded into it. */
export function rowWith(row: Row, answer: CatalogRow): Row {
  const fresh = answer.failure
    ? []
    : answer.metas.filter((meta) => !row.metas.some((held) => held.id === meta.id));

  return {
    ...row,
    name: answer.name || row.name,
    failure: answer.failure,
    metas: [...row.metas, ...fresh],
    offset: row.offset + answer.sent,
    // A page that answered nothing, or nothing new, is the end of the row. A
    // page that *failed* is not the end: the row keeps its way to ask again,
    // which is what an Addon that went down and came back needs.
    done: answer.failure ? row.done : answer.sent === 0 || fresh.length === 0,
  };
}

/** A row for one of the answers a search came back with: one page, and no more. */
export function searchRow(answer: CatalogRow): Row {
  return {
    addon: answer.addon,
    type: answer.type,
    id: answer.id,
    name: answer.name,
    metas: answer.metas,
    offset: answer.sent,
    failure: answer.failure,
    done: true,
  };
}

/** How a row is named, by everything that identifies it and nothing else. */
export function keyOf(row: { addon: string; type: string; id: string }): string {
  return `${row.addon}/${row.type}/${row.id}`;
}

/** The same, for a catalog before it has been asked about. */
export function catalogKey({ addon, catalog }: DeclaredCatalog): string {
  return keyOf({ addon, type: catalog.type, id: catalog.id });
}

/** Whether a row can be paged on: its catalog offers `skip`. */
export function pageable(snapshot: Snapshot | null, row: Row): boolean {
  const catalog = snapshot?.addons
    .filter((addon) => addon.id === row.addon)
    .flatMap((addon) => addon.catalogs)
    .find((catalog) => catalog.id === row.id && catalog.type === row.type);

  return Boolean(catalog?.extra.some((prop) => prop.name === SKIP));
}

/**
 * Whether the Host refused to answer because the catalog is not one it can be
 * asked for on its own — a value it requires and its Addon offers no option for.
 *
 * The window asks about every catalog an Addon declares and lets the Host say
 * which ones it will not answer, rather than deciding for itself: the rule for
 * that is the Host's, and a second copy of it here is how the two would drift
 * (ADR-0010). A refusal of this kind is simply not a row.
 */
export function unaskable(error: ActionError): boolean {
  return error.kind === "extra" || error.kind === "unknown_catalog";
}

/** The values a row is asked with, once the Host has supplied the rest. */
export const NOTHING_CHOSEN: Extra[] = [];
