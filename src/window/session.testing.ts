import type { HostLink } from "../core/link";
import { Session } from "../core/session";
import type { Response } from "../core/wire";

/**
 * A Session for a hand-built `ShellContext` in a test.
 *
 * It is never started, so its link is never asked for a Snapshot; a screen that
 * builds the context by hand only needs the field to satisfy the shell's shape.
 */
export function quietSession(): Session {
  const link: HostLink = {
    snapshot: () => new Promise(() => {}),
    dispatch: async (): Promise<Response> => ({ snapshots: [], answer: null }),
    onSnapshot: () => () => {},
    state: () => ({ kind: "ready", device: null }),
    onState: () => () => {},
    close: () => {},
  };
  return new Session(link);
}
