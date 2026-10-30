import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  HostClient,
  type Action,
  type PlaybackSnapshot,
  type ResumeEntry,
  type Snapshot,
  type Transport,
} from "../host-client";
import {
  fakeWindowState,
  installTauriRuntime,
  removeTauriRuntime,
  resetFakeWindow,
} from "./tauriWindow.testing";
import { Shell } from "./Shell";
import { OSD_IDLE_MS } from "./useOsdVisibility";

/**
 * The Tauri window the player tests hold lives in `tauriWindow.testing`, so the
 * hook's own tests and these share one fake; the module mock points the Tauri
 * window API at it so fullscreen can be walked in jsdom.
 */
vi.mock("@tauri-apps/api/window", async () => {
  const fake = await import("./tauriWindow.testing");
  return { getCurrentWindow: () => fake.fakeTauriWindow };
});

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
    buffered: null,
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
  preferences: { subtitleLanguage: null, subtitleColor: "#FFFFFF", subtitleScale: 1, streamBuffer: { seconds: 300, megabytes: 512 } },
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
    buffered: { start: 900, end: 1800 },
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

/** A dispatch a test holds open, so the wait a control draws can be observed. */
type Hold = { type: Action["type"]; gate: Promise<void> };

/**
 * What the fake Host answers a Seek preview with (#140): the still of the moment
 * asked about, and a gate a test can hold the answer behind.
 */
type PreviewAnswers = (at: number) => { image: string | null; gate?: Promise<void> };

function fakeHost(
  initial: Snapshot,
  reject?: Rejection,
  hold?: Hold,
  answers?: PreviewAnswers,
) {
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
      if (action?.type === "preview") {
        const answered = answers?.(action.at) ?? { image: null };
        if (answered.gate) {
          await answered.gate;
        }
        return {
          snapshots: [],
          answer: { preview: { at: action.at, image: answered.image } },
        } as T;
      }
      if (hold && action?.type === hold.type) {
        await hold.gate;
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
  watchProgress: ResumeEntry[] = [],
  hold?: Hold,
  answers?: PreviewAnswers,
) {
  const host = fakeHost(
    { ...NOTHING_SAID, revision: 9, playback: playback(overrides), watchProgress },
    reject,
    hold,
    answers,
  );
  render(<Shell client={host.client} />);
  await screen.findByTestId("shell-player");
  // The player's effects run after the first commit: the preview hook's stream
  // reset must land before a test points at the bar, or the answer for that
  // point is dropped as a still of the previous Stream.
  await act(async () => {});
  return host;
}

function resumeEntry(overrides: Partial<ResumeEntry> = {}): ResumeEntry {
  return {
    video: {
      id: "tt7777777:1:1",
      name: "Episode One",
      season: 1,
      episode: 1,
      thumbnail: "https://images.test/episode-one.jpg",
    },
    title: {
      addon: "community.aiostreams",
      id: "tt7777777",
      type: "series",
      name: "A Series That Plays",
      poster: "https://images.test/series-poster.jpg",
      background: "https://images.test/series-backdrop.jpg",
    },
    position: 0,
    duration: null,
    watched: false,
    unplayable: null,
    ...overrides,
  };
}

/** Close the open popover the way Back does, and wait for its level to go. */
async function closePopover(testId: string) {
  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => expect(screen.queryByTestId(testId)).not.toBeInTheDocument());
}

/**
 * jsdom measures every box as zero, so the spatial engine sees every control
 * stacked on one point and Left/Right cannot move. Give the player's stops a
 * screen to stand on.
 */
