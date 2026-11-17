import { useEffect, useRef } from "react";

import { pickerTarget, type AutoplayView } from "../autoplay";

/** The view at a missing Stream: the one kind that has a target. */
export type MissingStream = Extract<AutoplayView, { kind: "no_stream" }>;

/**
 * Run `open` once for each missing-Stream target, where `opens` says this
 * client may (#320, #302).
 *
 * The window and the Remote both open the Streams picker for the episode
 * Autoplay found no Stream for, and both follow the same shape: remember what
 * was last drawn, compare it with what is drawn now only when the target moves
 * (the view's other fields change every tick), and read everything else — the
 * level, the popover, the Snapshot — as it is at that moment, not as it was when
 * the render was made. What differs is the client's own rule for *where* it may
 * open (`opens`) and what opening is (`open`); both are read through a ref, so a
 * caller passes plain closures.
 *
 * `previous` is updated on every target change, even where `opens` refuses, so
 * a target a client could not act on is not acted on later because the person
 * has since arrived on a surface that could.
 */
export function useMissingStream(
  view: AutoplayView,
  opens: (previous: AutoplayView, view: AutoplayView) => boolean,
  open: (view: MissingStream) => void,
): void {
  const previous = useRef<AutoplayView>({ kind: "none" });
  const latest = useRef({ opens, open });
  latest.current = { opens, open };

  const target = pickerTarget(view);

  useEffect(() => {
    const was = previous.current;
    previous.current = view;
    if (view.kind !== "no_stream" || !latest.current.opens(was, view)) {
      return;
    }
    latest.current.open(view);
    // Only a new target is a new question; the view's other fields move every tick.
  }, [target]);
}
