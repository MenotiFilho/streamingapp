import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useCallback, useState, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type {
  Action,
  AddonManifest,
  CatalogRow,
  Snapshot,
  Stream,
  Title,
} from "../../core/wire";
import { actionKey } from "../../core/actionKey";
import { TauriLink, type Transport } from "../tauriLink";
import { Shell } from "../Shell";
import { ShellContext, type ActionOutcome, type NewShellLevel, type ShellContextValue } from "../context";
import { HomeStore } from "../../core/homeStore";
import { PreviewDataProvider } from "./context";
import { RepertoryDiscoverScreen } from "./RepertoryDiscover";
import { RepertoryStreamsScreen } from "./RepertoryStreams";
import { RepertoryTitleScreen } from "./RepertoryTitle";
import { RepertorySearchScreen } from "./RepertorySearch";

const CINEMETA: AddonManifest = {
  id: "com.linvo.cinemeta",
  name: "Cinemeta",
  version: "3.0.14",
  resources: [{ name: "meta", types: ["movie", "series"], idPrefixes: ["tt"] }],
  types: ["movie", "series"],
  catalogs: [],
  idPrefixes: ["tt"],
  behaviorHints: { configurable: false, configurationRequired: false },
};

const TORRENTIO: AddonManifest = {
  id: "torrentio",
  name: "Torrentio",
  version: "0.0.14",
  resources: [{ name: "stream", types: ["movie", "series"], idPrefixes: ["tt"] }],
  types: ["movie", "series"],
  catalogs: [],
  idPrefixes: ["tt"],
  behaviorHints: { configurable: false, configurationRequired: false },
};

const AIOSTREAMS: AddonManifest = {
  ...TORRENTIO,
  id: "aiostreams",
  name: "AIOStreams",
};

const SNAPSHOT: Snapshot = {
  revision: 1,
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
  preferences: {
    subtitleLanguage: null,
    subtitleColor: "#FFFFFF",
    subtitleScale: 1,
    streamBuffer: { seconds: 300, megabytes: 512 },
  },
  addons: [CINEMETA, TORRENTIO, AIOSTREAMS],
  featuredCatalog: null,
  protection: { backend: "file", tmdbHeld: false, stremioHeld: false },
  watchProgress: [],
  devices: [],
  pairingCode: "----",
  address: null,
};

const SERIES: Title = {
  addon: "com.linvo.cinemeta",
  id: "tt0903747",
  key: { kind: "addon", addon: "com.linvo.cinemeta", id: "tt0903747" },
  type: "series",
  name: "Breaking Bad",
  poster: "https://images.test/bb-poster.jpg",
  background: "https://images.test/bb-backdrop.jpg",
  logo: "https://images.test/bb-logo.png",
  description: "A chemistry teacher turns to crime.",
  releaseInfo: "2008–2013",
  runtime: "49 min",
  imdbRating: "9.5",
  genres: ["Crime", "Drama"],
  videos: [
    {
      id: "tt0903747:1:1",
      name: "Pilot",
      season: 1,
      episode: 1,
      thumbnail: "https://images.test/bb-s1e1.jpg",
    },
    {
      id: "tt0903747:1:2",
      name: "Cat's in the Bag...",
      season: 1,
      episode: 2,
      thumbnail: null,
    },
  ],
};

const FILM: Title = {
  ...SERIES,
  id: "tt0133093",
  key: { kind: "tmdb", id: 603 },
  type: "movie",
  name: "The Matrix",
  logo: null,
  releaseInfo: "1999",
  runtime: "136 min",
  imdbRating: "8.7",
  genres: ["Action"],
  videos: [],
};

const UNPLAYABLE: Stream = {
  name: "Torrentio\n4k HDR",
  description: "Breaking Bad S01E01 2160p BluRay\n👤 106 💾 9.53 GB",
  playback: { kind: "info_hash", infoHash: "a584351126afcf50d32be068f3c9a62550d41ecc" },
  warnings: [],
  filename: "Breaking.Bad.S01E01.Pilot.2160p.mkv",
  bingeGroup: "torrentio|4k",
};

