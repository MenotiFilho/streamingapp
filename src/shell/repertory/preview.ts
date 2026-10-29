/**
 * The mapping between a live Cinemeta answer and the Host's own vocabulary.
 *
 * The prototype's preview transport reads the public Cinemeta addon directly;
 * this module holds the pure translation so a test can check it without a
 * network and so no component ever sees a Cinemeta field name. Artwork stays
 * a URL into Metahub — the repository commits no poster or backdrop.
 */

import type { MetaPreview, ResumeEntry } from "../../host-client";

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
      video: { id: preview.id, name: null, season: null, episode: null, thumbnail: preview.background ?? null },
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
