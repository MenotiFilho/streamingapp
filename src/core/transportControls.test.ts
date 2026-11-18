import { describe, expect, test } from "vitest";

import { actionKey } from "./actionKey";
import { playbackView } from "./playbackView";
import { transportControls } from "./transportControls";
import type { PlaybackSnapshot } from "./wire";

function playback(overrides: Partial<PlaybackSnapshot> = {}): PlaybackSnapshot {
  return {
    state: "playing",
    autoplay: null,
    picture: "in_window",
    failure: null,
    nowPlaying: null,
    episode: null,
    position: 900,
    duration: 3600,
    buffered: null,
    tracks: [],
    chapters: [],
    chapter: null,
    speed: 1,
    volume: 100,
    muted: false,
    subtitleDelay: 0,
    stalled: false,
    crop: null,
    aspect: null,
    resolution: null,
    statistics: null,
    ...overrides,
  };
}

function controls(
  overrides: Partial<PlaybackSnapshot> = {},
  pending: ReadonlySet<string> = new Set(),
) {
  return transportControls(
    playbackView(playback(overrides), {
      played: 0,
      pending,
      watchProgress: [],
    }),
  );
}

function control(
  id: "previous" | "rewind" | "playPause" | "forward" | "next" | "stop",
  overrides: Partial<PlaybackSnapshot> = {},
  pending: ReadonlySet<string> = new Set(),
) {
  return controls(overrides, pending).find((held) => held.id === id)!;
}

describe("the six transport controls", () => {
  test("are the same six in the same order, each with its one Action", () => {
    const all = controls();

    expect(all.map((held) => held.id)).toEqual([
      "previous",
      "rewind",
      "playPause",
      "forward",
      "next",
      "stop",
    ]);
    expect(all.map((held) => held.action)).toEqual([
      { type: "previous_episode" },
      { type: "seek", target: { kind: "by", seconds: -10 } },
      { type: "set_paused", paused: true },
      { type: "seek", target: { kind: "by", seconds: 10 } },
      { type: "next_episode" },
      { type: "stop_playback" },
    ]);
    expect(all.map((held) => held.pending)).toEqual([false, false, false, false, false, false]);
  });

  test("the labels and icons name what each press does", () => {
    const all = controls();

    expect(all.map((held) => held.label)).toEqual([
      "Previous episode",
      "Back ten seconds",
      "Pause",
      "Forward ten seconds",
      "Next episode",
      "Stop",
    ]);
    expect(all.map((held) => held.icon)).toEqual([
      "previous-episode",
      "rewind-10",
      "pause",
      "forward-10",
      "next-episode",
      "close",
    ]);
  });

  test("a paused Stream offers Play, and the same press unpauses", () => {
    const playPause = control("playPause", { state: "paused" });

    expect(playPause.label).toBe("Play");
    expect(playPause.icon).toBe("play");
    expect(playPause.action).toEqual({ type: "set_paused", paused: false });
    expect(playPause.disabled).toBe(false);
  });

  test("the transport trio is disabled while the Stream is not transportable", () => {
    for (const state of ["opening", "ended", "idle"] as const) {
      const all = controls({ state });
      expect(
        all.filter((held) => ["rewind", "playPause", "forward"].includes(held.id)).map(
          (held) => held.disabled,
        ),
        state,
      ).toEqual([true, true, true]);
    }
  });

  test("an episode-step control is greyed only at the boundary the position can name", () => {
    expect(control("previous", { episode: null }).disabled).toBe(true);
    expect(control("next", { episode: null }).disabled).toBe(true);
    expect(control("previous", { episode: { season: 1, episode: 1 } }).disabled).toBe(true);
    expect(control("next", { episode: { season: 1, episode: 1 } }).disabled).toBe(false);
    expect(control("previous", { episode: { season: 1, episode: 2 } }).disabled).toBe(false);
    expect(control("next", { episode: { season: 1, episode: 2 } }).disabled).toBe(false);
  });

  test("Stop is never greyed: it is the one control every state keeps", () => {
    for (const state of ["opening", "playing", "paused", "ended", "idle"] as const) {
      expect(control("stop", { state }).disabled).toBe(false);
    }
  });

  test("a control's wait is the Session's pending key for its own Action", () => {
    const pending = new Set([actionKey({ type: "next_episode" })]);
    const all = controls({ episode: { season: 1, episode: 2 } }, pending);

    expect(all.find((held) => held.id === "next")!.pending).toBe(true);
    expect(all.find((held) => held.id === "previous")!.pending).toBe(false);
  });
});
