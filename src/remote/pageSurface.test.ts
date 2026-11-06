import { describe, expect, test } from "vitest";

import { pageSurface } from "./pageSurface";

/**
 * The Remote draws a destination or one level of its stack. Which of those is
 * the surface the page rule asks about is this client's mapping, so the answer
 * is asked here rather than inferred from the markup (ADR-0032, ADR-0036 §3).
 */
describe("the Remote's page surface", () => {
  test("a bare destination is its own surface", () => {
    expect(pageSurface("home", null)).toBe("home");
    expect(pageSurface("discover", null)).toBe("discover");
    expect(pageSurface("search", null)).toBe("search");
    expect(pageSurface("library", null)).toBe("library");
    expect(pageSurface("addons", null)).toBe("addons");
    expect(pageSurface("settings", null)).toBe("settings");
  });

  test("a Title level is the Title page", () => {
    expect(pageSurface("discover", "title")).toBe("title");
    expect(pageSurface("search", "title")).toBe("title");
  });

  test("the player card and its sheets are the player screen", () => {
    expect(pageSurface("home", "player")).toBe("player");
    expect(pageSurface("home", "sheet")).toBe("player");
  });

  test("every other level keeps the scrolling page", () => {
    expect(pageSurface("discover", "streams")).toBe("overlay");
    expect(pageSurface("settings", "settings")).toBe("overlay");
    expect(pageSurface("search", "grid")).toBe("overlay");
    expect(pageSurface("home", "confirm")).toBe("overlay");
  });
});
