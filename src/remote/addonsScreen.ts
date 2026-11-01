import { addOutcome, moveTarget, type AddOutcome } from "../core/addons";
import type { NewLevel } from "../core/navigation";
import type { Action, AddonManifest, Response } from "../core/wire";
import type { RemotePayload } from "./levels";

/**
 * The Addons screen's own decisions and words (#209, ADR-0035 §1).
 *
 * The readings are the core's: `addOutcome` says whether a pasted manifest was
 * a new Addon or one the Host already knew, `moveTarget` names the position a
 * Move press asks for, and `resourcesOf`/`catalogsOf` say how an Addon reads in
 * the register. What lives here is only what this screen decides — what the
 * form sends, which Action a row's control is, and the confirmation a Remove
 * press pushes.
 */

/** The form's one field, as its label, placeholder and submit control read. */
export const ADDON_FIELD_LABEL = "Addon manifest URL";
export const ADDON_FIELD_PLACEHOLDER = "https://example.com/manifest.json";
export const ADDON_SUBMIT = "Add";

/** Before the first Snapshot there is nothing honest to draw but the wait. */
export const ADDON_WAITING = "Waiting for the Host…";

/**
 * A Host with no Addon says so, and names the way on: the form beside the
 * register, never an empty list that reads like a screen still loading.
 */
export const ADDONS_EMPTY = {
  title: "The register is empty.",
  body: "No Addons are configured yet. Paste an Addon's manifest URL into the form to add the first one.",
} as const;

/**
 * The Action a submit asks for, or null where there is nothing to ask: an empty
 * or whitespace field is not a manifest, and the Host is never sent a guess.
 */
export function addRequest(value: string): Action | null {
  const url = value.trim();
  return url === "" ? null : { type: "add_addon", url };
}

/**
 * What a successful add did, read from the Snapshot its answer carried.
 *
 * `before` is the register at the moment of the press, so an Addon the Host
 * already knew reads as a refresh rather than as a failed add that cleared the
 * field. An answer with no Snapshot has nothing honest to say.
 */
export function addOutcomeAfter(
  before: readonly AddonManifest[],
  response: Response | null,
): AddOutcome | null {
  return addOutcome(before, response?.snapshots.at(-1)?.addons ?? null);
}

/**
 * The reorder a Move press asks for, or null where the row is already at that
 * end. The position is the core's `moveTarget`, never a second guess here.
 */
export function moveRequest(
  id: string,
  index: number,
  delta: -1 | 1,
  count: number,
): Action | null {
  const position = moveTarget(index, delta, count);
  return position === null ? null : { type: "reorder_addon", id, position };
}

/**
 * The confirmation a Remove press pushes. It carries data only — no closure —
 * so the level stack stays the core's and a confirm level is drawn by name.
 */
export function removeLevel(
  addon: Pick<AddonManifest, "id" | "name" | "catalogs">,
): NewLevel<RemotePayload> {
  const id = `confirm-remove-${addon.id}`;
  const title = `Remove ${addon.name}?`;

  return {
    id,
    name: title,
    kind: "overlay",
    payload: {
      kind: "confirm",
      confirm: {
        id,
        title,
        body: removeBody(addon),
        confirmLabel: "Remove",
        action: { type: "remove_addon", id: addon.id },
      },
    },
  };
}

/**
 * What removing an Addon costs, in the Host's own words. A Catalog the Addon
 * answered leaves Home; Watch progress already recorded is the Host's and stays.
 */
export function removeBody(addon: Pick<AddonManifest, "catalogs">): string {
  const rows = addon.catalogs.length > 0 ? " Its rows leave Home." : "";
  return `The Host stops asking this Addon for Catalogs, Meta previews and Streams.${rows} Watch progress already recorded stays in Continue watching.`;
}
