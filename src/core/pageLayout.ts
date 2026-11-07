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
 * left, split across its rows with a readable floor, is a decision a test can
 * ask; where the floor cannot fit, the panel scrolls.
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
 * A poster is 2:3, so a height gives its width. The `floor` keeps a poster
 * readable — the owner's decision after the Windows look at #263 — even where
 * that means the rows panel has to scroll. The panel is the one overflow a
 * fitted screen still allows.
 */
export type FeedCardRoom = {
  /** The panel's height in px, already clear of the screen's head and credit. */
  available: number;
  /** How many rows share the panel — Discover and Search draw two. */
  rows: number;
  /** What one row's head spends: its line, its rule and the gap under it. */
  head: number;
  /** What one card's caption spends: the gap above it and its real line height. */
  caption: number;
  /** What one row's track spends above and below its cards. */
  track: number;
  /** The gap between two rows, in px. */
  gap: number;
  /** The smallest art height a fitted card may take. */
  floor: number;
};

/** A fitted feed card's size, in px: its art's height and the width that follows. */
export type FeedCardSize = {
  artHeight: number;
  width: number;
  /** Whether the floor already overflows the panel, so the rows panel scrolls. */
  scrolls: boolean;
};

/**
 * The smallest art height a fitted card may take: about 120px wide at 2:3, so
 * the title caption under it is readable and the rating stamp no longer covers
 * the picture. A panel too short even for this scrolls — the one overflow a
 * fitted screen still allows (PR #263).
 */
export const FITTED_CARD_FLOOR = 180;

/** What one card keeps of a fitted panel's room. The floor is the first constraint. */
export function fittedCardSize(room: FeedCardRoom): FeedCardSize {
  const rows = Math.max(1, room.rows);
  const chrome = room.head + room.caption + room.track;
  const roomForArt =
    (room.available - rows * chrome - (rows - 1) * room.gap) / rows;
  const artHeight = Math.max(room.floor, Math.floor(roomForArt));
  return {
    artHeight,
    width: Math.floor((artHeight * 2) / 3),
    scrolls: Math.floor(roomForArt) < room.floor,
  };
}

/**
 * Where a fitted feed's own chrome turns compact, in page height (px). Below
 * this the screen spends its height on posters instead of a full-size head,
 * genre row and credit; the decision is here, not in a CSS media query
 * (ADR-0032). A 768-tall window is short; a 1080-tall one is not.
 */
export const FITTED_COMPACT_BELOW = 900;

/** Which chrome a fitted feed draws: compact on a short page, regular above it. */
export type FittedChrome = "compact" | "regular";

/** Which chrome a fitted feed draws at a page height. */
export function fittedChrome(pageHeight: number): FittedChrome {
  return pageHeight < FITTED_COMPACT_BELOW ? "compact" : "regular";
}
