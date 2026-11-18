import { useEffect, useRef, useState } from "react";

import type { ActionError } from "../errors";
import { languagesAction, type LanguageKind } from "../languageList";
import type { Action, Snapshot } from "../wire";

/** How a client asks the Host: the Session's own `ask`, or the window's. */
export type Ask = (action: Action) => Promise<{ error?: ActionError | null }>;

/**
 * One language list as a screen edits it: the list the Host published, and
 * the one a press has made but the Host has not yet answered.
 *
 * Every change sends the whole next list (ADR-0041). The draft moves before the
 * answer comes, so a second press composes from the first rather than from the
 * stale Snapshot and silently reverts it (ADR-0026's "the two cannot drift
 * apart"); a refusal puts the Host's list back and keeps the reason beside the
 * control. The decisions that make the next list are `core/languageList`; the
 * window and the Remote both edit through this one hook (ADR-0018).
 */
export function useLanguageList(kind: LanguageKind, snapshot: Snapshot | null, ask: Ask) {
  const preferences = snapshot?.preferences;
  const published =
    (kind === "subtitle" ? preferences?.subtitleLanguages : preferences?.audioLanguages) ?? [];
  const [list, setList] = useState<string[]>(published);
  const [error, setError] = useState<ActionError | null>(null);
  // What the next press composes from, and what a refusal puts back.
  const held = useRef(list);
  const heldPublished = useRef(published);
  heldPublished.current = published;

  const publishedKey = JSON.stringify(published);
  useEffect(() => {
    held.current = heldPublished.current;
    setList(heldPublished.current);
  }, [publishedKey]);

  /** Send the whole next list, where the decision made one; `null` is a no-op. */
  const change = async (next: string[] | null) => {
    if (next === null) {
      return;
    }
    setError(null);
    held.current = next;
    setList(next);
    const outcome = await ask(languagesAction(kind, next));
    if (outcome.error) {
      setError(outcome.error);
      held.current = heldPublished.current;
      setList(heldPublished.current);
    }
  };

  /** The list as it stands now, for a decision to start from. */
  const current = () => held.current;

  return { list, error, change, current };
}
