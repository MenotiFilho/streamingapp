import { useEffect, useState } from "react";

import { decideRevision } from "../revision";
import type { Session } from "../session";
import type { Title } from "../wire";

/**
 * The Title a screen draws, replaced when the Host sends this client a revised
 * Answer for it (ADR-0038 §2).
 *
 * A revision lands whenever the background refresh of a stale Title comes back,
 * by which time the person may have left or opened another Title. The decision
 * is [`decideRevision`]'s; this is the subscription both clients share, so the
 * window and the Remote cannot drift on which answer replaces which.
 */
export function useRevisedTitle(
  answered: Title,
  session: Pick<Session, "onRevision">,
): Title {
  const [title, setTitle] = useState(answered);

  // An answer the level re-pushed — a Title opened again — is the new Title,
  // not the one the last revision left.
  useEffect(() => {
    setTitle(answered);
  }, [answered]);

  useEffect(
    () =>
      session.onRevision((revision) => {
        setTitle((open) => {
          const decision = decideRevision(open, revision);
          return decision.kind === "replace" ? decision.title : open;
        });
      }),
    [session],
  );

  return title;
}
