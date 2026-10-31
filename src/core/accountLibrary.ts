/**
 * The account Library's pure front-end readings.
 *
 * The Host's answer already carries the name, poster and order, so the window
 * only has to decide whether a card can open a Title with a configured Addon.
 * The rule mirrors the Host's `Manifest::answers` for the `meta` resource: the
 * resource's types, else the manifest's, and its own id prefixes where it
 * declares any.
 */

import type { AddonManifest, LibraryEntry } from "./wire";
import type { ActionError } from "./errors";
import type { OpenablePreview } from "./title";

/** The first configured Addon whose `meta` resource answers for this item. */
export function libraryAddon(
  addons: readonly AddonManifest[],
  entry: Pick<LibraryEntry, "id" | "type">,
): AddonManifest | null {
  return (
    addons.find((addon) => {
      const resource = addon.resources.find((held) => held.name === "meta");
      if (!resource) {
        return false;
      }
      const types = resource.types ?? addon.types;
      if (!types.includes(entry.type)) {
        return false;
      }
      const prefixes = resource.idPrefixes;
      return (
        prefixes === null ||
        prefixes.length === 0 ||
        prefixes.some((prefix) => entry.id.startsWith(prefix))
      );
    }) ?? null
  );
}

/** The preview a Library card carries into the Title screen. */
export function libraryPreview(entry: LibraryEntry): OpenablePreview {
  return {
    id: entry.id,
    type: entry.type,
    name: entry.name,
    poster: entry.poster,
  };
}

/**
 * Whether a read failed because the Stremio session is gone. The Host names
 * that refusal in its own words; the room's answer is the sign-in form again,
 * never an empty Library (ADR-0029).
 */
export function libraryExpired(failure: ActionError | null): boolean {
  return (
    failure?.kind === "library" &&
    (failure.detail ?? "").includes("Session does not exist")
  );
}
