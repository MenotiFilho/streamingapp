/**
 * The preview transport: the repertory prototype's live window without a Host.
 *
 * A browser has no Tauri IPC, so behind `VITE_UI=repertory` in a plain Vite
 * window this transport answers the Actions the browse screens ask —
 * `browse_catalog`, `open_title`, `search_catalogs` and `find_streams` — from
 * two public Addons: Cinemeta for metadata and Torrentio for candidates. It
 * reads the live catalogues, keeps artwork on Metahub's CDN, and invents no
 * posters; the torrent candidates are real and marked unplayable by this Host.
 * Continue watching is sample progress built from the same live films, and Home
 * says so.
 *
 * This is not a second Host and never runs in the Tauri window: there the real
 * HostClient is used, with the same repertory frame on top.
 */

import type {
  Action,
  ActionError,
  AddonManifest,
  CatalogRow,
  Response,
  Snapshot,
  Title,
  Transport,
  Video,
} from "../../host-client";
import {
  cinemetaPreviews,
  CINEMETA_MOVIE_GENRES,
  CINEMETA_SERIES_GENRES,
  previewStream,
  sampleResumeEntries,
  type CinemetaMeta,
  type PreviewStream,
} from "./preview";

const CINEMETA = "https://v3-cinemeta.strem.io";
const ADDON = "cinemeta";

const TORRENTIO = "https://torrentio.strem.fun";
const TORRENTIO_ID = "torrentio";

const SKIP = { name: "skip", isRequired: false, options: [], optionsLimit: 0 };
const SEARCH = { name: "search", isRequired: false, options: [], optionsLimit: 0 };

function genreExtra(options: readonly string[]) {
  return { name: "genre", isRequired: false, options: [...options], optionsLimit: 0 };
}

const CATALOGS = [
  {
    type: "movie",
    id: "top",
    name: "Popular",
    extra: [genreExtra(CINEMETA_MOVIE_GENRES), SEARCH, SKIP],
  },
  {
    type: "movie",
    id: "imdbRating",
    name: "Top Rated",
    extra: [genreExtra(CINEMETA_MOVIE_GENRES), SKIP],
  },
  {
    type: "series",
    id: "top",
    name: "Popular Series",
    extra: [genreExtra(CINEMETA_SERIES_GENRES), SEARCH, SKIP],
  },
  {
    type: "series",
    id: "imdbRating",
    name: "Top Rated Series",
    extra: [genreExtra(CINEMETA_SERIES_GENRES), SKIP],
  },
] as const;

const TORRENTIO_MANIFEST: AddonManifest = {
  id: TORRENTIO_ID,
  name: "Torrentio",
  version: "0.0.14",
  resources: [{ name: "stream", types: ["movie", "series"], idPrefixes: ["tt"] }],
  types: ["movie", "series"],
  catalogs: [],
  idPrefixes: ["tt"],
  behaviorHints: { configurable: false, configurationRequired: false },
};

type CinemetaPage = {
  metas: CinemetaMeta[];
  hasMore: boolean;
};

const pages = new Map<string, Promise<CinemetaPage>>();

