/**
 * The menu triggers at the right of the player's controls, in the mockup's order
 * (sheet `C6`, `docs/design-system.md` §8). A client names the ones this Stream
 * has — a film draws no Episodes — and the order stays this one.
 */

import type { IconName } from "./icons";

export type PlayerMenuId =
  | "picture"
  | "audio-subtitles"
  | "streams"
  | "episodes"
  | "speed"
  | "chapters"
  | "details"
  | "fullscreen";

export type PlayerMenu = { id: PlayerMenuId; icon: IconName; label: string };

export const PLAYER_MENUS: ReadonlyArray<PlayerMenu> = [
  { id: "picture", icon: "picture", label: "Picture" },
  { id: "audio-subtitles", icon: "captions", label: "Audio & Subtitles" },
  { id: "streams", icon: "list-video", label: "Streams" },
  { id: "episodes", icon: "episodes", label: "Episodes" },
  { id: "speed", icon: "gauge", label: "Speed" },
  { id: "chapters", icon: "chapters", label: "Chapters" },
  { id: "details", icon: "stats", label: "Details" },
  { id: "fullscreen", icon: "maximize", label: "Full screen" },
];

export function playerMenus(available?: ReadonlyArray<PlayerMenuId>): ReadonlyArray<PlayerMenu> {
  return available ? PLAYER_MENUS.filter((menu) => available.includes(menu.id)) : PLAYER_MENUS;
}
