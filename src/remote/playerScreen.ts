import { actionKey } from "../core/actionKey";
import {
  autoplayStrip,
  opensPicker,
  plainEnd,
  type AutoplayView,
} from "../core/autoplay";
import { AUTOPLAY_SWITCH_LABEL, VOLUME_MAX } from "../core/controls";
import type { Level, NewLevel } from "../core/navigation";
import { marqueeEpisodeCode, streamTitle } from "../core/osd";
import { playingName, watching } from "../core/playback";
import type { PlaybackView } from "../core/playbackView";
import { STALLED_NOTE, STALLED_STRIP_NOTE } from "../core/stall";
import {
  transportControls,
  type TransportControl,
} from "../core/transportControls";
import { theFilm } from "../core/stream";
import type {
  Action,
  PlaybackSnapshot,
  PlaybackState,
  ResumeEntry,
  Title,
} from "../core/wire";
import type { RemotePayload } from "./levels";

/**
 * The Remote player's own decisions and its own copy (#213, ADR-0035 §2).
 *
 * The playback facts are the core's: `playbackView`, `transportControls`,
 * `watching`, `pictureNote`, `formatTime` and `playingName` already say what
 * is playing and what each press does. What lives here is only what this
 * client's drawing decides — which two controls the docked strip carries, what
 * its one line reads, which art and words name what is playing, when a failed
 * open keeps the Remote up, and the words the phone alone prints. No rule here
 * holds state; the Snapshot is the truth and the Session's pending keys are the
 * wait.
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
 * fullscreen Remote drawn over the destination it was opened from.
 */
export const CARD_NAME = "Player";

/** The strip's name, as it is announced beside the room. */
export const STRIP_LABEL = "Now playing";

/** The one control that opens the card from the strip, as the kit names it. */
export const STRIP_EXPAND = "Open the remote";

/** The fullscreen Remote's head (`P3`). */
export const REMOTE_HEADING = "Playing on the Host";

/** The control that puts the fullscreen Remote away without stopping. */
export const COLLAPSE_LABEL = "Close the remote";

/** The card's note while the Host is opening the Stream. */
export function openingNote(name: string): string {
  return `Opening ${name}…`;
}

/** The card's note when the Stream has run to its end. */
export const ENDED_NOTE = "The Stream reached its end.";

/**
 * The card's one state note: the Host opening the Stream, or the Stream's end.
 *
 * While the Host's countdown is up the banner says what is happening and the
 * ended note would say it twice, so the note steps aside (#318, #302).
 */
export function cardStateNote(
  view: Pick<PlaybackView, "state" | "nowPlaying" | "autoplay" | "stalled">,
  stallUp = false,
): string | null {
  if (view.state === "opening") {
    return openingNote(playingName(view.nowPlaying));
  }
  // `stallUp` is the client's own `stallShown`: a seek's brief wait is a stall
  // the Host published and the card draws nothing for.
  if (view.stalled && stallUp) {
    return STALLED_NOTE;
  }
  if (view.state === "ended" && plainEnd(view.autoplay)) {
    return ENDED_NOTE;
  }
  return null;
}

/**
 * The Torrent status line the card's state note carries beneath it: the same
 * `torrentLine` the window draws, under "Opening …" and under the Stalled
 * sentence, and nowhere else (#342, ADR-0042 §5). A direct Stream has none, and
 * a note that is not the opening or the shown Stalled one has nothing to carry
 * it; the docked strip's "Waiting…" is deliberately only that word.
 */
export function cardTorrentLine(
  view: Pick<PlaybackView, "state" | "stalled" | "torrentLine">,
  stallUp = false,
): string | null {
  if (view.state === "opening" || (view.stalled && stallUp)) {
    return view.torrentLine;
  }
  return null;
}

/**
 * What the docked strip says under the episode: "Waiting…" while a shown stall
 * holds the Stream, ahead of the core's note about where the picture is. Text
 * only; nothing new is said while the Stream is opening.
 */
