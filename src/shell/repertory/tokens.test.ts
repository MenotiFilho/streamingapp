import { describe, expect, it } from "vitest";

import { contrastRatio } from "./contrast";
import { REPERTORY_PALETTE } from "./palette";

const {
  ink,
  inkRaised,
  ivory,
  dim,
  muted,
  hairline,
  house,
} = REPERTORY_PALETTE;

describe("the repertory palette", () => {
  it("clears 4.5:1 for every text pair on ink and raised", () => {
    for (const inkSurface of [ink, inkRaised]) {
      expect(contrastRatio(ivory, inkSurface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(dim, inkSurface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(muted, inkSurface)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("clears 3:1 for the hairline as a non-text rule", () => {
    expect(contrastRatio(hairline, ink)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(hairline, inkRaised)).toBeGreaterThanOrEqual(3);
  });

  it("keeps brass legible as text, and keeps ivory off brass", () => {
    expect(contrastRatio(house, ink)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(ink, house)).toBeGreaterThanOrEqual(4.5);
    // The one measured trap: an ivory label on a brass fill looks right and
    // fails every threshold. The prototype must use ink on brass.
    expect(contrastRatio(ivory, house)).toBeLessThan(3);
  });
});
