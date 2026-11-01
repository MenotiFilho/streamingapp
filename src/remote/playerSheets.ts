/**
 * The Remote player's sheets: the plates a card opens, and the copy this
 * client alone prints (#214, ADR-0035 §2).
 *
 * The rows a plate draws are the core's (`playerPanels`, `episodes`); what
 * lives here is which plate a control opens, how a plate is named on the stack,
 * and the one sentence the Episodes plate says where the Addons offer nothing
 * this Host can play. Rows are never re-worded: their label, text, marks, value
 * and lines come from the modules above.
 */

import {
  audioSection,
  chaptersSection,
  pictureSections,
  speedSection,
  subtitleSections,
  type PanelGroup,
} from "../core/playerPanels";
import { playabilityNote } from "../core/stream";
import { NO_CANDIDATES } from "../core/streamsList";
import { labelOf } from "../core/title";
import type { NewLevel } from "../core/navigation";
import type {
  AddonStreams,
  PlaybackSnapshot,
  Title,
  Video,
} from "../core/wire";
import type { IconName } from "../kit/icons";

/**
 * The five plates the expanded card's icon row opens. Audio and Subtitles share
 * one plate; the Episodes plate is the phone's own, from `core/episodes`.
 */
export type PlayerSheetName = "audio" | "picture" | "speed" | "chapters" | "episodes";

/**
 * One sheet level's payload: which plate, and the Title the player belongs to.
 *
 * The Title travels with the player level and is handed on when a plate opens,
 * so the Episodes plate lists the seasons this client already holds instead of
 * asking the Host for a Title it has already answered (#214, ADR-0005).
 */
export type RemoteSheet = {
  kind: "sheet";
  plate: PlayerSheetName;
  title: Title | null;
};

/** The level's name, as a test, an announcement and Back call it. */
export const PLAYER_SHEET_NAME = "Player sheet";

/** The id a second plate press replaces, so one Back always leaves the card. */
export const PLAYER_SHEET_ID = "player-sheet";

/** Each plate's heading, which is also its dialog's accessible name. */
export const SHEET_TITLES: Record<PlayerSheetName, string> = {
  audio: "Audio & Subtitles",
  picture: "Picture",
  speed: "Speed",
  chapters: "Chapters",
  episodes: "Episodes",
};

/**
 * One card control: the plate it opens and its drawn mark. Its accessible name
 * is the plate's heading, so a control and the sheet it opens cannot disagree.
 */
export type PlayerSheetControl = {
  plate: PlayerSheetName;
  icon: IconName;
};

/** The card's icon row, in the order the phone keeps its menus. */
export const PLAYER_SHEET_CONTROLS: readonly PlayerSheetControl[] = [
  { plate: "audio", icon: "subtitles" },
  { plate: "picture", icon: "picture" },
  { plate: "speed", icon: "speed" },
  { plate: "chapters", icon: "chapters" },
  { plate: "episodes", icon: "more" },
];

/**
 * The core's groups a plate draws, in the order the plate draws them.
 *
 * Audio and Subtitles are one plate composed audio-first, exactly as the core
 * returns the sections; the Episodes plate has no panel groups of its own and
 * is drawn from `episodes`. Nothing here re-words a row or adds a section.
 */
export function sheetGroups(
  plate: PlayerSheetName,
  playback: PlaybackSnapshot,
  subtitleScale: number,
  showStatistics: boolean,
): PanelGroup[] {
  switch (plate) {
    case "audio":
      return [audioSection(playback), ...subtitleSections(playback, subtitleScale)];
    case "picture":
      return pictureSections(playback, showStatistics);
    case "speed":
      return [speedSection(playback)];
    case "chapters":
      return [chaptersSection(playback)];
    case "episodes":
      return [];
  }
}

/**
 * The plate as a level: the player's own furniture above the card, so the
 * core's Back puts it away and the card underneath does not move. One id means
 * a plate replaces a plate rather than stacking a second surface.
 */
export function playerSheetLevel(
  plate: PlayerSheetName,
  title: Title | null,
): NewLevel<RemoteSheet> {
  return {
    id: PLAYER_SHEET_ID,
    name: PLAYER_SHEET_NAME,
    kind: "popover",
    payload: { kind: "sheet", plate, title },
  };
}

/** What the Episodes plate says where the Title carries no seasons at all. */
export const NO_EPISODES = "No episodes are available for the playing series.";

/**
 * What an Episodes press says where no candidate can play: the core's own
 * words about the candidates that did answer, and its empty-group copy where
 * every group was empty.
 */
export function noPlayableNote(groups: readonly AddonStreams[]): string {
  for (const group of groups) {
    const first = group.streams[0];
    if (first) {
      return playabilityNote(first.playback) ?? NO_CANDIDATES;
    }
  }
  return NO_CANDIDATES;
}

/** How an episode is named on the plate: its number, then the Addon's title. */
export function episodeLabel(video: Video): string {
  return (
    [labelOf(video), video.name ?? video.id]
      .filter((part): part is string => Boolean(part))
      .join(" · ") || video.id
  );
}
