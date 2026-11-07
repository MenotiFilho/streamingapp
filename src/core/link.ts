import type { Action, DeviceSummary, Response, Snapshot, Title } from "./wire";

/**
 * Where a link to the Host stands (ADR-0035 §1).
 *
 * The window's link is always ready — it is the Host's own window, and there is
 * no pairing and no socket to lose. The served Remote's link has the other
 * states: it connects, waits to be paired, reconnects after a drop, and closes
 * when its pairing is taken away. The union is the client core's, so both
 * clients read the same words for them.
 */
export type LinkState =
  | { kind: "connecting" }
  | { kind: "unpaired"; notice: string }
  | { kind: "ready"; device: DeviceSummary | null }
  | { kind: "reconnecting"; attempt: number; retryAt: number }
  | { kind: "closed"; reason: string };

/**
 * How a client reaches the Host (ADR-0035 §1).
 *
 * One door, the same for the window and for the served Remote: a client takes
 * Actions, renders the Snapshots it is sent, and is told where the connection
 * stands. It decides none of the Host's state (ADR-0002).
 *
 * `dispatch` always rejects with an `ActionError` — a refusal the Host sent, or
 * `unreachable` where the Host was never reached — so a caller has one kind of
 * failure to explain. `snapshot()` resolves the state a client that has just
 * arrived is owed: once per `ready`, and never for a link that has not paired.
 *
 * `onSnapshot` and `onState` both return a synchronous unsubscribe, because a
 * client unsubscribes while it unmounts and cannot wait for a promise to settle.
 * A caller reads `state()` first; `onState` reports transitions after that.
 * `close()` moves the link to `closed`, tells the state handlers, and silences
 * both kinds of subscription.
 */
export type HostLink = {
  /** The state as it stands — what a client that has just arrived is owed. */
  snapshot(): Promise<Snapshot>;
  /** Take an Action through the one door, and get back what came of it. */
  dispatch(action: Action): Promise<Response>;
  /** Follow the Snapshots the Host publishes. */
  onSnapshot(handler: (snapshot: Snapshot) => void): () => void;
  /**
   * Follow the revised Titles the Host sends after a Reply: a stale Title's
   * background refresh landed and differs (ADR-0038 §2). Only the client that
   * asked is sent one; a screen swaps it in only while that Title is open.
   */
  onRevision(handler: (title: Title) => void): () => void;
  /** Where the link stands now. */
  state(): LinkState;
  /** Follow where the link stands. */
  onState(handler: (state: LinkState) => void): () => void;
  /** Stop following the Host; the link reports `closed` and delivers nothing. */
  close(): void;
};
