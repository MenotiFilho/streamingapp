import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { CatalogSearchStore } from "../../core/catalogSearch";
import { FeedStore } from "../../core/feedStore";
import { HomeStore } from "../../core/homeStore";
import { Session } from "../../core/session";
import type { Action, AddonManifest, CatalogRow, MetaPreview, Snapshot } from "../../core/wire";
import { ShellContext, type ActionOutcome, type NewShellLevel, type ShellContextValue } from "../context";
import { readLevel } from "../layout";
import { PreviewDataProvider } from "../rehearsal/previewData";
import { MarqueeDestinationScreen } from "./MarqueeScreens";
import { MarqueeSearch } from "./MarqueeSearch";

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
  resources: [{ name: "catalog", types: ["movie", "series"], idPrefixes: ["tt"] }],
  types: ["movie", "series"],
  catalogs: [
    {
      type: "movie",
      id: "top",
      name: "Movies",
      extra: [{ name: "search", isRequired: false, options: [], optionsLimit: 0 }],
    },
    {
      type: "series",
      id: "top",
      name: "Series",
      extra: [{ name: "search", isRequired: false, options: [], optionsLimit: 0 }],
    },
  ],
  idPrefixes: ["tt"],
  behaviorHints: { configurable: false, configurationRequired: false },
  enabled: true,
};

function snapshotWith(tmdbHeld: boolean): Snapshot {
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
    protection: { backend: "file", tmdbHeld, stremioHeld: false },
    continueWatching: [],
    watchProgress: [],
    devices: [],
    pairingCode: "----",
    address: null,
  };
}

function meta(id: string, name: string, type = "movie"): MetaPreview {
  return {
    id,
    type,
    name,
    poster: `https://images.test/${id}.jpg`,
    posterShape: "poster",
    background: null,
    releaseInfo: "2012",
    imdbRating: "7.2",
    genres: ["Action"],
    description: null,
  };
}

const MOVIE_CATALOG_ROW: CatalogRow = {
  addon: "cinemeta",
  type: "movie",
  id: "top",
  name: "Movies",
  sent: 1,
  metas: [meta("tt1392170", "The Hunger Games", "movie")],
  failure: null,
};

const EMPTY_SERIES_CATALOG_ROW: CatalogRow = {
  addon: "cinemeta",
  type: "series",
  id: "top",
  name: "Series",
  sent: 0,
  metas: [],
  failure: null,
};

