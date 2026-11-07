import type { ActionOutcome } from "../core/answers";
import type { HostLink } from "../core/link";
import { Session } from "../core/session";
import type { Action, Response } from "../core/wire";

/**
 * A Session for a hand-built `ShellContext` in a test.
 *
 * It is never started, so its link is never asked for a Snapshot; a screen that
 * builds the context by hand only needs the field to satisfy the shell's shape.
 * The optional `ask` is the door the Session's own stores (Home, feeds) take
 * their Actions through, so a screen that reads a store sends the test's asks.
 */
export function quietSession(
  ask: (action: Action) => Promise<ActionOutcome> = async () => ({
    response: null,
    error: null,
  }),
): Session {
  const link: HostLink = {
    snapshot: () => new Promise(() => {}),
    dispatch: async (action: Action): Promise<Response> => {
      const outcome = await ask(action);
      if (outcome.error) {
        throw outcome.error;
      }
      return outcome.response ?? { snapshots: [], answer: null };
    },
    onSnapshot: () => () => {},
    onRevision: () => () => {},
    state: () => ({ kind: "ready", device: null }),
    onState: () => () => {},
    close: () => {},
  };
  return new Session(link);
}
