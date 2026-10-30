/**
 * The full control set: the pure decisions the player menu is drawn from.
 *
 * The Host's own window is one of its two equal clients, so every control the
 * Host accepts while something plays has to be reachable here — and as the same
 * Action a remote client sends, not as a private path (ADR-0002). The Host
 * decides — which tracks a Stream carries and which is on, how much is left to
 * crop, what the Player says about the bitrate — and this module only says what
 * those facts read as and what a press sends.
 *
 * Nothing here holds playback state: a choice is an Action, and what a control
 * shows is the Snapshot that came back.
 */

import type {
  Aspect,
  Chapter,
  Crop,
  CropRectangle,
  Episode,
  PlaybackState,
  Statistics,
  Track,
  TrackKind,
  VideoSize,
} from "./host-client";
import { formatTime } from "./playback";
import appearance from "./subtitle-appearance.json";
import buffer from "./stream-buffer.json";

/**
 * Whether the Host would take a control right now: a Stream that is opening,
 * playing or paused. A Stream that has ended is not one the Host will control —
 * only Stop is left — so the player menu is not offered there, and neither is a
 * control it would refuse (ADR-0013's rule for pause and seek, generalised).
 */
export function controllable(state: PlaybackState): boolean {
  return state === "opening" || state === "playing" || state === "paused";
}

/** The rates a person can pick from, slowest to fastest. */
export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

/** How far one press of a subtitle-delay button shifts the subtitles. */
export const DELAY_STEP = 0.1;

/**
 * The shapes a picture can be stretched to; `source` is the Stream's own shape,
 * which is what "no override" means. Mirrors the ratios the Host validates.
 */
export const ASPECTS: ReadonlyArray<{ label: string; aspect: Aspect }> = [
  { label: "Source", aspect: { kind: "source" } },
  { label: "16:9", aspect: { kind: "ratio", value: 16 / 9 } },
  { label: "4:3", aspect: { kind: "ratio", value: 4 / 3 } },
  { label: "21:9", aspect: { kind: "ratio", value: 21 / 9 } },
];

/** The shapes a centred crop can be cut to, derived from the aspect ratios. */
export const CROP_RATIOS: ReadonlyArray<{ label: string; ratio: number }> =
  ASPECTS.flatMap((choice) =>
    choice.aspect.kind === "ratio" ? [{ label: choice.label, ratio: choice.aspect.value }] : [],
  );

/**
 * The tracks of one kind, embedded first. The Player lists audio and subtitles
 * in mpv's own order, and that order is kept inside each group: a track that
 * came in the file is what a person reaches for first, and the ones added to the
 * Stream afterwards follow.
 */
export function orderedTracks(tracks: Track[], kind: TrackKind): Track[] {
  const ofKind = tracks.filter((track) => track.kind === kind);
  return [...ofKind.filter((track) => track.embedded), ...ofKind.filter((track) => !track.embedded)];
}

/** Whether a subtitle track is on at all; when none is, subtitles are off. */
export function subtitlesOn(tracks: Track[]): boolean {
  return tracks.some((track) => track.kind === "subtitle" && track.selected);
}

/**
 * How a track is named: whatever the container said about it, and the number the
 * Player gave where it said nothing a person could use to tell two apart.
 */
export function trackLabel(track: Track): string {
  const words = [track.title, track.language, track.codec].filter(
    (word): word is string => Boolean(word),
  );
  return words.length > 0 ? words.join(" · ") : `Track ${track.id}`;
}

/**
 * What is worth marking on a track: that it came in the file, that it is forced,
 * or that the container made it the default of its kind.
 */
export function trackMarks(track: Track): string[] {
  const marks: string[] = [];
  if (track.embedded) {
    marks.push("embedded");
  }
  if (track.forced) {
    marks.push("forced");
  }
  if (track.default) {
    marks.push("default");
  }
  return marks;
}

/**
 * The delay one step on, rounded to the tenth of a second the buttons work in,
 * so repeated steps do not accumulate a floating-point tail a person never asked
 * for.
 */
