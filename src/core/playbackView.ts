/**
 * The playback facts both players are drawn from (ADR-0035 §2).
 *
 * The Host decides what is playing, where the picture is, what the Stream
 * carries and what it will accept; this module only turns one Snapshot, the
 * client's own clock and the Session's pending keys into the facts a player
 * draws. Nothing here holds state, and nothing here is a layout: the window's
 * OSD and the Remote's strip are two drawings of these facts (#191 §5).
 */

import { autoplayView, type AutoplayView } from "./autoplay";
import {
  controllable,
  formatVolume,
  orderedTracks,
  volumeFraction,
} from "./controls";
import {
  bufferedSpan,
  chapterAt,
  chapterMarks,
  projectedPosition,
  qualityBadge,
  remainingTime,
  streamDetails,
  streamKey,
  streamTitle,
  timelineFraction,
  type ChapterMark,
} from "./osd";
import { pictureNote, transportable, watching } from "./playback";
import { labelOf } from "./title";
import type {
  Chapter,
  Episode,
  NowPlaying,
  Picture,
  PlaybackSnapshot,
  PlaybackState,
  ResumeEntry,
  Track,
} from "./wire";

/** The facts a player reads from the Snapshot, the clock and the Session. */
export type PlaybackViewInput = {
  /**
   * Seconds since the Snapshot's anchor, from the client's own clock. The view
   * owns the projection: a client hands it the elapsed time once and both
   * players read the same `position`.
   */
  played: number;
  /** The Session's pending Action keys (#137, ADR-0027). */
  pending: ReadonlySet<string>;
  /**
   * The Host's Watch progress. The entry for the Stream playing is where the
   * Title's own name and the opening preview's art come from — the Snapshot
   * carries the Addon's words about the Stream, not the Title's name.
   */
  watchProgress: readonly ResumeEntry[];
};

/** What the opening Stream will be, drawn in the hole while mpv is still opening. */
export type OpeningPreview = {
  art: string | null;
  title: string;
  subtitle: string | null;
};

/** What a player draws of the playback facts. */
export type PlaybackView = {
  state: PlaybackState;
  /** Anything but nothing playing, including a Stream at its end. */
  watching: boolean;
  /** Whether the Host would take a seek or a pause yet. */
  transportable: boolean;
  /** Whether the Host would take the player's control set at all. */
  controllable: boolean;
  picture: Picture;
  pictureNote: string | null;
  nowPlaying: NowPlaying | null;
  /** The Watch-progress Title's name, else the Stream's own title. */
  title: string;
  /** The kicker's `S2E3`, the Watch-progress Video's label, or `Feature`. */
  episodeLabel: string;
  quality: string | null;
  details: string | null;
  /** The projected position, clamped to the Stream's length. */
  position: number | null;
  duration: number | null;
  /** The countdown the OSD reads, with its minus sign. */
  remaining: string;
  /** Where playback is on its track, between 0 and 1. */
  fraction: number;
  buffered: { left: number; width: number } | null;
  chapters: Chapter[];
  /** The chapter marks, unspaced; a drawing calls `spacedChapterMarks`. */
  marks: ChapterMark[];
  /** The chapter a moment is inside, for the timeline's hover callout. */
  chapterAt: (at: number) => Chapter | null;
  /** The tracks of each kind, embedded first. */
  tracks: { audio: Track[]; subtitle: Track[] };
  /** The rate in force, as a number (`1` where the Player has not said). */
  speed: number;
  volume: { level: number; fraction: number; muted: boolean; label: string };
  episode: Episode | null;
  /** What Autoplay is doing about the episode that ended, projected to now. */
  autoplay: AutoplayView;
  /** The Session's pending keys, by Action key. */
  pending: ReadonlySet<string>;
  /** What clears the Seek previews: one Stream, as far as a client can tell. */
  streamKey: string | null;
  /** The art and name of the Stream that is opening, where the Host holds them. */
  openingPreview: OpeningPreview | null;
};

function progressFor(
  nowPlaying: NowPlaying | null,
  watchProgress: readonly ResumeEntry[],
): ResumeEntry | null {
  if (!nowPlaying) {
    return null;
  }
  return watchProgress.find((entry) => entry.video.id === nowPlaying.video.id) ?? null;
}

function openingPreviewOf(progress: ResumeEntry | null): OpeningPreview | null {
  if (!progress) {
    return null;
  }
  const art =
    progress.video.thumbnail ?? progress.title.background ?? progress.title.poster ?? null;
  const subtitle =
    [labelOf(progress.video), progress.video.name]
      .filter((part): part is string => Boolean(part))
      .join(" · ") || null;

  return { art, title: progress.title.name, subtitle };
}

function episodeLabelOf(episode: Episode | null, progress: ResumeEntry | null): string {
  if (episode) {
    return `S${episode.season}E${episode.episode}`;
  }
  return (progress ? labelOf(progress.video) : null) ?? "Feature";
}

/**
 * The playback facts, from one Snapshot and the client's own clock.
 *
 * `played` is seconds since the Snapshot arrived: the one projection lives here
 * (`projectedPosition`), so a player that reads `position` and a player that
 * reads `fraction` cannot disagree. The two drawings still decide when to draw
 * the transport, the ladder and the menus, and how (#194, #195 stay theirs).
 */
export function playbackView(
  playback: PlaybackSnapshot,
  input: PlaybackViewInput,
): PlaybackView {
  const progress = progressFor(playback.nowPlaying, input.watchProgress);
  const position = projectedPosition(playback, input.played);
  const duration = playback.duration;
  const volumeLevel = Math.round(playback.volume ?? 100);

  return {
    state: playback.state,
    watching: watching(playback.state),
    transportable: transportable(playback.state),
    controllable: controllable(playback.state),
    picture: playback.picture,
    pictureNote: pictureNote(playback.picture),
    nowPlaying: playback.nowPlaying,
    title: progress?.title.name ?? streamTitle(playback.nowPlaying),
    episodeLabel: episodeLabelOf(playback.episode, progress),
    quality: qualityBadge(playback.nowPlaying),
    details: streamDetails(playback),
    position,
    duration,
    remaining: remainingTime(position, duration),
    fraction: timelineFraction(position, duration),
    buffered: bufferedSpan(playback.buffered, duration),
    chapters: playback.chapters,
    marks: chapterMarks(playback.chapters, duration),
    chapterAt: (at: number) => chapterAt(playback.chapters, at),
    tracks: {
      audio: orderedTracks(playback.tracks, "audio"),
      subtitle: orderedTracks(playback.tracks, "subtitle"),
    },
    speed: playback.speed ?? 1,
    volume: {
      level: volumeLevel,
      fraction: volumeFraction(volumeLevel),
      muted: playback.muted ?? false,
      label: formatVolume(volumeLevel),
    },
    episode: playback.episode,
    autoplay: autoplayView(playback, input.played * 1000),
    pending: input.pending,
    streamKey: streamKey(playback.nowPlaying),
    openingPreview: openingPreviewOf(progress),
  };
}
