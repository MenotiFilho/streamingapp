import { describe, expect, test } from "vitest";

import {
  addonDetailsFacts,
  addonMovingIntent,
  addonRemoveBody,
  addonReorderTarget,
  addonServesSummary,
  addonsCountSubtitle,
} from "./marqueeAddons";
import type { AddonManifest } from "./wire";

const CINEMETA: AddonManifest = {
  id: "com.linvo.cinemeta",
  name: "Cinemeta",
  version: "3.0.14",
  resources: [
    { name: "catalog", types: ["movie", "series"], idPrefixes: null },
    { name: "meta", types: ["movie", "series"], idPrefixes: null },
  ],
  types: ["movie", "series"],
  catalogs: [
    { type: "movie", id: "top", name: "Popular", extra: [] },
  ],
  idPrefixes: ["tt"],
  behaviorHints: { configurable: false, configurationRequired: false },
  enabled: true,
};

const TORRENTIO: AddonManifest = {
  id: "com.stremio.torrentio.addon",
  name: "Torrentio",
  version: "0.0.15",
  resources: [{ name: "stream", types: ["movie", "series"], idPrefixes: ["tt"] }],
  types: ["movie", "series"],
  catalogs: [],
  idPrefixes: ["tt"],
  behaviorHints: { configurable: false, configurationRequired: false },
  enabled: true,
};

describe("Marquee Addons decisions (ADR-0032)", () => {
  test("formats the installed Addons subtitle only when non-empty", () => {
    expect(addonsCountSubtitle(0)).toBeUndefined();
    expect(addonsCountSubtitle(4)).toBe("4 installed · asked in this order");
  });

  test("summarizes what an Addon serves from Manifest resources and types alone", () => {
    expect(addonServesSummary(CINEMETA)).toBe("Catalogs, metadata · movies, series");
    expect(addonServesSummary(TORRENTIO)).toBe("Streams · movies, series");
    expect(
      addonServesSummary({
        ...TORRENTIO,
        resources: [],
        types: [],
      }),
    ).toBe("No resources");
  });

  test("Addon details include only existing Manifest fields and never URL, origin, or OFFLINE", () => {
    const facts = addonDetailsFacts(CINEMETA);
    expect(facts.map((f) => f.label)).toEqual([
      "Version",
      "Id",
      "Serves",
      "Types",
      "Catalogs",
    ]);
    expect(facts).toEqual([
      { label: "Version", value: "3.0.14" },
      { label: "Id", value: "com.linvo.cinemeta" },
      { label: "Serves", value: "catalog (movie, series), meta (movie, series)" },
      { label: "Types", value: "movie, series" },
      { label: "Catalogs", value: "Popular (movie)" },
    ]);
    expect(addonDetailsFacts(TORRENTIO).find((f) => f.label === "Catalogs")?.value).toBe("none");
  });

  test("Remove body reflects whether the Addon supplies Catalogs", () => {
    expect(addonRemoveBody(CINEMETA)).toContain("Featured catalog");
    expect(addonRemoveBody(TORRENTIO)).not.toContain("Featured catalog");
    expect(addonRemoveBody(TORRENTIO)).toContain("Continue watching");
  });

  test("computes 0-based reorder targets and clamps at list boundaries", () => {
    const list = [CINEMETA, TORRENTIO];
    expect(addonReorderTarget(list, CINEMETA.id, -1)).toBeNull();
    expect(addonReorderTarget(list, CINEMETA.id, 1)).toBe(1);
    expect(addonReorderTarget(list, TORRENTIO.id, -1)).toBe(0);
    expect(addonReorderTarget(list, TORRENTIO.id, 1)).toBeNull();
    expect(addonReorderTarget(list, "missing", 1)).toBeNull();
  });

  test("routes directional intents while moving and holds focus at ends and sideways", () => {
    expect(
      addonMovingIntent("up", { moving: false, canMoveUp: true, canMoveDown: true }),
    ).toBeNull();
    expect(
      addonMovingIntent("up", { moving: true, canMoveUp: true, canMoveDown: true }),
    ).toBe("up");
    expect(
      addonMovingIntent("up", { moving: true, canMoveUp: false, canMoveDown: true }),
    ).toBe("consume");
    expect(
      addonMovingIntent("down", { moving: true, canMoveUp: true, canMoveDown: true }),
    ).toBe("down");
    expect(
      addonMovingIntent("down", { moving: true, canMoveUp: true, canMoveDown: false }),
    ).toBe("consume");
    expect(
      addonMovingIntent("left", { moving: true, canMoveUp: true, canMoveDown: true }),
    ).toBe("consume");
    expect(
      addonMovingIntent("right", { moving: true, canMoveUp: true, canMoveDown: true }),
    ).toBe("consume");
    expect(
      addonMovingIntent("activate", { moving: true, canMoveUp: true, canMoveDown: true }),
    ).toBeNull();
  });
});
