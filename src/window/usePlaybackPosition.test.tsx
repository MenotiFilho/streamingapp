import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { PlaybackSnapshot } from "../core/wire";
import { usePlaybackPosition } from "./usePlaybackPosition";

let now = 0;

function playback(overrides: Partial<PlaybackSnapshot> = {}): PlaybackSnapshot {
  return {
    state: "playing",
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
    crop: null,
    aspect: null,
    resolution: null,
    statistics: null,
    ...overrides,
  };
}

beforeEach(() => {
  now = 0;
  vi.useFakeTimers();
  vi.spyOn(performance, "now").mockImplementation(() => now);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the projected player clock", () => {
  test("moves from the Snapshot's anchor without another Snapshot", () => {
    const { result } = renderHook(
      ({ value, active }) => usePlaybackPosition(value, active),
      { initialProps: { value: playback(), active: true } },
    );
    expect(result.current).toBe(900);

    act(() => {
      now = 1000;
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBeCloseTo(901);
  });

  test("a paused Stream holds its anchor, and an unseen surface does not tick", () => {
    const paused = playback({ state: "paused", position: 300 });
    const live = playback({ position: 900 });
    const { result, rerender } = renderHook(
      ({ value, active }) => usePlaybackPosition(value, active),
      { initialProps: { value: paused, active: true } },
    );

    act(() => {
      now = 5000;
      vi.advanceTimersByTime(5000);
    });
    expect(result.current).toBe(300);

    rerender({ value: live, active: false });
    const hidden = result.current;
    act(() => {
      now = 10_000;
      vi.advanceTimersByTime(5000);
    });
    expect(result.current).toBe(hidden);

    rerender({ value: live, active: true });
    expect(
      result.current,
      "the projection catches up from the anchor when the surface is shown",
    ).toBeCloseTo(905);
  });
});
