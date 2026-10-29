import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS, parseSettings, settingsQuery } from "./settings";

describe("the rehearsal settings", () => {
  it("starts on the spine, Bodoni and a rotating feature", () => {
    expect(parseSettings("")).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS).toEqual({
      frame: "spine",
      pairing: "bodoni",
      feature: "rotates",
      rehearsal: true,
    });
  });

  it("reads a complete comparison from the query string", () => {
    expect(parseSettings("?frame=strip&type=playfair&feature=still&rehearsal=0")).toEqual({
      frame: "strip",
      pairing: "playfair",
      feature: "still",
      rehearsal: false,
    });
  });

  it("falls back on anything it does not know", () => {
    expect(parseSettings("?frame=marquee&type=comic&feature=loop&rehearsal=maybe")).toEqual(
      DEFAULT_SETTINGS,
    );
  });

  it("round-trips through a stable query string", () => {
    const settings = {
      frame: "strip" as const,
      pairing: "playfair" as const,
      feature: "still" as const,
      rehearsal: false,
    };
    expect(parseSettings(`?${settingsQuery(settings)}`)).toEqual(settings);
    expect(settingsQuery(DEFAULT_SETTINGS)).toBe("frame=spine&type=bodoni&feature=rotates");
  });
});
