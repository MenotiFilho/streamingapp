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
 * The utility screens (#147) also take the Actions the Host already has:
 * `add_addon` fetches a real manifest, and the register, preferences,
 * credentials and paired devices are kept in this window and published as
 * Snapshots. The address, pairing code and devices are samples named as such;
 * no new Action is invented, and the preview never runs in Tauri, where the
 * real HostClient answers with the Host's own state.
 */

import {
  SNAPSHOT_EVENT,
  type Action,
  type ActionError,
  type AddonManifest,
  type CatalogRow,
  type Response,
  type Snapshot,
  type Title,
  type Transport,
  type Video,
} from "../../host-client";
import {
  cinemetaPreviews,
  CINEMETA_MOVIE_GENRES,
  CINEMETA_SERIES_GENRES,
  previewStream,
  sampleLibrary,
  sampleResumeEntries,
  type CinemetaMeta,
  type PreviewStream,
} from "./preview";
import {
  manifestFrom,
  PREVIEW_ADDRESS,
  PREVIEW_DEVICES,
  PREVIEW_PAIRING_CODE,
  removedAddon,
  reorderedAddons,
} from "./previewState";

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

/**
 * The preview's account Library: live Cinemeta films as a sample collection.
 * The Vite window has no Stremio account, so the rows say they are a rehearsal;
 * the Tauri window asks the Host (#165, ADR-0029).
 */
async function answerLibrary(): Promise<Response> {
  try {
    const page = await fetchPage("movie", "top", 0);
    return {
      snapshots: [],
      answer: {
        library: { entries: sampleLibrary(page.metas), failure: null },
      },
    };
  } catch (caught: unknown) {
    return {
      snapshots: [],
      answer: {
        library: {
          entries: [],
          failure: failure(caught instanceof Error ? caught.message : "the catalogue did not answer"),
        },
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

async function buildSnapshot(): Promise<Snapshot> {
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
    devices: PREVIEW_DEVICES.map((device) => ({ ...device })),
    pairingCode: PREVIEW_PAIRING_CODE,
    address: PREVIEW_ADDRESS,
  };
}

/**
 * The one Snapshot the preview keeps. A real Host publishes a new revision on
 * every Change; the preview does the same locally so the window's screens read
 * their answers from Snapshots exactly as they do in Tauri.
 */
let current: Snapshot | null = null;
let booting: Promise<Snapshot> | null = null;
let subscriber: ((event: { payload: Snapshot }) => void) | null = null;

async function ensureSnapshot(): Promise<Snapshot> {
  if (current) {
    return current;
  }
  booting ??= buildSnapshot().then((state) => {
    current = state;
    return state;
  });
  return booting;
}

function publish(next: Snapshot): Response {
  current = next;
  subscriber?.({ payload: next });
  return { snapshots: [next], answer: null };
}

function change(patch: (state: Snapshot) => Partial<Snapshot>): Response {
  if (!current) {
    throw {
      kind: "unreachable",
      detail: "the preview has not read its first Snapshot",
    } satisfies ActionError;
  }
  return publish({ ...current, ...patch(current), revision: current.revision + 1 });
}

function refuse(error: ActionError): never {
  throw error;
}

/** `add_addon`: fetch the real manifest and put it in the preview's register. */
async function addAddon(
  action: Extract<Action, { type: "add_addon" }>,
): Promise<Response> {
  const url = action.url.trim();
  let raw: unknown;
  try {
    raw = await readJson<unknown>(url);
  } catch (caught) {
    return refuse({
      kind: "fetch",
      url,
      detail: caught instanceof Error ? caught.message : "the Addon did not answer",
    });
  }
  const manifest = manifestFrom(url, raw);
  const state = await ensureSnapshot();
  const known = state.addons.some((addon) => addon.id === manifest.id);
  return publish({
    ...state,
    revision: state.revision + 1,
    addons: known
      ? state.addons.map((addon) => (addon.id === manifest.id ? manifest : addon))
      : [...state.addons, manifest],
  });
}

function reorderAddon(
  action: Extract<Action, { type: "reorder_addon" }>,
): Response {
  const addons = reorderedAddons(current?.addons ?? [], action.id, action.position);
  if (!current || !addons) {
    return refuse({
      kind: "invalid_position",
      id: action.id,
      position: action.position,
      count: current?.addons.length ?? 0,
    });
  }
  return change(() => ({ addons }));
}

function removeAddon(
  action: Extract<Action, { type: "remove_addon" }>,
): Response {
  const addons = removedAddon(current?.addons ?? [], action.id);
  if (!addons) {
    return refuse({ kind: "unknown_addon", id: action.id });
  }
  return change((state) => ({
    addons,
    featuredCatalog:
      state.featuredCatalog?.addon === action.id ? null : state.featuredCatalog,
  }));
}

function setFeatured(
  action: Extract<Action, { type: "set_featured_catalog" }>,
): Response {
  const addon = current?.addons.find((held) => held.id === action.addon);
  const catalog = addon?.catalogs.find(
    (held) => held.type === action.catalog.type && held.id === action.catalog.id,
  );
  if (!addon || !catalog) {
    return refuse({
      kind: "unknown_catalog",
      addon: action.addon,
      catalog: { ...action.catalog },
    });
  }
  return change(() => ({
    featuredCatalog: { addon: action.addon, catalog: { ...action.catalog } },
  }));
}

/** The existing utility Actions, answered locally and published as a Snapshot. */
async function dispatch(action: Action): Promise<Response> {
  await ensureSnapshot();
  switch (action.type) {
    case "add_addon":
      return addAddon(action);
    case "reorder_addon":
      return reorderAddon(action);
    case "remove_addon":
      return removeAddon(action);
    case "set_tmdb_key": {
      if (!action.key.trim()) {
        return refuse({ kind: "invalid_tmdb_key", detail: "the key is empty" });
      }
      return change((state) => ({
        protection: { ...state.protection, tmdbHeld: true },
      }));
    }
    case "clear_tmdb_key":
      return change((state) => ({
        protection: { ...state.protection, tmdbHeld: false },
      }));
    case "sign_in_stremio": {
      if (!action.email.trim() || !action.password) {
        return refuse({
          kind: "invalid_stremio_login",
          detail: "an email and a password are needed",
        });
      }
      return change((state) => ({
        protection: { ...state.protection, stremioHeld: true },
      }));
    }
    case "sign_out_stremio":
      return change((state) => ({
        protection: { ...state.protection, stremioHeld: false },
      }));
    case "set_subtitle_language": {
      const language = action.language.trim();
      if (!language) {
        return refuse({ kind: "invalid_subtitle_language", language });
      }
      return change((state) => ({
        preferences: { ...state.preferences, subtitleLanguage: language },
      }));
    }
    case "clear_subtitle_language":
      return change((state) => ({
        preferences: { ...state.preferences, subtitleLanguage: null },
      }));
    case "set_subtitle_color": {
      if (!/^#[0-9a-fA-F]{6}$/.test(action.color)) {
        return refuse({ kind: "invalid_subtitle_color", color: action.color });
      }
      return change((state) => ({
        preferences: { ...state.preferences, subtitleColor: action.color.toUpperCase() },
      }));
    }
    case "set_subtitle_scale": {
      if (!Number.isFinite(action.scale) || action.scale < 0.5 || action.scale > 2) {
        return refuse({ kind: "invalid_subtitle_scale", scale: String(action.scale) });
      }
      return change((state) => ({
        preferences: { ...state.preferences, subtitleScale: action.scale },
      }));
    }
    case "set_stream_buffer": {
      if (
        !Number.isFinite(action.seconds) ||
        !Number.isFinite(action.megabytes) ||
        action.seconds <= 0 ||
        action.megabytes <= 0
      ) {
        return refuse({
          kind: "invalid_stream_buffer",
          seconds: String(action.seconds),
          value: String(action.megabytes),
        });
      }
      return change((state) => ({
        preferences: {
          ...state.preferences,
          streamBuffer: { seconds: action.seconds, megabytes: action.megabytes },
        },
      }));
    }
    case "set_featured_catalog":
      return setFeatured(action);
    case "clear_featured_catalog":
      return change(() => ({ featuredCatalog: null }));
    case "revoke_device": {
      if (!current?.devices.some((device) => device.id === action.id)) {
        return refuse({ kind: "unknown_device", id: action.id });
      }
      return change((state) => ({
        devices: state.devices.filter((device) => device.id !== action.id),
      }));
    }
    case "library":
      return answerLibrary();
    case "browse_catalog":
      return answerCatalog(action);
    case "open_title":
      return answerOpenTitle(action);
    case "search_catalogs":
      return answerSearchCatalogs(action);
    case "find_streams":
      return answerStreams(action);
    default:
      return { snapshots: [], answer: null };
  }
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (command === "snapshot") {
    return (await ensureSnapshot()) as T;
  }
  if (command === "dispatch") {
    const envelope = args?.envelope as { action?: Action } | undefined;
    if (!envelope?.action) {
      const none: Response = { snapshots: [], answer: null };
      return none as T;
    }
    return (await dispatch(envelope.action)) as T;
  }
  const none: Response = { snapshots: [], answer: null };
  return none as T;
}

/** The transport a plain Vite window uses behind the flag. */
export const previewTransport: Transport = {
  invoke,
  listen: async <T>(event: string, handler: (event: { payload: T }) => void) => {
    if (event !== SNAPSHOT_EVENT) {
      return () => undefined;
    }
    // A StrictMode mount/unmount/remount can deliver the first listener's
    // cleanup after the second listener is installed. Only clear the subscriber
    // that this call installed; a stale cleanup must not silence the new one.
    const listener = handler as (event: { payload: Snapshot }) => void;
    subscriber = listener;
    const state = await ensureSnapshot();
    if (subscriber === listener) {
      listener({ payload: state });
    }
    return () => {
      if (subscriber === listener) {
        subscriber = null;
      }
    };
  },
};
