import { describe, expect, test } from "vitest";

import { REMOTE_ACTIONS, REMOTE_ACTIONS_ARE_COMPLETE } from "./actions";

describe("the Remote's capability list", () => {
  test("names every Action once", () => {
    // The two directions are type checks (`satisfies` for an extra, the
    // `Exclude` assertion for a missing one); what a runtime test can add is
    // that the list the build writes into `build-info.json` has no duplicate
    // for a Rust set comparison to hide.
    const spellings = REMOTE_ACTIONS as readonly string[];
    expect(new Set(spellings).size).toBe(spellings.length);
    for (const spelling of spellings) {
      expect(spelling.length).toBeGreaterThan(0);
    }
    expect(REMOTE_ACTIONS_ARE_COMPLETE).toBe(true);
  });
});
