import { describe, expect, test } from "vitest";

import {
  PREFERENCE_SUB_LEVELS,
  activeFeaturedKey,
  clampPreviewScale,
  featuredCatalogAction,
  featuredCatalogChoices,
  featuredCatalogSummary,
  formatPairedDetail,
  languagesSummary,
  preferenceListEntries,
  streamBufferSummary,
  subtitleAppearanceSummary,
  upNextPlaybackLabel,
} from "./marqueeSettings";
import { SETTINGS_LEVEL_PREFIX } from "./settingsRegister";
import type { AddonManifest, Snapshot } from "./wire";

const CINEMETA: AddonManifest = {
  id: "cinemeta",
  name: "Cinemeta",
  version: "3.0.14",
  resources: [{ name: "catalog", types: ["movie"], idPrefixes: null }],
  types: ["movie"],
  catalogs: [
    { type: "movie", id: "top", name: "Popular", extra: [] },
    { type: "series", id: "top", name: "Popular Series", extra: [] },
  ],
  idPrefixes: ["tt"],
  behaviorHints: { configurable: false, configurationRequired: false },
  enabled: true,
};

const BASE_SNAPSHOT: Snapshot = {
  revision: 1,
  playback: {
    state: "idle",
    autoplay: null,
    picture: "in_window",
    failure: null,
    nowPlaying: null,
    episode: null,
    position: null,
    duration: null,
    buffered: null,
    tracks: [],
    chapters: [],
    chapter: null,
    speed: null,
    volume: null,
    muted: null,
    subtitleDelay: null,
    stalled: false,
    torrent: null,
    crop: null,
    aspect: null,
    resolution: null,
    statistics: null,
  },
  preferences: {
    subtitleLanguages: ["pt-BR", "en"],
    audioLanguages: [],
    subtitleColor: "#FFFFFF",
    subtitleScale: 1,
    streamBuffer: { seconds: 300, megabytes: 512 },
    torrentCache: { megabytes: 2000 },
    upNextPlayback: "direct",
    autoplay: true,
  },
  addons: [CINEMETA],
  featuredCatalog: { addon: "cinemeta", catalog: { type: "movie", id: "top" } },
  protection: { backend: "keyring", tmdbHeld: true, stremioHeld: true },
  continueWatching: [],
  watchProgress: [],
  devices: [],
  pairingCode: "K7QX4M",
  address: "http://192.168.0.12:7878",
};

describe("Marquee Settings decisions (ADR-0032)", () => {
  test("every Preferences sub-level id starts with SETTINGS_LEVEL_PREFIX so the nav rail stays live", () => {
    for (const meta of Object.values(PREFERENCE_SUB_LEVELS)) {
      expect(meta.levelId.startsWith(SETTINGS_LEVEL_PREFIX)).toBe(true);
    }
  });

  test("summarizes language lists, subtitle appearance, stream buffer, up next, and featured catalog", () => {
    expect(languagesSummary([])).toBe("Follow the file");
    expect(languagesSummary(["pt-BR", "en"])).toBe("Português (Brasil), English");
    expect(languagesSummary(["fr-CA"])).toBe("fr-CA");

    expect(subtitleAppearanceSummary("#ffffff", 1)).toBe("White · Default");
    expect(subtitleAppearanceSummary("#FFFF00", 1.15)).toBe("Yellow · 115%");
    expect(subtitleAppearanceSummary("#123abc", 2.5)).toBe("#123ABC · 250%");

    expect(upNextPlaybackLabel("direct")).toBe("Play directly");
    expect(upNextPlaybackLabel("picker")).toBe("Open the Streams picker");

    expect(streamBufferSummary({ seconds: 300, megabytes: 512 })).toBe("5 min · 512 MB");
    expect(streamBufferSummary({ seconds: 600, megabytes: 1024 })).toBe("10 min · 1 GB");
    expect(streamBufferSummary({ seconds: 90, megabytes: 384 })).toBe("90 s · 384 MB");

    expect(featuredCatalogSummary(BASE_SNAPSHOT)).toBe("Popular · Cinemeta");
    expect(featuredCatalogSummary({ ...BASE_SNAPSHOT, featuredCatalog: null })).toBe("None");
  });

  test("builds the eight Preferences rows with Autoplay inline and sub-levels on the rest", () => {
    const entries = preferenceListEntries(BASE_SNAPSHOT);
    expect(entries.map((entry) => entry.id)).toEqual([
      "subtitle-languages",
      "audio-languages",
      "subtitle-appearance",
      "autoplay",
      "up-next-playback",
      "featured-catalog",
      "stream-buffer",
      "torrent-cache",
    ]);
    expect(entries[3]).toEqual({
      kind: "switch",
      id: "autoplay",
      icon: "skip-forward",
      label: "Autoplay the next episode",
      checked: true,
    });
    expect(entries[2]).toMatchObject({
      kind: "sublevel",
      value: "White · Default",
      subLevel: "subtitle-appearance",
    });
    expect(entries[7]).toMatchObject({
      kind: "sublevel",
      value: "2 GB",
      subLevel: "stream-buffer",
    });
  });

  test("featured catalog actions and choices skip disabled Addons", () => {
    expect(featuredCatalogAction(null)).toEqual({ type: "clear_featured_catalog" });
    expect(
      featuredCatalogAction({
        addon: "cinemeta",
        catalog: { type: "movie", id: "top", name: "Popular", extra: [] },
      }),
    ).toEqual({
      type: "set_featured_catalog",
      addon: "cinemeta",
      catalog: { type: "movie", id: "top" },
    });
    expect(activeFeaturedKey(BASE_SNAPSHOT)).toBe("cinemeta/movie/top");
    expect(featuredCatalogChoices(BASE_SNAPSHOT)).toHaveLength(2);
    expect(
      featuredCatalogChoices({
        ...BASE_SNAPSHOT,
        addons: [{ ...CINEMETA, enabled: false }],
      }),
    ).toEqual([]);
  });

  test("formats paired dates and clamps subtitle preview scales to Host bounds", () => {
    expect(formatPairedDetail(Date.UTC(2026, 10, 12, 12, 0))).toMatch(/^Paired 12 Nov 2026$/);
    expect(clampPreviewScale(0.1)).toBe(0.25);
    expect(clampPreviewScale(4)).toBe(3);
    expect(clampPreviewScale(Number.NaN)).toBe(1);
    expect(clampPreviewScale(1.15)).toBe(1.15);
  });
});
