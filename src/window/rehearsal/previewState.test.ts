import { describe, expect, it } from "vitest";

import type { AddonManifest, ContinueEntry } from "../../core/wire";
import {
  addonDisabled,
  manifestFrom,
  PREVIEW_DEVICES,
  publishedFeaturedCatalog,
  reconcileUnplayable,
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
  enabled: true,
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
      enabled: true,
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

describe("the preview's Addon enable/disable mirror (ADR-0044 §2)", () => {
  it("hides featuredCatalog while its Addon is disabled and restores it when re-enabled", () => {
    const featured = { addon: CINEMETA.id, catalog: { type: "movie", id: "top" } };
    expect(publishedFeaturedCatalog(featured, [CINEMETA, TORRENTIO])).toEqual(featured);
    expect(
      publishedFeaturedCatalog(featured, [{ ...CINEMETA, enabled: false }, TORRENTIO]),
    ).toBeNull();
    expect(publishedFeaturedCatalog(featured, [TORRENTIO])).toBeNull();
    expect(addonDisabled([{ ...CINEMETA, enabled: false }], CINEMETA.id)).toBe(true);
    expect(addonDisabled([CINEMETA], CINEMETA.id)).toBe(false);
  });

  it("marks Continue watching entries addon_disabled or addon_removed and clears on re-enable", () => {
    const entry: ContinueEntry = {
      video: { id: "tt1", name: null, season: null, episode: null, thumbnail: null, airDate: null },
      title: { addon: CINEMETA.id, id: "tt1", type: "movie", name: "One", poster: null },
      position: 100,
      duration: 1000,
      watched: false,
      upNext: false,
      unplayable: null,
    };

    expect(
      reconcileUnplayable([entry], [{ ...CINEMETA, enabled: false }])[0]?.unplayable,
    ).toEqual({ reason: "addon_disabled", addon: CINEMETA.id });
    expect(reconcileUnplayable([entry], [])[0]?.unplayable).toEqual({
      reason: "addon_removed",
      addon: CINEMETA.id,
    });
    expect(reconcileUnplayable([entry], [CINEMETA])[0]?.unplayable).toBeNull();
  });
});
