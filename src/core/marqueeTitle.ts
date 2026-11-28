/**
 * Pure decisions for Marquee's Title screen (#360, `05.jpg`, `docs/design-system.md` §8–§9).
 *
 * Framework-free (`src/core` per ADR-0035 §1, ADR-0032): no React, no DOM, no
 * Motion imports. Reuses `titlePage.ts`, `title.ts`, `stream.ts`, and
 * `library.ts` for the Host's Actions and contracts, and adds Marquee's Choose
 * stream button, episode notes, and progress marks.
 */

import { progressOf } from "./library";
import { theFilm } from "./stream";
import { airsNote, type OpenablePreview, type TitlePreview } from "./title";
import {
  titleAnchor,
  titleMainAction,
  titleSide,
  type TitleAnchor,
  type TitleMainAction,
  type TitleSide,
} from "./titlePage";
import type { ContinueEntry, ResumeEntry, Title, UpNextPlayback, Video } from "./wire";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** What pressing the **Choose stream** control on Title opens. */
export type TitleChooseStreamAction = {
  video: Video;
  /** True when there is no Resume/Play primary CTA ahead of Choose stream. */
  primary: boolean;
};

export type TitleActionsModel = {
  main: TitleMainAction | null;
  chooseStream: TitleChooseStreamAction | null;
  anchor: TitleAnchor;
  side: TitleSide;
};

/**
 * Resolve the primary CTA (`Resume` / `Play`) and the **Choose stream** CTA
 * for both movies and series (ADR-0043 §4, `05.jpg`).
 */
export function titleActionsModel(params: {
  title: Title;
  continueWatching: readonly ContinueEntry[];
  upNextPlayback: UpNextPlayback;
  selectedVideo?: Video | null;
}): TitleActionsModel {
  const { title, continueWatching, upNextPlayback, selectedVideo = null } = params;
  const anchor = titleAnchor(title, continueWatching);
  const main = titleMainAction(title, continueWatching, upNextPlayback);
  const side = titleSide(title);

  let chooseVideo: Video | null = null;
  if (side.kind === "film") {
    chooseVideo = theFilm(title);
  } else if (side.kind === "series") {
    if (main?.kind === "play") {
      chooseVideo = main.video;
    } else {
      chooseVideo = anchor.video ?? selectedVideo ?? side.seasons[0]?.videos[0] ?? null;
    }
  }

  return {
    main,
    chooseStream: chooseVideo
      ? { video: chooseVideo, primary: main === null }
      : null,
    anchor,
    side,
  };
}

/**
 * The ordered artwork fallback chain for a Title's full-bleed backdrop
 * (`docs/design-system.md` §9): Title backdrop → preview backdrop → Title
 * poster → preview poster.
 */
export function titleBackdropCandidates(
  title: Title,
  preview?: TitlePreview | null,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const candidate of [
    title.background,
    preview?.background ?? null,
    title.poster,
    preview?.poster ?? null,
  ]) {
    if (candidate && !seen.has(candidate)) {
      seen.add(candidate);
      out.push(candidate);
    }
  }
  return out;
}

/**
 * The date note shown under an episode card (`05.jpg`): `Airs 12 Nov` for an
 * announced future episode (#269), or `17 Jan 2025` for a past/current air
 * date, or `null` when unknown or malformed.
 */
export function episodeAirNote(video: Video, today: Date): string | null {
  const announced = airsNote(video, today);
  if (announced !== null) {
    return announced;
  }

  const date = video.airDate;
  if (date === null || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return null;
  }

  const [year, month, day] = date.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    return null;
  }
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return `${day} ${MONTHS[month - 1]} ${year}`;
}

/** Watched check and progress bar fraction for an episode card (`05.jpg`). */
export function episodeProgress(
  videoId: string,
  watchProgress: readonly ResumeEntry[],
): { watched: boolean; progress: number | null } {
  const entry = watchProgress.find((item) => item.video.id === videoId);
  if (!entry) {
    return { watched: false, progress: null };
  }
  if (entry.watched) {
    return { watched: true, progress: null };
  }
  return {
    watched: false,
    progress: progressOf({ ...entry, upNext: false }),
  };
}

export type TitleFocusTarget = "episode" | "main" | "choose-stream" | "back";

/**
 * Which control receives initial focus when a Title screen mounts:
 * - an anchored episode when opening a series from Continue watching,
 * - else the primary `Resume` / `Play` action,
 * - else `Choose stream`,
 * - else `Back` (e.g. a series with no listed episodes).
 */
export function titleInitialFocusTarget(params: {
  main: TitleMainAction | null;
  hasChooseStream: boolean;
  anchoredVideo: Video | null;
}): TitleFocusTarget {
  if (params.anchoredVideo !== null) {
    return "episode";
  }
  if (params.main !== null) {
    return "main";
  }
  if (params.hasChooseStream) {
    return "choose-stream";
  }
  return "back";
}

export type { OpenablePreview };
