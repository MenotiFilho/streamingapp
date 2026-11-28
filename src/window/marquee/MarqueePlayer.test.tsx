import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import { Profiler, StrictMode } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import { AUTOPLAY_SWITCH_LABEL } from "../../core/controls";
import { pictureNote } from "../../core/playback";
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
import { EPISODES_EMPTY } from "../episodesMenu";
import { PreviewDataProvider } from "../rehearsal/previewData";
import { TauriLink, type Transport } from "../tauriLink";
import {
  fakeWindowState,
  installTauriRuntime,
  removeTauriRuntime,
  resetFakeWindow,
} from "../tauriWindow.testing";
import { OSD_IDLE_MS } from "../useOsdVisibility";
import { dockedTransport } from "./MarqueeDock";
import { MarqueeEntry } from "./MarqueeEntry";

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
  Reflect.deleteProperty(navigator, "getGamepads");
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

  test("focusing SeekBar during playing over a cached non-null still does not cause a runaway re-render", async () => {
    let now = 10_000;
    vi.spyOn(performance, "now").mockImplementation(() => (now += 0.5));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let renders = 0;
    const host = fakeHost(
      {
        ...NOTHING_SAID,
        revision: 9,
        playback: playback({ state: "playing", position: 1000, duration: 2913 }),
        watchProgress: [seriesResume()],
      },
      { answers: () => ({ image: "data:image/png;base64,cached-still" }) },
    );
    render(
      <Profiler
        id="marquee-player"
        onRender={() => {
          renders += 1;
        }}
      >
        <MarqueeEntry client={host.client} />
      </Profiler>,
    );
    await screen.findByTestId("shell-player");
    await act(async () => {});

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

    // Cache bucket 200 (1000–1005s; 344/1000 * 2913 = 1002.1s) with a non-null still via hover, then unhover.
    fireEvent.pointerMove(track, { clientX: 344 });
    await waitFor(() =>
      expect(screen.getByTestId("mq-seek-preview")).toHaveAttribute("data-still", "true"),
    );
    fireEvent.pointerLeave(track);

    const rendersBeforeFocus = renders;
    const previewsBeforeFocus = actions(host.invocations).filter((a) => a.type === "preview").length;

    // Move focus from Pause onto SeekBar via keyboard (navigation modality).
    fireEvent.keyDown(document, { key: "ArrowUp" });
    await act(async () => {});

    expect(screen.getByRole("slider", { name: "Position" })).toHaveFocus();
    expect(screen.getByTestId("mq-seek-preview")).toHaveAttribute("data-still", "true");
    expect(renders - rendersBeforeFocus).toBeLessThan(20);
    expect(actions(host.invocations).filter((a) => a.type === "preview")).toHaveLength(
      previewsBeforeFocus,
    );
    expect(errorSpy).not.toHaveBeenCalled();
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
    await act(async () => {});

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

  test("ended state: ArrowDown from top bar moves focus to ended actions instead of trapping in top bar", async () => {
    await renderMarqueePlayer({ state: "ended", autoplay: null, position: 2913, duration: 2913 });

    const back = screen.getByRole("button", { name: "Back" });
    back.focus();
    expect(back).toHaveFocus();

    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(screen.getByTestId("next-episode-after-end")).toHaveFocus();

    fireEvent.keyDown(document, { key: "ArrowUp" });
    expect(back).toHaveFocus();

    cleanup();

    await renderMarqueePlayer({
      state: "ended",
      autoplay: {
        phase: "countdown",
        remaining: 8,
        duration: 10,
        next: {
          title: { type: "series", id: "tt11280740" },
          video: { type: "series", id: "tt11280740:2:4" },
          episode: { season: 2, episode: 4 },
          name: "Woe's Hollow",
          still: null,
        },
      },
      position: 2913,
      duration: 2913,
    });

    const cardBack = screen.getByRole("button", { name: "Back" });
    cardBack.focus();
    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(
      within(screen.getByTestId("autoplay-card")).getByRole("button", { name: "Play now" }),
    ).toHaveFocus();

    fireEvent.keyDown(document, { key: "ArrowUp" });
    expect(cardBack).toHaveFocus();
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
    expect(within(dialog).queryByRole("heading", { name: "Comet" })).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Try again" }));
    expect(
      await within(dialog).findByRole("button", { name: /Severance\.S02E03\.1080p\.WEB\.mkv/ }),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("heading", { name: "Comet" })).toBeInTheDocument();

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

  test("3b. Streams: closing the panel while switch_stream is pending does not pop the player Level", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const groups: AddonStreams[] = [
      { addon: "torrentio", streams: [PLAYING_STREAM, ALT_STREAM], failure: null },
    ];
    const host = await renderMarqueePlayer(
      {},
      {
        hold: { type: "switch_stream", gate },
        respond: (action) =>
          action.type === "find_streams" ? { snapshots: [], answer: { streams: groups } } : null,
      },
    );

    fireEvent.click(screen.getByRole("button", { name: "Streams" }));
    const dialog = await screen.findByRole("dialog", { name: "Streams" });
    const altRow = await within(dialog).findByRole("button", {
      name: new RegExp(ALT_STREAM.filename!),
    });
    fireEvent.click(altRow);

    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({
        type: "switch_stream",
        addon: "torrentio",
        stream: ALT_STREAM,
      }),
    );

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Streams" })).not.toBeInTheDocument(),
    );

    await act(async () => {
      release();
      await Promise.resolve();
    });

    expect(screen.getByTestId("shell-player")).toBeInTheDocument();
    expect(errorSpy).not.toHaveBeenCalled();
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
    expect(screen.queryByText(/connected$/)).not.toBeInTheDocument();
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
});

/* --------------------------------------------------------------------------
 * The rest of the OSD's contract: the behaviours the window has carried since
 * #28, asked of the Marquee surfaces.
 * -------------------------------------------------------------------------- */

const MOVIE_PLAYING: Partial<PlaybackSnapshot> = {
  nowPlaying: {
    video: { type: "movie", id: "tt0133093" },
    addon: "torrentio",
    name: "Torrentio\n1080p",
    description: null,
    filename: null,
    bingeGroup: null,
  },
  episode: null,
};

/** Every Action of one kind this window sent. */
function sentOf(
  host: { invocations: Array<{ command: string; args?: Record<string, unknown> }> },
  type: Action["type"],
): Action[] {
  return actions(host.invocations).filter((action) => action.type === type);
}

/** The Host's next Snapshot, from the same series. */
function snapshotOf(
  revision: number,
  overrides: Partial<PlaybackSnapshot> = {},
  extra: Partial<Snapshot> = {},
): Snapshot {
  return {
    ...NOTHING_SAID,
    revision,
    watchProgress: [seriesResume()],
    playback: playback(overrides),
    ...extra,
  };
}

/** Let the Session's first answers and the player's effects land under fake timers. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** The timers the OSD's own clock needs; a Level's exit keeps the real frame. */
function fakeOsdClock() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
}

