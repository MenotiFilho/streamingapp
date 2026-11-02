/**
 * The Episodes decisions: which series a playing Stream belongs to, how its
 * seasons are grouped, and which candidate is the first this Host can open
 * (#191 §8).
 *
 * The window and the served Remote both draw an Episodes menu; these decisions
 * are shared so neither can grow a second rule for the same questions.
 */

import { playabilityNote } from "./stream";
import { discoveredKeyOf, seasonsOf, type Season } from "./title";
import type { Action, AddonStreams, NowPlaying, Snapshot, Stream, Title } from "./wire";

/**
 * Which series a playing Stream belongs to, and how a client asks for its
 * episodes.
 *
 * The Addon that supplied the *Title* is the one that can list its episodes; the
 * Addon that supplied the Stream is often a different one, and is only the
 * fallback when the Watch-progress card does not name one. A Title met through
 * TMDB is asked for by its TMDB key, with that fallback beside it.
 */
export type SeriesRef =
  | {
      kind: "addon";
      addon: string;
      title: { type: string; id: string };
      /** The key a client caches one series' episodes under. */
      cache: string;
    }
  | {
      kind: "discovered";
      key: { kind: "tmdb"; id: number };
      type: string;
      /** The Addon that supplied the Stream, where TMDB cannot answer. */
      fallbackAddon: string | null;
      cache: string;
    };

/** The protocol's spelling of an episodic Video id: `<series>:<season>:<episode>`. */
const EPISODE_ID = /^(.+):\d+:\d+$/;
const TMDB_EPISODE_ID = /^tmdb:(\d+):\d+:\d+$/;

/**
 * The series the playing Stream belongs to.
 *
 * Three branches, in the Host's own order of knowledge: the Watch-progress
 * Title's Addon; the TMDB key the Watch-progress card (or the Video id) carries;
 * and otherwise the Stream's own Addon, with the episode suffix dropped from the
 * Video id.
 */
export function seriesRef(
  snapshot: Pick<Snapshot, "watchProgress"> | null,
  nowPlaying: NowPlaying,
): SeriesRef {
  const video = nowPlaying.video;
  const held =
    snapshot?.watchProgress.find((entry) => entry.video.id === video.id)?.title ?? null;

  if (held?.addon) {
    return {
      kind: "addon",
      addon: held.addon,
      title: { type: held.type, id: held.id },
      cache: `${held.addon}|${held.type}|${held.id}`,
    };
  }

  if (held) {
    const key = discoveredKeyOf(held.id);
    if (key) {
      return {
        kind: "discovered",
        key,
        type: held.type,
        fallbackAddon: nowPlaying.addon,
        cache: `tmdb|${held.type}|${key.id}`,
      };
    }
  }

  const tmdb = TMDB_EPISODE_ID.exec(video.id);
  if (tmdb) {
    const id = Number(tmdb[1]);
    return {
      kind: "discovered",
      key: { kind: "tmdb", id },
      type: video.type,
      fallbackAddon: nowPlaying.addon,
      cache: `tmdb|${video.type}|${id}`,
    };
  }

  const stripped = EPISODE_ID.exec(video.id)?.[1] ?? video.id;
  return {
    kind: "addon",
    addon: nowPlaying.addon,
    title: { type: video.type, id: stripped },
    cache: `${nowPlaying.addon}|${video.type}|${stripped}`,
  };
}

/**
 * The series a playing Stream belongs to, as a question a client can ask: an
 * Addon's Title is opened through that Addon, and a Discovered Title is opened
 * against TMDB with the key its card names.
 *
 * The Episodes menu asks the question a Title's card does, without building the
 * Action itself or growing a second mapping.
 */
export function seriesAction(ref: SeriesRef): Action {
  return ref.kind === "addon"
    ? { type: "open_title", addon: ref.addon, title: ref.title }
    : { type: "open_discovered_title", key: ref.key, kind: ref.type };
}

/**
 * A Title's episodes, grouped into seasons in the Addon's own order: the same
 * rule the Title screen draws its season list from, not a second one.
 */
export function episodesOf(title: Title): Season[] {
  return seasonsOf(title);
}

/**
 * The first candidate an Episodes press can play, as the Addon that offered it
 * and the Stream itself — enough to send `play_stream`. Addons are read in the
 * configured order, and each group's candidates in the Addon's order; a
 * candidate this Host cannot open is skipped rather than chosen and refused.
 */
export function firstPlayableStream(
  groups: readonly AddonStreams[],
): { addon: string; stream: Stream } | null {
  for (const group of groups) {
    for (const stream of group.streams) {
      if (playabilityNote(stream.playback) === null) {
        return { addon: group.addon, stream };
      }
    }
  }
  return null;
}
