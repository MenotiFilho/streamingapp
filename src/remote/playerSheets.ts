/**
 * The fullscreen Remote's seven bottom sheets: which menu opens which, how a
 * sheet is named on the stack, and the decisions this client alone draws
 * (#364, ADR-0035 §2, `docs/design-system.md` §11).
 *
 * The rows a sheet draws are the core's (`playerPanels`, `marqueeStreams`,
 * `episodes`), the same ones the window's menus draw. What lives here is what
 * only the phone decides: the menus a Stream has, the sheet level, and how an
 * episode row reads on a 390px sheet (`P4c`).
 */

import { episodeAirNote } from "../core/marqueeTitle";
import type { NewLevel } from "../core/navigation";
import { marqueeEpisodeRow } from "../core/playerPanels";
import { labelOf } from "../core/title";
import type { PlaybackSnapshot, ResumeEntry, Title, Video } from "../core/wire";
import { REMOTE_MENUS, type RemoteMenu } from "../kit/phone/RemoteMenus";
import type { RemotePayload } from "./levels";

/** A sheet is named by the menu that opens it. */
export type PlayerSheetName = RemoteMenu;

/**
 * One sheet level's payload: which sheet, and the Title the player belongs to.
 *
 * The Title travels with the player level and is handed on when a sheet opens,
 * so the Episodes sheet lists the seasons this client already holds instead of
 * asking the Host for a Title it has already answered (#214, ADR-0005).
 */
export type RemoteSheet = {
  kind: "sheet";
  plate: PlayerSheetName;
  title: Title | null;
};

/** The level's name, as a test, an announcement and Back call it. */
export const PLAYER_SHEET_NAME = "Player sheet";

/** The id a second menu press replaces, so one Back always leaves the Remote. */
export const PLAYER_SHEET_ID = "player-sheet";

/** Each sheet's heading, which is also its dialog's accessible name. */
export const SHEET_TITLES: Record<PlayerSheetName, string> = {
  subtitles: "Audio & subtitles",
  picture: "Picture",
  streams: "Streams",
  episodes: "Episodes",
  speed: "Speed",
  chapters: "Chapters",
  details: "Details",
};

/**
 * The menus the fullscreen Remote offers. A film has no Episodes. After a
 * failed open the Player holds no Stream to adjust, so only the two ways to
 * another Stream remain (ADR-0044 §3).
 */
export function remoteMenus(
  playback: Pick<PlaybackSnapshot, "episode">,
  failed: boolean,
): RemoteMenu[] {
  return REMOTE_MENUS.map((menu) => menu.id).filter(
    (id) =>
      (id !== "episodes" || playback.episode !== null) &&
      (!failed || id === "streams" || id === "episodes"),
  );
}

/**
 * Whether a pushed level is a sheet the Remote no longer offers: a Stream that
 * fails under an open sheet takes it off the stack, unless it leads to another
 * Stream (`remoteMenus`).
 */
export function sheetLevelStale(
  payload: RemotePayload,
  playback: Pick<PlaybackSnapshot, "episode"> | null,
  failed: boolean,
): boolean {
  return (
    payload.kind === "sheet" &&
    failed &&
    playback !== null &&
    !remoteMenus(playback, true).includes(payload.plate)
  );
}

/**
 * The sheet as a level: the player's own furniture above the Remote, so the
 * core's Back puts it away and the Remote underneath does not move. One id means
 * a sheet replaces a sheet rather than stacking a second surface.
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

/** What the Episodes sheet says where the Title carries no seasons at all. */
export const NO_EPISODES = "No episodes are available for the playing series.";

/** What one episode row of the sheet reads. */
export type SheetEpisode = {
  /** `E3 · PLAYING`, `E4`, or the Video's own label where it has no number. */
  number: string;
  title: string;
  date: string | null;
  description: string | null;
  still: string | null;
  /** What the empty still says: `S2E3`. */
  code: string | null;
  playing: boolean;
  progress: number | null;
};

/**
 * One episode as the sheet draws it (`P4c`). Which row is playing and how far
 * each one got are the core's (`marqueeEpisodeRow`, which the window's menu
 * draws too); this splits the facts into the phone row's lines.
 */
export function sheetEpisode(
  video: Video,
  playback: Pick<PlaybackSnapshot, "nowPlaying" | "duration">,
  watchProgress: readonly ResumeEntry[],
  position: number | null,
  today: Date,
): SheetEpisode {
  const entry = watchProgress.find((held) => held.video.id === video.id) ?? null;
  const row = marqueeEpisodeRow(
    video,
    playback.nowPlaying?.video.id ?? null,
    entry,
    position,
    playback.duration,
    today,
  );
  const code = labelOf(video);
  const number = video.episode !== null ? `E${video.episode}` : (code ?? "Episode");

  return {
    number: row.playing ? `${number} · PLAYING` : number,
    title:
      video.name ??
      (video.episode !== null ? `Episode ${video.episode}` : video.id),
    date: episodeAirNote(video, today),
    description: video.description ?? null,
    still: video.thumbnail,
    code,
    playing: row.playing,
    progress: row.progress,
  };
}
