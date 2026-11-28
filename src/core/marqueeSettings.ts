/**
 * Marquee Settings screen & sub-level decisions, kept out of the drawing (ADR-0032).
 *
 * Pure formatting, row assembly, and sub-level metadata shared across
 * `MarqueeSettings` and `MarqueeSettingsSubLevels`.
 */

import { catalogKey, declaredCatalogs, keyOf, type DeclaredCatalog } from "./browse";
import {
  AUTOPLAY_SWITCH_LABEL,
  STREAM_BUFFER_DEFAULT_MEGABYTES,
  STREAM_BUFFER_DEFAULT_SECONDS,
  STREAM_BUFFER_MEGABYTES,
  STREAM_BUFFER_SECONDS,
  SUBTITLE_COLORS,
  SUBTITLE_SCALE_DEFAULT,
  SUBTITLE_SCALE_MAX,
  SUBTITLE_SCALE_MIN,
  TORRENT_CACHE_DEFAULT_MEGABYTES,
  UP_NEXT_PLAYBACK_CHOICES,
  autoplayOn,
  colorSelected,
  formatBufferMegabytes,
  formatBufferSeconds,
  formatScale,
  formatTorrentCache,
  scaleSelected,
} from "./controls";
import { FOLLOW_THE_FILE, languageName } from "./languages";
import { SETTINGS_LEVEL_PREFIX } from "./settingsRegister";
import type { Action, Snapshot, UpNextPlayback } from "./wire";

export type PreferenceSubLevelId =
  | "subtitle-languages"
  | "audio-languages"
  | "subtitle-appearance"
  | "stream-buffer"
  | "up-next";

export type PreferenceSubLevelMeta = {
  id: PreferenceSubLevelId;
  levelId: string;
  crumb: string;
  title: string;
  intro: string;
};

export const PREFERENCE_SUB_LEVELS: Record<PreferenceSubLevelId, PreferenceSubLevelMeta> = {
  "subtitle-languages": {
    id: "subtitle-languages",
    levelId: `${SETTINGS_LEVEL_PREFIX}subtitle-languages`,
    crumb: "Preferences",
    title: "Subtitle languages",
    intro:
      "The Host picks the first of these a Stream carries. Up to three; with none, it follows the file: the subtitle the file marks as default, if it has one.",
  },
  "audio-languages": {
    id: "audio-languages",
    levelId: `${SETTINGS_LEVEL_PREFIX}audio-languages`,
    crumb: "Preferences",
    title: "Audio languages",
    intro:
      "The Host picks the first of these a Stream carries. Up to three; with none, it follows the file.",
  },
  "subtitle-appearance": {
    id: "subtitle-appearance",
    levelId: `${SETTINGS_LEVEL_PREFIX}subtitle-appearance`,
    crumb: "Preferences",
    title: "Subtitle appearance",
    intro:
      "How the Player draws subtitles, on every Stream. A styled (ASS) track keeps the colours it was made with; the size reaches both kinds.",
  },
  "stream-buffer": {
    id: "stream-buffer",
    levelId: `${SETTINGS_LEVEL_PREFIX}stream-buffer`,
    crumb: "Preferences",
    title: "Stream buffer & torrent cache",
    intro:
      "How far ahead the Player reads, so a dip in the network is ridden out. It stops at whichever limit comes first.",
  },
  "up-next": {
    id: "up-next",
    levelId: `${SETTINGS_LEVEL_PREFIX}up-next`,
    crumb: "Preferences",
    title: "Up next & featured catalog",
    intro: "The Host's own choices, the same on every client.",
  },
};

/** Summarize a language list for the Preferences row value. */
export function languagesSummary(tags: readonly string[]): string {
  return tags.length === 0 ? FOLLOW_THE_FILE : tags.map(languageName).join(", ");
}

/** Summarize subtitle colour and scale for the Preferences row value (`White · Default`). */
export function subtitleAppearanceSummary(color: string, scale: number): string {
  const known = SUBTITLE_COLORS.find((choice) => colorSelected(color, choice.color));
  const colorLabel = known ? known.label : color.toUpperCase();
  const sizeLabel = scaleSelected(scale, SUBTITLE_SCALE_DEFAULT)
    ? "Default"
    : formatScale(scale);
  return `${colorLabel} · ${sizeLabel}`;
}

/** Label for an `UpNextPlayback` preference. */
export function upNextPlaybackLabel(playback: UpNextPlayback): string {
  return (
    UP_NEXT_PLAYBACK_CHOICES.find((choice) => choice.playback === playback)?.label ??
    "Play directly"
  );
}

/** Summarize the Stream buffer pair (`5 min · 512 MB`, `10 min · 1 GB`). */
export function streamBufferSummary(buffer: { seconds: number; megabytes: number }): string {
  const secondsLabel =
    STREAM_BUFFER_SECONDS.find((choice) => choice.seconds === buffer.seconds)?.label ??
    formatBufferSeconds(buffer.seconds);
  const megabytesLabel =
    STREAM_BUFFER_MEGABYTES.find((choice) => choice.megabytes === buffer.megabytes)?.label ??
    formatBufferMegabytes(buffer.megabytes);
  return `${secondsLabel} · ${megabytesLabel}`;
}

