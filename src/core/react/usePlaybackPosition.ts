import { useEffect, useMemo, useState } from "react";

import type { PlaybackSnapshot } from "../wire";
import { projectedPosition } from "../osd";

/** How often the clock is re-projected while a person is looking at it. */
export const PROJECTION_MS = 250;

/**
 * The seconds since the Snapshot's anchor, for a client that is looking.
 *
 * A Snapshot carries the position it was built at; between Snapshots the clock
 * is the client's own. The anchor is the Snapshot object, so a correction — a
 * pause, a seek, a track change, a Watch progress write — moves it at once.
 *
 * `active` is what the surface knows: a hidden player does not re-render four
 * times a second for nobody, and when it is shown again the elapsed time
 * catches up from the same anchor before the next tick starts.
 */
export function usePlaybackPlayed(
  playback: PlaybackSnapshot | null,
  active: boolean,
): number {
  const anchor = useMemo(() => ({ at: performance.now() }), [playback]);
  const [, setTick] = useState(0);

  // A playing Stream moves its position; an ended one with a countdown moves
  // the digit. Both are the same projection from the Snapshot's arrival.
  const moving = playback?.state === "playing" || playback?.autoplay != null;
  useEffect(() => {
    if (!active || !moving) {
      return;
    }
    const timer = setInterval(() => setTick((tick) => tick + 1), PROJECTION_MS);
    return () => clearInterval(timer);
  }, [active, moving]);

  if (playback === null) {
    return 0;
  }
  return (performance.now() - anchor.at) / 1000;
}

/**
 * Where playback is now, for a client that draws the clock itself.
 *
 * The projection lives in `projectedPosition`; this hook only supplies the
 * elapsed time. A player that draws a view model reads `usePlaybackPlayed`
 * through `usePlaybackView`, so the projection is not run twice.
 */
export function usePlaybackPosition(playback: PlaybackSnapshot | null, active: boolean): number {
  const played = usePlaybackPlayed(playback, active);

  if (playback === null) {
    return 0;
  }
  return projectedPosition(playback, played) ?? 0;
}
