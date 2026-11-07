/**
 * The rail's paging decision, kept out of the drawing (ADR-0032).
 *
 * A press moves whole items, never a viewport: `cards` items, where a fixed
 * rail measures one pitch as a card and the gap after it. A rail that shows
 * half a card at its edge therefore still pages by whole cards — the half card
 * never changes the step — and the answer is clamped to the rail's own
 * scrollable range.
 *
 * A content-sized track (Discover's genre chips) has items of different widths,
 * so it pages by the measured span of each one instead: the target is the
 * leading edge of the item a page on, not a wider or narrower guess.
 */

/** One measured item in a content-sized track: its leading edge and its width. */
export type ItemSpan = {
  /** The distance from the first item's leading edge to this one's. */
  start: number;
  /** The item's own width. */
  width: number;
};

/** The paging pitch: one fixed step, or each item's measured span. */
export type PagingPitch = number | readonly ItemSpan[];

/**
 * How many whole items one view holds from `scrollLeft`, at least one. A
 * fixed-pitch rail pages the view it declares; a content-sized track pages the
 * items that fit whole, the way a five-and-a-half-card rail pages five.
 */
export function itemsPerView(
  items: readonly ItemSpan[],
  scrollLeft: number,
  viewport: number,
): number {
  const whole = items.filter(
    (item) =>
      item.start >= scrollLeft - 1 &&
      item.start + item.width <= scrollLeft + viewport + 1,
  ).length;
  return Math.max(1, whole);
}

export function pagedOffset(
  scrollLeft: number,
  furthest: number,
  pitch: PagingPitch,
  cards: number,
  direction: -1 | 1,
): number {
  if (!(cards > 0)) {
    return scrollLeft;
  }
  if (typeof pitch === "number") {
    if (!(pitch > 0)) {
      return scrollLeft;
    }
    const target = scrollLeft + pitch * cards * direction;
    return Math.min(furthest, Math.max(0, Math.round(target)));
  }
  return pagedOffsetByItems(scrollLeft, furthest, pitch, cards, direction);
}

/**
 * Page a varying-width track to the leading edge of the item `cards` along
 * from the first one in view. A page forward from beyond the last item is the
 * end; a page back from the trailing padding starts from the last item, so a
 * clamped end still moves back.
 */
function pagedOffsetByItems(
  scrollLeft: number,
  furthest: number,
  items: readonly ItemSpan[],
  cards: number,
  direction: -1 | 1,
): number {
  if (items.length === 0 || !items.some((item) => item.width > 0)) {
    return scrollLeft;
  }
  const at = items.findIndex(
    (item) => item.start + item.width > scrollLeft + 1,
  );
  if (at < 0) {
    if (direction > 0) {
      return Math.max(0, furthest);
    }
    const back = items.length - 1 - cards;
    return back <= 0
      ? 0
      : Math.min(furthest, Math.max(0, Math.round(items[back]!.start)));
  }
  const target = at + cards * direction;
  if (target <= 0) {
    return 0;
  }
  if (target >= items.length) {
    return Math.max(0, furthest);
  }
  return Math.min(furthest, Math.max(0, Math.round(items[target]!.start)));
}
