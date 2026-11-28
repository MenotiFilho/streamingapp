import { ReadyLink } from "./readyLink";
import { previewTransport, stopTicker } from "./rehearsal/previewHost";
import type { Transport } from "./transport";

/**
 * The rehearsal's link (ADR-0035 §1).
 *
 * The plain-Vite window has no Tauri Host behind it, so the same six members
 * are answered by the preview transport over the sample Host in
 * `rehearsal/previewHost.ts`. The shape is `TauriLink`'s — ready from the first
 * render, closing to silence everything — with the preview's own clock stopped
 * when the link closes. Nothing here imports a Tauri module.
 */
export class PreviewLink extends ReadyLink {
  constructor(
    transport: Transport = previewTransport,
    stop: () => void = stopTicker,
  ) {
    super(transport, "the rehearsal closed", stop);
  }
}
