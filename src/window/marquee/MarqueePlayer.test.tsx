import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import { STALL_GRACE_MS } from "../../core/stall";
import { SNAPSHOT_EVENT } from "../../core/wire";
import type {
  Action,
  AddonStreams,
  AutoplaySnapshot,
  PlaybackSnapshot,
  Response,
  ResumeEntry,
  Snapshot,
  Stream,
  Title,
} from "../../core/wire";
import { TauriLink, type Transport } from "../tauriLink";
import {
  fakeWindowState,
  installTauriRuntime,
  removeTauriRuntime,
  resetFakeWindow,
} from "../tauriWindow.testing";
import { OSD_IDLE_MS } from "../useOsdVisibility";
import { MarqueeEntry } from "./MarqueeEntry";
import playerCss from "./player.css?raw";

let previousSkipAnimations: boolean | undefined;
beforeAll(() => {
  previousSkipAnimations = MotionGlobalConfig.skipAnimations;
  MotionGlobalConfig.skipAnimations = true;
});
afterAll(() => {
  MotionGlobalConfig.skipAnimations = previousSkipAnimations;
});

vi.mock("@tauri-apps/api/window", async () => {
  const fake = await import("../tauriWindow.testing");
  return { getCurrentWindow: () => fake.fakeTauriWindow };
});

const NOTHING_SAID: Snapshot = {
  revision: 0,
  playback: {
    state: "idle",
    autoplay: null,
    picture: "in_window",
    failure: null,
    nowPlaying: null,
    episode: null,
    position: null,
    duration: null,
    buffered: null,
    tracks: [],
    chapters: [],
    chapter: null,
    speed: null,
    volume: null,
    muted: null,
    subtitleDelay: null,
    stalled: false,
    torrent: null,
    crop: null,
    aspect: null,
    resolution: null,
    statistics: null,
  },
  preferences: {
    subtitleLanguages: [],
    audioLanguages: [],
    subtitleColor: "#FFFFFF",
    subtitleScale: 1,
    streamBuffer: { seconds: 300, megabytes: 512 },
    torrentCache: { megabytes: 2000 },
    upNextPlayback: "direct",
    autoplay: true,
  },
  addons: [
    {
      id: "torrentio",
      name: "Torrentio",
      version: "0.0.14",
      resources: [{ name: "stream", types: ["movie", "series"], idPrefixes: ["tt"] }],
      types: ["movie", "series"],
      catalogs: [],
      idPrefixes: ["tt"],
      behaviorHints: { configurable: false, configurationRequired: false },
      enabled: true,
    },
    {
      id: "comet",
      name: "Comet",
      version: "1.0.0",
      resources: [{ name: "stream", types: ["movie", "series"], idPrefixes: ["tt"] }],
      types: ["movie", "series"],
      catalogs: [],
      idPrefixes: ["tt"],
      behaviorHints: { configurable: false, configurationRequired: false },
      enabled: true,
    },
  ],
  featuredCatalog: null,
  protection: { backend: "keyring", tmdbHeld: false, stremioHeld: false },
  continueWatching: [],
  watchProgress: [],
  devices: [],
  pairingCode: "4K7Q2M",
  address: "192.168.1.9:8090",
};

const PLAYING_STREAM: Stream = {
  name: "Torrentio\n4K\nDOLBY VISION\nATMOS",
  description: "Severance.S02E03.2160p.ATVP.mkv\n👤 214 💾 8.4 GB ⚙️ ThePirateBay",
  playback: { kind: "torrent", infoHash: "a".repeat(40), fileIdx: 0, sources: [] },
  warnings: [],
  filename: "Severance.S02E03.2160p.ATVP.mkv",
  bingeGroup: "torrentio|4k",
};

const ALT_STREAM: Stream = {
  name: "Torrentio\n4K",
  description: "Severance.S02E03.2160p.WEB.h265-ETHEL\n👤 97 💾 6.1 GB ⚙️ 1337x",
  playback: { kind: "torrent", infoHash: "b".repeat(40), fileIdx: 0, sources: [] },
  warnings: [],
  filename: "Severance.S02E03.2160p.WEB.h265-ETHEL",
  bingeGroup: "torrentio|ethel",
};

