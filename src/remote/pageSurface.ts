/**
 * Which surface the Remote's page rule asks about.
 *
 * The room draws either a destination or the top level of its stack, and the
 * frame (header, main, index) is the same for both. A Title is the Remote's
 * Title body: a phone cannot hold the copy and the episode list side by side, so
 * its whole body scrolls under the fixed Back (ADR-0036 §3, 2026-11-07). The
 * player card and the sheets above it are the player screen; every other level
 * — Streams, a Settings leaf, a grid, a confirmation — is an overlay that keeps
 * the old rule and scrolls as a page.
 */

import type { Destination } from "../core/destinations";
import type { PageSurface } from "../core/pageLayout";
import type { RemotePayload } from "./levels";

/**
 * The surface the Remote is drawing. `level` is the kind of the top level, or
 * null when the destination itself is on screen.
 */
export function pageSurface(
  destination: Destination,
  level: RemotePayload["kind"] | null = null,
): PageSurface {
  switch (level) {
    case null:
      return destination;
    case "title":
      return "title-body";
    case "player":
    case "sheet":
      return "player";
    default:
      return "overlay";
  }
}
