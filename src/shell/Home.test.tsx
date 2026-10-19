import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  HostClient,
  type Action,
  type ActionError,
  type AddonManifest,
  type CatalogRow,
  type MetaPreview,
  type ResumeEntry,
  type Snapshot,
  type Title,
  type Transport,
} from "../host-client";
import { HomeHero } from "./HomeHero";
import { Shell } from "./Shell";
import type { HeroSlide } from "./home";

const NOTHING_SAID: Snapshot = {
  revision: 0,
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
  preferences: { subtitleLanguage: null },
  addons: [],
  featuredCatalog: null,
  protection: { backend: "keyring", tmdbHeld: false, stremioHeld: false },
  watchProgress: [],
  devices: [],
  pairingCode: "4K7Q2M",
  address: "192.168.1.9:8090",
};

const CINEMETA: AddonManifest = {
  id: "com.linvo.cinemeta",
  name: "Cinemeta",
  version: "3.0.0",
  resources: [
    { name: "catalog", types: null, idPrefixes: null },
    { name: "meta", types: ["movie", "series"], idPrefixes: ["tt"] },
  ],
  types: ["movie", "series"],
  catalogs: [
    {
      type: "movie",
      id: "top",
      name: "Top",
      extra: [{ name: "skip", isRequired: false, options: [], optionsLimit: 1 }],
    },
    {
      type: "movie",
      id: "featured",
      name: "Featured this week",
      extra: [{ name: "skip", isRequired: false, options: [], optionsLimit: 1 }],
    },
  ],
  idPrefixes: ["tt"],
  behaviorHints: { configurable: false, configurationRequired: false },
};

const STREMBOX: AddonManifest = {
  ...CINEMETA,
  id: "community.stremboxd",
  name: "Stremboxd",
  catalogs: [
    {
      type: "movie",
      id: "letterboxd-popular",
      name: "Popular This Week",
      extra: [{ name: "skip", isRequired: false, options: [], optionsLimit: 1 }],
    },
  ],
};

function meta(overrides: Partial<MetaPreview> = {}): MetaPreview {
  return {
    id: "tt0133093",
    type: "movie",
    name: "The Matrix",
    poster: "https://images.test/matrix-poster.jpg",
    posterShape: null,
    background: null,
    releaseInfo: "1999",
    imdbRating: "8.7",
    genres: [],
    description: "A hacker learns the truth.",
    ...overrides,
  };
}

const FEATURED = [
  meta({
    id: "tt0133093",
    name: "The Matrix",
    background: "https://images.test/matrix-backdrop.jpg",
  }),
  meta({
    id: "tt0234215",
    name: "The Matrix Reloaded",
    poster: "https://images.test/reloaded-landscape.jpg",
    posterShape: "landscape",
  }),
  meta({
    id: "tt0242653",
    name: "The Matrix Revolutions",
    posterShape: "poster",
  }),
];

const TOP = [
  meta({
    id: "tt0111161",
    name: "The Shawshank Redemption",
    poster: "https://images.test/shawshank-poster.jpg",
    releaseInfo: "1994",
  }),
  meta({
    id: "tt0068646",
    name: "The Godfather",
    releaseInfo: "1972",
    description: "The.Godfather.1972.2160p.BluRay.x265-GROUP.mkv",
  }),
];

const TOP_MORE = [meta({ id: "tt0071562", name: "The Godfather Part II", releaseInfo: "1974" })];

type CatalogAnswer = {
  addon: string;
  type: string;
  id: string;
  name: string;
  pages: MetaPreview[][];
  failure?: ActionError;
};

function catalogRow(
  { addon, type, id, name }: Omit<CatalogAnswer, "pages" | "failure">,
  page: number,
  catalogAnswer: CatalogAnswer,
): CatalogRow {
  if (page > 0 && catalogAnswer.failure) {
    return {
      addon,
      type,
      id,
      name,
      sent: 0,
      metas: [],
      failure: catalogAnswer.failure,
    };
  }
  const metas = catalogAnswer.pages[page] ?? [];
  return {
    addon,
    type,
    id,
    name,
    sent: metas.length,
    metas,
    failure: page === 0 ? (catalogAnswer.failure ?? null) : null,
  };
}