const PLAYABLE: Stream = {
  name: "AIOStreams\n1080p",
  description: "Breaking Bad S01E01 1080p WEB-DL",
  playback: { kind: "direct", url: "https://stream.example.org/bb-s1e1.mkv" },
  warnings: ["proxy_headers"],
  filename: "Breaking.Bad.S01E01.1080p.mkv",
  bingeGroup: null,
};

/** A second playable candidate, with its own Action key. */
const SECOND_PLAYABLE: Stream = {
  ...PLAYABLE,
  name: "AIOStreams\n4k HDR",
  playback: { kind: "direct", url: "https://stream.example.org/bb-s1e1-4k.mkv" },
  filename: "Breaking.Bad.S01E01.2160p.mkv",
};

function harness(overrides: Partial<ShellContextValue> = {}) {
  const pushed: NewShellLevel[] = [];
  const take = vi.fn(async (_action: Action) => null);
  const ask = vi.fn(async (_action: Action) => ({ response: null, error: null }));
  const value: ShellContextValue = {
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
    home: new HomeStore(ask),
    setIntentHandler: vi.fn(),
    setBaseIntentHandler: vi.fn(() => () => {}),
    ...overrides,
  };

  return { value, pushed, take, ask };
}

function withShell(value: ShellContextValue, children: ReactNode, preview = false) {
  return (
    <ShellContext.Provider value={value}>
      <PreviewDataProvider value={preview}>{children}</PreviewDataProvider>
    </ShellContext.Provider>
  );
}

/**
 * The Streams screen over a pending set the press itself fills, the way the
 * Session's pending keys do. The gate keeps the one Action in flight.
 */
function PendingStreams({ gate }: { gate: Promise<null> }) {
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set<string>());
  const take = useCallback(
    async (action: Action) => {
      setPending(new Set([actionKey(action)]));
      try {
        return await gate;
      } finally {
        setPending(new Set<string>());
      }
    },
    [gate],
  );
  const { value } = harness({ pending, take });

  return withShell(
    value,
    <RepertoryStreamsScreen
      title={SERIES}
      video={SERIES.videos[0]!}
      groups={[
        { addon: "aiostreams", streams: [PLAYABLE, SECOND_PLAYABLE], failure: null },
      ]}
    />,
  );
}

describe("the repertory Title page", () => {
  it("pushes the Streams level for the episode that was pressed", () => {
    const { value, pushed } = harness();
    render(withShell(value, <RepertoryTitleScreen title={SERIES} />));

    fireEvent.click(screen.getByTestId("episode-tt0903747:1:1"));

    expect(pushed).toHaveLength(1);
    expect(pushed[0]?.name).toBe("Streams");
  });

  it("gives a film one Find Streams control that pushes the Streams level", () => {
    const { value, pushed } = harness();
    render(withShell(value, <RepertoryTitleScreen title={FILM} />));

    fireEvent.click(screen.getByTestId("play-film"));

    expect(pushed).toHaveLength(1);
    expect(pushed[0]?.name).toBe("Streams");
  });
});

