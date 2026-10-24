/**
 * What the player OSD reads: the few facts the edge-to-edge drawing needs that
 * are not themselves controls.
 *
 * The Host publishes the whole player state; this module only turns it into the
 * strings and positions a person sees. Nothing here decides playback, and
 * nothing holds state — a position that moved is a Snapshot that arrived.
 */

import { formatBitrate } from "../controls";
import type {
  Buffered,
  Chapter,
  NowPlaying,
  PlaybackSnapshot,
  Track,
  TrackKind,
} from "../host-client";
import { formatTime } from "../playback";
import { badgeLines } from "../stream";

/**
 * The badge the OSD draws beside the Title: the Addon's own line that names a
 * resolution or a dynamic range where it wrote one, and otherwise the last line
 * it wrote (Addons usually put the quality there).
 */
const QUALITY = /\b(4k|8k|2160p|1440p|1080p|720p|576p|480p|uhd|hdr(?:10)?|dv|dolby\s*vision)\b/i;

export function qualityBadge(nowPlaying: NowPlaying | null): string | null {
  if (!nowPlaying) {
    return null;
  }
  return badgeLines(nowPlaying).find((line) => QUALITY.test(line)) ?? null;
}

/**
 * The name in the Title pill: the Addon's own words about the candidate, with
 * the line the quality badge already took left out so the two pills do not say
 * the same thing twice. The Snapshot carries no Title name — `NowPlaying` is the
 * Addon's description of the Stream — so this is the most specific name a
 * client has without asking the Host a second question.
 */
export function streamTitle(nowPlaying: NowPlaying | null): string {
  if (!nowPlaying) {
    return "a Stream";
  }
  const quality = qualityBadge(nowPlaying);
  const words = badgeLines(nowPlaying).filter((line) => line !== quality);
  return words.join(" · ") || nowPlaying.filename || "a Stream";
}

/** The track of one kind the Player says is on, where it says one. */
export function selectedTrack(tracks: Track[], kind: TrackKind): Track | null {
  return tracks.find((track) => track.kind === kind && track.selected) ?? null;
}

/**
 * The second top-left pill: whatever the Snapshot knows about the Stream that
 * says more than its name — the Addon it came from, the codecs of the tracks
 * on, the bitrate the Player measures, and what decodes the picture.
 */
export function streamDetails(playback: PlaybackSnapshot): string | null {
  const audio = selectedTrack(playback.tracks, "audio");
  const subtitle = selectedTrack(playback.tracks, "subtitle");
  const statistics = playback.statistics;
  const hardware = statistics?.hardwareDecode ?? null;

  const parts = [
    playback.nowPlaying?.addon ?? null,
    audio?.codec ?? null,
    subtitle?.codec ?? null,
    statistics?.bitrate != null ? formatBitrate(statistics.bitrate) : null,
    hardware === null ? null : hardware === "no" ? "software decode" : hardware,
  ].filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * What is left of the Stream, read as the OSD's right-hand clock: the time
 * remaining with the minus sign a countdown carries, or `--:--` while either
 * end of the sum is unknown.
 */
export function remainingTime(position: number | null, duration: number | null): string {
  if (
    position === null ||
    duration === null ||
    !Number.isFinite(position) ||
    !Number.isFinite(duration)
  ) {
    return "--:--";
  }
  return `−${formatTime(Math.max(0, duration - position))}`;
}

/** Where playback is on its track, between 0 and 1; zero where the length is unknown. */
export function timelineFraction(position: number | null, duration: number | null): number {
  if (
    position === null ||
    duration === null ||
    !Number.isFinite(position) ||
    !Number.isFinite(duration) ||
    duration <= 0
  ) {
    return 0;
  }
  return Math.min(1, Math.max(0, position / duration));
}

/**
 * The span of the timeline the Player has read ahead, as fractions of the
 * track: both ends clamped into the Stream they belong to, so a Player that
 * read past either end is still only this Stream. Null where there is nothing
 * to draw — no answer, no length to place it against, or a span the clamp
 * emptied. The order of the ends is the Player's business, not a client's: a
 * span that runs backwards draws nothing.
 */
export function bufferedSpan(
  buffered: Buffered | null,
  duration: number | null,
): { left: number; width: number } | null {
  if (
    buffered === null ||
    duration === null ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    !Number.isFinite(buffered.start) ||
    !Number.isFinite(buffered.end)
  ) {
    return null;
  }
  const start = Math.min(duration, Math.max(0, buffered.start));
  const end = Math.min(duration, Math.max(0, buffered.end));
  if (end <= start) {
    return null;
  }
  return { left: start / duration, width: (end - start) / duration };
}

/** One chapter's diamond on the timeline, and where along it the diamond sits. */
export type ChapterMark = { chapter: Chapter; fraction: number };
/**
 * The chapter markers the timeline draws: the container's own chapters, each
 * placed by the time it starts. A Stream whose length the Player has not said
 * has nowhere to put them, so it draws none rather than guessing a scale.
 */
export function chapterMarks(chapters: Chapter[], duration: number | null): ChapterMark[] {
  if (duration === null || !Number.isFinite(duration) || duration <= 0) {
    return [];
  }
  return chapters.map((chapter) => ({
    chapter,
    fraction: Math.min(1, Math.max(0, chapter.time / duration)),
  }));
}

/**
 * How many seconds of the Stream one still stands for: the Host's own bucket
 * (ADR-0028). A client asks about a moment; the answer is the still of the
 * bucket that moment falls in, so two pointers a second apart are one ask.
 */
export const PREVIEW_BUCKET_SECONDS = 5;

/** The bucket a moment falls in — the key the tooltip's cache is kept by. */
export function previewBucket(at: number): number {
  if (!Number.isFinite(at) || at <= 0) {
    return 0;
  }
  return Math.floor(at / PREVIEW_BUCKET_SECONDS);
}

/**
 * The chapter a moment is inside, where the Stream has chapters: the last one
 * that began at or before it. `null` before the first chapter's own start — a
 * Stream can begin with an untitled lead-in — and where there are none at all.
 */
export function chapterAt(chapters: Chapter[], at: number): Chapter | null {
  let inside: Chapter | null = null;
  for (const chapter of chapters) {
    if (chapter.time <= at) {
      inside = chapter;
    }
  }
  return inside;
}
