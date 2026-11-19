import { describe, expect, test } from "vitest";

import {
  endOfPlaybackDecision,
  hasAired,
  hasAiredNextEpisode,
  matchesTitleIdentity,
  nextVideo,
  utcDay,
} from "./endOfPlayback";
import type {
  ContinueEntry,
  NowPlaying,
  PlaybackSnapshot,
  Snapshot,
  Video,
} from "./wire";

const TODAY = new Date("2026-11-19T12:00:00Z");

function video(overrides: Partial<Video> = {}): Video {
  return {
    id: "tt7777777:1:1",
    name: "Episode",
    season: 1,
    episode: 1,
    thumbnail: null,
    airDate: "2026-11-01",
    ...overrides,
  };
}

function nowPlaying(overrides: Partial<NowPlaying> = {}): NowPlaying {
  return {
    video: { type: "series", id: "tt7777777:1:1" },
    addon: "cinemeta",
    name: "1080p",
    description: null,
    filename: null,
    bingeGroup: null,
    ...overrides,
  };
}

function playback(overrides: Partial<PlaybackSnapshot> = {}): PlaybackSnapshot {
  return {
    state: "ended",
    autoplay: null,
    picture: "in_window",
    failure: null,
    nowPlaying: nowPlaying(),
    episode: { season: 1, episode: 1 },
    position: 2800,
    duration: 2800,
    buffered: null,
    tracks: [],
    chapters: [],
    chapter: null,
    speed: 1,
    volume: 100,
    muted: false,
    subtitleDelay: 0,
    stalled: false,
    torrent: null,
    crop: null,
    aspect: null,
    resolution: null,
    statistics: null,
    ...overrides,
  };
}

function snapshot(
  playbackOverrides: Partial<PlaybackSnapshot> = {},
  options: { autoplayPreference?: boolean; continueWatching?: ContinueEntry[] } = {},
): Pick<Snapshot, "playback" | "preferences" | "watchProgress" | "continueWatching"> {
  return {
    playback: playback(playbackOverrides),
    preferences: {
      subtitleLanguages: [],
      audioLanguages: [],
      subtitleColor: "#FFFFFF",
      subtitleScale: 1,
      streamBuffer: { seconds: 300, megabytes: 512 },
      torrentCache: { megabytes: 2000 },
      upNextPlayback: "direct",
      autoplay: options.autoplayPreference ?? true,
    },
    watchProgress: [],
    continueWatching: options.continueWatching ?? [],
  };
}

function continueEntry(overrides: Partial<ContinueEntry> = {}): ContinueEntry {
  return {
    video: video({ id: "tt7777777:1:2", season: 1, episode: 2, airDate: "2026-11-10" }),
    title: {
      addon: "cinemeta",
      id: "tt7777777",
      type: "series",
      name: "A Series",
      poster: null,
      background: null,
    },
    position: null,
    duration: null,
    watched: false,
    upNext: true,
    unplayable: null,
    ...overrides,
  };
}

describe("endOfPlaybackDecision", () => {
  test("stays when mounting an already-ended Snapshot or staying on ended", () => {
    const endedFilm = snapshot({
      episode: null,
      nowPlaying: nowPlaying({ video: { type: "movie", id: "tt0133093" } }),
    });

    expect(endOfPlaybackDecision(null, endedFilm, TODAY)).toEqual({ kind: "stay" });
    expect(endOfPlaybackDecision("idle", endedFilm, TODAY)).toEqual({ kind: "stay" });
    expect(endOfPlaybackDecision("ended", endedFilm, TODAY)).toEqual({ kind: "stay" });
  });

  test("returns to the Title page when a movie finishes, whether Autoplay is on or off", () => {
    const filmNowPlaying = nowPlaying({ video: { type: "movie", id: "tt0133093" } });

    for (const autoplayPreference of [true, false]) {
      const decision = endOfPlaybackDecision(
        "playing",
        snapshot({ episode: null, nowPlaying: filmNowPlaying }, { autoplayPreference }),
        TODAY,
      );
      expect(decision).toEqual({
        kind: "return",
        ref: {
          kind: "addon",
          addon: "cinemeta",
          title: { type: "movie", id: "tt0133093" },
          cache: "cinemeta|movie|tt0133093",
        },
      });
    }
  });

  test("returns when a paused movie reaches ended", () => {
    const decision = endOfPlaybackDecision(
      "paused",
      snapshot({
        episode: null,
        nowPlaying: nowPlaying({ video: { type: "movie", id: "tmdb:603" } }),
      }),
      TODAY,
    );

    expect(decision).toEqual({
      kind: "return",
      ref: {
        kind: "discovered",
        key: { kind: "tmdb", id: 603 },
        type: "movie",
        fallbackAddon: "cinemeta",
        cache: "tmdb|movie|603",
      },
    });
  });

  test("stays when the Host armed an Autoplay countdown or hold", () => {
    const decision = endOfPlaybackDecision(
      "playing",
      snapshot({
        autoplay: {
          next: {
            title: { type: "series", id: "tt7777777" },
            video: { type: "series", id: "tt7777777:1:2" },
            episode: { season: 1, episode: 2 },
            name: "Two",
            still: null,
          },
          phase: "countdown",
          remaining: 5,
          duration: 5,
        },
      }),
      TODAY,
    );

    expect(decision).toEqual({ kind: "stay" });
  });

  test("returns when a series ends with Autoplay on and the Host armed nothing", () => {
    const decision = endOfPlaybackDecision("playing", snapshot({ autoplay: null }), TODAY);

    expect(decision).toEqual({
      kind: "return",
      ref: {
        kind: "addon",
        addon: "cinemeta",
        title: { type: "series", id: "tt7777777" },
        cache: "cinemeta|series|tt7777777",
      },
    });
  });

  test("with Autoplay off (Wait), stays when Continue watching shows an aired Up next", () => {
    const decision = endOfPlaybackDecision(
      "playing",
      snapshot(
        { autoplay: null },
        {
          autoplayPreference: false,
          continueWatching: [
            continueEntry({
              video: video({ id: "tt7777777:1:2", season: 1, episode: 2, airDate: "2026-11-19" }),
            }),
          ],
        },
      ),
      TODAY,
    );

    expect(decision).toEqual({ kind: "stay" });
  });

  test("with Autoplay off (Wait), returns when Continue watching shows an unaired Up next", () => {
    const decision = endOfPlaybackDecision(
      "playing",
      snapshot(
        { autoplay: null },
        {
          autoplayPreference: false,
          continueWatching: [
            continueEntry({
              video: video({ id: "tt7777777:1:2", season: 1, episode: 2, airDate: "2026-11-20" }),
            }),
          ],
        },
      ),
      TODAY,
    );

    expect(decision.kind).toBe("return");
  });

  test("with Autoplay off (Wait) and no Up next entry yet, asks to check the Title", () => {
    const decision = endOfPlaybackDecision(
      "playing",
      snapshot({ autoplay: null }, { autoplayPreference: false, continueWatching: [] }),
      TODAY,
    );

    expect(decision.kind).toBe("check_title");
  });
});

