import { describe, expect, test } from "vitest";

import {
  LICENCE,
  SETTINGS_CATEGORIES,
  TMDB_NOTICE,
  aboutCredits,
  protectionLedger,
  settingsLevelId,
  settingsLevelName,
  unknownLanguageLabel,
} from "./settingsRegister";

describe("the Settings register's decisions", () => {
  test("the four categories are the Host's own, in the record's order", () => {
    expect(SETTINGS_CATEGORIES.map((category) => category.id)).toEqual([
      "credentials",
      "preferences",
      "remote-devices",
      "about",
    ]);
    expect(SETTINGS_CATEGORIES.map((category) => category.title)).toEqual([
      "Credentials",
      "Preferences",
      "Remote devices",
      "About/Credits",
    ]);
  });

  test("a category is a pushed level with a stable id and a display name", () => {
    const credentials = SETTINGS_CATEGORIES[0]!;
    expect(settingsLevelId(credentials)).toBe("settings-credentials");
    expect(settingsLevelName(credentials)).toBe("Settings — Credentials");
  });

  test("the protection ledger names the store and what it holds", () => {
    expect(
      protectionLedger({ backend: "keyring", tmdbHeld: true, stremioHeld: false }),
    ).toEqual({
      backend: "OS keyring",
      tmdb: "Held",
      stremio: "Not signed in",
    });
    expect(
      protectionLedger({ backend: "file", tmdbHeld: false, stremioHeld: true }),
    ).toEqual({
      backend: "Owner-only (0600) file",
      tmdb: "Not held",
      stremio: "Signed in",
    });
  });

  test("a value outside the presets is named by an Other chip", () => {
    expect(unknownLanguageLabel("fr-CA")).toBe("Other (fr-CA)");
  });

  test("About carries the app version, the required notice and the licence", () => {
    expect(aboutCredits("0.1.0")).toEqual({
      version: "0.1.0",
      tmdbNotice: TMDB_NOTICE,
      licence: LICENCE,
    });
    expect(TMDB_NOTICE).toBe(
      "This product uses the TMDB API but is not endorsed or certified by TMDB",
    );
    expect(LICENCE).toContain("GPL-3.0-or-later");
  });
});
