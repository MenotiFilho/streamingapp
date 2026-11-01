import { describe, expect, test } from "vitest";

import { playbackView } from "../core/playbackView";
import type { PlaybackSnapshot, Title } from "../core/wire";
import {
  CARD_NAME,
  playerLevel,
  playerLevelStale,
  seekTo,
  setMuted,
  setVolume,
  stripControls,
  timelineRange,
  trackFills,
  volumeRange,
} from "./playerScreen";

/**
 * The Remote player's own decisions (#213, ADR-0035 §2).
 *
 * The playback facts are the core's and are tested there; this suite asks the
 * rules the phone's drawing adds — which two controls the strip carries, where
 * the timeline's ends are, how the read-ahead divides the track, and the one
 * Action each commit takes.
 */

function playback(overrides: Partial<PlaybackSnapshot> = {}): PlaybackSnapshot {
  return {
    state: "playing",
    picture: "in_window",
    failure: null,
    nowPlaying: {
      video: { type: "series", id: "tt1:1:2" },
      addon: "torrentio",
      name: "Torrentio\n4k DV",
      description: null,
      filename: "episode.mkv",
      bingeGroup: null,
    },
    episode: { season: 1, episode: 2 },
    position: 300,
    duration: 600,
    buffered: { start: 300, end: 450 },
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

function view(overrides: Partial<PlaybackSnapshot> = {}) {
  return playbackView(playback(overrides), {
    played: 0,
    pending: new Set(),
    watchProgress: [],
  });
}

describe("the Remote's player level", () => {
  test("is the core's player level, named as the room names it", () => {
    expect(playerLevel()).toEqual({
      id: "player",
      name: CARD_NAME,
      kind: "player",
      payload: { kind: "player", title: null },
    });
    expect(CARD_NAME).toBe("Player");
  });

  test("carries the Title the strip already holds, for the Episodes plate", () => {
    const title: Title = {
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

    expect(playerLevel(title).payload).toEqual({ kind: "player", title });
  });

  test("a second strip press replaces the card instead of stacking one", () => {
    // The id is what `pushLevel` replaces by; without it the strip, still drawn
    // under the card, would push a second identical level and one Back would
    // leave a card on screen.
    expect(playerLevel().id).toBe("player");
  });

  test("a player level is stale exactly when the Host has nothing playing", () => {
    const player = { kind: "player", title: null } as const;
    const title = {
      kind: "title",
      title: { addon: null, id: "tt1", type: "movie", name: "One" },
      answer: null,
    } as const;

    expect(playerLevelStale(player, "playing")).toBe(false);
    expect(playerLevelStale(player, "paused")).toBe(false);
    expect(playerLevelStale(player, "opening")).toBe(false);
    expect(playerLevelStale(player, "ended")).toBe(false);
    expect(playerLevelStale(player, "idle")).toBe(true);
    expect(playerLevelStale(title, "idle")).toBe(false);
  });
});

describe("the docked strip's controls", () => {
  test("are the core's rewind and play/pause, with the core's own Actions", () => {
    const strip = stripControls(view());

    expect(strip.map((control) => control.id)).toEqual(["rewind", "playPause"]);
    expect(strip.map((control) => control.action)).toEqual([
      { type: "seek", target: { kind: "by", seconds: -10 } },
      { type: "set_paused", paused: true },
    ]);
    expect(strip.map((control) => control.icon)).toEqual(["rewind-10", "pause"]);
  });

  test("are disabled, and pending, exactly where the core says so", () => {
    const opening = stripControls(view({ state: "opening" }));
    expect(opening.map((control) => control.disabled)).toEqual([true, true]);

    const paused = stripControls(view({ state: "paused" }));
    expect(paused.map((control) => control.label)).toEqual([
      "Back ten seconds",
      "Play",
    ]);
  });
});

describe("the timeline's range", () => {
  test("runs the Stream's whole length, one second at a time, at the projection", () => {
    expect(timelineRange(view())).toEqual({ min: 0, max: 600, step: 1, value: 300 });
  });

  test("has a placeholder length while the Host has not said one", () => {
    expect(timelineRange(view({ duration: null }))).toMatchObject({
      max: 1,
      value: 1,
    });
    expect(timelineRange(view({ position: null }))).toMatchObject({ value: 0 });
  });

  test("keeps its value inside its own ends", () => {
    expect(timelineRange(view({ position: 900, duration: 600 }))).toMatchObject({
      value: 600,
    });
    expect(timelineRange(view({ position: -5 }))).toMatchObject({ value: 0 });
  });
});

describe("a committed seek", () => {
  test("is the core's to-Action, clamped into the Stream", () => {
    expect(seekTo(420, 600)).toEqual({
      type: "seek",
      target: { kind: "to", seconds: 420 },
    });
    expect(seekTo(-5, 600)).toEqual({
      type: "seek",
      target: { kind: "to", seconds: 0 },
    });
    expect(seekTo(900, 600)).toEqual({
      type: "seek",
      target: { kind: "to", seconds: 600 },
    });
    expect(seekTo(120, null)).toEqual({
      type: "seek",
      target: { kind: "to", seconds: 120 },
    });
  });
});

describe("the volume box", () => {
  test("starts where the Host's level is, on the Host's own 0–130 scale", () => {
    expect(volumeRange(view())).toEqual({ min: 0, max: 130, step: 1, value: 60 });
    expect(volumeRange(view({ volume: 140 }))).toMatchObject({ value: 130 });
  });

  test("sends one level, rounded and clamped", () => {
    expect(setVolume(90)).toEqual({ type: "set_volume", level: 90 });
    expect(setVolume(90.4)).toEqual({ type: "set_volume", level: 90 });
    expect(setVolume(-2)).toEqual({ type: "set_volume", level: 0 });
    expect(setVolume(200)).toEqual({ type: "set_volume", level: 130 });
  });

  test("mutes the other way, as one Action", () => {
    expect(setMuted(true)).toEqual({ type: "set_muted", muted: true });
    expect(setMuted(false)).toEqual({ type: "set_muted", muted: false });
  });
});

describe("the track's fills", () => {
  test("draw the read-ahead ahead of the playhead, and the played part before it", () => {
    expect(trackFills(0.5, { left: 0.5, width: 0.25 })).toEqual([
      { from: 0, to: 0.5, role: "played" },
      { from: 0.5, to: 0.75, role: "buffered" },
    ]);
  });

  test("draw nothing of a read-ahead the playhead has already passed", () => {
    expect(trackFills(0.5, { left: 0.1, width: 0.2 })).toEqual([
      { from: 0, to: 0.5, role: "played" },
    ]);
    expect(trackFills(0.9, { left: 0.2, width: 0.5 })).toEqual([
      { from: 0, to: 0.9, role: "played" },
    ]);
  });

  test("keep the gap between the playhead and a read-ahead that starts later", () => {
    expect(trackFills(0.4, { left: 0.6, width: 0.2 })).toEqual([
      { from: 0, to: 0.4, role: "played" },
      { from: 0.6, to: 0.8, role: "buffered" },
    ]);
  });

  test("are only the played part where the Player has no read-ahead", () => {
    expect(trackFills(0.25, null)).toEqual([{ from: 0, to: 0.25, role: "played" }]);
    expect(trackFills(0, null)).toEqual([]);
  });

  test("are clamped into the track the Player's own span names", () => {
    expect(trackFills(1.2, { left: -0.2, width: 0.4 })).toEqual([
      { from: 0, to: 1, role: "played" },
    ]);
    expect(trackFills(0.2, { left: 0.1, width: 5 })).toEqual([
      { from: 0, to: 0.2, role: "played" },
      { from: 0.2, to: 1, role: "buffered" },
    ]);
  });
});
