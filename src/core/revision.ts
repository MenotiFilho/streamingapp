import type { Title } from "./wire";

/**
 * What a Title screen does with a revised Answer (ADR-0038 §2).
 *
 * A revision is addressed to the client that asked, but it lands whenever the
 * extra request the Host made comes back. The screen may have moved on: the
 * person may have backed out, or opened another Title. Then the revision is
 * not news, and is ignored. Only the Title the screen is still showing is
 * replaced.
 */
export type RevisionDecision =
  | { kind: "replace"; title: Title }
  | { kind: "ignore" };

/** Whether a revision is the Title on screen — and therefore replaces it. */
export function decideRevision(
  open: Title | null,
  revision: Title,
): RevisionDecision {
  if (open === null || open.type !== revision.type || open.id !== revision.id) {
    return { kind: "ignore" };
  }
  return { kind: "replace", title: revision };
}
