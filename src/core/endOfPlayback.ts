/**
 * What the window does when a playing Stream reaches its end: movies and
 * episodes whose next episode does not exist or has not aired yet stop and
 * return to the respective Title page rather than sitting on the ended screen.
 *
 * The decisions are pure (ADR-0032): the window only watches for a live-to-ended
 * transition and acts on the answer here. Episodes with an aired next episode
 * stay on the ended surface so Autoplay's countdown, "Still watching?", Cancel,
 * and Wait keep working unchanged.
 */

import { seriesRef, type SeriesRef } from "./episodes";
import { tmdbFilmId } from "./title";
import type { ContinueEntry, PlaybackState, Snapshot, Title, Video } from "./wire";

/** What the window should do on a Snapshot transition. */
export type EndOfPlaybackDecision =
  | { kind: "stay" }
  | { kind: "return"; ref: SeriesRef }
  | { kind: "check_title"; ref: SeriesRef };

/** The subset of a Title a pushed level needs in order to match a playing Stream. */
export type TitleIdentity = Pick<Title, "type" | "id" | "key">;

/** Whether `state` is a live Stream that can transition into `ended`. */
function isLiveState(state: PlaybackState | null): boolean {
  return state === "opening" || state === "playing" || state === "paused";
}

/** The calendar day of `now` in UTC, as `YYYY-MM-DD`, matching `host-core`. */
export function utcDay(now: Date): string {
  const year = String(now.getUTCFullYear()).padStart(4, "0");
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Whether a Video has aired as of `now` in UTC: an absent air date, or one
 * that is today or earlier, counts as aired (matching `autoplay::on_ended` in
 * `host-core`).
 */
export function hasAired(video: Pick<Video, "airDate">, now: Date): boolean {
  return video.airDate === null || video.airDate <= utcDay(now);
}

/** Which part of a series' order a Video belongs to (ADR-0039). */
function partOf(video: Video): 0 | 1 | 2 {
  if (video.season === 0) {
    return 2;
  }
  return video.season === null ? 1 : 0;
}

/**
 * The Video standing immediately after `id` in the Host's order, staying inside
 * the same part (numbered seasons cross seasons, specials stay in specials, and
 * unnumbered Videos stay together). Mirrors `meta::next_video` in `host-core`.
 */
export function nextVideo(videos: readonly Video[], id: string): Video | null {
  const ordered = videos.slice().sort((left, right) => {
    const partDiff = partOf(left) - partOf(right);
    if (partDiff !== 0) {
      return partDiff;
    }
    if (partOf(left) !== 0) {
      return 0;
    }
    const seasonDiff = (left.season ?? 0) - (right.season ?? 0);
    if (seasonDiff !== 0) {
      return seasonDiff;
    }
    return (left.episode ?? Number.MAX_SAFE_INTEGER) - (right.episode ?? Number.MAX_SAFE_INTEGER);
  });

  const index = ordered.findIndex((video) => video.id === id);
  if (index < 0 || index + 1 >= ordered.length) {
    return null;
  }
  const current = ordered[index];
  const candidate = ordered[index + 1];
  if (!current || !candidate || partOf(current) !== partOf(candidate)) {
    return null;
  }
  return candidate;
}

/**
 * Whether `videos` lists an episode after `videoId` that has already aired as
 * of `now` (UTC).
 */
export function hasAiredNextEpisode(
  videos: readonly Video[],
  videoId: string,
  now: Date,
): boolean {
  const next = nextVideo(videos, videoId);
  return next !== null && hasAired(next, now);
}

/** Whether a pushed Title level is the Title that `ref` names. */
export function matchesTitleIdentity(title: TitleIdentity, ref: SeriesRef): boolean {
  if (ref.kind === "addon") {
    return title.type === ref.title.type && title.id === ref.title.id;
  }
  return (
    title.type === ref.type &&
    (title.id === tmdbFilmId(ref.key.id) ||
      (title.key.kind === "tmdb" && title.key.id === ref.key.id))
  );
}

/** Whether a Continue watching card belongs to the Title `ref` names. */
function matchesContinueEntry(entry: ContinueEntry, ref: SeriesRef): boolean {
  if (ref.kind === "addon") {
    return entry.title.type === ref.title.type && entry.title.id === ref.title.id;
  }
  return entry.title.type === ref.type && entry.title.id === tmdbFilmId(ref.key.id);
}

/**
 * Decide whether a live-to-ended transition should return to the Title page.
 *
 * - Movies (`episode === null`) always return, regardless of the Autoplay setting.
 * - Series episodes with Autoplay on (`preferences.autoplay === true`) return
 *   when the Host published no `autoplay` phase on the transition — meaning no
 *   aired next episode exists.
 * - Series episodes with Autoplay off (Wait) inspect `continueWatching` when
 *   it already holds the Title's Up next, and otherwise ask the caller to
 *   check the Title's episode list (`check_title`).
 * - Mounting an already-ended Snapshot, or cancelling a countdown while
 *   already ended, never triggers a return (`previousState` is not live).
 */
export function endOfPlaybackDecision(
  previousState: PlaybackState | null,
  snapshot: Pick<
    Snapshot,
    "playback" | "preferences" | "watchProgress" | "continueWatching"
  > | null,
  now: Date,
): EndOfPlaybackDecision {
  if (
    !isLiveState(previousState) ||
    snapshot === null ||
    snapshot.playback.state !== "ended" ||
    snapshot.playback.nowPlaying === null
  ) {
    return { kind: "stay" };
  }

  if (snapshot.playback.autoplay !== null) {
    return { kind: "stay" };
  }

  const ref = seriesRef(snapshot, snapshot.playback.nowPlaying);

  if (snapshot.playback.episode === null) {
    return { kind: "return", ref };
  }

  if (snapshot.preferences.autoplay) {
    return { kind: "return", ref };
  }

  const entry = snapshot.continueWatching.find((card) => matchesContinueEntry(card, ref));
  if (entry?.upNext) {
    return hasAired(entry.video, now) ? { kind: "stay" } : { kind: "return", ref };
  }

  return { kind: "check_title", ref };
}
