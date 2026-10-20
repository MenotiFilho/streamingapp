import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  HostClient,
  type Action,
  type PlaybackSnapshot,
  type Snapshot,
  type Transport,
} from "../host-client";
import { Shell } from "./Shell";

const NOTHING_SAID: Snapshot = {
  revision: 0,
  playback: {
    state: "idle",
    picture: "in_window",
    failure: null,
    nowPlaying: null,
    episode: null,
    position: null,
    duration: null,
    tracks: [],
    chapters: [],
    chapter: null,
    speed: null,
    volume: null,
    muted: null,
    subtitleDelay: null,
    crop: null,
    aspect: null,
    resolution: null,
    statistics: null,
  },
  preferences: { subtitleLanguage: null },
  addons: [],
  featuredCatalog: null,
  protection: { backend: "keyring", tmdbHeld: false, stremioHeld: false },
  watchProgress: [],
  devices: [],
  pairingCode: "4K7Q2M",
  address: "192.168.1.9:8090",
};

function playback(overrides: Partial<PlaybackSnapshot> = {}): PlaybackSnapshot {
  return {
    state: "playing",
    picture: "in_window",
    failure: null,
    nowPlaying: {
      video: { type: "movie", id: "tt0133093" },
      addon: "community.aiostreams",
      name: "AIOStreams\n4K HDR",
      description: null,
      filename: null,
      bingeGroup: null,
    },
    episode: null,
    position: 900,
    duration: 3600,
    tracks: [
      {
        id: 1,
        kind: "audio",
        language: "en",
        title: "English stereo",
        codec: "truehd",
        embedded: true,
        selected: true,
        default: true,
        forced: false,
      },
      {
        id: 2,
        kind: "audio",
        language: "en",
        title: "Commentary",
        codec: "aac",
        embedded: false,
        selected: false,
        default: false,
        forced: false,
      },
      {
        id: 3,
        kind: "subtitle",
        language: "en",
        title: "English",
        codec: "subrip",
        embedded: true,
        selected: true,
        default: true,
        forced: false,
      },
      {
        id: 4,
        kind: "subtitle",
        language: "pt-BR",
        title: "Portuguese",
        codec: "subrip",
        embedded: false,
        selected: false,
        default: false,
        forced: false,
      },
    ],
    chapters: [
      { index: 0, title: "Opening", time: 0 },
      { index: 1, title: "The Choice", time: 1800 },
    ],
    chapter: 0,
    speed: 1,
    volume: 60,
    muted: true,
    subtitleDelay: 0,
    crop: null,
    aspect: null,
    resolution: { width: 128, height: 72 },
    statistics: {
      bitrate: 4_000_000,
      droppedFrames: 0,
      hardwareDecode: "d3d11va",
    },
    ...overrides,
  };
}

type Rejection = { type: Action["type"]; error: { kind: string; detail?: string } };

function fakeHost(initial: Snapshot, reject?: Rejection) {
  const invocations: Array<{ command: string; args?: Record<string, unknown> }> = [];
  let listener: ((event: { payload: Snapshot }) => void) | undefined;
  let current = initial;

  const transport: Transport = {
    invoke: async <T,>(command: string, args?: Record<string, unknown>): Promise<T> => {
      invocations.push({ command, args });
      if (command === "snapshot") {
        return current as T;
      }
      const action = (args?.envelope as { action: Action } | undefined)?.action;
      if (reject && action?.type === reject.type) {
        throw reject.error;
      }
      return { snapshots: [], answer: null } as T;
    },
    listen: async <T,>(_event: string, handler: (event: { payload: T }) => void) => {
      listener = handler as (event: { payload: Snapshot }) => void;
      return () => {
        listener = undefined;
      };
    },
  };

  return {
    client: new HostClient(transport),
    invocations,
    publish(next: Snapshot) {
      current = next;
      listener?.({ payload: next });
    },
  };
}

function actions(
  invocations: Array<{ command: string; args?: Record<string, unknown> }>,
): Action[] {
  return invocations
    .filter(({ command }) => command === "dispatch")
    .map(({ args }) => (args?.envelope as { action: Action }).action);
}

async function renderPlayer(
  overrides: Partial<PlaybackSnapshot> = {},
  reject?: Rejection,
) {
  const host = fakeHost(
    { ...NOTHING_SAID, revision: 9, playback: playback(overrides) },
    reject,
  );
  render(<Shell client={host.client} />);
  await screen.findByTestId("shell-player");
  return host;
}