/** Three idle seconds with nobody touching anything. */
function idle(windows = 1) {
  act(() => vi.advanceTimersByTime(OSD_IDLE_MS * windows));
}

const cursor = () => screen.getByTestId("shell-player").getAttribute("data-cursor");

const button = (name: string) => screen.getByRole("button", { name });

const volumeLevel = () =>
  screen.getByRole("slider", { name: "Volume" }).getAttribute("aria-valuenow");

/** Point at the seek bar of a 1000px track at this x. */
function seekTrack(): HTMLElement {
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
  return track;
}

describe("Marquee Player OSD — what the Snapshot draws and what a press sends", () => {
  test("draws the clock and the mute state over a transparent page, with no docked transport", async () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    await renderMarqueePlayer({ muted: true });

    const seek = screen.getByRole("slider", { name: "Position" });
    expect(seek).toHaveAttribute("aria-valuetext", "17:52");
    expect(within(seek).getByText("−30:41")).toBeInTheDocument();
    expect(button("Unmute")).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.queryByTestId("player-dock"),
      "the picture is in this window, so the transport is the OSD, not the dock",
    ).not.toBeInTheDocument();
    expect(
      document.documentElement,
      "the browsing page underneath is transparent while mpv draws behind it",
    ).toHaveClass("picture-behind");
  });

  test("a paused Stream offers Play, and the picture means the same", async () => {
    const host = await renderMarqueePlayer({ state: "paused" });

    expect(screen.queryByRole("button", { name: "Pause" })).not.toBeInTheDocument();
    fireEvent.click(button("Play"));
    await waitFor(() =>
      expect(sentOf(host, "set_paused")).toEqual([{ type: "set_paused", paused: false }]),
    );
    await act(async () => {});

    fireEvent.click(screen.getByTestId("picture-toggle"));
    await waitFor(() =>
      expect(sentOf(host, "set_paused")).toEqual([
        { type: "set_paused", paused: false },
        { type: "set_paused", paused: false },
      ]),
    );
  });

  test("unmutes a muted Player, and the volume level takes a page step on release", async () => {
    const host = await renderMarqueePlayer({ muted: true, volume: 60 });

    fireEvent.click(button("Unmute"));
    const level = screen.getByRole("slider", { name: "Volume" });
    fireEvent.keyDown(level, { key: "PageUp" });
    fireEvent.keyUp(level, { key: "PageUp" });

    await waitFor(() => {
      expect(actions(host.invocations)).toContainEqual({ type: "set_muted", muted: false });
      expect(sentOf(host, "set_volume")).toEqual([{ type: "set_volume", level: 65 }]);
    });
  });

  test("a next-episode step says it is loading and a second press sends nothing", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const host = await renderMarqueePlayer({}, { hold: { type: "next_episode", gate } });

    // Both clicks in one act: React has not painted the disabled button yet, so
    // only the control's own ref can drop the second press.
    act(() => {
      fireEvent.click(button("Next episode"));
      fireEvent.click(button("Next episode"));
    });

    expect(await screen.findByTestId("episode-loading")).toHaveTextContent(
      "Loading the next episode…",
    );
    expect(button("Next episode")).toBeDisabled();
    expect(button("Next episode")).toHaveAttribute("aria-busy", "true");
    expect(sentOf(host, "next_episode")).toHaveLength(1);

    await act(async () => {
      release();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(screen.queryByTestId("episode-loading")).not.toBeInTheDocument(),
    );
    expect(button("Next episode")).toBeEnabled();
  });

  test("an ended Stream offers no menu and the after-end episode step", async () => {
    await renderMarqueePlayer({ state: "ended", position: 2913 });

    expect(screen.getByTestId("stream-ended")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Picture" })).not.toBeInTheDocument();
    expect(screen.queryByRole("slider", { name: "Volume" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pause" })).not.toBeInTheDocument();
    expect(screen.getByTestId("next-episode-after-end")).toBeInTheDocument();
    expect(screen.queryByTestId("autoplay-card")).not.toBeInTheDocument();
  });

  test("a film at its end offers no after-end episode step and no Autoplay switch", async () => {
    await renderMarqueePlayer({ ...MOVIE_PLAYING, state: "ended", position: 2913 });

    expect(screen.getByTestId("stream-ended")).toBeInTheDocument();
    expect(screen.queryByTestId("next-episode-after-end")).not.toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  test("the wait for mpv shows the Title's own art instead of an empty hole", async () => {
    await renderMarqueePlayer({ state: "opening", position: null, duration: null });

    expect(screen.getByTestId("opening-preview")).toHaveAttribute("data-art", "true");
    expect(
      screen.getByTestId("opening-preview-art"),
      "the episode still is the closest thing to the frame that is coming",
    ).toHaveAttribute("src", "https://images.test/s2e3.jpg");
  });

  test("an opening direct Stream says what is opening, and a torrent's line follows its status", async () => {
    const opening = { state: "opening", position: null, duration: null } as const;
    const host = await renderMarqueePlayer({ ...opening, torrent: null });
    const block = () => screen.getByTestId("opening-stream");

    expect(block()).toHaveTextContent(/Opening Torrentio/);
    expect(block()).not.toHaveTextContent("peer");

    act(() =>
      host.publish(
        snapshotOf(10, { ...opening, torrent: { phase: "finding", peers: 1, rate: 0 } }),
      ),
    );
    expect(block()).toHaveTextContent("Finding the torrent · 1 peer");

    act(() =>
      host.publish(
        snapshotOf(11, {
          ...opening,
          torrent: { phase: "fetching", peers: 12, rate: 4_200_000 },
        }),
      ),
    );
    expect(block()).toHaveTextContent("Fetching · 12 peers · 4.2 MB/s");
  });

  test("keeps the still already drawn while the next bucket is not ready", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = "data:image/png;base64,first";
    const second = "data:image/png;base64,second";
    const host = await renderMarqueePlayer(
      {},
      { answers: (at) => (at < 1000 ? { image: first } : { image: second, gate }) },
    );
    const track = seekTrack();
    const still = () =>
      within(screen.getByTestId("mq-seek-preview")).getByRole("presentation");

    fireEvent.pointerMove(track, { clientX: 250 });
    await waitFor(() => expect(still()).toHaveAttribute("src", first));

    // The same five-second bucket asks nothing twice.
    fireEvent.pointerMove(track, { clientX: 250.5 });
    expect(sentOf(host, "preview")).toHaveLength(1);

    fireEvent.pointerMove(track, { clientX: 625 });
    await waitFor(() => expect(sentOf(host, "preview")).toHaveLength(2));
    expect(still()).toHaveAttribute("src", first);
    expect(screen.getByTestId("mq-seek-preview")).toHaveTextContent("30:20");

    await act(async () => {
      release();
    });
    await waitFor(() => expect(still()).toHaveAttribute("src", second));

    fireEvent.pointerLeave(track);
    expect(screen.queryByTestId("mq-seek-preview")).not.toBeInTheDocument();
    expect(sentOf(host, "preview")).toHaveLength(2);
  });
});

describe("Marquee Player OSD — the picture", () => {
  test("only the rehearsal paints the Title's art behind the OSD; the window leaves it to mpv", async () => {
    await renderMarqueePlayer();
    expect(screen.queryByTestId("rehearsal-picture")).not.toBeInTheDocument();
    cleanup();

    const host = fakeHost(snapshotOf(9));
    render(
      <PreviewDataProvider value={true}>
        <MarqueeEntry client={host.client} />
      </PreviewDataProvider>,
    );

    expect(await screen.findByTestId("rehearsal-picture")).toBeInTheDocument();
  });
});

describe("Marquee Player OSD — Stop and the window", () => {
  test("Stop is sent while the Host still reports the Stream (#250)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const host = await renderMarqueePlayer({}, { hold: { type: "stop_playback", gate } });

    fireEvent.click(button("Close"));
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({ type: "stop_playback" }),
    );
    expect(
      screen.getByTestId("shell-player"),
      "the Host has not answered yet: the player is still the reported Stream",
    ).toBeInTheDocument();

    release();
    await act(async () => {
      host.publish({ ...NOTHING_SAID, revision: 10 });
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.queryByTestId("shell-player")).not.toBeInTheDocument());
  });

  test("a Stop the Host refuses leaves the player where it was", async () => {
    const host = await renderMarqueePlayer(
      {},
      {
        reject: {
          type: "stop_playback",
          error: { kind: "internal", detail: "the player did not answer" },
        },
      },
    );

    fireEvent.click(button("Close"));
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({ type: "stop_playback" }),
    );
    await act(async () => {});

    expect(
      screen.getByTestId("shell-player"),
      "a refused Stop is not a closed Stream",
    ).toBeInTheDocument();
    expect(document.documentElement).toHaveClass("picture-behind");
  });

  test("without a window to put fullscreen the OSD draws no fullscreen control", async () => {
    await renderMarqueePlayer();

    expect(
      screen.queryByRole("button", { name: /full screen/i }),
      "a button that cannot work is worse than no button",
    ).not.toBeInTheDocument();
    expect(button("Close"), "Stop is still the top bar's control").toBeInTheDocument();
  });

  test("F11 is the window's from the player, and a held key is one press", async () => {
    installTauriRuntime();
    await renderMarqueePlayer();
    await waitFor(() => expect(fakeWindowState().resized.size).toBeGreaterThan(0));

    const f11 = async (repeat: boolean) => {
      const event = new KeyboardEvent("keydown", {
        key: "F11",
        repeat,
        bubbles: true,
        cancelable: true,
      });
      await act(async () => {
        window.dispatchEvent(event);
      });
      return event.defaultPrevented;
    };

    expect(await f11(false), "the native window's F11 is taken").toBe(true);
    await waitFor(() => expect(button("Exit full screen")).toBeInTheDocument());
    expect(await f11(true), "a held key is not a second press").toBe(false);
    expect(fakeWindowState().calls).toEqual([true]);

    await f11(false);
    await waitFor(() => expect(button("Full screen")).toBeInTheDocument());
    expect(fakeWindowState().calls).toEqual([true, false]);
  });

  test("Stop leaves the window fullscreen, and the browsing chrome says so", async () => {
    installTauriRuntime();
    const host = await renderMarqueePlayer();
    await waitFor(() => expect(fakeWindowState().resized.size).toBeGreaterThan(0));

    fireEvent.click(button("Full screen"));
    await waitFor(() => expect(button("Exit full screen")).toBeInTheDocument());
    fireEvent.click(button("Close"));
    await act(async () => {
      host.publish({ ...NOTHING_SAID, revision: 10 });
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.queryByTestId("shell-player")).not.toBeInTheDocument());

    const chrome = await screen.findByTestId("window-fullscreen");
    expect(chrome).toHaveAccessibleName("Exit full screen");
    expect(chrome).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(chrome);
    await waitFor(() =>
      expect(screen.getByTestId("window-fullscreen")).toHaveAccessibleName("Full screen"),
    );
    expect(fakeWindowState().calls).toEqual([true, false]);
  });
});

