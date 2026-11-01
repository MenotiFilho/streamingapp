import type { ActionError } from "../core/errors";
import type { HostLink, LinkState } from "../core/link";
import type { Action, Response, Snapshot } from "../core/wire";

/**
 * The Host's one door, faked for a screen's component test (ADR-0032).
 *
 * A dispatch is recorded before it is answered, so a test reads the boundary
 * even while several asks are in flight. An answer that is an `ActionError` is
 * delivered as a rejection, which is what a link does for a refusal, and an
 * answer may be held open when a test needs two asks to overlap.
 */
export type HostAnswer = Response | ActionError;
export type Respond = (action: Action) => HostAnswer | Promise<HostAnswer>;

export class FakeHost implements HostLink {
  /** Every Action the Host was sent, in the order it read them. */
  readonly actions: Action[] = [];
  private held: Snapshot;
  private readonly snapshotHandlers = new Set<(snapshot: Snapshot) => void>();
  private readonly stateHandlers = new Set<(state: LinkState) => void>();

  constructor(
    snapshot: Snapshot,
    private readonly respond: Respond = () => ({ snapshots: [], answer: null }),
  ) {
    this.held = snapshot;
  }

  snapshot(): Promise<Snapshot> {
    return Promise.resolve(this.held);
  }

  async dispatch(action: Action): Promise<Response> {
    this.actions.push(action);
    const outcome = await this.respond(action);
    if ("kind" in outcome) {
      throw outcome;
    }
    return outcome;
  }

  onSnapshot(handler: (snapshot: Snapshot) => void): () => void {
    this.snapshotHandlers.add(handler);
    return () => {
      this.snapshotHandlers.delete(handler);
    };
  }

  state(): LinkState {
    return { kind: "ready", device: null };
  }

  onState(handler: (state: LinkState) => void): () => void {
    this.stateHandlers.add(handler);
    return () => {
      this.stateHandlers.delete(handler);
    };
  }

  close(): void {
    this.snapshotHandlers.clear();
    this.stateHandlers.clear();
  }

  /** Publish one more Snapshot, as the Host does after a change. */
  publish(next: Snapshot): void {
    this.held = next;
    for (const handler of [...this.snapshotHandlers]) {
      handler(next);
    }
  }

  /** The asked-for Actions of one kind, in the order the Host read them. */
  asked<A extends Action["type"]>(type: A): Array<Extract<Action, { type: A }>> {
    return this.actions.filter(
      (action): action is Extract<Action, { type: A }> => action.type === type,
    );
  }
}
