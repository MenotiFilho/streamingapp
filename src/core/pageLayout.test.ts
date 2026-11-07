import { describe, expect, test } from "vitest";

import {
  FITTED_CARD_FLOOR,
  FITTED_COMPACT_BELOW,
  fittedCardSize,
  fittedChrome,
  pageAttrs,
  pageFit,
  type FeedCardRoom,
  type PageSurface,
} from "./pageLayout";

/**
 * The page rule ADR-0036 §3 records: a fitted screen never scrolls the page
 * vertically, and what is longer scrolls inside its own panel. The decision is
 * asked here rather than read off the drawing (ADR-0032).
 */
describe("the page rule", () => {
  test("Discover, Search, Title and the player fit; Home and the register scroll", () => {
    expect(pageFit("discover").panel, "Discover fits head, genre row and rows").toBe("rows");
    expect(pageFit("search").panel, "Search fits its bar and rows").toBe("rows");
    expect(pageFit("title").panel, "the Title is one screen").toBe("episodes");
    expect(pageFit("player").panel, "the Remote's player card is one screen").toBe("card");

    expect(pageFit("home").panel, "Home keeps its scrolling programme").toBeNull();
    expect(pageFit("library").panel, "the utility register scrolls").toBeNull();
    expect(pageFit("addons").panel, "the utility register scrolls").toBeNull();
    expect(pageFit("settings").panel, "the utility register scrolls").toBeNull();
    expect(
      pageFit("overlay").panel,
      "a level ADR-0036 §3 does not name keeps the page rule",
    ).toBeNull();
  });

  test("Discover and Search answer the same two-row rule", () => {
    expect(pageFit("search")).toEqual(pageFit("discover"));
    expect(pageAttrs("search")).toEqual(pageAttrs("discover"));
  });

  test("the screen root's attributes are one helper's answer", () => {
    expect(pageAttrs("discover")).toEqual({ "data-page": "fitted", "data-panel": "rows" });
    expect(pageAttrs("search")).toEqual({ "data-page": "fitted", "data-panel": "rows" });
    expect(pageAttrs("title")).toEqual({
      "data-page": "fitted",
      "data-panel": "episodes",
    });
    expect(pageAttrs("player")).toEqual({ "data-page": "fitted", "data-panel": "card" });

    const scrolling: PageSurface[] = ["home", "library", "addons", "settings", "overlay"];
    for (const surface of scrolling) {
      expect(pageAttrs(surface), surface).toEqual({});
    }
  });
});

/**
 * H1 (#257, the owner's decision after the Windows look at PR #263): a fitted
 * feed's cards take their size from the height the panel has left, but a
 * readable poster wins over fitting. The floor is about 120px wide — 180 tall
 * at 2:3 — and where both rails cannot hold it the rows panel scrolls; the page
 * itself still does not.
 */
describe("a fitted feed's card size", () => {
  const room: FeedCardRoom = {
    available: 800,
    rows: 2,
    head: 60,
    caption: 44,
    track: 16,
    gap: 16,
    floor: FITTED_CARD_FLOOR,
  };

  test("the floor is a readable poster: 180 tall, 120 wide at 2:3", () => {
    expect(FITTED_CARD_FLOOR).toBe(180);
    // (200 - 2 * (60 + 44 + 16) - 16) / 2 is negative; the floor is the answer.
    expect(fittedCardSize({ ...room, available: 200 })).toEqual({
      artHeight: 180,
      width: 120,
      scrolls: true,
    });
  });

  test("the panel's room, less each row's head, caption and track, split across the rows", () => {
    // (800 - 2 * (60 + 44 + 16) - 16) / 2 = 272.
    expect(fittedCardSize(room)).toEqual({
      artHeight: 272,
      width: 181,
      scrolls: false,
    });
  });

  test("a 2:3 poster's width follows its height", () => {
    // (700 - 240 - 16) / 2 = 222, and two thirds of 222 is 148.
    expect(fittedCardSize({ ...room, available: 700 })).toEqual({
      artHeight: 222,
      width: 148,
      scrolls: false,
    });
  });

  test("one row takes the whole panel", () => {
    // 400 - 120 = 280, and two thirds of 280 is 186.
    expect(fittedCardSize({ ...room, rows: 1, available: 400 })).toEqual({
      artHeight: 280,
      width: 186,
      scrolls: false,
    });
  });

  /**
   * The walkthrough's two windows, from the sheet's type and spacing at each
   * stage. 1366x768 leaves about 490px of panel under the compact head, genre
   * row and credit; 2560x1080 leaves about 666px under the regular ones.
   */
  const at1366: FeedCardRoom = {
    available: 490,
    rows: 2,
    head: 65,
    caption: 44,
    track: 10,
    gap: 12,
    floor: FITTED_CARD_FLOOR,
  };
  const at2560: FeedCardRoom = {
    available: 667,
    rows: 2,
    head: 73,
    caption: 44,
    track: 16,
    gap: 16,
    floor: FITTED_CARD_FLOOR,
  };

  test("1366x768 holds the floor and reports the rows panel scrolling", () => {
    // (490 - 2 * 119 - 12) / 2 = 120, under the floor; the panel scrolls.
    expect(fittedCardSize(at1366)).toEqual({
      artHeight: 180,
      width: 120,
      scrolls: true,
    });
  });

  test("2560x1080 fits both rails above the floor, with the caption counted", () => {
    // (667 - 2 * 133 - 16) / 2 = 192. The caption's 44 is its 32px line plus
    // the 12px gap above it; counting the line alone would overstate the art.
    expect(fittedCardSize(at2560)).toEqual({
      artHeight: 192,
      width: 128,
      scrolls: false,
    });
  });
});

/**
 * On a short window a fitted feed's own chrome goes compact: a smaller head,
 * tighter genre row and slimmer TMDB credit leave the height to the posters
 * (PR #263). The threshold is decided here, not by a CSS media query.
 */
describe("a fitted feed's chrome", () => {
  test("turns compact below the threshold and regular at it", () => {
    expect(FITTED_COMPACT_BELOW).toBe(900);
    expect(fittedChrome(FITTED_COMPACT_BELOW - 1), "a short page is compact").toBe(
      "compact",
    );
    expect(fittedChrome(FITTED_COMPACT_BELOW), "the threshold itself is regular").toBe(
      "regular",
    );
  });

  test("the walkthrough's two windows land on opposite sides", () => {
    // A 1366x768 window leaves 768 - 32.8 - 65.6 = 640px of page; a
    // 2560x1080 window's 1050px client area leaves 1050 - 46.7 - 93.3 = 910px.
    expect(fittedChrome(640), "1366x768 is a short window").toBe("compact");
    expect(fittedChrome(910), "2560x1080 is not").toBe("regular");
  });
});
