import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, test } from "vitest";

import { App } from "./App";
import {
  HostClient,
  type Action,
  type AddonManifest,
  type AddonStreams,
  type MetaPreview,
  type Response,
  type Snapshot,
  type Stream,
  type Title,
  type TitleKey,
  type Transport,
  type Video,
} from "./host-client";

type Invocation = { command: string; args?: Record<string, unknown> };

/** The Snapshot of a Host that holds nothing yet, with credentials as published at rest. */
const NOTHING_SAID: Snapshot = {
  revision: 0,
  preferences: { subtitleLanguage: null },
  addons: [],
  protection: { backend: "keyring", tmdbHeld: false },
};

/** An Addon as the Host would publish it, without the URL it lives at. */
const ADDON: AddonManifest = {
  id: "community.stremboxd",
  name: "Stremboxd",
  version: "2.0.0",
  resources: [
    { name: "catalog", types: null, idPrefixes: null },
    { name: "meta", types: ["movie"], idPrefixes: ["tt"] },
  ],
  types: ["movie"],
  catalogs: [
    {
      type: "movie",
      id: "letterboxd-popular",
      name: "Popular This Week",
      extra: [
        { name: "genre", isRequired: false, options: ["Action"], optionsLimit: 1 },
        { name: "skip", isRequired: false, options: [], optionsLimit: 1 },
      ],
    },
    {
      type: "movie",
      id: "letterboxd-search",
      name: "Search Letterboxd",
      extra: [{ name: "search", isRequired: true, options: [], optionsLimit: 1 }],
    },
    {
      type: "series",
      id: "letterboxd-year",
      name: "By year",
      extra: [{ name: "genre", isRequired: true, options: ["2026"], optionsLimit: 1 }],
    },
  ],
  idPrefixes: [],
  behaviorHints: { configurable: false, configurationRequired: false },
};

/** One item in a row, as the Host would publish it. */
function meta(
  id: string,
  name: string,
  description: string | null = null,
  type = "movie",
): MetaPreview {
  return {
    id,
    type,
    name,
    poster: `https://example.com/${id}.jpg`,
    posterShape: null,
    releaseInfo: "1999",
    imdbRating: "8.7",
    genres: [],
    description,
  };
}

/** The pages the fake Host answers a `letterboxd-popular` browse with. */
const POPULAR_PAGES = [
  [
    meta("tt0133093", "The Matrix"),
    meta(
      "tt0234215",
      "The Matrix Reloaded",
      "📄 The.Matrix.Reloaded.2003.2160p.WEB-DL • 📦 47.21 GB",
    ),
  ],
  [meta("tt10838180", "The Matrix Resurrections")],
];

/** The one series the fake Addon has, and the episodes it answers for it. */
const SERIES_META = meta("tt0903747", "Breaking Bad", null, "series");
const SERIES_PAGE = [SERIES_META];

const EPISODES: Video[] = [
  episode("tt0903747:0:1", "Good Cop Bad Cop", 0, 1),
  episode("tt0903747:1:1", "Pilot", 1, 1),
  episode("tt0903747:1:2", "Cat's in the Bag...", 1, 2),
];

function episode(id: string, name: string, season: number, episodeNumber: number): Video {
  return { id, name, season, episode: episodeNumber };
}

/** Every item the fake Addon has, so an `open_title` can answer about one. */
const ITEMS = [...POPULAR_PAGES.flat(), SERIES_META];

/** The TMDB id The Matrix really is keyed by, for a `mapped` Title. */
const MATRIX_TMDB = 603;

/** The two stream-capable Addons the fake Host answers `find_streams` for. */
const TORRENTIO = "com.stremio.torrentio.addon";
const AIOSTREAMS = "community.aiostreams";

/**
 * What the fake Host answers a `find_streams` with, the way a real one would:
 * one group per Addon that answered, in the order the Addons were configured,
 * each candidate carrying the Addon's own words — a torrent this Host cannot
 * fetch yet, and a direct URL with the hints a debrid answer tends to carry.
 */
function streamGroups(videoId: string): AddonStreams[] {
  return [
    {
      addon: TORRENTIO,
      streams: [
        {
          name: "Torrentio\n4k HDR",
          description: `The Matrix 1999 2160p UHD BluRay x265-GROUP\n👤 100 💾 51.3 GB\n⚙️ 1337x`,
          playback: { kind: "info_hash", infoHash: "8dc393c100ef0c0d010cfefdcebe572e26c4f775" },
          warnings: [],
          filename: "The.Matrix.1999.2160p.UHD.BluRay.x265-GROUP.mkv",
          bingeGroup: "torrentio|4k|BluRay|x265",
        },
        {
          name: "Torrentio\n1080p",
          description: "The Matrix 1999 1080p BluRay x264-GROUP\n👤 58 💾 2.11 GB",
          playback: { kind: "info_hash", infoHash: "03dd34fea0ff15a451c1723062a901aa3a0ad458" },
          warnings: [],
          filename: "The.Matrix.1999.1080p.BluRay.x264-GROUP.mkv",
          bingeGroup: "torrentio|1080p|BluRay|x264",
        },
      ] satisfies Stream[],
      failure: null,
    },
    {
      addon: AIOSTREAMS,
      streams: [
        {
          name: "AIOStreams\n1080p",
          description: "The Matrix 1999 1080p BluRay x265-GROUP\n💾 4.21 GB ⚙️ TorBox",
          playback: { kind: "direct", url: `https://stream.example.org/v/${videoId}-1080p.mkv` },
          warnings: ["not_web_ready", "proxy_headers"],
          filename: "The.Matrix.1999.1080p.BluRay.x265-GROUP.mkv",
          bingeGroup: null,
        },
      ] satisfies Stream[],
      failure: null,
    },
  ];
}

/**
 * A Host standing in for the real one: it holds the state, applies Actions the
 * way `host-core` does, and publishes a Snapshot for each change. The window
 * under test cannot tell the difference, which is the point.
 *
 * Catalog questions are answered too, from pages this fake holds: paging returns
 * the next page, and a search answers with one row.
 */
