import { describe, expect, test } from "vitest";

import type { AddonManifest } from "../host-client";
import {
  addOutcome,
  addStatusText,
  catalogsOf,
  joinOrNone,
  moveTarget,
  resourcesOf,
} from "./addons";

const ADDON: AddonManifest = {
  id: "com.linvo.cinemeta",
  name: "Cinemeta",
  version: "3.0.0",
  resources: [
    { name: "catalog", types: ["movie", "series"], idPrefixes: null },
    { name: "stream", types: null, idPrefixes: ["tt"] },
  ],
  types: ["movie", "series"],
  catalogs: [
    {
      type: "movie",
      id: "top",
      name: "Top",
      extra: [{ name: "skip", isRequired: false, options: [], optionsLimit: 1 }],
    },
  ],
  idPrefixes: ["tt"],
  behaviorHints: { configurable: false, configurationRequired: false },
};

describe("the Addons screen's readings", () => {
  test("a resource names its types where it declares them", () => {
    expect(resourcesOf(ADDON)).toBe("catalog (movie, series), stream");
    expect(resourcesOf({ ...ADDON, resources: [] })).toBe("none");
  });

  test("a Catalog is named by its own name and type", () => {
    expect(catalogsOf(ADDON)).toBe("Top (movie)");
    expect(catalogsOf({ ...ADDON, catalogs: [] })).toBe("none");
  });

  test("a list of words says when there are none", () => {
    expect(joinOrNone(["movie", "series"])).toBe("movie, series");
    expect(joinOrNone([])).toBe("none");
  });

  test("Move names a 0-based position, and stops at the ends", () => {
    expect(moveTarget(1, -1, 3)).toBe(0);
    expect(moveTarget(1, 1, 3)).toBe(2);
    expect(moveTarget(0, -1, 3)).toBeNull();
    expect(moveTarget(2, 1, 3)).toBeNull();
  });

  test("an add names a new Addon, and says when it refreshed one that was already known", () => {
    expect(addOutcome([], [ADDON])).toEqual({ kind: "added", name: "Cinemeta" });
    expect(addOutcome([ADDON], [ADDON])).toEqual({
      kind: "refreshed",
      name: null,
    });
    expect(
      addOutcome([ADDON], [{ ...ADDON, version: "3.0.1" }]),
    ).toEqual({ kind: "refreshed", name: "Cinemeta" });
    expect(addOutcome([], null)).toBeNull();
  });

  test("the form says which Addon arrived, or that the Host refreshed one", () => {
    expect(addStatusText({ kind: "added", name: "Cinemeta" })).toBe(
      "Cinemeta was added.",
    );
    expect(addStatusText({ kind: "refreshed", name: "Cinemeta" })).toBe(
      "That manifest is already configured as Cinemeta; the Host refreshed that Addon instead of adding a second one.",
    );
    expect(addStatusText({ kind: "refreshed", name: null })).toBe(
      "That manifest is already configured; the Host refreshed that Addon instead of adding a second one.",
    );
  });
});
