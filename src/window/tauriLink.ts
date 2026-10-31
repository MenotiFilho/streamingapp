import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";

import { ReadyLink } from "./readyLink";
import type { Transport } from "./transport";

export type { Transport } from "./transport";

export const tauriTransport: Transport = {
  invoke: (command, args) => tauriInvoke(command, args),
  listen: (event, handler) => tauriListen(event, handler),
};

/**
 * The Host's own window's link (ADR-0035 §1).
 *
 * The window is already in: it pairs nothing and holds no socket, so its link
 * is `ready` from the first render and only ever becomes `closed`. The Tauri
 * transport is the real one; a test hands in its own so the window can be
 * driven without a Host.
 */
export class TauriLink extends ReadyLink {
  constructor(transport: Transport = tauriTransport) {
    super(transport, "the window closed");
  }
}
