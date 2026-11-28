import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { HomeStore } from "../../core/homeStore";
import { quietSession } from "../session.testing";
import { ShellContext, type ActionOutcome, type NewShellLevel, type ShellContextValue } from "../context";
import type { Action, AddonManifest, LibraryEntry, Snapshot } from "../../core/wire";
import { MarqueeLibrary } from "./MarqueeLibrary";
import { MarqueeDestinationScreen } from "./MarqueeScreens";

let previousSkipAnimations: boolean | undefined;

beforeAll(() => {
  previousSkipAnimations = MotionGlobalConfig.skipAnimations;
  MotionGlobalConfig.skipAnimations = true;
});

afterAll(() => {
  MotionGlobalConfig.skipAnimations = previousSkipAnimations ?? false;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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

function snapshotWith(stremioHeld: boolean, overrides: Partial<Snapshot> = {}): Snapshot {
  return {
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
    protection: { backend: "file", tmdbHeld: false, stremioHeld },
    continueWatching: [],
    watchProgress: [],
    devices: [],
    pairingCode: "----",
    address: null,
    ...overrides,
  };
}

function libraryEntry(overrides: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
    id: "tt0133093",
    name: "The Matrix",
    type: "movie",
    poster: "https://images.test/matrix.jpg",
    posterShape: "poster",
    mtime: 1_700_100_000_000,
    videoId: null,
    position: null,
    duration: null,
    continueWatching: false,
    ...overrides,
  };
}

function renderLibrary({
  snapshot = snapshotWith(true),
  ask,
  node = <MarqueeLibrary />,
}: {
  snapshot?: Snapshot | null;
  ask?: (action: Action) => Promise<ActionOutcome>;
  node?: React.ReactNode;
} = {}) {
  const pushed: NewShellLevel[] = [];
  const take = vi.fn(async (_action: Action) => null);
  const askMock = vi.fn(
    ask ??
      (async (_action: Action): Promise<ActionOutcome> => ({
        response: { snapshots: [], answer: { library: { entries: [], failure: null } } },
        error: null,
      })),
  );

  const value: ShellContextValue = {
    session: quietSession(),
    snapshot,
    error: null,
    destination: "library",
    chosenDestination: true,
    popover: null,
    unplayable: new Set(),
    pending: new Set(),
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
    ask: askMock,
    take,
    hint: vi.fn(),
    home: new HomeStore(askMock),
    setIntentHandler: vi.fn(),
    setBaseIntentHandler: vi.fn(() => () => {}),
  };

  render(<ShellContext.Provider value={value}>{node}</ShellContext.Provider>);

  return {
    askMock,
    take,
    actions: () => askMock.mock.calls.map(([action]) => action),
  };
}

describe("Marquee Library boundary contracts", () => {
  it("mounts via MarqueeDestinationScreen and sends sign_in_stremio when signed out", async () => {
    const { actions } = renderLibrary({
      snapshot: snapshotWith(false),
      ask: async () => ({ response: { snapshots: [], answer: null }, error: null }),
      node: <MarqueeDestinationScreen destination="library" />,
    });

    expect(screen.getByTestId("library-gate")).toHaveTextContent(
      "Your Library holds the Titles saved in your Stremio account",
    );

    fireEvent.change(screen.getByLabelText("Stremio email"), {
      target: { value: "  you@example.test  " },
    });
    fireEvent.change(screen.getByLabelText("Stremio password"), {
      target: { value: "secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() =>
      expect(actions()).toContainEqual({
        type: "sign_in_stremio",
        email: "you@example.test",
        password: "secret",
      }),
    );
  });

  it("filters All / Movies / Series, keeps unopenable entries disabled, and opens playable Titles", async () => {
    const entries = [
      libraryEntry({
        id: "tt0903747",
        name: "Breaking Bad",
        type: "series",
        position: 1200,
        duration: 2400,
        continueWatching: true,
      }),
      libraryEntry({
        id: "tt0133093",
        name: "The Matrix",
        type: "movie",
      }),
      libraryEntry({
        id: "kitsu:123",
        name: "Unopenable Anime",
        type: "series",
      }),
    ];

    const { actions, take } = renderLibrary({
      ask: async () => ({
        response: { snapshots: [], answer: { library: { entries, failure: null } } },
        error: null,
      }),
    });

    const grid = await screen.findByTestId("library-grid");
    expect(actions()).toContainEqual({ type: "library" });
    expect(within(grid).getAllByRole("button")).toHaveLength(3);

    // Filter -> Movies
    const moviesChip = screen.getByTestId("library-filter-movie");
    fireEvent.click(moviesChip);
    expect(moviesChip).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("library-card-tt0133093")).toBeInTheDocument();
    expect(screen.queryByTestId("library-card-tt0903747")).not.toBeInTheDocument();

    // Filter -> Series
    fireEvent.click(screen.getByTestId("library-filter-series"));
    expect(screen.getByTestId("library-card-tt0903747")).toBeInTheDocument();
    expect(screen.queryByTestId("library-card-tt0133093")).not.toBeInTheDocument();

    // Unopenable card is disabled and sends nothing.
    const unopenable = screen.getByTestId("library-card-kitsu:123");
    expect(unopenable).toBeDisabled();
    expect(unopenable).toHaveAccessibleName("Unopenable Anime, Unplayable");
    fireEvent.click(unopenable);
    expect(take).not.toHaveBeenCalled();

    // Playable card opens Title via the Addon answering its meta.
    fireEvent.click(screen.getByTestId("library-card-tt0903747"));
    await waitFor(() =>
      expect(take).toHaveBeenCalledWith({
        type: "open_title",
        addon: "cinemeta",
        title: { type: "series", id: "tt0903747" },
      }),
    );
  });

  it("shows empty state when the Library has zero entries, and sign-in form when session expired", async () => {
    renderLibrary({
      ask: async () => ({
        response: { snapshots: [], answer: { library: { entries: [], failure: null } } },
        error: null,
      }),
    });

    expect(await screen.findByTestId("library-empty")).toHaveTextContent(
      "Nothing in your Library yet",
    );

    cleanup();

    renderLibrary({
      ask: async () => ({
        response: {
          snapshots: [],
          answer: {
            library: {
              entries: [],
              failure: {
                kind: "library",
                detail: "Stremio refused the request: Session does not exist",
              },
            },
          },
        },
        error: null,
      }),
    });

    const failure = await screen.findByTestId("library-failure");
    expect(failure).toHaveTextContent("Session does not exist");
    expect(screen.getByLabelText("Stremio email")).toBeInTheDocument();
  });
});