describe("the repertory Streams list", () => {
  it("groups by Addon and keeps badges, filename, warnings and the unplayable mark", () => {
    const { value } = harness();
    render(
      withShell(
        value,
        <RepertoryStreamsScreen
          title={SERIES}
          video={SERIES.videos[0]!}
          groups={[
            { addon: "torrentio", streams: [UNPLAYABLE], failure: null },
            { addon: "aiostreams", streams: [PLAYABLE], failure: null },
          ]}
        />,
      ),
    );

    const torrentio = screen.getByTestId("streams-torrentio");
    expect(within(torrentio).getByRole("heading", { name: "Torrentio" })).toBeInTheDocument();
    expect(within(torrentio).getByText("4k HDR")).toBeInTheDocument();
    expect(within(torrentio).getByTestId("stream-filename")).toHaveTextContent(
      "Breaking.Bad.S01E01.Pilot.2160p.mkv",
    );
    expect(within(torrentio).getByTestId("stream-unplayable")).toHaveTextContent(
      "Not playable yet",
    );

    const aiostreams = screen.getByTestId("streams-aiostreams");
    expect(
      within(aiostreams).getByText(/Wants request headers/),
    ).toBeInTheDocument();
  });

  it("marks an unplayable candidate without asking the Host to play it", () => {
    const { value, take } = harness();
    render(
      withShell(
        value,
        <RepertoryStreamsScreen
          title={SERIES}
          video={SERIES.videos[0]!}
          groups={[{ addon: "torrentio", streams: [UNPLAYABLE], failure: null }]}
        />,
      ),
    );

    fireEvent.click(screen.getByTestId("candidate-torrentio-0"));

    expect(screen.getByTestId("chosen-stream")).toHaveTextContent("Not playable yet");
    expect(take).not.toHaveBeenCalled();
  });

  it("takes a playable candidate back to the Host with its Addon and Title card", async () => {
    const { value, take } = harness();
    render(
      withShell(
        value,
        <RepertoryStreamsScreen
          title={SERIES}
          video={SERIES.videos[0]!}
          groups={[{ addon: "aiostreams", streams: [PLAYABLE], failure: null }]}
        />,
      ),
    );

    fireEvent.click(screen.getByTestId("candidate-aiostreams-0"));

    await waitFor(() => expect(take).toHaveBeenCalledTimes(1));
    expect(take.mock.calls[0]?.[0]).toMatchObject({
      type: "play_stream",
      addon: "aiostreams",
      stream: PLAYABLE,
      video: { type: "series", id: "tt0903747:1:1" },
    });
  });

  it("drops a second Stream pressed in the same tick, before the rows lock", async () => {
    let release!: () => void;
    const gate = new Promise<null>((resolve) => {
      release = () => resolve(null);
    });
    const take = vi.fn((_action: Action) => gate);
    const { value } = harness({ take });
    render(
      withShell(
        value,
        <RepertoryStreamsScreen
          title={SERIES}
          video={SERIES.videos[0]!}
          groups={[
            { addon: "aiostreams", streams: [PLAYABLE, SECOND_PLAYABLE], failure: null },
          ]}
        />,
      ),
    );

    // Both clicks in one act: the rows have not painted disabled yet, so the
    // control's own ref is what drops the second Stream.
    act(() => {
      fireEvent.click(screen.getByTestId("candidate-aiostreams-0"));
      fireEvent.click(screen.getByTestId("candidate-aiostreams-1"));
    });

    expect(take).toHaveBeenCalledTimes(1);
    expect(take.mock.calls[0]?.[0]).toMatchObject({
      type: "play_stream",
      stream: PLAYABLE,
    });
    // This harness holds no Session key, so the drawing does not claim rows are
    // locked: the pending key is what locks them.
    expect(screen.getByTestId("candidate-aiostreams-0")).toBeEnabled();
    expect(screen.getByTestId("candidate-aiostreams-1")).toBeEnabled();

    await act(async () => {
      release();
      await gate;
    });

    fireEvent.click(screen.getByTestId("candidate-aiostreams-1"));
    await waitFor(() => expect(take).toHaveBeenCalledTimes(2));
    expect(take.mock.calls[1]?.[0]).toMatchObject({
      type: "play_stream",
      stream: SECOND_PLAYABLE,
    });
  });

  it("locks every row while the candidate's opening key is pending", async () => {
    let release!: () => void;
    const gate = new Promise<null>((resolve) => {
      release = () => resolve(null);
    });
    render(<PendingStreams gate={gate} />);

    fireEvent.click(screen.getByTestId("candidate-aiostreams-0"));

    await waitFor(() =>
      expect(screen.getByTestId("candidate-aiostreams-0")).toBeDisabled(),
    );
    expect(screen.getByTestId("candidate-aiostreams-1")).toBeDisabled();
    expect(screen.getByTestId("candidate-aiostreams-0")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.getByTestId("candidate-aiostreams-1")).not.toHaveAttribute(
      "aria-busy",
    );

    await act(async () => {
      release();
      await gate;
    });
    await waitFor(() =>
      expect(screen.getByTestId("candidate-aiostreams-1")).toBeEnabled(),
    );
  });

  it("keeps a failed Addon and an empty one on their own groups without blanking the rest", () => {
    const { value } = harness();
    render(
      withShell(
        value,
        <RepertoryStreamsScreen
          title={SERIES}
          video={SERIES.videos[0]!}
          groups={[
            {
              addon: "torrentio",
              streams: [],
              failure: { kind: "fetch", detail: "the Addon answered with status 503" },
            },
            { addon: "aiostreams", streams: [], failure: null },
            { addon: "cinemeta", streams: [PLAYABLE], failure: null },
          ]}
        />,
      ),
    );

    expect(
      within(screen.getByTestId("streams-torrentio")).getByRole("alert"),
    ).toHaveTextContent("status 503");
    expect(screen.getByTestId("candidate-cinemeta-0")).toBeInTheDocument();
  });
});