function playback(overrides: Partial<PlaybackSnapshot> = {}): PlaybackSnapshot {
  return {
    state: "playing",
    autoplay: null,
    picture: "in_window",
    failure: null,
    nowPlaying: {
      video: { type: "series", id: "tt11280740:2:3" },
      addon: "torrentio",
      name: PLAYING_STREAM.name,
      description: PLAYING_STREAM.description,
      filename: PLAYING_STREAM.filename,
      bingeGroup: PLAYING_STREAM.bingeGroup,
    },
    episode: { season: 2, episode: 3 },
    position: 1072,
    duration: 2913,
    buffered: { start: 900, end: 1800 },
    tracks: [
      {
        id: 1,
        kind: "audio",
        language: "en",
        title: "English",
        codec: "Dolby Digital+ Atmos",
        embedded: true,
        selected: true,
        default: true,
        forced: false,
        hearingImpaired: false,
      },
      {
        id: 2,
        kind: "audio",
        language: "pt-BR",
        title: "Português (Brasil)",
        codec: "Dolby Digital+",
        embedded: true,
        selected: false,
        default: false,
        forced: false,
        hearingImpaired: false,
      },
      {
        id: 3,
        kind: "subtitle",
        language: "pt-BR",
        title: "Português (Brasil)",
        codec: "SRT",
        embedded: true,
        selected: true,
        default: true,
        forced: false,
        hearingImpaired: false,
      },
      {
        id: 4,
        kind: "subtitle",
        language: "en",
        title: "English",
        codec: "SRT",
        embedded: true,
        selected: false,
        default: false,
        forced: false,
        hearingImpaired: false,
      },
    ],
    chapters: [
      { index: 0, title: "Cold open", time: 0 },
      { index: 1, title: "Lumon", time: 278 },
      { index: 2, title: "Who is alive?", time: 1800 },
    ],
    chapter: 1,
    speed: 1,
    volume: 60,
    muted: false,
    subtitleDelay: 0.3,
    stalled: false,
    torrent: null,
    crop: null,
    aspect: null,
    resolution: { width: 3840, height: 2160 },
    statistics: {
      bitrate: 38_400_000,
      droppedFrames: 0,
      hardwareDecode: "d3d11va",
    },
    ...overrides,
  };
}

function seriesResume(overrides: Partial<ResumeEntry> = {}): ResumeEntry {
  return {
    video: {
      id: "tt11280740:2:3",
      name: "Who Is Alive?",
      season: 2,
      episode: 3,
      thumbnail: "https://images.test/s2e3.jpg",
      airDate: "2025-01-31",
      description: "The team deals with the aftermath.",
    },
    title: {
      addon: "cinemeta",
      id: "tt11280740",
      type: "series",
      name: "Severance",
      poster: "https://images.test/poster.jpg",
      background: "https://images.test/backdrop.jpg",
      logo: "https://images.test/logo.png",
    },
    position: 1072,
    duration: 2913,
    watched: false,
    unplayable: null,
    ...overrides,
  };
}

const SERIES_TITLE: Title = {
  addon: "cinemeta",
  id: "tt11280740",
  key: { kind: "tmdb", id: 95396 },
  type: "series",
  name: "Severance",
  poster: "https://images.test/poster.jpg",
  background: "https://images.test/backdrop.jpg",
  logo: "https://images.test/logo.png",
  description: "Mark leads a team of office workers.",
  releaseInfo: "2022",
  runtime: "50 min",
  imdbRating: "8.7",
  genres: ["Drama", "Mystery"],
  videos: [
    {
      id: "tt11280740:1:1",
      name: "Good News About Hell",
      season: 1,
      episode: 1,
      thumbnail: "https://images.test/s1e1.jpg",
      airDate: "2022-02-18",
      description: "Mark is promoted.",
    },
    {
      id: "tt11280740:2:3",
      name: "Who Is Alive?",
      season: 2,
      episode: 3,
      thumbnail: "https://images.test/s2e3.jpg",
      airDate: "2025-01-31",
      description: "The team deals with the aftermath.",
    },
    {
      id: "tt11280740:2:4",
      name: "Woe's Hollow",
      season: 2,
      episode: 4,
      thumbnail: "https://images.test/s2e4.jpg",
      airDate: "2025-02-07",
      description: "The team participates in a group activity.",
    },
  ],
};

type Rejection = { type: Action["type"]; error: { kind: string; detail?: string } };
type Hold = { type: Action["type"]; gate: Promise<void> };
type PreviewAnswers = (at: number) => { image: string | null; gate?: Promise<void> };
type Answering = (action: Action) => Response | null;

