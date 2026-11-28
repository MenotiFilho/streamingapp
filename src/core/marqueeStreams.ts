/**
 * Pure decisions for Marquee's Streams picker (#360, `06.jpg`, `docs/design-system.md` §8–§9).
 *
 * Framework-free (`src/core` per ADR-0035 §1, ADR-0032): no React, no DOM, no
 * Motion imports. Reuses `stream.ts`, `streamsList.ts`, and `home.ts` while
 * adding Addon filtering, StreamRow field extraction (without re-wording or
 * re-ranking), and per-Addon Try again state merging.
 */

import { badgeLines, playabilityNote, streamName, warningNote } from "./stream";
import { NO_CANDIDATES } from "./streamsList";
import { isSeries, labelOf, nameOf, releaseOf, seasonName, type OpenablePreview } from "./title";
import type {
  AddonManifest,
  AddonStreams,
  PlaybackSnapshot,
  Stream,
  StreamWarning,
  Title,
  Video,
} from "./wire";

export type AddonFilterChip = {
  /** `null` represents the `All` filter chip. */
  id: string | null;
  label: string;
};

function addonName(addons: readonly AddonManifest[], id: string): string {
  return addons.find((addon) => addon.id === id)?.name ?? id;
}

/** Build the Addon filter chips (`All` followed by each group's Addon in Host order). */
export function addonFilterChips(
  groups: readonly AddonStreams[],
  addons: readonly AddonManifest[],
): AddonFilterChip[] {
  if (groups.length === 0) {
    return [];
  }
  return [
    { id: null, label: "All" },
    ...groups.map((group) => ({
      id: group.addon,
      label: addonName(addons, group.addon),
    })),
  ];
}

/** Resolve the active Addon filter id, resetting to `null` (`All`) if missing. */
export function resolveSelectedAddon(
  selectedAddon: string | null,
  groups: readonly AddonStreams[],
): string | null {
  if (selectedAddon !== null && !groups.some((group) => group.addon === selectedAddon)) {
    return null;
  }
  return selectedAddon;
}

/** Filter `groups` by the selected Addon (`null` shows all Addons in Host order). */
export function filterStreamGroups(
  groups: readonly AddonStreams[],
  selectedAddon: string | null,
): AddonStreams[] {
  const active = resolveSelectedAddon(selectedAddon, groups);
  if (active === null) {
    return [...groups];
  }
  return groups.filter((group) => group.addon === active);
}

/**
 * The Panel subtitle (`06.jpg`: `4 from 2 Addons`), or `3 from Torrentio` when
 * filtered to one Addon.
 */
export function streamsPanelSubtitle(
  groups: readonly AddonStreams[],
  selectedAddon: string | null,
  addons: readonly AddonManifest[],
): string | undefined {
  if (groups.length === 0) {
    return undefined;
  }

  const active = resolveSelectedAddon(selectedAddon, groups);
  if (active !== null) {
    const group = groups.find((item) => item.addon === active);
    if (!group) {
      return undefined;
    }
    const name = addonName(addons, group.addon);
    if (group.failure && group.streams.length === 0) {
      return `${name} did not answer`;
    }
    return `${group.streams.length} from ${name}`;
  }

  const totalStreams = groups.reduce((sum, group) => sum + group.streams.length, 0);
  const answeringAddons = groups.filter((group) => group.streams.length > 0).length;
  return `${totalStreams} from ${answeringAddons} ${answeringAddons === 1 ? "Addon" : "Addons"}`;
}

/**
 * Merge a retry response (`find_streams` answer) back into `current`,
 * updating ONLY the group for `retriedAddon` and leaving every other group
 * untouched.
 */
export function mergeRetriedAddonGroup(
  current: readonly AddonStreams[],
  retriedAddon: string,
  nextGroups: readonly AddonStreams[],
): AddonStreams[] {
  const replacement = nextGroups.find((group) => group.addon === retriedAddon);
  if (!replacement) {
    return current.filter((group) => group.addon !== retriedAddon);
  }
  return current.map((group) => (group.addon === retriedAddon ? replacement : group));
}

export type StreamsSubjectParts = {
  titleName: string;
  overline: string | null;
  heading: string;
};

/**
 * The left-stage subject beside the Streams side panel (`06.jpg`):
 * - Series: `Season 2 · Episode 3` overline + `Who Is Alive?` heading
 * - Film: release year (if any) + Title name
 */