function fakeHost(
  options: {
    initial?: Snapshot;
    refuse?: unknown;
    /** Make an `open_title` for this item fail, the way a Host that will not open it does. */
    refuseTitle?: unknown;
    failing?: string;
    /** Answer this item's `open_title` with the least a meta response can be. */
    sparse?: string;
    /** Answer this series' `open_title` with no Videos at all. */
    noEpisodes?: string;
    /** Answer this item's `open_title` as keyed by TMDB, the way a mapped Title comes back. */
    mapped?: string;
    /** Make a `find_streams` fail, the way a Host that will not ask does. */
    refuseStreams?: unknown;
    /** Answer a `find_streams` with no groups at all. */
    noStreamSources?: boolean;
    /** Answer this Addon's group with the failure a Host that could not reach it reports. */
    failingStreams?: string;
    /** Answer this Addon's group empty, the way an Addon whose answer held no candidates does. */
    quietStreams?: string;
  } = {},
) {
  let state = options.initial ?? NOTHING_SAID;
  const invocations: Invocation[] = [];
  const listeners = new Set<(event: { payload: Snapshot }) => void>();
  const asked: string[] = [];

  const publish = (next: Snapshot) => {
    state = next;
    for (const listener of listeners) {
      listener({ payload: next });
    }
  };

  const invoke = async <T,>(
    command: string,
    args?: Record<string, unknown>,
  ): Promise<T> => {
    invocations.push({ command, args });
    if (command === "snapshot") {
      return state as unknown as T;
    }
    if (options.refuse) {
      throw options.refuse;
    }
    const { action } = args?.envelope as { action: Action };
    const response: Response = { snapshots: [], answer: null };

    switch (action.type) {
      case "set_subtitle_language":
        publish({
          ...state,
          revision: state.revision + 1,
          preferences: { subtitleLanguage: action.language },
        });
        response.snapshots = [state];
        break;
      case "clear_subtitle_language":
        publish({
          ...state,
          revision: state.revision + 1,
          preferences: { subtitleLanguage: null },
        });
        response.snapshots = [state];
        break;
      case "add_addon":
        publish({
          ...state,
          revision: state.revision + 1,
          addons: [...state.addons, ADDON],
        });
        response.snapshots = [state];
        break;
      case "remove_addon":
        publish({
          ...state,
          revision: state.revision + 1,
          addons: state.addons.filter((addon) => addon.id !== action.id),
        });
        response.snapshots = [state];
        break;
      case "set_tmdb_key":
        // The value goes nowhere near the Snapshot: what changes on the wire is
        // only that a key is now held, in whichever backend already holds them.
        publish({
          ...state,
          revision: state.revision + 1,
          protection: { ...state.protection, tmdbHeld: true },
        });
        response.snapshots = [state];
        break;
      case "clear_tmdb_key":
        publish({
          ...state,
          revision: state.revision + 1,
          protection: { ...state.protection, tmdbHeld: false },
        });
        response.snapshots = [state];
        break;
      case "browse_catalog": {
        const skip = Number(action.extra.find((extra) => extra.name === "skip")?.value ?? 0);
        const catalog = ADDON.catalogs.find(
          (held) => held.id === action.catalog.id && held.type === action.catalog.type,
        );
        asked.push(`${action.addon}/${action.catalog.type}/${action.catalog.id}`);
        if (!catalog) {
          throw { kind: "unknown_catalog", addon: action.addon, catalog: action.catalog };
        }
        if (catalog.extra.some((prop) => prop.isRequired && prop.options.length === 0)) {
          // The Host's own rule: a catalog that requires a value its Addon
          // offers nothing to default to cannot be asked for on its own.
          throw {
            kind: "extra",
            detail: `the catalog ${action.catalog.type}/${action.catalog.id} needs a value its Addon offers no default for`,
          };
        }

        const pages =
          catalog.id === "letterboxd-popular"
            ? POPULAR_PAGES
            : catalog.id === "letterboxd-year"
              ? [SERIES_PAGE]
              : [];
        const page = pages[skip === 0 ? 0 : 1] ?? [];
        const failed = options.failing === catalog.id;
        response.answer = {
          catalogs: [
            {
              addon: action.addon,
              type: action.catalog.type,
              id: action.catalog.id,
              name: catalog.name,
              sent: page.length,
              metas: failed ? [] : page,
              failure: failed
                ? { kind: "fetch", detail: "the Addon answered with status 503" }
                : null,
            },
          ],
        };
        break;
      }
      case "search_catalogs":
        response.answer = {
          catalogs: [
            {
              addon: ADDON.id,
              type: "movie",
              id: "letterboxd-search",
              name: "Search Letterboxd",
              sent: 1,
              metas: [meta("tt0133093", `Found ${action.query}`)],
              failure: null,
            },
          ],
        };
        break;
      case "open_title": {
        asked.push(`open/${action.addon}/${action.title.type}/${action.title.id}`);
        if (options.refuseTitle) {
          throw options.refuseTitle;
        }
        const item = ITEMS.find((held) => held.id === action.title.id);
        if (!item) {
          throw { kind: "unknown_title", addon: action.addon, title: action.title };
        }

        // A meta answer the Host reads leniently: the identity it opened, its
        // metadata, and the Videos a series has. `sparse` stands in for the
        // Addon that answered with the least it could.
        const bare = options.sparse === item.id;
        // What the Title is keyed by: TMDB's own id where a record met it, and
        // the Addon that supplied it otherwise — the unmapped marker the
        // window reads.
        const key: TitleKey =
          options.mapped === item.id
            ? { kind: "tmdb", id: MATRIX_TMDB }
            : { kind: "addon", addon: action.addon, id: item.id };
        response.answer = {
          title: {
            addon: action.addon,
            id: item.id,
            key,
            type: item.type,
            name: bare ? item.id : item.name,
            poster: bare ? null : item.poster,
            description: bare ? null : `${item.name}, as the Addon describes it.`,
            releaseInfo: bare ? null : item.releaseInfo,
            runtime: bare ? null : "136 min",
            imdbRating: item.imdbRating,
            genres: item.genres,
            videos:
              options.noEpisodes === item.id
                ? []
                : item.id === SERIES_META.id
                  ? EPISODES
                  : [],
          } satisfies Title,
        };
        break;
      }
      case "find_streams": {
        asked.push(`streams/${action.video.type}/${action.video.id}`);
        if (options.refuseStreams) {
          throw options.refuseStreams;
        }
        if (options.noStreamSources) {
          response.answer = { streams: [] };
          break;
        }

        // The way a real Host answers: one group per Addon that answered, in
        // the order they were configured; an Addon that could not answer is its
        // own group with a failure in it.
        const groups = streamGroups(action.video.id).map((group) => {
          if (group.addon === options.failingStreams) {
            return {
              ...group,
              streams: [],
              failure: { kind: "fetch" as const, detail: "the Addon answered with status 503" },
            };
          }
          if (group.addon === options.quietStreams) {
            return { ...group, streams: [] };
          }
          return group;
        });
        response.answer = { streams: groups };
        break;
      }
    }
    return response as unknown as T;
  };

  const transport: Transport = {
    invoke,
    listen: async <T,>(
      _event: string,
      handler: (event: { payload: T }) => void,
    ) => {
      const record = handler as (event: { payload: Snapshot }) => void;
      listeners.add(record);
      return () => listeners.delete(record);
    },
  };

  return { transport, invocations, publish, asked };
}