export function stepDelay(seconds: number, by: number): number {
  return Math.round((seconds + by) * 10) / 10;
}

/** A subtitle delay as a person reads it: `0.0 s`, `+0.1 s`, `−0.2 s`. */
export function formatDelay(seconds: number): string {
  const tenths = Math.round(seconds * 10) / 10;
  if (tenths === 0) {
    return "0.0 s";
  }
  const magnitude = Math.abs(tenths).toFixed(1);
  return tenths > 0 ? `+${magnitude} s` : `−${magnitude} s`;
}

/** A rate as a person reads it: `1×`, `1.5×`. */
export function formatSpeed(rate: number): string {
  return `${rate}×`;
}

/**
 * The subtitle colours Settings offers. White is the default the Host holds, so
 * it is always a choice rather than a "clear"; the rest are the colours a person
 * is likely to want from a television across the room (ADR-0024).
 *
 * The list lives in `src/subtitle-appearance.json`, beside the language list,
 * because the served Remote splices the same JSON in at serve time — one list,
 * two clients. ADR-0024's "same values by construction" is that file.
 */
export type SubtitleColorChoice = {
  /** The colour as a person reads it. */
  label: string;
  /** The `#RRGGBB` the Host stores and validates. */
  color: string;
};

export const SUBTITLE_COLORS: ReadonlyArray<SubtitleColorChoice> = appearance.colors;

/** One of the four sizes Settings offers, as the scale and the words for it. */
export type SubtitleScaleChoice = {
  /** The size as a person reads it. */
  label: string;
  /** The multiplier the Host stores. */
  scale: number;
};

/**
 * The subtitle sizes Settings offers, and the four the OSD steps through. The
 * default is `1`; the Host accepts 0.5 to 2.0 on the wire, for a Remote that
 * sends a value of its own.
 */
export const SUBTITLE_SCALES: ReadonlyArray<SubtitleScaleChoice> = appearance.scales;

/** The smallest scale the Host accepts, shared with the Remote and the Host. */
export const SUBTITLE_SCALE_MIN = appearance.minScale;

/** The largest scale the Host accepts, shared with the Remote and the Host. */
export const SUBTITLE_SCALE_MAX = appearance.maxScale;

/**
 * The scale one OSD press from `scale`, in `direction`: the neighbouring preset,
 * never a value between presets. `1` is up and `-1` down. A value between two
 * presets — one a Remote set — moves to the neighbour in the direction asked,
 * and a value outside the ladder is brought to its nearest end (50% → 80%,
 * 160% → 150%), so a press always leaves the readout naming one of the four.
 */
export function stepScale(scale: number, direction: -1 | 1): number {
  if (direction > 0) {
    const larger = SUBTITLE_SCALES.find((choice) => choice.scale > scale + 1e-6);
    return larger?.scale ?? SUBTITLE_SCALES[SUBTITLE_SCALES.length - 1]!.scale;
  }
  const smaller = [...SUBTITLE_SCALES]
    .reverse()
    .find((choice) => choice.scale < scale - 1e-6);
  return smaller?.scale ?? SUBTITLE_SCALES[0]!.scale;
}

/** A subtitle size as a person reads it: `80%`, `100%`, `125%`. */
export function formatScale(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}

/** Whether the size the Host published is this choice. */
export function scaleSelected(current: number, choice: number): boolean {
  return Math.abs(current - choice) < 1e-6;
}

/**
 * Whether the size the Host holds is one of the four Settings presets. A value
 * that is not — a Remote may set any scale the Host accepts — is shown as its
 * own `Other (n%)` choice rather than leaving the size chips with nothing pressed.
 */
export function scalePreset(scale: number): boolean {
  return SUBTITLE_SCALES.some((choice) => scaleSelected(scale, choice.scale));
}

/** Whether the colour the Host published is this choice, whatever the case. */
export function colorSelected(current: string, choice: string): boolean {
  return current.toUpperCase() === choice.toUpperCase();
}

