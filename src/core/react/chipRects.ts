import type { ChipRect } from "../languageList";

/** The attribute each chip carries: its rank from zero, which `move` takes. */
export const CHIP_INDEX_ATTRIBUTE = "data-chip-index";

/**
 * The rectangles of the chips under a field, in the page's own coordinates and
 * the order they are drawn: the one read of the layout the window's and the
 * Remote's language fields both make before `dropIndex` decides a drop.
 */
export function chipRects(field: ParentNode | null): ChipRect[] {
  return Array.from(
    field?.querySelectorAll<HTMLElement>(`[${CHIP_INDEX_ATTRIBUTE}]`) ?? [],
    (chip) => {
      const box = chip.getBoundingClientRect();
      return { x: box.left, y: box.top, w: box.width, h: box.height };
    },
  );
}
