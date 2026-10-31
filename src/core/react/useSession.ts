import { useEffect, useMemo, useSyncExternalStore } from "react";

import type { HostLink } from "../link";
import { Session, type SessionState } from "../session";

/** The Session a client reads, and the state it last published. */
export type SessionReads = {
  session: Session;
  state: SessionState;
};

/**
 * The Session, as the one client that draws it reads it.
 *
 * The Session lives as long as the link it was built over: a render does not
 * replace it, and an unchanged state keeps this read's identity, so a screen
 * that passes it down does not re-render for a fresh object. The first mount
 * starts following the link, and the unmount stops (ADR-0035 §1).
 */
export function useSession(link: HostLink): SessionReads {
  const session = useMemo(() => new Session(link), [link]);
  useEffect(() => session.start(), [session]);
  const state = useSyncExternalStore(session.subscribe, session.getState, session.getState);
  return useMemo(() => ({ session, state }), [session, state]);
}
