import { useEffect, useRef } from "react";

import type { Intent } from "../input";
import { padIntents } from "../input";

/** A first press, and then how a held direction repeats. */
const REPEAT_AFTER = 400;
const REPEAT_EVERY = 160;

/**
 * Which intents a held button repeats. A direction and a volume step are
 * things a person holds to go further; activating or going Back fires once per
 * press.
 */
export const REPEATABLE: ReadonlySet<Intent> = new Set<Intent>([
  "up",
  "down",
  "left",
  "right",
  "volume_up",
  "volume_down",
]);

/**
 * Poll the standard-mapping gamepad, because the Gamepad API has no key event
 * to listen to.
 *
 * The first press of a held direction fires at once; holding it fires again
 * after `REPEAT_AFTER`, then every `REPEAT_EVERY`. A pad that is not in the
 * standard mapping is ignored rather than guessed at — its button indexes are
 * device-specific (research #49).
 */
export function useGamepad(onIntent: (intent: Intent) => void) {
  const latest = useRef(onIntent);
  latest.current = onIntent;

  useEffect(() => {
    if (typeof navigator.getGamepads !== "function" || typeof requestAnimationFrame !== "function") {
      return;
    }

    let frame = 0;
    const held = new Map<Intent, boolean>();
    const next = new Map<Intent, number>();

    const poll = (now: number) => {
      let found: Gamepad | null = null;
      try {
        const pads = navigator.getGamepads();
        found = Array.from(pads).find((pad): pad is Gamepad => Boolean(pad?.connected)) ?? null;
      } catch {
        // A browser can refuse the Gamepad API entirely; the keyboard still works.
        found = null;
      }

      const intents = found ? padIntents(found) : [];
      const seen = new Set<Intent>();

      for (const intent of intents) {
        seen.add(intent);
        if (!held.get(intent)) {
          held.set(intent, true);
          next.set(intent, now + REPEAT_AFTER);
          latest.current(intent);
          continue;
        }
        const due = next.get(intent) ?? 0;
        if (REPEATABLE.has(intent) && now >= due) {
          next.set(intent, now + REPEAT_EVERY);
          latest.current(intent);
        }
      }

      for (const intent of held.keys()) {
        if (!seen.has(intent)) {
          held.set(intent, false);
        }
      }

      frame = requestAnimationFrame(poll);
    };

    frame = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(frame);
  }, []);
}
