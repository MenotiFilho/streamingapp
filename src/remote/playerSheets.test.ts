import { describe, expect, test } from "vitest";

import {
  audioSection,
  pictureSections,
  subtitleSections,
} from "../core/playerPanels";
import type { PlaybackSnapshot, Title } from "../core/wire";
import {
  episodeLabel,
  NO_EPISODES,
  PLAYER_SHEET_ID,
  PLAYER_SHEET_NAME,
  playerSheetLevel,
  SHEET_TITLES,
  sheetGroups,
} from "./playerSheets";

/**
 * The Remote player's sheet decisions (#214): the level a card control pushes,
 * the words a plate says, and how an episode is named. The rows themselves are
 * the core's and are tested there.
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



const PLAYBACK: PlaybackSnapshot = {
  state: "playing",
  picture: "in_window",
  failure: null,
  nowPlaying: null,
  episode: null,
  position: 0,
  duration: null,
  buffered: null,
  tracks: [],
  chapters: [],
  chapter: null,
  speed: 1,
  volume: 100,
  muted: false,
  subtitleDelay: 0,
  crop: null,
  aspect: null,
  resolution: null,
  statistics: null,
};

describe("a player sheet level", () => {
  test("is the core's popover, named once so a second plate replaces it", () => {
    expect(playerSheetLevel("audio", TITLE)).toEqual({
      id: PLAYER_SHEET_ID,
      name: PLAYER_SHEET_NAME,
      kind: "popover",
      payload: { kind: "sheet", plate: "audio", title: TITLE },
    });
    expect(PLAYER_SHEET_NAME).toBe("Player sheet");
  });

  test("carries the plate's heading as the dialog's name", () => {
    expect(SHEET_TITLES).toEqual({
      audio: "Audio & Subtitles",
      picture: "Picture",
      speed: "Speed",
      chapters: "Chapters",
      episodes: "Episodes",
    });
  });
});

describe("the groups a plate draws", () => {
  test("Audio & Subtitles is the audio section first, then the subtitle sections in the core's order", () => {
    expect(sheetGroups("audio", PLAYBACK, 1, false)).toEqual([
      audioSection(PLAYBACK),
      ...subtitleSections(PLAYBACK, 1),
    ]);
  });

  test("Picture is the core's sections with this client's statistics state", () => {
    expect(sheetGroups("picture", PLAYBACK, 1, true)).toEqual(
      pictureSections(PLAYBACK, true),
    );
    expect(sheetGroups("picture", PLAYBACK, 1, false)).toEqual(
      pictureSections(PLAYBACK, false),
    );
  });

  test("the Episodes plate is not a set of panel groups", () => {
    expect(sheetGroups("episodes", PLAYBACK, 1, false)).toEqual([]);
  });
});

describe("the Episodes plate's words", () => {


  test("says so where the Title lists no seasons", () => {
    expect(NO_EPISODES).toBe("No episodes are available for the playing series.");
  });
});

describe("an episode's row name", () => {
  test("is its number and the Addon's own title", () => {
    expect(
      episodeLabel({
        id: "tt1:1:2",
        name: "Cat's in the Bag...",
        season: 1,
        episode: 2,
        thumbnail: null,
      }),
    ).toBe("S1E2 · Cat's in the Bag...");
  });

  test("falls back to the name, then the id, where the Addon gave no number", () => {
    expect(
      episodeLabel({ id: "tt1", name: "One", season: null, episode: null, thumbnail: null }),
    ).toBe("One");
    expect(
      episodeLabel({ id: "tt1", name: null, season: null, episode: null, thumbnail: null }),
    ).toBe("tt1");
  });
});
