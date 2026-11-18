/**
 * What the window's and the Remote's language fields share of a chip drag that
 * needs no DOM: what a drag in flight says about each chip. The decision itself
 * — which rank a release lands on — is `dropIndex` in `languageList`, and the
 * chips' rectangles are read by `react/chipRects`; each client keeps its own
 * markup and its own press (a mouse drag on the window, a long press on a
 * phone).
 */

/** A drag in flight: the rank lifted and the rank it is over now. */
export type DragOver = { from: number; to: number };

/** What a drag in flight says about one chip: it is the one lifted, or the one it would land on. */
export function chipMarks(
  over: DragOver | null,
  index: number,
): { dragging: boolean; drop: boolean } {
  return {
    dragging: over?.from === index,
    drop: over !== null && over.to === index && over.from !== index,
  };
}
