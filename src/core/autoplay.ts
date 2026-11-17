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
 * Three phases are drawn: the countdown, the hold on "Still watching?" the Host
 * publishes after three episodes nobody touched (no countdown to project), and
 * the missing Stream (no countdown either; the Streams picker is what is pushed).
 */

import type { Episode, PlaybackSnapshot, Title, UpNextEpisode, Video } from "./wire";

/** The episode Autoplay is about to play, ready to draw. */
export type AutoplayNext = {
  title: UpNextEpisode["title"];
  video: UpNextEpisode["video"];
  /** Which episode, as the Host numbered it. */
  episode: Episode;
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
    }
  | {
      kind: "no_stream";
      /** The episode continuity found no Stream for: the Streams picker opens on it. */
      next: AutoplayNext;
      /** Why, as the Host said it. */
      detail: string;
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
    episode: held.next.episode,
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

  if (held.phase === "no_stream") {
    return { kind: "no_stream", next, detail: held.detail };
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

/**
 * Whether a client opens the Streams picker now: once per missing-Stream target.
 *
 * `previous` is what the client last drew and `next` what it draws now. It is
 * true when `next` is a missing Stream for a Video `previous` was not already
 * about, so a repeated Snapshot for the same Video opens nothing more and a
 * different Video opens it again. Where a client is allowed to open it — the
 * window on its player level, the Remote on its expanded player card — is the
 * client's own rule.
 */
export function opensPicker(previous: AutoplayView, next: AutoplayView): boolean {
  const target = pickerTarget(next);
  return target !== null && target !== pickerTarget(previous);
}

/**
 * What a missing Stream is about, as one key: the Video continuity found no
 * Stream for, or `null` where Autoplay is not at a missing Stream. A client
 * asks again only when this changes.
 */
export function pickerTarget(view: AutoplayView): string | null {
  return view.kind === "no_stream" ? `${view.next.video.type}|${view.next.video.id}` : null;
}

/**
 * The Video the Streams picker opens on for a missing Stream: the Title's own
 * entry for it, or — where its list does not hold the episode — one built from
 * what Autoplay named. The Video's id is opaque (ADR-0012): the season and
 * episode come from the Host's `episode`, never from parsing the id.
 */
export function missingStreamVideo(
  title: Pick<Title, "videos">,
  next: Pick<AutoplayNext, "video" | "episode" | "name" | "still">,
): Video {
  return (
    title.videos.find((video) => video.id === next.video.id) ?? {
      id: next.video.id,
      name: next.name,
      season: next.episode.season,
      episode: next.episode.episode,
      thumbnail: next.still,
      airDate: null,
    }
  );
}

/**
 * Whether the ended state is drawn as it always was — its note and **Next
 * episode** — because no card is up over it. A missing Stream is no card: the
 * Host stays on the ended state, and the picker is what is pushed for it.
 */
export function plainEnd(view: AutoplayView): boolean {
  return view.kind === "none" || view.kind === "no_stream";
}