const MATRIX_ROW: CatalogRow = {
  addon: "cinemeta",
  type: "movie",
  id: "top",
  name: "Popular",
  sent: 1,
  metas: [
    {
      id: "tt0133093",
      type: "movie",
      name: "The Matrix",
      poster: "https://images.test/matrix.jpg",
      posterShape: "poster",
      background: null,
      releaseInfo: "1999",
      imdbRating: "8.7",
      genres: ["Action"],
      description: "A hacker learns the truth.",
    },
  ],
  failure: null,
};

const BREAKING_BAD_ROW: CatalogRow = {
  ...MATRIX_ROW,
  type: "series",
  name: "Popular Series",
  metas: [
    {
      id: "tt0903747",
      type: "series",
      name: "Breaking Bad",
      poster: "https://images.test/bb.jpg",
      posterShape: "poster",
      background: null,
      releaseInfo: "2008",
      imdbRating: "9.5",
      genres: ["Crime"],
      description: "A chemistry teacher turns to crime.",
    },
  ],
};

function previewCatalogAnswer(action: Action) {
  if (action.type !== "browse_catalog") {
    return null;
  }
  return {
    snapshots: [],
    answer: {
      catalogs: [action.catalog.type === "series" ? BREAKING_BAD_ROW : MATRIX_ROW],
    },
  };
}

