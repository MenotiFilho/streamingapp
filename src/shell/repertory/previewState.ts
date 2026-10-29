/**
 * The preview transport's pure readings.
 *
 * A plain Vite window has no Host, so the repertory prototype answers the
 * Actions those screens already take from a local state kept in the window.
 * Nothing here invents an Action: the list is the same `Action` union the Host
 * speaks, and these helpers only read a real Addon manifest into the shape the
 * Host publishes, and move a row the way `reorder_addon` names it.
 *
 * The functions are pure so the transport's behaviour can be tested without a
 * network or a browser.
 */

import type {
  ActionError,
  AddonCatalog,
  AddonManifest,
  AddonResource,
  DeviceSummary,
} from "../../host-client";

/** The sample address and code the preview draws. A real Host publishes its own. */
export const PREVIEW_ADDRESS = "192.168.1.24:8090";
export const PREVIEW_PAIRING_CODE = "K7M2RQ";

/**
 * Two devices so the paired list and its revoke control have something to
 * draw. They are named as samples and never leave this module.
 */
export const PREVIEW_DEVICES: readonly DeviceSummary[] = [
  {
    id: "preview-living-room",
    name: "Living room (preview)",
    pairedAt: Date.UTC(2026, 9, 28, 21, 40),
  },
  {
    id: "preview-study",
    name: "Study (preview)",
    pairedAt: Date.UTC(2026, 9, 29, 9, 12),
  },
];

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

function resource(value: unknown): AddonResource | null {
  if (typeof value === "string") {
    return value.trim() ? { name: value.trim(), types: null, idPrefixes: null } : null;
  }
  const held = record(value);
  if (!held || typeof held.name !== "string" || !held.name.trim()) {
    return null;
  }
  return {
    name: held.name.trim(),
    types: Array.isArray(held.types) ? strings(held.types) : null,
    idPrefixes: Array.isArray(held.idPrefixes) ? strings(held.idPrefixes) : null,
  };
}

function catalog(value: unknown): AddonCatalog | null {
  const held = record(value);
  if (
    !held ||
    typeof held.type !== "string" ||
    !held.type.trim() ||
    typeof held.id !== "string" ||
    !held.id.trim() ||
    typeof held.name !== "string"
  ) {
    return null;
  }
  const extra = Array.isArray(held.extra)
    ? held.extra.flatMap((entry) => {
        const prop = record(entry);
        if (!prop || typeof prop.name !== "string" || !prop.name.trim()) {
          return [];
        }
        return [
          {
            name: prop.name.trim(),
            isRequired: prop.isRequired === true,
            options: strings(prop.options),
            optionsLimit: typeof prop.optionsLimit === "number" ? prop.optionsLimit : 0,
          },
        ];
      })
    : [];
  return {
    type: held.type.trim(),
    id: held.id.trim(),
    name: held.name.trim(),
    extra,
  };
}

/**
 * Read one Addon manifest the way the Host does for the fields this window
 * publishes. A manifest without an id, a name or a version is refused with the
 * Host's `manifest` error, not silently repaired.
 */
export function manifestFrom(url: string, raw: unknown): AddonManifest {
  const held = record(raw);
  const fail = (detail: string): never => {
    throw { kind: "manifest", detail, url } satisfies ActionError;
  };
  if (!held) {
    return fail("the manifest is not a JSON object");
  }
  const id = typeof held.id === "string" ? held.id.trim() : "";
  const name = typeof held.name === "string" ? held.name.trim() : "";
  const version = typeof held.version === "string" ? held.version.trim() : "";
  if (!id) {
    return fail("the manifest is missing an id");
  }
  if (!name) {
    return fail("the manifest is missing a name");
  }
  if (!version) {
    return fail("the manifest is missing a version");
  }
  const hints = record(held.behaviorHints);
  return {
    id,
    name,
    version,
    resources: Array.isArray(held.resources)
      ? held.resources.flatMap((entry) => {
          const read = resource(entry);
          return read ? [read] : [];
        })
      : [],
    types: strings(held.types),
    catalogs: Array.isArray(held.catalogs)
      ? held.catalogs.flatMap((entry) => {
          const read = catalog(entry);
          return read ? [read] : [];
        })
      : [],
    idPrefixes: strings(held.idPrefixes),
    behaviorHints: {
      configurable: hints?.configurable === true,
      configurationRequired: hints?.configurationRequired === true,
    },
  };
}

/**
 * The list after `reorder_addon`, or null when the id or the position does not
 * name a row. The position is the 0-based index the Host's Action names.
 */
export function reorderedAddons(
  addons: readonly AddonManifest[],
  id: string,
  position: number,
): AddonManifest[] | null {
  const from = addons.findIndex((addon) => addon.id === id);
  if (from < 0 || !Number.isInteger(position) || position < 0 || position >= addons.length) {
    return null;
  }
  const next = addons.slice();
  const [moved] = next.splice(from, 1);
  if (!moved) {
    return null;
  }
  next.splice(position, 0, moved);
  return next;
}

/** The list after `remove_addon`, or null when the id names no row. */
export function removedAddon(
  addons: readonly AddonManifest[],
  id: string,
): AddonManifest[] | null {
  return addons.some((addon) => addon.id === id)
    ? addons.filter((addon) => addon.id !== id)
    : null;
}
