import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { HomeStore } from "../../core/homeStore";
import type { Intent } from "../../core/input";
import { Session } from "../../core/session";
import type { Action, MetaPreview, Snapshot } from "../../core/wire";
import { ShellContext, type ActionOutcome, type NewShellLevel, type ShellContextValue } from "../context";
import { PreviewDataProvider } from "../repertory/context";
import { MarqueeDiscover } from "./MarqueeDiscover";
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

const BASE_SNAPSHOT: Snapshot = {
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
  addons: [],
  featuredCatalog: null,
  protection: { backend: "file", tmdbHeld: true, stremioHeld: false },
  continueWatching: [],
  watchProgress: [],
  devices: [],
  pairingCode: "----",
  address: null,
};

function meta(id: string, name: string, type = "movie"): MetaPreview {
  return {
    id,
    type,
    name,
    poster: `https://images.test/${id}.jpg`,
    posterShape: "poster",
    background: null,
    releaseInfo: "2025",
    imdbRating: "8.1",
    genres: ["Drama"],
    description: `${name} synopsis.`,
  };
}

function discoverOutcome(kind: string, metas: MetaPreview[]): ActionOutcome {
  return {
    response: {
      snapshots: [],
      answer: { discover: [{ type: kind, sent: metas.length, metas, failure: null }] },
    },
    error: null,
  };
}

function renderDiscover({
  snapshot = BASE_SNAPSHOT,
  ask,
  preview = false,
  node = <MarqueeDiscover />,
}: {
  snapshot?: Snapshot | null;
  ask?: (action: Action) => Promise<ActionOutcome>;
  preview?: boolean;
  node?: React.ReactNode;
} = {}) {
  const pushed: NewShellLevel[] = [];
  const choose = vi.fn();
  const take = vi.fn(async (_action: Action) => null);
  const askMock = vi.fn(
    ask ??
      (async (action: Action) => {
        if (action.type === "discover") {
          if (action.page > 1) {
            return discoverOutcome(action.kind, []);
          }
          return discoverOutcome(action.kind, [
            meta(
              action.kind === "series" ? "tmdb:1396" : "tmdb:603",
              action.kind === "series" ? "Breaking Bad" : "The Matrix",
              action.kind,
            ),
          ]);
        }
        if (action.type === "browse_catalog") {
          return {
            response: {
              snapshots: [],
              answer: {
                catalogs: [
                  {
                    addon: "cinemeta",
                    type: action.catalog.type,
                    id: action.catalog.id,
                    name: "Popular",
                    sent: 1,
                    metas: [meta("tt0133093", "The Matrix", action.catalog.type)],
                    failure: null,
                  },
                ],
              },
            },
            error: null,
          } satisfies ActionOutcome;
        }
        return { response: null, error: null } satisfies ActionOutcome;
      }),
  );

  let registeredIntent: ((intent: Intent) => boolean) | null = null;
  const session = new Session({
    state: () => ({ kind: "ready", device: null }),
    onState: () => () => undefined,
    onSnapshot: () => () => undefined,
    onRevision: () => () => undefined,
    snapshot: async () => snapshot ?? BASE_SNAPSHOT,
    dispatch: async () => ({ snapshots: [], answer: null }),
    close: () => undefined,
  });
  // Route Session stores through askMock so FeedStore records calls on askMock.
  const wrappedSession = Object.assign(Object.create(Object.getPrototypeOf(session)), session, {
    feeds: new (session.feeds.constructor as new (ask: typeof askMock) => typeof session.feeds)(
      askMock,
    ),
  }) as Session;

  const value: ShellContextValue = {
    session: wrappedSession,
    snapshot,
    error: null,
    destination: "discover",
    chosenDestination: true,
    popover: null,
    unplayable: new Set(),
    pending: new Set(),
    markUnplayable: vi.fn(),
    choose,
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
    setBaseIntentHandler: vi.fn((handler) => {
      registeredIntent = handler as typeof registeredIntent;
      return () => {
        if (registeredIntent === handler) {
          registeredIntent = null;
        }
      };
    }),
  };

  render(
    <PreviewDataProvider value={preview}>
      <ShellContext.Provider value={value}>{node}</ShellContext.Provider>
    </PreviewDataProvider>,
  );

  return {
    askMock,
    choose,
    pushed,
    take,
    sendIntent: (intent: Intent) => (registeredIntent ? registeredIntent(intent) : false),
    actions: () => askMock.mock.calls.map(([action]) => action),
  };
}

