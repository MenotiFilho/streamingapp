/**
 * Pure Marquee window layout decisions (ADR-0032, `docs/design-system.md` §4).
 *
 * `--mq-u` scales component sizes, typography, radii and margins from the
 * shorter side of a 16:9 reference frame, while horizontal container extents
 * follow the window width (so grids gain columns and rows show more cards as
 * the window widens).
 */

import { GRID_FOCUS_AHEAD } from "./gridPaging";

/** Poster card width and inter-column gap in reference units (`controls-nav-cards.css`, `tokens.css`). */
export const POSTER_WIDTH_U = 208;
export const POSTER_GAP_U = 28;

/** Horizontal content margins around the nav rail and trailing edge, in reference units (`tokens.css`). */
export const MARGIN_RAIL_U = 168;
export const MARGIN_FULL_U = 72;

/**
 * Reference-frame unit `--mq-u` in CSS pixels (`tokens.css`).
 *
 * Mirrors `max(0.5px, calc(min(1vw, 1.7777778vh) / 19.2))`.
 */
export function marqueeUnitPx(viewportWidth: number, viewportHeight: number): number {
  if (viewportWidth <= 0 || viewportHeight <= 0) {
    return 1;
  }
  return Math.max(0.5, Math.min(viewportWidth, viewportHeight * (16 / 9)) / 1920);
}

/**
 * Inner horizontal width available to a poster grid in a rail screen,
 * subtracting the leading rail margin (`168u`) and trailing margin (`72u`).
 */
export function posterGridAvailableWidth(viewportWidth: number, unitPx: number): number {
  if (viewportWidth <= 0 || unitPx <= 0) {
    return 0;
  }
  return Math.max(0, viewportWidth - (MARGIN_RAIL_U + MARGIN_FULL_U) * unitPx);
}

/**
 * Number of `208u` poster columns separated by `28u` gaps that fit within
 * `availableWidth`. Matches `.mq-poster-grid` (`repeat(auto-fill, 208u)`).
 */
export function posterGridColumns(params: {
  availableWidth: number;
  unitPx: number;
}): number {
  const { availableWidth, unitPx } = params;
  if (unitPx <= 0 || !Number.isFinite(availableWidth) || !Number.isFinite(unitPx)) {
    return 1;
  }
  const card = POSTER_WIDTH_U * unitPx;
  const gap = POSTER_GAP_U * unitPx;
  if (availableWidth < card) {
    return 1;
  }
  return Math.max(1, Math.floor((availableWidth + gap) / (card + gap)));
}

/** Poster grid column count for a given window viewport size. */
export function posterGridColumnsForViewport(
  viewportWidth: number,
  viewportHeight: number,
): number {
  const unitPx = marqueeUnitPx(viewportWidth, viewportHeight);
  const availableWidth = posterGridAvailableWidth(viewportWidth, unitPx);
  return posterGridColumns({ availableWidth, unitPx });
}

/**
 * How many cards from the end of a grid count as near the end for paging:
 * at least one full row (`columns`) and never less than `GRID_FOCUS_AHEAD`.
 */
export function gridFocusAheadForColumns(
  columns: number,
  fallback: number = GRID_FOCUS_AHEAD,
): number {
  if (!Number.isFinite(columns) || columns < 1) {
    return fallback;
  }
  return Math.max(fallback, Math.floor(columns));
}
