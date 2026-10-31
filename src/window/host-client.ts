import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";

import { ACTION_VERSION, SNAPSHOT_EVENT } from "../core/wire";
import type { Action, Response, Snapshot } from "../core/wire";

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

  /** Take an Action through the one door, and get back what came of it. */
  async dispatch(action: Action): Promise<Response> {
    return this.transport.invoke<Response>("dispatch", {
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