describe("Marquee Discover boundary contracts", () => {
  it("mounts via MarqueeDestinationScreen and asks single-kind Movies with Sort on load", async () => {
    const { actions, take } = renderDiscover({
      node: <MarqueeDestinationScreen destination="discover" />,
    });

    const card = await screen.findByTestId("discover-card-tmdb:603");
    expect(card).toBeInTheDocument();
    expect(actions()[0]).toEqual({
      type: "discover",
      kind: "movie",
      page: 1,
      sort: "popularity.desc",
    });

    fireEvent.click(card);
    await waitFor(() =>
      expect(take).toHaveBeenCalledWith({
        type: "open_discovered_title",
        key: { kind: "tmdb", id: 603 },
        kind: "movie",
      }),
    );
  });

  it("switches Type, Genre, and Sort dropdowns and passes updated filters to discover", async () => {
    const { actions } = renderDiscover();
    await screen.findByTestId("discover-card-tmdb:603");

    // Pick Genre -> Science Fiction (878)
    fireEvent.click(screen.getByRole("button", { name: "Genre: All genres" }));
    fireEvent.click(screen.getByRole("option", { name: "Science Fiction" }));
    await waitFor(() =>
      expect(actions()).toContainEqual({
        type: "discover",
        kind: "movie",
        page: 1,
        genre: 878,
        sort: "popularity.desc",
      }),
    );

    // Pick Sort -> Highest rated (vote_average.desc)
    fireEvent.click(screen.getByRole("button", { name: "Sort: Most popular" }));
    fireEvent.click(screen.getByRole("option", { name: "Highest rated" }));
    await waitFor(() =>
      expect(actions()).toContainEqual({
        type: "discover",
        kind: "movie",
        page: 1,
        genre: 878,
        sort: "vote_average.desc",
      }),
    );

    // Switch Type -> Series: Science Fiction is movie-only so Genre resets to All genres;
    // Sort stays Highest rated (vote_average.desc).
    fireEvent.click(screen.getByRole("button", { name: "Type: Movies" }));
    fireEvent.click(screen.getByRole("option", { name: "Series" }));
    expect(await screen.findByTestId("discover-card-tmdb:1396")).toBeInTheDocument();
    expect(actions()).toContainEqual({
      type: "discover",
      kind: "series",
      page: 1,
      sort: "vote_average.desc",
    });
    expect(screen.getByRole("button", { name: "Genre: All genres" })).toBeInTheDocument();
  });

  it("closes an open dropdown menu on Escape and returns focus to its pill", async () => {
    const { sendIntent } = renderDiscover();
    await screen.findByTestId("discover-card-tmdb:603");

    const genreTrigger = screen.getByRole("button", { name: "Genre: All genres" });
    fireEvent.click(genreTrigger);
    expect(screen.getByRole("listbox", { name: "Genre" })).toBeInTheDocument();
    expect(screen.getByTestId("discover-menu-dim")).toBeInTheDocument();

    // Horizontal intent is trapped while the menu is open; Down moves inside options.
    expect(sendIntent("right")).toBe(true);
    expect(sendIntent("down")).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole("option", { name: "Action" }));

    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });

    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
    expect(document.activeElement).toBe(genreTrigger);
  });

  it("shows the no-TMDB-key state and opens Settings without asking Discover", () => {
    const { actions, choose } = renderDiscover({
      snapshot: {
        ...BASE_SNAPSHOT,
        protection: { ...BASE_SNAPSHOT.protection, tmdbHeld: false },
      },
    });

    expect(screen.getByTestId("discover-no-key")).toBeInTheDocument();
    expect(screen.getByText("Discover needs a TMDB key")).toBeInTheDocument();
    expect(actions()).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Open Settings" }));
    expect(choose).toHaveBeenCalledWith("settings");
  });

  it("renders inline failure with Try again and retries the failed page", async () => {
    let calls = 0;
    const { actions } = renderDiscover({
      ask: async (action) => {
        calls += 1;
        if (calls === 1) {
          return {
            response: null,
            error: { kind: "tmdb", detail: "status 503" },
          };
        }
        if (action.type === "discover" && action.page > 1) {
          return discoverOutcome(action.kind, []);
        }
        return discoverOutcome(action.type === "discover" ? action.kind : "movie", [
          meta("tmdb:603", "The Matrix"),
        ]);
      },
    });

    const failure = await screen.findByTestId("discover-failure");
    expect(failure).toHaveTextContent("status 503");

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("discover-card-tmdb:603")).toBeInTheDocument();
    expect(actions().filter((action) => action.type === "discover" && action.page === 1)).toHaveLength(2);
  });
});