describe("Marquee Player OSD — panels", () => {
  test("each menu opens its panel, and Back closes it onto its button before stopping", async () => {
    const host = await renderMarqueePlayer(
      {},
      {
        respond: (action) => {
          if (action.type === "open_title") {
            return { snapshots: [], answer: { title: SERIES_TITLE } };
          }
          return null;
        },
      },
    );

    for (const name of [
      "Picture",
      "Audio & Subtitles",
      "Streams",
      "Episodes",
      "Speed",
      "Chapters",
      "Details",
    ]) {
      const trigger = button(name);
      trigger.focus();
      fireEvent.click(trigger);
      expect(await screen.findByRole("dialog", { name })).toBeInTheDocument();
      expect(trigger).toHaveAttribute("aria-expanded", "true");

      fireEvent.keyDown(document, { key: "Escape" });
      await waitFor(() =>
        expect(screen.queryByRole("dialog", { name })).not.toBeInTheDocument(),
      );
      expect(trigger).toHaveAttribute("aria-expanded", "false");
      await waitFor(() =>
        expect(trigger, "Back puts focus back on the button that opened it").toHaveFocus(),
      );
    }

    expect(actions(host.invocations)).not.toContainEqual({ type: "stop_playback" });
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({ type: "stop_playback" }),
    );
  });

  test("a panel closes when something outside it is pressed or focused", async () => {
    await renderMarqueePlayer();

    fireEvent.click(button("Picture"));
    await screen.findByRole("dialog", { name: "Picture" });
    fireEvent.click(screen.getByTestId("popover-scrim"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Picture" })).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("shell-player")).toBeInTheDocument();

    fireEvent.click(button("Speed"));
    await screen.findByRole("dialog", { name: "Speed" });
    await act(async () => {
      screen.getByTestId("picture-toggle").focus();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Speed" })).not.toBeInTheDocument(),
    );
  });

  test("a sync step keeps focus on the button it pressed", async () => {
    const host = await renderMarqueePlayer({ subtitleDelay: 0 });

    fireEvent.click(button("Audio & Subtitles"));
    const dialog = await screen.findByRole("dialog", { name: "Audio & Subtitles" });
    const later = within(dialog).getByRole("button", { name: "+0.1 s" });
    later.focus();
    fireEvent.click(later);

    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({
        type: "set_subtitle_delay",
        seconds: 0.1,
      }),
    );
    expect(within(dialog).getByRole("button", { name: "+0.1 s" })).toHaveFocus();
  });

  test("Picture sends the crop it names, and a crop set offers the full frame back", async () => {
    const host = await renderMarqueePlayer();

    fireEvent.click(button("Picture"));
    const dialog = await screen.findByRole("dialog", { name: "Picture" });
    const crop = within(dialog).getByRole("group", { name: "Crop" });
    fireEvent.click(within(crop).getByRole("button", { name: "4:3" }));
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({
        type: "set_crop",
        crop: { kind: "rectangle", width: 2880, height: 2160, x: 480, y: 0 },
      }),
    );

    act(() =>
      host.publish(snapshotOf(10, { crop: { width: 2880, height: 2160, x: 480, y: 0 } })),
    );
    expect(
      within(dialog).getByRole("button", { name: "Restore full frame" }),
    ).toBeInTheDocument();
  });

  test("a film has no Episodes menu, and so no Autoplay switch", async () => {
    await renderMarqueePlayer(MOVIE_PLAYING);

    expect(screen.queryByRole("button", { name: "Episodes" })).not.toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  test("Episodes asks the Watch-progress Title's Addon once, whatever the Host publishes", async () => {
    const host = await renderMarqueePlayer(
      {},
      {
        respond: (action) =>
          action.type === "open_title"
            ? { snapshots: [], answer: { title: SERIES_TITLE } }
            : null,
      },
    );

    fireEvent.click(button("Episodes"));
    const dialog = await screen.findByRole("dialog", { name: "Episodes" });
    await within(dialog).findByTestId("osd-episode-tt11280740:2:3");
    expect(
      sentOf(host, "open_title"),
      "the Addon that supplied the Title is the one asked for its episodes",
    ).toEqual([
      { type: "open_title", addon: "cinemeta", title: { type: "series", id: "tt11280740" } },
    ]);
    expect(
      within(dialog).queryByTestId("osd-episode-tt11280740:1:1"),
    ).not.toBeInTheDocument();

    // A new Snapshot about the same series is not a new question.
    act(() => host.publish(snapshotOf(10, { position: 1100 })));
    await act(async () => {});
    expect(sentOf(host, "open_title")).toHaveLength(1);
    expect(dialog).toBeInTheDocument();
  });

  test("a series with no episodes says so and asks for no Streams", async () => {
    const host = await renderMarqueePlayer(
      {},
      {
        respond: (action) =>
          action.type === "open_title"
            ? { snapshots: [], answer: { title: { ...SERIES_TITLE, videos: [] } } }
            : null,
      },
    );

    fireEvent.click(button("Episodes"));

    await waitFor(() =>
      expect(screen.getByTestId("osd-episodes-note")).toHaveTextContent(EPISODES_EMPTY),
    );
    expect(sentOf(host, "find_streams")).toEqual([]);
  });

  test("a chosen episode's Stream plays it, puts both panels away and keeps the player", async () => {
    const host = await renderMarqueePlayer(
      {},
      {
        respond: (action) => {
          if (action.type === "open_title") {
            return { snapshots: [], answer: { title: SERIES_TITLE } };
          }
          if (action.type === "find_streams") {
            return {
              snapshots: [],
              answer: {
                streams: [{ addon: "torrentio", failure: null, streams: [ALT_STREAM] }],
              },
            };
          }
          return null;
        },
      },
    );

    fireEvent.click(button("Episodes"));
    fireEvent.click(await screen.findByTestId("osd-episode-tt11280740:2:4"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Episodes" })).not.toBeInTheDocument(),
    );
    const streams = await screen.findByRole("dialog", { name: "Streams" });
    expect(actions(host.invocations)).toContainEqual({
      type: "find_streams",
      video: { type: "series", id: "tt11280740:2:4" },
    });

    fireEvent.click(
      await within(streams).findByRole("button", {
        name: new RegExp(ALT_STREAM.filename!),
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Streams" })).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("shell-player")).toBeInTheDocument();
    expect(screen.getByTestId("shell-osd")).toBeInTheDocument();
  });
});

describe("Marquee Player OSD — the idle clock and the cursor", () => {
  async function mount(overrides: Partial<PlaybackSnapshot> = {}) {
    fakeOsdClock();
    return renderMarqueePlayer(overrides);
  }

  test.each(["opening", "playing", "paused", "ended"] as const)(
    "the cursor shows at first and hides after three idle seconds while %s",
    async (state) => {
      await mount({ state });

      expect(cursor()).toBe("visible");
      act(() => vi.advanceTimersByTime(OSD_IDLE_MS - 1));
      expect(cursor()).toBe("visible");
      act(() => vi.advanceTimersByTime(1));
      expect(cursor()).toBe("hidden");
    },
  );

  test.each([
    ["moves", () => fireEvent.pointerMove(window)],
    ["presses", () => fireEvent.pointerDown(window)],
    ["scrolls the wheel", () => fireEvent.wheel(window)],
  ] as const)("both come back when the pointer %s", async (_name, input) => {
    await mount();
    idle();
    expect(cursor()).toBe("hidden");
    expect(screen.queryByTestId("shell-osd")).not.toBeInTheDocument();

    act(() => {
      input();
    });

    expect(cursor()).toBe("visible");
    expect(screen.getByTestId("shell-osd")).toBeInTheDocument();
  });

  test("the pointer leaving the window neither wakes the OSD nor shows the cursor", async () => {
    await mount();
    idle();

    fireEvent.pointerLeave(window);
    fireEvent.pointerOut(document.body);

    expect(screen.queryByTestId("shell-osd")).not.toBeInTheDocument();
    expect(cursor()).toBe("hidden");
  });

  test("keyboard focus in the chrome keeps the OSD up while the cursor still hides", async () => {
    await mount();
    await act(async () => {
      button("Close").focus();
    });
    fireEvent.keyDown(document, { key: "x" });

    idle();

    expect(screen.getByTestId("shell-osd")).toBeInTheDocument();
    expect(button("Close")).toHaveFocus();
    expect(cursor()).toBe("hidden");
  });

  test("a clicked control does not pin the OSD after the mouse stops", async () => {
    await mount();
    await act(async () => {
      screen.getByRole("slider", { name: "Volume" }).focus();
    });
    fireEvent.pointerMove(window);

    idle();

    expect(screen.queryByTestId("shell-osd")).not.toBeInTheDocument();
  });

  test("an open panel keeps the OSD and the cursor up", async () => {
    await mount();
    await act(async () => {
      fireEvent.click(button("Chapters"));
      await Promise.resolve();
    });
    fireEvent.pointerMove(window);

    idle(2);

    expect(screen.getByRole("dialog", { name: "Chapters" })).toBeInTheDocument();
    expect(screen.getByTestId("shell-osd")).toBeInTheDocument();
    expect(cursor()).toBe("visible");
  });
});

describe("Marquee Player OSD — a Stalled Stream", () => {
  // The spinner's second runs on the client's own clock: setTimeout and
  // performance, and nothing else the player leans on.
  async function mount(stalled: boolean) {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    return renderMarqueePlayer({ stalled });
  }

  test("a seek's brief wait draws nothing", async () => {
    const host = await mount(false);

    act(() => host.publish(snapshotOf(10, { stalled: true })));
    act(() => vi.advanceTimersByTime(600));
    act(() => host.publish(snapshotOf(11, { stalled: false })));
    act(() => vi.advanceTimersByTime(2000));

    expect(screen.queryByTestId("stall-card")).not.toBeInTheDocument();
  });

  test("a position moving under a stall does not restart its second", async () => {
    const host = await mount(true);

    act(() => vi.advanceTimersByTime(700));
    act(() => host.publish(snapshotOf(10, { stalled: true, position: 1073 })));
    act(() => vi.advanceTimersByTime(STALL_GRACE_MS - 700));

    expect(screen.getByTestId("stall-card")).toBeInTheDocument();
  });

  test("neither summons the OSD nor touches its idle clock", async () => {
    await mount(true);
    expect(screen.getByTestId("shell-osd")).toBeInTheDocument();

    idle();

    expect(
      screen.queryByTestId("shell-osd"),
      "the OSD goes away on its own three seconds, stall or not",
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("stall-card"),
      "and the spinner stays up without it, on its own clock",
    ).toBeInTheDocument();
  });
});

describe("Marquee Player OSD — the ladder's memory", () => {
  test("each stop remembers the control it was left on", async () => {
    await renderMarqueePlayer();

    await act(async () => button("Chapters").focus());
    fireEvent.keyDown(document, { key: "ArrowUp" });
    expect(screen.getByRole("slider", { name: "Position" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "ArrowUp" });
    expect(button("Back")).toHaveFocus();
    fireEvent.keyDown(document, { key: "ArrowDown" });
    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(button("Chapters"), "the controls went back to where they were left").toHaveFocus();

    await act(async () => button("Close").focus());
    fireEvent.keyDown(document, { key: "ArrowDown" });
    fireEvent.keyDown(document, { key: "ArrowUp" });
    expect(button("Close"), "the top bar went back to where it was left").toHaveFocus();
  });

  test("Up in an opening Stream lands in the controls, since Play takes no press yet", async () => {
    fakeOsdClock();
    await renderMarqueePlayer({ state: "opening", position: null, duration: null });
    idle();
    expect(screen.queryByTestId("shell-osd")).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: "ArrowUp" });

    const controls = screen.getByRole("group", { name: "Player controls" });
    expect(controls.contains(document.activeElement)).toBe(true);
  });
});

/** A standard-mapping pad jsdom's `useGamepad` can poll, with every button up. */
function fakePad() {
  const buttons = Array.from({ length: 16 }, () => ({ pressed: false }));
  const pad = { connected: true, mapping: "standard", buttons, axes: [] as number[] };
  Object.defineProperty(navigator, "getGamepads", {
    configurable: true,
    value: () => [pad],
  });
  return async (index: number, down: boolean) => {
    const held = buttons[index];
    if (held) {
      held.pressed = down;
    }
    // One poll frame, and whatever the press asked the Host answered inside it.
    await act(async () => {
      vi.advanceTimersByTime(16);
    });
  };
}

const PAD = { x: 2, y: 3, up: 12, left: 14 };

describe("Marquee Player OSD — the pad", () => {
  // The OSD's own clock, and the pad poll's frames.
  function fakePadClock() {
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "requestAnimationFrame",
        "cancelAnimationFrame",
      ],
    });
  }

  test("a pad press summons the OSD without the cursor, and walks the ladder", async () => {
    fakePadClock();
    const hold = fakePad();
    await renderMarqueePlayer({ state: "paused" });
    fireEvent.pointerMove(window);
    idle();
    expect(screen.queryByTestId("shell-osd")).not.toBeInTheDocument();

    // Left is not the ladder's move, but it is still input: it summons the OSD
    // and leaves focus where it was, because the picture has no neighbour.
    await hold(PAD.left, true);
    expect(screen.getByTestId("shell-osd")).toBeInTheDocument();
    expect(cursor()).toBe("hidden");
    expect(screen.getByTestId("picture-toggle")).toHaveFocus();
    await hold(PAD.left, false);

    idle();
    await hold(PAD.up, true);
    expect(button("Play"), "Up off the picture opens the controls on Play").toHaveFocus();
    await hold(PAD.up, false);
    await hold(PAD.up, true);
    expect(screen.getByRole("slider", { name: "Position" })).toHaveFocus();
  });

  test("X and Y step the volume by five, repeat while held, and wake the OSD", async () => {
    fakePadClock();
    const hold = fakePad();
    const host = await renderMarqueePlayer({ volume: 60 });
    fireEvent.pointerMove(window);
    idle();

    await hold(PAD.y, true);
    expect(screen.getByTestId("shell-osd")).toBeInTheDocument();
    expect(volumeLevel()).toBe("65");

    // The debounced send lands, the Host publishes the level it took, and a
    // button still held steps again from that.
    await act(async () => {
      vi.advanceTimersByTime(80);
      await Promise.resolve();
    });
    expect(sentOf(host, "set_volume")).toEqual([{ type: "set_volume", level: 65 }]);
    await act(async () => {
      host.publish(snapshotOf(10, { volume: 65 }));
      await Promise.resolve();
    });
    act(() => vi.advanceTimersByTime(320));
    expect(volumeLevel(), "a held button repeats").toBe("70");
    await act(async () => {
      vi.advanceTimersByTime(80);
      await Promise.resolve();
    });
    expect(sentOf(host, "set_volume")).toEqual([
      { type: "set_volume", level: 65 },
      { type: "set_volume", level: 70 },
    ]);

    await hold(PAD.y, false);
    await hold(PAD.x, true);
    expect(volumeLevel()).toBe("60");
  });

  test("a pad press still reaches the player after StrictMode's remount", async () => {
    fakePadClock();
    const hold = fakePad();
    const host = fakeHost(snapshotOf(9, { volume: 60 }));
    render(
      <StrictMode>
        <MarqueeEntry client={host.client} />
      </StrictMode>,
    );
    await settle();

    await hold(PAD.y, true);
    await act(async () => {
      vi.advanceTimersByTime(80);
      await Promise.resolve();
    });

    expect(actions(host.invocations)).toContainEqual({ type: "set_volume", level: 65 });
  });

  test("the volume buttons are the player's own, and are still while a panel is open", async () => {
    fakePadClock();
    const hold = fakePad();
    const host = await renderMarqueePlayer({ volume: 60 });
    await act(async () => {
      fireEvent.click(button("Chapters"));
      await Promise.resolve();
    });

    await hold(PAD.y, true);
    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    expect(
      sentOf(host, "set_volume"),
      "the panel is the Level on top, and it has no volume of its own",
    ).toEqual([]);
  });
});

/** The Host's next episode, as an Autoplay Snapshot names it. */
const NEXT_UP = {
  title: { type: "series", id: "tt11280740" },
  video: { type: "series", id: "tt11280740:2:4" },
  episode: { season: 2, episode: 4 },
  name: "Woe's Hollow",
  still: null,
} as const;

const COUNTDOWN: AutoplaySnapshot = {
  phase: "countdown",
  remaining: 5,
  duration: 5,
  next: NEXT_UP,
};

const STILL_WATCHING: AutoplaySnapshot = { phase: "unattended_limit", next: NEXT_UP };

function missingStream(videoId: string): AutoplaySnapshot {
  return {
    phase: "no_stream",
    detail: "No Stream continues the release",
    next: { ...NEXT_UP, video: { type: "series", id: videoId } },
  };
}

function nextEpisodeAnswers(action: Action): Response | null {
  if (action.type === "open_title") {
    return { snapshots: [], answer: { title: SERIES_TITLE } };
  }
  if (action.type === "find_streams") {
    return {
      snapshots: [],
      answer: { streams: [{ addon: "torrentio", failure: null, streams: [ALT_STREAM] }] },
    };
  }
  return null;
}

describe("Marquee Player OSD — Autoplay", () => {
  test.each([
    ["countdown", COUNTDOWN],
    ["Still watching? hold", STILL_WATCHING],
  ] as const)(
    "the %s card replaces the end note, the plain prompt and its switch, and pins the OSD",
    async (_name, autoplay) => {
      fakeOsdClock();
      await renderMarqueePlayer({ state: "ended", autoplay });

      expect(screen.getByTestId("autoplay-card")).toBeInTheDocument();
      expect(screen.queryByTestId("stream-ended")).not.toBeInTheDocument();
      expect(screen.queryByTestId("next-episode-after-end")).not.toBeInTheDocument();
      expect(screen.queryByRole("switch")).not.toBeInTheDocument();

      idle(3);

      expect(screen.getByTestId("shell-osd")).toBeInTheDocument();
      expect(cursor()).toBe("visible");
    },
  );

  test("the hold has no countdown to cancel, and Keep watching never cancels", async () => {
    const host = await renderMarqueePlayer({ state: "ended", autoplay: STILL_WATCHING });
    const card = screen.getByTestId("autoplay-card");

    expect(within(card).queryByRole("button", { name: "Play now" })).not.toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "Keep watching" }));

    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({ type: "next_episode" }),
    );
    expect(actions(host.invocations)).not.toContainEqual({ type: "cancel_autoplay" });
  });

  test("a countdown leaves focus with the panel that holds it", async () => {
    const host = await renderMarqueePlayer();
    await act(async () => {
      fireEvent.click(button("Chapters"));
      await Promise.resolve();
    });
    const dialog = screen.getByRole("dialog", { name: "Chapters" });
    const held = document.activeElement;
    expect(dialog.contains(held)).toBe(true);

    await act(async () => {
      host.publish(snapshotOf(10, { state: "ended", autoplay: COUNTDOWN }));
      await Promise.resolve();
    });

    expect(screen.getByTestId("autoplay-card")).toBeInTheDocument();
    expect(document.activeElement).toBe(held);
  });

  test.each([
    [false, true],
    [true, false],
  ])(
    "the ended switch, with Autoplay %s and nothing pending, takes set_autoplay: %s",
    async (held, asked) => {
      const host = await renderMarqueePlayer(
        { state: "ended", autoplay: null },
        { autoplay: held },
      );
      const toggle = screen.getByRole("switch", { name: AUTOPLAY_SWITCH_LABEL });
      expect(toggle).toHaveAttribute("aria-checked", String(held));

      fireEvent.click(toggle);

      await waitFor(() =>
        expect(actions(host.invocations)).toContainEqual({
          type: "set_autoplay",
          autoplay: asked,
        }),
      );
    },
  );

  test("a Stream still playing draws no switch over the picture", async () => {
    await renderMarqueePlayer();

    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  test("a missing Stream opens the picker once, and never over a surface already there", async () => {
    const host = await renderMarqueePlayer({}, { respond: nextEpisodeAnswers });
    const publish = (revision: number, videoId: string) =>
      act(async () => {
        host.publish(
          snapshotOf(revision, { state: "ended", autoplay: missingStream(videoId) }),
        );
        await Promise.resolve();
      });

    await publish(10, "tt11280740:2:4");
    await screen.findByTestId("streams");
    expect(actions(host.invocations)).toContainEqual({
      type: "find_streams",
      video: { type: "series", id: "tt11280740:2:4" },
    });

    await publish(11, "tt11280740:2:4");
    // Another target is not an interruption of the list already on top.
    await publish(12, "tt11280740:1:1");

    expect(sentOf(host, "find_streams")).toHaveLength(1);
    expect(screen.getAllByTestId("streams")).toHaveLength(1);
  });

  test("a missing Stream keeps the plain ended state, with its note and Next episode", async () => {
    await renderMarqueePlayer({
      state: "ended",
      autoplay: missingStream("tt11280740:2:4"),
    });

    expect(screen.getByTestId("stream-ended")).toBeInTheDocument();
    expect(screen.getByTestId("next-episode-after-end")).toBeInTheDocument();
    expect(screen.queryByTestId("autoplay-card")).not.toBeInTheDocument();
  });
});

