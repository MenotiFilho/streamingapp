import { describe, expect, it } from "vitest";

import {
  episodeAirNote,
  episodeProgress,
  titleActionsModel,
  titleBackdropCandidates,
  titleInitialFocusTarget,
} from "./marqueeTitle";
import type { ContinueEntry, ResumeEntry, Title, Video } from "./wire";

const EP1: Video = {
  id: "tt1:1:1",
  name: "Hello, Ms. Cobel",
  season: 1,
  episode: 1,
  thumbnail: "https://images.test/ep1.jpg",
  airDate: "2025-01-17",
  description: "Mark returns to work under different circumstances.",
};

const EP2: Video = {
  id: "tt1:1:2",
  name: "Goodbye, Mrs. Selvig",
  season: 1,
  episode: 2,
  thumbnail: "https://images.test/ep2.jpg",
  airDate: "2025-01-24",
  description: "Mark contemplates the meaning of a message.",
};

const SERIES: Title = {
  addon: "cinemeta",
  id: "tt1",
  key: { kind: "addon", addon: "cinemeta", id: "tt1" },
  type: "series",
  name: "Severance",
  poster: "https://images.test/poster.jpg",
  background: "https://images.test/backdrop.jpg",
  logo: "https://images.test/logo.png",
  description: "Mark leads a team of office workers.",
  releaseInfo: "2022–",
  runtime: "49 min",
  imdbRating: "8.6",
  genres: ["Drama", "Mystery", "Sci-Fi"],
  videos: [EP1, EP2],
};

const FILM: Title = {
  ...SERIES,
  id: "tt2",
  key: { kind: "tmdb", id: 603 },
  type: "movie",
  name: "The Matrix",
  videos: [],
};

function continueEntry(overrides: Partial<ContinueEntry> = {}): ContinueEntry {
  return {
    video: EP2,
    title: {
      addon: "cinemeta",
      id: "tt1",
      type: "series",
      name: "Severance",
      poster: null,
      background: null,
    },
    position: 600,
    duration: 2400,
    watched: false,
    upNext: false,
    unplayable: null,
    ...overrides,
  };
}

describe("titleActionsModel", () => {
  it("provides Resume and secondary Choose stream for a partly-watched series", () => {
    const model = titleActionsModel({
      title: SERIES,
      continueWatching: [continueEntry()],
      upNextPlayback: "direct",
    });

    expect(model.main).toMatchObject({
      kind: "resume",
      label: "Resume S1E2 · 30 min left",
      action: { type: "resume", video: { type: "series", id: "tt1:1:2" } },
    });
    expect(model.chooseStream).toEqual({ video: EP2, primary: false });
  });

  it("provides Play Up next and secondary Choose stream targeting the Up next episode", () => {
    const model = titleActionsModel({
      title: SERIES,
      continueWatching: [continueEntry({ position: null, duration: null, upNext: true })],
      upNextPlayback: "direct",
    });

    expect(model.main).toMatchObject({
      kind: "play",
      label: "Play S1E2",
      video: EP2,
      action: { type: "play_up_next", title: { type: "series", id: "tt1" } },
    });
    expect(model.chooseStream).toEqual({ video: EP2, primary: false });
  });

  it("makes Choose stream primary when a series has no Continue watching entry", () => {
    const model = titleActionsModel({
      title: SERIES,
      continueWatching: [],
      upNextPlayback: "direct",
    });

    expect(model.main).toBeNull();
    expect(model.chooseStream).toEqual({ video: EP1, primary: true });
  });

  it("tracks the selected episode when choosing a stream without Continue watching", () => {
    const model = titleActionsModel({
      title: SERIES,
      continueWatching: [],
      upNextPlayback: "direct",
      selectedVideo: EP2,
    });

    expect(model.chooseStream).toEqual({ video: EP2, primary: true });
  });

  it("omits Choose stream for a series with no listed episodes", () => {
    const emptySeries: Title = { ...SERIES, videos: [] };
    const model = titleActionsModel({
      title: emptySeries,
      continueWatching: [],
      upNextPlayback: "direct",
    });

    expect(model.side.kind).toBe("series-empty");
    expect(model.chooseStream).toBeNull();
  });

  it("provides primary Choose stream for an unstarted film, and Resume + secondary Choose stream when partly watched", () => {
    const unstarted = titleActionsModel({
      title: FILM,
      continueWatching: [],
      upNextPlayback: "direct",
    });
    expect(unstarted.main).toBeNull();
    expect(unstarted.chooseStream).toEqual({
      video: { id: "tmdb:603", name: null, season: null, episode: null, thumbnail: null, airDate: null },
      primary: true,
    });

    const resuming = titleActionsModel({
      title: FILM,
      continueWatching: [
        continueEntry({
          video: { id: "tmdb:603", name: null, season: null, episode: null, thumbnail: null, airDate: null },
          title: { addon: "cinemeta", id: "tt2", type: "movie", name: "The Matrix", poster: null },
        }),
      ],
      upNextPlayback: "direct",
    });
    expect(resuming.main?.kind).toBe("resume");
    expect(resuming.chooseStream?.primary).toBe(false);
    expect(resuming.chooseStream?.video.id).toBe("tmdb:603");
  });
});

