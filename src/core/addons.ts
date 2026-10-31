/**
 * The Addons screen's pure readings.
 *
 * What a manifest offers, in the words the expanded row draws, and where a
 * Move control would put it. The order is the Host's; this module only says
 * which position a person's press names and when the press is a wall.
 */

import type { AddonManifest } from "./wire";

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

/** What an `add_addon` press did to the configured list. */
export type AddOutcome =
  | { kind: "added"; name: string }
  | { kind: "refreshed"; name: string | null };

/**
 * Read the Snapshot an add answered with: was this a new Addon, or a manifest
 * the Host already knew?
 *
 * An Addon is identified by its manifest id (ADR-0009), so re-adding one
 * reconfigures the entry in place. The form says which happened, because a
 * cleared field and an unchanged list otherwise read as a failed add.
 *
 * `after` is the Snapshot on the successful response; null means the answer
 * carried none and there is nothing honest to say.
 */
export function addOutcome(
  before: readonly AddonManifest[],
  after: readonly AddonManifest[] | null,
): AddOutcome | null {
  if (!after) {
    return null;
  }
  const known = new Map(before.map((addon) => [addon.id, addon]));
  const added = after.find((addon) => !known.has(addon.id));
  if (added) {
    return { kind: "added", name: added.name };
  }
  const changed = after.find((addon) => {
    const previous = known.get(addon.id);
    return previous !== undefined && JSON.stringify(previous) !== JSON.stringify(addon);
  });
  return { kind: "refreshed", name: changed?.name ?? null };
}

/**
 * What the form says after an add. A new Addon is named; a manifest the Host
 * already knew is a refresh, and saying so is what keeps a cleared field and an
 * unchanged list from reading as a failed add.
 */
export function addStatusText(outcome: AddOutcome): string {
  if (outcome.kind === "added") {
    return `${outcome.name} was added.`;
  }
  if (outcome.name) {
    return `That manifest is already configured as ${outcome.name}; the Host refreshed that Addon instead of adding a second one.`;
  }
  return "That manifest is already configured; the Host refreshed that Addon instead of adding a second one.";
}
