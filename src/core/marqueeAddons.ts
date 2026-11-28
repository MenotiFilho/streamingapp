/**
 * Marquee Addons screen decisions, kept out of the drawing (ADR-0032).
 *
 * All Addon metadata stays strictly within `AddonManifest` (ADR-0009, ADR-0044 §1):
 * no manifest URL, origin, domain, or background reachability state is ever
 * computed or exposed here.
 */

import { catalogsOf, joinOrNone, moveTarget, resourcesOf } from "./addons";
import type { Intent } from "./input";
import type { AddonManifest } from "./wire";

const RESOURCE_LABELS: Record<string, string> = {
  catalog: "catalogs",
  meta: "metadata",
  stream: "streams",
  subtitles: "subtitles",
};

const TYPE_LABELS: Record<string, string> = {
  movie: "movies",
  series: "series",
  tv: "tv",
  channel: "channels",
  anime: "anime",
};

function capitalize(word: string): string {
  return word.length > 0 ? `${word[0]!.toUpperCase()}${word.slice(1)}` : word;
}

/** Subtitle under the Addons screen title, or undefined when none are installed. */
export function addonsCountSubtitle(count: number): string | undefined {
  return count > 0 ? `${count} installed · asked in this order` : undefined;
}

/**
 * One-line summary of what an Addon serves for `AddonRow` (`Streams · movies, series`).
 * Derived strictly from `Manifest.resources` and `Manifest.types` (ADR-0044 §1).
 */
export function addonServesSummary(addon: AddonManifest): string {
  const seenResources = new Set<string>();
  const resources: string[] = [];
  for (const resource of addon.resources) {
    const raw = resource.name.trim();
    if (!raw) {
      continue;
    }
    const label = RESOURCE_LABELS[raw.toLowerCase()] ?? raw;
    if (!seenResources.has(label)) {
      seenResources.add(label);
      resources.push(resources.length === 0 ? capitalize(label) : label);
    }
  }

  const seenTypes = new Set<string>();
  const types: string[] = [];
  for (const type of addon.types) {
    const raw = type.trim();
    if (!raw) {
      continue;
    }
    const label = TYPE_LABELS[raw.toLowerCase()] ?? raw;
    if (!seenTypes.has(label)) {
      seenTypes.add(label);
      types.push(label);
    }
  }

  const serves = resources.length > 0 ? resources.join(", ") : "No resources";
  return types.length > 0 ? `${serves} · ${types.join(", ")}` : serves;
}

/**
 * Facts shown in the Addon details Level (`18d`, ADR-0044 §1):
 * only existing `Manifest` fields (`Version`, `Id`, `Serves`, `Types`, `Catalogs`).
 * Never includes URL, origin, or reachability (ADR-0009).
 */
export function addonDetailsFacts(
  addon: AddonManifest,
): ReadonlyArray<{ label: string; value: string }> {
  return [
    { label: "Version", value: addon.version },
    { label: "Id", value: addon.id },
    { label: "Serves", value: resourcesOf(addon) },
    { label: "Types", value: joinOrNone(addon.types) },
    { label: "Catalogs", value: catalogsOf(addon) },
  ];
}

/** Body copy for the Remove Addon confirmation, naming Host consequences. */
export function addonRemoveBody(addon: AddonManifest): string {
  const featured =
    addon.catalogs.length > 0
      ? " Its rows leave Home, and anything it was the Featured catalog for stops being featured."
      : "";
  return `The Host stops asking this Addon for Catalogs, Meta previews and Streams.${featured} Watch progress already recorded stays in Continue watching.`;
}

/**
 * Next 0-based position when stepping a moving Addon row up (`-1`) or down (`+1`),
 * or null if already at that end.
 */
export function addonReorderTarget(
  addons: readonly AddonManifest[],
  id: string,
  delta: -1 | 1,
): number | null {
  const index = addons.findIndex((addon) => addon.id === id);
  if (index < 0) {
    return null;
  }
  return moveTarget(index, delta, addons.length);
}

/**
 * How an Addon screen routes a spatial/pad intent while a row is in moving mode.
 * Returns `"up"` / `"down"` to reorder, `"consume"` to hold focus on the moving
 * row (at a wall or on left/right), or `null` when not moving.
 */
export function addonMovingIntent(
  intent: Intent,
  state: { moving: boolean; canMoveUp: boolean; canMoveDown: boolean },
): "up" | "down" | "consume" | null {
  if (!state.moving) {
    return null;
  }
  if (intent === "up") {
    return state.canMoveUp ? "up" : "consume";
  }
  if (intent === "down") {
    return state.canMoveDown ? "down" : "consume";
  }
  if (intent === "left" || intent === "right") {
    return "consume";
  }
  return null;
}
