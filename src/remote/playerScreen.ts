import { VOLUME_MAX } from "../core/controls";
import type { NewLevel } from "../core/navigation";
import { watching } from "../core/playback";
import type { PlaybackView } from "../core/playbackView";
import {
  transportControls,
  type TransportControl,
} from "../core/transportControls";
import type { Action, PlaybackState, Title } from "../core/wire";
import type { RemotePayload } from "./levels";

/**
 * The Remote player's own decisions and its own copy (#213, ADR-0035 §2).
 *
 * The playback facts are the core's: `playbackView`, `transportControls`,
 * `watching`, `pictureNote`, `formatTime`, `playingName` and
 * `spacedChapterMarks` already say what is playing and what each press does.
 * What lives here is only what this client's drawing decides — which two
 * controls the docked strip carries, where the timeline's and the volume box's
 * ranges begin and end, how the played and read-ahead spans divide the track,
 * and the words the phone alone prints. No rule here holds state; the Snapshot
 * is the truth and the Session's pending keys are the wait.
 */

/**
 * The level a strip press pushes: the one expanded card, and the Title the
 * playing Stream belongs to.
 *
 * The Title is data the client already holds: the stack under the card is a
 * Title or a Streams level whenever playback started from one, and the
 * Episodes plate lists its seasons from there rather than asking the Host for
 * a Title it has already answered (#214, ADR-0005). A strip opened after the
 * Title has left the stack carries `null` and the plate says it lists nothing.
 */
export type RemotePlayer = { kind: "player"; title: Title | null };

/**
 * The card's name — the level's name, as a test, an announcement and Back call
 * it. `Player` is the Host's word for its seam; this level is the phone's one
 * expanded card drawn over the destination it was opened from.
 */
export const CARD_NAME = "Player";

/** The strip's name, as it is announced beside the room. */
export const STRIP_LABEL = "Now playing";

/** The one control that opens the card from the strip. */
export const STRIP_EXPAND = "Open the player";

/** What the card's plate says over the film's own art. */
export const NOW_PLAYING = "Now playing";

/** The two clocks' and the scrubber's names. */
export const TIMELINE_LABEL = "Position";
export const VOLUME_LABEL = "Volume";

/** The card's note while the Host is opening the Stream. */
export function openingNote(name: string): string {
  return `Opening ${name}…`;
}

/** The card's note when the Stream has run to its end. */
export const ENDED_NOTE = "The Stream reached its end.";

/** A chapter's name: its title where the container gave one, else its place. */
export function chapterName(chapter: { index: number; title: string | null }): string {
  return chapter.title ?? `Chapter ${chapter.index + 1}`;
}

/**
 * The expanded card, as the level a strip press pushes. It is a `player` level
 * so the core's Back pops it, and the destination underneath does not move;
 * Back closes the card and sends nothing, because Stop is its own control.
 *
 * It carries the one id a client can push twice: the strip stays drawn under
 * the card, so a second press replaces the card rather than stacking a second
 * one that one Back cannot close.
 */
export function playerLevel(title: Title | null = null): NewLevel<RemotePlayer> {
  return {
    id: "player",
    name: CARD_NAME,
    kind: "player",
    payload: { kind: "player", title },
  };
}

/**
 * Whether a pushed level is the expanded card of a Stream the Host has already
 * stopped. A player level is a drawing of something playing; when the Snapshot
 * says nothing is, the card leaves with the Stream, whatever closed it — Stop,
 * the Stream's end, or another client's Stop.
 */
export function playerLevelStale(
  payload: RemotePayload,
  playback: PlaybackState,
): boolean {
  return payload.kind === "player" && !watching(playback);
}

/**
 * The two controls the docked strip carries: the core's rewind and play/pause,
 * in the band's order. Every other fact — the label, the icon, the Action, the
 * disabled and pending flags — is the core's own.
 */
export function stripControls(
  view: PlaybackView,
): [TransportControl, TransportControl] {
  const all = transportControls(view);
  const rewind = all.find((control) => control.id === "rewind");
  const playPause = all.find((control) => control.id === "playPause");
  // `transportControls` always answers with the same six; the lookup cannot
  // fail, and the tuple keeps the drawing from carrying a second default.
  return [rewind!, playPause!];
}

/** A range's ends and its projected value. */
export type RangeFacts = { min: number; max: number; step: number; value: number };

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * The timeline's range: the Stream's whole length, one second at a time, with
 * the projection as its value. A Stream the Host has not measured yet has no
 * scale to seek on, so the range is a placeholder (`0..1`) that the drawing
 * disables rather than an input claiming a length nobody said.
 */
export function timelineRange(
  view: Pick<PlaybackView, "duration" | "position">,
): RangeFacts {
  const max =
    view.duration !== null && Number.isFinite(view.duration) && view.duration > 0
      ? view.duration
      : 1;
  const at = view.position === null ? 0 : finite(view.position, 0);
  return { min: 0, max, step: 1, value: clamp(at, 0, max) };
}

/** The one Action a committed timeline change takes: a seek to the moment. */
export function seekTo(
  seconds: number,
  duration: number | null,
): Extract<Action, { type: "seek" }> {
  const at = finite(seconds, 0);
  return {
    type: "seek",
    target: {
      kind: "to",
      seconds: clamp(at, 0, duration ?? Math.max(0, at)),
    },
  };
}

/** The volume box's range: the Host's own 0–130 scale, at the Host's level. */
export function volumeRange(view: Pick<PlaybackView, "volume">): RangeFacts {
  return {
    min: 0,
    max: VOLUME_MAX,
    step: 1,
    value: clamp(Math.round(finite(view.volume.level, 100)), 0, VOLUME_MAX),
  };
}

/** The one Action a committed volume change takes: the level a person chose. */
export function setVolume(level: number): Extract<Action, { type: "set_volume" }> {
  return {
    type: "set_volume",
    level: clamp(Math.round(finite(level, 0)), 0, VOLUME_MAX),
  };
}

/** The mute toggle's Action: the other state, because a press is a change. */
export function setMuted(muted: boolean): Extract<Action, { type: "set_muted" }> {
  return { type: "set_muted", muted };
}

/** One span of the timeline the Player's own numbers fill, as fractions. */
export type TrackFill = {
  from: number;
  to: number;
  role: "played" | "buffered";
};

/**
 * How the played and read-ahead spans divide the track, left to right.
 *
 * Both ends are clamped into the Stream they belong to, and a read-ahead that
 * begins behind the playhead draws only what is still ahead of it: the track
 * shows one reading, never a span painted under the part already watched. A
 * span the clamp empties draws nothing, and a gap between the playhead and a
 * later read-ahead stays the track's own hairline.
 */
export function trackFills(
  fraction: number,
  buffered: { left: number; width: number } | null,
): TrackFill[] {
  const played = clamp(finite(fraction, 0), 0, 1);
  const fills: TrackFill[] = [];

  if (played > 0) {
    fills.push({ from: 0, to: played, role: "played" });
  }

  if (buffered !== null) {
    const start = clamp(finite(buffered.left, 0), 0, 1);
    const end = clamp(start + finite(buffered.width, 0), 0, 1);
    const from = Math.max(start, played);
    if (end > from) {
      fills.push({ from, to: end, role: "buffered" });
    }
  }

  return fills;
}