describe("Marquee Player OSD — returning to the Title at the end of playback", () => {
  const FILM_TITLE: Title = {
    ...SERIES_TITLE,
    id: "tt0133093",
    key: { kind: "tmdb", id: 603 },
    type: "movie",
    name: "The Matrix",
    videos: [],
  };

  /** S2 E3 is playing; the next episode airs on this date. */
  const seriesWithNextAiring = (airDate: string): Title => ({
    ...SERIES_TITLE,
    videos: SERIES_TITLE.videos.map((video) =>
      video.id === "tt11280740:2:4" ? { ...video, airDate } : video,
    ),
  });

  const answering = (title: Title) => (action: Action): Response | null =>
    action.type === "open_title" ? { snapshots: [], answer: { title } } : null;

  async function publish(
    host: ReturnType<typeof fakeHost>,
    next: Snapshot,
  ): Promise<void> {
    await act(async () => {
      host.publish(next);
      await Promise.resolve();
    });
  }

  test("a movie that finishes stops playback and opens its Title page", async () => {
    const host = await renderMarqueePlayer(MOVIE_PLAYING, { respond: answering(FILM_TITLE) });

    await publish(host, snapshotOf(10, { ...MOVIE_PLAYING, state: "ended", autoplay: null }));

    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({ type: "stop_playback" }),
    );
    await publish(host, { ...NOTHING_SAID, revision: 11 });
    expect(await screen.findByTestId("title-tt0133093")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId("shell-player")).not.toBeInTheDocument());
  });

  test("a series episode with Autoplay on and nothing armed returns to its Title page", async () => {
    const title = seriesWithNextAiring("2099-01-01");
    const host = await renderMarqueePlayer({}, { respond: answering(title) });

    await publish(host, snapshotOf(10, { state: "ended", autoplay: null }));

    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({ type: "stop_playback" }),
    );
    expect(await screen.findByTestId("title-tt11280740")).toBeInTheDocument();
  });

  test("a countdown stays on the player, and cancelling it stays on the ended state", async () => {
    const host = await renderMarqueePlayer();

    await publish(host, snapshotOf(10, { state: "ended", autoplay: COUNTDOWN }));
    expect(await screen.findByTestId("autoplay-card")).toBeInTheDocument();
    expect(actions(host.invocations)).not.toContainEqual({ type: "stop_playback" });

    await publish(host, snapshotOf(11, { state: "ended", autoplay: null }));
    expect(screen.getByTestId("stream-ended")).toBeInTheDocument();
    expect(actions(host.invocations)).not.toContainEqual({ type: "stop_playback" });
  });

  const WAIT_PREFERENCE = {
    preferences: { ...NOTHING_SAID.preferences, autoplay: false },
  };

  test("with Autoplay off, an unaired next episode returns to the Title", async () => {
    const title = seriesWithNextAiring("2099-01-01");
    const host = await renderMarqueePlayer(
      {},
      { autoplay: false, respond: answering(title) },
    );

    await publish(
      host,
      snapshotOf(10, { state: "ended", autoplay: null }, WAIT_PREFERENCE),
    );

    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({ type: "stop_playback" }),
    );
    expect(await screen.findByTestId("title-tt11280740")).toBeInTheDocument();
  });

  test("with Autoplay off, an aired next episode stays on the ended state", async () => {
    const title = seriesWithNextAiring("2020-01-01");
    const host = await renderMarqueePlayer(
      {},
      { autoplay: false, respond: answering(title) },
    );

    await publish(
      host,
      snapshotOf(10, { state: "ended", autoplay: null }, WAIT_PREFERENCE),
    );

    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({
        type: "open_title",
        addon: "cinemeta",
        title: { type: "series", id: "tt11280740" },
      }),
    );
    await act(async () => {});
    expect(screen.getByTestId("stream-ended")).toBeInTheDocument();
    expect(actions(host.invocations)).not.toContainEqual({ type: "stop_playback" });
  });
});

