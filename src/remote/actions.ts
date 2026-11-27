import type { Action } from "../core/wire";

/**
 * The Actions the served Remote can send, in the Host's own order.
 *
 * The Remote is the Host's window's equal, not a curated subset (ADR-0002,
 * ADR-0018 §2): this list names the whole Action surface, and the build writes
 * it into `build-info.json`, where `host-wire` holds it to `Action::SPELLINGS`
 * and `ACTION_VERSION`. A capability added to the surface cannot pass that test
 * without being named here, and a name added here that the Host does not have
 * fails the same test (ADR-0035 §3).
 *
 * It lives in the client, not in `src/core`: the core is the decisions both
 * clients share, and the Remote's capability list is a fact about this entry.
 * The two type checks below are what keep the list honest in both directions at
 * typecheck time, so `pnpm typecheck` catches what the Rust test would.
 */
export const REMOTE_ACTIONS = [
  "set_subtitle_languages",
  "set_audio_languages",
  "set_subtitle_color",
  "set_subtitle_scale",
  "set_stream_buffer",
  "set_torrent_cache",
  "set_up_next_playback",
  "set_autoplay",
  "cancel_autoplay",
  "set_featured_catalog",
  "clear_featured_catalog",
  "add_addon",
  "reorder_addon",
  "remove_addon",
  "set_tmdb_key",
  "clear_tmdb_key",
  "sign_in_stremio",
  "sign_out_stremio",
  "pair_device",
  "revoke_device",
  "browse_catalog",
  "search_catalogs",
  "discover",
  "search",
  "open_title",
  "open_discovered_title",
  "find_streams",
  "preview",
  "library",
  "play_stream",
  "switch_stream",
  "resume",
  "play_up_next",
  "set_paused",
  "seek",
  "set_audio_track",
  "set_subtitle_track",
  "set_subtitle_delay",
  "set_speed",
  "set_volume",
  "set_muted",
  "next_chapter",
  "previous_chapter",
  "set_chapter",
  "set_crop",
  "autocrop",
  "set_aspect",
  "next_episode",
  "previous_episode",
  "stop_playback",
  "look_hint",
] as const satisfies readonly Action["type"][];

/**
 * The Actions `Action` names that this list does not. It is `never` while the
 * list is whole, and a new Action makes it a union of one — which fails the
 * constant below.
 */
export type UnnamedActions = Exclude<Action["type"], (typeof REMOTE_ACTIONS)[number]>;

/**
 * Compiles only while every Action is named above. It is exported because it is
 * the assertion, not a value anyone reads: `true` here means the Remote's list
 * is the Action surface, and a missing spelling is a type error at this line.
 */
export const REMOTE_ACTIONS_ARE_COMPLETE: UnnamedActions extends never ? true : never = true;
