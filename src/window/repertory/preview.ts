/**
 * The mapping between a live Cinemeta answer and the Host's own vocabulary.
 *
 * The prototype's preview transport reads the public Cinemeta addon directly;
 * this module holds the pure translation so a test can check it without a
 * network and so no component ever sees a Cinemeta field name. Artwork stays
 * a URL into Metahub — the repository commits no poster or backdrop.
 */

import type {
  Chapter,
  LibraryEntry,
  MetaPreview,
  NowPlaying,
  PlaybackSnapshot,
  ResumeEntry,
  Stream,
  StreamWarning,
  Track,
} from "../../core/wire";

/**
 * The one Addon the plain Vite preview reads. The Tauri window reads the Host's
 * configured Addons; this name is only the preview transport's own catalogue.
 */
export const PREVIEW_ADDON = "cinemeta";

/** Cinemeta's own genre lists, as its manifest declares them. */
export const CINEMETA_MOVIE_GENRES = [
  "Action",
  "Adventure",
  "Animation",
  "Biography",
  "Comedy",
  "Crime",
  "Documentary",
  "Drama",
  "Family",
  "Fantasy",
  "History",
  "Horror",
  "Mystery",
  "Romance",
  "Sci-Fi",
  "Sport",
  "Thriller",
  "War",
  "Western",
] as const;

export const CINEMETA_SERIES_GENRES = [
  ...CINEMETA_MOVIE_GENRES,
  "Reality-TV",
  "Talk-Show",
  "Game-Show",
] as const;

/** The fields of a Cinemeta catalog item this prototype reads. */
export type CinemetaMeta = {
  imdb_id?: string;
  id?: string;
  name?: string;
  type?: string;
  poster?: string;
  background?: string;
  description?: string;
  year?: string;
  releaseInfo?: string;
  imdbRating?: string;
  genre?: string[];
  genres?: string[];
  runtime?: string;
};

/** The id a catalogue item is keyed by, or null when the Addon sent neither. */
export function cinemetaId(meta: CinemetaMeta): string | null {
  return meta.imdb_id?.trim() || meta.id?.trim() || null;
}

/** Parse `107 min` and `1h 47min` into seconds; anything else is unknown. */
export function parseRuntimeSeconds(runtime: string | null | undefined): number | null {
  if (!runtime) {
    return null;
  }
  const hours = runtime.match(/(\d+)\s*h/i);
  const minutes = runtime.match(/(\d+)\s*m/i);
  const seconds = (hours ? Number(hours[1]) * 3600 : 0) + (minutes ? Number(minutes[1]) * 60 : 0);
  return seconds > 0 ? seconds : null;
}

/** One Cinemeta item as a Meta preview, or null when it has no identity to open. */
export function cinemetaPreview(meta: CinemetaMeta, fallbackType: string): MetaPreview | null {
  const id = cinemetaId(meta);
  const name = meta.name?.trim();
  if (!id || !name) {
    return null;
  }
  return {
    id,
    type: meta.type?.trim() || fallbackType,
    name,
    poster: meta.poster?.trim() || null,
    posterShape: "poster",
    background: meta.background?.trim() || null,
    releaseInfo: meta.releaseInfo?.trim() || meta.year?.trim() || null,
    imdbRating: meta.imdbRating?.trim() || null,
    genres: (meta.genres ?? meta.genre ?? []).filter((genre) => genre.trim().length > 0),
    description: meta.description?.trim() || null,
  };
}

/** Every usable item in one Cinemeta page, in the Addon's own order. */
export function cinemetaPreviews(metas: readonly CinemetaMeta[], fallbackType: string): MetaPreview[] {
  return metas
    .map((meta) => cinemetaPreview(meta, fallbackType))
    .filter((meta): meta is MetaPreview => meta !== null);
}

/** The fields of a stream response this preview reads, as Addons in the wild send them. */
export type PreviewStream = {
  name?: string;
  title?: string;
  description?: string;
  url?: string;
  infoHash?: string;
  fileIdx?: number;
  sources?: string[];
  behaviorHints?: {
    notWebReady?: boolean;
    p2p?: boolean;
    proxyHeaders?: unknown;
    filename?: string;
    bingeGroup?: string;
  };
};

