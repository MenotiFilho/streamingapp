import { describe, expect, it } from "vitest";

import type { Row } from "./browse";
import {
  MARQUEE_HERO_SLIDES,
  formatNavClock,
  heroDisplayFor,
  heroModeForFocus,
  heroRotatesInMode,
  heroTransitionOnFocus,
  heroWatchIntent,
  marqueeHeroSlides,
  marqueeHomeEmptyState,
  railOpensOn,
  railShouldExpand,
  shouldReturnToRotatingHero,
  wideCardNote,
} from "./homeHero";
import type { ContinueEntry, MetaPreview, Snapshot } from "./wire";

function meta(overrides: Partial<MetaPreview> = {}): MetaPreview {
  return {
    id: "tt1",
    type: "movie",
    name: "Dune: Part Two",
    poster: "https://images.test/dune-poster.jpg",
    posterShape: "poster",
    background: "https://images.test/dune-bg.jpg",
    releaseInfo: "2024",
    imdbRating: "8.4",
    genres: ["Action", "Adventure", "Drama"],
    description: "Paul Atreides unites with the Fremen.",
    ...overrides,
  };
}

function continueEntry(overrides: Partial<ContinueEntry> = {}): ContinueEntry {
  return {
    video: {
      id: "tt3582092:2:4",
      name: "Episode 4",
      season: 2,
      episode: 4,
      thumbnail: "https://images.test/tlou-still.jpg",
      airDate: null,
      description: null,
    },
    title: {
      addon: "cinemeta",
      id: "tt3582092",
      type: "series",
      name: "The Last of Us",
      poster: "https://images.test/tlou-poster.jpg",
      background: "https://images.test/tlou-bg.jpg",
      logo: "https://images.test/tlou-logo.png",
    },
    position: 2400,
    duration: 3360,
    watched: false,
    upNext: false,
    unplayable: null,
    ...overrides,
  };
}

const SNAPSHOT: Snapshot = {
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
    subtitleLanguages: [],
    audioLanguages: [],
    subtitleColor: "#FFFFFF",
    subtitleScale: 1,
    streamBuffer: { seconds: 300, megabytes: 512 },
    torrentCache: { megabytes: 2000 },
    upNextPlayback: "direct",
    autoplay: true,
  },
  addons: [],
  featuredCatalog: null,
  protection: { backend: "file", tmdbHeld: false, stremioHeld: false },
  continueWatching: [],
  watchProgress: [],
  devices: [],
  pairingCode: "----",
  address: null,
};

describe("Marquee nav rail expansion decisions (ADR-0037)", () => {
  it("opens on navigation focus and stays collapsed on pointer focus", () => {
    expect(railOpensOn("navigation")).toBe(true);
    expect(railOpensOn("pointer")).toBe(false);
  });

  it("expands on hover regardless of modality, and on focus only in navigation", () => {
    expect(railShouldExpand({ hovered: true, focusedInRail: false, modality: "pointer" })).toBe(
      true,
    );
    expect(railShouldExpand({ hovered: false, focusedInRail: true, modality: "navigation" })).toBe(
      true,
    );
    expect(railShouldExpand({ hovered: false, focusedInRail: true, modality: "pointer" })).toBe(
      false,
    );
    expect(
      railShouldExpand({ hovered: false, focusedInRail: false, modality: "navigation" }),
    ).toBe(false);
  });

  it("formats the rail foot clock in 24-hour HH:MM", () => {
    expect(formatNavClock(new Date(2026, 10, 27, 21, 42))).toBe("21:42");
  });
});

