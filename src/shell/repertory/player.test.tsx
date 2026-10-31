import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  HostClient,
  type Action,
  type ResumeEntry,
  type Snapshot,
  type Transport,
} from "../../host-client";
import { Shell } from "../Shell";
import { PreviewDataProvider } from "./context";

const ENTRY: ResumeEntry = {
  video: {
    id: "tt14173636:1:2",
    name: "Episode Two",
    season: 1,
    episode: 2,
    thumbnail: "https://images.test/episode-two.jpg",
  },
  title: {
    addon: "cinemeta",
    id: "tt14173636",
    type: "series",
    name: "The Invite",
    poster: "https://images.test/poster.jpg",
    background: "https://images.test/backdrop.jpg",
  },
  position: 900,
  duration: 6420,
  watched: false,
  unplayable: null,
};

const PLAYING: Snapshot = {
  revision: 9,
  playback: {
    state: "playing",
    picture: "in_window",
    failure: null,
    nowPlaying: {
      video: { type: "series", id: "tt14173636:1:2" },
      addon: "cinemeta",
      name: "Cinemeta\n1080p",
      description: "A rehearsal Stream for the Player OSD.",
      filename: "The.Invite.S01E02.rehearsal.1080p.mkv",
      bingeGroup: null,
    },
    episode: { season: 1, episode: 2 },
    position: 900,
    duration: 6420,
    buffered: { start: 300, end: 2100 },
    tracks: [
      {
        id: 1,
        kind: "audio",
        language: "eng",
        title: "English 5.1",
        codec: "eac3",
        embedded: true,
        selected: true,
        default: true,
        forced: false,
      },
      {
        id: 2,
        kind: "audio",
        language: "por",
        title: "Português 5.1",
        codec: "ac3",
        embedded: true,
        selected: false,
        default: false,
        forced: false,
      },
      {
        id: 3,
        kind: "subtitle",
        language: "eng",
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
        language: "por-BR",
        title: "Português (BR)",
        codec: "subrip",
        embedded: true,
        selected: false,
        default: false,
        forced: false,
      },
    ],
    chapters: [
      { index: 0, title: "Opening", time: 0 },
      { index: 1, title: "The first movement", time: 1541 },
      { index: 2, title: "Interlude", time: 4622 },
    ],
    chapter: 0,
    speed: 1,
    volume: 60,
    muted: true,
    subtitleDelay: 0,
    crop: null,
    aspect: null,
    resolution: { width: 1920, height: 804 },
    statistics: { bitrate: 12_500_000, droppedFrames: 0, hardwareDecode: "d3d11va" },
  },
  preferences: {
    subtitleLanguage: "en",
    subtitleColor: "#FFFFFF",
    subtitleScale: 1.25,
    streamBuffer: { seconds: 300, megabytes: 512 },
  },
  addons: [],
  featuredCatalog: null,
  protection: { backend: "file", tmdbHeld: false, stremioHeld: false },
  watchProgress: [ENTRY],
  devices: [],
  pairingCode: "4K7Q2M",
  address: "192.168.1.9:8090",
};

type Hold = { type: Action["type"]; gate: Promise<void> };

function fakeHost(initial: Snapshot, hold?: Hold) {
  const invocations: Array<{ command: string; args?: Record<string, unknown> }> = [];
  let listener: ((event: { payload: Snapshot }) => void) | undefined;

  const transport: Transport = {
    invoke: async <T,>(command: string, args?: Record<string, unknown>): Promise<T> => {
      invocations.push({ command, args });
      if (command === "snapshot") {
        return initial as T;
      }
      const action = (args?.envelope as { action: Action } | undefined)?.action;
      if (hold && action?.type === hold.type) {
        await hold.gate;
      }
      return { snapshots: [], answer: null } as T;
    },
    listen: async <T,>(_event: string, handler: (event: { payload: T }) => void) => {
      listener = handler as (event: { payload: Snapshot }) => void;
      return () => {
        if (listener === handler) {
          listener = undefined;
        }
      };
    },
  };

  return { client: new HostClient(transport), invocations };
}

function actions(
  invocations: Array<{ command: string; args?: Record<string, unknown> }>,
): Action[] {
  return invocations
    .filter(({ command }) => command === "dispatch")
    .map(({ args }) => (args?.envelope as { action: Action }).action);
}

async function renderPlayer(preview = false, hold?: Hold) {
  const host = fakeHost(PLAYING, hold);
  render(
    <PreviewDataProvider value={preview}>
      <Shell client={host.client} />
    </PreviewDataProvider>,
  );
  await screen.findByTestId("shell-player");
  return host;
}