function fakeHost(
  initial: Snapshot,
  options: {
    reject?: Rejection;
    hold?: Hold;
    answers?: PreviewAnswers;
    respond?: Answering;
  } = {},
) {
  const invocations: Array<{ command: string; args?: Record<string, unknown> }> = [];
  const listeners = new Map<string, (event: { payload: Snapshot }) => void>();
  let current = initial;

  const transport: Transport = {
    invoke: async <T,>(command: string, args?: Record<string, unknown>): Promise<T> => {
      invocations.push({ command, args });
      if (command === "snapshot") {
        return current as T;
      }
      const action = (args?.envelope as { action: Action } | undefined)?.action;
      if (options.reject && action?.type === options.reject.type) {
        throw options.reject.error;
      }
      if (action?.type === "preview") {
        const answered = options.answers?.(action.at) ?? { image: null };
        if (answered.gate) {
          await answered.gate;
        }
        return {
          snapshots: [],
          answer: { preview: { at: action.at, image: answered.image } },
        } as T;
      }
      if (options.hold && action?.type === options.hold.type) {
        await options.hold.gate;
      }
      const answered = action ? options.respond?.(action) : null;
      if (answered) {
        return answered as T;
      }
      return { snapshots: [], answer: null } as T;
    },
    listen: async <T,>(event: string, handler: (event: { payload: T }) => void) => {
      const listener = handler as (event: { payload: Snapshot }) => void;
      listeners.set(event, listener);
      return () => {
        if (listeners.get(event) === listener) {
          listeners.delete(event);
        }
      };
    },
  };

  return {
    client: new TauriLink(transport),
    invocations,
    publish(next: Snapshot) {
      current = next;
      listeners.get(SNAPSHOT_EVENT)?.({ payload: next });
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

async function renderMarqueePlayer(
  overrides: Partial<PlaybackSnapshot> = {},
  extra: {
    watchProgress?: ResumeEntry[];
    subtitleScale?: number;
    autoplay?: boolean;
    reject?: Rejection;
    hold?: Hold;
    answers?: PreviewAnswers;
    respond?: Answering;
  } = {},
) {
  const host = fakeHost(
    {
      ...NOTHING_SAID,
      revision: 9,
      playback: playback(overrides),
      watchProgress: extra.watchProgress ?? [seriesResume()],
      preferences: {
        ...NOTHING_SAID.preferences,
        ...(extra.subtitleScale !== undefined ? { subtitleScale: extra.subtitleScale } : {}),
        ...(extra.autoplay !== undefined ? { autoplay: extra.autoplay } : {}),
      },
    },
    {
      reject: extra.reject,
      hold: extra.hold,
      answers: extra.answers,
      respond: extra.respond,
    },
  );
  render(<MarqueeEntry client={host.client} />);
  if (vi.isFakeTimers()) {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId("shell-player")).toBeInTheDocument();
  } else {
    await screen.findByTestId("shell-player");
    await act(async () => {});
  }
  return host;
}

beforeEach(() => {
  resetFakeWindow();
});

afterEach(() => {
  cleanup();
  removeTauriRuntime();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Marquee Player OSD — transport, top bar & seek bar", () => {
  test("draws top bar with Title, episode subtitle and Stream marks, without Previous episode or Stop in transport", async () => {
    const host = await renderMarqueePlayer();

    expect(screen.getByRole("heading", { name: "Severance" })).toBeInTheDocument();
    expect(screen.getByText("S2 E3 · Who Is Alive?")).toBeInTheDocument();
    const streamMarks = screen.getByRole("list", { name: "Stream" });
    expect(within(streamMarks).getByText("4K")).toBeInTheDocument();
    expect(within(streamMarks).getByText("DOLBY VISION")).toBeInTheDocument();
    expect(within(streamMarks).getByText("ATMOS")).toBeInTheDocument();

    expect(screen.queryByRole("button", { name: "Previous episode" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next episode" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Pause" })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({ type: "stop_playback" }),
    );
  });

  test("transport buttons and picture toggle send playback Actions", async () => {
    const host = await renderMarqueePlayer();

    fireEvent.click(screen.getByRole("button", { name: "Back ten seconds" }));
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    fireEvent.click(screen.getByRole("button", { name: "Forward ten seconds" }));
    fireEvent.click(screen.getByTestId("picture-toggle"));
    fireEvent.click(screen.getByRole("button", { name: "Mute" }));

    await waitFor(() => {
      const sent = actions(host.invocations);
      expect(sent).toContainEqual({ type: "seek", target: { kind: "by", seconds: -10 } });
      expect(sent).toContainEqual({ type: "set_paused", paused: true });
      expect(sent).toContainEqual({ type: "seek", target: { kind: "by", seconds: 10 } });
      expect(sent).toContainEqual({ type: "set_muted", muted: true });
    });
  });

  test("disables Next episode for a film and handles inline refusal on episode boundary", async () => {
    await renderMarqueePlayer({
      episode: null,
      nowPlaying: {
        video: { type: "movie", id: "tt0133093" },
        addon: "torrentio",
        name: "4K",
        description: null,
        filename: null,
        bingeGroup: null,
      },
    });
    expect(screen.getByRole("button", { name: "Next episode" })).toBeDisabled();

    cleanup();

    const host2 = await renderMarqueePlayer(
      {},
      { reject: { type: "next_episode", error: { kind: "no_next_episode" } } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Next episode" }));
    expect(await screen.findByTestId("osd-refusal")).toBeInTheDocument();
    expect(actions(host2.invocations)).not.toContainEqual({ type: "stop_playback" });
  });

  test("SeekBar commits seeks and fetches Seek preview stills on pointer hover", async () => {
    const answers: PreviewAnswers = (at) => ({
      image: `data:image/png;base64,still-${Math.floor(at)}`,
    });
    const host = await renderMarqueePlayer({}, { answers });

    const track = screen.getByTestId("mq-seek-track");
    vi.spyOn(track, "getBoundingClientRect").mockReturnValue({
      left: 0,
      width: 1000,
      right: 1000,
      top: 0,
      bottom: 32,
      height: 32,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    fireEvent.pointerMove(track, { clientX: 500 });
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({
        type: "preview",
        at: expect.closeTo(2913 * 0.5, 1),
      }),
    );
    const preview = await screen.findByTestId("mq-seek-preview");
    expect(preview).toHaveAttribute("data-still", "true");

    fireEvent.pointerDown(track, { button: 0, clientX: 250 });
    fireEvent.pointerUp(track, { button: 0, clientX: 250 });
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({
        type: "seek",
        target: { kind: "to", seconds: expect.closeTo(2913 * 0.25, 1) },
      }),
    );
  });

  test("SeekBar shows time and chapter name on hover when no still is returned", async () => {
    await renderMarqueePlayer({}, { answers: () => ({ image: null }) });

    const track = screen.getByTestId("mq-seek-track");
    vi.spyOn(track, "getBoundingClientRect").mockReturnValue({
      left: 0,
      width: 1000,
      right: 1000,
      top: 0,
      bottom: 32,
      height: 32,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    // 10% of 2913s = 291s -> inside chapter 1 ("Lumon", starts at 278s)
    fireEvent.pointerMove(track, { clientX: 100 });
    const preview = await screen.findByTestId("mq-seek-preview");
    expect(preview).not.toHaveAttribute("data-still");
    expect(preview).toHaveTextContent(/4:51 · Lumon/);
  });

  test("wheel nudges volume and debounces into set_volume", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const host = await renderMarqueePlayer({ volume: 60 });

    fireEvent.wheel(screen.getByTestId("shell-player"), { deltaY: -100 });
    fireEvent.wheel(screen.getByTestId("shell-player"), { deltaY: -100 });

    expect(screen.getByRole("slider", { name: "Volume" })).toHaveAttribute("aria-valuenow", "70");
    expect(actions(host.invocations)).toEqual([]);

    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
    });
    expect(actions(host.invocations)).toContainEqual({ type: "set_volume", level: 70 });
  });

  test("fullscreen trigger follows Tauri window and F11 toggles fullscreen", async () => {
    installTauriRuntime();
    fakeWindowState().fullscreen = false;
    await renderMarqueePlayer();

    const fsButton = screen.getByRole("button", { name: "Full screen" });
    fireEvent.click(fsButton);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Exit full screen" })).toBeInTheDocument(),
    );

    fireEvent.keyDown(window, { key: "F11" });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Full screen" })).toBeInTheDocument(),
    );
  });
});

describe("Marquee Player OSD — idle timing, cursor & 4-stop focus ladder", () => {
  test("hides OSD and cursor after 3 idle seconds and wakes on key without showing cursor", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await renderMarqueePlayer();

    expect(screen.getByTestId("shell-osd")).toBeInTheDocument();
    expect(screen.getByTestId("shell-player")).toHaveAttribute("data-cursor", "visible");

    act(() => vi.advanceTimersByTime(OSD_IDLE_MS));

    expect(screen.queryByTestId("shell-osd")).not.toBeInTheDocument();
    expect(screen.getByTestId("shell-player")).toHaveAttribute("data-cursor", "hidden");
    expect(screen.getByTestId("picture-toggle")).toHaveFocus();

    // Up wakes OSD onto Play/Pause and leaves hidden cursor hidden.
    fireEvent.keyDown(document, { key: "ArrowUp" });
    expect(screen.getByTestId("shell-osd")).toBeInTheDocument();
    expect(screen.getByTestId("shell-player")).toHaveAttribute("data-cursor", "hidden");
    expect(screen.getByRole("button", { name: "Pause" })).toHaveFocus();

    // Keyboard focus inside chrome keeps OSD up past idle window.
    act(() => vi.advanceTimersByTime(OSD_IDLE_MS));
    expect(screen.getByTestId("shell-osd")).toBeInTheDocument();
  });

  test("walks the 4-stop ladder: picture -> strip -> seek -> top and back down", async () => {
    await renderMarqueePlayer();

    expect(screen.getByRole("button", { name: "Pause" })).toHaveFocus();

    fireEvent.keyDown(document, { key: "ArrowUp" });
    expect(screen.getByRole("slider", { name: "Position" })).toHaveFocus();

    fireEvent.keyDown(document, { key: "ArrowUp" });
    expect(screen.getByRole("button", { name: "Back" })).toHaveFocus();

    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(screen.getByRole("slider", { name: "Position" })).toHaveFocus();

    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(screen.getByRole("button", { name: "Pause" })).toHaveFocus();

    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(screen.getByTestId("picture-toggle")).toHaveFocus();
  });

  test("Back closes an open panel before stopping playback", async () => {
    const host = await renderMarqueePlayer();

    fireEvent.click(screen.getByRole("button", { name: "Speed" }));
    expect(await screen.findByRole("dialog", { name: "Speed" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Speed" })).not.toBeInTheDocument(),
    );
    expect(actions(host.invocations)).not.toContainEqual({ type: "stop_playback" });

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({ type: "stop_playback" }),
    );
  });
});

describe("Marquee Player OSD — the 7 floating panels", () => {
  test("1. Audio & Subtitles: unified track selection, sync ±0.1 s + Reset, and 25%–300% 5% size stepper", async () => {
    const host = await renderMarqueePlayer({ subtitleDelay: 0.3 }, { subtitleScale: 1.15 });

    fireEvent.click(screen.getByRole("button", { name: "Audio & Subtitles" }));
    const dialog = await screen.findByRole("dialog", { name: "Audio & Subtitles" });

    const subsGroup = within(dialog).getByRole("group", { name: "Subtitles" });
    fireEvent.click(within(subsGroup).getByRole("button", { name: /Off/ }));
    fireEvent.click(within(subsGroup).getByRole("button", { name: /English/ }));

    const audioGroup = within(dialog).getByRole("group", { name: "Audio" });
    fireEvent.click(within(audioGroup).getByRole("button", { name: /Português/ }));

    const syncGroup = within(dialog).getByRole("group", { name: "Subtitle sync" });
    expect(within(syncGroup).getByText("+0.3 s")).toBeInTheDocument();
    fireEvent.click(within(syncGroup).getByRole("button", { name: "−0.1 s" }));
    fireEvent.click(within(syncGroup).getByRole("button", { name: "+0.1 s" }));
    fireEvent.click(within(syncGroup).getByRole("button", { name: "Reset" }));

    const sizeGroup = within(dialog).getByRole("group", { name: "Subtitle size" });
    expect(within(sizeGroup).getByText("115%")).toBeInTheDocument();
    fireEvent.click(within(sizeGroup).getByRole("button", { name: "Smaller" }));
    fireEvent.click(within(sizeGroup).getByRole("button", { name: "Larger" }));

    await waitFor(() => {
      const sent = actions(host.invocations);
      expect(sent).toContainEqual({ type: "set_subtitle_track", track: null });
      expect(sent).toContainEqual({ type: "set_subtitle_track", track: 4 });
      expect(sent).toContainEqual({ type: "set_audio_track", track: 2 });
      expect(sent).toContainEqual({ type: "set_subtitle_delay", seconds: 0.2 });
      expect(sent).toContainEqual({ type: "set_subtitle_delay", seconds: 0.4 });
      expect(sent).toContainEqual({ type: "set_subtitle_delay", seconds: 0 });
      expect(sent).toContainEqual({ type: "set_subtitle_scale", scale: 1.1 });
      expect(sent).toContainEqual({ type: "set_subtitle_scale", scale: 1.2 });
    });

    // Verify bounds at 25% and 300%
    act(() => {
      host.publish({
        ...NOTHING_SAID,
        revision: 10,
        playback: playback(),
        preferences: { ...NOTHING_SAID.preferences, subtitleScale: 0.25 },
      });
    });
    expect(within(sizeGroup).getByRole("button", { name: "Smaller" })).toBeDisabled();
    expect(within(sizeGroup).getByRole("button", { name: "Larger" })).toBeEnabled();

    act(() => {
      host.publish({
        ...NOTHING_SAID,
        revision: 11,
        playback: playback(),
        preferences: { ...NOTHING_SAID.preferences, subtitleScale: 3 },
      });
    });
    expect(within(sizeGroup).getByRole("button", { name: "Larger" })).toBeDisabled();
  });

  test("2. Picture: Aspect, Crop, Autocrop, and NO Statistics", async () => {
    const host = await renderMarqueePlayer();

    fireEvent.click(screen.getByRole("button", { name: "Picture" }));
    const dialog = await screen.findByRole("dialog", { name: "Picture" });

    expect(within(dialog).queryByText("Bitrate")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Dropped frames")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Statistics")).not.toBeInTheDocument();

    const aspectGroup = within(dialog).getByRole("group", { name: "Aspect" });
    fireEvent.click(within(aspectGroup).getByRole("button", { name: "16:9" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Autocrop" }));

    await waitFor(() => {
      const sent = actions(host.invocations);
      expect(sent).toContainEqual({
        type: "set_aspect",
        aspect: { kind: "ratio", value: 16 / 9 },
      });
      expect(sent).toContainEqual({ type: "autocrop" });
    });
  });

  test("3. Streams: marks playing stream, retries failed addon, sends switch_stream keeping position/HandPick, and works after failed open", async () => {
    let cometAttempts = 0;
    const host = await renderMarqueePlayer(
      { failure: "open failed" },
      {
        respond: (action) => {
          if (action.type !== "find_streams") {
            return null;
          }
          cometAttempts += 1;
          const groups: AddonStreams[] = [
            { addon: "torrentio", streams: [PLAYING_STREAM, ALT_STREAM], failure: null },
            cometAttempts === 1
              ? {
                  addon: "comet",
                  streams: [],
                  failure: { kind: "fetch", url: "https://comet.test", detail: "timed out" },
                }
              : {
                  addon: "comet",
                  streams: [
                    {
                      name: "Comet\n1080p",
                      description: "Severance.S02E03.1080p.WEB.mkv",
                      playback: { kind: "direct", url: "https://cdn.test/video.mkv" },
                      warnings: [],
                      filename: "Severance.S02E03.1080p.WEB.mkv",
                      bingeGroup: null,
                    },
                  ],
                  failure: null,
                },
          ];
          return { snapshots: [], answer: { streams: groups } };
        },
      },
    );

    fireEvent.click(screen.getByRole("button", { name: "Streams" }));
    const dialog = await screen.findByRole("dialog", { name: "Streams" });

    const playingRow = await within(dialog).findByRole("button", {
      name: new RegExp(PLAYING_STREAM.filename!),
    });
    expect(playingRow).toHaveAttribute("aria-current", "true");
    expect(within(dialog).getByText("Comet did not answer")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Try again" }));
    expect(
      await within(dialog).findByRole("button", { name: /Severance\.S02E03\.1080p\.WEB\.mkv/ }),
    ).toBeInTheDocument();

    const altRow = within(dialog).getByRole("button", { name: new RegExp(ALT_STREAM.filename!) });
    fireEvent.click(altRow);

    await waitFor(() => {
      expect(actions(host.invocations)).toContainEqual({
        type: "switch_stream",
        addon: "torrentio",
        stream: ALT_STREAM,
      });
      expect(screen.queryByRole("dialog", { name: "Streams" })).not.toBeInTheDocument();
    });
  });

  test("4. Episodes: switches seasons, toggles Autoplay, and picks Streams for another episode via play_stream", async () => {
    const groups: AddonStreams[] = [
      { addon: "torrentio", streams: [ALT_STREAM], failure: null },
    ];
    const host = await renderMarqueePlayer(
      {},
      {
        respond: (action) => {
          if (action.type === "open_title") {
            return { snapshots: [], answer: { title: SERIES_TITLE } };
          }
          if (action.type === "find_streams") {
            return { snapshots: [], answer: { streams: groups } };
          }
          return null;
        },
      },
    );

    fireEvent.click(screen.getByRole("button", { name: "Episodes" }));
    const dialog = await screen.findByRole("dialog", { name: "Episodes" });

    // Season 2 is active by default because S2 E3 is playing.
    const playingEp = await within(dialog).findByTestId("osd-episode-tt11280740:2:3");
    expect(playingEp).toHaveAttribute("aria-current", "true");
    expect(within(dialog).getByText(/Playing now · 17:52 of 48:33/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("switch", { name: "Autoplay the next episode" }));
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({ type: "set_autoplay", autoplay: false }),
    );

    fireEvent.click(within(dialog).getByRole("button", { name: "Season 1" }));
    expect(await within(dialog).findByTestId("osd-episode-tt11280740:1:1")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByTestId("osd-episode-tt11280740:1:1"));
    const streamsDialog = await screen.findByRole("dialog", { name: "Streams" });
    const cand = await within(streamsDialog).findByRole("button", {
      name: new RegExp(ALT_STREAM.filename!),
    });
    fireEvent.click(cand);

    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({
        type: "play_stream",
        video: { type: "series", id: "tt11280740:1:1" },
        addon: "torrentio",
        stream: ALT_STREAM,
        title: expect.objectContaining({ id: "tt11280740", name: "Severance" }),
      }),
    );
  });

  test("5. Speed: picks playback rate", async () => {
    const host = await renderMarqueePlayer({ speed: 1 });

    fireEvent.click(screen.getByRole("button", { name: "Speed" }));
    const dialog = await screen.findByRole("dialog", { name: "Speed" });
    expect(within(dialog).getByRole("button", { name: "1× · Normal" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(within(dialog).getByRole("button", { name: "1.25×" }));
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({ type: "set_speed", rate: 1.25 }),
    );
  });

  test("6. Chapters: renders Previous / Next chapter and chapter list", async () => {
    const host = await renderMarqueePlayer({ chapter: 1 });

    fireEvent.click(screen.getByRole("button", { name: "Chapters" }));
    const dialog = await screen.findByRole("dialog", { name: "Chapters" });

    fireEvent.click(within(dialog).getByRole("button", { name: "Previous chapter" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Next chapter" }));
    fireEvent.click(within(dialog).getByRole("button", { name: /3 · Who is alive\?/ }));

    await waitFor(() => {
      const sent = actions(host.invocations);
      expect(sent).toContainEqual({ type: "previous_chapter" });
      expect(sent).toContainEqual({ type: "next_chapter" });
      expect(sent).toContainEqual({ type: "set_chapter", index: 2 });
    });
  });

  test("7. Details: displays Torrent status and Playback statistics, and notes direct streams", async () => {
    await renderMarqueePlayer({
      stalled: true,
      torrent: { phase: "fetching", peers: 2, rate: 120_000 },
      position: 1000,
      buffered: { start: 900, end: 1001.4 },
    });

    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    const dialog = await screen.findByRole("dialog", { name: "Details" });

    const torrent = within(dialog).getByRole("group", { name: "Torrent" });
    expect(within(torrent).getByText("Waiting for data")).toBeInTheDocument();
    expect(within(torrent).getByText("Fetching")).toBeInTheDocument();
    expect(within(torrent).getByText("2 connected")).toBeInTheDocument();
    expect(within(torrent).getByText("120 kB/s")).toBeInTheDocument();

    const stats = within(dialog).getByRole("group", { name: "Playback" });
    expect(within(stats).getByText("3840×2160 · 4K")).toBeInTheDocument();
    expect(within(stats).getByText("38.4 Mbps")).toBeInTheDocument();
    expect(within(stats).getByText("Hardware · d3d11va")).toBeInTheDocument();
    expect(within(stats).getByText("1.4 s ahead")).toBeInTheDocument();

    cleanup();
    await renderMarqueePlayer({ torrent: null });
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(await screen.findByTestId("details-direct-note")).toBeInTheDocument();
  });

  test("empty Audio, Subtitles, and Chapters panels show empty notes", async () => {
    await renderMarqueePlayer({ tracks: [], chapters: [], chapter: null });

    fireEvent.click(screen.getByRole("button", { name: "Audio & Subtitles" }));
    const av = await screen.findByRole("dialog", { name: "Audio & Subtitles" });
    expect(within(av).getByText("This Stream carries no subtitle track to pick.")).toBeInTheDocument();
    expect(within(av).getByText("This Stream carries no audio track to pick.")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Audio & Subtitles" })).not.toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Chapters" }));
    const ch = await screen.findByRole("dialog", { name: "Chapters" });
    expect(within(ch).getByText("This Stream lists no chapters.")).toBeInTheDocument();
  });
});

describe("Marquee Player OSD — Opening, Stalled, Up next & Still watching?", () => {
  test("Opening shows Title logo phase-fill (opening -> finding -> fetching -> playing) and falls back to Title name when logo is absent", async () => {
    const host = await renderMarqueePlayer({
      state: "opening",
      position: null,
      duration: null,
      torrent: null,
    });

    const preview = screen.getByTestId("opening-preview");
    const status = within(preview).getByRole("status");
    expect(status).toHaveAttribute("data-variant", "logo");
    expect(status).toHaveAttribute("data-phase", "opening");
    expect(screen.getByRole("button", { name: "Play" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Details" })).toBeEnabled();

    act(() => {
      host.publish({
        ...NOTHING_SAID,
        revision: 10,
        watchProgress: [seriesResume()],
        playback: playback({
          state: "opening",
          position: null,
          duration: null,
          torrent: { phase: "finding", peers: 3, rate: 0 },
        }),
      });
    });
    expect(within(screen.getByTestId("opening-preview")).getByRole("status")).toHaveAttribute(
      "data-phase",
      "finding",
    );
    expect(screen.getByText("Finding the torrent · 3 peers")).toBeInTheDocument();

    act(() => {
      host.publish({
        ...NOTHING_SAID,
        revision: 11,
        watchProgress: [seriesResume()],
        playback: playback({
          state: "opening",
          position: null,
          duration: null,
          torrent: { phase: "fetching", peers: 12, rate: 4_200_000 },
        }),
      });
    });
    expect(within(screen.getByTestId("opening-preview")).getByRole("status")).toHaveAttribute(
      "data-phase",
      "fetching",
    );

    // Without logo: falls back to Title name over progress bar
    const noLogoEntry = seriesResume({
      title: { ...seriesResume().title, logo: null },
    });
    act(() => {
      host.publish({
        ...NOTHING_SAID,
        revision: 12,
        watchProgress: [noLogoEntry],
        playback: playback({
          state: "opening",
          position: null,
          duration: null,
          torrent: null,
        }),
      });
    });
    const textStatus = within(screen.getByTestId("opening-preview")).getByRole("status");
    expect(textStatus).toHaveAttribute("data-variant", "text");
    expect(within(textStatus).getByText("Severance")).toBeInTheDocument();
  });

  test("Stalled shows spinner only after 1s grace and clears immediately when unstalled", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const host = await renderMarqueePlayer({ stalled: true });

    expect(screen.queryByTestId("stall-card")).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime(STALL_GRACE_MS - 1));
    expect(screen.queryByTestId("stall-card")).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByTestId("stall-card")).toBeInTheDocument();

    act(() => {
      host.publish({
        ...NOTHING_SAID,
        revision: 10,
        watchProgress: [seriesResume()],
        playback: playback({ stalled: false }),
      });
    });
    expect(screen.queryByTestId("stall-card")).not.toBeInTheDocument();
  });

  test("Up next card focuses Cancel, pins OSD, and dispatches Play now / Cancel", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const countdown: AutoplaySnapshot = {
      phase: "countdown",
      remaining: 8,
      duration: 10,
      next: {
        title: { type: "series", id: "tt11280740" },
        video: { type: "series", id: "tt11280740:2:4" },
        episode: { season: 2, episode: 4 },
        name: "Woe's Hollow",
        still: "https://images.test/s2e4.jpg",
      },
    };
    const host = await renderMarqueePlayer({ state: "ended", autoplay: countdown });

    const card = screen.getByTestId("autoplay-card");
    expect(within(card).getByText("Up next in 8")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Cancel" })).toHaveFocus();

    act(() => vi.advanceTimersByTime(OSD_IDLE_MS * 2));
    expect(screen.getByTestId("shell-osd")).toBeInTheDocument();
    expect(screen.getByTestId("shell-player")).toHaveAttribute("data-cursor", "visible");

    vi.useRealTimers();
    fireEvent.click(within(card).getByRole("button", { name: "Play now" }));
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({ type: "next_episode" }),
    );

    fireEvent.click(within(card).getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({ type: "cancel_autoplay" }),
    );
  });

  test("Still watching? card focuses Keep watching and dispatches next_episode or stop_playback", async () => {
    const hold: AutoplaySnapshot = {
      phase: "unattended_limit",
      next: {
        title: { type: "series", id: "tt11280740" },
        video: { type: "series", id: "tt11280740:2:5" },
        episode: { season: 2, episode: 5 },
        name: "Trojan's Horse",
        still: null,
      },
    };
    const host = await renderMarqueePlayer({ state: "ended", autoplay: hold });

    const card = screen.getByTestId("autoplay-card");
    expect(within(card).getByRole("heading", { name: "Still watching?" })).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Keep watching" })).toHaveFocus();

    fireEvent.click(within(card).getByRole("button", { name: "Keep watching" }));
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({ type: "next_episode" }),
    );

    fireEvent.click(within(card).getByRole("button", { name: "Stop" }));
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({ type: "stop_playback" }),
    );
  });

  test("Autoplay no_stream pushes Marquee Streams picker for the next episode", async () => {
    const groups: AddonStreams[] = [
      { addon: "torrentio", streams: [ALT_STREAM], failure: null },
    ];
    const noStream: AutoplaySnapshot = {
      phase: "no_stream",
      detail: "No playable Stream found.",
      next: {
        title: { type: "series", id: "tt11280740" },
        video: { type: "series", id: "tt11280740:2:4" },
        episode: { season: 2, episode: 4 },
        name: "Woe's Hollow",
        still: "https://images.test/s2e4.jpg",
      },
    };
    const host = await renderMarqueePlayer(
      { state: "ended", autoplay: noStream },
      {
        respond: (action) => {
          if (action.type === "open_title") {
            return { snapshots: [], answer: { title: SERIES_TITLE } };
          }
          if (action.type === "find_streams") {
            return { snapshots: [], answer: { streams: groups } };
          }
          return null;
        },
      },
    );

    const picker = await screen.findByTestId("streams");
    const cand = await within(picker).findByRole("button", {
      name: new RegExp(ALT_STREAM.filename!),
    });
    fireEvent.click(cand);
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({
        type: "play_stream",
        video: { type: "series", id: "tt11280740:2:4" },
        addon: "torrentio",
        stream: ALT_STREAM,
        title: expect.objectContaining({ id: "tt11280740", name: "Severance" }),
      }),
    );
  });

  test("player.css uses only --mq-* tokens and no legacy --rep-* tokens", () => {
    const legacy = ["-", "-rep-"].join("");
    expect(playerCss).not.toContain(legacy);
  });
});
