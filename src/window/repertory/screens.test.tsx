import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useCallback, useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MOVIE, discoverFeedKey, discoverNoCounterpart } from "../../core/discover";
import type {
  Action,
  AddonManifest,
  CatalogRow,
  Snapshot,
  Stream,
  Title,
} from "../../core/wire";
import { actionKey } from "../../core/actionKey";
import { searchFeedKey } from "../../core/search";
import { TauriLink, type Transport } from "../tauriLink";
import { Shell } from "../Shell";
import { ShellContext, type ActionOutcome, type NewShellLevel, type ShellContextValue } from "../context";
import { quietSession } from "../session.testing";
import { HomeStore } from "../../core/homeStore";
import { PreviewDataProvider } from "./context";
import { RepertoryDiscoverScreen } from "./RepertoryDiscover";
import { RepertoryStreamsScreen } from "./RepertoryStreams";
import { RepertoryTitleScreen } from "./RepertoryTitle";
import { RepertorySearchScreen } from "./RepertorySearch";

afterEach(() => {
  vi.unstubAllGlobals();
});

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
  continueWatching: [],
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

/** A series with enough seasons for its chip rail to overflow a narrow view. */
const MANY_SEASONS: Title = {
  ...SERIES,
  id: "tt-seasons",
  key: { kind: "addon", addon: "com.linvo.cinemeta", id: "tt-seasons" },
  videos: [1, 2, 3, 4, 5, 6].map((season) => ({
    id: `tt-seasons:${season}:1`,
    name: `Season ${season}`,
    season,
    episode: 1,
    thumbnail: null,
  })),
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
  const ask = (overrides.ask ??
    vi.fn(async (_action: Action) => ({ response: null, error: null }))) as AskSpy;
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

  it("draws the season chips in the Host's order, so the Specials chip is last", () => {
    const { value } = harness();
    const ordered: Title = {
      ...SERIES,
      videos: [
        {
          id: "tt0903747:1:1",
          name: "Pilot",
          season: 1,
          episode: 1,
          thumbnail: null,
        },
        {
          id: "tt0903747:2:1",
          name: "Seven Thirty-Seven",
          season: 2,
          episode: 1,
          thumbnail: null,
        },
        {
          id: "tt0903747:0:1",
          name: "Good Cop Bad Cop",
          season: 0,
          episode: 1,
          thumbnail: null,
        },
      ],
    };
    render(withShell(value, <RepertoryTitleScreen title={ordered} />));

    const seasons = screen.getByRole("region", { name: "Seasons" });
    const chips = within(seasons)
      .getAllByRole("button")
      .filter((button) => button.dataset.testid?.startsWith("season-"));
    expect(chips.map((chip) => chip.dataset.testid)).toEqual([
      "season-1",
      "season-2",
      "season-0",
    ]);
  });

  it("draws the season chips as a rail whose arrows page them", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: true,
        media: "(prefers-reduced-motion: reduce)",
        addEventListener: () => {},
        removeEventListener: () => {},
      })),
    );
    const { value } = harness();
    render(withShell(value, <RepertoryTitleScreen title={MANY_SEASONS} />));

    const row = screen.getByRole("region", { name: "Seasons" });
    const track = within(row).getByRole("list");
    Object.defineProperty(track, "clientWidth", { configurable: true, value: 300 });
    Object.defineProperty(track, "scrollWidth", { configurable: true, value: 1_200 });
    within(track)
      .getAllByRole("listitem")
      .forEach((item, index) => {
        const left = index * 116;
        vi.spyOn(item, "getBoundingClientRect").mockReturnValue({
          x: left,
          y: 0,
          width: 100,
          height: 40,
          left,
          top: 0,
          right: left + 100,
          bottom: 40,
          toJSON: () => ({}),
        } as DOMRect);
      });
    fireEvent.scroll(track);

    const left = within(row).getByRole("button", { name: "Scroll Seasons left" });
    const right = within(row).getByRole("button", { name: "Scroll Seasons right" });
    expect(left).toBeDisabled();
    expect(right).toBeEnabled();

    fireEvent.click(right);
    expect(track.scrollLeft, "the same whole-item page a poster rail takes").toBe(232);
    expect(left).toBeEnabled();
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

  it("shows the Movies and Series rows together, with no kind chips", async () => {
    const ask = vi.fn(async (action: Action): Promise<ActionOutcome> => ({
      response: previewCatalogAnswer(action),
      error: null,
    }));
    const { value } = harness({ ask });

    render(withShell(value, <RepertoryDiscoverScreen />, true));

    expect(await screen.findByTestId("discover-card-tt0133093")).toBeInTheDocument();
    expect(await screen.findByTestId("discover-card-tt0903747")).toBeInTheDocument();
    expect(actions(ask)).toContainEqual({
      type: "browse_catalog",
      addon: "cinemeta",
      catalog: { type: "movie", id: "top" },
      extra: [],
    });
    expect(actions(ask)).toContainEqual({
      type: "browse_catalog",
      addon: "cinemeta",
      catalog: { type: "series", id: "top" },
      extra: [],
    });
    expect(screen.queryByTestId("discover-kind-movie")).not.toBeInTheDocument();
    expect(screen.queryByTestId("discover-kind-series")).not.toBeInTheDocument();
  });

  it("one genre chip asks both rows by Cinemeta's own name", async () => {
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
    fireEvent.click(await screen.findByRole("button", { name: "Action" }));

    await waitFor(() =>
      expect(actions(ask)).toContainEqual({
        type: "browse_catalog",
        addon: "cinemeta",
        catalog: { type: "movie", id: "top" },
        extra: [{ name: "genre", value: "Action" }],
      }),
    );
    expect(actions(ask)).toContainEqual({
      type: "browse_catalog",
      addon: "cinemeta",
      catalog: { type: "series", id: "top" },
      extra: [{ name: "genre", value: "Action" }],
    });
    expect(screen.getByRole("button", { name: "All genres" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("draws the genre chips as a rail whose arrows page them", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: true,
        media: "(prefers-reduced-motion: reduce)",
        addEventListener: () => {},
        removeEventListener: () => {},
      })),
    );
    const ask = vi.fn(async (action: Action): Promise<ActionOutcome> => ({
      response: previewCatalogAnswer(action),
      error: null,
    }));
    const { value } = harness({ ask });

    render(withShell(value, <RepertoryDiscoverScreen />, true));
    await screen.findByRole("button", { name: "All genres" });

    const row = screen.getByRole("region", { name: "Genres" });
    const track = within(row).getByRole("list");
    Object.defineProperty(track, "clientWidth", { configurable: true, value: 300 });
    Object.defineProperty(track, "scrollWidth", { configurable: true, value: 1_200 });
    within(track)
      .getAllByRole("listitem")
      .forEach((item, index) => {
        const left = index * 116;
        vi.spyOn(item, "getBoundingClientRect").mockReturnValue({
          x: left,
          y: 0,
          width: 100,
          height: 40,
          left,
          top: 0,
          right: left + 100,
          bottom: 40,
          toJSON: () => ({}),
        } as DOMRect);
      });
    fireEvent.scroll(track);

    const left = within(row).getByRole("button", { name: "Scroll Genres left" });
    const right = within(row).getByRole("button", { name: "Scroll Genres right" });
    expect(left).toBeDisabled();
    expect(right).toBeEnabled();

    fireEvent.click(right);
    expect(track.scrollLeft, "the same whole-item page a poster rail takes").toBe(232);
    expect(left).toBeEnabled();
  });

  it("a series-only genre leaves the Movies row empty with its line, and asks only Series", async () => {
    const ask = vi.fn(async (action: Action): Promise<ActionOutcome> => ({
      response: previewCatalogAnswer(action),
      error: null,
    }));
    const { value } = harness({ ask });

    render(withShell(value, <RepertoryDiscoverScreen />, true));
    await screen.findByTestId("discover-card-tt0133093");

    fireEvent.click(await screen.findByRole("button", { name: "Reality-TV" }));

    await waitFor(() =>
      expect(actions(ask)).toContainEqual({
        type: "browse_catalog",
        addon: "cinemeta",
        catalog: { type: "series", id: "top" },
        extra: [{ name: "genre", value: "Reality-TV" }],
      }),
    );
    expect(
      actions(ask).some(
        (action) =>
          action.type === "browse_catalog" &&
          action.catalog.type === "movie" &&
          action.extra.some((extra) => extra.name === "genre"),
      ),
      "an ask without the genre would answer the unfiltered feed",
    ).toBe(false);

    const movies = screen.getByTestId("discover-section-movie");
    expect(
      within(movies).getByText(discoverNoCounterpart(MOVIE, "Reality-TV")),
    ).toBeInTheDocument();
    expect(
      within(movies).queryByTestId("discover-card-tt0133093"),
    ).not.toBeInTheDocument();
  });
});

