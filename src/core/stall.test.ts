import { describe, expect, test } from "vitest";

import { STALL_GRACE_MS, stallShown } from "./stall";

describe("stallShown", () => {
  test("nothing is drawn while nothing is stalled", () => {
    expect(stallShown(null, 10_000)).toBe(false);
  });

  test("a stall under a second draws nothing, so a seek's brief wait stays quiet", () => {
    expect(stallShown(5_000, 5_000)).toBe(false);
    expect(stallShown(5_000, 5_000 + STALL_GRACE_MS - 1)).toBe(false);
  });

  test("it is drawn from one continuous second of Stalled", () => {
    expect(STALL_GRACE_MS).toBe(1000);
    expect(stallShown(5_000, 6_000)).toBe(true);
    expect(stallShown(5_000, 60_000)).toBe(true);
  });

  test("an unstall resets it: the next stall starts its second again", () => {
    // The caller holds `stalledSince`; the stall ending is it going back to
    // null, and the next stall is a new instant.
    expect(stallShown(5_000, 6_500)).toBe(true);
    expect(stallShown(null, 6_600)).toBe(false);
    expect(stallShown(7_000, 7_400)).toBe(false);
    expect(stallShown(7_000, 8_000)).toBe(true);
  });
});
