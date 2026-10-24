import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  HostClient,
  type Action,
  type AddonCatalog,
  type AddonManifest,
  type CatalogRow,
  type MetaPreview,
  type SearchRow,
  type Snapshot,
  type Title,
  type Transport,
} from "../host-client";
import { Shell } from "./Shell";

const CINEMETA: AddonManifest = {
  id: "com.linvo.cinemeta",
  name: "Cinemeta",
  version: "3.0.0",
  resources: [{ name: "stream", types: ["movie", "series"], idPrefixes: ["tt"] }],
  types: ["movie", "series"],
  catalogs: [],
  idPrefixes: ["tt"],
  behaviorHints: { configurable: false, configurationRequired: false },
};

const CATALOG_ONLY: AddonManifest = {
  ...CINEMETA,
  id: "com.example.catalog-only",
  name: "Catalog only",
  resources: [{ name: "meta", types: ["movie", "series"], idPrefixes: ["tt"] }],
};

function searchCatalog(
  type: string,
  id: string,
  name: string,
  search: boolean,
): AddonCatalog {
  return {
    type,
    id,
    name,
    extra: search
      ? [{ name: "search", isRequired: false, options: [], optionsLimit: 0 }]
      : [{ name: "skip", isRequired: false, options: [], optionsLimit: 0 }],
  };
}

const SEARCHABLE: AddonManifest = {
  ...CINEMETA,
  id: "com.example.search",
  name: "Searchable",
  resources: [{ name: "catalog", types: ["movie", "series"], idPrefixes: ["tt"] }],
  catalogs: [
    searchCatalog("movie", "films", "Films", true),
    searchCatalog("series", "shows", "Shows", true),
    searchCatalog("movie", "top", "Top films", false),
  ],
};

const NOTHING_SAID: Snapshot = {
  revision: 1,
  playback: {
    state: "idle",
    picture: "in_window",
    failure: null,
    nowPlaying: null,
    episode: null,
    position: null,
    duration: null,
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
  addons: [CINEMETA],
  featuredCatalog: null,
  protection: { backend: "keyring", tmdbHeld: true, stremioHeld: false },
  watchProgress: [],
  devices: [],
  pairingCode: "4K7Q2M",
  address: "192.168.1.9:8090",
};

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return { ...NOTHING_SAID, ...overrides };
}

function keylessSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return snapshot({
    protection: { backend: "keyring", tmdbHeld: false, stremioHeld: false },
    ...overrides,
  });
}

const MOVIE_META: MetaPreview = {
  id: "tmdb:603",
  type: "movie",
  name: "The Matrix",
  poster: "https://images.test/matrix.jpg",
  posterShape: "poster",
  background: "https://images.test/matrix-backdrop.jpg",
  releaseInfo: "1999",
  imdbRating: "8.7",
  genres: ["Action"],
  description: "A hacker learns the truth.",
};

const SERIES_META: MetaPreview = {
  ...MOVIE_META,
  id: "tmdb:1396",
  type: "series",
  name: "Breaking Bad",
  poster: "https://images.test/breaking-bad.jpg",
  releaseInfo: "2008",
};

function searchRow(metas: MetaPreview[], overrides: Partial<SearchRow> = {}): SearchRow {
  return { type: "movie", sent: metas.length, metas, failure: null, ...overrides };
}

function catalogRow(
  addon: string,
  type: string,
  id: string,
  name: string,
  metas: MetaPreview[],
  overrides: Partial<CatalogRow> = {},
): CatalogRow {
  return {
    addon,
    type,
    id,
    name,
    sent: metas.length,
    metas,
    failure: null,
    ...overrides,
  };
}

const MATRIX: Title = {
  addon: null,
  id: "tmdb:603",
  key: { kind: "tmdb", id: 603 },
  type: "movie",
  name: "The Matrix",
  poster: "https://images.test/matrix.jpg",
  background: "https://images.test/matrix-backdrop.jpg",
  logo: null,
  description: "A hacker learns the truth.",
  releaseInfo: "1999",
  runtime: "136 min",
  imdbRating: "8.7",
  genres: ["Action"],
  videos: [],
};

