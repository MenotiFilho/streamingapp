import { describe, expect, test } from "vitest";

import { fittedCardSize, pageAttrs, pageFit, type PageSurface } from "./pageLayout";

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
 * H1 (#257): on a fitted feed the cards take their size from the height the
 * panel has left, so both rails and their captions fit; a floor keeps a picture
 * a picture where a very short window would ask for a sliver.
 */
describe("a fitted feed's card size", () => {
  const room = { available: 496, rows: 2, chrome: 156, gap: 16, floor: 64 };

  test("the panel's room, less each row's chrome and the gap, split across the rows", () => {
    // (496 - 2 * 156 - 16) / 2 = 84.
    expect(fittedCardSize(room)).toEqual({ artHeight: 84, width: 56 });
  });

  test("a 2:3 poster's width follows its height", () => {
    expect(fittedCardSize({ ...room, available: 700 })).toEqual({
      // (700 - 312 - 16) / 2 = 186, and two thirds of 186 is 124.
      artHeight: 186,
      width: 124,
    });
  });

  test("a short window stops at the floor rather than shrinking to a sliver", () => {
    // (200 - 312 - 16) / 2 is negative; the floor is the answer.
    expect(fittedCardSize({ ...room, available: 200 })).toEqual({
      artHeight: 64,
      width: 42,
    });
  });

  test("one row takes the whole panel", () => {
    expect(fittedCardSize({ ...room, rows: 1, available: 300 })).toEqual({
      artHeight: 144,
      width: 96,
    });
  });
});
