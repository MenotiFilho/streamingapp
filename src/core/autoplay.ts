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
 * Two phases are drawn: the countdown, and the hold on "Still watching?" the
 * Host publishes after three episodes nobody touched, which has no countdown to
 * project. The missing-Stream phase arrives with the Host rule that publishes it.
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
    }
  | {
      /** The unattended limit: no digit and no line, and only a play moves on. */
      kind: "still_watching";
      next: AutoplayNext;
      /** What the card is titled: "Still watching?". */
      title: string;
      /** The docked strip's text: "Still watching? · S1E4". */
      strip: string;
    };

/** What the kicker leads with. */
const KICKER_LEAD = "Up next";

/** What the hold asks, as the card's title and the strip's lead. */
const STILL_WATCHING = "Still watching?";

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

  const label = `S${held.next.episode.season}E${held.next.episode.episode}`;
  const next: AutoplayNext = {
    title: held.next.title,
    video: held.next.video,
    label,
    name: held.next.name,
    still: held.next.still,
  };

  if (held.phase === "unattended_limit") {
    return {
      kind: "still_watching",
      next,
      title: STILL_WATCHING,
      strip: `${STILL_WATCHING} · ${label}`,
    };
  }

  const gone = Number.isFinite(sinceSnapshotMs) ? Math.max(0, sinceSnapshotMs) / 1000 : 0;
  const left = Math.max(0, held.remaining - gone);
  const digit = Math.max(1, Math.ceil(left));
  const fraction =
    Number.isFinite(held.duration) && held.duration > 0 ? Math.min(1, left / held.duration) : 0;

  return {
    kind: "countdown",
    digit,
    fraction,
    next,
    kicker: { lead: KICKER_LEAD, episode: label, text: `${KICKER_LEAD} · ${label}` },
    strip: `${KICKER_LEAD} in ${digit} · ${label}`,
  };
}

/**
 * The docked strip's text — "Up next in 4 · S1E4", "Still watching? · S1E4" —
 * or `null` where Autoplay has nothing to say and the strip names the episode
 * it already did. The window's docked band and the Remote's strip both read it.
 */
export function autoplayStrip(view: AutoplayView): string | null {
  return view.kind === "countdown" || view.kind === "still_watching" ? view.strip : null;
}
