/**
 * The player panels' sections, as rows both players compose (#191 §7).
 *
 * The sectioned menus are not the same on both clients — the window opens one
 * popover per icon, the Remote folds Audio and Subtitles into one sheet — so
 * the *panel* stays a client's. The *sections* are shared: each returns the
 * groups and rows that client arranges, and the drawing decides chips, rows,
 * notes and readouts.
 */

import {
  ASPECTS,
  DELAY_STEP,
  SPEEDS,
  aspectSelected,
  chapterLabel,
  cropChoices,
  cropSelected,
  formatBitrate,
  formatDelay,
  formatScale,
  formatSpeed,
  orderedTracks,
  scaleAtBound,
  speedSelected,
  statisticsLines,
  stepDelay,
  stepScale,
  subtitlesOn,
  trackLabel,
  trackMarks,
} from "./controls";
import { episodeAirNote } from "./marqueeTitle";
import { qualityBadge } from "./osd";
import { formatTime } from "./playback";
import { formatRate } from "./torrentStatus";
import type {
  Action,
  Chapter,
  PlaybackSnapshot,
  ResumeEntry,
  TorrentStatus,
  Track,
  Video,
} from "./wire";

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

/** The swarm's two lines, present only where the Stream is a torrent. */
function torrentStatisticsLines(
  torrent: TorrentStatus | null,
): Array<{ label: string; value: string }> {
  if (torrent === null) {
    return [];
  }
  return [
    { label: "Peers", value: String(torrent.peers) },
    { label: "Download", value: formatRate(torrent.rate) },
  ];
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
      lines: [
        ...statisticsLines(playback.statistics),
        ...torrentStatisticsLines(playback.torrent),
      ],
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
          disabled: scaleAtBound(subtitleScale, -1),
        },
        {
          kind: "action",
          key: "subtitle-scale-up",
          label: "Larger subtitles",
          text: "+",
          action: { type: "set_subtitle_scale", scale: stepScale(subtitleScale, 1) },
          disabled: scaleAtBound(subtitleScale, 1),
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

/** One choice option in Marquee's floating panels (`TrackOption`). */
export type MarqueeTrackOption = {
  key: string;
  title: string;
  detail: string | null;
  selected: boolean;
  action: Action;
};

/** Primary line for a `TrackOption` in Marquee's Audio & Subtitles panel. */
export function marqueeTrackTitle(track: Track): string {
  return track.title ?? track.language ?? `Track ${track.id}`;
}

/** Secondary line for a `TrackOption` in Marquee's Audio & Subtitles panel. */
export function marqueeTrackDetail(track: Track): string | null {
  const parts: Array<string | null> =
    track.kind === "subtitle"
      ? [
          track.embedded ? "In the file" : null,
          track.codec,
          track.language && track.title ? track.language : null,
          track.forced ? "forced" : null,
          track.default ? "default" : null,
        ]
      : [
          track.language && track.title ? track.language : null,
          track.codec,
          track.embedded ? null : "External",
          track.forced ? "forced" : null,
          track.default ? "default" : null,
        ];
  const joined = parts.filter((part): part is string => Boolean(part)).join(" · ");
  return joined || null;
}

/** Subtitle tracks (with `Off` first, embedded before external) for Marquee. */
export function marqueeSubtitleOptions(playback: PlaybackSnapshot): {
  options: MarqueeTrackOption[];
  emptyNote: string | null;
} {
  const ordered = orderedTracks(playback.tracks, "subtitle");
  const options: MarqueeTrackOption[] = [
    {
      key: "subtitles-off",
      title: "Off",
      detail: null,
      selected: !subtitlesOn(playback.tracks),
      action: { type: "set_subtitle_track", track: null },
    },
    ...ordered.map((track) => ({
      key: `track-subtitle-${track.id}`,
      title: marqueeTrackTitle(track),
      detail: marqueeTrackDetail(track),
      selected: track.selected,
      action: { type: "set_subtitle_track" as const, track: track.id },
    })),
  ];
  return {
    options,
    emptyNote: ordered.length === 0 ? "This Stream carries no subtitle track to pick." : null,
  };
}

/** Audio tracks (embedded first) for Marquee. */
export function marqueeAudioOptions(playback: PlaybackSnapshot): {
  options: MarqueeTrackOption[];
  emptyNote: string | null;
} {
  const ordered = orderedTracks(playback.tracks, "audio");
  return {
    options: ordered.map((track) => ({
      key: `track-audio-${track.id}`,
      title: marqueeTrackTitle(track),
      detail: marqueeTrackDetail(track),
      selected: track.selected,
      action: { type: "set_audio_track" as const, track: track.id },
    })),
    emptyNote: ordered.length === 0 ? "This Stream carries no audio track to pick." : null,
  };
}

/** Picture panel choices for Marquee (Aspect + Crop + Autocrop, no Statistics). */
export function marqueePicturePanel(playback: PlaybackSnapshot): {
  aspect: MarqueeTrackOption[];
  crop: MarqueeTrackOption[];
  autocropLabel: string;
  autocropNote: string;
} {
  const currentCrop = playback.crop;
  return {
    aspect: ASPECTS.map(({ label, aspect }) => ({
      key: `aspect-${label}`,
      title: label,
      detail: aspect.kind === "source" ? "The shape the Stream carries" : null,
      selected: aspectSelected(playback.aspect, aspect),
      action: { type: "set_aspect", aspect },
    })),
    crop: cropChoices(playback.resolution).map(({ label, crop }) => ({
      key: `crop-${label}`,
      title: label,
      detail: null,
      selected: cropSelected(currentCrop, crop),
      action: { type: "set_crop", crop },
    })),
    autocropLabel: currentCrop ? "Restore full frame" : "Autocrop",
    autocropNote: currentCrop
      ? `Autocrop keeps ${currentCrop.width}×${currentCrop.height}+${currentCrop.x}+${currentCrop.y}.`
      : "Autocrop finds the black bars and keeps the picture inside them.",
  };
}

/** Speed choices for Marquee (`1× · Normal` at unit rate). */
export function marqueeSpeedOptions(playback: PlaybackSnapshot): MarqueeTrackOption[] {
  return SPEEDS.map((rate) => ({
    key: `speed-${rate}`,
    title: rate === 1 ? "1× · Normal" : formatSpeed(rate),
    detail: null,
    selected: speedSelected(playback.speed, rate),
    action: { type: "set_speed", rate },
  }));
}

/** Chapters panel data for Marquee (with Previous / Next controls). */
export function marqueeChaptersPanel(playback: PlaybackSnapshot): {
  previousDisabled: boolean;
  nextDisabled: boolean;
  chapters: MarqueeTrackOption[];
  emptyNote: string | null;
} {
  const chapters = playback.chapters;
  const current = playback.chapter;
  return {
    previousDisabled: current === null || current <= 0,
    nextDisabled: current === null || current >= chapters.length - 1,
    chapters: chapters.map((chapter) => ({
      key: `chapter-${chapter.index}`,
      title: `${chapter.index + 1} · ${chapter.title ?? `Chapter ${chapter.index + 1}`}`,
      detail: formatTime(chapter.time),
      selected: current === chapter.index,
      action: { type: "set_chapter", index: chapter.index },
    })),
    emptyNote: chapters.length === 0 ? "This Stream lists no chapters." : null,
  };
}

/** One row in Marquee's Details panel (`StatRow`). */
export type DetailsStat = { label: string; value: string };

/**
 * Details panel columns for Marquee: Torrent status (when active) and
 * playback Statistics (moved out of Picture per ADR-0043 §4).
 */
export function marqueeDetailsPanel(
  playback: PlaybackSnapshot,
  position: number | null,
): {
  torrentRows: DetailsStat[] | null;
  playbackRows: DetailsStat[];
} {
  const torrentRows: DetailsStat[] | null = playback.torrent
    ? [
        {
          label: "State",
          value: playback.stalled
            ? "Waiting for data"
            : playback.state === "opening"
              ? "Opening"
              : "Connected",
        },
        {
          label: "Engine",
          value: playback.torrent.phase === "finding" ? "Finding" : "Fetching",
        },
        {
          label: "Peers",
          value: `${playback.torrent.peers} connected`,
        },
        {
          label: "Speed",
          value: formatRate(playback.torrent.rate),
        },
      ]
    : null;

  const quality = qualityBadge(playback.nowPlaying);
  const pictureValue = playback.resolution
    ? quality
      ? `${playback.resolution.width}×${playback.resolution.height} · ${quality}`
      : `${playback.resolution.width}×${playback.resolution.height}`
    : "—";

  const stats = playback.statistics;
  const decoderValue =
    stats?.hardwareDecode == null
      ? "—"
      : stats.hardwareDecode === "no"
        ? "Software"
        : `Hardware · ${stats.hardwareDecode}`;

  const bufferedValue =
    playback.buffered && position !== null
      ? `${Math.max(0, playback.buffered.end - position).toFixed(1)} s ahead`
      : "—";

  const playbackRows: DetailsStat[] = [
    { label: "Picture", value: pictureValue },
    { label: "Bitrate", value: formatBitrate(stats?.bitrate ?? null) },
    { label: "Decoder", value: decoderValue },
    {
      label: "Dropped frames",
      value: stats?.droppedFrames == null ? "—" : String(stats.droppedFrames),
    },
    { label: "Buffered", value: bufferedValue },
  ];

  return { torrentRows, playbackRows };
}

export type MarqueeEpisodeRowData = {
  id: string;
  title: string;
  detail: string | null;
  still: string | null;
  playing: boolean;
  progress: number | null;
};

/** Presentation data for one episode row in Marquee's Episodes floating panel. */
export function marqueeEpisodeRow(
  video: Video,
  playingId: string | null,
  progressEntry: ResumeEntry | null,
  position: number | null,
  duration: number | null,
  today: Date = new Date(),
): MarqueeEpisodeRowData {
  const playing = video.id === playingId;
  const title =
    video.episode !== null
      ? video.name
        ? `E${video.episode} · ${video.name}`
        : `Episode ${video.episode}`
      : (video.name ?? video.id);

  let detail: string | null = null;
  if (playing) {
    detail =
      position !== null && duration !== null && duration > 0
        ? `Playing now · ${formatTime(position)} of ${formatTime(duration)}`
        : "Playing now";
  } else {
    const airNote = episodeAirNote(video, today);
    const parts = [airNote, video.description ?? null].filter(
      (part): part is string => Boolean(part),
    );
    detail = parts.length > 0 ? parts.join(" · ") : null;
  }

  let progress: number | null = null;
  if (playing && position !== null && duration !== null && duration > 0) {
    progress = Math.min(1, Math.max(0, position / duration));
  } else if (
    progressEntry?.position != null &&
    progressEntry.duration != null &&
    progressEntry.duration > 0
  ) {
    progress = Math.min(1, Math.max(0, progressEntry.position / progressEntry.duration));
  }

  return {
    id: video.id,
    title,
    detail,
    still: video.thumbnail,
    playing,
    progress,
  };
}
