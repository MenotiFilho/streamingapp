/**
 * The page rule (ADR-0036 §3): which screens fit the window, and what scrolls
 * inside them.
 *
 * Most screens let a short window scroll the page rather than clip the copy. A
 * fitted screen does not: the page itself never scrolls vertically, and anything
 * longer than the window scrolls inside the screen's own panel. Discover and
 * Search fit their head, genre row and rows; the Title fits with its episode
 * list scrolling inside its rail; the Remote's player card is one screen, with
 * every control fitting.
 *
 * The decision lives here because both clients obey it (ADR-0035 §1), and no
 * client should have to rediscover it from a CSS rule (ADR-0032). The fitted
 * feed's card size is here for the same reason: the room a fitted panel has
 * left, split across its rows, is a decision a test can ask.
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
  /**
   * The panel that scrolls inside a fitted page, or null where the page itself
   * scrolls. A fitted surface is exactly one whose panel is named here.
   */
  panel: PagePanel | null;
};

const PAGE_FITS: Record<PageSurface, PageFit> = {
  home: { panel: null },
  discover: { panel: "rows" },
  search: { panel: "rows" },
  library: { panel: null },
  addons: { panel: null },
  settings: { panel: null },
  title: { panel: "episodes" },
  overlay: { panel: null },
  player: { panel: "card" },
};

/** One surface's page rule. */
export function pageFit(surface: PageSurface): PageFit {
  return PAGE_FITS[surface];
}

/** The attributes a screen root carries for the page rule. */
export type PageAttributes = {
  "data-page"?: "fitted";
  "data-panel"?: PagePanel;
};

/**
 * The pair of attributes a screen root spreads. One helper for the five roots
 * keeps the two values from being spelled differently in one of them.
 */
export function pageAttrs(surface: PageSurface): PageAttributes {
  const { panel } = pageFit(surface);
  return panel === null
    ? {}
    : { "data-page": "fitted", "data-panel": panel };
}

/**
 * What a fitted feed's cards are sized from (H1, #257): the room the panel has
 * after the screen's head, genre row and credit, split across the rows.
 *
 * A poster is 2:3, so a height gives its width. The `floor` keeps a picture a
 * picture where a very short window would otherwise ask for a sliver; the panel
 * scrolls if the floor itself cannot fit.
 */
export type FeedCardRoom = {
  /** The panel's height in px, already clear of the screen's head and credit. */
  available: number;
  /** How many rows share the panel — Discover and Search draw two. */
  rows: number;
  /** What one row spends above and below its art: head, caption and track padding. */
  chrome: number;
  /** The gap between two rows, in px. */
  gap: number;
  /** The smallest art height a fitted card may take. */
  floor: number;
};

/** A fitted feed card's size, in px: its art's height and the width that follows. */
export type FeedCardSize = { artHeight: number; width: number };

/**
 * The smallest art height a fitted card may take: a poster stays a picture, not
 * a sliver. A panel too short even for this scrolls, the one overflow a fitted
 * screen still allows.
 */
export const FITTED_CARD_FLOOR = 64;

/** What one card keeps of a fitted panel's room. */
export function fittedCardSize(room: FeedCardRoom): FeedCardSize {
  const rows = Math.max(1, room.rows);
  const roomForArt =
    (room.available - rows * room.chrome - (rows - 1) * room.gap) / rows;
  const artHeight = Math.max(room.floor, Math.floor(roomForArt));
  return { artHeight, width: Math.floor((artHeight * 2) / 3) };
}
