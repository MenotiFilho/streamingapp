import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import {
  HostClient,
  type Action,
  type ActionError,
  type AddonManifest,
  type DiscoverRow,
  type MetaPreview,
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

function meta(overrides: Partial<MetaPreview> = {}): MetaPreview {
  return {
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
    ...overrides,
  };
}

function discoverRow(
  metas: MetaPreview[],
  overrides: Partial<DiscoverRow> = {},
): DiscoverRow {
  return { type: "movie", sent: metas.length, metas, failure: null, ...overrides };
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

type DiscoverAction = Extract<Action, { type: "discover" }>;
type Invocation = { command: string; args?: Record<string, unknown> };

function fakeHost(
  initial: Snapshot,
  options: {
    discover?: (action: DiscoverAction) => DiscoverRow;
    streams?: Array<{ addon: string; streams: []; failure: ActionError | null }>;
  } = {},
) {
  const invocations: Invocation[] = [];
  const streams = options.streams ?? [];

  const transport: Transport = {
    invoke: async <T,>(command: string, args?: Record<string, unknown>): Promise<T> => {
      invocations.push({ command, args });
      if (command === "snapshot") {
        return initial as T;
      }

      const action = (args?.envelope as { action: Action }).action;
      if (action.type === "discover") {
        const answer = options.discover
          ? options.discover(action)
          : discoverRow([meta()], { type: action.kind });
        return { snapshots: [], answer: { discover: [answer] } } as T;
      }
      if (action.type === "open_discovered_title") {
        return { snapshots: [], answer: { title: MATRIX } } as T;
      }
      if (action.type === "find_streams") {
        return { snapshots: [], answer: { streams } } as T;
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

function discoverAsks(invocations: Invocation[]): DiscoverAction[] {
  return actions(invocations).filter(
    (action): action is DiscoverAction => action.type === "discover",
  );
}

async function openDiscover(host: ReturnType<typeof fakeHost>) {
  render(<Shell client={host.client} />);
  await screen.findByRole("heading", { name: "Home" });
  fireEvent.click(screen.getByRole("button", { name: "Discover" }));
  await screen.findByTestId("discover-screen");
}

describe("Discover without a TMDB key", () => {
  test("stays in the rail, says what powers it, and asks the Host for nothing", async () => {
    const host = fakeHost(
      snapshot({ protection: { backend: "keyring", tmdbHeld: false, stremioHeld: false } }),
    );
    await openDiscover(host);

    const empty = await screen.findByTestId("discover-no-key");
    expect(empty).toHaveTextContent("powered by TMDB");
    expect(empty).toHaveTextContent("Settings → Credentials");
    expect(screen.getByRole("heading", { name: "Discover" })).toBeInTheDocument();
    expect(screen.getByTestId("discover-tmdb-credit")).toHaveTextContent(
      "This product uses the TMDB API but is not endorsed or certified by TMDB",
    );
    expect(discoverAsks(host.invocations)).toEqual([]);
  });

  test("its control jumps to Settings → Credentials without changing destination", async () => {
    const host = fakeHost(
      snapshot({ protection: { backend: "keyring", tmdbHeld: false, stremioHeld: false } }),
    );
    await openDiscover(host);

    fireEvent.click(screen.getByRole("button", { name: "Open Settings → Credentials" }));

    expect(await screen.findByTestId("settings-credentials")).toBeInTheDocument();
    expect(
      screen.getByLabelText("TMDB API key or read-access token"),
    ).toBeInTheDocument();
    expect(
      document.querySelector('[data-destination="discover"]'),
      "the base destination is still Discover under the pushed level",
    ).toHaveAttribute("aria-current", "page");
  });
});

describe("Discover with a TMDB key", () => {
  test("opens on the week's Trending feed for films", async () => {
    const host = fakeHost(snapshot());
    await openDiscover(host);

    expect(await screen.findByTestId("discover-card-tmdb:603")).toHaveTextContent(
      "The Matrix",
    );
    expect(discoverAsks(host.invocations)).toEqual([
      { type: "discover", kind: "movie", page: 1 },
    ]);
    expect(screen.getByTestId("discover-grid")).toHaveAttribute(
      "data-label",
      "Discover titles",
    );
  });

  test("switching to Series swaps to series cards and the series genre set", async () => {
    const host = fakeHost(snapshot(), {
      discover: (action) =>
        action.kind === "series"
          ? discoverRow(
              [
                meta({
                  id: "tmdb:1396",
                  type: "series",
                  name: "Breaking Bad",
                  releaseInfo: "2008",
                }),
              ],
              { type: "series" },
            )
          : discoverRow([meta()], { type: "movie" }),
    });
    await openDiscover(host);
    await screen.findByTestId("discover-card-tmdb:603");

    expect(
      screen.getByRole("button", { name: "Science Fiction" }),
      "films are filtered by the film list",
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sci-Fi & Fantasy" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Series" }));

    expect(await screen.findByTestId("discover-card-tmdb:1396")).toHaveTextContent(
      "Breaking Bad",
    );
    expect(discoverAsks(host.invocations).at(-1)).toEqual({
      type: "discover",
      kind: "series",
      page: 1,
    });
    expect(screen.getByRole("button", { name: "Sci-Fi & Fantasy" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Science Fiction" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("discover-card-tmdb:603")).not.toBeInTheDocument();
  });

  test("a genre filters the active kind by TMDB's id, and switching kind clears it", async () => {
    const host = fakeHost(snapshot(), {
      discover: (action) => discoverRow([meta()], { type: action.kind }),
    });
    await openDiscover(host);
    await screen.findByTestId("discover-card-tmdb:603");

    fireEvent.click(screen.getByRole("button", { name: "Action" }));
    await waitFor(() =>
      expect(discoverAsks(host.invocations).at(-1)).toEqual({
        type: "discover",
        kind: "movie",
        page: 1,
        genre: 28,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Series" }));
    await waitFor(() =>
      expect(discoverAsks(host.invocations).at(-1)).toEqual({
        type: "discover",
        kind: "series",
        page: 1,
      }),
    );
    expect(screen.getByRole("button", { name: "All genres" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("More asks the next page and appends it, and an empty page ends the feed", async () => {
    const second = meta({ id: "tmdb:604", name: "The Matrix Reloaded", releaseInfo: "2003" });
    const host = fakeHost(snapshot(), {
      discover: (action) => {
        if (action.page === 1) {
          return discoverRow([meta()], { type: action.kind });
        }
        if (action.page === 2) {
          return discoverRow([second], { type: action.kind });
        }
        return discoverRow([], { type: action.kind });
      },
    });
    await openDiscover(host);
    await screen.findByTestId("discover-card-tmdb:603");

    fireEvent.click(screen.getByRole("button", { name: "More" }));

    expect(await screen.findByTestId("discover-card-tmdb:604")).toHaveTextContent(
      "The Matrix Reloaded",
    );
    expect(screen.getByTestId("discover-card-tmdb:603")).toBeInTheDocument();
    expect(discoverAsks(host.invocations).at(-1)).toEqual({
      type: "discover",
      kind: "movie",
      page: 2,
    });

    fireEvent.click(screen.getByRole("button", { name: "More" }));

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "More" })).not.toBeInTheDocument(),
    );
    expect(discoverAsks(host.invocations).at(-1)).toEqual({
      type: "discover",
      kind: "movie",
      page: 3,
    });
  });

  test("a failed page is drawn inline, keeps what was read, and is asked again", async () => {
    let failed = true;
    const host = fakeHost(snapshot(), {
      discover: (action) =>
        failed
          ? discoverRow([], {
              type: action.kind,
              failure: { kind: "tmdb", detail: "TMDB answered with status 429" },
            })
          : discoverRow([meta()], { type: action.kind }),
    });
    await openDiscover(host);

    const failure = await screen.findByTestId("discover-failure");
    expect(failure).toHaveAttribute("role", "alert");
    expect(failure).toHaveTextContent("TMDB did not answer");
    expect(failure).toHaveTextContent("status 429");

    failed = false;
    fireEvent.click(screen.getByRole("button", { name: "More" }));

    expect(await screen.findByTestId("discover-card-tmdb:603")).toBeInTheDocument();
    expect(screen.queryByTestId("discover-failure")).not.toBeInTheDocument();
    expect(discoverAsks(host.invocations).at(-1)).toEqual({
      type: "discover",
      kind: "movie",
      page: 1,
    });
  });

  test("a later failed page does not blank the cards already held", async () => {
    const host = fakeHost(snapshot(), {
      discover: (action) =>
        action.page === 1
          ? discoverRow([meta()], { type: action.kind })
          : discoverRow([], {
              type: action.kind,
              failure: { kind: "tmdb", detail: "TMDB answered with status 429" },
            }),
    });
    await openDiscover(host);
    await screen.findByTestId("discover-card-tmdb:603");

    fireEvent.click(screen.getByRole("button", { name: "More" }));

    expect(await screen.findByTestId("discover-failure")).toHaveTextContent("status 429");
    expect(screen.getByTestId("discover-card-tmdb:603")).toBeInTheDocument();
  });
});

describe("the unplayable mark on Discover", () => {
  test("is drawn locally when no configured Addon declares tmdb: or tt for Streams", async () => {
    const host = fakeHost(snapshot({ addons: [CATALOG_ONLY] }));
    await openDiscover(host);

    const card = await screen.findByTestId("discover-card-tmdb:603");
    expect(card).toHaveAttribute("data-unplayable", "true");
    expect(card).toHaveTextContent("Unplayable");
  });

  test("is absent when an Addon declares tt and can answer through the bridge", async () => {
    const host = fakeHost(snapshot({ addons: [CINEMETA] }));
    await openDiscover(host);

    const card = await screen.findByTestId("discover-card-tmdb:603");
    expect(card).not.toHaveAttribute("data-unplayable");
    expect(card).not.toHaveTextContent("Unplayable");
  });

  test("a failed Streams answer proves nothing and leaves the card unmarked", async () => {
    const host = fakeHost(snapshot(), {
      streams: [
        {
          addon: CINEMETA.id,
          streams: [],
          failure: { kind: "fetch", detail: "the Addon answered with status 503" },
        },
      ],
    });
    await openDiscover(host);

    fireEvent.click(await screen.findByTestId("discover-card-tmdb:603"));
    await screen.findByTestId("title-tmdb:603");
    fireEvent.click(screen.getByTestId("play-film"));
    await screen.findByTestId("streams-heading");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("streams-heading")).not.toBeInTheDocument());
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("title-level")).not.toBeInTheDocument());

    expect(await screen.findByTestId("discover-card-tmdb:603")).not.toHaveAttribute(
      "data-unplayable",
    );
  });

  test("is added on demand when every Addon answers a Video with no Stream", async () => {
    const host = fakeHost(snapshot(), { streams: [] });
    await openDiscover(host);

    fireEvent.click(await screen.findByTestId("discover-card-tmdb:603"));
    await screen.findByTestId("title-tmdb:603");
    expect(actions(host.invocations)).toContainEqual({
      type: "open_discovered_title",
      key: { kind: "tmdb", id: 603 },
      kind: "movie",
    });

    fireEvent.click(screen.getByTestId("play-film"));
    expect(await screen.findByTestId("streams-none")).toHaveTextContent(
      "No configured Addon offers Streams",
    );

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("streams-heading")).not.toBeInTheDocument());
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("title-level")).not.toBeInTheDocument());

    expect(await screen.findByTestId("discover-card-tmdb:603")).toHaveAttribute(
      "data-unplayable",
      "true",
    );
  });
});

describe("opening a Discovered Title", () => {
  test("dispatches open_discovered_title rather than open_title, and pushes the Title screen", async () => {
    const host = fakeHost(snapshot());
    await openDiscover(host);

    fireEvent.click(await screen.findByTestId("discover-card-tmdb:603"));

    expect(await screen.findByTestId("title-tmdb:603")).toHaveTextContent("The Matrix");
    const asks = actions(host.invocations);
    expect(asks).toContainEqual({
      type: "open_discovered_title",
      key: { kind: "tmdb", id: 603 },
      kind: "movie",
    });
    expect(asks.some((action) => action.type === "open_title")).toBe(false);
  });

  test("Back returns to the Discover feed, not to Home", async () => {
    const host = fakeHost(snapshot());
    await openDiscover(host);
    fireEvent.click(await screen.findByTestId("discover-card-tmdb:603"));
    await screen.findByTestId("title-tmdb:603");

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByTestId("title-level")).not.toBeInTheDocument());
    expect(screen.getByTestId("discover-card-tmdb:603")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Home" })).not.toBeInTheDocument();
  });
});
