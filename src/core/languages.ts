/**
 * The curated language list, shared by both language preferences.
 *
 * The Host keeps two ordered lists of language tags, Subtitle languages and
 * Audio languages (ADR-0041). This list is what a person picks from for either
 * one; it is a convenience for the person, not a table the Host consults. The
 * Host's own code table (not mpv) does the matching, and it accepts a tag that
 * is not on this list. The list lives in `src/languages.json`, beside the token
 * sheet, because the served companion splices the same JSON in at serve time
 * (#88) — one list, two clients.
 */

import languages from "../languages.json";

/** One language a person can choose, as the picker names it. */
export type Language = {
  /** The language tag, e.g. `pt-BR`. */
  tag: string;
  /** The language as a person reads it. */
  name: string;
};

/** The languages the picker offers, in reading order. */
export const LANGUAGES: readonly Language[] = languages;

/**
 * An empty list, in the picker's words: the Host follows the file instead of
 * choosing by language.
 */
export const FOLLOW_THE_FILE = "Follow the file";

/** What following the file means for the subtitle. */
export const FOLLOW_THE_FILE_SUBTITLE_LINE =
  "The subtitle the file marks as default, if it has one.";

/** What following the file means for the soundtrack. */
export const FOLLOW_THE_FILE_AUDIO_LINE = "The soundtrack the file marks as default.";

/** The name of a tag the list knows, or the tag itself when it does not. */
export function languageName(tag: string): string {
  return LANGUAGES.find((language) => language.tag === tag)?.name ?? tag;
}
