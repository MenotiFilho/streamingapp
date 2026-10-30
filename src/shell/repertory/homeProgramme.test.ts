import { describe, expect, it } from "vitest";

import type { AddonManifest, Snapshot } from "../../host-client";
import {
  FEATURE_ROTATION_MS,
  HOME_CONTINUE_COLUMNS,
  HOME_ROW_COLUMNS,
  featurePosition,
  featureStep,
  homeEmptyState,
  homeSectionIndex,
} from "./homeProgramme";

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

  it("gives a row and Continue watching one view each", () => {
    expect(HOME_ROW_COLUMNS).toBe(6);
    expect(HOME_CONTINUE_COLUMNS).toBe(4);
    expect(homeSectionIndex(0, true)).toBe("02");
    expect(homeSectionIndex(0, false)).toBe("01");
    expect(homeSectionIndex(2, true)).toBe("04");
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
