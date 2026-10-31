/**
 * The rail's paging decision, kept out of the drawing (ADR-0032).
 *
 * A press moves whole cards, never a viewport: `cards` card pitches, where one
 * pitch is a card and the gap after it. A rail that shows half a card at its
 * edge therefore still pages by whole cards — the half card never changes the
 * step — and the answer is clamped to the rail's own scrollable range.
 */
export function pagedOffset(
  scrollLeft: number,
  furthest: number,
  pitch: number,
  cards: number,
  direction: -1 | 1,
): number {
  if (!(pitch > 0) || !(cards > 0)) {
    return scrollLeft;
  }
  const target = scrollLeft + pitch * cards * direction;
  return Math.min(furthest, Math.max(0, Math.round(target)));
}
