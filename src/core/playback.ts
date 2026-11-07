/**
 * What the window says and does about playback: the pure decisions the player
 * surface is drawn from.
 *
 * The Host decides — what is playing, where it is, whether it can be paused —
 * and this module only says how those facts read. Nothing here holds state: a
 * position that moves is a Snapshot that arrived, and a control is an Action
 * taken (ADR-0002, ADR-0013).
 */

import type { Action, NowPlaying, Picture, PlaybackState } from "./wire";
import { badgeLines } from "./stream";

/**
 * Whether the window is the player: anything but nothing being played. A Stream
 * that failed to open is `idle` — the Player is doing nothing — so the client is
 * back on the list it chose from, with the failure said beside it.
 */
export function watching(state: PlaybackState): boolean {
  return state !== "idle";
}

/** The part of a playback report the shell reads to decide where the picture is. */
type PictureFacts = { state: PlaybackState; picture: Picture };

/**
 * Whether the picture is behind the shell: mpv's child window shows through the
 * page, so the page paints nothing over it (ADR-0003).
 *
 * A requested Stop gives the ink back at once. The Host destroys mpv's window
 * before it publishes `idle`, and until the shell paints its own backdrop the
 * hole shows the desktop (#250), so the shell paints first and the picture goes
 * second.
 */
export function pictureBehind(playback: PictureFacts | null, closing: boolean): boolean {
  return (
    !closing && playback !== null && watching(playback.state) && playback.picture === "in_window"
  );
}

/** Whether an Action closes the Stream the window is playing. */
export function requestsStop(action: Action): boolean {
  return action.type === "stop_playback";
}

/**
 * Whether a requested Stop is still being held. It lasts only while the Host
 * still reports a Stream: once nothing is playing the next Stream opens with a
 * picture behind the shell again.
 */
export function closingAfter(closing: boolean, playback: PictureFacts | null): boolean {
  return closing && playback !== null && watching(playback.state);
}

/**
 * Whether the transport controls mean anything yet. An open in flight has a
 * position to play from in a moment, and a Stream at its end is not one the Host
 * will seek: both say what is happening rather than offering buttons that would
 * be refused.
 */
export function transportable(state: PlaybackState): boolean {
  return state === "playing" || state === "paused";
}

/**
 * What the picture area says where the picture is not in this window: mpv's own
 * window on a platform with no way to draw it in ours, or nowhere at all on a
 * Host with no video output. Null where the picture *is* here — the window
 * leaves the rectangle unpainted for it.
 */
export function pictureNote(picture: Picture): string | null {
  switch (picture) {
    case "in_window":
      return null;
    case "own_window":
      return "The picture is in mpv's own window — this platform cannot draw it in this one.";
    case "nowhere":
      return "This Host has no picture: nothing is drawn.";
  }
}

/**
 * What is playing, named the way the Stream list named it: the Addon's own badge
 * lines, or the file's name where the Addon wrote no badges.
 */
export function playingName(nowPlaying: NowPlaying | null): string {
  if (!nowPlaying) {
    return "a Stream";
  }

  const badges = badgeLines(nowPlaying).join(" · ");
  return badges || nowPlaying.filename || "a Stream";
}

/**
 * A position or a duration as a person reads it — `1:23:45`, `12:34` — or
 * `--:--` where the Host has no number yet (a Stream that is still opening, a
 * live Stream that never says how long it is).
 */
export function formatTime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) {
    return "--:--";
  }

  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  const padded = String(rest).padStart(2, "0");

  if (minutes < 60) {
    return `${minutes}:${padded}`;
  }

  const hours = Math.floor(minutes / 60);
  return `${hours}:${String(minutes % 60).padStart(2, "0")}:${padded}`;
}