/** Close the open popover the way Back does, and wait for its level to go. */
async function closePopover(testId: string) {
  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => expect(screen.queryByTestId(testId)).not.toBeInTheDocument());
}

afterEach(() => {
  vi.useRealTimers();
});

describe("the player OSD", () => {
  test("draws the uosc furniture the Snapshot describes", async () => {
    await renderPlayer();

    expect(screen.getByTestId("osd-quality")).toHaveTextContent("4K HDR");
    expect(screen.getByTestId("shell-now-playing")).toHaveTextContent("AIOStreams");
    expect(
      screen.getByTestId("shell-now-playing"),
      "the title pill does not say the quality pill's line a second time",
    ).not.toHaveTextContent("4K HDR");
    expect(screen.getByTestId("osd-details")).toHaveTextContent("community.aiostreams");
    expect(screen.getByTestId("osd-details")).toHaveTextContent("truehd");
    expect(screen.getByTestId("osd-details")).toHaveTextContent("4.0 Mbps");
    expect(screen.getByTestId("osd-details")).toHaveTextContent("d3d11va");

    expect(screen.getByTestId("stop")).toHaveAccessibleName("Stop");
    expect(screen.getByTestId("volume-level")).toHaveTextContent("60%");
    expect(screen.getByTestId("mute")).toHaveAttribute("aria-pressed", "true");

    expect(screen.getByTestId("osd-timeline")).toBeInTheDocument();
    expect(screen.getByTestId("elapsed")).toHaveTextContent("15:00");
    expect(screen.getByTestId("remaining")).toHaveTextContent("−45:00");

    const first = screen.getByTestId("chapter-marker-0");
    const second = screen.getByTestId("chapter-marker-1");
    expect(first).toHaveTextContent("Opening");
    expect(second).toHaveTextContent("The Choice");
    expect(second).toHaveTextContent("30:00");

    expect(screen.queryByTestId("player-menu")).not.toBeInTheDocument();
    expect(screen.queryByTestId("toggle-menu")).not.toBeInTheDocument();
  });

  test("each icon pushes its own popover, and Back closes it before stopping", async () => {
    const host = await renderPlayer();

    const popovers: Array<[string, string]> = [
      ["osd-picture", "popover-picture"],
      ["osd-subtitles", "popover-subtitles"],
      ["osd-audio", "popover-audio"],
      ["osd-speed", "popover-speed"],
      ["osd-chapters", "popover-chapters"],
    ];

    for (const [icon, popover] of popovers) {
      fireEvent.click(screen.getByTestId(icon));
      expect(await screen.findByTestId(popover)).toBeInTheDocument();
      expect(screen.getByTestId(icon)).toHaveAttribute("aria-expanded", "true");

      await closePopover(popover);
      expect(screen.getByTestId(icon)).toHaveAttribute("aria-expanded", "false");
      await waitFor(() =>
        expect(document.activeElement, "Back puts focus back on the icon that opened it").toBe(
          screen.getByTestId(icon),
        ),
      );
    }

    expect(actions(host.invocations)).not.toContainEqual({ type: "stop_playback" });

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({ type: "stop_playback" }),
    );
  });

  test("the centered transport takes the same Actions a remote takes", async () => {
    const host = await renderPlayer({ episode: { season: 1, episode: 2 } });

    fireEvent.click(screen.getByTestId("previous-episode"));
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({ type: "previous_episode" }),
    );

    fireEvent.click(screen.getByTestId("next-episode"));
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({ type: "next_episode" }),
    );

    fireEvent.click(screen.getByTestId("rewind"));
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({
        type: "seek",
        target: { kind: "by", seconds: -10 },
      }),
    );

    fireEvent.click(screen.getByTestId("pause"));
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({ type: "set_paused", paused: true }),
    );

    fireEvent.click(screen.getByTestId("forward"));
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({
        type: "seek",
        target: { kind: "by", seconds: 10 },
      }),
    );
  });

  test("a paused Stream offers Play, and picture-toggle has the same meaning", async () => {
    const host = await renderPlayer({ state: "paused" });

    expect(screen.queryByTestId("pause")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("play"));
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({ type: "set_paused", paused: false }),
    );

    fireEvent.click(screen.getByTestId("picture-toggle"));
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({ type: "set_paused", paused: false }),
    );
  });

  test("a film greys both episode steps, and the controls stay live", async () => {
    await renderPlayer({ episode: null });

    expect(screen.getByTestId("previous-episode")).toBeDisabled();
    expect(screen.getByTestId("next-episode")).toBeDisabled();
    expect(screen.getByTestId("pause")).toBeInTheDocument();
  });

  test("S1E1 greys only the step back", async () => {
    await renderPlayer({ episode: { season: 1, episode: 1 } });

    expect(screen.getByTestId("previous-episode")).toBeDisabled();
    expect(screen.getByTestId("next-episode")).not.toBeDisabled();
  });

  test("a previous-episode refusal is said inline and playback is not stopped", async () => {
    const host = await renderPlayer(
      { episode: { season: 1, episode: 2 } },
      {
        type: "previous_episode",
        error: { kind: "no_previous_episode", detail: "the Addon lists nothing before it" },
      },
    );

    fireEvent.click(screen.getByTestId("previous-episode"));

    const refusal = await screen.findByTestId("osd-refusal");
    expect(refusal).toHaveAttribute("role", "alert");
    expect(refusal).toHaveTextContent("previous episode");
    expect(screen.getByTestId("shell-player")).toBeInTheDocument();
    expect(actions(host.invocations)).not.toContainEqual({ type: "stop_playback" });
  });

  test("a next-episode refusal is said inline and playback is not stopped", async () => {
    const host = await renderPlayer(
      { episode: { season: 1, episode: 2 } },
      {
        type: "next_episode",
        error: { kind: "no_next_episode", detail: "the Addon lists nothing after it" },
      },
    );

    fireEvent.click(screen.getByTestId("next-episode"));

    const refusal = await screen.findByTestId("osd-refusal");
    expect(refusal).toHaveTextContent("next episode");
    expect(screen.getByTestId("shell-player")).toBeInTheDocument();
    expect(actions(host.invocations)).not.toContainEqual({ type: "stop_playback" });
  });

  test("the popovers carry the whole control set", async () => {
    const host = await renderPlayer();

    fireEvent.click(screen.getByTestId("osd-picture"));
    const picture = await screen.findByTestId("popover-picture");
    fireEvent.click(within(picture).getByTestId("aspect-4:3"));
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({
        type: "set_aspect",
        aspect: { kind: "ratio", value: 4 / 3 },
      }),
    );

    fireEvent.click(within(picture).getByTestId("crop-4:3"));
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({
        type: "set_crop",
        crop: { kind: "rectangle", width: 96, height: 72, x: 16, y: 0 },
      }),
    );

    fireEvent.click(within(picture).getByTestId("toggle-statistics"));
    expect(within(picture).getByTestId("statistics")).toHaveTextContent("4.0 Mbps");
    expect(within(picture).getByTestId("statistics")).toHaveTextContent("Hardware decode");
    expect(within(picture).getByTestId("statistics")).toHaveTextContent("d3d11va");
    await closePopover("popover-picture");

    fireEvent.click(screen.getByTestId("osd-subtitles"));
    const subtitles = await screen.findByTestId("popover-subtitles");
    expect(
      within(subtitles).getAllByTestId(/^track-subtitle-/).map((item) => item.getAttribute("data-testid")),
      "embedded first, and the Player's order kept inside each group",
    ).toEqual(["track-subtitle-3", "track-subtitle-4"]);
    expect(within(subtitles).getByTestId("track-subtitle-3")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(within(subtitles).getByTestId("track-subtitle-4"));
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({ type: "set_subtitle_track", track: 4 }),
    );

    fireEvent.click(within(subtitles).getByTestId("subtitles-off"));
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({ type: "set_subtitle_track", track: null }),
    );

    fireEvent.click(within(subtitles).getByTestId("delay-forward"));
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({ type: "set_subtitle_delay", seconds: 0.1 }),
    );

    fireEvent.click(within(subtitles).getByTestId("delay-reset"));
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({ type: "set_subtitle_delay", seconds: 0 }),
    );
    await closePopover("popover-subtitles");

    fireEvent.click(screen.getByTestId("osd-audio"));
    const audio = await screen.findByTestId("popover-audio");
    fireEvent.click(within(audio).getByTestId("track-audio-2"));
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({ type: "set_audio_track", track: 2 }),
    );
    await closePopover("popover-audio");

    fireEvent.click(screen.getByTestId("osd-speed"));
    const speed = await screen.findByTestId("popover-speed");
    fireEvent.click(within(speed).getByTestId("speed-1.5"));
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({ type: "set_speed", rate: 1.5 }),
    );
    await closePopover("popover-speed");

    fireEvent.click(screen.getByTestId("osd-chapters"));
    const chapters = await screen.findByTestId("popover-chapters");
    expect(within(chapters).queryByRole("button", { name: "Previous chapter" })).toBeNull();
    expect(within(chapters).queryByRole("button", { name: "Next chapter" })).toBeNull();
    fireEvent.click(within(chapters).getByTestId("chapter-1"));
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({ type: "set_chapter", index: 1 }),
    );
    await closePopover("popover-chapters");

    const volume = screen.getByTestId("volume");
    fireEvent.change(volume, { target: { value: "40" } });
    fireEvent.pointerUp(volume);
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({ type: "set_volume", level: 40 }),
    );

    fireEvent.click(screen.getByTestId("mute"));
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({ type: "set_muted", muted: false }),
    );

    fireEvent.change(screen.getByTestId("position"), { target: { value: "60" } });
    fireEvent.pointerUp(screen.getByTestId("position"));
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({
        type: "seek",
        target: { kind: "to", seconds: 60 },
      }),
    );
  });

  test("an opening Stream offers the menus but not the transport", async () => {
    await renderPlayer({ state: "opening", position: null, duration: null });

    expect(screen.getByTestId("opening-stream")).toHaveTextContent("Opening");
    expect(screen.queryByTestId("position")).not.toBeInTheDocument();
    expect(screen.queryByTestId("pause")).not.toBeInTheDocument();
    expect(screen.queryByTestId("rewind")).not.toBeInTheDocument();
    expect(screen.getByTestId("osd-picture")).toBeInTheDocument();
    expect(screen.getByTestId("volume")).toBeInTheDocument();
  });

  test("an ended Stream offers no menu and the after-end episode step", async () => {
    await renderPlayer({
      state: "ended",
      episode: { season: 1, episode: 2 },
      position: 3600,
    });

    expect(screen.getByTestId("stream-ended")).toBeInTheDocument();
    expect(screen.queryByTestId("osd-picture")).not.toBeInTheDocument();
    expect(screen.queryByTestId("volume")).not.toBeInTheDocument();
    expect(screen.queryByTestId("pause")).not.toBeInTheDocument();
    expect(screen.getByTestId("next-episode-after-end")).toBeInTheDocument();
  });

  test("a film at its end offers no after-end episode step", async () => {
    await renderPlayer({ state: "ended", episode: null, position: 3600 });

    expect(screen.getByTestId("stream-ended")).toBeInTheDocument();
    expect(screen.queryByTestId("next-episode-after-end")).not.toBeInTheDocument();
  });

  test("the OSD hides after five idle seconds and summons again on input", async () => {
    vi.useFakeTimers();
    const host = fakeHost({ ...NOTHING_SAID, revision: 9, playback: playback() });
    render(<Shell client={host.client} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId("shell-osd")).toBeInTheDocument();

    fireEvent.pointerMove(window);
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.queryByTestId("shell-osd")).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: "x" });
    expect(screen.getByTestId("shell-osd")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(5000));
    expect(screen.queryByTestId("shell-osd")).not.toBeInTheDocument();

    fireEvent.pointerMove(window);
    expect(screen.getByTestId("shell-osd")).toBeInTheDocument();

    vi.useRealTimers();
  });

  test("a control holding focus keeps the OSD up", async () => {
    vi.useFakeTimers();
    const host = fakeHost({ ...NOTHING_SAID, revision: 9, playback: playback() });
    render(<Shell client={host.client} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      screen.getByTestId("stop").focus();
    });
    fireEvent.pointerMove(window);
    act(() => vi.advanceTimersByTime(5000));

    expect(screen.getByTestId("shell-osd")).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByTestId("stop"));

    vi.useRealTimers();
  });

  test("an open popover keeps the OSD up even while its own controls idle", async () => {
    vi.useFakeTimers();
    const host = fakeHost({ ...NOTHING_SAID, revision: 9, playback: playback() });
    render(<Shell client={host.client} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("osd-chapters"));
      await Promise.resolve();
    });
    expect(screen.getByTestId("popover-chapters")).toBeInTheDocument();

    fireEvent.pointerMove(window);
    act(() => vi.advanceTimersByTime(5000));

    expect(screen.getByTestId("shell-osd")).toBeInTheDocument();
    expect(screen.getByTestId("popover-chapters")).toBeInTheDocument();

    vi.useRealTimers();
  });
});
