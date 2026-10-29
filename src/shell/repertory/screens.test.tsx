import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  type Action,
  type AddonManifest,
  type CatalogRow,
  type Snapshot,
  type Stream,
  type Title,
} from "../../host-client";
import { ShellContext, type NewShellLevel, type ShellContextValue } from "../context";
import { HomeStore } from "../homeStore";
import { PreviewDataProvider } from "./context";
import repertoryCss from "./repertory.css?raw";
import { RepertoryDiscoverScreen, RepertorySearchScreen } from "./RepertoryFeed";
import { RepertoryStreamsScreen } from "./RepertoryStreams";
import { RepertoryTitleScreen } from "./RepertoryTitle";

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

function harness(overrides: Partial<ShellContextValue> = {}) {
  const pushed: NewShellLevel[] = [];
  const take = vi.fn(async (_action: Action) => null);
  const ask = vi.fn(async (_action: Action) => ({ response: null, error: null }));
  const value: ShellContextValue = {
    presentation: "repertory",
    snapshot: SNAPSHOT,
    error: null,
    destination: "home",
    chosenDestination: false,
    popover: null,
    unplayable: new Set<string>(),
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

describe("the repertory Title page", () => {
  it("draws the wordmark, facts, the Unmapped mark, seasons and episode stills", () => {
    const { value } = harness();
    render(withShell(value, <RepertoryTitleScreen title={SERIES} />));

    expect(screen.getByTestId("title-logo")).toHaveAttribute(
      "src",
      "https://images.test/bb-logo.png",
    );
    expect(screen.getByTestId("title-facts")).toHaveTextContent("IMDb 9.5");
    expect(screen.getByTestId("title-facts")).toHaveTextContent("Crime");
    expect(screen.getByTestId("title-unmapped")).toHaveTextContent(
      "no TMDB record met this Title",
    );
    expect(screen.getByTestId("season-1")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("episode-tt0903747:1:1")).toBeInTheDocument();
    expect(screen.getByTestId("episode-still")).toHaveAttribute(
      "src",
      "https://images.test/bb-s1e1.jpg",
    );
  });

  it("pushes the Streams level for the episode that was pressed", () => {
    const { value, pushed } = harness();
    render(withShell(value, <RepertoryTitleScreen title={SERIES} />));

    fireEvent.click(screen.getByTestId("episode-tt0903747:1:1"));

    expect(pushed).toHaveLength(1);
    expect(pushed[0]?.name).toBe("Streams");
    expect(screen.getByTestId("episode-tt0903747:1:1")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("pins the episode rail to the one-screen grid so the last episode can be revealed", () => {
    const grid = repertoryCss.match(/\.rep-title-grid\s*\{([^}]*)\}/)?.[1] ?? "";
    const episodes = repertoryCss.match(/\.rep-title-episodes\s*\{([^}]*)\}/)?.[1] ?? "";
    const streams = repertoryCss.match(/\.rep-stream-list\s*\{([^}]*)\}/)?.[1] ?? "";
    const fullBleed =
      repertoryCss.match(
        /html\[data-ui="repertory"\] \.shell-level:has\(\.rep-title-level\)\s*\{([^}]*)\}/,
      )?.[1] ?? "";

    expect(grid).toContain("grid-template-rows: minmax(0, 1fr)");
    expect(episodes).toContain("overflow-y: auto");
    expect(episodes).toContain("min-height: 0");
    // The Title owns the whole screen: its backdrop runs behind the chrome
    // band rather than starting under it.
    expect(fullBleed).toContain("padding-top: 0");
    // Touching rects are not "ahead" to the focus model; both vertical lists
    // need a real step or the D-pad skips every second item.
    expect(episodes).toContain("gap: 2px");
    expect(streams).toContain("gap: 2px");
  });

  it("gives a film one Find Streams control and leaves a mapped Title unmarked", () => {
    const { value, pushed } = harness();
    render(withShell(value, <RepertoryTitleScreen title={FILM} />));

    expect(screen.queryByTestId("title-unmapped")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("play-film"));

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
  it("draws Home's poster anatomy without the old heading and lede", async () => {
    const ask = vi.fn(async (action: Action) => ({
      response: previewCatalogAnswer(action),
      error: null,
    }));
    const { value } = harness({ ask });

    render(withShell(value, <RepertoryDiscoverScreen />, true));

    const card = await screen.findByTestId("discover-card-tt0133093");
    expect(card).toHaveTextContent("The Matrix");
    expect(card).toHaveTextContent("1999");
    expect(card).toHaveTextContent("IMDb 8.7");
    expect(screen.queryByText("A hacker learns the truth.")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Discover" })).not.toBeInTheDocument();
  });

  it("defaults to Movie and switches to Series without keeping both selected", async () => {
    const ask = vi.fn(async (action: Action) => ({
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
    const ask = vi.fn(async (action: Action) => ({
      response: previewCatalogAnswer(action),
      error: null,
    }));
    const { value } = harness({ ask });

    render(withShell(value, <RepertoryDiscoverScreen />, true));

    expect(await screen.findByText("All genres")).toHaveAttribute(
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
    expect(screen.getByText("All genres")).toHaveAttribute("aria-pressed", "false");
  });
});

describe("the repertory Search feed", () => {
  it("defaults to Movie, switches to Series, and shows one kind's rows", async () => {
    const ask = vi.fn(async (action: Action) => ({
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

    expect(await screen.findByText("Popular")).toBeInTheDocument();
    expect(screen.queryByText("Popular Series")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("search-kind-series"));

    expect(await screen.findByText("Popular Series")).toBeInTheDocument();
    expect(screen.queryByText("Popular")).not.toBeInTheDocument();
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
