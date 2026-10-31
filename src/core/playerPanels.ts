/**
 * The player panels' sections, as rows both players compose (#191 §7).
 *
 * The five menus are not the same five — the window opens one popover per icon,
 * the Remote folds Audio and Subtitles into one sheet — so the *panel* stays a
 * client's. The *sections* are shared: each returns the groups and rows that
 * client arranges, and the drawing decides chips, rows, notes and readouts.
 */

import {
  ASPECTS,
  DELAY_STEP,
  SPEEDS,
  aspectSelected,
  chapterLabel,
  cropChoices,
  cropSelected,
  formatDelay,
  formatScale,
  formatSpeed,
  orderedTracks,
  speedSelected,
  statisticsLines,
  stepDelay,
  stepScale,
  subtitlesOn,
  trackLabel,
  trackMarks,
} from "./controls";
import type { Action, Chapter, PlaybackSnapshot, Track } from "./wire";

/** One choice row: a row that is pressed when it is the value in force. */
export type ChoiceRow = {
  kind: "choice";
  /** The stable key a client also uses as the row's test id. */
  key: string;
  /** The accessible name of the row. */
  label: string;
  /** The visible text where it is a glyph and the label is a phrase. */
  text?: string;
  pressed: boolean;
  action: Action;
  /** The container's own words about a track, where it gave any. */
  marks?: string[];
  disabled?: boolean;
};

/** One action row: a press that performs something rather than choosing a value. */
export type ActionRow = {
  kind: "action";
  key: string;
  /** The accessible name of the row. */
  label: string;
  /** The visible text where it is a glyph and the label is a phrase. */
  text?: string;
  /** Null where the press is the client's own state, as the statistics toggle is. */
  action: Action | null;
  pressed?: boolean;
  disabled?: boolean;
};

/** A readout: a value or the Player's statistics lines, never a press. */
export type ReadoutRow = {
  kind: "readout";
  key: string;
  /** The accessible name, where the visible text is not one. */
  label?: string;
  value?: string;
  lines?: Array<{ label: string; value: string }>;
};

/** A note: the empty-list copy, kept verbatim (`docs/agents/testing.md` §1.4). */
export type NoteRow = { kind: "note"; key: string; text: string };

/** The key the statistics toggle's row carries; the drawing owns its local state. */
export const STATISTICS_TOGGLE_KEY = "toggle-statistics";

export type PanelRow = ChoiceRow | ActionRow | ReadoutRow | NoteRow;

/** One headed group of rows; a client arranges the groups it draws. */
export type PanelGroup = { title: string; rows: PanelRow[] };

function trackChoice(track: Track): ChoiceRow {
  return {
    kind: "choice",
    key: `track-${track.kind}-${track.id}`,
    label: trackLabel(track),
    pressed: track.selected,
    action:
      track.kind === "audio"
        ? { type: "set_audio_track", track: track.id }
        : { type: "set_subtitle_track", track: track.id },
    marks: trackMarks(track),
  };
}

function trackChoices(tracks: Track[]): ChoiceRow[] {
  return tracks.map(trackChoice);
}

/**
 * Aspect, the crop choices, Autocrop and statistics.
 *
 * `showStatistics` is the client's own state: the toggle opens a panel of lines
 * the Player publishes, and nothing about it is the Host's to remember.
 */
export function pictureSections(
  playback: PlaybackSnapshot,
  showStatistics: boolean,
): PanelGroup[] {
  const crop = playback.crop;

  const aspect: PanelGroup = {
    title: "Aspect",
    rows: ASPECTS.map(({ label, aspect: choice }) => ({
      kind: "choice" as const,
      key: `aspect-${label}`,
      label,
      pressed: aspectSelected(playback.aspect, choice),
      action: { type: "set_aspect" as const, aspect: choice },
    })),
  };

  const cropGroup: PanelGroup = {
    title: "Crop",
    rows: [
      ...cropChoices(playback.resolution).map(({ label, crop: choice }) => ({
        kind: "choice" as const,
        key: `crop-${label}`,
        label,
        pressed: cropSelected(crop, choice),
        action: { type: "set_crop" as const, crop: choice },
      })),
      {
        kind: "action" as const,
        key: "autocrop",
        label: crop ? "Restore full frame" : "Autocrop",
        action: { type: "autocrop" as const },
      },
      {
        kind: "readout" as const,
        key: "osd-crop-readout",
        value: crop
          ? `Autocrop keeps ${crop.width}×${crop.height}+${crop.x}+${crop.y}.`
          : "Autocrop keeps the whole frame.",
      },
    ],
  };

  const statisticsRows: PanelRow[] = [
    {
      kind: "action",
      key: STATISTICS_TOGGLE_KEY,
      label: showStatistics ? "Hide statistics" : "Show statistics",
      pressed: showStatistics,
      action: null,
    },
  ];
  if (showStatistics) {
    statisticsRows.push({
      kind: "readout",
      key: "statistics",
      lines: statisticsLines(playback.statistics),
    });
  }

  return [aspect, cropGroup, { title: "Statistics", rows: statisticsRows }];
}

