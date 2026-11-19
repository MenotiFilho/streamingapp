import { useEffect, useState } from "react";

import { STALL_GRACE_MS, stallShown } from "../stall";

/**
 * Whether the Stalled drawing is up, for a client that has been told `stalled`.
 *
 * The decision is `stallShown`; this hook only supplies `stalledSince` from the
 * client's own monotonic clock and wakes once, when the second is up. It never
 * polls, and a Snapshot that changes nothing about the stall (a new position)
 * does not restart it. `stalled` ending removes the drawing in that same render,
 * not on the effect after it.
 */
export function useStallShown(stalled: boolean): boolean {
  const [stalledSince, setStalledSince] = useState<number | null>(null);
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (!stalled) {
      setStalledSince(null);
      return;
    }
    const since = performance.now();
    setStalledSince(since);
    setNow(since);

    const timer = setTimeout(
      () => setNow(Math.max(performance.now(), since + STALL_GRACE_MS)),
      STALL_GRACE_MS,
    );
    return () => clearTimeout(timer);
  }, [stalled]);

  return stalled && stallShown(stalledSince, now);
}
