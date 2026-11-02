/**
 * The window's Episodes menu: its one drawing decision, the playing episode's
 * mark, and the words this client alone prints (#195).
 *
 * The series lookup and the season grouping are the core's (`seriesRef`,
 * `episodesOf`); what lives here is whether the OSD draws a menu at all, which
 * row is the Video playing now, and how a Video is named on the plate.
 */

import { labelOf } from "../core/title";
import type { PlaybackSnapshot, Video } from "../core/wire";

/**
 * Whether the OSD draws the Episodes menu.
 *
 * Only a series has episodes: an episode is marked on the playback Snapshot,
 * or the playing Video says it is one. A film draws no menu rather than a
 * control that opens an empty plate.
 */
export function episodesMenuVisible(playback: PlaybackSnapshot | null): boolean {
  if (!playback) {
    return false;
  }
  return playback.episode !== null || playback.nowPlaying?.video.type === "series";
}

/** The id of the Video playing now, which one episode row marks. */
export function playingVideoId(playback: PlaybackSnapshot | null): string | null {
  return playback?.nowPlaying?.video.id ?? null;
}

/**
 * How an episode is named on the plate: its `S#E#`, then the Addon's title,
 * with whichever half exists. The row's own id is the last word.
 */
export function osdEpisodeLabel(video: Video): string {
  return (
    [labelOf(video), video.name ?? video.id]
      .filter((part): part is string => Boolean(part))
      .join(" · ") || video.id
  );
}

/** What the plate says while the Host is looking the series up. */
export const EPISODES_LOOKING = "Looking for this series' episodes…";

/** What the plate says when the series carries no episodes at all. */
export const EPISODES_EMPTY = "No episodes are available for the playing series.";
