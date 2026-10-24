import { describe, expect, test } from "vitest";

import type { MetaPreview, ResumeEntry, Snapshot } from "../host-client";
import { continueArt, featuredRow, heroSlides } from "./home";

function meta(overrides: Partial<MetaPreview> = {}): MetaPreview {
  return {
    id: "tt0133093",
    type: "movie",
    name: "The Matrix",
    poster: "https://images.test/matrix-poster.jpg",
    posterShape: null,
    background: null,
    releaseInfo: "1999",
    imdbRating: "8.7",
    genres: [],
    description: "A hacker learns the truth.",
    ...overrides,
  };
}

function entry(overrides: Partial<ResumeEntry> = {}): ResumeEntry {
  return {
    video: { id: "tt0133093", name: null, season: null, episode: null, thumbnail: null },
    title: {
      addon: "com.linvo.cinemeta",
      id: "tt0133093",
      type: "movie",
      name: "The Matrix",
      poster: "https://images.test/matrix-poster.jpg",
      background: null,
    },
    position: 1284,
    duration: 8160,
    watched: false,
    unplayable: null,
    ...overrides,
  };
}

const EMPTY: Snapshot = {
  revision: 0,
  playback: {
    state: "idle",
    picture: "in_window",
    failure: null,
    nowPlaying: null,
    episode: null,
    position: null,
    duration: null,
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
  },
  preferences: { subtitleLanguage: null, subtitleColor: "#FFFFFF", subtitleScale: 1, streamBuffer: { seconds: 300, megabytes: 512 } },
  addons: [],
  featuredCatalog: null,
  protection: { backend: "keyring", tmdbHeld: false, stremioHeld: false },
  watchProgress: [],
  devices: [],
  pairingCode: "4K7Q2M",
  address: "192.168.1.9:8090",
};

describe("the Home hero and Continue watching art", () => {
  test("draws a slide from its backdrop, then a landscape poster, then its own words", () => {
    const slides = heroSlides([
      meta({ id: "tt1", name: "Backdrop", background: "https://images.test/backdrop.jpg" }),
      meta({
        id: "tt2",
        name: "Landscape",
        poster: "https://images.test/landscape.jpg",
        posterShape: "landscape",
      }),
      meta({
        id: "tt3",
        name: "Portrait",
        poster: "https://images.test/portrait.jpg",
        posterShape: "poster",
      }),
    ]);

    expect(slides).toEqual([
      {
        id: "tt1",
        type: "movie",
        name: "Backdrop",
        description: "A hacker learns the truth.",
        art: "https://images.test/backdrop.jpg",
        artKind: "background",
        poster: "https://images.test/matrix-poster.jpg",
        background: "https://images.test/backdrop.jpg",
      },
      {
        id: "tt2",
        type: "movie",
        name: "Landscape",
        description: "A hacker learns the truth.",
        art: "https://images.test/landscape.jpg",
        artKind: "landscape",
        poster: "https://images.test/landscape.jpg",
        background: null,
      },
      {
        id: "tt3",
        type: "movie",
        name: "Portrait",
        description: "A hacker learns the truth.",
        art: null,
        artKind: "text",
        poster: "https://images.test/portrait.jpg",
        background: null,
      },
    ]);
  });

  test("keeps at most the first four items of the Featured catalog's row", () => {
    const slides = heroSlides(
      Array.from({ length: 6 }, (_, index) => meta({ id: `tt${index}`, name: `Slide ${index}` })),
    );

    expect(slides.map((slide) => slide.id)).toEqual(["tt0", "tt1", "tt2", "tt3"]);
  });

  test("Continue watching prefers the card's backdrop, then its poster", () => {
    expect(continueArt(entry())).toBe("https://images.test/matrix-poster.jpg");
    expect(
      continueArt(
        entry({
          title: {
            addon: "com.linvo.cinemeta",
            id: "tt0133093",
            type: "movie",
            name: "The Matrix",
            poster: "https://images.test/matrix-poster.jpg",
            background: "https://images.test/matrix-backdrop.jpg",
          },
        }),
      ),
    ).toBe("https://images.test/matrix-backdrop.jpg");
    expect(
      continueArt(
        entry({
          title: {
            addon: "com.linvo.cinemeta",
            id: "tt0133093",
            type: "movie",
            name: "The Matrix",
            poster: null,
            background: null,
          },
        }),
      ),
    ).toBeNull();
  });

  test("the Featured row is the one the Host's preference names", () => {
    const addon = {
      id: "com.linvo.cinemeta",
      name: "Cinemeta",
      version: "1.0.0",
      resources: [],
      types: ["movie"],
      catalogs: [
        { type: "movie", id: "top", name: "Top", extra: [] },
        { type: "movie", id: "year", name: "By year", extra: [] },
      ],
      idPrefixes: ["tt"],
      behaviorHints: { configurable: false, configurationRequired: false },
    };
    const snapshot: Snapshot = {
      ...EMPTY,
      addons: [addon],
      featuredCatalog: {
        addon: addon.id,
        catalog: { type: "movie", id: "year" },
      },
    };
    const rows = [
      {
        addon: addon.id,
        type: "movie",
        id: "top",
        name: "Top",
        metas: [meta({ id: "tt1" })],
        offset: 1,
        failure: null,
        done: false,
      },
      {
        addon: addon.id,
        type: "movie",
        id: "year",
        name: "By year",
        metas: [meta({ id: "tt2" })],
        offset: 1,
        failure: null,
        done: false,
      },
    ];

    expect(featuredRow(snapshot, rows)?.id).toBe("year");
    expect(featuredRow({ ...snapshot, featuredCatalog: null }, rows)).toBeNull();
  });
});
