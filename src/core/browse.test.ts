import { describe, expect, test } from "vitest";

import { declaredCatalogs, pageable, type Row } from "./browse";
import type { AddonManifest, Snapshot } from "./wire";

function addon(overrides: Partial<AddonManifest> = {}): AddonManifest {
  return {
    id: "com.linvo.cinemeta",
    name: "Cinemeta",
    version: "3.0.14",
    resources: [{ name: "catalog", types: ["movie"], idPrefixes: null }],
    types: ["movie"],
    catalogs: [
      {
        type: "movie",
        id: "top",
        name: "Popular",
        extra: [{ name: "skip", isRequired: false, options: [], optionsLimit: 0 }],
      },
    ],
    idPrefixes: ["tt"],
    behaviorHints: { configurable: false, configurationRequired: false },
    enabled: true,
    ...overrides,
  };
}

function snapshotWith(addons: AddonManifest[]): Snapshot {
  return {
    revision: 1,
    playback: {
      state: "idle",
      picture: "in_window",
      failure: null,
      nowPlaying: null,
      episode: null,
      position: null,
      duration: null,
      buffered: null,
      stalled: false,
      torrent: null,
      tracks: [],
      chapters: [],
      chapter: null,
      speed: null,
      volume: null,
      muted: null,
      subtitleDelay: null,
      crop: null,
      aspect: null,
      resolution: null,
      statistics: null,
      autoplay: null,
    },
    preferences: {
      subtitleLanguages: [],
      audioLanguages: [],
      subtitleColor: "#FFFFFF",
      subtitleScale: 1,
      streamBuffer: { seconds: 300, megabytes: 512 },
      torrentCache: { megabytes: 2000 },
      upNextPlayback: "direct",
      autoplay: true,
    },
    addons,
    featuredCatalog: null,
    protection: { backend: "keyring", tmdbHeld: false, stremioHeld: false },
    continueWatching: [],
    watchProgress: [],
    devices: [],
    pairingCode: "ABCDEF",
    address: null,
  };
}

describe("catalog listings skip disabled Addons (ADR-0044 §2)", () => {
  test("declaredCatalogs excludes catalogs from disabled Addons while keeping enabled ones in order", () => {
    const enabled = addon({ id: "org.example.on", name: "On", enabled: true });
    const disabled = addon({
      id: "org.example.off",
      name: "Off",
      catalogs: [{ type: "movie", id: "hidden", name: "Hidden", extra: [] }],
      enabled: false,
    });

    const catalogs = declaredCatalogs(snapshotWith([disabled, enabled]));

    expect(catalogs.map((entry) => `${entry.addon}/${entry.catalog.id}`)).toEqual([
      "org.example.on/top",
    ]);
  });

  test("pageable returns false for rows belonging to a disabled Addon", () => {
    const disabled = addon({ id: "org.example.off", enabled: false });
    const row: Row = {
      addon: "org.example.off",
      type: "movie",
      id: "top",
      name: "Popular",
      metas: [],
      offset: 0,
      failure: null,
      done: false,
    };

    expect(pageable(snapshotWith([disabled]), row)).toBe(false);
    expect(pageable(snapshotWith([{ ...disabled, enabled: true }]), row)).toBe(true);
  });
});