const MATRIX_ADDON: Title = {
  ...MATRIX,
  addon: SEARCHABLE.id,
  id: "tt0133093",
  key: { kind: "addon", addon: SEARCHABLE.id, id: "tt0133093" },
};

type TmdbSearch = Extract<Action, { type: "search" }>;
type Invocation = { command: string; args?: Record<string, unknown> };

function fakeHost(
  initial: Snapshot,
  options: {
    search?: (action: TmdbSearch) => SearchRow;
    catalogs?: (query: string) => CatalogRow[];
    title?: Title;
  } = {},
) {
  const invocations: Invocation[] = [];

  const transport: Transport = {
    invoke: async <T,>(command: string, args?: Record<string, unknown>): Promise<T> => {
      invocations.push({ command, args });
      if (command === "snapshot") {
        return initial as T;
      }

      const action = (args?.envelope as { action: Action }).action;
      if (action.type === "search") {
        const answer = options.search
          ? options.search(action)
          : searchRow([action.kind === "series" ? SERIES_META : MOVIE_META], {
              type: action.kind,
            });
        return { snapshots: [], answer: { search: answer } } as T;
      }
      if (action.type === "search_catalogs") {
        const rows = options.catalogs ? options.catalogs(action.query) : [];
        return { snapshots: [], answer: { catalogs: rows } } as T;
      }
      if (action.type === "open_discovered_title") {
        return { snapshots: [], answer: { title: MATRIX } } as T;
      }
      if (action.type === "open_title") {
        return { snapshots: [], answer: { title: options.title ?? MATRIX_ADDON } } as T;
      }
      return { snapshots: [], answer: null } as T;
    },
    listen: async () => () => {},
  };

  return { client: new HostClient(transport), invocations };
}

function actions(invocations: Invocation[]): Action[] {
  return invocations
    .filter(({ command }) => command === "dispatch")
    .map(({ args }) => (args?.envelope as { action: Action }).action);
}

function tmdbAsks(invocations: Invocation[]): TmdbSearch[] {
  return actions(invocations).filter(
    (action): action is TmdbSearch => action.type === "search",
  );
}

function catalogSearchAsks(invocations: Invocation[]): Action[] {
  return actions(invocations).filter(
    (action) => action.type === "search_catalogs",
  );
}

async function openSearch(host: ReturnType<typeof fakeHost>): Promise<HTMLElement> {
  render(<Shell client={host.client} />);
  await screen.findByRole("heading", { name: "Home" });
  const rail = screen.getByRole("navigation", { name: "Destinations" });
  fireEvent.click(within(rail).getByRole("button", { name: "Search" }));
  await screen.findByTestId("search-screen");
  return screen.getByRole("search", { name: "Search" });
}

function submitQuery(form: HTMLElement, query: string): HTMLInputElement {
  const input = within(form).getByLabelText("Search for a Title") as HTMLInputElement;
  fireEvent.change(input, { target: { value: query } });
  fireEvent.click(within(form).getByRole("button", { name: "Search" }));
  return input;
}

