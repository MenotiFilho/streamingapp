/**
 * The curated subtitle-language list.
 *
 * The Host stores one global language tag and hands it to mpv's `slang`
 * (ADR-0014): mpv does the matching, so this list is a convenience for the
 * person picking, not a table the Host consults. It lives in
 * `src/subtitle-languages.json`, beside the token sheet, because the served
 * companion splices the same JSON in at serve time (#88) — one list, two
 * clients.
 */

import languages from "../subtitle-languages.json";

/** One language a person can prefer, as the picker names it. */
export type SubtitleLanguage = {
  /** The tag mpv receives, e.g. `pt-BR`. */
  tag: string;
  /** The language as a person reads it. */
  name: string;
};

/** The languages the picker offers, in reading order. */
export const SUBTITLE_LANGUAGES: readonly SubtitleLanguage[] = languages;

/**
 * The absence of a preference, in the picker's words. Clearing the preference
 * is an explicit choice, not an empty list: the Host then picks per Video.
 */
export const HOST_PICKS_PER_VIDEO = "Host picks per Video";

/** The name of a tag the list knows, or the tag itself when it does not. */
export function subtitleLanguageName(tag: string): string {
  return SUBTITLE_LANGUAGES.find((language) => language.tag === tag)?.name ?? tag;
}
