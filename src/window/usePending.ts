import { useCallback, useRef, useState } from "react";

/** One control's wait: whether it is drawn as waiting, and the guarded start. */
type Pending = {
  /** Whether the work this control started is still in flight. */
  pending: boolean;
  /**
   * Start `work`, unless something this control started is still running.
   *
   * The guard is a ref, set before React has painted: two presses in the same
   * tick reach `run` before either has rendered, and the second is dropped.
   * The state is what the control draws until the work settles; a refusal still
   * travels through `work`, so the screen's own error handling is unchanged
   * (#137).
   */
  run: (work: () => Promise<unknown>) => Promise<void>;
};

/**
 * The wait a control shows, and the guard that keeps it from being pressed
 * twice.
 *
 * Local, rather than in the shell, because what is waiting is a fact about the
 * control that sent the Action: the player's Next episode shows its own line,
 * and a Settings form shows its own spinner. Two controls that send the same
 * Action still coalesce — that is the shell's `InFlight` (#137).
 */
export function usePending(): Pending {
  const [pending, setPending] = useState(false);
  const running = useRef(false);

  const run = useCallback(async (work: () => Promise<unknown>) => {
    if (running.current) {
      return;
    }
    running.current = true;
    setPending(true);
    try {
      await work();
    } finally {
      running.current = false;
      setPending(false);
    }
  }, []);

  return { pending, run };
}