function layOutPlayer() {
  const boxes: Record<string, [number, number, number, number]> = {
    player: [0, 0, 1920, 1080],
    picture: [0, 0, 1920, 1080],
    "picture-toggle": [0, 0, 1920, 1080],
    "osd-strip": [0, 900, 1920, 80],
    "osd-volume": [1840, 400, 60, 300],
    top: [1680, 16, 220, 40],
    fullscreen: [1680, 16, 40, 40],
    stop: [1730, 16, 40, 40],
    "osd-picture": [40, 920, 40, 40],
    "osd-subtitles": [90, 920, 40, 40],
    "osd-audio": [140, 920, 40, 40],
    "previous-episode": [700, 920, 40, 40],
    rewind: [750, 920, 60, 40],
    play: [820, 920, 40, 40],
    pause: [820, 920, 40, 40],
    forward: [870, 920, 60, 40],
    "next-episode": [940, 920, 40, 40],
    "osd-speed": [1560, 920, 60, 40],
    "osd-chapters": [1630, 920, 40, 40],
    volume: [1850, 420, 40, 200],
    mute: [1850, 650, 40, 40],
    position: [0, 1020, 1920, 24],
    "osd-timeline": [0, 1020, 1920, 48],
  };

  return vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: HTMLElement): DOMRect {
      const key = this.dataset.testid ?? this.dataset.region ?? this.dataset.playerStop;
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

/** A standard-mapping pad jsdom's `useGamepad` can poll, with every button up. */
function fakePad() {
  const buttons = Array.from({ length: 16 }, () => ({ pressed: false }));
  const pad = { connected: true, mapping: "standard", buttons, axes: [] as number[] };
  Object.defineProperty(navigator, "getGamepads", {
    configurable: true,
    value: () => [pad],
  });
  return buttons;
}

/** Press or release one of the fake pad's buttons. */
function press(buttons: Array<{ pressed: boolean }>, index: number, down: boolean) {
  const button = buttons[index];
  if (button) {
    button.pressed = down;
  }
}

/** The timers a pad test needs: the OSD's own clock, and the poll's frames. */
const PAD_TIMERS: {
  toFake: Array<"setTimeout" | "clearTimeout" | "requestAnimationFrame" | "cancelAnimationFrame">;
} = {
  toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"],
};

beforeEach(() => {
  resetFakeWindow();
  installTauriRuntime();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "getGamepads");
  removeTauriRuntime();
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
    expect(
      document.documentElement,
      "the browsing page underneath offers no scrollbar while the player owns the window",
    ).toHaveClass("picture-behind");
  });

  test("draws the buffered reading behind the played fill", async () => {
    await renderPlayer();

    const buffered = screen.getByTestId("osd-buffered");
    expect(buffered).toHaveStyle({ left: "25%", width: "25%" });
    expect(
      screen.getByTestId("osd-timeline").querySelector(".shell-osd-track")?.firstElementChild,
      "the muted reading is painted under the accent fill and the playhead",
    ).toBe(buffered);
  });

  test("draws no buffered layer when the Player says nothing is read ahead", async () => {
    await renderPlayer({ buffered: null });

    expect(screen.queryByTestId("osd-buffered")).not.toBeInTheDocument();
  });

  test("leaves the gap a forward seek opened unread", async () => {
    await renderPlayer({ position: 1200, buffered: { start: 300, end: 900 } });

    const buffered = screen.getByTestId("osd-buffered");
    expect(parseFloat(buffered.style.left)).toBeCloseTo(8.3333, 3);
    expect(parseFloat(buffered.style.width)).toBeCloseTo(16.6667, 3);

    const playhead = screen
      .getByTestId("osd-timeline")
      .querySelector(".shell-osd-playhead") as HTMLElement;
    expect(parseFloat(playhead.style.left)).toBeCloseTo(33.3333, 3);
  });

  describe("the Seek preview", () => {
    /**
     * A still is a Question answered by the Host, and CI runs the whole suite
     * with every worker busy: the promise chain can take longer than Testing
     * Library's default second. The wait stays under the per-test budget below,
     * which is raised for the same reason.
     */
    const WAIT = { timeout: 3_000 };
    const BUDGET = 20_000;

    /** A still a test can tell from another by its own bytes. */
    const STILL = "data:image/jpeg;base64,Zmlyc3Q=";
    const OTHER = "data:image/jpeg;base64,c2Vjb25k";

    /** Point at the bar at this fraction of its width. */
    function pointAt(fraction: number) {
      fireEvent.pointerMove(screen.getByTestId("osd-timeline"), {
        clientX: Math.round(1920 * fraction),
      });
    }

    test(
      "asks for the still of the moment pointed at and draws it with its time and chapter",
      async () => {
        const host = await renderPlayer({}, undefined, [], undefined, () => ({ image: STILL }));
        layOutPlayer();

        pointAt(0.25);

        await waitFor(
          () => expect(screen.getByTestId("osd-preview-still")).toHaveAttribute("src", STILL),
          WAIT,
        );
        expect(actions(host.invocations)).toContainEqual({ type: "preview", at: 900 });
        expect(screen.getByTestId("osd-preview-time")).toHaveTextContent("15:00");
        expect(
          screen.getByTestId("osd-preview-chapter"),
          "15:00 is inside the chapter that began at the Stream's start",
        ).toHaveTextContent("Opening");
        expect(screen.getByTestId("osd-preview")).toHaveAttribute("data-pending", "false");
      },
      BUDGET,
    );

    test(
      "asks nothing twice for one bucket, and asks nothing at all where the pointer leaves",
      async () => {
        const host = await renderPlayer({}, undefined, [], undefined, () => ({ image: STILL }));
        layOutPlayer();

        pointAt(0.25);
        await waitFor(
          () => expect(screen.getByTestId("osd-preview-still")).toBeInTheDocument(),
          WAIT,
        );
        // A moment four seconds later is the same five-second bucket.
        pointAt(0.25 + 4 / 3600);
        await waitFor(() =>
          expect(
            actions(host.invocations).filter((action) => action.type === "preview"),
          ).toHaveLength(1),
        );

        fireEvent.pointerLeave(screen.getByTestId("osd-timeline"));
        await waitFor(
          () => expect(screen.queryByTestId("osd-preview")).not.toBeInTheDocument(),
          WAIT,
        );
        expect(
          actions(host.invocations).filter((action) => action.type === "preview"),
        ).toHaveLength(1);
      },
      BUDGET,
    );

    test(
      "keeps the still already drawn, dimmed, while the next bucket is not ready",
      async () => {
        let release = () => {};
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        await renderPlayer({}, undefined, [], undefined, (at) =>
          at === 900 ? { image: STILL } : { image: OTHER, gate },
        );
        layOutPlayer();
        pointAt(0.25);
        await waitFor(
          () => expect(screen.getByTestId("osd-preview-still")).toHaveAttribute("src", STILL),
          WAIT,
        );

        pointAt(0.625);

        await waitFor(
          () => expect(screen.getByTestId("osd-preview")).toHaveAttribute("data-pending", "true"),
          WAIT,
        );
        expect(
          screen.getByTestId("osd-preview-still"),
          "the still already drawn stays under the pointer while the next bucket is asked for",
        ).toHaveAttribute("src", STILL);
        expect(screen.getByTestId("osd-preview-time")).toHaveTextContent("37:30");

        await act(async () => {
          release();
        });

        await waitFor(
          () => expect(screen.getByTestId("osd-preview-still")).toHaveAttribute("src", OTHER),
          WAIT,
        );
        expect(screen.getByTestId("osd-preview")).toHaveAttribute("data-pending", "false");
        expect(screen.getByTestId("osd-preview-chapter")).toHaveTextContent("The Choice");
      },
      BUDGET,
    );

    test(
      "draws the time and the chapter alone when the Host has no still to give",
      async () => {
        await renderPlayer({}, undefined, [], undefined, () => ({ image: null }));
        layOutPlayer();

        pointAt(0.625);

        await waitFor(
          () => expect(screen.getByTestId("osd-preview")).toHaveAttribute("data-pending", "false"),
          WAIT,
        );
        expect(screen.queryByTestId("osd-preview-still")).not.toBeInTheDocument();
        expect(screen.getByTestId("osd-preview-time")).toHaveTextContent("37:30");
        expect(screen.getByTestId("osd-preview-chapter")).toHaveTextContent("The Choice");
      },
      BUDGET,
    );

    test(
      "keeps one ask in flight and lets the newest bucket win",
      async () => {
        let release = () => {};
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const host = await renderPlayer({}, undefined, [], undefined, (at) =>
          at === 900 ? { image: STILL, gate } : { image: OTHER },
        );
        layOutPlayer();

        pointAt(0.25);
        await waitFor(() =>
          expect(
            actions(host.invocations).filter((action) => action.type === "preview"),
          ).toHaveLength(1),
        );
        // The pointer moves on while the first still is still being taken: the
        // second ask is held until the first answers, and it is the newest bucket.
        pointAt(0.625);
        expect(
          actions(host.invocations).filter((action) => action.type === "preview"),
          "one ask in flight: the younger bucket waits rather than queueing behind the elder",
        ).toHaveLength(1);

        await act(async () => {
          release();
        });

        await waitFor(() =>
          expect(
            actions(host.invocations).filter((action) => action.type === "preview"),
          ).toEqual([
            { type: "preview", at: 900 },
            { type: "preview", at: 2250 },
          ]),
        );
        await waitFor(
          () => expect(screen.getByTestId("osd-preview-still")).toHaveAttribute("src", OTHER),
          WAIT,
        );
      },
      BUDGET,
    );
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

  test("a popover closes when something outside it is pressed or focused", async () => {
    await renderPlayer();

    fireEvent.click(screen.getByTestId("osd-picture"));
    await screen.findByTestId("popover-picture");
    fireEvent.click(screen.getByTestId("popover-scrim"));
    await waitFor(() =>
      expect(screen.queryByTestId("popover-picture")).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("shell-player")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("osd-audio"));
    await screen.findByTestId("popover-audio");
    await act(async () => {
      screen.getByTestId("picture-toggle").focus();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(screen.queryByTestId("popover-audio")).not.toBeInTheDocument(),
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

  test("a next-episode step says it is loading and a second press sends nothing", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const host = await renderPlayer(
      { episode: { season: 1, episode: 2 } },
      undefined,
      [],
      { type: "next_episode", gate },
    );

    fireEvent.click(screen.getByTestId("next-episode"));
    fireEvent.click(screen.getByTestId("next-episode"));

    expect(await screen.findByTestId("episode-loading")).toHaveTextContent(
      "Loading the next episode…",
    );
    expect(screen.getByTestId("next-episode")).toBeDisabled();
    expect(screen.getByTestId("previous-episode")).toBeDisabled();
    expect(
      actions(host.invocations).filter((action) => action.type === "next_episode"),
    ).toHaveLength(1);

    await act(async () => {
      release();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(screen.queryByTestId("episode-loading")).not.toBeInTheDocument(),
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

  test("the Picture menu's Autocrop button sends the autocrop Action", async () => {
    const host = await renderPlayer();

    fireEvent.click(screen.getByTestId("osd-picture"));
    const picture = await screen.findByTestId("popover-picture");
    const autocrop = within(picture).getByTestId("autocrop");
    expect(autocrop).toHaveTextContent("Autocrop");
    expect(
      autocrop,
      "a toggle the Host performs, not a choice of crop: nothing is pressed",
    ).not.toHaveAttribute("aria-pressed");

    fireEvent.click(autocrop);
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({ type: "autocrop" }),
    );
  });

  test("with a crop set the Autocrop button offers to restore the full frame", async () => {
    await renderPlayer({ crop: { width: 96, height: 72, x: 16, y: 0 } });

    fireEvent.click(screen.getByTestId("osd-picture"));
    const picture = await screen.findByTestId("popover-picture");

    expect(within(picture).getByTestId("autocrop")).toHaveTextContent("Restore full frame");
  });

  test("the Subtitles menu's size readout is the Host's preference, and its buttons step it", async () => {
    const host = await renderPlayer();
    act(() =>
      host.publish({
        ...NOTHING_SAID,
        revision: 10,
        playback: playback(),
        preferences: {
          subtitleLanguage: null,
          subtitleColor: "#FFFFFF",
          subtitleScale: 1.25, streamBuffer: { seconds: 300, megabytes: 512 },
        },
      }),
    );

    fireEvent.click(screen.getByTestId("osd-subtitles"));
    const subtitles = await screen.findByTestId("popover-subtitles");
    expect(within(subtitles).getByTestId("subtitle-scale")).toHaveTextContent("125%");
    // The readout is visible text, not only an aria-label a UIA walk may not name.
    expect(within(subtitles).getByTestId("subtitle-scale")).toHaveTextContent(
      "Subtitle size 125%",
    );
    expect(within(subtitles).getByTestId("subtitle-scale")).toHaveAccessibleName(
      "Subtitle size 125%",
    );

    fireEvent.click(within(subtitles).getByTestId("subtitle-scale-up"));
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({
        type: "set_subtitle_scale",
        scale: 1.5,
      }),
    );

    fireEvent.click(within(subtitles).getByTestId("subtitle-scale-down"));
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({
        type: "set_subtitle_scale",
        scale: 1,
      }),
    );

    expect(within(subtitles).queryByTestId("subtitle-color")).toBeNull();
    await closePopover("popover-subtitles");
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

    expect(within(subtitles).getByTestId("subtitle-scale")).toHaveTextContent("100%");
    fireEvent.click(within(subtitles).getByTestId("subtitle-scale-up"));
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({
        type: "set_subtitle_scale",
        scale: 1.25,
      }),
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

  test("the wait for mpv shows the Title's own art instead of an empty hole", async () => {
    await renderPlayer(
      {
        state: "opening",
        position: null,
        duration: null,
        nowPlaying: {
          video: { type: "series", id: "tt7777777:1:1" },
          addon: "community.aiostreams",
          name: "AIOStreams\nS1E1 720p",
          description: null,
          filename: null,
          bingeGroup: null,
        },
      },
      undefined,
      [resumeEntry()],
    );

    const preview = screen.getByTestId("opening-preview");
    expect(preview).toHaveAttribute("data-art", "true");
    expect(
      screen.getByTestId("opening-preview-art"),
      "the episode still is the closest thing to the frame that is coming",
    ).toHaveAttribute("src", "https://images.test/episode-one.jpg");
    expect(preview).toHaveTextContent("A Series That Plays");
    expect(preview).toHaveTextContent("S1E1 · Episode One");
    expect(screen.getByTestId("opening-stream")).toHaveTextContent("Opening");
  });

  test("the title pill names the Title, not the Addon's release badges", async () => {
    await renderPlayer(
      {
        nowPlaying: {
          video: { type: "series", id: "tt7777777:1:1" },
          addon: "community.aiostreams",
          name: "AIOStreams\n4K HDR\n(Remux)\n★★★",
          description: null,
          filename: null,
          bingeGroup: null,
        },
      },
      undefined,
      [resumeEntry()],
    );

    expect(screen.getByTestId("shell-now-playing")).toHaveTextContent(
      "A Series That Plays",
    );
    expect(screen.getByTestId("osd-kicker")).toHaveTextContent("S1E1");
    expect(screen.getByTestId("shell-now-playing")).not.toHaveTextContent("Remux");
  });

  test("the scroll wheel nudges the volume once, and shows the level at once", async () => {
    const host = await renderPlayer({ volume: 60 });
    const player = screen.getByTestId("shell-player");

    fireEvent.wheel(player, { deltaY: -100 });
    expect(screen.getByTestId("volume-level")).toHaveTextContent("65%");
    fireEvent.wheel(player, { deltaY: -100 });
    expect(screen.getByTestId("volume-level")).toHaveTextContent("70%");

    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({ type: "set_volume", level: 70 }),
    );
    expect(
      actions(host.invocations).filter((action) => action.type === "set_volume"),
      "a run of notches is one Action, not one per notch",
    ).toHaveLength(1);
  });

  test("the OSD offers fullscreen beside Stop, and its label follows the window", async () => {
    await renderPlayer();

    const fullscreen = screen.getByTestId("fullscreen");
    expect(fullscreen).toHaveAccessibleName("Full screen");
    expect(fullscreen).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(fullscreen);

    await waitFor(() =>
      expect(screen.getByTestId("fullscreen")).toHaveAccessibleName("Exit full screen"),
    );
    expect(screen.getByTestId("fullscreen")).toHaveAttribute("aria-pressed", "true");
    expect(fakeWindowState().calls).toEqual([true]);
  });

  test("F11 is the window's from the player, and a held key is one press", async () => {
    await renderPlayer();
    await waitFor(() => expect(fakeWindowState().resized.size).toBe(1));
    expect(screen.getByTestId("fullscreen")).toHaveAccessibleName("Full screen");

    let taken = false;
    await act(async () => {
      const event = new KeyboardEvent("keydown", {
        key: "F11",
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(event);
      taken = event.defaultPrevented;
    });
    expect(taken, "the native window's F11 is taken").toBe(true);
    await waitFor(() =>
      expect(screen.getByTestId("fullscreen"), "the OSD hears the same fact").toHaveAccessibleName(
        "Exit full screen",
      ),
    );
    expect(fakeWindowState().calls).toEqual([true]);

    let heldTaken = false;
    await act(async () => {
      const event = new KeyboardEvent("keydown", {
        key: "F11",
        repeat: true,
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(event);
      heldTaken = event.defaultPrevented;
    });
    expect(heldTaken, "a held key is not a second press").toBe(false);
    expect(fakeWindowState().calls).toEqual([true]);

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "F11", bubbles: true, cancelable: true }),
      );
    });
    await waitFor(() =>
      expect(screen.getByTestId("fullscreen")).toHaveAccessibleName("Full screen"),
    );
    expect(fakeWindowState().calls).toEqual([true, false]);
  });

  test("Stop leaves the window fullscreen, and the browsing chrome says so", async () => {
    const host = await renderPlayer();
    await waitFor(() => expect(fakeWindowState().resized.size).toBe(1));

    fireEvent.click(screen.getByTestId("fullscreen"));
    await waitFor(() =>
      expect(screen.getByTestId("fullscreen")).toHaveAccessibleName("Exit full screen"),
    );

    fireEvent.click(screen.getByTestId("stop"));
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({ type: "stop_playback" }),
    );

    // The Host answers a stop with an idle Snapshot; the shell then takes the
    // player level away and the browsing surface gets its own control back.
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

  test("without a Tauri window the OSD draws no fullscreen control", async () => {
    removeTauriRuntime();
    await renderPlayer();

    expect(
      screen.queryByTestId("fullscreen"),
      "a button that cannot work is worse than no button",
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("stop"), "Stop is still the top row's control").toBeInTheDocument();
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

  test("the OSD hides after three idle seconds and summons again on input", async () => {
    vi.useFakeTimers();
    const host = fakeHost({ ...NOTHING_SAID, revision: 9, playback: playback() });
    render(<Shell client={host.client} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId("shell-osd")).toBeInTheDocument();

    fireEvent.pointerMove(window);
    act(() => vi.advanceTimersByTime(OSD_IDLE_MS - 1));
    expect(screen.getByTestId("shell-osd")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByTestId("shell-osd")).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: "x" });
    expect(screen.getByTestId("shell-osd")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(OSD_IDLE_MS));
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
    fireEvent.keyDown(document, { key: "x" });
    act(() => vi.advanceTimersByTime(OSD_IDLE_MS));

    expect(screen.getByTestId("shell-osd")).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByTestId("stop"));

    vi.useRealTimers();
  });

  test("a clicked control does not pin the OSD after the mouse stops", async () => {
    vi.useFakeTimers();
    const host = fakeHost({ ...NOTHING_SAID, revision: 9, playback: playback() });
    render(<Shell client={host.client} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      screen.getByTestId("volume").focus();
    });
    fireEvent.pointerMove(window);
    act(() => vi.advanceTimersByTime(OSD_IDLE_MS));

    expect(screen.queryByTestId("shell-osd")).not.toBeInTheDocument();

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
    act(() => vi.advanceTimersByTime(OSD_IDLE_MS));

    expect(screen.getByTestId("shell-osd")).toBeInTheDocument();
    expect(screen.getByTestId("popover-chapters")).toBeInTheDocument();

    vi.useRealTimers();
  });
});

describe("the player's focus ladder", () => {
  test("summons the OSD on Play, walks up to Full screen and Stop, and down again", async () => {
    vi.useFakeTimers();
    layOutPlayer();
    const host = fakeHost({
      ...NOTHING_SAID,
      revision: 9,
      playback: playback({ state: "paused" }),
    });
    render(<Shell client={host.client} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Watching without touching anything: the OSD puts itself away and the
    // picture — the largest control in the window — keeps the focus.
    fireEvent.pointerMove(window);
    act(() => vi.advanceTimersByTime(OSD_IDLE_MS));
    expect(screen.queryByTestId("shell-osd")).not.toBeInTheDocument();
    expect(screen.getByTestId("picture-toggle")).toHaveFocus();

    fireEvent.keyDown(document, { key: "ArrowUp" });
    expect(screen.getByTestId("shell-osd"), "Up off the picture summons the OSD").toBeInTheDocument();
    expect(screen.getByTestId("play"), "the strip opens on its remembered control: Play").toHaveFocus();

    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(
      screen.getByTestId("forward"),
      "Left/Right is still the strip's own geometry: Play to Forward",
    ).toHaveFocus();
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(screen.getByTestId("play")).toHaveFocus();

    fireEvent.keyDown(document, { key: "ArrowUp" });
    expect(screen.getByTestId("fullscreen"), "the top row opens on Full screen").toHaveFocus();

    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(
      screen.getByTestId("stop"),
      "Left/Right is still the row's own geometry: Full screen to Stop",
    ).toHaveFocus();

    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(
      screen.getByTestId("play"),
      "Down from the top returns to the strip's remembered control",
    ).toHaveFocus();

    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(screen.getByTestId("picture-toggle")).toHaveFocus();

    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(
      screen.getByTestId("picture-toggle"),
      "the bottom of the ladder is a wall",
    ).toHaveFocus();

    vi.useRealTimers();
  });

  test("each stop remembers the control it was left on", async () => {
    await renderPlayer();

    await act(async () => {
      screen.getByTestId("osd-chapters").focus();
    });
    expect(screen.getByTestId("osd-chapters")).toHaveFocus();

    fireEvent.keyDown(document, { key: "ArrowUp" });
    expect(screen.getByTestId("fullscreen")).toHaveFocus();

    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(
      screen.getByTestId("osd-chapters"),
      "not Play: the strip went back to where it was left",
    ).toHaveFocus();

    await act(async () => {
      screen.getByTestId("stop").focus();
    });
    expect(screen.getByTestId("stop")).toHaveFocus();

    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(
      screen.getByTestId("osd-chapters"),
      "the strip's memory, not the strip's head",
    ).toHaveFocus();

    fireEvent.keyDown(document, { key: "ArrowUp" });
    expect(
      screen.getByTestId("stop"),
      "not Full screen: the top row went back to where it was left",
    ).toHaveFocus();
  });

  test("a control outside the stops answers Up and Down as the strip does", async () => {
    layOutPlayer();
    await renderPlayer();

    await act(async () => {
      screen.getByTestId("volume").focus();
    });
    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(screen.getByTestId("picture-toggle"), "Down reaches the picture").toHaveFocus();

    await act(async () => {
      screen.getByTestId("volume").focus();
    });
    fireEvent.keyDown(document, { key: "ArrowUp" });
    expect(screen.getByTestId("fullscreen"), "Up reaches the top row").toHaveFocus();
  });

  test("Up in an opening Stream lands on the strip's head, since Play is not drawn yet", async () => {
    // Opening has no transport, so the preferred Play does not exist: Up must
    // still land somewhere in the strip rather than nowhere.
    vi.useFakeTimers();
    const host = fakeHost({
      ...NOTHING_SAID,
      revision: 9,
      playback: playback({ state: "opening", position: null, duration: null }),
    });
    render(<Shell client={host.client} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    fireEvent.pointerMove(window);
    act(() => vi.advanceTimersByTime(OSD_IDLE_MS));
    expect(screen.queryByTestId("shell-osd")).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: "ArrowUp" });
    expect(screen.getByTestId("shell-osd")).toBeInTheDocument();
    expect(
      screen.getByTestId("osd-picture"),
      "the strip's first focusable, because the preferred Play is not drawn yet",
    ).toHaveFocus();

    vi.useRealTimers();
  });
});

describe("the pad in the player", () => {
  test("a pad press summons the OSD, walks the ladder, and wakes it from the picture", async () => {
    vi.useFakeTimers(PAD_TIMERS);
    const buttons = fakePad();
    const host = fakeHost({
      ...NOTHING_SAID,
      revision: 9,
      playback: playback({ state: "paused" }),
    });
    render(<Shell client={host.client} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Watching without touching anything: the OSD puts itself away and the
    // picture — the largest control in the window — keeps the focus.
    fireEvent.pointerMove(window);
    act(() => vi.advanceTimersByTime(OSD_IDLE_MS));
    expect(screen.queryByTestId("shell-osd")).not.toBeInTheDocument();

    // Left is not the ladder's move, but it is still input: it summons the OSD
    // and leaves focus where it was, because the picture has no neighbour.
    press(buttons, 14, true); // D-pad left
    act(() => vi.advanceTimersByTime(16));
    expect(
      screen.getByTestId("shell-osd"),
      "a sideways pad press wakes the OSD too",
    ).toBeInTheDocument();
    expect(screen.getByTestId("picture-toggle")).toHaveFocus();

    press(buttons, 14, false);
    act(() => vi.advanceTimersByTime(16));

    // It goes away again, and Up off the picture opens it on Play.
    fireEvent.pointerMove(window);
    act(() => vi.advanceTimersByTime(OSD_IDLE_MS));
    expect(screen.queryByTestId("shell-osd")).not.toBeInTheDocument();

    press(buttons, 12, true); // D-pad up
    act(() => vi.advanceTimersByTime(16));
    expect(
      screen.getByTestId("play"),
      "Up off the picture opens the strip on Play",
    ).toHaveFocus();

    // Released and pressed again, the same direction takes the next rung.
    press(buttons, 12, false);
    act(() => vi.advanceTimersByTime(16));
    press(buttons, 12, true);
    act(() => vi.advanceTimersByTime(16));
    expect(screen.getByTestId("fullscreen"), "and Up again opens the top row").toHaveFocus();

    vi.useRealTimers();
  });

  test("X and Y step the volume by five, repeat while held, and wake the OSD", async () => {
    vi.useFakeTimers(PAD_TIMERS);
    const buttons = fakePad();
    const host = fakeHost({ ...NOTHING_SAID, revision: 9, playback: playback({ volume: 60 }) });
    render(<Shell client={host.client} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    fireEvent.pointerMove(window);
    act(() => vi.advanceTimersByTime(OSD_IDLE_MS));
    expect(screen.queryByTestId("shell-osd")).not.toBeInTheDocument();

    press(buttons, 3, true); // Y, the top face
    act(() => vi.advanceTimersByTime(16));
    expect(screen.getByTestId("shell-osd"), "the volume buttons wake the OSD").toBeInTheDocument();
    expect(screen.getByTestId("volume-level")).toHaveTextContent("65%");

    // The debounced send lands, and the Host publishes the level it took; a
    // button still held steps again from that.
    act(() => vi.advanceTimersByTime(80));
    await act(async () => {
      await Promise.resolve();
    });
    expect(actions(host.invocations)).toContainEqual({ type: "set_volume", level: 65 });
    await act(async () => {
      host.publish({ ...NOTHING_SAID, revision: 10, playback: playback({ volume: 65 }) });
      await Promise.resolve();
    });

    act(() => vi.advanceTimersByTime(320));
    expect(screen.getByTestId("volume-level"), "a held button repeats").toHaveTextContent("70%");

    act(() => vi.advanceTimersByTime(80));
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      actions(host.invocations).filter((action) => action.type === "set_volume"),
      "each press is one debounced Action, in the levels it settled on",
    ).toEqual([
      { type: "set_volume", level: 65 },
      { type: "set_volume", level: 70 },
    ]);

    press(buttons, 3, false);
    act(() => vi.advanceTimersByTime(16));
    press(buttons, 2, true); // X, the left face
    act(() => vi.advanceTimersByTime(16));
    expect(screen.getByTestId("volume-level")).toHaveTextContent("60%");

    vi.useRealTimers();
  });

  test("a pad press still reaches the player after StrictMode's remount", async () => {
    vi.useFakeTimers(PAD_TIMERS);
    const buttons = fakePad();
    const host = fakeHost({ ...NOTHING_SAID, revision: 9, playback: playback({ volume: 60 }) });
    render(
      <StrictMode>
        <Shell client={host.client} />
      </StrictMode>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    press(buttons, 3, true);
    act(() => vi.advanceTimersByTime(16));
    act(() => vi.advanceTimersByTime(80));
    await act(async () => {
      await Promise.resolve();
    });

    expect(actions(host.invocations)).toContainEqual({ type: "set_volume", level: 65 });

    vi.useRealTimers();
  });

  test("the volume buttons are the player's own, and are still while a popover is open", async () => {
    vi.useFakeTimers(PAD_TIMERS);
    const buttons = fakePad();
    const host = fakeHost({ ...NOTHING_SAID, revision: 9, playback: playback({ volume: 60 }) });
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

    press(buttons, 3, true);
    act(() => vi.advanceTimersByTime(16));
    act(() => vi.advanceTimersByTime(200));
    await act(async () => {
      await Promise.resolve();
    });

    expect(
      actions(host.invocations).filter((action) => action.type === "set_volume"),
      "the popover is the level on top, and it has no volume of its own",
    ).toEqual([]);

    vi.useRealTimers();
  });
});
