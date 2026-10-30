import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS, parseSettings, settingsQuery } from "./settings";

describe("the rehearsal settings", () => {
  it("starts on a rotating feature and keeps the rehearsal bar", () => {
    expect(parseSettings("")).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS).toEqual({
      feature: "rotates",
      rehearsal: true,
    });
  });

  it("reads a complete comparison from the query string", () => {
    expect(parseSettings("?feature=still&rehearsal=0")).toEqual({
      feature: "still",
      rehearsal: false,
    });
  });

  it("ignores the retired frame comparison, so an old link still lands", () => {
    // The spine is the one frame (#154): `?frame=strip` is not a setting.
    expect(parseSettings("?frame=strip")).toEqual(DEFAULT_SETTINGS);
  });

  it("has one type pairing, so a pairing in the query is ignored", () => {
    // The Playfair alternate was cut (ADR-0030 §3): `?type=` is not a setting,
    // and an old link must still land on the one pairing rather than fail.
    expect(parseSettings("?type=playfair")).toEqual(DEFAULT_SETTINGS);
  });

  it("falls back on anything it does not know", () => {
    expect(parseSettings("?frame=marquee&feature=loop&rehearsal=maybe")).toEqual(
      DEFAULT_SETTINGS,
    );
  });

  it("round-trips through a stable query string", () => {
    const settings = {
      feature: "still" as const,
      rehearsal: false,
    };
    expect(parseSettings(`?${settingsQuery(settings)}`)).toEqual(settings);
    expect(settingsQuery(DEFAULT_SETTINGS)).toBe("feature=rotates");
  });
});