/** A hint's warnings, in the Host's own order and vocabulary (ADR-0009). */
function warningsOf(hints: PreviewStream["behaviorHints"]): StreamWarning[] {
  if (!hints) {
    return [];
  }
  const warnings: StreamWarning[] = [];
  if (hints.notWebReady === true) {
    warnings.push("not_web_ready");
  }
  if (hints.p2p === true) {
    warnings.push("p2p");
  }
  if (hints.proxyHeaders && typeof hints.proxyHeaders === "object") {
    warnings.push("proxy_headers");
  }
  return warnings;
}

/**
 * One Addon candidate as the Host would carry it: the Addon's words verbatim,
 * where its bytes are, the hints it declares, and the filename and binge group.
 * An object with no playable location is dropped, the way the Host drops one.
 */
export function previewStream(raw: PreviewStream): Stream | null {
  const name = raw.name?.trim() || null;
  const description = (raw.description ?? raw.title)?.trim() || null;
  const filename = raw.behaviorHints?.filename?.trim() || null;
  const bingeGroup = raw.behaviorHints?.bingeGroup?.trim() || null;
  const warnings = warningsOf(raw.behaviorHints);

  if (raw.url?.trim()) {
    return {
      name,
      description,
      playback: { kind: "direct", url: raw.url.trim() },
      warnings,
      filename,
      bingeGroup,
    };
  }
  if (raw.infoHash?.trim()) {
    return {
      name,
      description,
      playback: {
        kind: "torrent",
        infoHash: raw.infoHash.trim(),
        fileIdx: Number.isSafeInteger(raw.fileIdx) && (raw.fileIdx ?? -1) >= 0 ? (raw.fileIdx ?? null) : null,
        sources: Array.isArray(raw.sources)
          ? raw.sources.filter((source) => typeof source === "string" && source.length > 0)
          : [],
      },
      warnings,
      filename,
      bingeGroup,
    };
  }
  return null;
}

const SAMPLE_POSITIONS = [0.36, 0.61, 0.18, 0.74] as const;

/**
 * Three real films from the live catalogue as sample Watch progress.
 *
 * This is preview data and says so on Home: it exists so Continue watching can
 * be judged as a row, not because a Host would invent a position. Durations
 * come from the Addon's runtime; a film that did not say has no length and is
 * left out rather than given a made-up one.
 */
export function sampleResumeEntries(
  metas: readonly CinemetaMeta[],
  count = 4,
): ResumeEntry[] {
  const entries: ResumeEntry[] = [];
  for (const meta of metas) {
    if (entries.length >= count) {
      break;
    }
    const preview = cinemetaPreview(meta, "movie");
    const duration = parseRuntimeSeconds(meta.runtime);
    if (!preview || preview.type !== "movie" || duration === null) {
      continue;
    }
    const position = Math.round(duration * SAMPLE_POSITIONS[entries.length % SAMPLE_POSITIONS.length]!);
    entries.push({
      video: { id: preview.id, name: null, season: null, episode: null, thumbnail: preview.background ?? null, airDate: null },
      title: {
        addon: "cinemeta",
        id: preview.id,
        type: preview.type,
        name: preview.name,
        poster: preview.poster,
        background: preview.background ?? null,
      },
      position,
      duration,
      watched: false,
      unplayable: null,
    });
  }
  return entries;
}

/** The sample account Library's latest mtime: a fixed moment, not a clock. */
const SAMPLE_LIBRARY_AT = Date.UTC(2026, 9, 29, 12, 0, 0);

/**
 * Live Cinemeta films as a sample account Library.
 *
 * The room the Tauri window reads from the account needs live posters and names
 * to be judged in the plain Vite window. The artwork and names are real; the
 * mtimes and the two positions are sample data, and the room says so. The first
 * two rows carry the Continue mark; the rest are saved but unplayed.
 */
