/**
 * The decisions behind editing Subtitle languages and Audio languages (#329).
 *
 * Both preferences are ordered lists of up to three language tags, first the
 * most wanted (ADR-0041). Every operation here takes the whole list and returns
 * the whole next list, or `null` when the press changes nothing; a client sends
 * the returned list as it is, through one Action that carries all of it. The
 * window's field and drawer and the Remote's field and sheet draw these
 * decisions and decide none of their own, so the two clients cannot disagree
 * about what a tick at three does (ADR-0018).
 *
 * Nothing here knows the DOM, a pointer, or the Host: a drag is a point and the
 * chips' rectangles in, a rank out.
 */

import type { Action } from "./wire";
import { LANGUAGES, languageName } from "./languages";
import { unknownLanguageLabel } from "./settingsRegister";

/** How many languages a list holds; the Host refuses a fourth. */
export const MAX_LANGUAGES = 3;

/** Which of the Host's two lists a field edits. */
export type LanguageKind = "subtitle" | "audio";

/** What the drawer says when every place is taken. */
export const THREE_CHOSEN_NOTE = "Three chosen. Untick one to choose another.";

/** A tag as the Host compares it: without case. */
function same(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** Choose a language: it goes last, so the first choice stays the most wanted. */
export function tick(list: readonly string[], tag: string): string[] | null {
  if (list.length >= MAX_LANGUAGES || list.some((held) => same(held, tag))) {
    return null;
  }
  return [...list, tag];
}

/** Take a chosen language out by its tag; the rest close up. */
export function untick(list: readonly string[], tag: string): string[] | null {
  const index = list.findIndex((held) => same(held, tag));
  return index < 0 ? null : remove(list, index);
}

/** Take the language at a rank out; the rest close up. */
export function remove(list: readonly string[], index: number): string[] | null {
  if (!Number.isInteger(index) || index < 0 || index >= list.length) {
    return null;
  }
  return list.filter((_, at) => at !== index);
}

/** Take the language at one rank to another; the rest keep their order. */
export function move(list: readonly string[], from: number, to: number): string[] | null {
  const inside = (rank: number) => Number.isInteger(rank) && rank >= 0 && rank < list.length;
  if (!inside(from) || !inside(to) || from === to) {
    return null;
  }
  const next = [...list];
  const [taken] = next.splice(from, 1);
  next.splice(to, 0, taken!);
  return next;
}

/** One rank toward the first. */
export function up(list: readonly string[], index: number): string[] | null {
  return move(list, index, index - 1);
}

/** One rank toward the last. */
export function down(list: readonly string[], index: number): string[] | null {
  return move(list, index, index + 1);
}

/** Whether the curated list names a tag. */
function known(tag: string): boolean {
  return LANGUAGES.some((language) => same(language.tag, tag));
}

/** A tag in the picker's words: its language, or Other where the list does not know it. */
function nameOf(tag: string): string {
  return known(tag) ? languageName(tag) : unknownLanguageLabel(tag);
}

/** One chip of the field: a chosen language and its rank. */
export type LanguageChip = {
  tag: string;
  name: string;
  /** From one, the number the chip wears. */
  rank: number;
  /** Where it sits in the list, from zero: what `remove` and `move` take. */
  index: number;
};

/** The chips a list draws, in rank. */
export function chips(list: readonly string[]): LanguageChip[] {
  return list.map((tag, index) => ({ tag, name: nameOf(tag), rank: index + 1, index }));
}

const ORDINALS = ["1st", "2nd", "3rd"];

/** One row of the drawer. */
export type LanguageRow = {
  tag: string;
  name: string;
  /** `1st`, `2nd`, `3rd` for a chosen row; null for one still to choose. */
  ordinal: string | null;
  /** Where a chosen row sits in the list; -1 for a row still to choose. */
  index: number;
  /** Whether the curated list names the tag. */
  known: boolean;
  /** A row that cannot be ticked: every place is taken. */
  disabled: boolean;
  canUp: boolean;
  canDown: boolean;
};

/** The drawer: the chosen rows in rank, the rest in curated order, and the note. */
export type LanguageRows = {
  chosen: LanguageRow[];
  rest: LanguageRow[];
  /** The line under the rows when the list is full; null otherwise. */
  note: string | null;
};

/**
 * The rows the drawer draws for a list. "Chosen" holds every held tag in rank,
 * including one the curated list does not name (an Other row, removable); the
 * rest are the curated languages not chosen, disabled at three. A tag the list
 * does not name is never in the rest, so once removed it cannot come back from
 * the drawer.
 */
export function rows(list: readonly string[]): LanguageRows {
  const full = list.length >= MAX_LANGUAGES;
  const chosen = list.map(
    (tag, index): LanguageRow => ({
      tag,
      name: nameOf(tag),
      ordinal: ORDINALS[index] ?? null,
      index,
      known: known(tag),
      disabled: false,
      canUp: index > 0,
      canDown: index < list.length - 1,
    }),
  );
  const rest = LANGUAGES.filter((language) => !list.some((held) => same(held, language.tag))).map(
    (language): LanguageRow => ({
      tag: language.tag,
      name: language.name,
      ordinal: null,
      index: -1,
      known: true,
      disabled: full,
      canUp: false,
      canDown: false,
    }),
  );
  return { chosen, rest, note: full ? THREE_CHOSEN_NOTE : null };
}

/** A rectangle in the page's own coordinates. */
export type ChipRect = { x: number; y: number; w: number; h: number };

/** How far a point is from a rectangle: zero inside it. */
function distance(rect: ChipRect, point: { x: number; y: number }): number {
  const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.w));
  const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.h));
  return Math.hypot(dx, dy);
}

/**
 * The rank a chip dragged from `from` lands on when released at `point`: the
 * chip under the point, else the nearest one, so a drop in a gap or past the
 * end still means something. With no chips it stays put.
 */
export function dropIndex(
  rects: readonly ChipRect[],
  point: { x: number; y: number },
  from: number,
): number {
  let best = -1;
  let bestDistance = Infinity;
  rects.forEach((rect, index) => {
    const gap = distance(rect, point);
    if (gap < bestDistance) {
      best = index;
      bestDistance = gap;
    }
  });
  return best < 0 ? from : best;
}

/** The Action that sends a whole list; an empty list clears it. */
export function languagesAction(kind: LanguageKind, languages: string[]): Action {
  return kind === "subtitle"
    ? { type: "set_subtitle_languages", languages }
    : { type: "set_audio_languages", languages };
}
