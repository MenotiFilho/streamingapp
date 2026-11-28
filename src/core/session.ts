import { actionKey, repeats } from "./actionKey";
import { withoutToken, type ActionOutcome } from "./answers";
import { CatalogSearchStore } from "./catalogSearch";
import { asActionError, type ActionError } from "./errors";
import { FeedStore } from "./feedStore";
import { HomeStore } from "./homeStore";
import { InFlight } from "./inFlight";
import type { HostLink, LinkState } from "./link";
import { INITIAL_DISCOVER_FILTERS, type DiscoverFilterState } from "./marqueeDiscover";
import { Selection } from "./selection";
import type { Action, Response, Snapshot, Title } from "./wire";

/**
 * What one client holds about the Host (ADR-0035 §1).
 *
 * The Snapshot and when it arrived, the one alert a refused Action raised, the
 * Titles this client learned are unplayable, and the Actions whose answers are
 * still on their way. It is the Session's own state: the Host publishes none of
 * it, and a second client over the same Host holds its own.
 */
export type SessionState = {
  /** What the Host last published, or null before the first answer. */
  snapshot: Snapshot | null;
  /** When the Snapshot in hand was accepted, by the Session's clock. */
  receivedAt: number;
  /** Why the last Action this client took was refused, where one was. */
  error: ActionError | null;
  /** Titles this client has learned are unplayable, by the id their card carries. */
  unplayable: ReadonlySet<string>;
  /** The keys of the Actions whose answers are still on their way. */
  pending: ReadonlySet<string>;
};

/**
 * Search's place on the screen (#264): the words being typed and the query
 * whose rows are drawn. It lives in the Session so a pushed Title or grid does
 * not take the query away; the keyless arm's own answer is `searchCatalogs`.
 */
export type SearchView = {
  /** The field's text, kept with the query so Back returns to what was typed. */
  draft: string;
  /** The query whose rows are on screen, or null before the first submit. */
  query: string | null;
};

/** Search before a person has asked anything. */
export const EMPTY_SEARCH_VIEW: SearchView = { draft: "", query: null };

/**
 * One client's Session over the Host's one door.
 *
 * It follows the Snapshots the link publishes, keeps the newest by revision,
 * and takes Actions through the link. A control's wait is derived from the
 * pending keys rather than kept beside it (ADR-0027): a second press of the
 * same Action joins the first, while a repeated Action — a seek, a chapter
 * step — is a new step and is never joined (#137).
 *
 * It is framework-free: React reaches it through `core/react/useSession`, and a
 * server, a test or a second client can drive it without a document.
 */
export class Session {
  private current: SessionState = {
    snapshot: null,
    receivedAt: 0,
    error: null,
    unplayable: new Set(),
    pending: new Set(),
  };
  private readonly listeners = new Set<() => void>();
  /** The screens following revised Titles the Host sends after a Reply. */
  private readonly revisionHandlers = new Set<(title: Title) => void>();
  private readonly inFlight = new InFlight<ActionOutcome>();
  /** How many callers hold the subscriptions, so StrictMode's mount/unmount shares them. */
  private holders = 0;
  private stops: Array<() => void> = [];
  /** Whether the Snapshot a ready link is owed has already been asked for. */
  private readReady = false;

  /**
   * Home's rows belong to the session, not to the screen: leaving the
   * destination unmounts Home, and this store keeps the asks already sent
   * running and their answers on hand for the return (#112).
   */
  readonly home: HomeStore;

  /**
   * Discover's and Search's feeds belong to the Session, like Home's rows: a
   * pushed Title or grid unmounts those screens on the Remote, and the return
   * must paint the same rows at the same page (#264).
   */
  readonly feeds: FeedStore;
  /** Discover's chosen genre chip, by the name the two clients share. */
  readonly discoverGenre: Selection<string | null>;
  /** Marquee Discover's Type, Genre and Sort. */
  readonly discoverFilters: Selection<DiscoverFilterState>;
  /** Search's field and committed query. */
  readonly searchView: Selection<SearchView>;
  /** The keyless Search arm's one answer per query. */
  readonly searchCatalogs: CatalogSearchStore;

  constructor(
    private readonly link: HostLink,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.home = new HomeStore(this.ask);
    this.feeds = new FeedStore(this.ask);
    this.discoverGenre = new Selection<string | null>(null);
    this.discoverFilters = new Selection<DiscoverFilterState>(INITIAL_DISCOVER_FILTERS);
    this.searchView = new Selection<SearchView>(EMPTY_SEARCH_VIEW);
    this.searchCatalogs = new CatalogSearchStore(this.ask);
  }

  /**
   * Follow the Host: subscribe to both of its subscriptions, and ask a ready
   * link for the Snapshot a client that has just arrived is owed.
   *
   * The returned stop only unsubscribes. It does not close the link or throw
   * away what this client holds; two callers that start together share one
   * subscription, and the last one to stop takes it away.
   */
  start(): () => void {
    this.holders += 1;
    if (this.holders === 1) {
      this.stops = [
        this.link.onSnapshot((snapshot) => this.accept(snapshot)),
        this.link.onRevision((title) => this.revised(title)),
        this.link.onState((state) => this.follow(state)),
      ];
      this.follow(this.link.state());
    }

    let stopped = false;
    return () => {
      if (stopped) {
        return;
      }
      stopped = true;
      this.holders -= 1;
      if (this.holders === 0) {
        for (const stop of this.stops) {
          stop();
        }
        this.stops = [];
      }
    };
  }