async function closePopover(testId: string) {
  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => expect(screen.queryByTestId(testId)).not.toBeInTheDocument());
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the repertory player OSD", () => {
  test("prints the programme note and the two clocks over the film", async () => {
    // The clock projects from its anchor; hold the anchor still to assert the
    // reading the Snapshot drew.
    vi.spyOn(performance, "now").mockReturnValue(0);
    await renderPlayer();

    const player = screen.getByTestId("shell-player");
    expect(player).toHaveClass("rep-player");

    expect(screen.getByTestId("osd-kicker")).toHaveTextContent("Now playing");
    expect(screen.getByTestId("osd-kicker")).toHaveTextContent("S1E2");
    expect(
      screen.getByTestId("shell-now-playing").textContent,
      "the kicker carries the episode; the display line carries the Title alone",
    ).toBe("The Invite");
    expect(screen.getByTestId("osd-quality")).toHaveTextContent("1080p");
    expect(screen.getByTestId("osd-details")).toHaveTextContent("cinemeta");
    expect(screen.getByTestId("osd-details")).toHaveTextContent("12.5 Mbps");
    expect(screen.getByTestId("osd-details")).toHaveTextContent("d3d11va");

    expect(screen.getByTestId("stop")).toHaveAccessibleName("Stop");
    expect(screen.getByTestId("volume-level")).toHaveTextContent("60%");
    expect(screen.getByText("Vol")).toBeInTheDocument();
    expect(screen.getByTestId("mute")).toHaveAttribute("aria-pressed", "true");

    expect(screen.getByTestId("elapsed")).toHaveTextContent("15:00");
    expect(screen.getByTestId("remaining")).toHaveTextContent("−1:32:00");
    const buffered = screen.getByTestId("osd-buffered");
    expect(parseFloat(buffered.style.left)).toBeCloseTo((300 / 6420) * 100, 3);
    expect(parseFloat(buffered.style.width)).toBeCloseTo((1800 / 6420) * 100, 3);

    expect(
      screen.queryByTestId("osd-current-chapter"),
      "the current chapter is named only in the hover/drag callout",
    ).not.toBeInTheDocument();
    const second = screen.getByTestId("chapter-marker-1");
    expect(second).toHaveTextContent("The first movement");
    expect(second).toHaveTextContent("25:41");
    expect(second.querySelector(".rep-osd-chapter-tick")).not.toBeNull();
    expect(screen.queryByText("◆")).not.toBeInTheDocument();
  });

  test("keeps the ladder's three stops, with the transport in the strip", async () => {
    await renderPlayer();

    expect(
      screen.getByTestId("pause").closest('[data-player-stop="strip"]'),
      "the transport is still the strip stop",
    ).not.toBeNull();
    expect(screen.getByTestId("stop").closest('[data-player-stop="top"]')).not.toBeNull();
    expect(
      screen.getByTestId("picture-toggle").closest('[data-player-stop="picture"]'),
    ).not.toBeNull();
  });

  test("the five icon popovers open as repertory panels", async () => {
    await renderPlayer();

    for (const [icon, popover] of [
      ["osd-picture", "popover-picture"],
      ["osd-subtitles", "popover-subtitles"],
      ["osd-audio", "popover-audio"],
      ["osd-speed", "popover-speed"],
      ["osd-chapters", "popover-chapters"],
    ] as const) {
      fireEvent.click(screen.getByTestId(icon));
      const panel = await screen.findByTestId(popover);
      const surface = panel.closest(".shell-osd-popover");
      expect(surface).toHaveClass("rep-osd-popover");
      await closePopover(popover);
    }
  }, 20_000);

  test("the frozen control set still takes the same Actions", async () => {
    const host = await renderPlayer();

    fireEvent.click(screen.getByTestId("pause"));
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({ type: "set_paused", paused: true }),
    );

    fireEvent.click(screen.getByTestId("rewind"));
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({
        type: "seek",
        target: { kind: "by", seconds: -10 },
      }),
    );

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

    fireEvent.click(screen.getByTestId("osd-picture"));
    const picture = await screen.findByTestId("popover-picture");
    fireEvent.click(within(picture).getByTestId("autocrop"));
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({ type: "autocrop" }),
    );
    await closePopover("popover-picture");

    fireEvent.click(screen.getByTestId("osd-subtitles"));
    const subtitles = await screen.findByTestId("popover-subtitles");
    fireEvent.click(within(subtitles).getByTestId("track-subtitle-4"));
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({ type: "set_subtitle_track", track: 4 }),
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
    fireEvent.click(within(chapters).getByTestId("chapter-1"));
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({ type: "set_chapter", index: 1 }),
    );
    await closePopover("popover-chapters");
  }, 20_000);

  test("an episode step still says it is loading, and a second press is dropped", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const host = await renderPlayer(false, { type: "next_episode", gate });

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

  test("the plain Vite rehearsal paints the film's backdrop behind the OSD", async () => {
    await renderPlayer(true);

    expect(screen.getByTestId("rehearsal-picture")).toBeInTheDocument();
    expect(screen.getByTestId("rehearsal-picture").querySelector("img")).toHaveAttribute(
      "src",
      "https://images.test/episode-two.jpg",
    );
  });

  test("the Tauri window leaves the picture to mpv", async () => {
    await renderPlayer(false);

    expect(
      screen.queryByTestId("rehearsal-picture"),
      "the real picture is mpv's child window, never a page image",
    ).not.toBeInTheDocument();
  });
});