/** Which page a `skip` offset starts, from the pages already sent. */
function pageAt(pages: readonly MetaPreview[][], offset: number): number {
  let seen = 0;
  for (let page = 0; page < pages.length; page += 1) {
    if (seen === offset) {
      return page;
    }
    seen += pages[page]?.length ?? 0;
  }
  return pages.length;
}

type Invocation = { command: string; args?: Record<string, unknown> };

function fakeHost(
  initial: Snapshot,
  catalogs: CatalogAnswer[],
  opening?: Title,
  hold?: string,
  holdOpen = false,
) {
  const invocations: Invocation[] = [];
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let releaseOpen = () => {};
  const openGate = new Promise<void>((resolve) => {
    releaseOpen = resolve;
  });
  const transport: Transport = {
    invoke: async <T,>(command: string, args?: Record<string, unknown>): Promise<T> => {
      invocations.push({ command, args });
      if (command === "snapshot") {
        return initial as T;
      }

      const action = (args?.envelope as { action: Action }).action;
      if (action.type === "browse_catalog") {
        if (
          hold === `${action.addon}/${action.catalog.type}/${action.catalog.id}`
        ) {
          await gate;
        }
        const catalogAnswer = catalogs.find(
          (held) =>
            held.addon === action.addon &&
            held.type === action.catalog.type &&
            held.id === action.catalog.id,
        );
        if (!catalogAnswer) {
          throw { kind: "unknown_catalog", addon: action.addon, catalog: action.catalog };
        }
        const skip = action.extra.find((extra) => extra.name === "skip");
        const offset = skip ? Number(skip.value) : 0;
        const page = pageAt(catalogAnswer.pages, offset);
        return {
          snapshots: [],
          answer: {
            catalogs: [
              catalogRow(
                {
                  addon: catalogAnswer.addon,
                  type: catalogAnswer.type,
                  id: catalogAnswer.id,
                  name: catalogAnswer.name,
                },
                page,
                catalogAnswer,
              ),
            ],
          },
        } as T;
      }

      if (action.type === "open_title" && opening) {
        if (holdOpen) {
          await openGate;
        }
        return { snapshots: [], answer: { title: opening } } as T;
      }

      return { snapshots: [], answer: null } as T;
    },
    listen: async () => () => {},
  };

  return { client: new HostClient(transport), invocations, release, releaseOpen };
}

function actions(invocations: Invocation[]): Action[] {
  return invocations
    .filter(({ command }) => command === "dispatch")
    .map(({ args }) => (args?.envelope as { action: Action }).action);
}

function browseAction(addon: string, catalog: { type: string; id: string }, skip?: string): Action {
  return {
    type: "browse_catalog",
    addon,
    catalog,
    extra: skip === undefined ? [] : [{ name: "skip", value: skip }],
  };
}

function resumeEntry(overrides: Partial<ResumeEntry> = {}): ResumeEntry {
  return {
    video: { id: "tt0133093", name: null, season: null, episode: null, thumbnail: null },
    title: {
      addon: CINEMETA.id,
      id: "tt0133093",
      type: "movie",
      name: "The Matrix",
      poster: "https://images.test/matrix-poster.jpg",
      background: "https://images.test/matrix-backdrop.jpg",
    },
    position: 1284,
    duration: 8160,
    watched: false,
    unplayable: null,
    ...overrides,
  };
}

function homeSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    ...NOTHING_SAID,
    revision: 3,
    addons: [CINEMETA, STREMBOX],
    featuredCatalog: {
      addon: CINEMETA.id,
      catalog: { type: "movie", id: "featured" },
    },
    ...overrides,
  };
}

const FEATURED_CATALOGUE: CatalogAnswer = {
  addon: CINEMETA.id,
  type: "movie",
  id: "featured",
  name: "Featured this week",
  pages: [FEATURED],
};