describe("titleBackdropCandidates", () => {
  it("deduplicates and orders Title background, preview background, Title poster, preview poster", () => {
    expect(
      titleBackdropCandidates(SERIES, {
        name: "Severance",
        poster: "https://images.test/poster.jpg",
        background: "https://images.test/preview-bg.jpg",
      }),
    ).toEqual([
      "https://images.test/backdrop.jpg",
      "https://images.test/preview-bg.jpg",
      "https://images.test/poster.jpg",
    ]);

    expect(
      titleBackdropCandidates(
        { ...SERIES, background: null, poster: null },
        { name: "Severance", poster: "https://images.test/p.jpg", background: null },
      ),
    ).toEqual(["https://images.test/p.jpg"]);
  });
});

describe("episodeAirNote", () => {
  const today = new Date(Date.UTC(2025, 1, 1));

  it("announces future episodes with Airs and formats past air dates", () => {
    expect(episodeAirNote({ ...EP1, airDate: "2026-11-12" }, today)).toBe("Airs 12 Nov");
    expect(episodeAirNote(EP1, today)).toBe("17 Jan 2025");
  });

  it("returns null for missing or invalid dates", () => {
    expect(episodeAirNote({ ...EP1, airDate: null }, today)).toBeNull();
    expect(episodeAirNote({ ...EP1, airDate: "2025-02-30" }, today)).toBeNull();
    expect(episodeAirNote({ ...EP1, airDate: "not-a-date" }, today)).toBeNull();
  });
});

describe("episodeProgress", () => {
  it("reports watched and clamped partial progress from Watch progress", () => {
    const entries: ResumeEntry[] = [
      {
        video: EP1,
        title: { addon: "cinemeta", id: "tt1", type: "series", name: "Severance", poster: null },
        position: 2400,
        duration: 2400,
        watched: true,
        unplayable: null,
      },
      {
        video: EP2,
        title: { addon: "cinemeta", id: "tt1", type: "series", name: "Severance", poster: null },
        position: 900,
        duration: 2400,
        watched: false,
        unplayable: null,
      },
    ];

    expect(episodeProgress(EP1.id, entries)).toEqual({ watched: true, progress: null });
    expect(episodeProgress(EP2.id, entries)).toEqual({ watched: false, progress: 0.375 });
    expect(episodeProgress("tt1:1:3", entries)).toEqual({ watched: false, progress: null });
  });
});

describe("titleInitialFocusTarget", () => {
  it("prefers anchored episode, then main CTA, then Choose stream, then Back", () => {
    expect(
      titleInitialFocusTarget({ main: null, hasChooseStream: true, anchoredVideo: EP2 }),
    ).toBe("episode");
    expect(
      titleInitialFocusTarget({
        main: { kind: "resume", label: "Resume", action: { type: "resume", video: { type: "movie", id: "tt2" } } },
        hasChooseStream: true,
        anchoredVideo: null,
      }),
    ).toBe("main");
    expect(
      titleInitialFocusTarget({ main: null, hasChooseStream: true, anchoredVideo: null }),
    ).toBe("choose-stream");
    expect(
      titleInitialFocusTarget({ main: null, hasChooseStream: false, anchoredVideo: null }),
    ).toBe("back");
  });
});
