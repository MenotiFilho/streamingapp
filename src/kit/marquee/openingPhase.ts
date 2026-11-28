/**
 * How full the Opening artwork is (ADR-0044 §7).
 *
 * The Host publishes no numeric opening progress, because neither mpv nor the
 * Torrent engine has a true one. A client fills the logo by the phase the
 * Snapshot reports: `opening` → `finding` → `fetching` → `playing`. A direct
 * Stream steps from `opening` straight to `playing`.
 *
 * The ratios are this client's drawing, not a fact about the Stream: they only
 * have to rise phase by phase and be whole at `playing`.
 */

import type { PlaybackSnapshot } from "../../core/wire";

export type OpeningPhase = "opening" | "finding" | "fetching" | "playing";

export const OPENING_FILL: Readonly<Record<OpeningPhase, number>> = {
  opening: 0.2,
  finding: 0.45,
  fetching: 0.75,
  playing: 1,
};

/** The share of the logo, or of the bar, drawn at full brightness in this phase. */
export function openingFill(phase: OpeningPhase): number {
  return OPENING_FILL[phase];
}

/**
 * The phase one Snapshot names, or `null` where nothing is opening or playing.
 * The Torrent status only speaks while the Stream is still opening: once it
 * plays, the fill is whole whatever the engine says.
 */
export function openingPhase(
  playback: Pick<PlaybackSnapshot, "state" | "torrent">,
): OpeningPhase | null {
  if (playback.state === "opening") {
    return playback.torrent?.phase ?? "opening";
  }
  return playback.state === "playing" ? "playing" : null;
}
