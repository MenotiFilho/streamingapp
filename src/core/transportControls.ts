/**
 * The six transport controls, and whether each would work right now (#191 §6).
 *
 * The Host takes them as Actions; this module only says what each one is called,
 * which Action it sends, and what the Snapshot and the Session make of it. Each
 * client takes the ones it draws and arranges them itself.
 */

import { actionKey } from "./actionKey";
import { nextEpisodeDisabled, previousEpisodeDisabled } from "./controls";
import type { PlaybackView } from "./playbackView";
import type { Action } from "./wire";

/**
 * What each transport control's glyph stands for. The core cannot import the
 * kit, so a client maps a name to the kit icon that draws it.
 */
export type TransportIcon =
  | "previous-episode"
  | "rewind-10"
  | "play"
  | "pause"
  | "forward-10"
  | "next-episode"
  | "close";

export type TransportControlId =
  | "previous"
  | "rewind"
  | "playPause"
  | "forward"
  | "next"
  | "stop";

export type TransportControl = {
  id: TransportControlId;
  label: string;
  icon: TransportIcon;
  action: Action;
  /** Whether a press would be refused, or would mean nothing, right now. */
  disabled: boolean;
  /** Whether this control's own Action is still on its way (#137). */
  pending: boolean;
};

function pendingOf(pending: ReadonlySet<string>, action: Action): boolean {
  return pending.has(actionKey(action));
}

/**
 * The controls, in the order the two players arrange them.
 *
 * The transport trio is greyed while the Stream is not transportable: an open
 * in flight has no position to seek yet and a Stream at its end is not one the
 * Host will seek. The episode steps are greyed only at the boundary the
 * position can name — a film has no episodes, and S1E1 has nothing before it;
 * whether the Addon lists a next episode is the Host's answer, not a client's
 * guess (ADR-0021). Stop is never greyed: it is the one control every state
 * keeps.
 */
export function transportControls(view: PlaybackView): TransportControl[] {
  const paused = view.state === "paused";
  const previous: Action = { type: "previous_episode" };
  const rewind: Action = { type: "seek", target: { kind: "by", seconds: -10 } };
  const playPause: Action = { type: "set_paused", paused: !paused };
  const forward: Action = { type: "seek", target: { kind: "by", seconds: 10 } };
  const next: Action = { type: "next_episode" };
  const stop: Action = { type: "stop_playback" };

  return [
    {
      id: "previous",
      label: "Previous episode",
      icon: "previous-episode",
      action: previous,
      disabled: previousEpisodeDisabled(view.episode),
      pending: pendingOf(view.pending, previous),
    },
    {
      id: "rewind",
      label: "Back ten seconds",
      icon: "rewind-10",
      action: rewind,
      disabled: !view.transportable,
      pending: pendingOf(view.pending, rewind),
    },
    {
      id: "playPause",
      label: paused ? "Play" : "Pause",
      icon: paused ? "play" : "pause",
      action: playPause,
      disabled: !view.transportable,
      pending: pendingOf(view.pending, playPause),
    },
    {
      id: "forward",
      label: "Forward ten seconds",
      icon: "forward-10",
      action: forward,
      disabled: !view.transportable,
      pending: pendingOf(view.pending, forward),
    },
    {
      id: "next",
      label: "Next episode",
      icon: "next-episode",
      action: next,
      disabled: nextEpisodeDisabled(view.episode),
      pending: pendingOf(view.pending, next),
    },
    {
      id: "stop",
      label: "Stop",
      icon: "close",
      action: stop,
      disabled: false,
      pending: pendingOf(view.pending, stop),
    },
  ];
}