/** A Stream whose picture is not in this window: the dock is the transport. */
async function renderDock(
  picture: "own_window" | "nowhere",
  overrides: Partial<PlaybackSnapshot> = {},
) {
  const host = fakeHost(snapshotOf(9, { picture, ...overrides }));
  render(<MarqueeEntry client={host.client} />);
  await screen.findByTestId("player-dock");
  await act(async () => {});
  return host;
}

/**
 * jsdom measures every box as zero, so the dock's band has to be given a place
 * on the page: a browsing control above it, and its own controls in one line
 * across the foot.
 */
function layOutDock() {
  const boxes: Record<string, [number, number, number, number]> = {
    "shell-frame": [0, 0, 1920, 1080],
    "browsing-control": [300, 200, 200, 44],
    "player-dock": [0, 930, 1920, 140],
    "dock-play-pause": [300, 960, 56, 56],
    "dock-position": [420, 970, 500, 24],
    "dock-volume": [1300, 970, 140, 24],
    "dock-mute": [1460, 960, 44, 44],
    "dock-stop": [1700, 960, 48, 48],
  };

  return vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: HTMLElement): DOMRect {
      const key = this.dataset.testid;
      const [x, y, width, height] = (key ? boxes[key] : undefined) ?? [0, 0, 0, 0];
      return {
        x,
        y,
        width,
        height,
        top: y,
        left: x,
        right: x + width,
        bottom: y + height,
        toJSON: () => ({}),
      } as DOMRect;
    });
}

