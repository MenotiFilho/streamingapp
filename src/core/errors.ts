import { ACTION_VERSION } from "./wire";
import { MAX_LANGUAGES } from "./languageList";

/**
 * The failures the Host itself reports. Mirrors the variants of `ActionError` in
 * `host-core`; the union below is derived from this list so the two cannot drift.
 */
export const HOST_ERROR_KINDS = [
  "malformed",
  "unsupported_version",
  "invalid_language",
  "duplicate_language",
  "too_many_languages",
  "invalid_subtitle_color",
  "invalid_subtitle_scale",
  "invalid_stream_buffer",
  "invalid_torrent_cache",
  "invalid_manifest_url",
  "invalid_addon_id",
  "invalid_tmdb_key",
  "invalid_catalog_ref",
  "invalid_title_ref",
  "invalid_video_ref",
  "invalid_seek_target",
  "invalid_preview_at",
  "invalid_speed",
  "invalid_volume",
  "invalid_subtitle_delay",
  "invalid_aspect",
  "invalid_crop",
  "manifest",
  "fetch",
  "unknown_addon",
  "unknown_catalog",
  "unknown_title",
  "not_discovered_title",
  "tmdb",
  "unknown_track",
  "unknown_chapter",
  "invalid_position",
  "extra",
  "query",
  "catalog",
  "meta",
  "stream",
  "subtitles",
  "unplayable",
  "nothing_playing",
  "no_next_episode",
  "no_previous_episode",
  "no_up_next",
  "no_up_next_stream",
  "no_progress",
  "playback",
  "store",
  "secret",
  "invalid_stremio_login",
  "sync_unavailable",
  "sync",
  "library",
  "invalid_pairing_code",
  "invalid_device_id",
  "invalid_device_name",
  "pairing",
  "unknown_device",
  "unpaired",
  "already_paired",
  "invalid_discover",
  "invalid_search",
  "no_tmdb_credential",
] as const;

/**
 * The control a refusal names, in the Host's own tags. Mirrors `Control` in
 * `host-core`; every control that can be refused is here, and a client reads it
 * to say which one was refused.
 */
export type Control =
  | "pause"
  | "seek"
  | "stop"
  | "audio_track"
  | "subtitle_track"
  | "subtitle_delay"
  | "speed"
  | "volume"
  | "mute"
  | "chapter"
  | "crop"
  | "aspect"
  | "next_episode"
  | "previous_episode";

/**
 * Why an Action was not taken, in the Host's own vocabulary, plus the client's
 * own failures (`CLIENT_ERROR_KINDS`): a transport that never reached the Host,
 * and an answer that carried no page for the question asked.
 */
export type ActionError = {
  kind: (typeof HOST_ERROR_KINDS)[number] | (typeof CLIENT_ERROR_KINDS)[number];
  detail?: string;
  got?: number;
  supported?: number;
  language?: string;
  /** The colour a refusal echoes: a refused subtitle colour. */
  color?: string;
  /** The size a refusal echoes: a refused subtitle scale. */
  scale?: string;
  url?: string;
  /** An Addon's id, or a track's number: two refusals name an `id`. */
  id?: string | number;
  addon?: string;
  which?: string;
  value?: string;
  catalog?: { type: string; id: string };
  title?: { type: string; id: string };
  video?: { type: string; id: string };
  /** The value a refusal carries: the seconds a seek or a delay could not use. */
  seconds?: string;
  /** The value a refused speed or volume carries. */
  rate?: string;
  level?: string;
  /** The rectangle a refused crop would keep. */
  crop?: string;
  /** The position a refused chapter names. */
  index?: number;
  /** The position a refused reorder asked for. */
  position?: number;
  /**
   * How many Addons the Host was configured with when it refused the reorder,
   * or how many languages a refused list held.
   */
  count?: number;
  /** The most languages a list may hold, on a refused list. */
  max?: number;
  /** The control a refusal is about, where the refusal is about one. */
  control?: Control;
  /** The pairing code a refusal names, where the refusal is about one. */
  code?: string;
  /** The device name a refusal names, where the refusal is about one. */
  name?: string;
};

/**
 * The failures a client names itself. They happen before the Host could refuse
 * anything — a transport that never reached it, or an answer missing the page
 * its Action asked for — so they are not part of the Host's vocabulary and
 * carry the client's own words (ADR-0020's failure rule, kept honest).
 */
export const CLIENT_ERROR_KINDS = ["unreachable", "answer"] as const;

/** Every kind an `ActionError` can be: the Host's refusals and the client's own failures. */
const ACTION_ERROR_KINDS: readonly string[] = [...HOST_ERROR_KINDS, ...CLIENT_ERROR_KINDS];

/**
 * Whatever a failed call threw, as something the window can explain.
 *
 * An `ActionError` already — the Host's refusal, or a link's own `unreachable`
 * — is kept as it is. Anything else is a transport that never reached the Host,
 * in words: an object's `String` is "[object Object]", which says nothing to the
 * person reading it, so an object is named by its kind where it has one.
 */