function renderSearch({
  snapshot = snapshotWith(true),
  ask,
  preview = false,
  node = <MarqueeSearch />,
  unplayable = new Set<string>(),
}: {
  snapshot?: Snapshot | null;
  ask?: (action: Action) => Promise<ActionOutcome>;
  preview?: boolean;
  node?: React.ReactNode;
  unplayable?: ReadonlySet<string>;
} = {}) {
  const pushed: NewShellLevel[] = [];
  const take = vi.fn(async (_action: Action) => null);
  const askMock = vi.fn(
    ask ??
      (async (action: Action): Promise<ActionOutcome> => {
        if (action.type === "search_catalogs") {
          return {
            response: {
              snapshots: [],
              answer: { catalogs: [MOVIE_CATALOG_ROW, EMPTY_SERIES_CATALOG_ROW] },
            },
            error: null,
          };
        }
        if (action.type === "search") {
          return {
            response: {
              snapshots: [],
              answer: {
                search: {
                  type: action.kind,
                  sent: 1,
                  metas: [
                    action.kind === "movie"
                      ? meta("tmdb:70160", "The Hunger Games", "movie")
                      : meta("tmdb:1396", "Breaking Bad", "series"),
                  ],
                  failure: null,
                },
              },
            },
            error: null,
          };
        }
        return { response: null, error: null };
      }),
  );

  const session = new Session({
    state: () => ({ kind: "ready", device: null }),
    onState: () => () => undefined,
    onSnapshot: () => () => undefined,
    onRevision: () => () => undefined,
    snapshot: async () => snapshot ?? snapshotWith(true),
    dispatch: async () => ({ snapshots: [], answer: null }),
    close: () => undefined,
  });
  const wrappedSession = Object.assign(Object.create(Object.getPrototypeOf(session)), session, {
    feeds: new FeedStore(askMock),
    searchCatalogs: new CatalogSearchStore(askMock),
  }) as Session;

  const value: ShellContextValue = {
    session: wrappedSession,
    snapshot,
    error: null,
    destination: "search",
    chosenDestination: true,
    popover: null,
    unplayable,
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

  const view = render(
    <PreviewDataProvider value={preview}>
      <ShellContext.Provider value={value}>{node}</ShellContext.Provider>
    </PreviewDataProvider>,
  );

  return {
    container: view.container,
    askMock,
    take,
    actions: () => askMock.mock.calls.map(([action]) => action),
  };
}

describe("Marquee Search boundary contracts", () => {
  it("mounts via MarqueeDestinationScreen and queries Addons' searchable Catalogs and TMDB together", async () => {
    const { actions, take } = renderSearch({
      node: <MarqueeDestinationScreen destination="search" />,
    });

    expect(screen.getByTestId("search-prompt")).toBeInTheDocument();
    const input = screen.getByLabelText("Search for a Title");
    fireEvent.change(input, { target: { value: "hunger games" } });
    fireEvent.submit(screen.getByRole("search", { name: "Search" }));

    expect(await screen.findByTestId("search-card-cinemeta-tt1392170")).toBeInTheDocument();
    expect(await screen.findByTestId("search-card-movie-tmdb:70160")).toBeInTheDocument();
    expect(await screen.findByTestId("search-card-series-tmdb:1396")).toBeInTheDocument();

    expect(actions()).toContainEqual({ type: "search_catalogs", query: "hunger games" });
    expect(actions()).toContainEqual({
      type: "search",
      query: "hunger games",
      kind: "movie",
      page: 1,
    });
    expect(actions()).toContainEqual({
      type: "search",
      query: "hunger games",
      kind: "series",
      page: 1,
    });

    // Empty catalog row keeps its row and explains why there are no cards.
    const emptySeriesRow = screen.getByTestId("search-row-cinemeta/series/top");
    expect(within(emptySeriesRow).getByText("No series match “hunger games”.")).toBeInTheDocument();

    // Pressing an Addon card sends open_title; pressing a TMDB card sends open_discovered_title.
    fireEvent.click(screen.getByTestId("search-card-cinemeta-tt1392170"));
    await waitFor(() =>
      expect(take).toHaveBeenCalledWith({
        type: "open_title",
        addon: "cinemeta",
        title: { type: "movie", id: "tt1392170" },
      }),
    );

    fireEvent.click(screen.getByTestId("search-card-movie-tmdb:70160"));
    await waitFor(() =>
      expect(take).toHaveBeenCalledWith({
        type: "open_discovered_title",
        key: { kind: "tmdb", id: 70160 },
        kind: "movie",
      }),
    );
  });

  it("queries only Addons' searchable Catalogs when no TMDB key is held, and renders Host-answered rows verbatim", async () => {
    const { actions } = renderSearch({ snapshot: snapshotWith(false) });

    fireEvent.change(screen.getByLabelText("Search for a Title"), {
      target: { value: "hunger games" },
    });
    fireEvent.submit(screen.getByRole("search", { name: "Search" }));

    expect(await screen.findByTestId("search-card-cinemeta-tt1392170")).toBeInTheDocument();
    expect(actions()).toEqual([{ type: "search_catalogs", query: "hunger games" }]);
    expect(screen.queryByTestId("search-tmdb")).not.toBeInTheDocument();
  });

  it("ignores blank submits and offers retry when search_catalogs or a TMDB row fails", async () => {
    let catalogAttempt = 0;
    const { actions } = renderSearch({
      snapshot: snapshotWith(true),
      ask: async (action) => {
        if (action.type === "search_catalogs") {
          catalogAttempt += 1;
          if (catalogAttempt === 1) {
            return {
              response: null,
              error: { kind: "fetch", detail: "status 503" },
            };
          }
          return {
            response: { snapshots: [], answer: { catalogs: [MOVIE_CATALOG_ROW] } },
            error: null,
          };
        }
        return {
          response: {
            snapshots: [],
            answer: {
              search: {
                type: action.type === "search" ? action.kind : "movie",
                sent: 0,
                metas: [],
                failure: { kind: "tmdb", detail: "rate limited" },
              },
            },
          },
          error: null,
        };
      },
    });

    // Blank submit sends nothing.
    fireEvent.change(screen.getByLabelText("Search for a Title"), { target: { value: "   " } });
    fireEvent.submit(screen.getByRole("search", { name: "Search" }));
    expect(actions()).toEqual([]);

    fireEvent.change(screen.getByLabelText("Search for a Title"), { target: { value: "dune" } });
    fireEvent.submit(screen.getByRole("search", { name: "Search" }));

    const catalogsFailure = await screen.findByTestId("search-catalogs-failure");
    expect(catalogsFailure).toHaveTextContent("status 503");

    const movieRow = await screen.findByTestId("search-row-movie");
    expect(within(movieRow).getByText("TMDB did not answer")).toBeInTheDocument();

    fireEvent.click(within(catalogsFailure).getByRole("button", { name: "Search again" }));
    expect(await screen.findByTestId("search-card-cinemeta-tt1392170")).toBeInTheDocument();
  });

  it("draws TMDB's Movies row before Series, and a failed row leaves the other standing", async () => {
    renderSearch({
      ask: async (action) => {
        if (action.type !== "search") {
          return { response: { snapshots: [], answer: { catalogs: [] } }, error: null };
        }
        const failed = action.kind === "series";
        return {
          response: {
            snapshots: [],
            answer: {
              search: {
                type: action.kind,
                sent: failed ? 0 : 1,
                metas: failed ? [] : [meta("tmdb:70160", "The Hunger Games")],
                failure: failed ? { kind: "tmdb", detail: "status 429" } : null,
              },
            },
          },
          error: null,
        };
      },
    });
    search("hunger games");

    expect(
      await screen.findByTestId("search-card-movie-tmdb:70160"),
    ).toBeInTheDocument();
    const series = await screen.findByTestId("search-row-series");
    expect(series).toHaveTextContent("status 429");
    expect(within(series).getByRole("button", { name: "Try again" })).toBeEnabled();
    expect(
      screen.getAllByTestId(/^search-row-(movie|series)$/).map((row) => row.dataset.testid),
    ).toEqual(["search-row-movie", "search-row-series"]);
  });

  it("keeps a failing Catalog on its own row and searches again from it", async () => {
    const { actions } = renderSearch({
      snapshot: snapshotWith(false),
      ask: async () => ({
        response: {
          snapshots: [],
          answer: {
            catalogs: [
              MOVIE_CATALOG_ROW,
              {
                ...EMPTY_SERIES_CATALOG_ROW,
                failure: { kind: "fetch", detail: "the Addon answered with status 503" },
              },
            ],
          },
        },
        error: null,
      }),
    });
    search("hunger games");

    expect(
      await screen.findByTestId("search-card-cinemeta-tt1392170"),
    ).toBeInTheDocument();
    const failed = screen.getByTestId("search-row-cinemeta/series/top");
    expect(failed).toHaveTextContent("status 503");

    fireEvent.click(within(failed).getByRole("button", { name: "Search again" }));
    await waitFor(() =>
      expect(actions().filter((action) => action.type === "search_catalogs")).toHaveLength(2),
    );
  });

  it("keeps a refused search's words in the field to correct", async () => {
    renderSearch({
      snapshot: snapshotWith(false),
      ask: async () => ({
        response: null,
        error: { kind: "fetch", detail: "the Addon answered with status 503" },
      }),
    });
    search("hunger games");

    expect(await screen.findByTestId("search-catalogs-failure")).toHaveTextContent(
      "The Host could not fetch that Addon: the Addon answered with status 503.",
    );
    expect(screen.getByLabelText("Search for a Title")).toHaveValue("hunger games");
  });

  it("searches only the Catalogs on the rehearsal, even with a TMDB key held", async () => {
    const { actions } = renderSearch({ preview: true, snapshot: snapshotWith(true) });
    search("hunger games");

    expect(
      await screen.findByTestId("search-card-cinemeta-tt1392170"),
    ).toBeInTheDocument();
    expect(actions()).toEqual([{ type: "search_catalogs", query: "hunger games" }]);
  });

  it("marks TMDB cards no Addon could play, and Addon cards only once learned unplayable", async () => {
    renderSearch({ unplayable: new Set<string>() });
    search("hunger games");

    // CINEMETA declares no `stream` resource: nothing could play a TMDB Title.
    expect(await screen.findByTestId("search-card-movie-tmdb:70160")).toHaveAccessibleName(
      "The Hunger Games, Unplayable",
    );
    expect(await screen.findByTestId("search-card-cinemeta-tt1392170")).toHaveAccessibleName(
      "The Hunger Games",
    );
    cleanup();

    renderSearch({ unplayable: new Set(["tt1392170"]) });
    search("hunger games");
    expect(await screen.findByTestId("search-card-cinemeta-tt1392170")).toHaveAccessibleName(
      "The Hunger Games, Unplayable",
    );
  });

  it("titles two Catalogs of one name by their kinds", async () => {
    renderSearch({
      snapshot: snapshotWith(false),
      ask: async () => ({
        response: {
          snapshots: [],
          answer: {
            catalogs: [
              { ...MOVIE_CATALOG_ROW, name: "Popular" },
              { ...EMPTY_SERIES_CATALOG_ROW, name: "Popular" },
            ],
          },
        },
        error: null,
      }),
    });
    search("hunger games");

    await screen.findByTestId("search-card-cinemeta-tt1392170");
    expect(
      screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent),
    ).toEqual(["Movies", "Series"]);
  });

  it("keeps Read on after the posters, mounted while it reads, even past an unreadable page", async () => {
    let release: (outcome: ActionOutcome) => void = () => undefined;
    const page = (kind: string, metas: MetaPreview[]): ActionOutcome => ({
      response: {
        snapshots: [],
        answer: { search: { type: kind, sent: 20, metas, failure: null } },
      },
      error: null,
    });
    const { container, actions } = renderSearch({
      ask: async (action) => {
        if (action.type !== "search") {
          return { response: { snapshots: [], answer: { catalogs: [] } }, error: null };
        }
        if (action.page > 1) {
          return new Promise<ActionOutcome>((resolve) => {
            release = resolve;
          });
        }
        return page(
          action.kind,
          action.kind === "movie" ? [meta("tmdb:70160", "The Hunger Games")] : [],
        );
      },
    });
    search("hunger games");
    await screen.findByTestId("search-card-movie-tmdb:70160");

    const order = (row: string) =>
      readLevel(container, {}).elements[`search-row:${row}`]?.map(
        (element) => element.getAttribute("data-testid") ?? element.textContent,
      );
    expect(order("movie")).toEqual(["search-card-movie-tmdb:70160", "Read on"]);
    // A page with nothing readable still pages on.
    expect(order("series")).toEqual(["Read on"]);

    const readOn = within(screen.getByTestId("search-row-movie")).getByRole("button", {
      name: "Read on",
    });
    act(() => readOn.focus());
    fireEvent.click(readOn);
    expect(readOn).toBeInTheDocument();
    expect(document.activeElement).toBe(readOn);
    fireEvent.click(readOn);
    expect(
      actions().filter((action) => action.type === "search" && action.page === 2),
    ).toHaveLength(1);

    await act(async () => release(page("movie", [meta("tmdb:101299", "Catching Fire")])));

    expect(order("movie")).toEqual([
      "search-card-movie-tmdb:70160",
      "search-card-movie-tmdb:101299",
      "Read on",
    ]);
  });
});

function search(query: string) {
  fireEvent.change(screen.getByLabelText("Search for a Title"), { target: { value: query } });
  fireEvent.submit(screen.getByRole("search", { name: "Search" }));
}