/** The Stream's audio tracks, embedded first, in the Player's order inside each group. */
export function audioSection(playback: PlaybackSnapshot): PanelGroup {
  const ordered = trackChoices(orderedTracks(playback.tracks, "audio"));

  return {
    title: "Tracks",
    rows:
      ordered.length === 0
        ? [
            {
              kind: "note",
              key: "no-audio-tracks",
              text: "This Stream carries no audio track to pick.",
            },
          ]
        : ordered,
  };
}

/**
 * Subtitles: the tracks and Subtitles off, the delay and its tenth-of-a-second
 * steps, and the size. The four sections are one sheet on the Remote and three
 * groups on the window; both draw these rows.
 */
export function subtitleSections(
  playback: PlaybackSnapshot,
  subtitleScale: number,
): PanelGroup[] {
  const ordered = trackChoices(orderedTracks(playback.tracks, "subtitle"));
  const delay = playback.subtitleDelay ?? 0;

  const trackRows: PanelRow[] = [];
  if (ordered.length === 0) {
    trackRows.push({
      kind: "note",
      key: "no-subtitle-tracks",
      text: "This Stream carries no subtitle track to pick.",
    });
  }
  trackRows.push(...ordered, {
    kind: "choice",
    key: "subtitles-off",
    label: "Subtitles off",
    pressed: !subtitlesOn(playback.tracks),
    action: { type: "set_subtitle_track", track: null },
  });

  return [
    { title: "Tracks", rows: trackRows },
    {
      title: `Delay · ${formatDelay(delay)}`,
      rows: [
        {
          kind: "readout",
          key: "subtitle-delay",
          value: formatDelay(delay),
        },
        {
          kind: "action",
          key: "delay-back",
          label: "−0.1 s",
          action: { type: "set_subtitle_delay", seconds: stepDelay(delay, -DELAY_STEP) },
        },
        {
          kind: "action",
          key: "delay-forward",
          label: "+0.1 s",
          action: { type: "set_subtitle_delay", seconds: stepDelay(delay, DELAY_STEP) },
        },
        {
          kind: "choice",
          key: "delay-reset",
          label: "Reset",
          pressed: delay === 0,
          action: { type: "set_subtitle_delay", seconds: 0 },
        },
      ],
    },
    {
      title: "Size",
      rows: [
        {
          kind: "readout",
          key: "subtitle-scale",
          label: `Subtitle size ${formatScale(subtitleScale)}`,
          value: `Subtitle size ${formatScale(subtitleScale)}`,
        },
        {
          kind: "action",
          key: "subtitle-scale-down",
          label: "Smaller subtitles",
          text: "−",
          action: { type: "set_subtitle_scale", scale: stepScale(subtitleScale, -1) },
        },
        {
          kind: "action",
          key: "subtitle-scale-up",
          label: "Larger subtitles",
          text: "+",
          action: { type: "set_subtitle_scale", scale: stepScale(subtitleScale, 1) },
        },
      ],
    },
  ];
}

/** The rates a person can pick, with the one in force pressed. */
export function speedSection(playback: PlaybackSnapshot): PanelGroup {
  return {
    title: "Playback speed",
    rows: SPEEDS.map((rate) => ({
      kind: "choice" as const,
      key: `speed-${rate}`,
      label: formatSpeed(rate),
      pressed: speedSelected(playback.speed, rate),
      action: { type: "set_speed" as const, rate },
    })),
  };
}

/**
 * The container's chapters, in its own order, with the two steps the Remote's
 * sheet offers. The window deliberately has no Previous/Next chapter buttons
 * (#50, #57), so its drawing filters the step rows out; the section stays whole
 * for the client that does draw them.
 */
export function chaptersSection(playback: PlaybackSnapshot): PanelGroup {
  const chapters = playback.chapters;
  const current = playback.chapter;

  const rows: PanelRow[] = [
    {
      kind: "action",
      key: "previous-chapter",
      label: "Previous chapter",
      action: { type: "previous_chapter" },
      disabled: current === null || current <= 0,
    },
    {
      kind: "action",
      key: "next-chapter",
      label: "Next chapter",
      action: { type: "next_chapter" },
      disabled: current === null || current >= chapters.length - 1,
    },
  ];

  if (chapters.length === 0) {
    rows.push({
      kind: "note",
      key: "no-chapters",
      text: "This Stream lists no chapters.",
    });
  } else {
    rows.push(...chapters.map((chapter: Chapter) => ({
      kind: "choice" as const,
      key: `chapter-${chapter.index}`,
      label: chapterLabel(chapter),
      pressed: current === chapter.index,
      action: { type: "set_chapter" as const, index: chapter.index },
    })));
  }

  return { title: "Chapters", rows };
}
