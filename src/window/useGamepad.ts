import { useEffect, useRef } from "react";

import { padIntents, REPEAT_AFTER_MS, REPEAT_EVERY_MS, REPEATABLE, type Intent } from "../core/input";

// The repeat rule is the input table's; the hook that runs it reads it from the
// core, and window consumers keep this door.
export { REPEATABLE };

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
          next.set(intent, now + REPEAT_AFTER_MS);
          latest.current(intent);
          continue;
        }
        const due = next.get(intent) ?? 0;
        if (REPEATABLE.has(intent) && now >= due) {
          next.set(intent, now + REPEAT_EVERY_MS);
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