describe("the docked transport, where the picture is elsewhere", () => {
  test("is for a watched Stream whose picture is not in this window", () => {
    expect(dockedTransport("opening", "own_window")).toBe(true);
    expect(dockedTransport("playing", "nowhere")).toBe(true);
    expect(dockedTransport("paused", "own_window")).toBe(true);
    expect(dockedTransport("ended", "nowhere")).toBe(true);
    expect(dockedTransport("playing", "in_window")).toBe(false);
    expect(dockedTransport("idle", "own_window")).toBe(false);
    expect(dockedTransport("idle", "nowhere")).toBe(false);
  });

  test.each(["own_window", "nowhere"] as const)(
    "draws the dock instead of the OSD for %s, and leaves the page live",
    async (picture) => {
      vi.spyOn(performance, "now").mockReturnValue(0);
      const host = await renderDock(picture);

      expect(screen.queryByTestId("shell-player")).not.toBeInTheDocument();
      expect(screen.queryByTestId("shell-osd")).not.toBeInTheDocument();
      expect(screen.queryByTestId("picture-toggle")).not.toBeInTheDocument();
      expect(
        screen.getByTestId("player-dock").querySelector("[data-player-stop]"),
        "the OSD's Up/Down ladder is picture chrome and stays out of the dock",
      ).toBeNull();
      expect(screen.getByTestId("dock-elapsed")).toHaveTextContent("17:52");
      expect(screen.getByTestId("dock-remaining")).toHaveTextContent("−30:41");
      expect(screen.getByTestId("player-dock-note")).toHaveTextContent(pictureNote(picture)!);
      expect(document.body).not.toHaveClass("picture-behind");
      expect(document.documentElement).not.toHaveClass("picture-behind");

      const base = screen.getByTestId("home-screen");
      expect(base.closest("[inert]"), "the browsing page under the dock is live").toBeNull();
      expect(actions(host.invocations)).not.toContainEqual({ type: "stop_playback" });
    },
  );

  test.each(["own_window", "nowhere"] as const)(
    "the dock's transport takes the OSD's Actions for %s",
    async (picture) => {
      const host = await renderDock(picture, { muted: true });
      const expectSent = (action: Action) =>
        waitFor(() => expect(actions(host.invocations)).toContainEqual(action));

      fireEvent.click(screen.getByTestId("dock-play-pause"));
      await expectSent({ type: "set_paused", paused: true });

      fireEvent.change(screen.getByTestId("dock-position"), { target: { value: "60" } });
      fireEvent.pointerUp(screen.getByTestId("dock-position"));
      await expectSent({ type: "seek", target: { kind: "to", seconds: 60 } });

      // A key commits the range the same way a pointer release does.
      fireEvent.change(screen.getByTestId("dock-position"), { target: { value: "120" } });
      fireEvent.keyUp(screen.getByTestId("dock-position"));
      await expectSent({ type: "seek", target: { kind: "to", seconds: 120 } });

      fireEvent.change(screen.getByTestId("dock-volume"), { target: { value: "40" } });
      fireEvent.pointerUp(screen.getByTestId("dock-volume"));
      await expectSent({ type: "set_volume", level: 40 });

      fireEvent.click(screen.getByTestId("dock-mute"));
      await expectSent({ type: "set_muted", muted: false });

      fireEvent.click(screen.getByTestId("dock-stop"));
      await expectSent({ type: "stop_playback" });
    },
  );

  test("a control waiting on the Host takes no second press", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const host = fakeHost(snapshotOf(9, { picture: "own_window" }), {
      hold: { type: "stop_playback", gate },
    });
    render(<MarqueeEntry client={host.client} />);
    const stop = await screen.findByTestId("dock-stop");

    fireEvent.click(stop);
    await waitFor(() => expect(stop).toHaveAttribute("aria-busy", "true"));
    expect(stop).toBeDisabled();
    fireEvent.click(stop);
    expect(sentOf(host, "stop_playback")).toHaveLength(1);

    await act(async () => {
      release();
      await Promise.resolve();
    });
  });

  test("has no idle clock and does not hide itself", async () => {
    fakeOsdClock();
    const host = fakeHost(snapshotOf(9, { picture: "own_window" }));
    render(<MarqueeEntry client={host.client} />);
    await settle();

    expect(screen.getByTestId("player-dock")).toBeInTheDocument();
    idle(2);
    expect(screen.getByTestId("player-dock")).toBeInTheDocument();
    expect(screen.queryByTestId("shell-osd")).not.toBeInTheDocument();
  });

  test("is reachable from the page by the D-pad", async () => {
    const host = await renderDock("own_window");
    const browsing = await screen.findByRole("button", { name: "Open Addons" });
    // The harness needs a box for the base's own control; the layout spy reads
    // boxes by testid and this one carries none.
    browsing.dataset.testid = "browsing-control";
    layOutDock();

    await act(async () => browsing.focus());
    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(
      screen.getByTestId("dock-play-pause"),
      "Down from the page's own content reaches the dock band",
    ).toHaveFocus();

    fireEvent.click(screen.getByTestId("dock-play-pause"));
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({ type: "set_paused", paused: true }),
    );
  });

  test("during a countdown it offers Cancel, which takes cancel_autoplay", async () => {
    const host = await renderDock("own_window", { state: "ended", autoplay: COUNTDOWN });

    expect(screen.queryByTestId("dock-autoplay-keep-watching")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("dock-autoplay-cancel"));
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({ type: "cancel_autoplay" }),
    );
  });

  test("at the hold it offers Keep watching, not Cancel", async () => {
    const host = await renderDock("own_window", { state: "ended", autoplay: STILL_WATCHING });

    expect(screen.queryByTestId("dock-autoplay-cancel")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("dock-autoplay-keep-watching"));
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({ type: "next_episode" }),
    );
  });

  test("with nothing pending it has no Cancel and no Keep watching", async () => {
    await renderDock("own_window", { state: "ended", autoplay: null });

    expect(screen.queryByTestId("dock-autoplay-keep-watching")).not.toBeInTheDocument();
    expect(screen.queryByTestId("dock-autoplay-cancel")).not.toBeInTheDocument();
  });
});