function windowOver(transport: Transport) {
  return render(<App client={new HostClient(transport)} />);
}

/**
 * The film opened and play pressed: the preamble every Streams test needs, and
 * exactly what makes a client ask the Host for them.
 */
async function filmStreams(options: Parameters<typeof fakeHost>[0] = {}) {
  const host = fakeHost(options);
  windowOver(host.transport);
  fireEvent.click(await screen.findByTestId("card-tt0133093"));
  fireEvent.click(await screen.findByTestId("play-film"));
  await screen.findByTestId("streams-heading");
  return host;
}

function shownLanguage() {
  return screen.getByTestId("subtitle-language").textContent;
}

function dispatched(invocations: Invocation[], type: Action["type"]): Invocation {
  const call = invocations.find(
    ({ command, args }) =>
      command === "dispatch" && (args?.envelope as { action: Action }).action.type === type,
  );
  if (!call) {
    throw new Error(`no ${type} Action was taken: ${JSON.stringify(invocations)}`);
  }
  return call;
}

test("the window shows the preference the Host published", async () => {
  const host = fakeHost({
    initial: { ...NOTHING_SAID, revision: 7, preferences: { subtitleLanguage: "pt-BR" } },
  });

  windowOver(host.transport);

  await waitFor(() => expect(shownLanguage()).toBe("pt-BR"));
  expect(screen.getByTestId("revision")).toHaveTextContent("7");
});

test("a window that has had no preference set says so rather than inventing one", async () => {
  const host = fakeHost();

  windowOver(host.transport);

  await waitFor(() =>
    expect(shownLanguage()).toBe("none — the Host picks per Video"),
  );
});

