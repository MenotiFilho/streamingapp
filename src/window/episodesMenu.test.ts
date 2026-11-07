import { describe, expect, test } from "vitest";

import type { PlaybackSnapshot, Video } from "../core/wire";
import {
  episodesMenuVisible,
  osdEpisodeLabel,
  playingVideoId,
} from "./episodesMenu";

function playback(overrides: Partial<PlaybackSnapshot> = {}): PlaybackSnapshot {
  return {
    state: "playing",
    picture: "in_window",
    failure: null,
    nowPlaying: {
      video: { type: "movie", id: "tt0133093" },
      addon: "community.aiostreams",
      name: "AIOStreams\n4K",
      description: null,
      filename: null,
      bingeGroup: null,
    },
    episode: null,
    position: 900,
    duration: 3600,
    buffered: null,
    tracks: [],
    chapters: [],
    chapter: null,
    speed: 1,
    volume: 60,
    muted: false,
    subtitleDelay: 0,
    crop: null,
    aspect: null,
    resolution: null,
    statistics: null,
    ...overrides,
  };
}

function video(overrides: Partial<Video> = {}): Video {
  return {
    id: "tt7777777:1:2",
    name: "Episode Two",
    season: 1,
    episode: 2,
    thumbnail: null,
    airDate: null,
    ...overrides,
  };
}

describe("the OSD's Episodes menu", () => {
  test("is not drawn for a film", () => {
    expect(episodesMenuVisible(playback())).toBe(false);
    expect(episodesMenuVisible(null)).toBe(false);
  });

  test("is drawn for a series whose Video carries an episode mark", () => {
    expect(
      episodesMenuVisible(
        playback({
          episode: { season: 1, episode: 2 },
          nowPlaying: {
            video: { type: "series", id: "tt7777777:1:2" },
            addon: "community.aiostreams",
            name: null,
            description: null,
            filename: null,
            bingeGroup: null,
          },
        }),
      ),
    ).toBe(true);
  });

  test("is drawn for a series the Snapshot types even with no episode mark yet", () => {
    expect(
      episodesMenuVisible(
        playback({
          nowPlaying: {
            video: { type: "series", id: "tt7777777:1:2" },
            addon: "community.aiostreams",
            name: null,
            description: null,
            filename: null,
            bingeGroup: null,
          },
        }),
      ),
    ).toBe(true);
  });
});

describe("the playing episode", () => {
  test("is the Video the Snapshot names, so its row can be marked", () => {
    expect(
      playingVideoId(
        playback({
          episode: { season: 1, episode: 2 },
          nowPlaying: {
            video: { type: "series", id: "tt7777777:1:2" },
            addon: "community.aiostreams",
            name: null,
            description: null,
            filename: null,
            bingeGroup: null,
          },
        }),
      ),
    ).toBe("tt7777777:1:2");
    expect(playingVideoId(playback())).toBe("tt0133093");
    expect(playingVideoId(null)).toBeNull();
  });
});

describe("an episode row's name", () => {
  test("is its number and the Addon's title, and the id where there is neither", () => {
    expect(osdEpisodeLabel(video())).toBe("S1E2 · Episode Two");
    expect(osdEpisodeLabel(video({ name: null }))).toBe("S1E2 · tt7777777:1:2");
    expect(
      osdEpisodeLabel(video({ id: "tt7777777:x", name: null, season: null, episode: null })),
    ).toBe("tt7777777:x");
  });
});