function pageKey(type: string, id: string, skip: number, genre: string | null): string {
  return `${type}/${id}/${skip}/${genre ?? ""}`;
}

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText || "the Addon did not answer"}`);
  }
  return (await response.json()) as T;
}

function fetchPage(
  type: string,
  id: string,
  skip: number,
  genre: string | null = null,
): Promise<CinemetaPage> {
  const key = pageKey(type, id, skip, genre);
  const held = pages.get(key);
  if (held) {
    return held;
  }
  const extra = [
    genre ? `genre=${encodeURIComponent(genre)}` : null,
    skip > 0 ? `skip=${skip}` : null,
  ]
    .filter((part): part is string => part !== null)
    .join("&");
  const request = readJson<{ metas?: CinemetaMeta[]; hasMore?: boolean }>(
    `${CINEMETA}/catalog/${type}/${id}${extra ? `/${extra}` : ""}.json`,
  ).then((body) => ({
    metas: Array.isArray(body.metas) ? body.metas : [],
    hasMore: body.hasMore === true,
  }));
  // A failed page is not cached: the next call is a retry, not a permanent hole.
  request.catch(() => pages.delete(key));
  pages.set(key, request);
  return request;
}

function failure(detail: string): ActionError {
  return { kind: "fetch", detail };
}

function answerCatalog(
  action: Extract<Action, { type: "browse_catalog" }>,
): Promise<Response> {
  const skip = Number(action.extra.find((extra) => extra.name === "skip")?.value ?? 0);
  const genre = action.extra.find((extra) => extra.name === "genre")?.value.trim() || null;
  const { type, id } = action.catalog;
  const name = CATALOGS.find((catalog) => catalog.type === type && catalog.id === id)?.name ?? id;
  return fetchPage(type, id, Number.isFinite(skip) ? Math.max(0, skip) : 0, genre)
    .then((page) => {
      const metas = cinemetaPreviews(page.metas, type);
      return {
        snapshots: [],
        answer: {
          catalogs: [
            {
              addon: ADDON,
              type,
              id,
              name,
              sent: page.metas.length,
              metas,
              // The Addon's own `hasMore` is the honest end of the row; a page
              // that filled no items is also an end even when Cinemeta says more.
              failure: null,
            },
          ],
        },
      } satisfies Response;
    })
    .catch((caught: unknown) => ({
      snapshots: [],
      answer: {
        catalogs: [
          {
            addon: ADDON,
            type,
            id,
            name,
            sent: 0,
            metas: [],
            failure: failure(caught instanceof Error ? caught.message : "the Addon did not answer"),
          },
        ],
      },
    }));
}

/**
 * A keyless search, as the Host's `search_catalogs` would answer it: one row
 * per searchable Cinemeta catalogue, in the order the catalogues are declared.
 * The window never sees a Cinemeta URL or field name.
 */
async function answerSearchCatalogs(
  action: Extract<Action, { type: "search_catalogs" }>,
): Promise<Response> {
  const query = action.query.trim();
  const searchable = CATALOGS.filter((catalog) =>
    catalog.extra.some((extra) => extra.name === "search"),
  );
  const rows = await Promise.all(
    searchable.map(async (catalog): Promise<CatalogRow> => {
      try {
        const body = await readJson<{ metas?: CinemetaMeta[] }>(
          `${CINEMETA}/catalog/${catalog.type}/${catalog.id}/search=${encodeURIComponent(query)}.json`,
        );
        const metas = Array.isArray(body.metas) ? body.metas : [];
        return {
          addon: ADDON,
          type: catalog.type,
          id: catalog.id,
          name: catalog.name,
          sent: metas.length,
          metas: cinemetaPreviews(metas, catalog.type),
          failure: null,
        };
      } catch (caught: unknown) {
        return {
          addon: ADDON,
          type: catalog.type,
          id: catalog.id,
          name: catalog.name,
          sent: 0,
          metas: [],
          failure: failure(caught instanceof Error ? caught.message : "the Addon did not answer"),
        };
      }
    }),
  );
  return { snapshots: [], answer: { catalogs: rows } };
}

/**
 * The Streams a Video has in the preview: Torrentio's real candidates, carried
 * the way the Host carries them. They are torrents, so this Host marks every
 * one unplayable — that mark is part of what the list has to show.
 */
async function answerStreams(
  action: Extract<Action, { type: "find_streams" }>,
): Promise<Response> {
  const { type, id } = action.video;
  try {
    const body = await readJson<{ streams?: PreviewStream[] }>(
      `${TORRENTIO}/stream/${type}/${id}.json`,
    );
    const streams = (Array.isArray(body.streams) ? body.streams : [])
      .map(previewStream)
      .filter((stream) => stream !== null);
    return {
      snapshots: [],
      answer: { streams: [{ addon: TORRENTIO_ID, streams, failure: null }] },
    };
  } catch (caught: unknown) {
    return {
      snapshots: [],
      answer: {
        streams: [
          {
            addon: TORRENTIO_ID,
            streams: [],
            failure: failure(caught instanceof Error ? caught.message : "the Addon did not answer"),
          },
        ],
      },
    };
  }
}

function videosOf(raw: { videos?: unknown }): Video[] {
  if (!Array.isArray(raw.videos)) {
    return [];
  }
  return raw.videos.flatMap((video) => {
    if (!video || typeof video !== "object") {
      return [];
    }
    const held = video as {
      id?: string;
      name?: string;
      season?: number;
      episode?: number;
      thumbnail?: string;
    };
    if (!held.id) {
      return [];
    }
    return [
      {
        id: held.id,
        name: held.name ?? null,
        season: typeof held.season === "number" ? held.season : null,
        episode: typeof held.episode === "number" ? held.episode : null,
        thumbnail: held.thumbnail ?? null,
      },
    ];
  });
}

async function answerOpenTitle(
  action: Extract<Action, { type: "open_title" }>,
): Promise<Response> {
  const { type, id } = action.title;
  const body = await readJson<{ meta?: Record<string, unknown> }>(
    `${CINEMETA}/meta/${type}/${id}.json`,
  );
  const raw = body.meta;
  if (!raw || typeof raw.name !== "string") {
    return { snapshots: [], answer: null };
  }
  const title: Title = {
    addon: ADDON,
    id,
    key: { kind: "addon", addon: ADDON, id },
    type,
    name: raw.name,
    poster: typeof raw.poster === "string" ? raw.poster : null,
    background: typeof raw.background === "string" ? raw.background : null,
    logo: typeof raw.logo === "string" ? raw.logo : null,
    description: typeof raw.description === "string" ? raw.description : null,
    releaseInfo: typeof raw.releaseInfo === "string" ? raw.releaseInfo : null,
    runtime: typeof raw.runtime === "string" ? raw.runtime : null,
    imdbRating: typeof raw.imdbRating === "string" ? raw.imdbRating : null,
    genres: Array.isArray(raw.genres)
      ? raw.genres.filter((genre): genre is string => typeof genre === "string")
      : [],
    videos: videosOf(raw),
  };
  return { snapshots: [], answer: { title } };
}

async function snapshot(): Promise<Snapshot> {
  let watchProgress: Snapshot["watchProgress"] = [];
  try {
    const page = await fetchPage("movie", "top", 0);
    watchProgress = sampleResumeEntries(page.metas, 4);
  } catch {
    // The programme can still draw its rows; Continue watching is the only
    // thing that needs this page before the rows arrive.
  }

  return {
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
    addons: [
      {
        id: ADDON,
        name: "Cinemeta",
        version: "3.0.14",
        resources: [
          { name: "catalog", types: null, idPrefixes: null },
          { name: "meta", types: null, idPrefixes: null },
        ],
        types: ["movie", "series"],
        catalogs: CATALOGS.map((catalog) => ({ ...catalog, extra: [...catalog.extra] })),
        idPrefixes: ["tt"],
        behaviorHints: { configurable: false, configurationRequired: false },
      },
      TORRENTIO_MANIFEST,
    ],
    featuredCatalog: { addon: ADDON, catalog: { type: "movie", id: "top" } },
    protection: { backend: "file", tmdbHeld: false, stremioHeld: false },
    watchProgress,
    devices: [],
    pairingCode: "----",
    address: null,
  };
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (command === "snapshot") {
    return (await snapshot()) as T;
  }
  if (command === "dispatch") {
    const envelope = args?.envelope as { action?: Action } | undefined;
    const action = envelope?.action;
    if (!action) {
      const none: Response = { snapshots: [], answer: null };
      return none as T;
    }
    if (action.type === "browse_catalog") {
      return (await answerCatalog(action)) as T;
    }
    if (action.type === "open_title") {
      return (await answerOpenTitle(action)) as T;
    }
    if (action.type === "search_catalogs") {
      return (await answerSearchCatalogs(action)) as T;
    }
    if (action.type === "find_streams") {
      return (await answerStreams(action)) as T;
    }
  }
  const none: Response = { snapshots: [], answer: null };
  return none as T;
}

/** The transport a plain Vite window uses behind the flag. */
export const previewTransport: Transport = {
  invoke,
  listen: async <T>(_event: string, _handler: (event: { payload: T }) => void) => {
    // A preview has one static Snapshot; there is no Host to publish another.
    return () => undefined;
  },
};