export function stripNote(
  view: Pick<PlaybackView, "stalled" | "pictureNote">,
  stallUp: boolean,
): string | null {
  const parts = [view.stalled && stallUp ? STALLED_STRIP_NOTE : null, view.pictureNote].filter(
    (part): part is string => part !== null,
  );
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * Whether the Remote pushes the Streams picker for a missing Stream now: once
 * per target (the core's `opensPicker`), and only while it is on its expanded
 * player card. A Remote on a browse or Settings screen, on a plate over the
 * card, or on a list it already has open is not interrupted (#320, #302).
 * `levelKind` is the kind of the level on show, `null` for a destination.
 */
export function pushesPicker(
  previous: AutoplayView,
  view: AutoplayView,
  levelKind: string | null,
): boolean {
  return levelKind === "player" && opensPicker(previous, view);
}

/** The Autoplay switch row: what it says, where it stands, what a press sends. */
export type AutoplaySwitchRow = {
  label: string;
  on: boolean;
  /** The Action a press takes: `set_autoplay` with the value it flips to. */
  toggle: (next: boolean) => Extract<Action, { type: "set_autoplay" }>;
};

/**
 * The always-visible switch row on the expanded card, or `null` where there is
 * nothing for it to do. Autoplay acts only on an episode's Stream, so a film's
 * card draws none (#302, #287).
 */
export function autoplaySwitch(
  view: Pick<PlaybackView, "episode">,
  on: boolean,
): AutoplaySwitchRow | null {
  if (view.episode === null) {
    return null;
  }
  return {
    label: AUTOPLAY_SWITCH_LABEL,
    on,
    toggle: (next) => ({ type: "set_autoplay", autoplay: next }),
  };
}

type Countdown = Extract<AutoplayView, { kind: "countdown" }>;
type StillWatching = Extract<AutoplayView, { kind: "still_watching" }>;

/** The countdown banner: the core's view, plus the two Actions it carries. */
export type CountdownBanner = Countdown & {
  /** Skip the rest of the countdown: the Host's `next_episode`. */
  playNow: { action: Action; pending: boolean };
  /** Stop this countdown and keep the preference. */
  cancel: { action: Action };
};

/** The "Still watching?" banner: the core's view, plus its one Action. */
export type StillWatchingBanner = StillWatching & {
  /** Carry on: the Host's `next_episode`, the only thing that moves a hold on. */
  keepWatching: { action: Action; pending: boolean };
};

/** What the Remote's banner draws: the countdown, or the hold. */
export type AutoplayBanner = CountdownBanner | StillWatchingBanner;

/**
 * The Remote's banner while the Host counts down or holds, or `null`.
 *
 * It is the one `autoplayView` the window's card draws too; this adds only the
 * Actions the buttons take. Play now and Keep watching are the same
 * `next_episode` the transport's step sends, so their wait is the same Session
 * key.
 */
export function autoplayBanner(
  view: Pick<PlaybackView, "autoplay" | "pending">,
): AutoplayBanner | null {
  const next: Action = { type: "next_episode" };
  const step = { action: next, pending: view.pending.has(actionKey(next)) };

  switch (view.autoplay.kind) {
    case "countdown":
      return { ...view.autoplay, playNow: step, cancel: { action: { type: "cancel_autoplay" } } };
    case "still_watching":
      return { ...view.autoplay, keepWatching: step };
    default:
      return null;
  }
}

/** A chapter's name: its title where the container gave one, else its place. */
export function chapterName(chapter: { index: number; title: string | null }): string {
  return chapter.title ?? `Chapter ${chapter.index + 1}`;
}

/**
 * The expanded card, as the level a strip press pushes. It is a `player` level
 * so the core's Back pops it, and the destination underneath does not move;
 * Back closes the card and sends nothing, because Stop is its own control.
 *
 * It carries the one id a client can push twice: changing an episode from its
 * Episodes sheet opens a Streams list above the Remote, and the Stream a
 * person picks there pushes the player again. The id replaces the card rather
 * than stacking a second one that one Back cannot close.
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
 * the Stream's end, or another client's Stop. A failed open is the exception
 * (`failedOpen`).
 */
export function playerLevelStale(
  payload: RemotePayload,
  playback: PlaybackState,
  failed = false,
): boolean {
  return payload.kind === "player" && !watching(playback) && !failed;
}

/**
 * Why the Stream the Host is on did not open (or why the Host ended it), or
 * null. The Host is `idle` with the failure beside the Stream it was on, and
 * still takes `switch_stream` and `stop_playback` for it (ADR-0044 §3), so the
 * fullscreen Remote that was already up stays to offer both. Stop clears it.
 */
export function failedOpen(
  playback: Pick<PlaybackSnapshot, "state" | "failure" | "nowPlaying"> | null,
): string | null {
  if (!playback || playback.state !== "idle" || playback.nowPlaying === null) {
    return null;
  }
  return playback.failure;
}

/** The head over a failed open, and the one line saying what to do. */
export const FAILED_TITLE = "The Stream stopped with an error";
export const FAILED_HINT = "Pick another Stream to keep your place.";

/**
 * Whether the docked strip is drawn over the stack as it stands (#258,
 * ADR-0036 §4).
 *
 * The strip says what is playing from the screen under it; on the player's own
 * screen it would point at the screen a person is already on, so it steps
 * aside. A sheet is furniture above that screen — the person is still on the
 * Remote — while a Streams list opened from the Episodes sheet is a screen again
 * and the strip returns.
 */
export function stripDrawn(
  levels: ReadonlyArray<Level<RemotePayload>>,
): boolean {
  const screen = [...levels]
    .reverse()
    .find((held) => held.payload.kind !== "sheet");
  return screen?.payload.kind !== "player";
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

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
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

/** The time left in whole minutes (`31 min left`), or null where unknown. */
export function timeLeft(position: number | null, duration: number | null): string | null {
  if (
    position === null ||
    duration === null ||
    !Number.isFinite(duration) ||
    duration <= position
  ) {
    return null;
  }
  return `${Math.max(1, Math.round((duration - position) / 60))} min left`;
}

/**
 * The strip's one line under the name (`P1`: `S2 E3 · 31 min left`): Autoplay's
 * own words while the Host counts down or holds, else the episode; the time left,
 * which gives way to "Waiting…" or the note about where the picture is; and the
 * core's episode label where nothing else is known.
 */
export function stripLine(
  view: Pick<
    PlaybackView,
    | "episode"
    | "episodeLabel"
    | "autoplay"
    | "position"
    | "duration"
    | "stalled"
    | "pictureNote"
  >,
  stallUp: boolean,
): string {
  const note = stripNote(view, stallUp);
  const autoplay = autoplayStrip(view.autoplay);
  const episode = view.episode ? marqueeEpisodeCode(view.episode) : null;
  const left =
    note === null && autoplay === null ? timeLeft(view.position, view.duration) : null;
  const parts = [autoplay ?? episode, left, note].filter(
    (part): part is string => Boolean(part),
  );
  return parts.length > 0 ? parts.join(" · ") : view.episodeLabel;
}

/** What the Remote draws about the Title whose Stream the Host is on. */
export type PlayingTitle = {
  /** The Title's id, where Watch progress or the held Title names it. */
  id: string | null;
  name: string;
  /** `S2 E3 · Who Is Alive?`, or null for a film. */
  episode: string | null;
  /** The episode's synopsis, or the film's. */
  description: string | null;
  /** The Title's poster, never a frame of what is playing. */
  poster: string | null;
  /** The ambient background's art (`docs/design-system.md` §9). */
  backdrop: string | null;
};

/**
 * The Title facts the strip and the fullscreen Remote draw. The Snapshot names
 * the Stream, not the Title: Watch progress carries the Title's name and art,
 * and the Title this client already holds fills what it lacks — only where it
 * is the one playing, so a page read behind the strip never lends its art to
 * another Title. Nothing is asked of the Host.
 */
export function playingTitle(
  playback: Pick<PlaybackSnapshot, "nowPlaying" | "episode">,
  watchProgress: readonly ResumeEntry[],
  held: Title | null,
): PlayingTitle {
  const videoId = playback.nowPlaying?.video.id ?? null;
  const progress = watchProgress.find((entry) => entry.video.id === videoId) ?? null;
  const listed = held?.videos.find((video) => video.id === videoId) ?? null;
  const title =
    held && (listed || theFilm(held).id === videoId || held.id === progress?.title.id)
      ? held
      : null;

  const season = progress?.video.season ?? listed?.season ?? null;
  const number = progress?.video.episode ?? listed?.episode ?? null;
  const code = playback.episode
    ? marqueeEpisodeCode(playback.episode)
    : season !== null && number !== null
      ? marqueeEpisodeCode({ season, episode: number })
      : null;
  const episodeName = code ? (progress?.video.name ?? listed?.name ?? null) : null;
  const episode =
    [code, episodeName].filter((part): part is string => Boolean(part)).join(" · ") || null;

  const poster = progress?.title.poster ?? title?.poster ?? null;

  return {
    id: progress?.title.id ?? title?.id ?? null,
    name: progress?.title.name ?? title?.name ?? streamTitle(playback.nowPlaying),
    episode,
    description: code
      ? (progress?.video.description ?? listed?.description ?? null)
      : (title?.description ?? null),
    poster,
    backdrop: progress?.title.background ?? title?.background ?? poster,
  };
}