/** One look-ahead Settings offers, as the seconds and the words for it. */
export type BufferSecondsChoice = {
  label: string;
  seconds: number;
};

/** One memory ceiling Settings offers, as the megabytes and the words for it. */
export type BufferMegabytesChoice = {
  label: string;
  megabytes: number;
};

/**
 * The Stream buffer presets, from `src/stream-buffer.json` — the one list the
 * window and the served Remote share, spliced into the page at serve time.
 * Five minutes up to half a gigabyte is the default; a person raises it when a
 * network dip outlasts the Player's own cache (ADR-0026).
 */
export const STREAM_BUFFER_SECONDS: ReadonlyArray<BufferSecondsChoice> = buffer.seconds;

/** The memory ceilings Settings offers, beside the look-aheads above. */
export const STREAM_BUFFER_MEGABYTES: ReadonlyArray<BufferMegabytesChoice> = buffer.megabytes;

/** The look-ahead the Host starts from, in seconds. */
export const STREAM_BUFFER_DEFAULT_SECONDS = buffer.defaultSeconds;

/** The memory ceiling the Host starts from, in megabytes. */
export const STREAM_BUFFER_DEFAULT_MEGABYTES = buffer.defaultMegabytes;

/**
 * A look-ahead as a person reads it: the preset's own words where it is one,
 * and `12 min` / `90 s` for a value a Remote sent that the ladder does not hold.
 */
export function formatBufferSeconds(seconds: number): string {
  if (seconds >= 60 && seconds % 60 === 0) {
    return `${seconds / 60} min`;
  }
  return `${seconds} s`;
}

/** A memory ceiling as a person reads it, in the decimal megabytes the Host stores. */
export function formatBufferMegabytes(megabytes: number): string {
  return `${megabytes} MB`;
}

/** Whether the look-ahead the Host holds is one of Settings' presets. */
export function bufferSecondsPreset(seconds: number): boolean {
  return STREAM_BUFFER_SECONDS.some((choice) => choice.seconds === seconds);
}

/** Whether the memory ceiling the Host holds is one of Settings' presets. */
export function bufferMegabytesPreset(megabytes: number): boolean {
  return STREAM_BUFFER_MEGABYTES.some((choice) => choice.megabytes === megabytes);
}

/** Whether a rate the Host published is a choice the menu offers. */
export function speedSelected(rate: number | null, choice: number): boolean {
  return rate !== null && Math.abs(rate - choice) < 1e-6;
}

/** The Player's loudest level: above 100 is a boost, not a second scale. */
export const VOLUME_MAX = 130;

/** A volume as a person reads it, on the Player's scale where 100 is full. */
export function formatVolume(level: number): string {
  return `${Math.round(level)}%`;
}

/** Where a level sits on the fader, clamped to the Player's scale. */
export function volumeFraction(level: number): number {
  return Math.min(1, Math.max(0, level / VOLUME_MAX));
}

/** How a chapter is named: where it starts, and its title where it has one. */
export function chapterLabel(chapter: Chapter): string {
  const at = formatTime(chapter.time);
  return chapter.title ? `${at} — ${chapter.title}` : at;
}

/**
 * The largest centred rectangle of `ratio` that fits the source, in the source's
 * own pixels.
 *
 * The picture is not scaled to the ratio — a strip of it is cut away — so the
 * crop is as large as the source allows and is centred: the wider side keeps its
 * full extent and the other is trimmed, then what is left over is split evenly.
 * A source already at the ratio crops to itself.
 */
export function centredCrop(size: VideoSize, ratio: number): CropRectangle {
  const sourceRatio = size.width / size.height;
  let width: number;
  let height: number;

  if (sourceRatio > ratio) {
    // The source is wider than the shape wanted: keep the height, trim the sides.
    height = size.height;
    width = Math.max(1, Math.min(size.width, Math.round(size.height * ratio)));
  } else {
    // The source is taller than the shape wanted: keep the width, trim top and bottom.
    width = size.width;
    height = Math.max(1, Math.min(size.height, Math.round(size.width / ratio)));
  }

  return {
    width,
    height,
    x: Math.floor((size.width - width) / 2),
    y: Math.floor((size.height - height) / 2),
  };
}

