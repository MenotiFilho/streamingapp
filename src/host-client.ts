import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";

/**
 * The version of the Action wire form this client speaks.
 * Mirrors `ACTION_VERSION` in `host-core`.
 */
export const ACTION_VERSION = 1;

/** The event the Host publishes Snapshots on. Mirrors `SNAPSHOT_EVENT` in `src-tauri/src/ipc.rs`. */
export const SNAPSHOT_EVENT = "host://snapshot";

/** The Host's state as it travels outward. Mirrors `Snapshot` in `host-core`. */
export type Snapshot = {
  revision: number;
  preferences: { subtitleLanguage: string | null };
  addons: AddonManifest[];
};

/**
 * An Addon as the Host publishes it: what it says it offers, and never where its
 * manifest lives — a manifest URL can carry the Addon's credentials.
 * Mirrors `Manifest` in `host-core`.
 */
export type AddonManifest = {
  id: string;
  name: string;
  version: string;
  resources: AddonResource[];
  types: string[];
  catalogs: AddonCatalog[];
  idPrefixes: string[];
  behaviorHints: { configurable: boolean; configurationRequired: boolean };
};

/** One resource an Addon provides. Mirrors `Resource` in `host-core`. */
export type AddonResource = {
  name: string;
  types: string[] | null;
  idPrefixes: string[] | null;
};

/** One catalog an Addon offers. Mirrors `Catalog` in `host-core`. */
export type AddonCatalog = {
  type: string;
  id: string;
  name: string;
};

/** What a client can ask the Host to do. Mirrors `Action` in `host-core`. */
export type Action =
  | { type: "set_subtitle_language"; language: string }
  | { type: "clear_subtitle_language" }
  | { type: "add_addon"; url: string }
  | { type: "remove_addon"; id: string };

/**
 * The failures the Host itself reports. Mirrors the variants of `ActionError` in
 * `host-core`; the union below is derived from this list so the two cannot drift.
 */
export const HOST_ERROR_KINDS = [
  "malformed",
  "unsupported_version",
  "invalid_subtitle_language",
  "invalid_manifest_url",
  "invalid_addon_id",
  "manifest",
  "fetch",
  "unknown_addon",
  "store",
] as const;

/**
 * Why an Action was not taken, in the Host's own vocabulary, plus `unreachable`
 * for the failures that happen before the Host ever hears about it.
 */
export type ActionError = {
  kind: (typeof HOST_ERROR_KINDS)[number] | "unreachable";
  detail?: string;
  got?: number;
  supported?: number;
  language?: string;
  url?: string;
  id?: string;
};

/** Whatever a failed call threw, as something the window can explain. */
export function asActionError(caught: unknown): ActionError {
  if (typeof caught === "object" && caught !== null) {
    const kind = (caught as { kind?: unknown }).kind;
    if (
      typeof kind === "string" &&
      (HOST_ERROR_KINDS as readonly string[]).includes(kind)
    ) {
      return caught as ActionError;
    }
  }
  return { kind: "unreachable", detail: String(caught) };
}

/** A person-readable account of a rejected Action. */
export function explain(error: ActionError): string {
  switch (error.kind) {
    case "malformed":
      return `The Host could not read that Action${error.detail ? `: ${error.detail}` : ""}.`;
    case "unsupported_version":
      return `This window speaks version ${ACTION_VERSION} and the Host ${error.supported}; the Action carried version ${error.got}.`;
    case "invalid_subtitle_language":
      return `${JSON.stringify(error.language)} is not a subtitle language tag — try "pt-BR" or "en".`;
    case "invalid_manifest_url":
      return `${JSON.stringify(error.url)} is not a manifest URL — paste the address of an Addon's manifest.json, like "https://example.com/manifest.json".`;
    case "invalid_addon_id":
      return `${JSON.stringify(error.id)} is not an Addon id.`;
    case "manifest":
      return `The Host could not read that Addon's manifest${error.detail ? `: ${error.detail}` : ""}.`;
    case "fetch":
      return `The Host could not fetch that Addon${error.detail ? `: ${error.detail}` : ""}.`;
    case "unknown_addon":
      return `No Addon with the id ${JSON.stringify(error.id)} is configured.`;
    case "store":
      return `The Host could not save that change${error.detail ? `: ${error.detail}` : ""}.`;
    case "unreachable":
      return `The window could not reach the Host${error.detail ? `: ${error.detail}` : ""}.`;
  }
}

/**
 * How the window reaches the Host. The Tauri transport is the real one; a test
 * hands in its own so the window can be driven without a Host.
 */
export type Transport = {
  invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
  listen: <T>(
    event: string,
    handler: (event: { payload: T }) => void,
  ) => Promise<() => void>;
};

export const tauriTransport: Transport = {
  invoke: (command, args) => tauriInvoke(command, args),
  listen: (event, handler) => tauriListen(event, handler),
};

/**
 * The Host, as the window sees it.
 *
 * The window never decides what state is: it takes Actions and renders whatever
 * the Host publishes, which is the same door a remote client uses (ADR-0002).
 */
export class HostClient {
  constructor(private readonly transport: Transport = tauriTransport) {}

  /** The state as it stands — what a window that has just loaded is owed. */
  snapshot(): Promise<Snapshot> {
    return this.transport.invoke<Snapshot>("snapshot");
  }

  /** Take an Action through the one door. */
  async dispatch(action: Action): Promise<void> {
    await this.transport.invoke("dispatch", {
      envelope: { version: ACTION_VERSION, action },
    });
  }

  /** Follow the Snapshots the Host publishes. */
  onSnapshot(handler: (snapshot: Snapshot) => void): Promise<() => void> {
    return this.transport.listen<Snapshot>(SNAPSHOT_EVENT, (event) =>
      handler(event.payload),
    );
  }
}
