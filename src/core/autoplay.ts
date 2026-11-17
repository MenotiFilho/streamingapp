/**
 * What a client draws of Autoplay: the Host's countdown, projected.
 *
 * The Host publishes the countdown once, in `PlaybackSnapshot.autoplay`, with
 * `remaining` and `duration` as relative seconds as of that Snapshot. A client
 * never compares wall clocks with the Host: it counts the time since the
 * Snapshot arrived on its own monotonic clock and takes it off `remaining`
 * (ADR-0033, ADR-0040). The window's corner card and docked band and the
 * Remote's banner and strip are drawings of this one view.
 *
 * Only the countdown is drawn so far; the held and missing-Stream phases arrive
 * with the Host rules that publish them.
 */

import type { PlaybackSnapshot, UpNextEpisode } from "./wire";

/** The episode Autoplay is about to play, ready to draw. */
export type AutoplayNext = {
  title: UpNextEpisode["title"];
  video: UpNextEpisode["video"];
  /** `S1E4`. */
  label: string;
  name: string | null;
  still: string | null;
};

/** The kicker over the card: "Up next" and the episode, apart so a drawing can rule between. */
export type AutoplayKicker = {
  lead: string;
  episode: string;
  /** Both, as one line: "Up next · S1E4". */
  text: string;
};

export type AutoplayView =
  | { kind: "none" }
  | {
      kind: "countdown";
      /** Whole seconds left, rounded up, and never below 1 while the countdown is up. */
      digit: number;
      /** What is left of the countdown, 1 at its start draining to 0. */
      fraction: number;
      next: AutoplayNext;
      kicker: AutoplayKicker;
      /** The docked strip's text: "Up next in 4 · S1E4". */
      strip: string;
    };

/** What the kicker leads with. */
const KICKER_LEAD = "Up next";

/**
 * What Autoplay is doing, from one Snapshot and the milliseconds since it
 * arrived on this client.
 */
export function autoplayView(
  playback: Pick<PlaybackSnapshot, "autoplay">,
  sinceSnapshotMs: number,
): AutoplayView {
  const held = playback.autoplay;
  if (held === null) {
    return { kind: "none" };
  }

  const gone = Number.isFinite(sinceSnapshotMs) ? Math.max(0, sinceSnapshotMs) / 1000 : 0;
  const left = Math.max(0, held.remaining - gone);
  const digit = Math.max(1, Math.ceil(left));
  const fraction =
    Number.isFinite(held.duration) && held.duration > 0 ? Math.min(1, left / held.duration) : 0;
  const label = `S${held.next.episode.season}E${held.next.episode.episode}`;

  return {
    kind: "countdown",
    digit,
    fraction,
    next: {
      title: held.next.title,
      video: held.next.video,
      label,
      name: held.next.name,
      still: held.next.still,
    },
    kicker: { lead: KICKER_LEAD, episode: label, text: `${KICKER_LEAD} · ${label}` },
    strip: `${KICKER_LEAD} in ${digit} · ${label}`,
  };
}