/** Summarize the Featured catalog for the Preferences row (`Popular · Cinemeta` or `None`). */
export function featuredCatalogSummary(
  snapshot: Pick<Snapshot, "addons" | "featuredCatalog"> | null,
): string {
  const featured = snapshot?.featuredCatalog ?? null;
  if (!featured) {
    return "None";
  }
  const addon = snapshot?.addons.find((held) => held.id === featured.addon);
  const catalog = addon?.catalogs.find(
    (held) => held.type === featured.catalog.type && held.id === featured.catalog.id,
  );
  const catalogLabel = catalog?.name ?? featured.catalog.id;
  const addonLabel = addon?.name ?? featured.addon;
  return `${catalogLabel} · ${addonLabel}`;
}

/** Paired-at detail string for `DeviceRow` (`Paired 12 Nov 2026`). */
export function formatPairedDetail(milliseconds: number): string {
  const formatted = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(milliseconds));
  return `Paired ${formatted}`;
}

export type PreferenceListEntry =
  | {
      kind: "sublevel";
      id: string;
      icon: "captions" | "audio-lines" | "sliders-horizontal" | "play" | "house" | "gauge" | "disk";
      label: string;
      value: string;
      subLevel: PreferenceSubLevelId;
    }
  | {
      kind: "switch";
      id: "autoplay";
      icon: "skip-forward";
      label: string;
      checked: boolean;
    };

/** Ordered Preferences list rows matching `19 Settings · preferences`. */
export function preferenceListEntries(snapshot: Snapshot | null): PreferenceListEntry[] {
  const preferences = snapshot?.preferences;
  const subtitleLanguages = preferences?.subtitleLanguages ?? [];
  const audioLanguages = preferences?.audioLanguages ?? [];
  const subtitleColor = preferences?.subtitleColor ?? "#FFFFFF";
  const subtitleScale = preferences?.subtitleScale ?? SUBTITLE_SCALE_DEFAULT;
  const buffer = preferences?.streamBuffer ?? {
    seconds: STREAM_BUFFER_DEFAULT_SECONDS,
    megabytes: STREAM_BUFFER_DEFAULT_MEGABYTES,
  };
  const torrentCacheMb =
    preferences?.torrentCache.megabytes ?? TORRENT_CACHE_DEFAULT_MEGABYTES;
  const upNextPlayback = preferences?.upNextPlayback ?? "direct";

  return [
    {
      kind: "sublevel",
      id: "subtitle-languages",
      icon: "captions",
      label: "Subtitle languages",
      value: languagesSummary(subtitleLanguages),
      subLevel: "subtitle-languages",
    },
    {
      kind: "sublevel",
      id: "audio-languages",
      icon: "audio-lines",
      label: "Audio languages",
      value: languagesSummary(audioLanguages),
      subLevel: "audio-languages",
    },
    {
      kind: "sublevel",
      id: "subtitle-appearance",
      icon: "sliders-horizontal",
      label: "Subtitle appearance",
      value: subtitleAppearanceSummary(subtitleColor, subtitleScale),
      subLevel: "subtitle-appearance",
    },
    {
      kind: "switch",
      id: "autoplay",
      icon: "skip-forward",
      label: AUTOPLAY_SWITCH_LABEL,
      checked: autoplayOn(snapshot),
    },
    {
      kind: "sublevel",
      id: "up-next-playback",
      icon: "play",
      label: "Play on an Up next",
      value: upNextPlaybackLabel(upNextPlayback),
      subLevel: "up-next",
    },
    {
      kind: "sublevel",
      id: "featured-catalog",
      icon: "house",
      label: "Featured catalog",
      value: featuredCatalogSummary(snapshot),
      subLevel: "up-next",
    },
    {
      kind: "sublevel",
      id: "stream-buffer",
      icon: "gauge",
      label: "Stream buffer",
      value: streamBufferSummary(buffer),
      subLevel: "stream-buffer",
    },
    {
      kind: "sublevel",
      id: "torrent-cache",
      icon: "disk",
      label: "Torrent cache",
      value: formatTorrentCache(torrentCacheMb),
      subLevel: "stream-buffer",
    },
  ];
}

/** Action sent when picking or clearing the Featured catalog. */
export function featuredCatalogAction(choice: DeclaredCatalog | null): Action {
  return choice === null
    ? { type: "clear_featured_catalog" }
    : {
        type: "set_featured_catalog",
        addon: choice.addon,
        catalog: { type: choice.catalog.type, id: choice.catalog.id },
      };
}

/** Active featured key (`addon/type/id`) or null. */
export function activeFeaturedKey(snapshot: Pick<Snapshot, "featuredCatalog"> | null): string | null {
  const featured = snapshot?.featuredCatalog ?? null;
  return featured
    ? keyOf({
        addon: featured.addon,
        type: featured.catalog.type,
        id: featured.catalog.id,
      })
    : null;
}

/** Featured catalog choices from enabled Addons (`declaredCatalogs`). */
export function featuredCatalogChoices(
  snapshot: Snapshot | null,
): Array<{ key: string; label: string; catalog: DeclaredCatalog }> {
  return declaredCatalogs(snapshot).map((choice) => {
    const addon =
      snapshot?.addons.find((held) => held.id === choice.addon)?.name ?? choice.addon;
    return {
      key: catalogKey(choice),
      label: `${choice.catalog.name} · ${addon}`,
      catalog: choice,
    };
  });
}

/** Clamped font scale multiplier for the Settings subtitle appearance preview. */
export function clampPreviewScale(scale: number): number {
  if (!Number.isFinite(scale)) {
    return SUBTITLE_SCALE_DEFAULT;
  }
  return Math.min(SUBTITLE_SCALE_MAX, Math.max(SUBTITLE_SCALE_MIN, scale));
}