describe("nextVideo and air date checks", () => {
  test("utcDay formats the calendar date in UTC", () => {
    expect(utcDay(new Date("2026-11-19T23:59:59Z"))).toBe("2026-11-19");
    expect(utcDay(new Date("2026-11-20T00:00:00Z"))).toBe("2026-11-20");
  });

  test("hasAired treats undated, past, and today as aired, and tomorrow as unaired", () => {
    expect(hasAired({ airDate: null }, TODAY)).toBe(true);
    expect(hasAired({ airDate: "2026-11-18" }, TODAY)).toBe(true);
    expect(hasAired({ airDate: "2026-11-19" }, TODAY)).toBe(true);
    expect(hasAired({ airDate: "2026-11-20" }, TODAY)).toBe(false);
  });

  test("nextVideo crosses numbered seasons, does not cross into specials, and handles the last episode", () => {
    const videos: Video[] = [
      video({ id: "s:0:1", season: 0, episode: 1, airDate: "2026-01-01" }),
      video({ id: "s:2:1", season: 2, episode: 1, airDate: "2026-11-25" }),
      video({ id: "s:1:1", season: 1, episode: 1, airDate: "2026-01-01" }),
      video({ id: "s:1:2", season: 1, episode: 2, airDate: "2026-01-08" }),
    ];

    expect(nextVideo(videos, "s:1:1")?.id).toBe("s:1:2");
    expect(nextVideo(videos, "s:1:2")?.id).toBe("s:2:1");
    expect(nextVideo(videos, "s:2:1")).toBeNull();
    expect(nextVideo(videos, "s:0:1")).toBeNull();

    expect(hasAiredNextEpisode(videos, "s:1:1", TODAY)).toBe(true);
    expect(hasAiredNextEpisode(videos, "s:1:2", TODAY)).toBe(false);
    expect(hasAiredNextEpisode(videos, "s:2:1", TODAY)).toBe(false);
  });
});

describe("matchesTitleIdentity", () => {
  test("matches Addon titles by type and id", () => {
    const ref = {
      kind: "addon" as const,
      addon: "cinemeta",
      title: { type: "movie", id: "tt0133093" },
      cache: "cinemeta|movie|tt0133093",
    };

    expect(
      matchesTitleIdentity({ type: "movie", id: "tt0133093", key: { kind: "tmdb", id: 603 } }, ref),
    ).toBe(true);
    expect(
      matchesTitleIdentity(
        { type: "series", id: "tt0133093", key: { kind: "tmdb", id: 603 } },
        ref,
      ),
    ).toBe(false);
  });

  test("matches discovered titles by tmdb id or canonical TMDB key", () => {
    const ref = {
      kind: "discovered" as const,
      key: { kind: "tmdb" as const, id: 603 },
      type: "movie",
      fallbackAddon: "cinemeta",
      cache: "tmdb|movie|603",
    };

    expect(
      matchesTitleIdentity({ type: "movie", id: "tmdb:603", key: { kind: "tmdb", id: 603 } }, ref),
    ).toBe(true);
    expect(
      matchesTitleIdentity({ type: "movie", id: "tt0133093", key: { kind: "tmdb", id: 603 } }, ref),
    ).toBe(true);
    expect(
      matchesTitleIdentity({ type: "movie", id: "tmdb:604", key: { kind: "tmdb", id: 604 } }, ref),
    ).toBe(false);
  });
});
