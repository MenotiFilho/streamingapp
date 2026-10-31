import type { AddonStreams } from "../../host-client";

/**
 * The Streams level's bookkeeping, kept out of the drawing (ADR-0032).
 *
 * The count a group prints, the role of each of the Addon's badge lines, and
 * what a group says when its Addon answered nothing are rules. The level's name
 * is the stream model's (`streamsSubject`), and the Addon's display name is the
 * frame's (`addonLabel`), because a Title's attribution prints it too.
 */

/** A group's candidate count, singular where there is one. */
export function candidateCount(count: number): string {
  return `${count} ${count === 1 ? "candidate" : "candidates"}`;
}

/** The list's bookkeeping: `12 candidates / 3 Addons`. */
export function candidateCountLabel(count: number, addons: number): string {
  return `${candidateCount(count)} / ${addons} ${addons === 1 ? "Addon" : "Addons"}`;
}

/**
 * The Addon's own badge lines, read as a screening bill reads them: the first
 * is the source, every line after it is a quality or source mark. Nothing is
 * re-worded or re-ranked — the lines are the Addon's.
 */
export type BadgeRole = "source" | "quality";

export function badgeRole(index: number): BadgeRole {
  return index === 0 ? "source" : "quality";
}

/** What a group that answered nothing says: the list is what exists (ADR-0020). */
export const NO_CANDIDATES = "This Addon answered nothing this Host can play.";

/**
 * The line under a group that answered no candidate. A failed Addon is not this
 * line — its refusal is the Host's own words, drawn as an alert.
 */
export function groupAnswerNote(group: Pick<AddonStreams, "streams" | "failure">): string | null {
  if (group.failure || group.streams.length > 0) {
    return null;
  }
  return NO_CANDIDATES;
}