export function sampleLibrary(
  metas: readonly CinemetaMeta[],
  count = 8,
): LibraryEntry[] {
  const entries: LibraryEntry[] = [];
  for (const meta of metas) {
    if (entries.length >= count) {
      break;
    }
    const preview = cinemetaPreview(meta, "movie");
    if (!preview) {
      continue;
    }
    const index = entries.length;
    const started = index < 2;
    const duration = preview.type === "series" ? 2820 : parseRuntimeSeconds(meta.runtime);
    const position = started ? 600 + index * 120 : null;
    entries.push({
      id: preview.id,
      name: preview.name,
      type: preview.type,
      poster: preview.poster,
      posterShape: preview.posterShape,
      mtime: SAMPLE_LIBRARY_AT - index * 3_600_000,
      videoId: preview.type === "series" ? `${preview.id}:1:1` : null,
      position,
      duration,
      continueWatching: position !== null,
    });
  }
  return entries;
}

/**
 * The rehearsal's chapters: six places in the film, as fractions of its own
 * length. The names are sample programme words, not a claim about the film; the
 * Vite window says the playback is a rehearsal.
 */
const REHEARSAL_CHAPTERS = [
  "Opening",
  "The first movement",
  "Interlude",
  "The second movement",
  "The turn",
  "Credits",
] as const;

const REHEARSAL_CHAPTER_STARTS = [0, 0.08, 0.24, 0.42, 0.63, 0.84] as const;

/** The chapter a rehearsal position is inside: the last one that began before it. */
export function rehearsalChapterAt(chapters: Chapter[], position: number): number | null {
  let inside: number | null = null;
  for (const chapter of chapters) {
    if (chapter.time <= position) {
      inside = chapter.index;
    }
  }
  return inside;
}

/**
 * What the plain Vite window draws when the Player OSD is rehearsed: a Snapshot
 * of a Stream that is playing, built from a real film's own resume entry.
 *
 * It is sample data — the position, the tracks, the chapters and the statistics
 * are the prototype's, not a Host's report — and exists so the OSD can be judged
 * live without a Host. The Tauri window never takes this path. Everything the
 * OSD then does is a real Action, answered by the preview transport locally.
 */
export function rehearsalPlayback(entry: ResumeEntry, nowPlaying: NowPlaying): PlaybackSnapshot {
  const duration = entry.duration && entry.duration > 0 ? entry.duration : 6420;
  const position = Math.min(
    Math.max(0, entry.position ?? Math.round(duration * 0.34)),
    Math.max(0, duration - 1),
  );
  const chapters: Chapter[] = REHEARSAL_CHAPTERS.map((title, index) => ({
    index,
    title,
    time: Math.round(duration * REHEARSAL_CHAPTER_STARTS[index]!),
  }));
  const tracks: Track[] = [
    {
      id: 1,
      kind: "audio",
      language: "eng",
      title: "English 5.1",
      codec: "eac3",
      embedded: true,
      selected: true,
      default: true,
      forced: false,
      hearingImpaired: false,
    },
    {
      id: 2,
      kind: "audio",
      language: "por",
      title: "Português 5.1",
      codec: "ac3",
      embedded: true,
      selected: false,
      default: false,
      forced: false,
      hearingImpaired: false,
    },
    {
      id: 3,
      kind: "subtitle",
      language: "eng",
      title: "English",
      codec: "subrip",
      embedded: true,
      selected: true,
      default: true,
      forced: false,
      hearingImpaired: false,
    },
    {
      id: 4,
      kind: "subtitle",
      language: "por-BR",
      title: "Português (BR)",
      codec: "subrip",
      embedded: true,
      selected: false,
      default: false,
      forced: false,
      hearingImpaired: false,
    },
    {
      id: 5,
      kind: "subtitle",
      language: "eng",
      title: "English (SDH)",
      codec: "ass",
      embedded: false,
      selected: false,
      default: false,
      forced: false,
      hearingImpaired: false,
    },
  ];

  return {
    state: "playing",
    autoplay: null,
    picture: "in_window",
    failure: null,
    nowPlaying,
    episode: null,
    position,
    duration,
    buffered: {
      start: Math.max(0, position - 900),
      end: Math.min(duration, position + 1200),
    },
    tracks,
    chapters,
    chapter: rehearsalChapterAt(chapters, position),
    speed: 1,
    volume: 60,
    muted: false,
    subtitleDelay: 0,
    stalled: false,
    crop: null,
    aspect: null,
    resolution: { width: 1920, height: 804 },
    statistics: {
      bitrate: 12_500_000,
      droppedFrames: 0,
      hardwareDecode: "d3d11va",
    },
  };
}
