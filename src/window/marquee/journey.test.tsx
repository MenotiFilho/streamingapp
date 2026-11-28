import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";

import { SNAPSHOT_EVENT } from "../../core/wire";
import type {
  Action,
  AddonManifest,
  MetaPreview,
  PlaybackSnapshot,
  Snapshot,
  Stream,
  Title,
} from "../../core/wire";
import { TauriLink, type Transport } from "../tauriLink";
import { MarqueeEntry } from "./MarqueeEntry";

/**
 * The gate's one journey (`docs/agents/testing.md`): Home → Title → Streams →
 * play → OSD → Stop → Title, with every Action at the boundary and focus
 * restored where it was left.
 *
 * The DOM is the harness: a card is found and pressed, and the assertions are
 * the Actions the fake Host was sent, the Level on the stack, and the control
 * that holds focus (ADR-0032).
 */

let previousSkipAnimations: boolean | undefined;
beforeAll(() => {
  previousSkipAnimations = MotionGlobalConfig.skipAnimations;
  MotionGlobalConfig.skipAnimations = true;
});
afterAll(() => {
  MotionGlobalConfig.skipAnimations = previousSkipAnimations;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const CINEMETA: AddonManifest = {
  id: "cinemeta",
  name: "Cinemeta",
  version: "3.0.14",
  resources: [
    { name: "catalog", types: ["series"], idPrefixes: ["tt"] },
    { name: "meta", types: ["series"], idPrefixes: ["tt"] },
  ],
  types: ["series"],
  catalogs: [
    {
      type: "series",
      id: "top",
      name: "Popular",
      extra: [
        { name: "skip", isRequired: false, options: [], optionsLimit: 0 },
        { name: "search", isRequired: false, options: [], optionsLimit: 0 },
      ],
    },
  ],
  idPrefixes: ["tt"],
  behaviorHints: { configurable: false, configurationRequired: false },
  enabled: true,
};

const TORRENTIO: AddonManifest = {
  ...CINEMETA,
  id: "torrentio",
  name: "Torrentio",
  resources: [{ name: "stream", types: ["series"], idPrefixes: ["tt"] }],
  catalogs: [],
};

const IDLE: PlaybackSnapshot = {
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
};

const SNAPSHOT: Snapshot = {
  revision: 1,
  playback: IDLE,
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
  addons: [CINEMETA, TORRENTIO],
  featuredCatalog: { addon: "cinemeta", catalog: { type: "series", id: "top" } },
  protection: { backend: "file", tmdbHeld: false, stremioHeld: false },
  continueWatching: [],
  watchProgress: [],
  devices: [],
  pairingCode: "----",
  address: null,
};

const PREVIEW: MetaPreview = {
  id: "tt0903747",
  type: "series",
  name: "Breaking Bad",
  poster: "https://images.test/bb-poster.jpg",
  posterShape: "poster",
  background: "https://images.test/bb-backdrop.jpg",
  releaseInfo: "2008",
  imdbRating: "9.5",
  genres: ["Crime"],
  description: "A chemistry teacher turns to crime.",
};

const SERIES: Title = {
  addon: "cinemeta",
  id: "tt0903747",
  key: { kind: "addon", addon: "cinemeta", id: "tt0903747" },
  type: "series",
  name: "Breaking Bad",
  poster: PREVIEW.poster,
  background: PREVIEW.background ?? null,
  logo: null,
  description: PREVIEW.description,
  releaseInfo: "2008",
  runtime: "49 min",
  imdbRating: "9.5",
  genres: ["Crime"],
  videos: [
    {
      id: "tt0903747:1:1",
      name: "Pilot",
      season: 1,
      episode: 1,
      thumbnail: null,
      airDate: null,
    },
  ],
};

const STREAM: Stream = {
  name: "Torrentio\n4k HDR",
  description: "Breaking Bad S01E01 2160p BluRay",
  playback: { kind: "direct", url: "https://stream.example.org/bb-s1e1.mkv" },
  warnings: [],
  filename: "Breaking.Bad.S01E01.2160p.mkv",
  bingeGroup: null,
};

const PLAYING: PlaybackSnapshot = {
  ...IDLE,
  state: "playing",
  nowPlaying: {
    video: { type: "series", id: "tt0903747:1:1" },
    addon: "torrentio",
    name: STREAM.name,
    description: STREAM.description,
    filename: STREAM.filename,
    bingeGroup: null,
  },
  episode: { season: 1, episode: 1 },
  position: 60,
  duration: 2940,
  volume: 60,
  muted: false,
  speed: 1,
  subtitleDelay: 0,
};

function answerFor(action: Action): unknown {
  switch (action.type) {
    case "browse_catalog":
      return {
        catalogs: [
          {
            addon: "cinemeta",
            type: "series",
            id: "top",
            name: "Popular",
            sent: 1,
            metas: [PREVIEW],
            failure: null,
          },
        ],
      };
    case "search_catalogs":
      return {
        catalogs: [
          {
            addon: "cinemeta",
            type: "series",
            id: "top",
            name: "Popular",
            sent: 1,
            metas: [PREVIEW],
            failure: null,
          },
        ],
      };
    case "discover":
      return {
        discover: [
          {
            type: action.kind,
            sent: 1,
            metas: [{ ...PREVIEW, id: "tmdb:1396", type: action.kind }],
            failure: null,
          },
        ],
      };
    case "library":
      return {
        library: {
          entries: [
            {
              id: "tt0903747",
              name: "Breaking Bad",
              type: "series",
              poster: PREVIEW.poster,
              posterShape: "poster",
              mtime: 1,
              videoId: null,
              position: null,
              duration: null,
              continueWatching: false,
            },
          ],
          failure: null,
        },
      };
    case "open_title":
    case "open_discovered_title":
      return { title: SERIES };
    case "find_streams":
      return { streams: [{ addon: "torrentio", streams: [STREAM], failure: null }] };
    default:
      return null;
  }
}

function fakeHost(initial: Snapshot = SNAPSHOT) {
  const invocations: Array<{ command: string; args?: Record<string, unknown> }> = [];
  const listeners = new Map<string, (event: { payload: Snapshot }) => void>();
  let current = initial;

  const transport: Transport = {
    invoke: async <T,>(command: string, args?: Record<string, unknown>): Promise<T> => {
      invocations.push({ command, args });
      if (command === "snapshot") {
        return current as T;
      }
      const action = (args?.envelope as { action: Action }).action;
      return { snapshots: [], answer: answerFor(action) } as T;
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
    actions(): Action[] {
      return invocations
        .filter(({ command }) => command === "dispatch")
        .map(({ args }) => (args?.envelope as { action: Action }).action);
    },
    async publish(next: Snapshot) {
      current = next;
      await act(async () => {
        listeners.get(SNAPSHOT_EVENT)?.({ payload: next });
        await Promise.resolve();
      });
    },
  };
}

/** A D-pad's OK on a control: it holds focus, and it is activated. */
function activate(control: HTMLElement): void {
  act(() => control.focus());
  fireEvent.click(control);
}

const back = () => fireEvent.keyDown(document, { key: "Escape" });

describe("the Marquee journey", () => {
  test("Home → Title → Streams → play → OSD → Stop → Title, with focus restored", async () => {
    const host = fakeHost();
    render(<MarqueeEntry client={host.client} />);

    const card = await screen.findByTestId("card-cinemeta-tt0903747");
    activate(card);

    const episode = await screen.findByTestId("episode-tt0903747:1:1");
    expect(host.actions()).toContainEqual({
      type: "open_title",
      addon: "cinemeta",
      title: { type: "series", id: "tt0903747" },
    });
    activate(episode);

    const candidate = within(await screen.findByTestId("candidate-torrentio-0")).getByRole(
      "button",
    );
    expect(host.actions()).toContainEqual({
      type: "find_streams",
      video: { type: "series", id: "tt0903747:1:1" },
    });
    activate(candidate);
    await waitFor(() =>
      expect(host.actions()).toContainEqual(
        expect.objectContaining({
          type: "play_stream",
          video: { type: "series", id: "tt0903747:1:1" },
          addon: "torrentio",
          stream: STREAM,
        }),
      ),
    );

    await host.publish({ ...SNAPSHOT, revision: 2, playback: PLAYING });
    await screen.findByTestId("shell-player");
    expect(screen.getByTestId("shell-osd")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Pause" })).toHaveFocus(),
    );

    // Stop is the OSD's own way out.
    activate(screen.getByRole("button", { name: "Close" }));
    await waitFor(() =>
      expect(host.actions()).toContainEqual({ type: "stop_playback" }),
    );
    await host.publish({ ...SNAPSHOT, revision: 3 });
    await waitFor(() =>
      expect(screen.queryByTestId("shell-player")).not.toBeInTheDocument(),
    );

    // The list the Stream was chosen from is still there (#27), on its row.
    await waitFor(() => expect(candidate).toHaveFocus());

    back();
    await waitFor(() => expect(screen.queryByTestId("streams")).not.toBeInTheDocument());
    expect(screen.getByTestId("title-tt0903747")).toBeInTheDocument();
    await waitFor(() =>
      expect(episode, "the episode the Streams were opened from").toHaveFocus(),
    );

    back();
    await waitFor(() =>
      expect(screen.queryByTestId("title-tt0903747")).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(card, "the card the Title was opened from").toHaveFocus());
  });

  test("the rail routes every destination, stays live beside a Settings part, and Back returns Home", async () => {
    const host = fakeHost();
    render(<MarqueeEntry client={host.client} />);
    await screen.findByTestId("home-screen");
    const rail = screen.getByRole("navigation", { name: "Destinations" });
    const choose = (name: string) => {
      const item = within(rail).getByRole("button", { name });
      activate(item);
      return item;
    };

    for (const [name, screenId] of [
      ["Discover", "discover-screen"],
      ["Search", "search-screen"],
      ["Library", "screen-library"],
      ["Addons", "addons-screen"],
      ["Settings", "settings-categories"],
    ] as const) {
      const item = choose(name);
      expect(await screen.findByTestId(screenId)).toBeInTheDocument();
      await waitFor(() => expect(item).toHaveFocus());
    }

    const part = screen.getByRole("button", { name: /Subtitle appearance/ });
    activate(part);
    expect(
      await screen.findByTestId("settings-sublevel-subtitle-appearance"),
    ).toBeInTheDocument();
    expect(rail.closest("[inert]")).toBeNull();

    choose("Addons");
    expect(await screen.findByTestId("addons-screen")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.queryByTestId("settings-sublevel-subtitle-appearance"),
      ).not.toBeInTheDocument(),
    );

    back();
    expect(await screen.findByTestId("home-screen")).toBeInTheDocument();
    await waitFor(() =>
      expect(within(rail).getByRole("button", { name: "Home" })).toHaveFocus(),
    );
  });

  test("a Stream that failed to open is said beside Home, with no player", async () => {
    const host = fakeHost();
    render(<MarqueeEntry client={host.client} />);
    await screen.findByTestId("home-screen");

    await host.publish({
      ...SNAPSHOT,
      revision: 2,
      playback: { ...IDLE, failure: "The Stream could not be opened." },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The Stream could not be opened. Pick another Stream from the list.",
    );
    expect(screen.queryByTestId("shell-player")).not.toBeInTheDocument();
    expect(screen.getByTestId("home-screen")).toBeInTheDocument();
  });

  test.each([
    {
      destination: "Discover",
      card: "discover-card-tmdb:1396",
      protection: { backend: "file", tmdbHeld: true, stremioHeld: false },
      opens: { type: "open_discovered_title", key: expect.anything(), kind: "movie" },
    },
    {
      destination: "Search",
      card: "search-card-cinemeta-tt0903747",
      protection: SNAPSHOT.protection,
      opens: {
        type: "open_title",
        addon: "cinemeta",
        title: { type: "series", id: "tt0903747" },
      },
    },
    {
      destination: "Library",
      card: "library-card-tt0903747",
      protection: { backend: "file", tmdbHeld: false, stremioHeld: true },
      opens: {
        type: "open_title",
        addon: "cinemeta",
        title: { type: "series", id: "tt0903747" },
      },
    },
  ] as const)(
    "a card on $destination opens the same Title, and Back returns to the card",
    async ({ destination, card, protection, opens }) => {
      const host = fakeHost({ ...SNAPSHOT, protection });
      render(<MarqueeEntry client={host.client} />);

      fireEvent.click(await screen.findByRole("button", { name: destination }));
      if (destination === "Search") {
        fireEvent.change(await screen.findByLabelText("Search for a Title"), {
          target: { value: "breaking" },
        });
        fireEvent.submit(screen.getByRole("search", { name: "Search" }));
      }
      const pressed = await screen.findByTestId(card);
      activate(pressed);

      expect(await screen.findByTestId("title-tt0903747")).toBeInTheDocument();
      expect(host.actions()).toContainEqual(opens);
      activate(screen.getByTestId("episode-tt0903747:1:1"));
      await screen.findByTestId("candidate-torrentio-0");
      expect(host.actions()).toContainEqual({
        type: "find_streams",
        video: { type: "series", id: "tt0903747:1:1" },
      });

      back();
      await waitFor(() => expect(screen.queryByTestId("streams")).not.toBeInTheDocument());
      back();
      await waitFor(() =>
        expect(screen.queryByTestId("title-tt0903747")).not.toBeInTheDocument(),
      );
      await waitFor(() => expect(pressed).toHaveFocus());
    },
  );
});