describe("the repertory Discover preview", () => {
  it("opens a catalogue's card through the preview Addon", async () => {
    const ask = vi.fn(async (action: Action): Promise<ActionOutcome> => ({
      response: previewCatalogAnswer(action),
      error: null,
    }));
    const { value, take } = harness({ ask });

    render(withShell(value, <RepertoryDiscoverScreen />, true));

    const card = await screen.findByTestId("discover-card-tt0133093");
    fireEvent.click(card);

    await waitFor(() =>
      expect(take).toHaveBeenCalledWith({
        type: "open_title",
        addon: "cinemeta",
        title: { type: "movie", id: "tt0133093" },
      }),
    );
  });

  it("defaults to Movie and switches to Series without keeping both selected", async () => {
    const ask = vi.fn(async (action: Action): Promise<ActionOutcome> => ({
      response: previewCatalogAnswer(action),
      error: null,
    }));
    const { value } = harness({ ask });

    render(withShell(value, <RepertoryDiscoverScreen />, true));

    expect(await screen.findByTestId("discover-kind-movie")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("discover-kind-series")).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    fireEvent.click(screen.getByTestId("discover-kind-series"));

    expect(await screen.findByTestId("discover-card-tt0903747")).toBeInTheDocument();
    expect(screen.queryByTestId("discover-card-tt0133093")).not.toBeInTheDocument();
    expect(screen.getByTestId("discover-kind-movie")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByTestId("discover-kind-series")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("narrows the feed with one genre chip at a time", async () => {
    const ask = vi.fn(async (action: Action): Promise<ActionOutcome> => ({
      response: previewCatalogAnswer(action),
      error: null,
    }));
    const { value } = harness({ ask });

    render(withShell(value, <RepertoryDiscoverScreen />, true));

    expect(await screen.findByRole("button", { name: "All genres" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Action" }));

    await waitFor(() => {
      const browse = ask.mock.calls
        .map(([action]) => action)
        .filter((action): action is Extract<Action, { type: "browse_catalog" }> =>
          action.type === "browse_catalog",
        )
        .at(-1);
      expect(browse?.extra).toContainEqual({ name: "genre", value: "Action" });
    });
    expect(screen.getByRole("button", { name: "All genres" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});

describe("the repertory Search feed", () => {
  it("defaults to Movie, switches to Series, and shows one kind's rows", async () => {
    const ask = vi.fn(async (action: Action): Promise<ActionOutcome> => ({
      response:
        action.type === "search_catalogs"
          ? { snapshots: [], answer: { catalogs: [MATRIX_ROW, BREAKING_BAD_ROW] } }
          : null,
      error: null,
    }));
    const { value } = harness({ ask });

    render(withShell(value, <RepertorySearchScreen />, true));

    expect(screen.getByTestId("search-kind-movie")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.change(screen.getByLabelText("Search for a Title"), {
      target: { value: "the" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(
      await screen.findByTestId("search-row-cinemeta/movie/top"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("search-row-cinemeta/series/top"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("search-kind-series"));

    expect(
      await screen.findByTestId("search-row-cinemeta/series/top"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("search-row-cinemeta/movie/top"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("search-kind-movie")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByTestId("search-kind-series")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

const KEYED: Snapshot = {
  ...SNAPSHOT,
  protection: { ...SNAPSHOT.protection, tmdbHeld: true },
};

const MATRIX_META = MATRIX_ROW.metas[0]!;
const BREAKING_BAD_META = BREAKING_BAD_ROW.metas[0]!;

type AskSpy = { mock: { calls: [Action][] } };

function actions(ask: AskSpy): Action[] {
  return ask.mock.calls.map(([action]) => action);
}

function discoverAnswer(kind: string, page: number) {
  return {
    snapshots: [],
    answer: {
      discover: [
        {
          type: kind,
          sent: 1,
          metas: [
            kind === "series"
              ? { ...BREAKING_BAD_META, id: `tmdb:1396` }
              : { ...MATRIX_META, id: `tmdb:${page === 1 ? 603 : 604}` },
          ],
          failure: null,
        },
      ],
    },
  };
}

describe("the repertory Discover feed against the Host", () => {
  it("asks the Host for Movie on landing, Series on its chip, and the genre by TMDB id", async () => {
    const ask = vi.fn(async (action: Action): Promise<ActionOutcome> => ({
      response:
        action.type === "discover"
          ? discoverAnswer(action.kind, action.page)
          : null,
      error: null,
    }));
    const { value } = harness({ ask, snapshot: KEYED });

    render(withShell(value, <RepertoryDiscoverScreen />));

    expect(await screen.findByTestId("discover-card-tmdb:603")).toBeInTheDocument();
    expect(actions(ask)).toContainEqual({ type: "discover", kind: "movie", page: 1 });

    fireEvent.click(screen.getByTestId("discover-kind-series"));
    expect(await screen.findByTestId("discover-card-tmdb:1396")).toBeInTheDocument();
    expect(actions(ask)).toContainEqual({ type: "discover", kind: "series", page: 1 });

    fireEvent.click(screen.getByTestId("discover-kind-movie"));
    fireEvent.click(await screen.findByRole("button", { name: "Action" }));

    await waitFor(() =>
      expect(actions(ask)).toContainEqual({
        type: "discover",
        kind: "movie",
        page: 1,
        genre: 28,
      }),
    );
  });

  it("asks the next page from the row's More, and keeps the cards already read", async () => {
    const ask = vi.fn(async (action: Action): Promise<ActionOutcome> => ({
      response:
        action.type === "discover"
          ? discoverAnswer(action.kind, action.page)
          : null,
      error: null,
    }));
    const { value } = harness({ ask, snapshot: KEYED });

    render(withShell(value, <RepertoryDiscoverScreen />));
    await screen.findByTestId("discover-card-tmdb:603");

    const section = screen.getByTestId("discover-section-movie");
    fireEvent.click(within(section).getByRole("button", { name: "Read on" }));

    expect(await screen.findByTestId("discover-card-tmdb:604")).toBeInTheDocument();
    expect(screen.getByTestId("discover-card-tmdb:603")).toBeInTheDocument();
    expect(actions(ask)).toContainEqual({ type: "discover", kind: "movie", page: 2 });
  });

  it("opens the loaded row as a grid from its More card, and Back returns", async () => {
    const ask = vi.fn(async (action: Action): Promise<ActionOutcome> => ({
      response:
        action.type === "discover"
          ? discoverAnswer(action.kind, action.page)
          : null,
      error: null,
    }));
    const { value, pushed } = harness({ ask, snapshot: KEYED });

    render(withShell(value, <RepertoryDiscoverScreen />));
    await screen.findByTestId("discover-card-tmdb:603");

    fireEvent.click(screen.getByTestId("more-discover:movie"));
    const grid = pushed.at(-1);
    expect(grid?.name).toBe("All of Films");

    const view = render(withShell(value, grid!.payload.render()));
    expect(
      within(view.container).getByTestId("discover-grid-card-tmdb:603"),
    ).toBeInTheDocument();

    fireEvent.click(within(view.container).getByRole("button", { name: "Back" }));
    expect(value.pop).toHaveBeenCalled();
  });

  it("keeps a failed page in its own row and offers that page again", async () => {
    let calls = 0;
    const ask = vi.fn(async (action: Action): Promise<ActionOutcome> => {
      if (action.type !== "discover") {
        return { response: null, error: null };
      }
      calls += 1;
      if (calls === 1) {
        return {
          response: {
            snapshots: [],
            answer: {
              discover: [
                {
                  type: "movie",
                  sent: 0,
                  metas: [],
                  failure: { kind: "fetch", detail: "TMDB answered with status 503" },
                },
              ],
            },
          },
          error: null,
        };
      }
      return { response: discoverAnswer("movie", action.page), error: null };
    });
    const { value } = harness({ ask, snapshot: KEYED });

    render(withShell(value, <RepertoryDiscoverScreen />));

    const section = screen.getByTestId("discover-section-movie");
    expect(await within(section).findByRole("alert")).toHaveTextContent("status 503");

    fireEvent.click(within(section).getByRole("button", { name: "Try again" }));

    expect(await screen.findByTestId("discover-card-tmdb:603")).toBeInTheDocument();
    expect(actions(ask)).toContainEqual({ type: "discover", kind: "movie", page: 1 });
  });

  it("with no TMDB key, says where the key goes and asks nothing", async () => {
    const { value, pushed, ask } = harness();

    render(withShell(value, <RepertoryDiscoverScreen />));

    expect(screen.getByTestId("discover-no-key")).toBeInTheDocument();
    expect(screen.getByTestId("discover-tmdb-notice")).toBeInTheDocument();
    expect(actions(ask)).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Open Settings → Credentials" }));
    expect(pushed[0]?.name).toBe("Settings — Credentials");
  });
});

describe("the repertory Search feed against the Host", () => {
  function keyedSearchAnswer(kind: string, overrides = {}) {
    return {
      snapshots: [],
      answer: {
        search: {
          type: kind,
          sent: 1,
          metas: [
            kind === "series"
              ? { ...BREAKING_BAD_META, id: "tmdb:1396" }
              : { ...MATRIX_META, id: "tmdb:603" },
          ],
          failure: null,
          ...overrides,
        },
      },
    };
  }

  it("asks both kinds on submit and switches between their rows", async () => {
    const ask = vi.fn(async (action: Action): Promise<ActionOutcome> => ({
      response:
        action.type === "search"
          ? keyedSearchAnswer(action.kind)
          : null,
      error: null,
    }));
    const { value } = harness({ ask, snapshot: KEYED });

    render(withShell(value, <RepertorySearchScreen />));
    fireEvent.change(screen.getByLabelText("Search for a Title"), {
      target: { value: "the" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByTestId("search-card-movie-tmdb:603")).toBeInTheDocument();
    expect(actions(ask)).toContainEqual({
      type: "search",
      query: "the",
      kind: "movie",
      page: 1,
    });
    expect(actions(ask)).toContainEqual({
      type: "search",
      query: "the",
      kind: "series",
      page: 1,
    });
    expect(screen.queryByTestId("search-card-series-tmdb:1396")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("search-kind-series"));

    expect(
      await screen.findByTestId("search-card-series-tmdb:1396"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("search-card-movie-tmdb:603")).not.toBeInTheDocument();
  });

  it("pages one row by its own More, asking that kind's next page", async () => {
    const ask = vi.fn(async (action: Action): Promise<ActionOutcome> => ({
      response:
        action.type === "search"
          ? keyedSearchAnswer(
              action.kind,
              action.page === 2
                ? {
                    metas: [
                      { ...MATRIX_META, id: `tmdb:${action.kind === "series" ? 1397 : 604}` },
                    ],
                  }
                : {},
            )
          : null,
      error: null,
    }));
    const { value } = harness({ ask, snapshot: KEYED });

    render(withShell(value, <RepertorySearchScreen />));
    fireEvent.change(screen.getByLabelText("Search for a Title"), {
      target: { value: "the" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await screen.findByTestId("search-card-movie-tmdb:603");

    fireEvent.click(screen.getByTestId("search-kind-series"));
    const row = await screen.findByTestId("search-row-series");
    fireEvent.click(within(row).getByRole("button", { name: "Read on" }));

    expect(await screen.findByTestId("search-card-series-tmdb:1397")).toBeInTheDocument();
    expect(actions(ask)).toContainEqual({
      type: "search",
      query: "the",
      kind: "series",
      page: 2,
    });
  });

  it("opens one kind's row as a grid from its More card", async () => {
    const ask = vi.fn(async (action: Action): Promise<ActionOutcome> => ({
      response:
        action.type === "search" ? keyedSearchAnswer(action.kind) : null,
      error: null,
    }));
    const { value, pushed } = harness({ ask, snapshot: KEYED });

    render(withShell(value, <RepertorySearchScreen />));
    fireEvent.change(screen.getByLabelText("Search for a Title"), {
      target: { value: "the" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await screen.findByTestId("search-card-movie-tmdb:603");

    fireEvent.click(screen.getByTestId("more-search-row:movie"));
    const grid = pushed.at(-1);
    expect(grid?.name).toBe("All of Movies");

    const view = render(withShell(value, grid!.payload.render()));
    expect(
      within(view.container).getByTestId("search-grid-card-movie-tmdb:603"),
    ).toBeInTheDocument();
  });

  it("a failed row keeps its own failure and the other kind's row still stands", async () => {
    const ask = vi.fn(async (action: Action): Promise<ActionOutcome> => ({
      response:
        action.type === "search"
          ? action.kind === "series"
            ? keyedSearchAnswer("series", {
                sent: 0,
                metas: [],
                failure: { kind: "fetch", detail: "TMDB answered with status 429" },
              })
            : keyedSearchAnswer("movie")
          : null,
      error: null,
    }));
    const { value } = harness({ ask, snapshot: KEYED });

    render(withShell(value, <RepertorySearchScreen />));
    fireEvent.change(screen.getByLabelText("Search for a Title"), {
      target: { value: "the" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByTestId("search-card-movie-tmdb:603")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("search-kind-series"));

    const row = await screen.findByTestId("search-row-series");
    expect(within(row).getByRole("alert")).toHaveTextContent("status 429");
    expect(within(row).getByRole("button", { name: "Try again" })).toBeEnabled();
    expect(screen.queryByTestId("search-card-movie-tmdb:603")).not.toBeInTheDocument();
  });

  it("a failing Catalog keeps its own row on the keyless arm", async () => {
    const ask = vi.fn(async (action: Action): Promise<ActionOutcome> => ({
      response:
        action.type === "search_catalogs"
          ? {
              snapshots: [],
              answer: {
                catalogs: [
                  MATRIX_ROW,
                  {
                    ...BREAKING_BAD_ROW,
                    failure: { kind: "fetch", detail: "the Addon answered with status 503" },
                  },
                ],
              },
            }
          : null,
      error: null,
    }));
    const { value } = harness({ ask });

    render(withShell(value, <RepertorySearchScreen />));
    fireEvent.change(screen.getByLabelText("Search for a Title"), {
      target: { value: "the" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByTestId("search-row-cinemeta/movie/top")).toBeInTheDocument();
    expect(screen.getByTestId("search-card-cinemeta-tt0133093")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("search-kind-series"));
    const series = await screen.findByTestId("search-row-cinemeta/series/top");
    expect(within(series).getByRole("alert")).toHaveTextContent("status 503");

    fireEvent.click(within(series).getByRole("button", { name: "Search again" }));
    await waitFor(() =>
      expect(
        actions(ask).filter((action) => action.type === "search_catalogs"),
      ).toHaveLength(2),
    );
  });

  it("a refused search keeps the query in the field to correct", async () => {
    const ask = vi.fn(async (_action: Action): Promise<ActionOutcome> => ({
      response: null,
      error: { kind: "fetch", detail: "the Addon answered with status 503" },
    }));
    const { value } = harness({ ask });

    render(withShell(value, <RepertorySearchScreen />));
    const input = screen.getByLabelText("Search for a Title");
    fireEvent.change(input, { target: { value: "the" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByTestId("search-catalogs-failure")).toHaveTextContent(
      "The Host could not fetch that Addon: the Addon answered with status 503.",
    );
    expect(actions(ask)).toContainEqual({ type: "search_catalogs", query: "the" });
    expect(input).toHaveValue("the");
  });
});

describe("the plain Vite preview's Search", () => {
  it("always searches the Catalogs, even when a TMDB key is held in the preview", async () => {
    const ask = vi.fn(async (action: Action): Promise<ActionOutcome> => ({
      response:
        action.type === "search_catalogs"
          ? { snapshots: [], answer: { catalogs: [MATRIX_ROW, BREAKING_BAD_ROW] } }
          : null,
      error: null,
    }));
    const { value } = harness({ ask, snapshot: KEYED });

    render(withShell(value, <RepertorySearchScreen />, true));

    fireEvent.change(screen.getByLabelText("Search for a Title"), {
      target: { value: "the" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(
      await screen.findByTestId("search-row-cinemeta/movie/top"),
    ).toBeInTheDocument();
    expect(actions(ask)).toContainEqual({ type: "search_catalogs", query: "the" });
    expect(actions(ask).some((action) => action.type === "search")).toBe(false);
  });
});

describe("the repertory editorial grid's backward path", () => {
  it("opens from the More card and returns focus to it on Back", async () => {
    const transport: Transport = {
      invoke: async <T,>(command: string, args?: Record<string, unknown>): Promise<T> => {
        if (command === "snapshot") {
          return KEYED as T;
        }
        if (command === "dispatch") {
          const action = (args?.envelope as { action: Action }).action;
          if (action.type === "discover") {
            return discoverAnswer(action.kind, action.page) as T;
          }
        }
        return { snapshots: [], answer: null } as T;
      },
      listen: async <T,>(_event: string, handler: (event: { payload: T }) => void) => {
        handler({ payload: KEYED as T });
        return () => undefined;
      },
    };

    render(<Shell client={new TauriLink(transport)} />);

    fireEvent.click(await screen.findByRole("button", { name: "Discover" }));
    const more = await screen.findByTestId("more-discover:movie");

    act(() => more.focus());
    fireEvent.click(more);
    await screen.findByTestId("discover-grid");

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() =>
      expect(screen.queryByTestId("discover-grid")).not.toBeInTheDocument(),
    );
    expect(document.activeElement, "the More card the grid was opened from").toBe(more);
  });
});
