import { revisedTitleOf, withoutToken } from "../core/answers";
import { asActionError } from "../core/errors";
import type { HostLink, LinkState } from "../core/link";
import { ACTION_VERSION, REVISION_EVENT, SNAPSHOT_EVENT } from "../core/wire";
import type { Action, Response, Snapshot, Title } from "../core/wire";
import type { Transport } from "./transport";

/**
 * A link that is ready from its first render and only ever closes.
 *
 * Both of the window's links are this: the Host's own window is already in and
 * pairs nothing, and the rehearsal is a page with no Host to leave. The one
 * implementation is where the state, the subscriptions and the listen/unlisten
 * race live; each adapter says only which transport answers and what closing
 * means (ADR-0035 §1).
 *
 * Every failure a call can raise leaves as an `ActionError`, so a caller has one
 * kind of failure to explain.
 */
export class ReadyLink implements HostLink {
  private current: LinkState = { kind: "ready", device: null };
  private readonly stops = new Set<() => void>();
  private readonly stateHandlers = new Set<(state: LinkState) => void>();

  constructor(
    private readonly transport: Transport,
    private readonly reason: string,
    private readonly onClose: () => void = () => undefined,
  ) {}

  /** The state as it stands — what a window that has just loaded is owed. */
  snapshot(): Promise<Snapshot> {
    return this.transport.invoke<Snapshot>("snapshot");
  }

  /** Take an Action through the one door, and get back what came of it. */
  async dispatch(action: Action): Promise<Response> {
    try {
      const response = await this.transport.invoke<Response>("dispatch", {
        envelope: { version: ACTION_VERSION, action },
      });
      return withoutToken(response);
    } catch (caught: unknown) {
      throw asActionError(caught);
    }
  }

  /** Follow the Snapshots the Host publishes. */
  onSnapshot(handler: (snapshot: Snapshot) => void): () => void {
    return this.follow(SNAPSHOT_EVENT, handler);
  }

  /**
   * Follow the revised Titles the Host sends this window.
   *
   * The event's payload is an Answer marked as a revision (ADR-0038 §2); the
   * link hands the Title on, so a screen never reads the wrapper. A payload
   * that is not one is ignored rather than guessed at.
   */
  onRevision(handler: (title: Title) => void): () => void {
    return this.follow<unknown>(REVISION_EVENT, (payload) => {
      const title = revisedTitleOf(payload);
      if (title) {
        handler(title);
      }
    });
  }

  /**
   * Listen to one Host event, and return the unsubscribe.
   *
   * A closed link delivers nothing, including to a subscription made after it
   * closed: `close()` has already cleared its set, and never runs again. The
   * listen may settle after the caller unsubscribed — a StrictMode
   * mount/unmount is exactly that race — so the unlisten happens then.
   */
  private follow<T>(
    event: string,
    handler: (payload: T) => void,
  ): () => void {
    if (this.current.kind === "closed") {
      return () => undefined;
    }

    let closed = false;
    let stop: (() => void) | undefined;

    void this.transport
      .listen<T>(event, (event) => {
        // A listener that settles after `close()` must not deliver anything:
        // the page may be gone, and the handler is the caller's business.
        if (!closed) {
          handler(event.payload);
        }
      })
      .then((unlisten) => {
        if (closed) {
          unlisten();
        } else {
          stop = unlisten;
        }
      });

    const unsubscribe = (): void => {
      closed = true;
      stop?.();
      this.stops.delete(unsubscribe);
    };
    this.stops.add(unsubscribe);
    return unsubscribe;
  }

  state(): LinkState {
    return this.current;
  }

  onState(handler: (state: LinkState) => void): () => void {
    if (this.current.kind === "closed") {
      return () => undefined;
    }

    this.stateHandlers.add(handler);
    return () => {
      this.stateHandlers.delete(handler);
    };
  }

  close(): void {
    if (this.current.kind === "closed") {
      return;
    }

    const closed: LinkState = { kind: "closed", reason: this.reason };
    this.current = closed;

    for (const stop of [...this.stops]) {
      stop();
    }
    this.stops.clear();
    this.onClose();

    for (const handler of [...this.stateHandlers]) {
      handler(closed);
    }
    this.stateHandlers.clear();
  }
}
