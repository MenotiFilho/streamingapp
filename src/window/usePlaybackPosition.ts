import { useEffect, useMemo, useState } from "react";

import type { PlaybackSnapshot } from "../host-client";
import { projectedPosition } from "./osd";

/** How often the clock is re-projected while a person is looking at it. */
export const PROJECTION_MS = 250;

/**
 * Where playback is now, for a client that is looking.
 *
 * A Snapshot carries the position it was built at; between Snapshots the clock
 * is the client's own. The anchor is the Snapshot object, so a correction — a
 * pause, a seek, a track change, a Watch progress write — moves it at once.
 *
 * `active` is what the surface knows: a hidden OSD does not re-render four times
 * a second for nobody, and when it is shown again the projection catches up
 * from the same anchor before the next tick starts.
 */
export function usePlaybackPosition(playback: PlaybackSnapshot | null, active: boolean): number {
  const anchor = useMemo(() => ({ at: performance.now() }), [playback]);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!active || playback === null || playback.state !== "playing") {
      return;
    }
    const timer = setInterval(() => setTick((tick) => tick + 1), PROJECTION_MS);
    return () => clearInterval(timer);
  }, [active, playback?.state]);

  if (playback === null) {
    return 0;
  }
  const projected = projectedPosition(playback, (performance.now() - anchor.at) / 1000);
  return projected ?? 0;
}
