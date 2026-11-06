import { describe, expect, test } from "vitest";

import { pageFit, scrollsAsPage, type PageSurface } from "./pageLayout";

/**
 * The page rule ADR-0036 §3 records: a fitted screen never scrolls the page
 * vertically, and what is longer scrolls inside its own panel. The decision is
 * asked here rather than read off the drawing (ADR-0032).
 */
describe("the page rule", () => {
  test("Discover, Search, Title and the player fit; Home and the register scroll", () => {
    expect(pageFit("discover").fitted, "Discover fits head, chips and rows").toBe(true);
    expect(pageFit("search").fitted, "Search fits its bar and rows").toBe(true);
    expect(pageFit("title").fitted, "the Title is one screen").toBe(true);
    expect(pageFit("player").fitted, "the Remote's player card is one screen").toBe(true);

    expect(pageFit("home").fitted, "Home keeps its scrolling programme").toBe(false);
    expect(pageFit("library").fitted, "the utility register scrolls").toBe(false);
    expect(pageFit("addons").fitted, "the utility register scrolls").toBe(false);
    expect(pageFit("settings").fitted, "the utility register scrolls").toBe(false);
    expect(
      pageFit("overlay").fitted,
      "a level ADR-0036 §3 does not name keeps the page rule",
    ).toBe(false);
  });

  test("a fitted page names the panel its own overflow scrolls inside", () => {
    expect(pageFit("discover").panel).toBe("rows");
    expect(pageFit("search").panel).toBe("rows");
    expect(pageFit("title").panel).toBe("episodes");
    expect(pageFit("player").panel).toBe("card");
  });

  test("a page that scrolls has no panel of its own", () => {
    const scrolling: PageSurface[] = ["home", "library", "addons", "settings", "overlay"];
    for (const surface of scrolling) {
      expect(pageFit(surface).panel, surface).toBeNull();
    }
  });

  test("scrolling as a page is exactly the fitted answer, inverted", () => {
    for (const surface of [
      "home",
      "discover",
      "search",
      "library",
      "addons",
      "settings",
      "title",
      "overlay",
      "player",
    ] as const) {
      expect(scrollsAsPage(surface), surface).toBe(!pageFit(surface).fitted);
    }
  });
});
