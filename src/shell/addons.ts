/**
 * The Addons screen's pure readings.
 *
 * What a manifest offers, in the words the expanded row draws, and where a
 * Move control would put it. The order is the Host's; this module only says
 * which position a person's press names and when the press is a wall.
 */

import type { AddonManifest } from "../host-client";

/** A plain list of words, or the word that says there are none. */
export function joinOrNone(items: readonly string[]): string {
  return items.length > 0 ? items.join(", ") : "none";
}

/** The Addon's resources as a row reads them: `catalog (movie, series)`. */
export function resourcesOf(addon: AddonManifest): string {
  return joinOrNone(
    addon.resources.map((resource) =>
      resource.types && resource.types.length > 0
        ? `${resource.name} (${resource.types.join(", ")})`
        : resource.name,
    ),
  );
}

/** The Addon's Catalogs as a row reads them: `Top (movie)`. */
export function catalogsOf(addon: AddonManifest): string {
  return joinOrNone(
    addon.catalogs.map((catalog) => `${catalog.name} (${catalog.type})`),
  );
}

/**
 * The 0-based position a Move press asks for, or null when the row is already
 * at that end. `delta` is -1 for Move up and +1 for Move down.
 */
export function moveTarget(index: number, delta: -1 | 1, count: number): number | null {
  const target = index + delta;
  return target < 0 || target >= count ? null : target;
}