describe("Marquee hero mode, rotation and following focus", () => {
  it("keeps up to five featured slides", () => {
    expect(MARQUEE_HERO_SLIDES).toBe(5);
    const slides = marqueeHeroSlides(
      Array.from({ length: 8 }, (_, index) => meta({ id: `tt${index}`, name: `Film ${index}` })),
    );
    expect(slides.map((slide) => slide.id)).toEqual(["tt0", "tt1", "tt2", "tt3", "tt4"]);
  });

  it("switches to following focus when a row card is focused and back on hero actions", () => {
    const target = { kind: "continue", entry: continueEntry() } as const;

    expect(heroModeForFocus(true, null)).toBe("rotating");
    expect(heroModeForFocus(true, target)).toBe("following");
    expect(heroModeForFocus(false, target)).toBe("rotating");

    // Entering the rail keeps the hero's current target steady behind the dim.
    expect(heroTransitionOnFocus(target, { kind: "rail" })).toBe(target);
    expect(heroTransitionOnFocus(target, { kind: "hero-action" })).toBeNull();

    const catalogTarget = { kind: "catalog", addon: "cinemeta", meta: meta() } as const;
    expect(heroTransitionOnFocus(null, { kind: "row-card", target: catalogTarget })).toBe(
      catalogTarget,
    );
  });

  it("rotates only in rotating mode when multiple slides exist and nothing holds it", () => {
    expect(heroRotatesInMode(5, "rotating", false)).toBe(true);
    expect(heroRotatesInMode(1, "rotating", false)).toBe(false);
    expect(heroRotatesInMode(5, "following", false)).toBe(false);
    expect(heroRotatesInMode(5, "rotating", true)).toBe(false);
  });

  it("returns to rotating hero only on Up from the topmost focusable row", () => {
    expect(
      shouldReturnToRotatingHero({
        mode: "following",
        activeRowId: "home-continue",
        firstFocusableRowId: "home-continue",
      }),
    ).toBe(true);
    expect(
      shouldReturnToRotatingHero({
        mode: "following",
        activeRowId: "home-row:cinemeta/movie/top",
        firstFocusableRowId: "home-continue",
      }),
    ).toBe(false);
    expect(
      shouldReturnToRotatingHero({
        mode: "rotating",
        activeRowId: "home-continue",
        firstFocusableRowId: "home-continue",
      }),
    ).toBe(false);
  });

  it("resolves Continue watching wordmark logo and enriches meta from loaded rows when present", () => {
    const entry = continueEntry();
    const row: Row = {
      addon: "cinemeta",
      type: "series",
      id: "top",
      name: "Popular series",
      offset: 1,
      done: true,
      failure: null,
      metas: [
        meta({
          id: "tt3582092",
          type: "series",
          name: "The Last of Us",
          releaseInfo: "2023–",
          imdbRating: "8.4",
          genres: ["Action", "Adventure", "Drama"],
          description: "After a global pandemic destroys civilization.",
        }),
      ],
    };

    const display = heroDisplayFor({
      mode: "following",
      rotatingItem: meta(),
      target: { kind: "continue", entry },
      continueWatching: [entry],
      rows: [row],
    });

    expect(display).toMatchObject({
      mode: "following",
      name: "The Last of Us",
      logo: "https://images.test/tlou-logo.png",
      backdrop: "https://images.test/tlou-bg.jpg",
      poster: null,
      meta: {
        rating: "8.4",
        year: "2023–",
        genres: ["Action", "Adventure", "Drama"],
      },
      synopsis: "After a global pandemic destroys civilization.",
    });
  });

  it("never stretches a portrait poster into the hero backdrop fallback", () => {
    const portraitOnly = meta({ id: "tt9", background: null, posterShape: "poster" });
    const display = heroDisplayFor({
      mode: "following",
      rotatingItem: null,
      target: { kind: "catalog", addon: "cinemeta", meta: portraitOnly },
      continueWatching: [],
      rows: [],
    });

    expect(display?.backdrop).toBeNull();
    expect(display?.poster).toBeNull();
  });

  it("resumes on Watch now when a resumable Continue watching entry exists, else opens Title", () => {
    const featuredMovie = meta({ id: "tt3582092", type: "series" });
    expect(heroWatchIntent(featuredMovie, "cinemeta", [continueEntry()])).toEqual({
      kind: "resume",
      action: { type: "resume", video: { type: "series", id: "tt3582092:2:4" } },
    });

    const unplayableEntry = continueEntry({
      unplayable: { reason: "addon_disabled", addon: "cinemeta" },
    });
    expect(heroWatchIntent(featuredMovie, "cinemeta", [unplayableEntry])).toEqual({
      kind: "open_title",
      addon: "cinemeta",
      preview: featuredMovie,
    });
  });
});

describe("Continue watching captions and empty states (ADR-0044 §2)", () => {
  it("formats episode + remaining time, Up next, and both unplayable reasons", () => {
    expect(wideCardNote(continueEntry({ position: 2400, duration: 3360 }))).toBe(
      "S2 E4 · 16 min left",
    );
    expect(
      wideCardNote(
        continueEntry({
          video: { id: "tt9", name: null, season: null, episode: null, thumbnail: null, airDate: null },
          position: 100,
          duration: 6760,
        }),
      ),
    ).toBe("1 h 51 min left");
    expect(
      wideCardNote(
        continueEntry({
          video: { id: "tt5:1:5", name: null, season: 1, episode: 5, thumbnail: null, airDate: null },
          position: null,
          duration: null,
          upNext: true,
        }),
      ),
    ).toBe("S1 E5 · Up next");
    expect(
      wideCardNote(
        continueEntry({
          unplayable: { reason: "addon_disabled", addon: "cinemeta" },
        }),
      ),
    ).toBe("S2 E4 · Unplayable · Addon disabled");
    expect(
      wideCardNote(
        continueEntry({
          video: { id: "tt9", name: null, season: null, episode: null, thumbnail: null, airDate: null },
          unplayable: { reason: "addon_removed", addon: "cinemeta" },
        }),
      ),
    ).toBe("Unplayable · Addon removed");
  });

  it("names why Home has no rows and offers Addons as the one way out", () => {
    expect(marqueeHomeEmptyState(null, 0)).toBeNull();
    expect(marqueeHomeEmptyState(SNAPSHOT, 1)).toBeNull();
    expect(marqueeHomeEmptyState(SNAPSHOT, 0)).toEqual({
      title: "No Addons configured",
      body: "Add an Addon to browse Catalogs on Home.",
      action: "addons",
    });
    expect(
      marqueeHomeEmptyState(
        {
          ...SNAPSHOT,
          addons: [
            {
              id: "cinemeta",
              name: "Cinemeta",
              version: "1.0.0",
              resources: [],
              types: [],
              catalogs: [],
              idPrefixes: [],
              behaviorHints: { configurable: false, configurationRequired: false },
              enabled: false,
            },
          ],
        },
        0,
      ),
    ).toEqual({
      title: "No Catalogs available",
      body: "Enable an Addon with a Catalog, or add one in Addons.",
      action: "addons",
    });
  });
});