test("saving a language takes a versioned Action through the Host", async () => {
  const host = fakeHost();
  windowOver(host.transport);
  await waitFor(() => expect(shownLanguage()).toBe("none — the Host picks per Video"));

  fireEvent.change(screen.getByLabelText("Prefer a language tag"), {
    target: { value: " pt-BR " },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(shownLanguage()).toBe("pt-BR"));
  expect(dispatched(host.invocations, "set_subtitle_language")).toEqual({
    command: "dispatch",
    args: {
      envelope: {
        version: 1,
        action: { type: "set_subtitle_language", language: "pt-BR" },
      },
    },
  });
  expect(screen.getByLabelText("Prefer a language tag")).toHaveValue("");
});

test("clearing the preference takes the clear Action", async () => {
  const host = fakeHost({
    initial: { ...NOTHING_SAID, revision: 3, preferences: { subtitleLanguage: "pt-BR" } },
  });
  windowOver(host.transport);
  await waitFor(() => expect(shownLanguage()).toBe("pt-BR"));

  fireEvent.click(screen.getByRole("button", { name: "Clear" }));

  await waitFor(() =>
    expect(shownLanguage()).toBe("none — the Host picks per Video"),
  );
  expect(dispatched(host.invocations, "clear_subtitle_language").args).toEqual({
    envelope: { version: 1, action: { type: "clear_subtitle_language" } },
  });
  expect(screen.getByLabelText("Prefer a language tag")).toHaveValue("");
});

test("the window follows a Snapshot it did not ask for", async () => {
  const host = fakeHost();
  windowOver(host.transport);
  await waitFor(() => expect(shownLanguage()).toBe("none — the Host picks per Video"));

  act(() => {
    host.publish({ ...NOTHING_SAID, revision: 4, preferences: { subtitleLanguage: "en" } });
  });

  expect(shownLanguage()).toBe("en");
  expect(screen.getByTestId("revision")).toHaveTextContent("4");
});

test("an older Snapshot does not move the window backwards", async () => {
  const host = fakeHost({
    initial: { ...NOTHING_SAID, revision: 9, preferences: { subtitleLanguage: "de" } },
  });
  windowOver(host.transport);
  await waitFor(() => expect(shownLanguage()).toBe("de"));

  act(() => {
    host.publish({ ...NOTHING_SAID, revision: 2, preferences: { subtitleLanguage: "en" } });
  });

  expect(shownLanguage()).toBe("de");
  expect(screen.getByTestId("revision")).toHaveTextContent("9");
});

test("a rejected Action is explained and leaves the view where it was", async () => {
  const host = fakeHost({
    initial: { ...NOTHING_SAID, revision: 2, preferences: { subtitleLanguage: "pt-BR" } },
    refuse: { kind: "invalid_subtitle_language", language: "Brazilian Portuguese" },
  });
  windowOver(host.transport);
  await waitFor(() => expect(shownLanguage()).toBe("pt-BR"));

  fireEvent.change(screen.getByLabelText("Prefer a language tag"), {
    target: { value: "Brazilian Portuguese" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent(
      '"Brazilian Portuguese" is not a subtitle language tag',
    ),
  );
  expect(shownLanguage()).toBe("pt-BR");
  expect(screen.getByLabelText("Prefer a language tag")).toHaveValue(
    "Brazilian Portuguese",
  );
});

test("a Host the window cannot reach is explained rather than swallowed", async () => {
  const host = fakeHost({
    initial: { ...NOTHING_SAID, revision: 1, preferences: { subtitleLanguage: "pt-BR" } },
    refuse: "the Host went away",
  });
  windowOver(host.transport);
  await waitFor(() => expect(shownLanguage()).toBe("pt-BR"));

  fireEvent.change(screen.getByLabelText("Prefer a language tag"), {
    target: { value: "en" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("could not reach the Host"),
  );
  expect(shownLanguage()).toBe("pt-BR");
  expect(screen.getByLabelText("Prefer a language tag")).toHaveValue("en");
});

test("the window lists the Addons the Host published, and what each offers", async () => {
  const host = fakeHost({
    initial: { ...NOTHING_SAID, revision: 4, addons: [ADDON] },
  });

  windowOver(host.transport);

  const addon = await screen.findByTestId("addon-community.stremboxd");
  expect(addon).toHaveTextContent("Stremboxd");
  expect(addon).toHaveTextContent("2.0.0");
  expect(addon).toHaveTextContent("community.stremboxd");
  expect(addon).toHaveTextContent("catalog");
  expect(addon).toHaveTextContent("meta (movie)");
  expect(addon).toHaveTextContent("movie");
  expect(addon).toHaveTextContent("Popular This Week (movie)");
});

test("a Host with no Addons says so rather than showing an empty list", async () => {
  const host = fakeHost();

  windowOver(host.transport);

  await waitFor(() =>
    expect(screen.getByTestId("addons-empty")).toHaveTextContent(
      "No Addons are configured yet.",
    ),
  );
  expect(screen.queryByTestId("addons")).not.toBeInTheDocument();
});

test("adding an Addon takes a versioned Action carrying the pasted URL", async () => {
  const host = fakeHost();
  windowOver(host.transport);
  await waitFor(() => expect(screen.getByTestId("addons-empty")).toBeInTheDocument());

  fireEvent.change(screen.getByLabelText("Addon manifest URL"), {
    target: { value: "  https://api.stremboxd.com/manifest.json  " },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));

  await waitFor(() =>
    expect(screen.getByTestId("addon-community.stremboxd")).toBeInTheDocument(),
  );
  expect(dispatched(host.invocations, "add_addon")).toEqual({
    command: "dispatch",
    args: {
      envelope: {
        version: 1,
        action: {
          type: "add_addon",
          url: "https://api.stremboxd.com/manifest.json",
        },
      },
    },
  });
  expect(screen.getByLabelText("Addon manifest URL")).toHaveValue("");
});

test("removing an Addon takes the id the Snapshot published", async () => {
  const host = fakeHost({
    initial: { ...NOTHING_SAID, revision: 2, addons: [ADDON] },
  });
  windowOver(host.transport);
  await waitFor(() => expect(screen.getByTestId("addon-community.stremboxd")).toBeInTheDocument());

  fireEvent.click(screen.getByRole("button", { name: "Remove Stremboxd" }));

  await waitFor(() => expect(screen.getByTestId("addons-empty")).toBeInTheDocument());
  expect(dispatched(host.invocations, "remove_addon").args).toEqual({
    envelope: { version: 1, action: { type: "remove_addon", id: "community.stremboxd" } },
  });
});

test("a manifest the Host could not read is explained rather than swallowed", async () => {
  const host = fakeHost({
    refuse: { kind: "manifest", detail: "the manifest is missing name" },
  });
  windowOver(host.transport);
  await waitFor(() => expect(screen.getByTestId("addons-empty")).toBeInTheDocument());

  fireEvent.change(screen.getByLabelText("Addon manifest URL"), {
    target: { value: "https://example.com/manifest.json" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));

  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent(
      "could not read that Addon's manifest: the manifest is missing name",
    ),
  );
  expect(screen.getByTestId("addons-empty")).toBeInTheDocument();
  expect(screen.getByLabelText("Addon manifest URL")).toHaveValue(
    "https://example.com/manifest.json",
  );
});

test("a URL that is not a manifest URL is explained with what it should look like", async () => {
  const host = fakeHost({
    refuse: { kind: "invalid_manifest_url", url: "not a url" },
  });
  windowOver(host.transport);
  await waitFor(() => expect(screen.getByTestId("addons-empty")).toBeInTheDocument());

  fireEvent.change(screen.getByLabelText("Addon manifest URL"), {
    target: { value: "not a url" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));

  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent(
      '"not a url" is not a manifest URL',
    ),
  );
});

test("the window says where credentials live, and that a key is held", async () => {
  const host = fakeHost({
    initial: {
      ...NOTHING_SAID,
      protection: { backend: "keyring", tmdbHeld: true },
    },
  });

  windowOver(host.transport);

  await waitFor(() =>
    expect(screen.getByTestId("protection")).toHaveTextContent(
      "A TMDB key is held in the OS keyring.",
    ),
  );
});

test("a Host with no keyring says the owner-only file is what holds credentials", async () => {
  const host = fakeHost({
    initial: {
      ...NOTHING_SAID,
      protection: { backend: "file", tmdbHeld: false },
    },
  });

  windowOver(host.transport);

  await waitFor(() =>
    expect(screen.getByTestId("protection")).toHaveTextContent("0600"),
  );
  expect(screen.getByTestId("protection")).toHaveTextContent(
    "No TMDB key is held.",
  );
  expect(screen.getByTestId("protection")).toHaveTextContent("no keyring is reachable");
});

test("saving a TMDB key takes a versioned Action, and the Snapshot says one is held", async () => {
  const host = fakeHost();
  windowOver(host.transport);
  await waitFor(() =>
    expect(screen.getByTestId("protection")).toHaveTextContent("No TMDB key is held."),
  );

  fireEvent.change(screen.getByLabelText("TMDB API key or read-access token"), {
    target: { value: "  0123456789abcdef  " },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save key" }));

  await waitFor(() =>
    expect(screen.getByTestId("protection")).toHaveTextContent("A TMDB key is held"),
  );
  expect(dispatched(host.invocations, "set_tmdb_key")).toEqual({
    command: "dispatch",
    args: {
      envelope: {
        version: 1,
        action: { type: "set_tmdb_key", key: "0123456789abcdef" },
      },
    },
  });
  expect(
    screen.getByLabelText("TMDB API key or read-access token"),
    "the key does not sit in the field looking like state",
  ).toHaveValue("");
});

test("clearing the TMDB key takes the clear Action", async () => {
  const host = fakeHost({
    initial: {
      ...NOTHING_SAID,
      protection: { backend: "keyring", tmdbHeld: true },
    },
  });
  windowOver(host.transport);
  await waitFor(() =>
    expect(screen.getByTestId("protection")).toHaveTextContent("A TMDB key is held"),
  );

  fireEvent.click(screen.getByRole("button", { name: "Clear key" }));

  await waitFor(() =>
    expect(screen.getByTestId("protection")).toHaveTextContent("No TMDB key is held."),
  );
  expect(dispatched(host.invocations, "clear_tmdb_key").args).toEqual({
    envelope: { version: 1, action: { type: "clear_tmdb_key" } },
  });
});

test("a key the Host will not keep is explained, and no key is claimed held", async () => {
  const host = fakeHost({
    refuse: {
      kind: "invalid_tmdb_key",
      detail: "a key carries no spaces",
    },
  });
  windowOver(host.transport);
  await waitFor(() =>
    expect(screen.getByTestId("protection")).toHaveTextContent("No TMDB key is held."),
  );

  fireEvent.change(screen.getByLabelText("TMDB API key or read-access token"), {
    target: { value: "the key" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save key" }));

  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent(
      "will not keep that TMDB key: a key carries no spaces",
    ),
  );
  expect(
    screen.getByRole("alert"),
    "a refused value is never repeated back, not even to refuse it",
  ).not.toHaveTextContent("the key");
  expect(screen.getByTestId("protection")).toHaveTextContent("No TMDB key is held.");
  expect(screen.getByLabelText("TMDB API key or read-access token")).toHaveValue("the key");
});

test("a credential store that refuses is explained rather than swallowed", async () => {
  const host = fakeHost({
    refuse: { kind: "secret", detail: "the keyring is locked" },
  });
  windowOver(host.transport);
  await waitFor(() =>
    expect(screen.getByTestId("protection")).toHaveTextContent("No TMDB key is held."),
  );

  fireEvent.change(screen.getByLabelText("TMDB API key or read-access token"), {
    target: { value: "0123456789abcdef" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save key" }));

  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent(
      "could not keep that credential: the keyring is locked",
    ),
  );
  expect(screen.getByTestId("protection")).toHaveTextContent("No TMDB key is held.");
});

test("the window draws a row of posters for each catalog the Addon can be asked for", async () => {
  const host = fakeHost({ initial: { ...NOTHING_SAID, revision: 1, addons: [ADDON] } });

  windowOver(host.transport);

  const row = await screen.findByTestId("row-community.stremboxd-movie-letterboxd-popular");
  expect(row).toHaveTextContent("Popular This Week");
  const cards = row.querySelectorAll(".card");
  expect(Array.from(cards).map((card) => card.textContent)).toEqual([
    "The Matrix1999",
    "The Matrix Reloaded1999📄 The.Matrix.Reloaded.2003.2160p.WEB-DL • 📦 47.21 GB",
  ]);
  expect(row.querySelector("img")).toHaveAttribute("src", "https://example.com/tt0133093.jpg");
});

test("the window asks the Host for every catalog an Addon declares", async () => {
  const host = fakeHost({ initial: { ...NOTHING_SAID, revision: 1, addons: [ADDON] } });

  windowOver(host.transport);

  await screen.findByTestId("row-community.stremboxd-movie-letterboxd-popular");
  await screen.findByTestId("row-community.stremboxd-series-letterboxd-year");

  const browsed = host.invocations
    .filter(({ command }) => command === "dispatch")
    .map(({ args }) => (args?.envelope as { action: Action }).action)
    .filter((action) => action.type === "browse_catalog");
  expect(browsed).toEqual([
    {
      type: "browse_catalog",
      addon: "community.stremboxd",
      catalog: { type: "movie", id: "letterboxd-popular" },
      extra: [],
    },
    {
      type: "browse_catalog",
      addon: "community.stremboxd",
      catalog: { type: "movie", id: "letterboxd-search" },
      extra: [],
    },
    {
      type: "browse_catalog",
      addon: "community.stremboxd",
      catalog: { type: "series", id: "letterboxd-year" },
      extra: [],
    },
  ]);
});

test("a catalog the Host will not answer on its own is not drawn, and the others are", async () => {
  // The window does not decide which catalogs are browsable: it asks about every
  // one the Addon declares, and a catalog the Host refuses is simply not a row
  // (ADR-0010).
  const host = fakeHost({ initial: { ...NOTHING_SAID, revision: 1, addons: [ADDON] } });

  windowOver(host.transport);

  await screen.findByTestId("row-community.stremboxd-movie-letterboxd-popular");
  expect(
    screen.queryByTestId("row-community.stremboxd-movie-letterboxd-search"),
  ).not.toBeInTheDocument();
  expect(
    screen.getByTestId("row-community.stremboxd-series-letterboxd-year"),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("alert"),
    "a catalog the Host will not answer is not something to shout about",
  ).not.toBeInTheDocument();
});

test("a catalog with more items than one page can be paged through", async () => {
  const host = fakeHost({ initial: { ...NOTHING_SAID, revision: 1, addons: [ADDON] } });
  windowOver(host.transport);
  await screen.findByTestId("row-community.stremboxd-movie-letterboxd-popular");
  expect(screen.queryByText("The Matrix Resurrections")).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "More from Popular This Week" }));

  await waitFor(() => expect(screen.getByText("The Matrix Resurrections")).toBeInTheDocument());
  expect(screen.getByText("The Matrix")).toBeInTheDocument();
  expect(host.invocations).toContainEqual({
    command: "dispatch",
    args: {
      envelope: {
        version: 1,
        action: {
          type: "browse_catalog",
          addon: "community.stremboxd",
          catalog: { type: "movie", id: "letterboxd-popular" },
          // The first page brought two items, so the next page starts after them.
          extra: [{ name: "skip", value: "2" }],
        },
      },
    },
  });
});

test("searching asks the Host and shows what every Addon answered with", async () => {
  const host = fakeHost({ initial: { ...NOTHING_SAID, revision: 1, addons: [ADDON] } });
  windowOver(host.transport);
  await screen.findByTestId("row-community.stremboxd-movie-letterboxd-popular");

  fireEvent.change(screen.getByLabelText("Search the Addons that offer it"), {
    target: { value: "  matrix  " },
  });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));

  await waitFor(() => expect(screen.getByText("Found matrix")).toBeInTheDocument());
  expect(dispatched(host.invocations, "search_catalogs").args).toEqual({
    envelope: { version: 1, action: { type: "search_catalogs", query: "matrix" } },
  });
  expect(
    screen.queryByTestId("row-community.stremboxd-movie-letterboxd-popular"),
  ).not.toBeInTheDocument();
});

test("going back from a search returns to the rows", async () => {
  const host = fakeHost({ initial: { ...NOTHING_SAID, revision: 1, addons: [ADDON] } });
  windowOver(host.transport);
  await screen.findByTestId("row-community.stremboxd-movie-letterboxd-popular");
  fireEvent.change(screen.getByLabelText("Search the Addons that offer it"), {
    target: { value: "matrix" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  await screen.findByText("Found matrix");

  fireEvent.keyDown(document, { key: "Escape" });

  await waitFor(() =>
    expect(screen.getByTestId("row-community.stremboxd-movie-letterboxd-popular")).toBeInTheDocument(),
  );
  expect(screen.queryByText("Found matrix")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Search the Addons that offer it")).toHaveValue("");
});

test("the window is drivable with the arrow keys, with something always focused", async () => {
  const host = fakeHost({ initial: { ...NOTHING_SAID, revision: 1, addons: [ADDON] } });
  windowOver(host.transport);
  await screen.findByTestId("row-community.stremboxd-movie-letterboxd-popular");

  const search = screen.getByLabelText("Search the Addons that offer it");
  expect(document.activeElement).toBe(search);

  fireEvent.keyDown(document, { key: "ArrowDown" });
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Search" }));

  fireEvent.keyDown(document, { key: "ArrowDown" });
  expect(document.activeElement).toBe(screen.getByTestId("card-tt0133093"));

  fireEvent.keyDown(document, { key: "ArrowLeft" });
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Search" }));

  fireEvent.keyDown(document, { key: "ArrowUp" });
  expect(document.activeElement).toBe(search);
});

test("choosing a card opens the Title, and the card's Addon is asked for it", async () => {
  const host = fakeHost({ initial: { ...NOTHING_SAID, revision: 1, addons: [ADDON] } });
  windowOver(host.transport);
  await screen.findByTestId("card-tt0133093");

  fireEvent.click(screen.getByTestId("card-tt0133093"));

  const title = await screen.findByTestId("title-tt0133093");
  expect(screen.getByTestId("title-name")).toHaveTextContent("The Matrix");
  expect(title).toHaveTextContent("1999");
  expect(title).toHaveTextContent("136 min");
  expect(title).toHaveTextContent("8.7");
  expect(screen.getByTestId("title-id")).toHaveTextContent(
    "community.stremboxd · movie/tt0133093",
  );
  expect(
    screen.getByTestId("title-no-videos"),
    "a film is one Video: the film itself",
  ).toBeInTheDocument();
  expect(dispatched(host.invocations, "open_title")).toEqual({
    command: "dispatch",
    args: {
      envelope: {
        version: 1,
        action: {
          type: "open_title",
          addon: "community.stremboxd",
          title: { type: "movie", id: "tt0133093" },
        },
      },
    },
  });
});

test("a Title no TMDB record met stays visible and is marked unmapped", async () => {
  const host = fakeHost({ initial: { ...NOTHING_SAID, revision: 1, addons: [ADDON] } });
  windowOver(host.transport);

  fireEvent.click(await screen.findByTestId("card-tt0133093"));

  await screen.findByTestId("title-tt0133093");
  const unmapped = screen.getByTestId("title-unmapped");
  expect(unmapped).toHaveTextContent("Unmapped");
  expect(unmapped).toHaveTextContent("keyed by its Addon");
});

test("a Title a TMDB record met is not marked unmapped", async () => {
  const host = fakeHost({
    initial: { ...NOTHING_SAID, revision: 1, addons: [ADDON] },
    mapped: "tt0133093",
  });
  windowOver(host.transport);

  fireEvent.click(await screen.findByTestId("card-tt0133093"));

  await screen.findByTestId("title-tt0133093");
  expect(screen.queryByTestId("title-unmapped")).not.toBeInTheDocument();
});

test("opening a series shows its seasons, and pressing an episode asks for its Streams", async () => {
  const host = fakeHost({ initial: { ...NOTHING_SAID, revision: 1, addons: [ADDON] } });
  windowOver(host.transport);

  fireEvent.click(await screen.findByTestId("card-tt0903747"));

  await screen.findByTestId("title-tt0903747");
  expect(screen.getByText("Specials")).toBeInTheDocument();
  expect(screen.getByText("Season 1")).toBeInTheDocument();
  expect(screen.getByTestId("episode-tt0903747:0:1")).toHaveTextContent("S0E1");
  expect(screen.getByTestId("episode-tt0903747:1:1")).toHaveTextContent("S1E1");
  expect(screen.getByTestId("episode-tt0903747:1:1")).toHaveTextContent("Pilot");
  expect(
    screen.getByTestId("episode-tt0903747:1:2"),
    "two episodes are told apart by their own number and name",
  ).toHaveTextContent("S1E2");
  expect(screen.queryByTestId("title-no-videos")).not.toBeInTheDocument();

  fireEvent.click(screen.getByTestId("episode-tt0903747:1:2"));

  await screen.findByTestId("streams-heading");
  expect(screen.getByTestId("streams-heading")).toHaveTextContent(
    "Streams — S1E2 — Cat's in the Bag...",
  );
  expect(dispatched(host.invocations, "find_streams")).toEqual({
    command: "dispatch",
    args: {
      envelope: {
        version: 1,
        action: { type: "find_streams", video: { type: "series", id: "tt0903747:1:2" } },
      },
    },
  });

  // Backing out of the Stream list returns to the episodes, with the pressed
  // one still the one this client chose.
  fireEvent.keyDown(document, { key: "Escape" });

  await waitFor(() => expect(screen.queryByTestId("streams-heading")).not.toBeInTheDocument());
  expect(screen.getByTestId("episode-tt0903747:1:2")).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByTestId("episode-tt0903747:1:1")).toHaveAttribute("aria-pressed", "false");
});

test("pressing play on a film asks the Addons for the film's own Streams", async () => {
  const host = await filmStreams({ initial: { ...NOTHING_SAID, revision: 1, addons: [ADDON] } });

  expect(screen.getByTestId("streams-heading")).toHaveTextContent("Streams — The Matrix");
  expect(dispatched(host.invocations, "find_streams").args).toEqual({
    envelope: {
      version: 1,
      action: { type: "find_streams", video: { type: "movie", id: "tt0133093" } },
    },
  });
});

test("the Stream list is what each Addon answered, in order, badges and filenames and all", async () => {
  await filmStreams({ initial: { ...NOTHING_SAID, revision: 1, addons: [ADDON] } });

  // One group per Addon that answered, in the order they were configured, each
  // Addon's candidates in its own order: the Host re-ranks nothing and so does
  // the window.
  const candidates = screen.getAllByTestId(/^candidate-/);
  expect(candidates.map((candidate) => candidate.getAttribute("data-testid"))).toEqual([
    `candidate-${TORRENTIO}-0`,
    `candidate-${TORRENTIO}-1`,
    `candidate-${AIOSTREAMS}-0`,
  ]);

  const first = screen.getByTestId(`candidate-${TORRENTIO}-0`);
  expect(first).toHaveTextContent("Torrentio");
  expect(first).toHaveTextContent("4k HDR");
  expect(first).toHaveTextContent("The Matrix 1999 2160p UHD BluRay x265-GROUP");
  expect(within(first).getByTestId("stream-filename")).toHaveTextContent(
    "The.Matrix.1999.2160p.UHD.BluRay.x265-GROUP.mkv",
  );
  expect(first).toHaveTextContent("binge group torrentio|4k|BluRay|x265");
});

test("a candidate the Host cannot play is listed and marked rather than hidden", async () => {
  await filmStreams({ initial: { ...NOTHING_SAID, revision: 1, addons: [ADDON] } });

  expect(screen.getByTestId(`candidate-${TORRENTIO}-0`)).toHaveTextContent("Not playable yet");
  expect(
    screen.getByTestId(`candidate-${AIOSTREAMS}-0`),
    "a URL the Host can open carries no such mark",
  ).not.toHaveTextContent("Not playable yet");
});

test("a hint is shown beside a candidate without removing it", async () => {
  await filmStreams({ initial: { ...NOTHING_SAID, revision: 1, addons: [ADDON] } });

  const hinted = screen.getByTestId(`candidate-${AIOSTREAMS}-0`);
  expect(hinted).toHaveTextContent("Not web-ready");
  expect(hinted).toHaveTextContent("Wants request headers");
  expect(hinted).toHaveTextContent("AIOStreams");
  expect(hinted).toHaveTextContent("The.Matrix.1999.1080p.BluRay.x265-GROUP.mkv");
});

test("choosing a Stream marks it, and says what playing it means", async () => {
  await filmStreams({ initial: { ...NOTHING_SAID, revision: 1, addons: [ADDON] } });

  fireEvent.click(screen.getByTestId(`candidate-${AIOSTREAMS}-0`));

  expect(screen.getByTestId(`candidate-${AIOSTREAMS}-0`)).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByTestId(`candidate-${TORRENTIO}-0`)).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByTestId("chosen-stream")).toHaveTextContent("Chose AIOStreams");
  expect(screen.getByTestId("chosen-stream")).toHaveTextContent("playing it arrives in #27");
});

test("choosing a Stream the Host cannot play says so rather than promising playback", async () => {
  await filmStreams({ initial: { ...NOTHING_SAID, revision: 1, addons: [ADDON] } });

  fireEvent.click(screen.getByTestId(`candidate-${TORRENTIO}-0`));

  expect(screen.getByTestId("chosen-stream")).toHaveTextContent("Not playable yet");
  expect(screen.getByTestId("chosen-stream")).not.toHaveTextContent("#27");
});

test("an Addon that failed says so without blanking the other Addons' candidates", async () => {
  await filmStreams({
    initial: { ...NOTHING_SAID, revision: 1, addons: [ADDON] },
    failingStreams: TORRENTIO,
  });

  expect(within(screen.getByTestId(`streams-${TORRENTIO}`)).getByRole("alert")).toHaveTextContent(
    "status 503",
  );
  expect(
    screen.getByTestId(`candidate-${AIOSTREAMS}-0`),
    "the Addon that answered keeps its candidates",
  ).toBeInTheDocument();
});

test("an Addon whose answer held nothing playable says so rather than looking broken", async () => {
  await filmStreams({
    initial: { ...NOTHING_SAID, revision: 1, addons: [ADDON] },
    quietStreams: AIOSTREAMS,
  });

  expect(screen.getByTestId(`streams-${AIOSTREAMS}`)).toHaveTextContent(
    "answered nothing this Host can play",
  );
});

test("a Video no Addon offers Streams for says so rather than showing an empty list", async () => {
  await filmStreams({
    initial: { ...NOTHING_SAID, revision: 1, addons: [ADDON] },
    noStreamSources: true,
  });

  expect(screen.getByTestId("streams-none")).toHaveTextContent(
    "No configured Addon offers Streams for this Video",
  );
});

test("a Host that will not find Streams is explained, and the Videos stay where they were", async () => {
  const host = fakeHost({
    initial: { ...NOTHING_SAID, revision: 1, addons: [ADDON] },
    refuseStreams: { kind: "fetch", detail: "the Addon answered with status 503" },
  });
  windowOver(host.transport);
  fireEvent.click(await screen.findByTestId("card-tt0133093"));
  await screen.findByTestId("title-tt0133093");

  fireEvent.click(screen.getByTestId("play-film"));

  await screen.findByRole("alert");
  expect(screen.getByRole("alert")).toHaveTextContent("could not fetch");
  expect(screen.queryByTestId("streams-heading")).not.toBeInTheDocument();
  expect(
    screen.getByTestId("play-film"),
    "the Video it was pressed on is still the one being looked at",
  ).toBeInTheDocument();
});

test("backing out of a Title returns to the rows, and it can be opened again", async () => {
  const host = fakeHost({ initial: { ...NOTHING_SAID, revision: 1, addons: [ADDON] } });
  windowOver(host.transport);
  fireEvent.click(await screen.findByTestId("card-tt0133093"));
  await screen.findByTestId("title-tt0133093");

  fireEvent.keyDown(document, { key: "Escape" });

  await waitFor(() => expect(screen.getByTestId("card-tt0133093")).toBeInTheDocument());
  expect(screen.queryByTestId("title-tt0133093")).not.toBeInTheDocument();

  fireEvent.click(screen.getByTestId("card-tt0133093"));

  await screen.findByTestId("title-tt0133093");
  expect(screen.getByTestId("title-name")).toHaveTextContent("The Matrix");
});

test("a series whose Addon listed no episodes says so rather than being called a film", async () => {
  const host = fakeHost({
    initial: { ...NOTHING_SAID, revision: 1, addons: [ADDON] },
    noEpisodes: "tt0903747",
  });
  windowOver(host.transport);

  fireEvent.click(await screen.findByTestId("card-tt0903747"));

  await screen.findByTestId("title-tt0903747");
  expect(screen.getByTestId("title-no-videos")).toHaveTextContent("listed no episodes");
});

test("a Title its Addon said little about falls back to the card it was opened from", async () => {
  // The Host reads a meta answer leniently, so a Title can come back as little
  // more than the identity the client already had. The card it clicked holds a
  // name and a poster, and they stand in for what the Addon did not repeat.
  const host = fakeHost({
    initial: { ...NOTHING_SAID, revision: 1, addons: [ADDON] },
    sparse: "tt0133093",
  });
  windowOver(host.transport);

  fireEvent.click(await screen.findByTestId("card-tt0133093"));

  await screen.findByTestId("title-tt0133093");
  expect(screen.getByTestId("title-name")).toHaveTextContent("The Matrix");
  expect(screen.getByTestId("title-name")).not.toHaveTextContent("tt0133093");
  expect(screen.getByTestId("title-poster")).toHaveAttribute(
    "src",
    "https://example.com/tt0133093.jpg",
  );
});

test("a Title the Host will not open is explained and leaves the rows where they were", async () => {
  const host = fakeHost({
    initial: { ...NOTHING_SAID, revision: 1, addons: [ADDON] },
    refuseTitle: {
      kind: "unknown_title",
      addon: "community.stremboxd",
      title: { type: "series", id: "tt0903747" },
    },
  });
  windowOver(host.transport);

  fireEvent.click(await screen.findByTestId("card-tt0133093"));

  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("offers no meta for series/tt0903747"),
  );
  expect(screen.queryByTestId("title-tt0133093")).not.toBeInTheDocument();
  expect(screen.getByTestId("card-tt0133093")).toBeInTheDocument();
});

test("a row whose Addon did not answer says so without blanking the other rows", async () => {
  const host = fakeHost({
    initial: { ...NOTHING_SAID, revision: 1, addons: [ADDON] },
    failing: "letterboxd-popular",
  });

  windowOver(host.transport);

  const failed = await screen.findByTestId("row-community.stremboxd-movie-letterboxd-popular");
  await waitFor(() =>
    expect(failed.querySelector('[role="alert"]')).toHaveTextContent(
      "could not fetch that Addon",
    ),
  );
  expect(screen.getByTestId("row-community.stremboxd-series-letterboxd-year")).toBeInTheDocument();
});

test("the arrows leave the caret alone while a person is typing a search", async () => {
  const host = fakeHost({ initial: { ...NOTHING_SAID, revision: 1, addons: [ADDON] } });
  windowOver(host.transport);
  await screen.findByTestId("row-community.stremboxd-movie-letterboxd-popular");

  const search = screen.getByLabelText("Search the Addons that offer it");
  search.focus();
  fireEvent.change(search, { target: { value: "matrix" } });

  fireEvent.keyDown(document, { key: "ArrowLeft" });
  expect(document.activeElement).toBe(search);
  fireEvent.keyDown(document, { key: "ArrowRight" });
  expect(
    document.activeElement,
    "a typo in the box is the caret's business, not the focus order's",
  ).toBe(search);

  fireEvent.keyDown(document, { key: "ArrowDown" });
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Search" }));
});

test("focus is put back when the control it was on goes away", async () => {
  const host = fakeHost({ initial: { ...NOTHING_SAID, revision: 1, addons: [ADDON] } });
  windowOver(host.transport);
  await screen.findByTestId("row-community.stremboxd-movie-letterboxd-popular");
  fireEvent.change(screen.getByLabelText("Search the Addons that offer it"), {
    target: { value: "matrix" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  const back = await screen.findByRole("button", { name: "Back to browsing" });
  back.focus();

  fireEvent.click(back);

  await waitFor(() => expect(document.activeElement).not.toBe(document.body));
  expect(
    document.activeElement,
    "the focus ring is somewhere a person can see it",
  ).toBe(screen.getByLabelText("Search the Addons that offer it"));
});

test("a row whose Addon failed keeps its way to ask again", async () => {
  const host = fakeHost({
    initial: { ...NOTHING_SAID, revision: 1, addons: [ADDON] },
    failing: "letterboxd-popular",
  });
  windowOver(host.transport);

  await screen.findByTestId("row-community.stremboxd-movie-letterboxd-popular");

  expect(
    screen.getByRole("button", { name: "More from Popular This Week" }),
    "an Addon that went down and came back is retried, not stranded",
  ).toBeInTheDocument();
});

test("a card shows what the Addon said about the item, which is how two releases are told apart", async () => {
  // A catalog of releases gives every entry one poster and one title, and puts
  // the filename — the only thing that tells two of them apart — in the
  // description. It is drawn, clamped, with the whole of it on the tooltip.
  const host = fakeHost({ initial: { ...NOTHING_SAID, revision: 1, addons: [ADDON] } });

  windowOver(host.transport);

  const card = await screen.findByTestId("card-tt0234215");
  expect(card).toHaveTextContent("The Matrix Reloaded");
  expect(card).toHaveTextContent("The.Matrix.Reloaded.2003.2160p.WEB-DL");
  expect(card.querySelector(".card-note")).toHaveAttribute(
    "title",
    "📄 The.Matrix.Reloaded.2003.2160p.WEB-DL • 📦 47.21 GB",
  );
  expect(
    screen.getByTestId("card-tt0133093").querySelector(".card-note"),
    "an item the Addon said nothing about is given no caption",
  ).not.toBeInTheDocument();
});
