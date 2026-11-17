import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { HostLink, LinkState } from "../link";
import { Session } from "../session";
import type { Action, Response, Snapshot } from "../wire";
import { actionKey } from "../actionKey";
import { usePlaybackView } from "./usePlaybackView";

function snapshot(overrides: Partial<Snapshot["playback"]> = {}): Snapshot {
  return {
    revision: 3,
    playback: {
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
    },
    preferences: {
      subtitleLanguage: null,
      subtitleColor: "#FFFFFF",
      subtitleScale: 1,
      streamBuffer: { seconds: 300, megabytes: 512 },
      upNextPlayback: "direct",
      autoplay: true,
    },
    addons: [],
    featuredCatalog: null,
    protection: { backend: "file", tmdbHeld: false, stremioHeld: false },
    continueWatching: [],
    watchProgress: [],
    devices: [],
    pairingCode: "4K7Q2M",
    address: null,
  };
}

function fakeLink(initial: Snapshot) {
  const state: LinkState = { kind: "ready", device: null };
  let released: (() => void) | null = null;
  let held: Promise<Response> | null = null;

  const link: HostLink = {
    snapshot: async () => initial,
    dispatch: async () => {
      held = new Promise<Response>((resolve) => {
        released = () => resolve({ snapshots: [], answer: null });
      });
      return held;
    },
    onSnapshot: () => () => {},
    onRevision: () => () => {},
    state: () => state,
    onState: () => () => {},
    close: () => {},
  };

  return {
    link,
    release() {
      released?.();
    },
  };
}

let now = 0;

beforeEach(() => {
  now = 0;
  vi.useFakeTimers();
  vi.spyOn(performance, "now").mockImplementation(() => now);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the playback view hook", () => {
  test("runs the one clock while active and catches up when shown", async () => {
    const session = new Session(fakeLink(snapshot()).link);
    await act(async () => {
      session.start();
      await Promise.resolve();
    });

    const { result, rerender } = renderHook(
      ({ active }) => usePlaybackView(session, active),
      { initialProps: { active: true } },
    );

    expect(result.current?.position).toBe(900);

    act(() => {
      now = 1000;
      vi.advanceTimersByTime(1000);
    });
    expect(result.current?.position).toBeCloseTo(901);

    rerender({ active: false });
    act(() => {
      now = 5000;
      vi.advanceTimersByTime(5000);
    });
    expect(result.current?.position, "a hidden player does not re-project for nobody").toBe(901);

    rerender({ active: true });
    expect(result.current?.position, "the same anchor catches up on show").toBeCloseTo(905);
  });

  test("reads the pending keys of the Session it was handed", async () => {
    vi.useRealTimers();
    const host = fakeLink(snapshot());
    const session = new Session(host.link);
    await act(async () => {
      session.start();
      await Promise.resolve();
    });

    const { result } = renderHook(() => usePlaybackView(session, true));
    await waitFor(() => expect(result.current).not.toBeNull());

    const action: Action = { type: "next_episode" };
    await act(async () => {
      void session.ask(action);
      await Promise.resolve();
    });

    expect(result.current?.pending.has(actionKey(action))).toBe(true);

    await act(async () => {
      host.release();
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current?.pending.size).toBe(0));
  });
});