function rect(x: number, y: number, w: number, h: number) {
  return {
    x,
    y,
    w,
    h,
    left: x,
    top: y,
    width: w,
    height: h,
    right: x + w,
    bottom: y + h,
    toJSON: () => ({}),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Search with a TMDB key", () => {
  test("typing asks nothing; submitting asks both kinds and draws both rows", async () => {
    const host = fakeHost(snapshot());
    const form = await openSearch(host);
    const input = within(form).getByLabelText("Search for a Title");

    fireEvent.change(input, { target: { value: "matrix" } });
    expect(
      actions(host.invocations),
      "a keystroke is not a search: the box is submit-only",
    ).toEqual([]);

    fireEvent.click(within(form).getByRole("button", { name: "Search" }));

    expect(await screen.findByTestId("search-card-movie-tmdb:603")).toHaveTextContent(
      "The Matrix",
    );
    expect(await screen.findByTestId("search-card-series-tmdb:1396")).toHaveTextContent(
      "Breaking Bad",
    );

    expect(tmdbAsks(host.invocations)).toEqual([
      { type: "search", query: "matrix", kind: "movie", page: 1 },
      { type: "search", query: "matrix", kind: "series", page: 1 },
    ]);
    expect(
      actions(host.invocations).some((action) => action.type === "search_catalogs"),
      "the keyed arm never falls back to the Addons",
    ).toBe(false);

    expect(screen.getByTestId("search-row-movie")).toHaveTextContent("Movies");
    expect(screen.getByTestId("search-row-series")).toHaveTextContent("Series");
    expect(
      screen.queryByRole("button", { name: "Movie" }),
      "there is no kind toggle: both rows always show",
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Series" })).not.toBeInTheDocument();
  });

  test("each row pages on its own and keeps what it has already read", async () => {
    const RELOADED = { ...MOVIE_META, id: "tmdb:604", name: "The Matrix Reloaded" };
    const SAUL = { ...SERIES_META, id: "tmdb:1397", name: "Better Call Saul" };
    const host = fakeHost(snapshot(), {
      search: (action) => {
        if (action.kind === "movie") {
          return searchRow([action.page === 1 ? MOVIE_META : RELOADED], {
            type: "movie",
          });
        }
        return searchRow([action.page === 1 ? SERIES_META : SAUL], { type: "series" });
      },
    });
    const form = await openSearch(host);
    submitQuery(form, "matrix");
    await screen.findByTestId("search-card-movie-tmdb:603");
    await screen.findByTestId("search-card-series-tmdb:1396");

    const movieRow = screen.getByTestId("search-row-movie");
    fireEvent.click(within(movieRow).getByRole("button", { name: "More" }));

    expect(await screen.findByTestId("search-card-movie-tmdb:604")).toHaveTextContent(
      "The Matrix Reloaded",
    );
    expect(screen.getByTestId("search-card-movie-tmdb:603")).toBeInTheDocument();
    expect(screen.getByTestId("search-card-series-tmdb:1396")).toBeInTheDocument();
    expect(tmdbAsks(host.invocations).at(-1)).toEqual({
      type: "search",
      query: "matrix",
      kind: "movie",
      page: 2,
    });
    expect(
      tmdbAsks(host.invocations).filter((action) => action.kind === "series"),
      "paging Movies does not move the Series row",
    ).toHaveLength(1);

    const seriesRow = screen.getByTestId("search-row-series");
    fireEvent.click(within(seriesRow).getByRole("button", { name: "More" }));

    expect(await screen.findByTestId("search-card-series-tmdb:1397")).toHaveTextContent(
      "Better Call Saul",
    );
    expect(tmdbAsks(host.invocations).at(-1)).toEqual({
      type: "search",
      query: "matrix",
      kind: "series",
      page: 2,
    });
    expect(screen.getByTestId("search-card-movie-tmdb:604")).toBeInTheDocument();
    expect(screen.getByTestId("search-card-series-tmdb:1396")).toBeInTheDocument();
  });

  test("a page that answered only unreadable items still leaves a way to page on", async () => {
    const host = fakeHost(snapshot(), {
      search: (action) => {
        if (action.kind === "series") {
          return searchRow([SERIES_META], { type: "series" });
        }
        if (action.page === 1) {
          // The Addon put four items in the page and the Host could read none.
          return searchRow([], { type: "movie", sent: 4 });
        }
        return searchRow([MOVIE_META], { type: "movie" });
      },
    });
    const form = await openSearch(host);
    submitQuery(form, "matrix");
    await screen.findByTestId("search-card-series-tmdb:1396");

    const movieRow = screen.getByTestId("search-row-movie");
    const more = await within(movieRow).findByRole("button", { name: "More" });
    expect(
      screen.queryByTestId("search-empty-movie"),
      "a page the Host read nothing from is not the end of the row",
    ).not.toBeInTheDocument();

    fireEvent.click(more);

    expect(await screen.findByTestId("search-card-movie-tmdb:603")).toBeInTheDocument();
    expect(tmdbAsks(host.invocations).at(-1)).toEqual({
      type: "search",
      query: "matrix",
      kind: "movie",
      page: 2,
    });
  });

  test("a failed page says why in its row, keeps its cards, and is asked again", async () => {
    let failing = true;
    const RELOADED = { ...MOVIE_META, id: "tmdb:604", name: "The Matrix Reloaded" };
    const host = fakeHost(snapshot(), {
      search: (action) => {
        if (action.kind === "series") {
          return searchRow([SERIES_META], { type: "series" });
        }
        if (action.page === 2 && failing) {
          return searchRow([], {
            type: "movie",
            failure: { kind: "tmdb", detail: "TMDB answered with status 429" },
          });
        }
        return searchRow([action.page === 1 ? MOVIE_META : RELOADED], { type: "movie" });
      },
    });
    const form = await openSearch(host);
    submitQuery(form, "matrix");
    await screen.findByTestId("search-card-movie-tmdb:603");
    await screen.findByTestId("search-card-series-tmdb:1396");

    const movieRow = screen.getByTestId("search-row-movie");
    fireEvent.click(within(movieRow).getByRole("button", { name: "More" }));

    const failure = await screen.findByTestId("search-failure-movie");
    expect(failure).toHaveAttribute("role", "alert");
    expect(failure).toHaveTextContent("TMDB did not answer");
    expect(failure).toHaveTextContent("status 429");
    expect(screen.getByTestId("search-card-movie-tmdb:603")).toBeInTheDocument();
    expect(screen.getByTestId("search-card-series-tmdb:1396")).toBeInTheDocument();
    expect(
      screen.queryByTestId("search-failure-series"),
      "one row's failure is not another row's",
    ).not.toBeInTheDocument();

    failing = false;
    fireEvent.click(within(movieRow).getByRole("button", { name: "More" }));

    expect(await screen.findByTestId("search-card-movie-tmdb:604")).toBeInTheDocument();
    expect(screen.queryByTestId("search-failure-movie")).not.toBeInTheDocument();
    expect(tmdbAsks(host.invocations).at(-1)).toEqual({
      type: "search",
      query: "matrix",
      kind: "movie",
      page: 2,
    });
  });

  test("one failed row does not blank the other", async () => {
    const host = fakeHost(snapshot(), {
      search: (action) =>
        action.kind === "movie"
          ? searchRow([], {
              type: "movie",
              failure: { kind: "tmdb", detail: "TMDB answered with status 429" },
            })
          : searchRow([SERIES_META], { type: "series" }),
    });
    const form = await openSearch(host);
    submitQuery(form, "matrix");

    expect(await screen.findByTestId("search-failure-movie")).toHaveTextContent("status 429");
    expect(await screen.findByTestId("search-card-series-tmdb:1396")).toHaveTextContent(
      "Breaking Bad",
    );
  });

  test("pre-marks a hit unplayable when no Addon can answer for its Streams", async () => {
    const host = fakeHost(snapshot({ addons: [CATALOG_ONLY] }));
    const form = await openSearch(host);
    submitQuery(form, "matrix");

    const card = await screen.findByTestId("search-card-movie-tmdb:603");
    expect(card).toHaveAttribute("data-unplayable", "true");
    expect(card).toHaveTextContent("Unplayable");
  });

  test("leaves a hit playable when an Addon can answer for its Streams", async () => {
    const host = fakeHost(snapshot({ addons: [CINEMETA] }));
    const form = await openSearch(host);
    submitQuery(form, "matrix");

    const card = await screen.findByTestId("search-card-movie-tmdb:603");
    expect(card).not.toHaveAttribute("data-unplayable");
    expect(card).not.toHaveTextContent("Unplayable");
  });

  test("opens a hit as a Discovered Title, not through an Addon", async () => {
    const host = fakeHost(snapshot());
    const form = await openSearch(host);
    submitQuery(form, "matrix");

    fireEvent.click(await screen.findByTestId("search-card-movie-tmdb:603"));

    expect(await screen.findByTestId("title-tmdb:603")).toHaveTextContent("The Matrix");
    expect(actions(host.invocations)).toContainEqual({
      type: "open_discovered_title",
      key: { kind: "tmdb", id: 603 },
      kind: "movie",
    });
    expect(
      actions(host.invocations).some((action) => action.type === "open_title"),
    ).toBe(false);
  });

  test("Left and Right stay with the caret inside the query field", async () => {
    const host = fakeHost(snapshot());
    const form = await openSearch(host);
    const input = within(form).getByLabelText("Search for a Title") as HTMLInputElement;
    const submit = within(form).getByRole("button", { name: "Search" });

    const measured = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this === input) {
          return rect(200, 100, 1000, 56);
        }
        if (this === submit) {
          return rect(1030, 112, 150, 40);
        }
        return rect(0, 0, 0, 0);
      });

    input.focus();
    expect(
      fireEvent.keyDown(input, { key: "ArrowRight" }),
      "the field keeps the key for the caret",
    ).toBe(true);
    expect(document.activeElement).toBe(input);
    expect(
      fireEvent.keyDown(input, { key: "ArrowLeft" }),
      "the field keeps the key for the caret",
    ).toBe(true);
    expect(document.activeElement).toBe(input);

    measured.mockRestore();
  });

  test("Down from the wide search bar lands on the first card of the first row", async () => {
    const host = fakeHost(snapshot());
    const form = await openSearch(host);
    const input = submitQuery(form, "matrix");
    const firstMovie = await screen.findByTestId("search-card-movie-tmdb:603");
    const firstSeries = await screen.findByTestId("search-card-series-tmdb:1396");
    const movieRow = screen.getByTestId("search-row-movie");
    const seriesRow = screen.getByTestId("search-row-series");

    const measured = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this === input) {
          return rect(200, 100, 1000, 56);
        }
        if (this === firstMovie) {
          return rect(212, 260, 180, 270);
        }
        if (this === firstSeries) {
          return rect(212, 640, 180, 270);
        }
        if (this === movieRow) {
          return rect(200, 240, 1000, 380);
        }
        if (this === seriesRow) {
          return rect(200, 620, 1000, 380);
        }
        return rect(0, 0, 0, 0);
      });

    input.focus();
    fireEvent.keyDown(input, { key: "ArrowDown" });

    await waitFor(() => expect(document.activeElement).toBe(firstMovie));

    const submit = within(form).getByRole("button", { name: "Search" });
    submit.focus();
    fireEvent.keyDown(submit, { key: "ArrowDown" });

    await waitFor(() => expect(document.activeElement).toBe(firstMovie));

    measured.mockRestore();
  });
});

