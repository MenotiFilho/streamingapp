import { describe, expect, it } from "vitest";

import type { AddonManifest } from "../../core/wire";
import {
  manifestFrom,
  PREVIEW_DEVICES,
  removedAddon,
  reorderedAddons,
} from "./previewState";

const CINEMETA: AddonManifest = {
  id: "com.linvo.cinemeta",
  name: "Cinemeta",
  version: "3.0.14",
  resources: [
    { name: "catalog", types: ["movie", "series"], idPrefixes: null },
    { name: "meta", types: ["movie", "series"], idPrefixes: null },
  ],
  types: ["movie", "series"],
  catalogs: [],
  idPrefixes: ["tt"],
  behaviorHints: { configurable: false, configurationRequired: false },
};

const TORRENTIO: AddonManifest = {
  ...CINEMETA,
  id: "torrentio",
  name: "Torrentio",
  resources: [{ name: "stream", types: ["movie", "series"], idPrefixes: ["tt"] }],
  catalogs: [],
  types: [],
};

const AIOSTREAMS: AddonManifest = { ...TORRENTIO, id: "aiostreams", name: "AIOStreams" };

describe("the preview's manifest reader", () => {
  it("reads the fields the Host publishes, including both resource spellings", () => {
    expect(
      manifestFrom("https://example.test/manifest.json", {
        id: "community.example",
        name: " Example ",
        version: "1.2.3",
        resources: [
          "catalog",
          { name: "stream", types: ["movie"], idPrefixes: ["tt"] },
        ],
        types: ["movie", "series"],
        catalogs: [
          {
            type: "movie",
            id: "top",
            name: "Popular",
            extra: [{ name: "search", isRequired: true, options: ["a"], optionsLimit: 1 }],
          },
        ],
        idPrefixes: ["tt"],
        behaviorHints: { configurable: true },
      }),
    ).toEqual({
      id: "community.example",
      name: "Example",
      version: "1.2.3",
      resources: [
        { name: "catalog", types: null, idPrefixes: null },
        { name: "stream", types: ["movie"], idPrefixes: ["tt"] },
      ],
      types: ["movie", "series"],
      catalogs: [
        {
          type: "movie",
          id: "top",
          name: "Popular",
          extra: [{ name: "search", isRequired: true, options: ["a"], optionsLimit: 1 }],
        },
      ],
      idPrefixes: ["tt"],
      behaviorHints: { configurable: true, configurationRequired: false },
    });
  });

  it("refuses a manifest with no id, name or version instead of repairing it", () => {
    expect(() => manifestFrom("https://example.test/manifest.json", { name: "x" })).toThrowError(
      expect.objectContaining({ kind: "manifest", detail: "the manifest is missing an id" }),
    );
    expect(() =>
      manifestFrom("https://example.test/manifest.json", { id: "x", name: "x" }),
    ).toThrowError(expect.objectContaining({ detail: "the manifest is missing a version" }));
    expect(() => manifestFrom("https://example.test/manifest.json", null)).toThrowError(
      expect.objectContaining({ kind: "manifest" }),
    );
  });
});

describe("the preview's Addon register", () => {
  it("moves one row to the 0-based position the Action names", () => {
    expect(reorderedAddons([CINEMETA, TORRENTIO, AIOSTREAMS], "aiostreams", 1)?.map((a) => a.id)).toEqual([
      "com.linvo.cinemeta",
      "aiostreams",
      "torrentio",
    ]);
    expect(reorderedAddons([CINEMETA, TORRENTIO], "torrentio", 0)?.map((a) => a.id)).toEqual([
      "torrentio",
      "com.linvo.cinemeta",
    ]);
  });

  it("refuses a position outside the list or an Addon that is not configured", () => {
    expect(reorderedAddons([CINEMETA, TORRENTIO], "torrentio", 2)).toBeNull();
    expect(reorderedAddons([CINEMETA, TORRENTIO], "torrentio", -1)).toBeNull();
    expect(reorderedAddons([CINEMETA, TORRENTIO], "missing", 0)).toBeNull();
  });

  it("removes one row, and says when there was nothing to remove", () => {
    expect(removedAddon([CINEMETA, TORRENTIO], "torrentio")?.map((a) => a.id)).toEqual([
      "com.linvo.cinemeta",
    ]);
    expect(removedAddon([CINEMETA], "torrentio")).toBeNull();
  });
});

describe("the preview's paired devices", () => {
  it("keeps the sample devices named as previews", () => {
    expect(PREVIEW_DEVICES.length).toBeGreaterThan(0);
    expect(PREVIEW_DEVICES.every((device) => device.name.includes("(preview)"))).toBe(true);
  });
});