export function streamsSubjectParts(
  title: Title,
  preview: OpenablePreview | null | undefined,
  video: Video,
): StreamsSubjectParts {
  const titleName = nameOf(title, preview);

  if (!isSeries(title)) {
    return {
      titleName,
      overline: releaseOf(title, preview),
      heading: titleName,
    };
  }

  let overline: string | null = null;
  if (video.season !== null && video.episode !== null) {
    overline = `${seasonName(video.season)} · Episode ${video.episode}`;
  } else if (video.season !== null) {
    overline = seasonName(video.season);
  } else if (video.episode !== null) {
    overline = `Episode ${video.episode}`;
  } else {
    overline = labelOf(video);
  }

  return {
    titleName,
    overline,
    heading: video.name ?? labelOf(video) ?? video.id,
  };
}

export type StreamWarningBadge = {
  tag: string;
  note: string;
};

export type StreamRowView = {
  name: string;
  tier: string | null;
  peers: string | null;
  size: string | null;
  source: string | null;
  marks: string[];
  warnings: StreamWarningBadge[];
  unplayable: string | null;
};

function warningTag(warning: StreamWarning): string {
  switch (warning) {
    case "not_web_ready":
      return "Not web-ready";
    case "p2p":
      return "P2P";
    case "proxy_headers":
      return "Proxy headers";
  }
}

const UHD_TOKEN = /\b(4k|2160p|uhd)\b/i;
const HD_TOKEN = /\b(1080p|720p|480p|360p)\b/i;
const PEERS_TOKEN = /👤\s*(\d+)/;
const SIZE_TOKEN = /💾\s*([\d.,]+\s*(?:[KMGT]i?B|B))/i;
const SOURCE_TOKEN = /(?:⚙️|🌐)\s*([^\n👤💾⚙️🌐]+)/;
const PURE_META_LINE = /^(?:👤|💾|⚙️|🌐)/;

function extractTier(candidates: ReadonlyArray<string | null | undefined>): string | null {
  for (const text of candidates) {
    if (!text) {
      continue;
    }
    if (UHD_TOKEN.test(text)) {
      return "4K";
    }
    const hd = HD_TOKEN.exec(text);
    if (hd?.[1]) {
      return hd[1].toLowerCase();
    }
  }
  return null;
}

function firstReleaseLine(description: string | null): string | null {
  if (!description) {
    return null;
  }
  for (const rawLine of description.split("\n")) {
    const line = rawLine.trim();
    if (line && !PURE_META_LINE.test(line)) {
      return line;
    }
  }
  return null;
}

/**
 * Extract the display fields for `StreamRow` from an Addon's `Stream` without
 * re-wording or re-ranking anything (`docs/design-system.md` §9).
 */
export function streamRowView(stream: Stream): StreamRowView {
  const badges = badgeLines(stream);
  const release = firstReleaseLine(stream.description);
  const desc = stream.description ?? "";

  const peers = PEERS_TOKEN.exec(desc)?.[1] ?? null;
  const size = SIZE_TOKEN.exec(desc)?.[1]?.trim() ?? null;
  const rawSource = SOURCE_TOKEN.exec(desc)?.[1]?.trim() ?? null;
  const source = rawSource && rawSource.length > 0 ? rawSource : null;

  return {
    name: stream.filename ?? release ?? streamName(stream),
    tier: extractTier([...badges, stream.filename, release]),
    peers,
    size,
    source,
    marks: badges,
    warnings: stream.warnings.map((warning) => ({
      tag: warningTag(warning),
      note: warningNote(warning),
    })),
    unplayable: playabilityNote(stream.playback),
  };
}

/** Whether `stream` is the one currently playing on the Host (`PLAYING` badge). */
export function isPlayingStream(
  playback: PlaybackSnapshot | null | undefined,
  addon: string,
  video: Video,
  stream: Stream,
): boolean {
  const nowPlaying = playback?.nowPlaying;
  if (!playback || playback.state === "idle" || !nowPlaying) {
    return false;
  }
  if (nowPlaying.addon !== addon || nowPlaying.video.id !== video.id) {
    return false;
  }
  if (stream.filename !== null && nowPlaying.filename !== null) {
    return stream.filename === nowPlaying.filename;
  }
  return (
    nowPlaying.name === stream.name &&
    nowPlaying.description === stream.description
  );
}

export type StreamsEmptyState = {
  title: string;
  body: string;
};

/**
 * Empty state when no Addon offers Streams or when every Addon answered empty
 * with no failures.
 */
export function streamsEmptyState(
  groups: readonly AddonStreams[],
): StreamsEmptyState | null {
  if (groups.length === 0) {
    return {
      title: "No Streams available",
      body: "No configured Addon offers Streams for this Video.",
    };
  }
  if (groups.every((group) => group.streams.length === 0 && group.failure === null)) {
    return {
      title: "No Streams found",
      body: NO_CANDIDATES,
    };
  }
  return null;
}