describe("Search without a TMDB key", () => {
  test("submitting asks every Catalog once and draws them in the Host's order", async () => {
    const host = fakeHost(keylessSnapshot({ addons: [SEARCHABLE] }), {
      catalogs: () => [
        catalogRow(SEARCHABLE.id, "movie", "films", "Films", [
          { ...MOVIE_META, id: "tt0133093" },
        ]),
        catalogRow(SEARCHABLE.id, "series", "shows", "Shows", [
          { ...SERIES_META, id: "tt0903747" },
        ]),
      ],
    });
    const form = await openSearch(host);

    submitQuery(form, "matrix");

    expect(
      await screen.findByTestId(`search-card-${SEARCHABLE.id}-tt0133093`),
    ).toHaveTextContent("The Matrix");
    expect(
      await screen.findByTestId(`search-card-${SEARCHABLE.id}-tt0903747`),
    ).toHaveTextContent("Breaking Bad");

    expect(catalogSearchAsks(host.invocations)).toEqual([
      { type: "search_catalogs", query: "matrix" },
    ]);
    expect(
      tmdbAsks(host.invocations),
      "the keyless arm never asks TMDB",
    ).toEqual([]);
    expect(
      within(screen.getByTestId("search-catalogs"))
        .getAllByRole("heading", { level: 2 })
        .map((heading) => heading.textContent),
    ).toEqual(["Films", "Shows"]);
    expect(
      screen.getByTestId(`search-row-${SEARCHABLE.id}/series/shows`),
    ).toHaveTextContent("Searchable");
  });

  test("a failed Catalog says why in its own row without blanking another", async () => {
    const host = fakeHost(keylessSnapshot({ addons: [SEARCHABLE] }), {
      catalogs: () => [
        catalogRow(SEARCHABLE.id, "movie", "films", "Films", [
          { ...MOVIE_META, id: "tt0133093" },
        ]),
        catalogRow(SEARCHABLE.id, "series", "shows", "Shows", [], {
          failure: { kind: "fetch", detail: "the Addon answered with status 503" },
        }),
      ],
    });
    const form = await openSearch(host);

    submitQuery(form, "matrix");

    const shows = await screen.findByTestId(
      `search-row-${SEARCHABLE.id}/series/shows`,
    );
    const failure = within(shows).getByRole("alert");
    expect(failure).toHaveTextContent("The Host could not fetch that Addon");
    expect(failure).toHaveTextContent("status 503");
    expect(
      await screen.findByTestId(`search-card-${SEARCHABLE.id}-tt0133093`),
    ).toBeInTheDocument();
  });

  test("a Catalog that sent only unreadable items is not called empty", async () => {
    const key = `${SEARCHABLE.id}/movie/films`;
    const host = fakeHost(keylessSnapshot({ addons: [SEARCHABLE] }), {
      catalogs: () => [
        catalogRow(SEARCHABLE.id, "movie", "films", "Films", [], { sent: 3 }),
      ],
    });
    const form = await openSearch(host);

    submitQuery(form, "matrix");

    const row = await screen.findByTestId(`search-row-${key}`);
    expect(within(row).getByTestId(`search-catalog-unreadable-${key}`)).toHaveTextContent(
      "This Catalog sent items the Host could not read.",
    );
    expect(within(row).queryByTestId(`search-catalog-empty-${key}`)).not.toBeInTheDocument();
  });

  test("opening a hit asks its Catalog's Addon for the Title", async () => {
    const host = fakeHost(keylessSnapshot({ addons: [SEARCHABLE] }), {
      catalogs: () => [
        catalogRow(SEARCHABLE.id, "movie", "films", "Films", [
          { ...MOVIE_META, id: "tt0133093" },
        ]),
      ],
      title: MATRIX_ADDON,
    });
    const form = await openSearch(host);
    submitQuery(form, "matrix");

    fireEvent.click(await screen.findByTestId(`search-card-${SEARCHABLE.id}-tt0133093`));

    expect(await screen.findByTestId("title-tt0133093")).toHaveTextContent("The Matrix");
    expect(actions(host.invocations)).toContainEqual({
      type: "open_title",
      addon: SEARCHABLE.id,
      title: { type: "movie", id: "tt0133093" },
    });
    expect(
      actions(host.invocations).some(
        (action) => action.type === "open_discovered_title",
      ),
    ).toBe(false);
  });

  test("an answer with no rows says so instead of inventing a row", async () => {
    const host = fakeHost(keylessSnapshot({ addons: [CINEMETA] }), {
      catalogs: () => [],
    });
    const form = await openSearch(host);

    submitQuery(form, "matrix");

    expect(await screen.findByTestId("search-no-answer")).toHaveTextContent(
      "No Addon offers a Catalog that can be searched.",
    );
    expect(catalogSearchAsks(host.invocations)).toEqual([
      { type: "search_catalogs", query: "matrix" },
    ]);
  });
});

describe("the Search query bar", () => {
  test("will not send a blank query", async () => {
    const host = fakeHost(snapshot());
    const form = await openSearch(host);
    const input = within(form).getByLabelText("Search for a Title") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "   " } });
    expect(within(form).getByRole("button", { name: "Search" })).toBeDisabled();

    fireEvent.submit(form);
    expect(actions(host.invocations)).toEqual([]);
  });
});

describe("the two arms are key-gated by the Snapshot", () => {
  test("a key held draws the TMDB arm", async () => {
    const host = fakeHost(snapshot());
    await openSearch(host);
    expect(screen.getByTestId("search-screen")).toHaveTextContent("TMDB");
  });

  test("no key held draws the Addon arm", async () => {
    const host = fakeHost(keylessSnapshot({ addons: [SEARCHABLE] }));
    await openSearch(host);
    expect(screen.getByTestId("search-lede")).toHaveTextContent("Addon");
  });
});