const TOP_CATALOGUE: CatalogAnswer = {
  addon: CINEMETA.id,
  type: "movie",
  id: "top",
  name: "Top",
  pages: [TOP, TOP_MORE],
};

const POPULAR_CATALOGUE: CatalogAnswer = {
  addon: STREMBOX.id,
  type: "movie",
  id: "letterboxd-popular",
  name: "Popular This Week",
  pages: [[meta({ id: "tt0102926", name: "The Silence of the Lambs" })]],
};

describe("Home", () => {
  test("draws the Featured catalog's row as a hero without opening any Title", async () => {
    const host = fakeHost(homeSnapshot(), [FEATURED_CATALOGUE, TOP_CATALOGUE, POPULAR_CATALOGUE]);
    render(<Shell client={host.client} />);

    const hero = await screen.findByTestId("home-hero");
    expect(hero).toHaveTextContent("The Matrix");
    expect(hero.querySelector("img")).toHaveAttribute(
      "src",
      "https://images.test/matrix-backdrop.jpg",
    );

    // The hero is drawn from the same browse the row already needs: one ask per
    // declared Catalog, and never an `open_title` to paint Home.
    expect(actions(host.invocations)).toEqual(
      expect.arrayContaining([
        browseAction(CINEMETA.id, { type: "movie", id: "featured" }),
        browseAction(CINEMETA.id, { type: "movie", id: "top" }),
        browseAction(STREMBOX.id, { type: "movie", id: "letterboxd-popular" }),
      ]),
    );
    expect(actions(host.invocations).filter((action) => action.type === "browse_catalog")).toHaveLength(3);
    expect(actions(host.invocations).some((action) => action.type === "open_title")).toBe(false);
  });

  test("lays the Catalog rows down in the configured Addons' order", async () => {
    const host = fakeHost(homeSnapshot(), [FEATURED_CATALOGUE, TOP_CATALOGUE, POPULAR_CATALOGUE]);
    render(<Shell client={host.client} />);

    await screen.findByText("The Silence of the Lambs");
    expect(screen.getAllByTestId(/^row-/).map((row) => row.getAttribute("data-testid"))).toEqual([
      `row-${CINEMETA.id}/movie/top`,
      `row-${CINEMETA.id}/movie/featured`,
      `row-${STREMBOX.id}/movie/letterboxd-popular`,
    ]);
  });

  test("focus starts on the hero, and Left/Right step its slides before OK opens the Title", async () => {
    const opened: Title = {
      addon: CINEMETA.id,
      id: "tt0234215",
      key: { kind: "addon", addon: CINEMETA.id, id: "tt0234215" },
      type: "movie",
      name: "The Matrix Reloaded",
      poster: null,
      background: null,
      logo: null,
      description: "The second film.",
      releaseInfo: "2003",
      runtime: "138 min",
      imdbRating: "7.2",
      genres: ["Action"],
      videos: [],
    };
    const host = fakeHost(homeSnapshot(), [FEATURED_CATALOGUE, TOP_CATALOGUE, POPULAR_CATALOGUE], opened);
    render(<Shell client={host.client} />);

    const hero = await screen.findByTestId("home-hero");
    await waitFor(() => expect(document.activeElement).toBe(hero));

    fireEvent.keyDown(hero, { key: "ArrowRight" });
    expect(hero).toHaveTextContent("The Matrix Reloaded");
    expect(hero.querySelector("img")).toHaveAttribute(
      "src",
      "https://images.test/reloaded-landscape.jpg",
    );

    fireEvent.keyDown(hero, { key: "ArrowRight" });
    expect(hero).toHaveTextContent("The Matrix Revolutions");
    expect(hero.querySelector("img"), "a 2:3 poster is not stretched into the hero").toBeNull();

    fireEvent.keyDown(hero, { key: "ArrowLeft" });
    expect(hero).toHaveTextContent("The Matrix Reloaded");

    fireEvent.click(hero);

    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({
        type: "open_title",
        addon: CINEMETA.id,
        title: { type: "movie", id: "tt0234215" },
      }),
    );
    expect(await screen.findByTestId("title-level")).toHaveTextContent("The Matrix Reloaded");
  });

  test("Continue watching is the first row when there is no hero", async () => {
    const host = fakeHost(
      homeSnapshot({ featuredCatalog: null, watchProgress: [resumeEntry()] }),
      [FEATURED_CATALOGUE, TOP_CATALOGUE, POPULAR_CATALOGUE],
    );
    render(<Shell client={host.client} />);

    const resume = await screen.findByTestId("resume-tt0133093");
    expect(screen.queryByTestId("home-hero")).not.toBeInTheDocument();
    expect(resume.querySelector("img")).toHaveAttribute(
      "src",
      "https://images.test/matrix-backdrop.jpg",
    );
    expect(screen.getByTestId("resume-tt0133093-progress").firstElementChild).toHaveStyle({
      width: "16%",
    });

    const continueRow = screen.getByRole("region", { name: "Continue watching" });
    const catalogRowNode = await screen.findByRole("region", { name: "Featured this week" });
    expect(continueRow.compareDocumentPosition(catalogRowNode)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  test("Continue watching follows the Host's most-recent order", async () => {
    const godfather = resumeEntry({
      video: { id: "tt0068646", name: null, season: null, episode: null, thumbnail: null },
      title: {
        addon: CINEMETA.id,
        id: "tt0068646",
        type: "movie",
        name: "The Godfather",
        poster: null,
        background: null,
      },
    });
    const host = fakeHost(
      homeSnapshot({ featuredCatalog: null, watchProgress: [godfather, resumeEntry()] }),
      [FEATURED_CATALOGUE, TOP_CATALOGUE, POPULAR_CATALOGUE],
    );
    render(<Shell client={host.client} />);

    const row = await screen.findByRole("region", { name: "Continue watching" });
    await within(row).findByTestId("resume-tt0133093");
    expect(within(row).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      expect.stringContaining("The Godfather"),
      expect.stringContaining("The Matrix"),
    ]);
  });

  test("Continue watching marks a removed Addon, and a press resumes the Video", async () => {
    const unplayable = resumeEntry({
      video: { id: "tt0903747:1:2", name: "Cat's in the Bag...", season: 1, episode: 2, thumbnail: null },
      title: {
        addon: "community.gone",
        id: "tt0903747",
        type: "series",
        name: "Breaking Bad",
        poster: null,
        background: null,
      },
      unplayable: { reason: "addon_removed", addon: "community.gone" },
    });
    const host = fakeHost(
      homeSnapshot({
        featuredCatalog: null,
        watchProgress: [resumeEntry(), unplayable],
      }),
      [FEATURED_CATALOGUE, TOP_CATALOGUE, POPULAR_CATALOGUE],
    );
    render(<Shell client={host.client} />);

    const card = await screen.findByTestId("resume-tt0903747:1:2");
    expect(card).toBeDisabled();
    expect(card).toHaveAttribute("data-unplayable", "true");
    expect(card).toHaveTextContent("Unplayable");

    fireEvent.click(screen.getByTestId("resume-tt0133093"));

    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({
        type: "resume",
        video: { type: "movie", id: "tt0133093" },
      }),
    );
  });

  test("one Catalog row can page with More without losing what it holds", async () => {
    const host = fakeHost(homeSnapshot(), [FEATURED_CATALOGUE, TOP_CATALOGUE, POPULAR_CATALOGUE]);
    render(<Shell client={host.client} />);

    const row = await screen.findByRole("region", { name: "Top" });
    expect(within(row).getByText("The Shawshank Redemption")).toBeInTheDocument();
    fireEvent.click(within(row).getByRole("button", { name: "More" }));

    expect(await within(row).findByText("The Godfather Part II")).toBeInTheDocument();
    expect(within(row).getByText("The Shawshank Redemption")).toBeInTheDocument();
    expect(within(row).getByText("The Godfather")).toBeInTheDocument();
    expect(actions(host.invocations)).toContainEqual(
      browseAction(CINEMETA.id, { type: "movie", id: "top" }, "2"),
    );
    expect(
      within(row).getByTitle("The.Godfather.1972.2160p.BluRay.x265-GROUP.mkv"),
    ).toHaveClass("kit-poster-note");
  });

  test("a failed Catalog says so in its own row without blanking the rest of Home", async () => {
    const failing: CatalogAnswer = {
      ...TOP_CATALOGUE,
      failure: { kind: "catalog", detail: "the Addon answered a web page" },
    };
    const host = fakeHost(homeSnapshot(), [FEATURED_CATALOGUE, failing, POPULAR_CATALOGUE]);
    render(<Shell client={host.client} />);

    const alert = await screen.findByText(/could not read that Addon's catalog/);
    expect(alert).toBeInTheDocument();
    expect(screen.getByTestId("home-hero")).toHaveTextContent("The Matrix");
    expect(await screen.findByText("The Silence of the Lambs")).toBeInTheDocument();
  });

  test("with no Addons, Home says so and points at the Addons destination", async () => {
    const host = fakeHost({ ...NOTHING_SAID, revision: 1 }, []);
    render(<Shell client={host.client} />);

    const empty = await screen.findByTestId("home-empty");
    expect(empty).toHaveTextContent("No Addons are configured");
    expect(screen.queryByTestId("home-hero")).not.toBeInTheDocument();

    fireEvent.click(within(empty).getByRole("button", { name: "Open Addons" }));
    expect(await screen.findByRole("heading", { name: "Addons" })).toBeInTheDocument();
  });

  test("with Addons that offer no Catalogs, Home points at Addons too", async () => {
    const offerings: AddonManifest = { ...CINEMETA, catalogs: [] };
    const host = fakeHost(
      { ...NOTHING_SAID, revision: 1, addons: [offerings] },
      [],
    );
    render(<Shell client={host.client} />);

    const empty = await screen.findByTestId("home-empty");
    expect(empty).toHaveTextContent("No Catalogs are configured");
    expect(within(empty).getByRole("button", { name: "Open Addons" })).toBeInTheDocument();
  });

  test("with nothing on Home, launch focus stays on the rail's Home entry", async () => {
    const host = fakeHost({ ...NOTHING_SAID, revision: 1 }, []);
    render(<Shell client={host.client} />);

    await screen.findByTestId("home-empty");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Home" }));
  });

  test("launch focus waits for a pending Featured row before choosing Continue watching", async () => {
    const host = fakeHost(
      homeSnapshot({ watchProgress: [resumeEntry()] }),
      [FEATURED_CATALOGUE, TOP_CATALOGUE, POPULAR_CATALOGUE],
      undefined,
      `${CINEMETA.id}/movie/featured`,
    );
    render(<Shell client={host.client} />);

    const card = await screen.findByTestId("resume-tt0133093");
    expect(document.activeElement, "the hero has not answered yet").not.toBe(card);

    act(() => host.release());

    const hero = await screen.findByTestId("home-hero");
    await waitFor(() => expect(document.activeElement).toBe(hero));
  });

  test("with no hero, launch focus lands on the first card of the first row", async () => {
    const host = fakeHost(homeSnapshot({ featuredCatalog: null }), [
      FEATURED_CATALOGUE,
      TOP_CATALOGUE,
      POPULAR_CATALOGUE,
    ]);
    render(<Shell client={host.client} />);

    const card = await screen.findByRole("button", { name: /The Shawshank Redemption/ });
    await waitFor(() => expect(document.activeElement).toBe(card));
  });

  test("a Featured catalog with no items has no hero at all", async () => {
    const emptyFeatured: CatalogAnswer = { ...FEATURED_CATALOGUE, pages: [[]] };
    const host = fakeHost(homeSnapshot(), [emptyFeatured, TOP_CATALOGUE, POPULAR_CATALOGUE]);
    render(<Shell client={host.client} />);

    expect(await screen.findByText("The Shawshank Redemption")).toBeInTheDocument();
    expect(screen.queryByTestId("home-hero")).not.toBeInTheDocument();
  });

  test("a sparse Title answer falls back to the card that opened it", async () => {
    const sparse: Title = {
      addon: CINEMETA.id,
      id: "tt0111161",
      key: { kind: "addon", addon: CINEMETA.id, id: "tt0111161" },
      type: "movie",
      name: "tt0111161",
      poster: null,
      background: null,
      logo: null,
      description: null,
      releaseInfo: null,
      runtime: null,
      imdbRating: null,
      genres: [],
      videos: [],
    };
    const host = fakeHost(
      homeSnapshot({ featuredCatalog: null }),
      [FEATURED_CATALOGUE, TOP_CATALOGUE, POPULAR_CATALOGUE],
      sparse,
    );
    render(<Shell client={host.client} />);

    fireEvent.click(await screen.findByRole("button", { name: /The Shawshank Redemption/ }));

    const level = await screen.findByTestId("title-level");
    expect(within(level).getByRole("heading", { name: "The Shawshank Redemption" })).toBeInTheDocument();
    expect(level.querySelector("img")).toHaveAttribute("src", "https://images.test/shawshank-poster.jpg");
  });

  test("a text hero slide keeps its portrait poster for the Title it opens", async () => {
    const sparse: Title = {
      addon: CINEMETA.id,
      id: "tt0242653",
      key: { kind: "addon", addon: CINEMETA.id, id: "tt0242653" },
      type: "movie",
      name: "tt0242653",
      poster: null,
      background: null,
      logo: null,
      description: null,
      releaseInfo: null,
      runtime: null,
      imdbRating: null,
      genres: [],
      videos: [],
    };
    const host = fakeHost(
      homeSnapshot(),
      [FEATURED_CATALOGUE, TOP_CATALOGUE, POPULAR_CATALOGUE],
      sparse,
    );
    render(<Shell client={host.client} />);

    const hero = await screen.findByTestId("home-hero");
    fireEvent.keyDown(hero, { key: "ArrowRight" });
    fireEvent.keyDown(hero, { key: "ArrowRight" });
    fireEvent.click(hero);

    const level = await screen.findByTestId("title-level");
    expect(level.querySelector("img"), "the catalog item's portrait poster").toHaveAttribute(
      "src",
      "https://images.test/matrix-poster.jpg",
    );
  });

  test("a double Activate opens one Title, not two levels", async () => {
    const opened: Title = {
      addon: CINEMETA.id,
      id: "tt0133093",
      key: { kind: "addon", addon: CINEMETA.id, id: "tt0133093" },
      type: "movie",
      name: "The Matrix",
      poster: null,
      background: null,
      logo: null,
      description: null,
      releaseInfo: null,
      runtime: null,
      imdbRating: null,
      genres: [],
      videos: [],
    };
    const host = fakeHost(
      homeSnapshot(),
      [FEATURED_CATALOGUE, TOP_CATALOGUE, POPULAR_CATALOGUE],
      opened,
      undefined,
      true,
    );
    render(<Shell client={host.client} />);

    const hero = await screen.findByTestId("home-hero");
    fireEvent.click(hero);
    fireEvent.click(hero);

    expect(
      actions(host.invocations).filter((action) => action.type === "open_title"),
    ).toHaveLength(1);

    act(() => host.releaseOpen());
    await screen.findByTestId("title-level");
    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() =>
      expect(screen.queryByTestId("title-level")).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("home-hero")).toBeInTheDocument();
  });

  test("Left on slide 1 is left to the focus engine, which crosses into the rail", async () => {
    const host = fakeHost(homeSnapshot(), [FEATURED_CATALOGUE, TOP_CATALOGUE, POPULAR_CATALOGUE]);
    render(<Shell client={host.client} />);

    const hero = await screen.findByTestId("home-hero");
    await waitFor(() => expect(document.activeElement).toBe(hero));

    const rail = screen.getByRole("navigation", { name: "Destinations" });
    const railItems = within(rail).getAllByRole("button");
    const rect = (x: number, y: number, w: number, h: number) => ({
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
    });
    const measured = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this === rail) {
          return rect(18, 18, 92, 1000);
        }
        const at = railItems.indexOf(this as HTMLButtonElement);
        if (at >= 0) {
          return rect(18, 26 + at * 60, 92, 44);
        }
        if (this === hero) {
          return rect(160, 120, 1200, 420);
        }
        return rect(0, 0, 0, 0);
      });

    fireEvent.keyDown(hero, { key: "ArrowLeft" });

    await waitFor(() => expect(rail).toContainElement(document.activeElement as HTMLElement));
    measured.mockRestore();
  });
});

