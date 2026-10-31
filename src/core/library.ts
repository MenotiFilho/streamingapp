/**
 * The Continue watching row: the pure decisions a library card is drawn from.
 *
 * The Host decides what is in the library — which Videos have Watch progress,
 * where each was left, and whether the Addon that supplied its Title is still
 * configured — and this module only says how those facts read (ADR-0002). A
 * press is the `resume` Action, and nothing here holds state: what a card shows
 * is the Snapshot the Host published.
 */

import type { ResumeEntry } from "./wire";
import { formatTime } from "./playback";
import { labelOf } from "./title";

/**
 * How far through a Video the Host's record is, from 0 to 1 — or null where
 * there is no length to measure against (a Stream that has only just opened, or
 * one that never said how long it is). A position past the end reads as 1.
 */
export function progressOf(entry: ResumeEntry): number | null {
  if (entry.position === null || entry.duration === null || entry.duration <= 0) {
    return null;
  }
  return Math.max(0, Math.min(1, entry.position / entry.duration));
}

/**
 * Whether the Host will play this entry again. A stub whose Addon is gone is
 * listed and marked, not hidden — that is what "a mark, not a hiding" means
 * (CONTEXT.md) — but it is not a card a person can press.
 */
export function resumable(entry: ResumeEntry): boolean {
  return entry.unplayable === null;
}

/**
 * What a library card is called: the Title's name, and the episode beside it
 * where the Video is one. A film is named by its Title alone.
 */
export function cardName(entry: ResumeEntry): string {
  const label = labelOf(entry.video);
  return label ? `${entry.title.name} — ${label}` : entry.title.name;
}

/**
 * How much of the Video is left, as a person reads it: `42:10 left`, or
 * `Watched`, or where the Video is with no length to measure against. The
 * unplayable case says why instead, because that is the fact that matters for
 * that card.
 */
export function cardNote(entry: ResumeEntry): string {
  if (entry.unplayable) {
    return entry.unplayable.reason === "addon_removed"
      ? `Unplayable — the Addon ${entry.unplayable.addon} that supplied this Title is gone.`
      : "Unplayable.";
  }
  if (entry.watched) {
    return "Watched";
  }
  if (entry.position === null) {
    return "Not started yet";
  }
  if (entry.duration === null) {
    return `${formatTime(entry.position)} in`;
  }
  return `${formatTime(entry.duration - entry.position)} left`;
}
