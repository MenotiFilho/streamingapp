/**
 * The preview transport: the repertory prototype's live window without a Host.
 *
 * A browser has no Tauri IPC, so behind `VITE_UI=repertory` in a plain Vite
 * window this transport answers the two Actions Home needs — `browse_catalog`
 * and `open_title` — from the public Cinemeta addon. It reads the live
 * catalogue, keeps artwork on Metahub's CDN, and invents no posters. Continue
 * watching is sample progress built from the same live films, and Home says so.
 *
 * This is not a second Host and never runs in the Tauri window: there the real
 * HostClient is used, with the same repertory frame on top.
 */

import type {
  Action,
  ActionError,
  Response,
  Snapshot,
  Title,
  Transport,
  Video,
} from "../../host-client";
import { cinemetaPreviews, sampleResumeEntries, type CinemetaMeta } from "./preview";

const CINEMETA = "https://v3-cinemeta.strem.io";
const ADDON = "cinemeta";

const SKIP = { name: "skip", isRequired: false, options: [], optionsLimit: 0 };

const CATALOGS = [
  { type: "movie", id: "top", name: "Popular", extra: [SKIP] },
  { type: "movie", id: "imdbRating", name: "Top Rated", extra: [SKIP] },
  { type: "series", id: "top", name: "Popular Series", extra: [SKIP] },
  { type: "series", id: "imdbRating", name: "Top Rated Series", extra: [SKIP] },
] as const;

type CinemetaPage = {
  metas: CinemetaMeta[];
  hasMore: boolean;
};

const pages = new Map<string, Promise<CinemetaPage>>();

function pageKey(type: string, id: string, skip: number): string {
  return `${type}/${id}/${skip}`;
}

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText || "the Addon did not answer"}`);
  }
  return (await response.json()) as T;
}

function fetchPage(type: string, id: string, skip: number): Promise<CinemetaPage> {
  const key = pageKey(type, id, skip);
  const held = pages.get(key);
  if (held) {
    return held;
  }
  const request = readJson<{ metas?: CinemetaMeta[]; hasMore?: boolean }>(
    `${CINEMETA}/catalog/${type}/${id}${skip > 0 ? `/skip=${skip}` : ""}.json`,
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
  const { type, id } = action.catalog;
  const name = CATALOGS.find((catalog) => catalog.type === type && catalog.id === id)?.name ?? id;
  return fetchPage(type, id, Number.isFinite(skip) ? Math.max(0, skip) : 0)
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
