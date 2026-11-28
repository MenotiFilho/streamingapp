import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import type { ReactNode } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { actionKey } from "../../core/actionKey";
import { HomeStore } from "../../core/homeStore";
import { installPointerPress } from "../../core/react/pointerPress";
import type { Action, AddonManifest, ContinueEntry, Snapshot, Title } from "../../core/wire";
import { ShellContext, type ActionOutcome, type NewShellLevel, type ShellContextValue } from "../context";
import { focusAndReveal } from "../reveal";
import { quietSession } from "../session.testing";
import { MarqueeTitleScreen, useMarqueeTitleOpener } from "./MarqueeTitle";

let previousSkipAnimations: boolean | undefined;
beforeAll(() => {
  previousSkipAnimations = MotionGlobalConfig.skipAnimations;
  MotionGlobalConfig.skipAnimations = true;
});
afterAll(() => {
  MotionGlobalConfig.skipAnimations = previousSkipAnimations;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const CINEMETA: AddonManifest = {
  id: "cinemeta",
  name: "Cinemeta",
  version: "3.0.14",
  resources: [{ name: "meta", types: ["movie", "series"], idPrefixes: ["tt"] }],
  types: ["movie", "series"],
  catalogs: [],
  idPrefixes: ["tt"],
  behaviorHints: { configurable: false, configurationRequired: false },
  enabled: true,
};

const SNAPSHOT: Snapshot = {
  revision: 1,
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
  addons: [CINEMETA],
  featuredCatalog: null,
  protection: { backend: "file", tmdbHeld: false, stremioHeld: false },
  continueWatching: [],
  watchProgress: [],
  devices: [],
  pairingCode: "----",
  address: null,
};

const SERIES: Title = {
  addon: "cinemeta",
  id: "tt11280740",
  key: { kind: "addon", addon: "cinemeta", id: "tt11280740" },
  type: "series",
  name: "Severance",
  poster: "https://images.test/sev-poster.jpg",
  background: "https://images.test/sev-backdrop.jpg",
  logo: "https://images.test/sev-logo.png",
  description: "Mark leads a team of office workers.",
  releaseInfo: "2022–",
  runtime: "49 min",
  imdbRating: "8.6",
  genres: ["Drama", "Mystery", "Sci-Fi"],
  videos: [
    {
      id: "tt11280740:1:1",
      name: "Good News About Hell",
      season: 1,
      episode: 1,
      thumbnail: "https://images.test/s1e1.jpg",
      airDate: "2022-02-18",
      description: "Mark is promoted to lead the macrodata refinement department.",
    },
    {
      id: "tt11280740:2:3",
      name: "Who Is Alive?",
      season: 2,
      episode: 3,
      thumbnail: "https://images.test/s2e3.jpg",
      airDate: "2025-01-31",
      description: "Mark, Helly, Irving, and Dylan search for answers.",
    },
  ],
};

const FILM: Title = {
  ...SERIES,
  id: "tt15239678",
  key: { kind: "tmdb", id: 693134 },
  type: "movie",
  name: "Dune: Part Two",
  logo: null,
  releaseInfo: "2024",
  runtime: "167 min",
  imdbRating: "8.4",
  genres: ["Action", "Drama"],
  videos: [],
};

function continueEntry(overrides: Partial<ContinueEntry> = {}): ContinueEntry {
  return {
    video: SERIES.videos[1]!,
    title: {
      addon: "cinemeta",
      id: SERIES.id,
      type: "series",
      name: "Severance",
      poster: null,
      background: null,
      logo: null,
    },
    position: 900,
    duration: 2760,
    watched: false,
    upNext: false,
    unplayable: null,
    ...overrides,
  };
}

function harness(overrides: Partial<ShellContextValue> = {}) {
  const pushed: NewShellLevel[] = [];
  const take = vi.fn(async (_action: Action) => null);
  const ask = (overrides.ask ??
    vi.fn(async (_action: Action) => ({ response: null, error: null }))) as ShellContextValue["ask"];
  const value: ShellContextValue = {
    session: quietSession(ask),
    snapshot: SNAPSHOT,
    error: null,
    destination: "home",
    chosenDestination: false,
    popover: null,
    unplayable: new Set<string>(),
    pending: new Set<string>(),
    markUnplayable: vi.fn(),
    choose: vi.fn(),
    push: vi.fn((level: NewShellLevel) => {
      pushed.push(level);
      return `level-${pushed.length}`;
    }),
    remove: vi.fn(),
    levelExists: vi.fn(() => true),
    pop: vi.fn(),
    back: vi.fn(),
    ask,
    take,
    hint: vi.fn(),
    home: new HomeStore(ask),
    setIntentHandler: vi.fn(),
    setBaseIntentHandler: vi.fn(() => () => {}),
    ...overrides,
  };

  return { value, pushed, take, ask };
}

function withShell(value: ShellContextValue, children: ReactNode) {
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

describe("MarqueeTitleScreen", () => {
  it("renders each episode's Video.description and switches seasons cleanly", () => {
    const { value } = harness();
    render(withShell(value, <MarqueeTitleScreen title={SERIES} />));

    expect(screen.getByTestId("season-1")).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByText("Mark is promoted to lead the macrodata refinement department."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("season-2"));

    expect(screen.getByTestId("season-2")).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByText("Mark, Helly, Irving, and Dylan search for answers."),
    ).toBeInTheDocument();
  });

  it("opens Continue watching season, focuses anchored episode, and offers Resume + Choose stream", () => {
    const { value, pushed, take } = harness({
      snapshot: { ...SNAPSHOT, continueWatching: [continueEntry()] },
    });
    render(withShell(value, <MarqueeTitleScreen title={SERIES} />));

    expect(screen.getByTestId("season-2")).toHaveAttribute("aria-pressed", "true");
    expect(document.activeElement).toBe(screen.getByTestId("episode-tt11280740:2:3"));

    fireEvent.click(screen.getByTestId("title-main"));
    expect(take).toHaveBeenCalledWith({
      type: "resume",
      video: { type: "series", id: "tt11280740:2:3" },
    });

    fireEvent.click(screen.getByTestId("title-choose-stream"));
    expect(pushed).toHaveLength(1);
    expect(pushed[0]?.name).toBe("Streams");
  });

  it("sends play_up_next on Play and falls back to Streams picker when Host returns no_up_next_stream", async () => {
    const ask = vi.fn(async (action: Action): Promise<ActionOutcome> =>
      action.type === "play_up_next"
        ? { response: null, error: { kind: "no_up_next_stream", detail: "nothing playable" } }
        : { response: null, error: null },
    );
    const { value, pushed } = harness({
      ask,
      snapshot: {
        ...SNAPSHOT,
        continueWatching: [continueEntry({ position: null, duration: null, upNext: true })],
      },
    });
    render(withShell(value, <MarqueeTitleScreen title={SERIES} />));

    fireEvent.click(screen.getByTestId("title-main"));

    await waitFor(() => expect(pushed).toHaveLength(1));
    expect(ask).toHaveBeenCalledWith({
      type: "play_up_next",
      title: { type: "series", id: SERIES.id },
    });
    expect(pushed[0]?.name).toBe("Streams");
  });

  it("opens Streams picker directly when upNextPlayback is picker", () => {
    const { value, pushed, take } = harness({
      snapshot: {
        ...SNAPSHOT,
        preferences: { ...SNAPSHOT.preferences, upNextPlayback: "picker" },
        continueWatching: [continueEntry({ position: null, duration: null, upNext: true })],
      },
    });
    render(withShell(value, <MarqueeTitleScreen title={SERIES} />));

    fireEvent.click(screen.getByTestId("title-main"));
    expect(take).not.toHaveBeenCalled();
    expect(pushed).toHaveLength(1);
    expect(pushed[0]?.name).toBe("Streams");
  });

  it("offers Choose stream for movies (both unstarted and resuming) and pushes Streams", () => {
    const { value: unstartedValue, pushed: unstartedPushed } = harness();
    const { unmount } = render(withShell(unstartedValue, <MarqueeTitleScreen title={FILM} />));

    expect(screen.queryByTestId("title-main")).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId("title-choose-stream"));
    fireEvent.click(screen.getByTestId("title-choose-stream"));
    expect(unstartedPushed).toHaveLength(1);
    expect(unstartedPushed[0]?.name).toBe("Streams");
    unmount();

    const { value: resumeValue, pushed: resumePushed, take } = harness({
      snapshot: {
        ...SNAPSHOT,
        continueWatching: [
          continueEntry({
            video: { id: "tmdb:693134", name: null, season: null, episode: null, thumbnail: null, airDate: null },
            title: { addon: "cinemeta", id: FILM.id, type: "movie", name: FILM.name, poster: null },
          }),
        ],
      },
    });
    render(withShell(resumeValue, <MarqueeTitleScreen title={FILM} />));

    fireEvent.click(screen.getByTestId("title-main"));
    expect(take).toHaveBeenCalledWith({
      type: "resume",
      video: { type: "movie", id: "tmdb:693134" },
    });

    fireEvent.click(screen.getByTestId("title-choose-stream"));
    expect(resumePushed).toHaveLength(1);
    expect(resumePushed[0]?.name).toBe("Streams");
  });

  it("locks the main button while its Action is pending and focuses Back for empty series", () => {
    const resumeAction: Action = {
      type: "resume",
      video: { type: "series", id: "tt11280740:2:3" },
    };
    const { value, take } = harness({
      snapshot: { ...SNAPSHOT, continueWatching: [continueEntry()] },
      pending: new Set([actionKey(resumeAction)]),
    });
    const { unmount } = render(withShell(value, <MarqueeTitleScreen title={SERIES} />));

    const main = screen.getByTestId("title-main");
    expect(main).toBeDisabled();
    expect(main).toHaveAttribute("aria-busy", "true");
    fireEvent.click(main);
    expect(take).not.toHaveBeenCalled();
    unmount();

    const { value: emptyValue } = harness();
    render(withShell(emptyValue, <MarqueeTitleScreen title={{ ...SERIES, videos: [] }} />));
    expect(screen.getByTestId("title-no-videos")).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Back" }));
  });

  it("pushes the Streams level for the episode that was pressed, announced or not", () => {
    const announced: Title = {
      ...SERIES,
      videos: SERIES.videos.map((video) => ({ ...video, airDate: "2999-01-02" })),
    };
    const { value, pushed } = harness();
    render(withShell(value, <MarqueeTitleScreen title={announced} />));

    // An air date in the future marks the episode and takes nothing away (#269).
    fireEvent.click(screen.getByTestId("episode-tt11280740:1:1"));

    expect(pushed).toHaveLength(1);
    expect(pushed[0]?.name).toBe("Streams");
  });

  it("keeps a series with no entry at its first season, with no Resume or Play", () => {
    const { value } = harness();
    render(withShell(value, <MarqueeTitleScreen title={SERIES} />));

    expect(screen.queryByTestId("title-main")).not.toBeInTheDocument();
    expect(screen.getByTestId("season-1")).toHaveAttribute("aria-pressed", "true");
    expect(document.activeElement).toBe(screen.getByTestId("title-choose-stream"));
  });

  it("opens the Streams on the first pointer press of an episode in view (#245)", () => {
    const { value, pushed } = harness();
    render(withShell(value, <MarqueeTitleScreen title={SERIES} />));
    const box = (left: number, top: number, right: number, bottom: number) =>
      ({
        x: left,
        y: top,
        left,
        top,
        right,
        bottom,
        width: right - left,
        height: bottom - top,
        toJSON: () => ({}),
      }) as DOMRect;
    // A scrolling row that holds the card by a hair under a whole pixel, as a
    // browser's snapped client box does.
    const list = screen.getByTestId("title-episodes");
    list.style.overflowX = "auto";
    list.getBoundingClientRect = () => box(64, 700, 1856, 1000);
    Object.defineProperty(list, "clientWidth", { configurable: true, value: 1791 });
    Object.defineProperty(list, "clientHeight", { configurable: true, value: 300 });
    const episode = screen.getByTestId("episode-tt11280740:1:1");
    episode.getBoundingClientRect = () => box(1448, 700, 1855.5, 930);
    const page = document.documentElement;
    Object.defineProperty(page, "clientWidth", { configurable: true, value: 1920 });
    Object.defineProperty(page, "clientHeight", { configurable: true, value: 1080 });
    const stop = installPointerPress(page, {
      focusAndReveal: (control) =>
        focusAndReveal(control, { mode: "nearest", force: true }),
    });

    try {
      fireEvent.pointerDown(episode);
      fireEvent.click(episode);

      expect(pushed, "the first press is the one that was aimed at").toHaveLength(1);
      expect(pushed[0]?.name).toBe("Streams");
    } finally {
      stop();
      Object.defineProperty(page, "clientWidth", { configurable: true, value: 0 });
      Object.defineProperty(page, "clientHeight", { configurable: true, value: 0 });
    }
  });

  it("pushes Loading level via useMarqueeTitleOpener and replaces it once Title arrives", async () => {
    let resolveTake!: (value: null) => void;
    const gate = new Promise<null>((resolve) => {
      resolveTake = resolve;
    });
    const take = vi.fn(() => gate);
    const { value, pushed } = harness({ take });

    function OpenerHarness() {
      const { openTitle } = useMarqueeTitleOpener();
      return (
        <button
          type="button"
          onClick={() =>
            void openTitle("cinemeta", {
              id: SERIES.id,
              type: "series",
              name: "Severance",
              poster: null,
              background: null,
            })
          }
        >
          Open
        </button>
      );
    }

    render(withShell(value, <OpenerHarness />));
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(pushed).toHaveLength(1);
    expect(pushed[0]?.name).toBe("Title");

    await act(async () => {
      resolveTake(null);
      await gate;
    });
  });
});