const SLIDES: HeroSlide[] = [
  {
    id: "tt1",
    type: "movie",
    name: "First",
    description: "The first slide.",
    art: "https://images.test/first.jpg",
    artKind: "background",
    poster: "https://images.test/first-poster.jpg",
    background: "https://images.test/first.jpg",
  },
  {
    id: "tt2",
    type: "movie",
    name: "Second",
    description: "The second slide.",
    art: null,
    artKind: "text",
    poster: "https://images.test/second-poster.jpg",
    background: null,
  },
];

describe("the Home hero", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test("rotates every six seconds while unfocused, and holds the moment it is focused", () => {
    render(<HomeHero slides={SLIDES} catalogName="Featured" onOpen={() => {}} />);
    const hero = screen.getByTestId("home-hero");

    expect(hero).toHaveTextContent("First");
    act(() => vi.advanceTimersByTime(6000));
    expect(hero).toHaveTextContent("Second");

    fireEvent.focus(hero);
    act(() => vi.advanceTimersByTime(6000));
    expect(hero).toHaveTextContent("Second");

    fireEvent.blur(hero);
    act(() => vi.advanceTimersByTime(6000));
    expect(hero).toHaveTextContent("First");
  });

  test("a manual step restarts the six seconds rather than inheriting the old timer", () => {
    const slides: HeroSlide[] = [
      ...SLIDES,
      {
        id: "tt3",
        type: "movie",
        name: "Third",
        description: "The third slide.",
        art: null,
        artKind: "text",
        poster: "https://images.test/third-poster.jpg",
        background: null,
      },
    ];
    render(<HomeHero slides={slides} catalogName="Featured" onOpen={() => {}} />);
    const hero = screen.getByTestId("home-hero");

    act(() => vi.advanceTimersByTime(5000));
    fireEvent.keyDown(hero, { key: "ArrowRight" });
    expect(hero).toHaveTextContent("Second");

    act(() => vi.advanceTimersByTime(5999));
    expect(hero, "the old timer must not fire one millisecond later").toHaveTextContent("Second");

    act(() => vi.advanceTimersByTime(1));
    expect(hero).toHaveTextContent("Third");
  });

  test("does not rotate when the system asks for reduced motion", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: true,
        media: "(prefers-reduced-motion: reduce)",
        addEventListener: () => {},
        removeEventListener: () => {},
      })),
    );
    render(<HomeHero slides={SLIDES} catalogName="Featured" onOpen={() => {}} />);

    act(() => vi.advanceTimersByTime(12000));
    expect(screen.getByTestId("home-hero")).toHaveTextContent("First");
  });

  test("draws a text slide with its own words when there is no billboard art", () => {
    render(<HomeHero slides={SLIDES} catalogName="Featured" onOpen={() => {}} />);
    const hero = screen.getByTestId("home-hero");

    fireEvent.keyDown(hero, { key: "ArrowRight" });

    expect(hero).toHaveTextContent("Second");
    expect(hero).toHaveTextContent("The second slide.");
    expect(hero.querySelector("img")).toBeNull();
  });
});
