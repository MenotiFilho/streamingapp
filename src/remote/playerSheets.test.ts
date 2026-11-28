import { describe, expect, test } from "vitest";

import type { PlaybackSnapshot, Title, Video } from "../core/wire";
import {
  NO_EPISODES,
  PLAYER_SHEET_ID,
  PLAYER_SHEET_NAME,
  playerSheetLevel,
  remoteMenus,
  SHEET_TITLES,
  sheetEpisode,
  sheetLevelStale,
} from "./playerSheets";

/**
 * The fullscreen Remote's sheet decisions (#214, #364): the level a menu pushes,
 * the menus a Stream has, the words a sheet says, and how an episode row reads.
 * The rows of the other sheets are the core's and are tested there.
 */

const TITLE: Title = {
  addon: "cinemeta",
  id: "tt1",
  key: { kind: "addon", addon: "cinemeta", id: "tt1" },
  type: "series",
  name: "One",
  poster: null,
  background: null,
  logo: null,
  description: null,
  releaseInfo: null,
  runtime: null,
  imdbRating: null,
  genres: [],
  videos: [],
};

describe("a player sheet level", () => {
  test("is the core's popover, named once so a second sheet replaces it", () => {
    expect(playerSheetLevel("subtitles", TITLE)).toEqual({
      id: PLAYER_SHEET_ID,
      name: PLAYER_SHEET_NAME,
      kind: "popover",
      payload: { kind: "sheet", plate: "subtitles", title: TITLE },
    });
    expect(PLAYER_SHEET_NAME).toBe("Player sheet");
  });

  test("carries the sheet's heading as the dialog's name", () => {
    expect(SHEET_TITLES).toEqual({
      subtitles: "Audio & subtitles",
      picture: "Picture",
      streams: "Streams",
      episodes: "Episodes",
      speed: "Speed",
      chapters: "Chapters",
      details: "Details",
    });
  });
});

const EPISODE = { episode: { season: 1, episode: 2 } };
const FILM = { episode: null } satisfies Pick<PlaybackSnapshot, "episode">;

describe("the Remote's menus", () => {
  test("are the seven, in the sheet's order, for an episode", () => {
    expect(remoteMenus(EPISODE, false)).toEqual([
      "subtitles",
      "picture",
      "streams",
      "episodes",
      "speed",
      "chapters",
      "details",
    ]);
  });

  test("leave Episodes out of a film", () => {
    expect(remoteMenus(FILM, false)).not.toContain("episodes");
    expect(remoteMenus(FILM, false)).toHaveLength(6);
  });

  test("are only the ways to another Stream after a failed open", () => {
    expect(remoteMenus(EPISODE, true)).toEqual(["streams", "episodes"]);
    expect(remoteMenus(FILM, true)).toEqual(["streams"]);
  });
});

describe("a sheet over a failed open", () => {
  const sheet = (plate: keyof typeof SHEET_TITLES) => playerSheetLevel(plate, TITLE).payload;

  test("goes where its menu is no longer offered", () => {
    for (const plate of ["subtitles", "picture", "speed", "chapters", "details"] as const) {
      expect(sheetLevelStale(sheet(plate), EPISODE, true)).toBe(true);
    }
    expect(sheetLevelStale(sheet("episodes"), FILM, true)).toBe(true);
  });

  test("stays where it still leads to another Stream", () => {
    expect(sheetLevelStale(sheet("streams"), EPISODE, true)).toBe(false);
    expect(sheetLevelStale(sheet("streams"), FILM, true)).toBe(false);
    expect(sheetLevelStale(sheet("episodes"), EPISODE, true)).toBe(false);
  });

  test("is left alone while nothing failed, as is a level that is no sheet", () => {
    expect(sheetLevelStale(sheet("picture"), EPISODE, false)).toBe(false);
    expect(sheetLevelStale(sheet("picture"), null, false)).toBe(false);
    expect(sheetLevelStale({ kind: "player", title: null }, EPISODE, true)).toBe(false);
  });
});

describe("an episode's row", () => {
  const TODAY = new Date(Date.UTC(2026, 10, 28));
  const VIDEO: Video = {
    id: "tt1:1:2",
    name: "The Choice",
    season: 1,
    episode: 2,
    thumbnail: "https://images.test/2.jpg",
    airDate: "2025-01-24",
    description: "What happens.",
  };
  const playing = {
    nowPlaying: {
      video: { type: "series", id: "tt1:1:2" },
      addon: "torrentio",
      name: null,
      description: null,
      filename: null,
      bingeGroup: null,
    },
    duration: 600,
  };
  const idle = { ...playing, nowPlaying: null };

  test("splits the number, title, date and description", () => {
    expect(sheetEpisode(VIDEO, idle, [], null, TODAY)).toEqual({
      number: "E2",
      title: "The Choice",
      date: "24 Jan 2025",
      description: "What happens.",
      still: "https://images.test/2.jpg",
      code: "S1E2",
      playing: false,
      progress: null,
    });
  });

  test("marks the one playing, with how far it is", () => {
    expect(sheetEpisode(VIDEO, playing, [], 150, TODAY)).toMatchObject({
      number: "E2 · PLAYING",
      playing: true,
      progress: 0.25,
    });
  });

  test("reads another episode's progress from Watch progress", () => {
    const entry = {
      video: VIDEO,
      title: { addon: null, id: "tt1", type: "series", name: "One", poster: null },
      position: 300,
      duration: 600,
      watched: false,
      unplayable: null,
    };

    expect(sheetEpisode(VIDEO, idle, [entry], null, TODAY).progress).toBe(0.5);
  });

  test("names an episode its Addon left unnamed", () => {
    const unnamed = { ...VIDEO, name: null };

    expect(sheetEpisode(unnamed, idle, [], null, TODAY).title).toBe("Episode 2");
    expect(
      sheetEpisode({ ...unnamed, season: null, episode: null }, idle, [], null, TODAY),
    ).toMatchObject({ number: "Episode", title: "tt1:1:2", code: null });
  });
});

describe("the Episodes sheet's words", () => {
  test("says so where the Title lists no seasons", () => {
    expect(NO_EPISODES).toBe("No episodes are available for the playing series.");
  });
});