describe("the repertory Search feed", () => {
  it("a keyless query draws every answering Catalog's row, and has no kind chips", async () => {
    const ask = vi.fn(async (action: Action): Promise<ActionOutcome> => ({
      response:
        action.type === "search_catalogs"
          ? { snapshots: [], answer: { catalogs: [MATRIX_ROW, BREAKING_BAD_ROW] } }
          : null,
      error: null,
    }));
    const { value } = harness({ ask });

    render(withShell(value, <RepertorySearchScreen />, true));

    expect(screen.queryByTestId("search-kind-movie")).not.toBeInTheDocument();
    expect(screen.queryByTestId("search-kind-series")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search for a Title"), {
      target: { value: "the" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(
      await screen.findByTestId("search-row-cinemeta/movie/top"),
    ).toBeInTheDocument();
    expect(
      await screen.findByTestId("search-row-cinemeta/series/top"),
    ).toBeInTheDocument();
  });
});

const KEYED: Snapshot = {
  ...SNAPSHOT,
  protection: { ...SNAPSHOT.protection, tmdbHeld: true },
};

const MATRIX_META = MATRIX_ROW.metas[0]!;
const BREAKING_BAD_META = BREAKING_BAD_ROW.metas[0]!;

type AskSpy = ((action: Action) => Promise<ActionOutcome>) & {
  mock: { calls: [Action][] };
};

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
  it("asks both kinds' first pages on landing, and a genre by each kind's own id", async () => {
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
    expect(await screen.findByTestId("discover-card-tmdb:1396")).toBeInTheDocument();
    expect(actions(ask)).toContainEqual({ type: "discover", kind: "movie", page: 1 });
    expect(actions(ask)).toContainEqual({ type: "discover", kind: "series", page: 1 });
    expect(screen.queryByTestId("discover-kind-movie")).not.toBeInTheDocument();
    expect(screen.queryByTestId("discover-kind-series")).not.toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: "Action" }));

    await waitFor(() =>
      expect(actions(ask)).toContainEqual({
        type: "discover",
        kind: "movie",
        page: 1,
        genre: 28,
      }),
    );
    expect(actions(ask)).toContainEqual({
      type: "discover",
      kind: "series",
      page: 1,
      genre: 10759,
    });
  });

  it("asks the next page from a row's own More, and keeps the cards already read", async () => {
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
    expect(
      actions(ask),
      "the other row is not paged by this row's More",
    ).not.toContainEqual({ type: "discover", kind: "series", page: 2 });
  });

  it("a film-only genre leaves the Series row empty with its line, and asks only Movies", async () => {
    const ask = vi.fn(async (action: Action): Promise<ActionOutcome> => ({
      response:
        action.type === "discover"
          ? discoverAnswer(action.kind, action.page)
          : null,
      error: null,
    }));
    const { value } = harness({ ask, snapshot: KEYED });

    render(withShell(value, <RepertoryDiscoverScreen />));
    await screen.findByTestId("discover-card-tmdb:1396");
    const seriesAsks = actions(ask).filter(
      (action) => action.type === "discover" && action.kind === "series",
    ).length;

    fireEvent.click(await screen.findByRole("button", { name: "TV Movie" }));

    await waitFor(() =>
      expect(actions(ask)).toContainEqual({
        type: "discover",
        kind: "movie",
        page: 1,
        genre: 10770,
      }),
    );
    expect(
      actions(ask).filter(
        (action) => action.type === "discover" && action.kind === "series",
      ),
      "series have no TV Movie: asking unfiltered would show the whole feed",
    ).toHaveLength(seriesAsks);

    const series = screen.getByTestId("discover-section-series");
    expect(
      within(series).getByText(discoverNoCounterpart("series", "TV Movie")),
    ).toBeInTheDocument();
    expect(
      within(series).queryByTestId("discover-card-tmdb:1396"),
    ).not.toBeInTheDocument();
  });

  it("opens each row's loaded cards as its own grid from its More card", async () => {
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
    await screen.findByTestId("discover-card-tmdb:1396");

    fireEvent.click(screen.getByTestId("more-discover:movie"));
    const grid = pushed.at(-1);
    expect(grid?.name).toBe("All of Movies");

    const view = render(withShell(value, grid!.payload.render()));
    expect(
      within(view.container).getByTestId("discover-grid-card-tmdb:603"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        value.session.feeds.feed(discoverFeedKey("host", null, "movie")).done,
        "the grid's own page settles before the test leaves it",
      ).toBe(true),
    );

    fireEvent.click(within(view.container).getByRole("button", { name: "Back" }));
    expect(value.pop).toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("more-discover:series"));
    expect(pushed.at(-1)?.name).toBe("All of Series");
    view.unmount();
  });

  it("keeps a failed page in its own row and offers that page again", async () => {
    let movieCalls = 0;
    const ask = vi.fn(async (action: Action): Promise<ActionOutcome> => {
      if (action.type !== "discover") {
        return { response: null, error: null };
      }
      if (action.kind === "series") {
        return { response: discoverAnswer("series", action.page), error: null };
      }
      movieCalls += 1;
      if (movieCalls === 1) {
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

    const movie = screen.getByTestId("discover-section-movie");
    expect(await within(movie).findByRole("alert")).toHaveTextContent("status 503");
    expect(
      await screen.findByTestId("discover-card-tmdb:1396"),
      "the other row is not emptied by this row's failure",
    ).toBeInTheDocument();

    fireEvent.click(within(movie).getByRole("button", { name: "Try again" }));

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

  it("asks both kinds on submit, draws Movies then Series, and has no kind chips", async () => {
    const ask = vi.fn(async (action: Action): Promise<ActionOutcome> => ({
      response:
        action.type === "search"
          ? keyedSearchAnswer(action.kind)
          : null,
      error: null,
    }));
    const { value } = harness({ ask, snapshot: KEYED });

    render(withShell(value, <RepertorySearchScreen />));

    expect(screen.queryByTestId("search-kind-movie")).not.toBeInTheDocument();
    expect(screen.queryByTestId("search-kind-series")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search for a Title"), {
      target: { value: "the" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByTestId("search-card-movie-tmdb:603")).toBeInTheDocument();
    expect(await screen.findByTestId("search-card-series-tmdb:1396")).toBeInTheDocument();
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

    const rows = screen.getAllByTestId(/^search-row-(movie|series)$/);
    expect(rows.map((row) => row.getAttribute("data-testid"))).toEqual([
      "search-row-movie",
      "search-row-series",
    ]);
    expect(screen.getByTestId("more-search-row:movie")).toBeInTheDocument();
    expect(screen.getByTestId("more-search-row:series")).toBeInTheDocument();
  });

  it("pages one row from its own More, leaving the other row where it read to", async () => {
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
    await screen.findByTestId("search-card-series-tmdb:1396");

    const series = screen.getByTestId("search-row-series");
    fireEvent.click(within(series).getByRole("button", { name: "Read on" }));

    expect(await screen.findByTestId("search-card-series-tmdb:1397")).toBeInTheDocument();
    expect(screen.getByTestId("search-card-movie-tmdb:603")).toBeInTheDocument();
    expect(actions(ask)).toContainEqual({
      type: "search",
      query: "the",
      kind: "series",
      page: 2,
    });
    expect(
      actions(ask).filter(
        (action) => action.type === "search" && action.kind === "movie" && action.page === 2,
      ),
    ).toEqual([]);
  });

  it("opens each kind's row as a grid from its own More card", async () => {
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
    await screen.findByTestId("search-card-series-tmdb:1396");

    fireEvent.click(screen.getByTestId("more-search-row:movie"));
    const movieGrid = pushed.at(-1);
    expect(movieGrid?.name).toBe("All of Movies");

    const movieView = render(withShell(value, movieGrid!.payload.render()));
    expect(
      within(movieView.container).getByTestId("search-grid-card-movie-tmdb:603"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        value.session.feeds.feed(searchFeedKey("the", "movie")).done,
        "the grid's own page settles before the test leaves it",
      ).toBe(true),
    );

    fireEvent.click(screen.getByTestId("more-search-row:series"));
    const seriesGrid = pushed.at(-1);
    expect(seriesGrid?.name).toBe("All of Series");

    const seriesView = render(withShell(value, seriesGrid!.payload.render()));
    expect(
      within(seriesView.container).getByTestId("search-grid-card-series-tmdb:1396"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(value.session.feeds.feed(searchFeedKey("the", "series")).done).toBe(true),
    );
    movieView.unmount();
    seriesView.unmount();
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

    const row = await screen.findByTestId("search-row-series");
    expect(within(row).getByRole("alert")).toHaveTextContent("status 429");
    expect(within(row).getByRole("button", { name: "Try again" })).toBeEnabled();
    expect(screen.getByTestId("search-card-movie-tmdb:603")).toBeInTheDocument();
    expect(screen.queryByTestId("search-card-series-tmdb:1396")).not.toBeInTheDocument();
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

    const series = await screen.findByTestId("search-row-cinemeta/series/top");
    expect(within(series).getByRole("alert")).toHaveTextContent("status 503");
    expect(screen.getByTestId("search-row-cinemeta/movie/top")).toBeInTheDocument();

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

/**
 * The window's grids through the real Shell (#264, #248 P1): the grid is a
 * pushed level over the live screen, so Back is the shell's Escape and the rail
 * underneath must show what the grid read. jsdom has no layout, so the grid's
 * own end trigger sees the cards at 0 and reads on — the decision under test is
 * the shared Session row, not a rendered rectangle.
 */
describe("the window's editorial grids share the rail's rows", () => {
  function transport(respond: (action: Action) => unknown): Transport {
    return {
      invoke: async <T,>(command: string, args?: Record<string, unknown>): Promise<T> => {
        if (command === "snapshot") {
          return KEYED as T;
        }
        if (command === "dispatch") {
          const action = (args?.envelope as { action: Action }).action;
          return (respond(action) ?? { snapshots: [], answer: null }) as T;
        }
        return { snapshots: [], answer: null } as T;
      },
      listen: async <T,>(_event: string, handler: (event: { payload: T }) => void) => {
        handler({ payload: KEYED as T });
        return () => undefined;
      },
    };
  }

  const searchAnswer = (kind: string, page: number) => ({
    snapshots: [],
    answer: {
      search: {
        type: kind,
        sent: 1,
        metas: [
          kind === "series"
            ? { ...BREAKING_BAD_META, id: page === 1 ? "tmdb:1396" : "tmdb:1397" }
            : { ...MATRIX_META, id: `tmdb:${page === 1 ? 603 : 604}` },
        ],
        failure: null,
      },
    },
  });

  it("a page the Discover grid reads is in the rail after Back, with the genre kept", async () => {
    const link = new TauriLink(
      transport((action) =>
        action.type === "discover" ? discoverAnswer(action.kind, action.page) : null,
      ),
    );
    render(<Shell client={link} />);

    fireEvent.click(await screen.findByRole("button", { name: "Discover" }));
    await screen.findByTestId("discover-card-tmdb:603");

    fireEvent.click(await screen.findByRole("button", { name: "Drama" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Drama" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    await screen.findByTestId("discover-card-tmdb:603");

    fireEvent.click(screen.getByTestId("more-discover:movie"));
    expect(
      await screen.findByTestId("discover-grid-card-tmdb:604"),
      "the grid reads on by itself",
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("discover-grid")).getByText("Drama / 2 films"),
      "the head's tag is read live from the row it drew",
    ).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByTestId("discover-grid")).not.toBeInTheDocument(),
    );
    expect(
      await screen.findByTestId("discover-card-tmdb:604"),
      "the page the grid read is in the rail after Back",
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("discover-section-series"),
      "both rows come back",
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Drama" }),
      "the genre comes back",
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("a page the Discover rail read is in the grid, and no page 1 is asked again", async () => {
    const asks: Action[] = [];
    const link = new TauriLink(
      transport((action) => {
        asks.push(action);
        return action.type === "discover" ? discoverAnswer(action.kind, action.page) : null;
      }),
    );
    render(<Shell client={link} />);

    fireEvent.click(await screen.findByRole("button", { name: "Discover" }));
    await screen.findByTestId("discover-card-tmdb:603");

    const movie = screen.getByTestId("discover-section-movie");
    fireEvent.click(within(movie).getByRole("button", { name: "Read on" }));
    await screen.findByTestId("discover-card-tmdb:604");
    const firstPages = asks.filter(
      (action) => action.type === "discover" && action.kind === "movie" && action.page === 1,
    ).length;

    fireEvent.click(screen.getByTestId("more-discover:movie"));
    expect(
      await screen.findByTestId("discover-grid-card-tmdb:604"),
      "the page the rail read is in the grid",
    ).toBeInTheDocument();
    expect(
      asks.filter(
        (action) =>
          action.type === "discover" && action.kind === "movie" && action.page === 1,
      ),
      "opening the grid asks no page 1 again",
    ).toHaveLength(firstPages);
  });

  it("a page the Search grid reads is in the rail after Back, with the query kept", async () => {
    const link = new TauriLink(
      transport((action) =>
        action.type === "search" ? searchAnswer(action.kind, action.page) : null,
      ),
    );
    render(<Shell client={link} />);

    fireEvent.click(await screen.findByRole("button", { name: "Search" }));
    fireEvent.change(await screen.findByLabelText("Search for a Title"), {
      target: { value: "the" },
    });
    fireEvent.click(
      within(screen.getByRole("search")).getByRole("button", { name: "Search" }),
    );
    await screen.findByTestId("search-card-movie-tmdb:603");

    fireEvent.click(screen.getByTestId("more-search-row:movie"));
    expect(
      await screen.findByTestId("search-grid-card-movie-tmdb:604"),
      "the grid reads on by itself",
    ).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByTestId("search-grid")).not.toBeInTheDocument(),
    );
    expect(
      await screen.findByTestId("search-card-movie-tmdb:604"),
      "the page the grid read is in the rail after Back",
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("search-card-series-tmdb:1396"),
      "the other kind's row comes back",
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Search for a Title"),
      "the query comes back with the rows",
    ).toHaveValue("the");
  });

  it("a page the Search rail read is in the grid, and no page 1 is asked again", async () => {
    const asks: Action[] = [];
    const link = new TauriLink(
      transport((action) => {
        asks.push(action);
        return action.type === "search" ? searchAnswer(action.kind, action.page) : null;
      }),
    );
    render(<Shell client={link} />);

    fireEvent.click(await screen.findByRole("button", { name: "Search" }));
    fireEvent.change(await screen.findByLabelText("Search for a Title"), {
      target: { value: "the" },
    });
    fireEvent.click(
      within(screen.getByRole("search")).getByRole("button", { name: "Search" }),
    );
    await screen.findByTestId("search-card-movie-tmdb:603");

    const series = screen.getByTestId("search-row-series");
    fireEvent.click(within(series).getByRole("button", { name: "Read on" }));
    await screen.findByTestId("search-card-series-tmdb:1397");
    const firstPages = asks.filter(
      (action) => action.type === "search" && action.kind === "series" && action.page === 1,
    ).length;

    fireEvent.click(screen.getByTestId("more-search-row:series"));
    expect(
      await screen.findByTestId("search-grid-card-series-tmdb:1397"),
      "the page the rail read is in the grid",
    ).toBeInTheDocument();
    expect(
      asks.filter(
        (action) =>
          action.type === "search" && action.kind === "series" && action.page === 1,
      ),
      "opening the grid asks no page 1 again",
    ).toHaveLength(firstPages);
  });
});
