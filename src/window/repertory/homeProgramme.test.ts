import { describe, expect, it } from "vitest";

import { HOME_RAIL_PAGE, HOME_RAIL_VISIBLE } from "./homeProgramme";

/**
 * What is still the window's own: the ten-foot rail's measurements. The beat,
 * the section numbering, the tags and the empty programme's words moved to the
 * core with the Remote's Home (ADR-0035 §1), and their cases moved with them.
 */

describe("Home's ten-foot rail", () => {
  it("shows five and a half cards and pages five of them at a time", () => {
    expect(HOME_RAIL_VISIBLE).toBe(5.5);
    expect(HOME_RAIL_PAGE).toBe(5);
  });
});
