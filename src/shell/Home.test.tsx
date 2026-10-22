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
  preferences: { subtitleLanguage: null, subtitleColor: "#FFFFFF", subtitleScale: 1 },
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
  // The Host's failure shape: a failed page carries no items and counts none,
  // whether it was the first page or a later one.
  if (catalogAnswer.failure) {
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
    failure: null,
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

/** Which Catalog answers a test keeps back until it releases them. */
type Hold = "all" | string | readonly string[];

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((fulfil) => {
    resolve = fulfil;
  });
  return { promise, resolve };
}

function fakeHost(
  initial: Snapshot,
  catalogs: CatalogAnswer[],
  opening?: Title,
  hold?: Hold,
  holdOpen = false,
) {
  const invocations: Invocation[] = [];
  let current = initial;
  let listener: ((event: { payload: Snapshot }) => void) | undefined;

  // Answers a test keeps back: `"all"` holds every Catalog, a key or a list of
  // keys holds those, and `release()` lets everything through — including asks
  // that have not started yet — while `release(key)` frees one Catalog.
  const heldKeys = new Set<string>(
    hold === undefined || hold === "all"
      ? []
      : typeof hold === "string"
        ? [hold]
        : hold,
  );
  const heldAnswers = new Map<string, Deferred<void>>();
  const released = new Set<string>();
  let open = false;
  const answerGate = (key: string): Promise<void> => {
    let gate = heldAnswers.get(key);
    if (!gate) {
      gate = deferred<void>();
      heldAnswers.set(key, gate);
    }
    return gate.promise;
  };
  const shouldHold = (key: string): boolean =>
    !open && !released.has(key) && (hold === "all" || heldKeys.has(key));
  const release = (key?: string) => {
    if (key === undefined) {
      open = true;
      for (const gate of heldAnswers.values()) {
        gate.resolve();
      }
      heldAnswers.clear();
      return;
    }
    released.add(key);
    heldAnswers.get(key)?.resolve();
    heldAnswers.delete(key);
  };

  // How many `browse_catalog` asks the Host has not answered yet, and the most
  // it ever held at once — what the Home tests bound (#112).
  const stats = { browseInFlight: 0, browsePeak: 0 };

  let releaseOpen = () => {};
  const openGate = new Promise<void>((resolve) => {
    releaseOpen = resolve;
  });

  const transport: Transport = {
    invoke: async <T,>(command: string, args?: Record<string, unknown>): Promise<T> => {
      invocations.push({ command, args });
      if (command === "snapshot") {
        return current as T;
      }

      const action = (args?.envelope as { action: Action }).action;
      if (action.type === "browse_catalog") {
        const key = `${action.addon}/${action.catalog.type}/${action.catalog.id}`;
        stats.browseInFlight += 1;
        stats.browsePeak = Math.max(stats.browsePeak, stats.browseInFlight);
        try {
          if (shouldHold(key)) {
            await answerGate(key);
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
        } finally {
          stats.browseInFlight -= 1;
        }
      }

      if (action.type === "open_title" && opening) {
        if (holdOpen) {
          await openGate;
        }
        return { snapshots: [], answer: { title: opening } } as T;
      }

      return { snapshots: [], answer: null } as T;
    },
    listen: async <T,>(_event: string, handler: (event: { payload: T }) => void) => {
      listener = handler as (event: { payload: Snapshot }) => void;
      return () => {
        listener = undefined;
      };
    },
  };

  return {
    client: new HostClient(transport),
    invocations,
    stats,
    release,
    releaseOpen,
    /** Publish a Snapshot to the Shell, as the Host does on a change. */
    publish(next: Snapshot) {
      current = next;
      listener?.({ payload: next });
    },
  };
}

function actions(invocations: Invocation[]): Action[] {
  return invocations
    .filter(({ command }) => command === "dispatch")
    .map(({ args }) => (args?.envelope as { action: Action }).action);
}

/** The `browse_catalog` asks, in the order Home sent them. */
function browseActions(invocations: Invocation[]): Action[] {
  return actions(invocations).filter((action) => action.type === "browse_catalog");
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

/** One Addon with eight Catalogs: enough to see the four-wide batch (#112). */
const MANY: AddonManifest = {
  ...CINEMETA,
  id: "community.many",
  name: "Many",
  catalogs: Array.from({ length: 8 }, (_, index) => ({
    type: "movie",
    id: `rail-${index}`,
    name: `Rail ${index}`,
    extra: [{ name: "skip", isRequired: false, options: [], optionsLimit: 1 }],
  })),
};

function manyAnswers(): CatalogAnswer[] {
  return MANY.catalogs.map((catalog) => ({
    addon: MANY.id,
    type: catalog.type,
    id: catalog.id,
    name: catalog.name,
    pages: [[meta({ id: `tt-${catalog.id}`, name: `Item ${catalog.id}` })]],
  }));
}

/** An Addon Home has not read from yet, for the fingerprint test. */
const FRESH: AddonManifest = {
  ...CINEMETA,
  id: "community.fresh",
  name: "Fresh",
  catalogs: [
    {
      type: "movie",
      id: "fresh",
      name: "Fresh",
      extra: [{ name: "skip", isRequired: false, options: [], optionsLimit: 1 }],
    },
  ],
};

const FRESH_CATALOGUE: CatalogAnswer = {
  addon: FRESH.id,
  type: "movie",
  id: "fresh",
  name: "Fresh",
  pages: [[meta({ id: "tt0088763", name: "Back to the Future" })]],
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

  test("paints a fast Row while a slower one is still pending", async () => {
    const host = fakeHost(
      homeSnapshot(),
      [FEATURED_CATALOGUE, TOP_CATALOGUE, POPULAR_CATALOGUE],
      undefined,
      `${CINEMETA.id}/movie/top`,
    );
    render(<Shell client={host.client} />);

    expect(await screen.findByTestId("home-hero")).toHaveTextContent("The Matrix");
    expect(await screen.findByText("The Silence of the Lambs")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Top" })).toBeInTheDocument();
    expect(
      screen.queryByText("The Shawshank Redemption"),
      "the slow Row is drawn blank until its answer lands",
    ).not.toBeInTheDocument();
    expect(host.stats.browseInFlight).toBe(1);

    act(() => host.release());

    expect(await screen.findByText("The Shawshank Redemption")).toBeInTheDocument();
  });

  test("an ask sent before leaving Home keeps running and is joined on the return", async () => {
    const host = fakeHost(
      homeSnapshot(),
      [FEATURED_CATALOGUE, TOP_CATALOGUE, POPULAR_CATALOGUE],
      undefined,
      `${CINEMETA.id}/movie/top`,
    );
    render(<Shell client={host.client} />);

    await screen.findByTestId("home-hero");
    expect(screen.queryByText("The Shawshank Redemption")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Discover" }));
    await screen.findByRole("heading", { name: "Discover" });
    fireEvent.click(screen.getByRole("button", { name: "Home" }));

    expect(screen.getByTestId("home-hero")).toHaveTextContent("The Matrix");
    expect(screen.getByRole("region", { name: "Top" })).toBeInTheDocument();
    expect(
      screen.queryByText("The Shawshank Redemption"),
      "the Row is still waiting for the ask it already sent",
    ).not.toBeInTheDocument();
    expect(
      browseActions(host.invocations).filter(
        (action) => action.type === "browse_catalog" && action.catalog.id === "top",
      ),
    ).toHaveLength(1);

    act(() => host.release());

    expect(await screen.findByText("The Shawshank Redemption")).toBeInTheDocument();
  });

  test("starts with the Featured catalog and the first three content Rows, four at once at most", async () => {
    const host = fakeHost(
      homeSnapshot({
        addons: [MANY],
        featuredCatalog: {
          addon: MANY.id,
          catalog: { type: "movie", id: "rail-5" },
        },
      }),
      manyAnswers(),
      undefined,
      "all",
    );
    render(<Shell client={host.client} />);

    // The blank headings are all there before any answer, in configured order.
    await waitFor(() =>
      expect(screen.getAllByTestId(/^home-row-/)).toHaveLength(MANY.catalogs.length),
    );

    await waitFor(() => expect(host.stats.browseInFlight).toBe(4));
    expect(browseActions(host.invocations)).toEqual([
      browseAction(MANY.id, { type: "movie", id: "rail-5" }),
      browseAction(MANY.id, { type: "movie", id: "rail-0" }),
      browseAction(MANY.id, { type: "movie", id: "rail-1" }),
      browseAction(MANY.id, { type: "movie", id: "rail-2" }),
    ]);
    expect(host.stats.browsePeak).toBe(4);

    act(() => host.release(`${MANY.id}/movie/rail-0`));
    await waitFor(() => expect(browseActions(host.invocations)).toHaveLength(5));
    expect(browseActions(host.invocations)[4]).toEqual(
      browseAction(MANY.id, { type: "movie", id: "rail-3" }),
    );
    expect(host.stats.browsePeak).toBe(4);

    act(() => host.release());
    await waitFor(() =>
      expect(browseActions(host.invocations)).toHaveLength(MANY.catalogs.length),
    );
    expect(host.stats.browsePeak).toBe(4);
  });

  test("returning to Home paints the Rows already read and asks nothing again", async () => {
    const host = fakeHost(homeSnapshot(), [
      FEATURED_CATALOGUE,
      TOP_CATALOGUE,
      POPULAR_CATALOGUE,
    ]);
    render(<Shell client={host.client} />);

    await screen.findByText("The Shawshank Redemption");
    await screen.findByText("The Silence of the Lambs");
    const asked = browseActions(host.invocations).length;

    fireEvent.click(screen.getByRole("button", { name: "Discover" }));
    await screen.findByRole("heading", { name: "Discover" });

    fireEvent.click(screen.getByRole("button", { name: "Home" }));

    // The store paints on the return's first render, before any effect can ask.
    expect(screen.getByText("The Shawshank Redemption")).toBeInTheDocument();
    expect(screen.getByTestId("home-hero")).toHaveTextContent("The Matrix");
    expect(browseActions(host.invocations)).toHaveLength(asked);
  });

  test("a failed Row is re-asked on return, and the successful Rows are not", async () => {
    const failing: CatalogAnswer = {
      ...TOP_CATALOGUE,
      failure: { kind: "catalog", detail: "the Addon answered a web page" },
    };
    const host = fakeHost(homeSnapshot(), [
      FEATURED_CATALOGUE,
      failing,
      POPULAR_CATALOGUE,
    ]);
    render(<Shell client={host.client} />);

    await screen.findByText(/could not read that Addon's catalog/);

    fireEvent.click(screen.getByRole("button", { name: "Discover" }));
    await screen.findByRole("heading", { name: "Discover" });
    fireEvent.click(screen.getByRole("button", { name: "Home" }));

    await waitFor(() =>
      expect(browseActions(host.invocations)).toEqual([
        browseAction(CINEMETA.id, { type: "movie", id: "featured" }),
        browseAction(CINEMETA.id, { type: "movie", id: "top" }),
        browseAction(STREMBOX.id, { type: "movie", id: "letterboxd-popular" }),
        browseAction(CINEMETA.id, { type: "movie", id: "top" }),
      ]),
    );
  });

  test("adding, reordering and removing Catalogs keeps the surviving Rows", async () => {
    const host = fakeHost(homeSnapshot(), [
      FEATURED_CATALOGUE,
      TOP_CATALOGUE,
      POPULAR_CATALOGUE,
      FRESH_CATALOGUE,
    ]);
    render(<Shell client={host.client} />);

    await screen.findByText("The Shawshank Redemption");
    await screen.findByText("The Silence of the Lambs");
    const asked = browseActions(host.invocations).length;
    expect(asked).toBe(3);

    // A reorder moves the Rows and asks nothing.
    act(() => host.publish(homeSnapshot({ revision: 4, addons: [STREMBOX, CINEMETA] })));
    await waitFor(() =>
      expect(
        screen.getAllByTestId(/^row-/).map((row) => row.getAttribute("data-testid")),
      ).toEqual([
        `row-${STREMBOX.id}/movie/letterboxd-popular`,
        `row-${CINEMETA.id}/movie/top`,
        `row-${CINEMETA.id}/movie/featured`,
      ]),
    );
    expect(browseActions(host.invocations)).toHaveLength(asked);
    expect(screen.getByText("The Shawshank Redemption")).toBeInTheDocument();

    // A new Catalog is the only thing fetched; the survivors keep their cards.
    act(() =>
      host.publish(homeSnapshot({ revision: 5, addons: [STREMBOX, CINEMETA, FRESH] })),
    );
    expect(await screen.findByText("Back to the Future")).toBeInTheDocument();
    expect(screen.getByText("The Shawshank Redemption")).toBeInTheDocument();
    expect(screen.getByText("The Silence of the Lambs")).toBeInTheDocument();
    expect(browseActions(host.invocations)).toHaveLength(asked + 1);
    expect(browseActions(host.invocations)[asked]).toEqual(
      browseAction(FRESH.id, { type: "movie", id: "fresh" }),
    );

    // A removed Catalog's row goes, and asks nothing.
    act(() => host.publish(homeSnapshot({ revision: 6, addons: [CINEMETA, FRESH] })));
    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "Popular This Week" }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByText("The Shawshank Redemption")).toBeInTheDocument();
    expect(browseActions(host.invocations)).toHaveLength(asked + 1);
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