  /** Follow the Session's state. The identity of the return is the unsubscribe. */
  subscribe = (handler: () => void): (() => void) => {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  };

  /**
   * Follow the revised Titles the Host sends this client after a Reply.
   *
   * A revision is the Host's second Answer to a Title this client opened and
   * the background refresh found different (ADR-0038 §2). It is not state and
   * does not enter the Snapshot: the screen that is showing that Title replaces
   * it, and a screen showing another Title ignores it (`decideRevision`).
   */
  onRevision = (handler: (title: Title) => void): (() => void) => {
    this.revisionHandlers.add(handler);
    return () => {
      this.revisionHandlers.delete(handler);
    };
  };

  /** The state as it stands — one cached object, never a fresh Set per read. */
  getState = (): SessionState => this.current;

  /**
   * Take an Action and answer with what came of it, without touching the
   * alert: a caller that draws its own refusal reads this one.
   *
   * One run per key at a time. The key joins a caller to the run already in
   * flight, so a double press sends one Action and both callers see the same
   * answer. A repeated Action is a new step and is sent as one; it is not
   * joined and it does not join the pending keys.
   */
  ask = async (action: Action): Promise<ActionOutcome> => {
    if (repeats(action)) {
      return this.send(action);
    }

    const key = actionKey(action);
    return this.inFlight.run(key, async () => {
      // The pending key belongs to the run that owns the dispatch: a joined
      // caller must not add it a second time, or free it while the first still
      // waits. `InFlight.run` calls this synchronously, before a screen paints.
      this.setPending(key, true);
      try {
        return await this.send(action);
      } finally {
        this.setPending(key, false);
      }
    });
  };

  /** Take an Action a person asked for: a refusal becomes the window's one alert. */
  take = async (action: Action): Promise<Response | null> => {
    this.setError(null);
    const { response, error } = await this.ask(action);
    if (error) {
      this.setError(error);
    }
    return response;
  };

  /**
   * Raise the window's one alert for a refusal the caller read through `ask`.
   *
   * A screen that decides something on a refusal — Play opening the Streams
   * picker for an Up next the Host found no Stream for (#276) — takes the
   * Action with `ask`, acts on the kind, and reports anything it did not act
   * on here. It is the same alert `take` raises.
   */
  report = (error: ActionError | null): void => {
    this.setError(error);
  };

  /**
   * Take a fire-and-forget Action: a card a person only looked at.
   *
   * A look hint has no answer and publishes no Snapshot, so there is nothing to
   * keep and nothing to wait for (#278, ADR-0038 §3). A refusal is swallowed
   * rather than raised as the window's alert: resting on a card is not asking
   * for anything, and a Host too old to know the hint is not an error a person
   * can act on.
   */
  hint = (action: Action): void => {
    void this.link.dispatch(action).catch(() => undefined);
  };

  /**
   * Remember what this client learned about a Title's playability. The set is
   * only copied when a mark actually changes, so a screen reading it re-renders
   * only for a fact that moved.
   */
  markUnplayable = (id: string, unplayable: boolean): void => {
    if (this.current.unplayable.has(id) === unplayable) {
      return;
    }
    const next = new Set(this.current.unplayable);
    if (unplayable) {
      next.add(id);
    } else {
      next.delete(id);
    }
    this.publish({ ...this.current, unplayable: next });
  };

  /** A Snapshot from either the subscription or the first read, kept if it is news. */
  private accept(snapshot: Snapshot): void {
    const held = this.current.snapshot;
    // A late answer to an older question never replaces what is already known;
    // an equal revision is a new fact and replaces it.
    if (held && held.revision > snapshot.revision) {
      return;
    }
    this.publish({ ...this.current, snapshot, receivedAt: this.now() });
  }

  /** One revised Title, on its way to whatever screen is showing it. */
  private revised(title: Title): void {
    for (const handler of [...this.revisionHandlers]) {
      handler(title);
    }
  }

  /** A ready link owes one Snapshot; the next ready state asks again. */
  private follow(state: LinkState): void {
    if (state.kind !== "ready") {
      this.readReady = false;
      return;
    }
    if (this.readReady) {
      return;
    }
    this.readReady = true;
    void this.read();
  }

  private async read(): Promise<void> {
    try {
      this.accept(await this.link.snapshot());
    } catch (caught) {
      this.setError(asActionError(caught));
    }
  }

  /** The one door, with a refusal turned into an outcome and no token on the answer. */
  private async send(action: Action): Promise<ActionOutcome> {
    try {
      return { response: withoutToken(await this.link.dispatch(action)), error: null };
    } catch (caught) {
      return { response: null, error: asActionError(caught) };
    }
  }

  private setPending(key: string, pending: boolean): void {
    if (this.current.pending.has(key) === pending) {
      return;
    }
    const next = new Set(this.current.pending);
    if (pending) {
      next.add(key);
    } else {
      next.delete(key);
    }
    this.publish({ ...this.current, pending: next });
  }

  private setError(error: ActionError | null): void {
    if (this.current.error === error) {
      return;
    }
    this.publish({ ...this.current, error });
  }

  private publish(next: SessionState): void {
    this.current = next;
    for (const listener of [...this.listeners]) {
      listener();
    }
  }
}
