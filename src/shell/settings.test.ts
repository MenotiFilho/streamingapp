import { describe, expect, test } from "vitest";

import { protectionReadout } from "./settings";

describe("the Credentials protection readout", () => {
  test("names the keyring and what it holds", () => {
    expect(
      protectionReadout({ backend: "keyring", tmdbHeld: true, stremioHeld: false }),
    ).toEqual({
      backend: "The OS keyring",
      tmdb: "A TMDB key is held.",
      stremio: "No Stremio account is signed in.",
    });
  });

  test("names the owner-only file fallback, and says when nothing is held", () => {
    expect(
      protectionReadout({ backend: "file", tmdbHeld: false, stremioHeld: true }),
    ).toEqual({
      backend:
        "An owner-only (0600) file in the data directory, because no keyring is reachable here",
      tmdb: "No TMDB key is held.",
      stremio: "A Stremio account is signed in.",
    });
  });
});
