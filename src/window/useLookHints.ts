import { useCallback, useEffect, useRef } from "react";

import {
  LookHintDwell,
  lookHint,
  type LookHintSource,
  type LookHintTarget,
} from "../core/lookHint";
import { useShell } from "./context";

/** What a card hands its focus and pointer events to. */
export type LookHints = {
  /** A source came to rest on the card's Title. */
  rest: (source: LookHintSource, target: LookHintTarget) => void;
  /** A source left the card it was resting on. */
  left: (source: LookHintSource) => void;
};

/**
 * The screen's one dwell clock for the cards it draws (#278, ADR-0038 §3).
 *
 * A card calls `rest` when focus or the pointer lands on it and `left` when
 * that source leaves. The decision of *when* a rest becomes a hint is the
 * core's (`LookHintDwell`); this holds the one timer the screen needs and sends
 * the hint through the shell's fire-and-forget door, so nothing waits and
 * nothing is alerted.
 */
export function useLookHints(): LookHints {
  const { hint } = useShell();
  const dwell = useRef<LookHintDwell | null>(null);
  if (dwell.current === null) {
    dwell.current = new LookHintDwell(() => Date.now());
  }
  const timer = useRef<number | null>(null);

  const clear = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const schedule = useCallback(() => {
    clear();
    const held = dwell.current;
    if (held === null) {
      return;
    }
    const remaining = held.remaining();
    if (remaining === null) {
      return;
    }
    timer.current = window.setTimeout(() => {
      timer.current = null;
      const target = held.due();
      if (target !== null) {
        hint(lookHint(target));
      }
      schedule();
    }, remaining);
  }, [clear, hint]);

  useEffect(() => clear, [clear]);

  const rest = useCallback(
    (source: LookHintSource, target: LookHintTarget) => {
      dwell.current?.rest(source, target);
      schedule();
    },
    [schedule],
  );

  const left = useCallback(
    (source: LookHintSource) => {
      dwell.current?.left(source);
      schedule();
    },
    [schedule],
  );

  return { rest, left };
}

/**
 * The focus and pointer handlers a card spreads: either source coming to rest
 * starts the dwell, and either one leaving lets its own rest go. A card focused
 * and hovered at once is one rest, because both name the same Title.
 */
export function lookHintHandlers(look: LookHints, target: LookHintTarget) {
  return {
    onFocus: () => look.rest("focus", target),
    onBlur: () => look.left("focus"),
    onPointerEnter: () => look.rest("pointer", target),
    onPointerLeave: () => look.left("pointer"),
  };
}