/**
 * The crop choices: the whole frame, then one centred rectangle per ratio, each
 * computed from the picture's own size. A Stream whose size the Player has not
 * reported offers only the whole frame — a crop cannot be computed from nothing,
 * and inventing one would be a rectangle of the wrong picture.
 */
export function cropChoices(size: VideoSize | null): Array<{ label: string; crop: Crop }> {
  const whole: { label: string; crop: Crop } = {
    label: "Full frame",
    crop: { kind: "off" },
  };
  if (!size) {
    return [whole];
  }

  return [
    whole,
    ...CROP_RATIOS.map(({ label, ratio }) => ({
      label,
      crop: { kind: "rectangle", ...centredCrop(size, ratio) } as Crop,
    })),
  ];
}

/** Whether the picture's current crop is this choice. `null` is the whole frame. */
export function cropSelected(current: CropRectangle | null, choice: Crop): boolean {
  if (choice.kind === "off") {
    return current === null;
  }
  return (
    current !== null &&
    current.width === choice.width &&
    current.height === choice.height &&
    current.x === choice.x &&
    current.y === choice.y
  );
}

/**
 * Whether the picture is being drawn at this shape. Nothing loaded has no
 * override yet, so the Stream's own shape reads as selected until a ratio is put
 * on it.
 */
export function aspectSelected(current: Aspect | null, choice: Aspect): boolean {
  if (choice.kind === "source") {
    return current === null || current.kind === "source";
  }
  return current?.kind === "ratio" && Math.abs(current.value - choice.value) < 1e-3;
}

/**
 * What the Player says about how a Stream is playing, in a person's words. Every
 * field is optional at the source — the Player reports what the platform gives —
 * so an absent one reads as unknown rather than as zero.
 */
export function statisticsLines(
  statistics: Statistics | null,
): Array<{ label: string; value: string }> {
  return [
    { label: "Bitrate", value: formatBitrate(statistics?.bitrate ?? null) },
    {
      label: "Dropped frames",
      value: statistics?.droppedFrames === null || statistics?.droppedFrames === undefined
        ? "—"
        : String(statistics.droppedFrames),
    },
    { label: "Hardware decode", value: statistics?.hardwareDecode ?? "—" },
  ];
}

export function formatBitrate(bits: number | null): string {
  if (bits === null) {
    return "—";
  }
  if (bits >= 1_000_000) {
    return `${(bits / 1_000_000).toFixed(1)} Mbps`;
  }
  if (bits >= 1_000) {
    return `${Math.round(bits / 1_000)} kbps`;
  }
  return `${bits} bps`;
}

/**
 * Whether the episode step back is one the Host might take, from the position
 * it published: a film has no episodes at all, and S1E1 is the one episode a
 * position alone can say has nothing before it (ADR-0021).
 *
 * This is the window greying a control, not the Host's rule: whether an earlier
 * Video *exists* is the Host's answer, and it may still refuse — the Addon's
 * list begins at the episode playing, or begins somewhere the numbers do not
 * describe — so a press at the boundary returns `no_previous_episode` and is
 * shown where it happened. Re-deciding existence here would be a second rule
 * for one question, which is the duplicate ADR-0002 exists to prevent.
 */
export function previousEpisodeDisabled(episode: Episode | null): boolean {
  return episode === null || (episode.season === 1 && episode.episode === 1);
}

/**
 * The same rule for the step forward: every episode has a next one until the
 * Addon's own list runs out, which only a press can find out, so only a film —
 * no episode at all — greys the control.
 */
export function nextEpisodeDisabled(episode: Episode | null): boolean {
  return episode === null;
}