export function asActionError(caught: unknown): ActionError {
  if (typeof caught === "object" && caught !== null) {
    const kind = (caught as { kind?: unknown }).kind;
    if (typeof kind === "string" && ACTION_ERROR_KINDS.includes(kind)) {
      return caught as ActionError;
    }
    if (!(caught instanceof Error)) {
      return {
        kind: "unreachable",
        detail:
          typeof kind === "string"
            ? `an unknown failure, ${JSON.stringify(kind)}`
            : "an unknown failure",
      };
    }
  }
  return { kind: "unreachable", detail: String(caught) };
}

/** A person-readable account of a rejected Action. */
export function explain(error: ActionError): string {
  switch (error.kind) {
    case "malformed":
      return `The Host could not read that Action${error.detail ? `: ${error.detail}` : ""}.`;
    case "unsupported_version":
      return `This window speaks version ${ACTION_VERSION} and the Host ${error.supported}; the Action carried version ${error.got}.`;
    case "invalid_language":
      return `${JSON.stringify(error.language)} is not a language tag — try "pt-BR" or "en".`;
    case "duplicate_language":
      return `${JSON.stringify(error.language)} is already on the list.`;
    case "too_many_languages":
      return `A list holds at most ${error.max ?? MAX_LANGUAGES} languages — remove one before adding another.`;
    case "invalid_subtitle_color":
      return `${JSON.stringify(error.color)} is not a subtitle colour — a colour is "#RRGGBB", like "#FFFF00".`;
    case "invalid_subtitle_scale":
      return `${JSON.stringify(error.scale)} is not a subtitle size — a size is between 0.5 and 2.0.`;
    case "invalid_stream_buffer":
      return `The Host will not keep that Stream buffer${error.detail ? `: ${error.detail}` : ""}.`;
    case "invalid_torrent_cache":
      return `The Host will not keep that Torrent cache${error.detail ? `: ${error.detail}` : ""}.`;
    case "invalid_manifest_url":
      return `${JSON.stringify(error.url)} is not a manifest URL — paste the address of an Addon's manifest.json, like "https://example.com/manifest.json".`;
    case "invalid_addon_id":
      return `${JSON.stringify(error.id)} is not an Addon id.`;
    case "invalid_tmdb_key":
      // The Host carries no part of a refused key back — a refused key can
      // still be a credential with a typo in it — so there is no value here to
      // echo or not.
      return `The Host will not keep that TMDB key${error.detail ? `: ${error.detail}` : ""}.`;
    case "invalid_catalog_ref":
      return `${JSON.stringify(error.value)} is not a catalog ${error.which}.`;
    case "invalid_title_ref":
      return `${JSON.stringify(error.value)} is not a Title ${error.which}.`;
    case "invalid_video_ref":
      return `${JSON.stringify(error.value)} is not a Video ${error.which}.`;
    case "invalid_seek_target":
      return `${JSON.stringify(error.seconds)} is not a number of seconds to seek by.`;
    case "invalid_preview_at":
      return `${JSON.stringify(error.seconds)} is not a moment of the Stream to take a still of.`;
    case "invalid_speed":
      return `${JSON.stringify(error.rate)} is not a playback speed — a speed is a number from 0.05 to 100.`;
    case "invalid_volume":
      return `${JSON.stringify(error.level)} is not a volume — a volume is a number from 0 to 130.`;
    case "invalid_subtitle_delay":
      return `${JSON.stringify(error.seconds)} is not a subtitle delay — a delay is at most an hour either way.`;
    case "invalid_aspect":
      return `${JSON.stringify(error.value)} is not a picture shape — an aspect ratio is greater than 0 and at most 100.`;
    case "invalid_crop":
      return `${JSON.stringify(error.crop)} is not a crop — a crop needs a width and a height, both greater than zero.`;
    case "manifest":
      return `The Host could not read that Addon's manifest${error.detail ? `: ${error.detail}` : ""}.`;
    case "fetch":
      return `The Host could not fetch that Addon${error.detail ? `: ${error.detail}` : ""}.`;
    case "unknown_addon":
      return `No Addon with the id ${JSON.stringify(error.id)} is configured.`;
    case "unknown_catalog":
      return `The Addon ${JSON.stringify(error.addon)} offers no catalog ${error.catalog?.type ?? "?"}/${error.catalog?.id ?? "?"}.`;
    case "unknown_title":
      return `The Addon ${JSON.stringify(error.addon)} offers no meta for ${error.title?.type ?? "?"}/${error.title?.id ?? "?"}.`;
    case "not_discovered_title":
      return `That is not a Discovered Title${error.detail ? `: ${error.detail}` : ""}.`;
    case "tmdb":
      return `TMDB did not answer${error.detail ? `: ${error.detail}` : ""}.`;
    case "unknown_track":
      // The `control` a Host sends for a track is its own tag (`audio_track`),
      // so it is put back into the words a person reads rather than shown raw.
      return `The Stream carries no ${error.control === "subtitle_track" ? "subtitle" : "audio"} track numbered ${error.id}.`;
    case "unknown_chapter":
      return `The Stream has no chapter at position ${error.index}.`;
    case "invalid_position":
      return `The Host has no Addon position ${error.position} — it is configured with ${error.count}.`;
    case "extra":
      return error.detail ?? "The Host will not ask for that catalog with those values.";
    case "query":
      return error.detail ?? "The Host will not search for that.";
    case "invalid_discover":
      return error.detail ?? "The Host will not discover that.";
    case "invalid_search":
      return error.detail ?? "The Host will not search TMDB for that.";
    case "no_tmdb_credential":
      return "This Host holds no TMDB key, so it cannot ask TMDB.";
    case "catalog":
      return `The Host could not read that Addon's catalog${error.detail ? `: ${error.detail}` : ""}.`;
    case "meta":
      return `The Host could not read that Addon's meta response${error.detail ? `: ${error.detail}` : ""}.`;
    case "stream":
      return `The Host could not read that Addon's stream response${error.detail ? `: ${error.detail}` : ""}.`;
    case "subtitles":
      return `The Host could not read that Addon's subtitles response${error.detail ? `: ${error.detail}` : ""}.`;
    case "unplayable":
      return `The Host will not play that Stream: ${error.detail ?? "it is not one it can open"}`;
    case "nothing_playing":
      return `Nothing is playing, so the Host cannot ${controlWords(error.control)}.`;
    case "no_next_episode":
      return `The Host could not move to the next episode${error.detail ? `: ${error.detail}` : ""}.`;
    case "no_previous_episode":
      return `The Host could not move to the previous episode${error.detail ? `: ${error.detail}` : ""}.`;
    case "no_up_next":
      return `The Host has no Up next to play${error.detail ? `: ${error.detail}` : ""}.`;
    case "no_up_next_stream":
      // The client opens the Streams picker for that Video: the Host found no
      // Stream that continues the release, which is not a reason to stop.
      return `The Host found no Stream for the Up next${error.detail ? `: ${error.detail}` : ""}.`;
    case "no_progress":
      return `The Host has no Watch progress for ${error.video?.type ?? "?"}/${error.video?.id ?? "?"}, so there is nothing to resume.`;
    case "playback":
      return `The Host's player could not do that${error.detail ? `: ${error.detail}` : ""}.`;
    case "store":
      return `The Host could not save that change${error.detail ? `: ${error.detail}` : ""}.`;
    case "secret":
      return `The Host could not keep that credential${error.detail ? `: ${error.detail}` : ""}.`;
    case "invalid_stremio_login":
      // As with a refused key, the Host carries back the reason and no part of
      // the sign-in: a typo'd password is still a password.
      return `The Host will not send that Stremio sign-in${error.detail ? `: ${error.detail}` : ""}.`;
    case "sync_unavailable":
      return "This Host was built without Stremio account sync, so it cannot sign in.";
    case "sync":
      return `The Host could not sign in to Stremio${error.detail ? `: ${error.detail}` : ""}.`;
    case "library":
      return `The Host could not read the Stremio Library${error.detail ? `: ${error.detail}` : ""}.`;
    case "invalid_pairing_code":
      return `${JSON.stringify(error.code)} is not a pairing code — a code is six letters and digits, like "4K7Q2M".`;
    case "invalid_device_id":
      return `${JSON.stringify(error.id)} is not a device id.`;
    case "invalid_device_name":
      return `A device needs a name of a few words, not ${JSON.stringify(error.name)}.`;
    case "pairing":
      // The Host carries no part of a refused code back: a mistyped code may
      // still be a code, and there is nothing useful to echo.
      return "That is not the pairing code the Host is showing.";
    case "unknown_device":
      return `No device with the id ${JSON.stringify(error.id)} is paired with this Host.`;
    case "unpaired":
      return "This connection has not paired, so the Host will only take a pairing.";
    case "already_paired":
      return "This connection has already paired; a device pairs by being unpaired.";
    case "unreachable":
      return `The window could not reach the Host${error.detail ? `: ${error.detail}` : ""}.`;
    case "answer":
      return `The Host answered without the page that was asked for${error.detail ? `: ${error.detail}` : ""}.`;
  }
}

/**
 * The control a `nothing_playing` refusal names, as the words a sentence uses.
 * The Host sends its own tag (`audio_track`); this is the other half of that
 * vocabulary, so a refusal reads as a sentence rather than as a tag.
 */
function controlWords(control: Control | undefined): string {
  switch (control) {
    case "pause":
      return "pause";
    case "seek":
      return "seek";
    case "stop":
      return "stop";
    case "audio_track":
      return "change the audio track";
    case "subtitle_track":
      return "change the subtitle track";
    case "subtitle_delay":
      return "shift the subtitles";
    case "speed":
      return "change the speed";
    case "volume":
      return "change the volume";
    case "mute":
      return "change the mute";
    case "chapter":
      return "move between chapters";
    case "crop":
      return "crop the picture";
    case "aspect":
      return "change the aspect";
    case "next_episode":
      return "play the next episode";
    case "previous_episode":
      return "play the previous episode";
    default:
      return "do that";
  }
}
