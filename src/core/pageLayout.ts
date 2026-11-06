/**
 * The page rule (ADR-0036 §3): which screens fit the window, and what scrolls
 * inside them.
 *
 * Most screens let a short window scroll the page rather than clip the copy. A
 * fitted screen does not: the page itself never scrolls vertically, and anything
 * longer than the window scrolls inside the screen's own panel. Discover and
 * Search fit their head, chips and rows; the Title fits with its episode list
 * scrolling inside its rail; the Remote's player card is one screen, with every
 * control fitting.
 *
 * The decision lives here because both clients obey it (ADR-0035 §1), and no
 * client should have to rediscover it from a CSS rule (ADR-0032).
 */

import type { Destination } from "./destinations";

/**
 * Every surface either client can show, for the purpose of the page rule: the
 * six destinations, the Title, any other pushed level, and the Remote's player
 * card. A level that is not named keeps the old rule — the page scrolls.
 */
export type PageSurface = Destination | "title" | "overlay" | "player";

/**
 * The panel a fitted page scrolls its overflow inside. `rows` is Discover's and
 * Search's feed; `episodes` is the Title's rail; `card` is the Remote's player
 * card, which scrolls only where a viewport is shorter than every control.
 */
export type PagePanel = "rows" | "episodes" | "card";

/** One surface's answer to the page rule. */
export type PageFit = {
  /** Whether the page fits the window and never scrolls vertically. */
  fitted: boolean;
  /** The panel that scrolls inside a fitted page; null where the page scrolls. */
  panel: PagePanel | null;
};

const PAGE_FITS: Record<PageSurface, PageFit> = {
  home: { fitted: false, panel: null },
  discover: { fitted: true, panel: "rows" },
  search: { fitted: true, panel: "rows" },
  library: { fitted: false, panel: null },
  addons: { fitted: false, panel: null },
  settings: { fitted: false, panel: null },
  title: { fitted: true, panel: "episodes" },
  overlay: { fitted: false, panel: null },
  player: { fitted: true, panel: "card" },
};

/** One surface's page rule. */
export function pageFit(surface: PageSurface): PageFit {
  return PAGE_FITS[surface];
}

/** Whether a short window scrolls this surface as a page, as it always has. */
export function scrollsAsPage(surface: PageSurface): boolean {
  return !pageFit(surface).fitted;
}
