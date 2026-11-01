import { describe, expect, it } from "vitest";

import type { Row } from "./browse";
import type { AddonManifest, Snapshot } from "./wire";
import {
  FEATURE_ROTATION_MS,
  featurePosition,
  featureStep,
  homeEmptyState,
  homeSectionIndex,
  rowTag,
} from "./homeProgramme";

/**
 * Home's programme decisions, asked of the core both clients draw from
 * (ADR-0035 §1): the beat, the feature's position, the section numbering, a
 * row's tag and the empty programme's words.
 */

const ADDON: AddonManifest = {
  id: "cinemeta",
  name: "Cinemeta",
  version: "3.0.14",
  resources: [],
  types: ["movie"],
  catalogs: [],
  idPrefixes: ["tt"],
  behaviorHints: { configurable: false, configurationRequired: false },
};

const SNAPSHOT = {
  addons: [ADDON],
  featuredCatalog: null,
  watchProgress: [],
} as unknown as Snapshot;

describe("Home's programme decisions", () => {
  it("holds one feature for 24 seconds and shows its position in the programme", () => {
    expect(FEATURE_ROTATION_MS).toBe(24_000);
    expect(featurePosition(0, 4)).toBe("01 / 04");
    expect(featurePosition(3, 4)).toBe("04 / 04");
    expect(featurePosition(0, 1)).toBe("One showing");
  });

  it("steps a feature only while there is a slide in that direction", () => {
    expect(featureStep(0, 4, 1)).toBe(1);
    expect(featureStep(2, 4, -1)).toBe(1);
    expect(featureStep(0, 4, -1), "Left at the first slide is the frame's").toBeNull();
    expect(featureStep(3, 4, 1), "Right at the last slide is the frame's").toBeNull();
    expect(featureStep(0, 1, 1)).toBeNull();
  });

  it("numbers a section after the feature, and after Continue watching where it is drawn", () => {
    expect(homeSectionIndex(0, true)).toBe("02");
    expect(homeSectionIndex(0, false)).toBe("01");
    expect(homeSectionIndex(2, true)).toBe("04");
  });

  it("prints a row's tag from its Addon and the count it has loaded", () => {
    const row: Row = {
      addon: "cinemeta",
      type: "movie",
      id: "top",
      name: "Popular",
      metas: [],
      offset: 0,
      failure: null,
      done: false,
    };

    expect(rowTag(null, row), "the Addon's id before the Snapshot names it").toBe(
      "cinemeta / 0 films",
    );
    expect(rowTag(SNAPSHOT, row)).toBe("Cinemeta / 0 films");
  });

  it("prints the count a caller caps, while the whole row prints its own", () => {
    const metas = Array.from({ length: 30 }, (_, index) => ({
      id: `tt${index}`,
      type: "movie" as const,
      name: `Film ${index}`,
      poster: null,
      posterShape: "poster" as const,
      releaseInfo: "2026",
      imdbRating: null,
      genres: [],
      description: null,
    }));
    const row = {
      addon: "cinemeta",
      type: "movie" as const,
      id: "top",
      name: "Popular",
      metas,
      offset: 0,
      failure: null,
      done: true,
    };
    expect(rowTag(SNAPSHOT, row, 20)).toBe("Cinemeta / 20 films");
    expect(rowTag(SNAPSHOT, row)).toBe("Cinemeta / 30 films");
  });

  it("says what an empty programme needs in the record's voice", () => {
    expect(homeEmptyState(null, 0)).toBeNull();
    expect(homeEmptyState(SNAPSHOT, 1)).toBeNull();
    expect(homeEmptyState({ ...SNAPSHOT, addons: [] }, 0)).toEqual({
      title: "Nothing is screening tonight.",
      body: "Add an Addon to open the programme.",
      action: "addons",
    });
    expect(homeEmptyState(SNAPSHOT, 0)).toEqual({
      title: "Nothing is screening tonight.",
      body: "No Addon offers a Catalog to print.",
      action: "addons",
    });
  });
});
