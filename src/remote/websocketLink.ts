import { revisedTitleOf, withoutToken } from "../core/answers";
import type { ActionError } from "../core/errors";
import type { HostLink, LinkState } from "../core/link";
import { ACTION_VERSION } from "../core/wire";
import type { Action, DeviceSummary, Response, Snapshot, Title } from "../core/wire";
import { LIVENESS, onTick, onWake, type LivenessMove, type SocketHeld } from "./liveness";
import type { TokenStore } from "./tokenStore";

/**
 * The four things the link reads of the browser's socket.
 *
 * Narrowed rather than the whole `WebSocket` so a test can hand in a fake with
 * no network anywhere near it, and so the one implementation of the
 * conversation is the same whether the bytes travel or not.
 */
export type SocketLike = {
  send(data: string): void;
  /** The code and reason travel to the Host, which logs why a device let go. */
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
};

/** How the link gets a socket: the browser's `WebSocket`, or a fake's. */
export type SocketFactory = (url: string) => SocketLike;

/** How the link waits: a timer, or a test's hand-cranked queue. */
export type Schedule = (delay: number, run: () => void) => () => void;

/** What the page tells the link: put away, looked at again, or back online. */
export type PageChange = "hidden" | "shown" | "online";

/**
 * The page around the link, read for the two things a socket's health depends
 * on: whether anyone is looking, and when they come back.
 *
 * Narrowed like the socket, so a suite puts the page away and brings it back by
 * hand instead of through the document it happens to run in.
 */
export type PageWatch = {
  /** Whether the page is out of sight now. */
  hidden(): boolean;
  /** Follow the page; the return is the unsubscribe. */
  follow(handler: (change: PageChange) => void): () => void;
};

export type WebSocketLinkOptions = {
  /** Where the Host's wire server is; `socketUrl` decides it. */
  url: string;
  /** Where the Device token is kept. */
  tokens: TokenStore;
  /** The browser's socket, unless a test says otherwise. */
  open?: SocketFactory;
  /** `setTimeout`, unless a test says otherwise. */
  schedule?: Schedule;
  /**
   * The clock `retryAt` and the link's silences are measured by; `Date.now`
   * unless a test says otherwise. A wall clock, so a page the browser froze
   * still knows how long it was away.
   */
  now?: () => number;
  /** The browser's document and window, unless a test says otherwise. */
  page?: PageWatch;
};

/** The first retry waits this long, and each one after it grows by the factor. */
const RETRY_BASE_MS = 400;
const RETRY_FACTOR = 1.6;
/** A phone on a home network is not helped by waiting longer than this. */
const RETRY_CAP_MS = 8000;

/**
 * The close code a socket the link lets go of on purpose is shut with: an
 * application's own (4000–4999), so the Host's log tells it from a browser's.
 */
const LET_GO = 4000;

/** The pairing gate's words, in the two cases a connection can be unpaired. */
const PAIR_FIRST =
  "Enter the pairing code the Host is showing, and this device is in.";
const PAIR_AGAIN =
  "This device is not paired with the Host any more. Pair it again.";

/** A failure the Host never heard about, shaped as the one kind of failure a link raises. */
function unreachable(detail: string): ActionError {
  return { kind: "unreachable", detail };
}

/** Whether a decoded frame is an object with keys. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The browser's own socket, read for the four things the link uses. */
const browserSocket: SocketFactory = (url) => new WebSocket(url) as unknown as SocketLike;

/**
 * The browser's page, read for the moments a phone comes back.
 *
 * `visibilitychange` is the screen going off and on, or another app taking the
 * front; `pageshow` a page restored from the back/forward cache; `resume` one
 * the browser had frozen; `online` the network returning. A page that was never
 * reported hidden is still "shown" by the last three, which is a question the
 * link asks rather than a socket it replaces.
 */
const browserPage: PageWatch = {
  hidden: () => document.visibilityState === "hidden",
  follow: (handler) => {
    const onVisibility = (): void => {
      handler(document.visibilityState === "hidden" ? "hidden" : "shown");
    };
    const onShown = (): void => {
      if (document.visibilityState !== "hidden") {
        handler("shown");
      }
    };
    const onOnline = (): void => handler("online");
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("resume", onShown);
    window.addEventListener("pageshow", onShown);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("resume", onShown);
      window.removeEventListener("pageshow", onShown);
      window.removeEventListener("online", onOnline);
    };
  },
};

/** One command waiting for its correlated answer. */
type Pending = {
  resolve: (response: Response) => void;
  reject: (error: ActionError) => void;
};

/**
 * The served Remote's link: the Host's one door, over a WebSocket (ADR-0035 §1).
 *
 * It is the second adapter of the core's `HostLink`, and the only one with the
 * states the window never has: it connects, waits to be paired, reconnects after
 * a phone's radio slept, and closes when its pairing is taken away. Every frame
 * is the wire protocol's (`host-core::wire`), and the conversation is the
 * hand-written page's, kept in one place instead of in a page's script.
 *
 * A socket the browser calls OPEN is not believed on that word alone
 * (`liveness`): a page looked at again asks the Host at once, or replaces a
 * socket it was away from for long; a quiet Host is greeted; and a socket that
 * stays silent, or never opens, is replaced. Without that, a phone that slept
 * reads Live while every press waits on a socket nobody is at.
 *
 * The Device token does not cross the link: a greeting presents the store's
 * token, a pairing answer's token is written to the store, and every answer is
 * handed on through `withoutToken`, so the Session holds a Device and never the
 * Device token.
 *
 * The seams are injected — the socket factory, the scheduler, the clock and the
 * page — so the suite drives a fake socket in jsdom and no test opens a socket.
 */
export class WebSocketLink implements HostLink {
  private current: LinkState = { kind: "connecting" };
  private socket: SocketLike | null = null;
  /** Whether the current socket has opened and may be written to. */
  private open = false;
  /** The presses waiting for the link to move: a socket opens or is lost, a question is answered. */
  private readonly movers = new Set<() => void>();
  private attempt = 0;
  private nextId = 1;
  private closed = false;
  private latest: Snapshot | null = null;
  private cancelRetry: (() => void) | null = null;
  /** The deadline of an attempt that has not opened yet. */
  private cancelOpenWait: (() => void) | null = null;
  /** The link's own clock, while a socket is open. */
  private cancelTick: (() => void) | null = null;
  /** A greeting's deadline, and whether anything has been heard since it was sent. */
  private probe: { cancel: () => void; heard: boolean } | null = null;
  /** When the Host last sent anything on this socket, by the link's clock. */
  private heardAt = 0;
  /** When the link last greeted the Host on this socket. */
  private greetedAt = 0;
  /** When the page was put away, or null while it is in sight. */
  private hiddenAt: number | null = null;
  private readonly stopFollowingPage: () => void;
  private readonly openSocket: SocketFactory;
  private readonly schedule: Schedule;
  private readonly now: () => number;
  private readonly pending = new Map<number, Pending>();
  private readonly snapshotWaiters: Array<{
    resolve: (snapshot: Snapshot) => void;
    reject: (error: ActionError) => void;
  }> = [];
  private readonly snapshotHandlers = new Set<(snapshot: Snapshot) => void>();
  private readonly revisionHandlers = new Set<(title: Title) => void>();
  private readonly stateHandlers = new Set<(state: LinkState) => void>();

  constructor(private readonly options: WebSocketLinkOptions) {
    this.openSocket = options.open ?? browserSocket;
    this.schedule =
      options.schedule ??
      ((delay, run) => {
        const timer = setTimeout(run, delay);
        return () => clearTimeout(timer);
      });
    this.now = options.now ?? (() => Date.now());
    const page = options.page ?? browserPage;
    if (page.hidden()) {
      this.hiddenAt = this.now();
    }
    this.stopFollowingPage = page.follow((change) => this.onPage(change));
    this.connect();
  }

  /**
   * The Snapshot a client that has just arrived is owed.
   *
   * The wire has no "read the state" frame: the Host pushes a Snapshot to a
   * connection the moment it welcomes it, and every Snapshot after that is
   * pushed the same way. So this resolves the newest one this connection holds,
   * and waits for the first where the welcome is still on its way. An unpaired
   * link owes nothing and never settles until it is closed (#190 §2).
   */
  snapshot(): Promise<Snapshot> {
    if (this.latest) {
      return Promise.resolve(this.latest);
    }
    if (this.closed) {
      return Promise.reject(unreachable("the link is closed"));
    }
    return new Promise<Snapshot>((resolve, reject) => {
      this.snapshotWaiters.push({ resolve, reject });
    });
  }

  /**
   * Take an Action through the one door.
   *
   * A press made while the socket is opening, reconnecting or being asked
   * whether it is still there waits for it rather than failing: the page is on
   * its way back, not broken. One that has waited `holdPress` without a socket
   * — or is made after `close()` — rejects as `unreachable`, which is the one
   * kind of failure a caller has to explain.
   */
  async dispatch(action: Action): Promise<Response> {
    await this.whenOpen();
    const id = this.nextId;
    this.nextId += 1;

    return new Promise<Response>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const sent = this.send({
        version: ACTION_VERSION,
        id,
        command: action,
      });
      if (!sent) {
        this.pending.delete(id);
        reject(unreachable("the Host is not connected"));
      }
    });
  }

  /** Follow the Snapshots the Host pushes. */
  onSnapshot(handler: (snapshot: Snapshot) => void): () => void {
    if (this.closed) {
      return () => undefined;
    }
    this.snapshotHandlers.add(handler);
    return () => {
      this.snapshotHandlers.delete(handler);
    };
  }

  /**
   * Follow the revised Titles the Host sends this device after a Reply
   * (ADR-0038 §2). A revision arrives on this socket alone; a device that did
   * not ask is never sent one.
   */
  onRevision(handler: (title: Title) => void): () => void {
    if (this.closed) {
      return () => undefined;
    }
    this.revisionHandlers.add(handler);
    return () => {
      this.revisionHandlers.delete(handler);
    };
  }

  state(): LinkState {
    return this.current;
  }

  /** Follow where the link stands. */
  onState(handler: (state: LinkState) => void): () => void {
    if (this.closed) {
      return () => undefined;
    }
    this.stateHandlers.add(handler);
    return () => {
      this.stateHandlers.delete(handler);
    };
  }

  /**
   * Stop following the Host.
   *
   * A closed link says so once, tells nobody twice, delivers nothing more —
   * including to a subscription made after it closed — and stops a retry that
   * was waiting for its turn.
   */
  close(): void {
    this.shut("the Remote closed");
  }

  /** Open one socket and wire its four events. */
  private connect(): void {
    this.cancelRetry?.();
    this.cancelRetry = null;
    this.open = false;

    let socket: SocketLike;
    try {
      socket = this.openSocket(this.options.url);
    } catch {
      // An address the browser refuses to open is a connection that failed,
      // not a page that stops working.
      this.scheduleReconnect(false);
      this.move();
      return;
    }

    this.socket = socket;
    socket.onopen = () => this.onOpen(socket);
    socket.onmessage = (event) => {
      if (this.socket === socket) {
        this.heard();
        this.onFrame(event.data);
      }
    };
    socket.onclose = () => this.onClose(socket);
    socket.onerror = () => {
      // `close` normally follows an error; forcing it makes a browser that only
      // reports the error start the reconnect instead of staying silent.
      try {
        socket.close();
      } catch {
        // Already gone.
      }
    };
    // A socket whose handshake was lost can sit in CONNECTING for minutes: an
    // attempt that has not opened by the deadline is a connection that failed.
    this.cancelOpenWait = this.schedule(LIVENESS.openWithin, () => {
      this.cancelOpenWait = null;
      if (this.socket === socket && !this.open) {
        this.lose(socket, "the Host is not connected", "retry", "it never opened");
      }
    });
  }

  private onOpen(socket: SocketLike): void {
    if (this.socket !== socket || this.closed) {
      return;
    }
    this.cancelOpenWait?.();
    this.cancelOpenWait = null;
    this.open = true;
    this.attempt = 0;
    this.heardAt = this.now();
    // The greeting is the whole of "this device has paired": the Host answers
    // with the Device it names, or with nothing, which is a connection that may
    // only pair.
    this.greet();
    this.armTick();
    this.move();
  }

  private onClose(socket: SocketLike): void {
    this.lose(socket, "the Host is not connected", "retry");
  }

  /**
   * Let a socket go, and get another: after the backoff when it closed or never
   * opened, at once when the link judged it dead — a dead socket is not a
   * network that is down, and the person who woke the page is about to press.
   */
  private lose(
    socket: SocketLike,
    reason: string,
    next: "retry" | "now",
    why?: string,
  ): void {
    if (this.socket !== socket) {
      return;
    }
    this.socket = null;
    this.open = false;
    this.stopWatching();
    // What the last connection held is not what the next one will be owed: a
    // reconnecting client is handed the state as it stands, not as it left.
    this.latest = null;
    this.failPending(unreachable(reason));
    try {
      // Closed already when the browser said so. A socket the link lets go of
      // is shut here with its reason, which reaches the Host if the socket
      // still does, and its late `close` finds another socket current.
      if (why) {
        socket.close(LET_GO, why);
      } else {
        socket.close();
      }
    } catch {
      // Already gone.
    }

    if (this.closed) {
      this.move();
      return;
    }
    // An unpaired page stays on its gate while the socket comes back: the
    // pairing form is what it was doing, and `reconnecting` would put the room
    // of a client that never paired in front of it.
    const hold = this.current.kind === "unpaired";
    if (next === "retry") {
      this.scheduleReconnect(hold);
    } else {
      if (!hold) {
        this.setState({
          kind: "reconnecting",
          attempt: this.attempt + 1,
          retryAt: this.now(),
        });
      }
      this.connect();
    }
    this.move();
  }

  /** The page was put away, looked at again, or its network came back. */
  private onPage(change: PageChange): void {
    if (this.closed) {
      return;
    }
    if (change === "hidden") {
      this.hiddenAt ??= this.now();
      return;
    }
    if (change === "shown") {
      this.hiddenAt = null;
    }
    this.act(
      onWake({
        socket: this.held(),
        ready: this.current.kind === "ready",
        asking: this.pending.size,
      }),
    );
  }

  /** The link's own clock came round: look at how long the Host has been quiet. */
  private tick(): void {
    this.cancelTick = null;
    if (this.closed || !this.socket || !this.open) {
      return;
    }
    const now = this.now();
    const quietFor = now - this.heardAt;
    this.act(
      onTick({
        hidden: this.hiddenAt !== null,
        socket: this.held(),
        ready: this.current.kind === "ready",
        asking: this.pending.size,
        quietFor,
        sinceGreeting: now - this.greetedAt,
      }),
      `nothing for ${Math.round(quietFor / 1000)} s`,
    );
    if (this.socket && this.open && this.cancelTick === null) {
      this.armTick();
    }
  }

  /** Do what a liveness decision said; `why` is what the Host is told on a replace. */
  private act(move: LivenessMove, why = "no answer"): void {
    switch (move) {
      case "none":
        return;
      case "greet":
        this.greet();
        return;
      case "probe":
        this.ask();
        return;
      case "replace":
        if (this.socket) {
          this.lose(this.socket, "the Host stopped answering", "now", why);
        }
        return;
      case "connect":
        if (!this.socket) {
          this.connect();
        }
        return;
    }
  }

  /**
   * Greet the Host, and replace the socket if nothing at all comes back in
   * time: the answer to a greeting is a Welcome and the state as it stands,
   * and any frame is as good a proof.
   */
  private ask(): void {
    const socket = this.socket;
    if (!socket || this.probe) {
      return;
    }
    // Listening before asking: an answer is never owed to a question that has
    // not been sent, but nothing says it cannot arrive before `send` returns.
    const probe = { heard: false, cancel: (): void => undefined };
    this.probe = probe;
    this.greet();
    if (this.probe !== probe) {
      // The greeting's answer already let this socket go.
      return;
    }
    probe.cancel = this.schedule(LIVENESS.probeWait, () => {
      if (this.probe === probe) {
        this.probe = null;
      }
      if (this.socket === socket && !probe.heard) {
        this.lose(
          socket,
          "the Host stopped answering",
          "now",
          "no answer after the page was shown",
        );
      }
    });
  }

  /** The greeting: the token this device holds, answered with what it is. */
  private greet(): void {
    this.greetedAt = this.now();
    this.send({
      version: ACTION_VERSION,
      hello: { token: this.options.tokens.read() },
    });
  }

  /** Anything at all arrived on the current socket: a question it was asked is answered. */
  private heard(): void {
    this.heardAt = this.now();
    const probe = this.probe;
    if (probe) {
      probe.heard = true;
      probe.cancel();
      this.probe = null;
      this.move();
    }
  }

  /** The socket as `liveness` reads it. */
  private held(): SocketHeld {
    if (!this.socket) {
      return "none";
    }
    return this.open ? "open" : "opening";
  }

  private armTick(): void {
    this.cancelTick?.();
    this.cancelTick = this.schedule(LIVENESS.tick, () => this.tick());
  }

  /** Stop every clock the current socket was being watched by. */
  private stopWatching(): void {
    this.cancelOpenWait?.();
    this.cancelOpenWait = null;
    this.cancelTick?.();
    this.cancelTick = null;
    this.probe?.cancel();
    this.probe = null;
  }

  /** One frame from the Host, in the protocol's four shapes. */
  private onFrame(data: unknown): void {
    let frame: unknown;
    try {
      frame = JSON.parse(typeof data === "string" ? data : "");
    } catch {
      return;
    }
    if (!isRecord(frame)) {
      return;
    }

    if (frame.version !== ACTION_VERSION) {
      // A page and a Host that disagree on the version disagree on the frames:
      // no amount of reconnecting makes them agree, so the link stops and says
      // which version it speaks.
      this.shut(
        `This page speaks version ${ACTION_VERSION} and the Host ${String(frame.version)}.`,
      );
      return;
    }

    if (isRecord(frame.welcome)) {
      this.onWelcome(frame.welcome.device);
      return;
    }
    if ("snapshot" in frame) {
      this.onSnapshotFrame(frame.snapshot as Snapshot);
      return;
    }
    if ("revision" in frame) {
      this.onRevisionFrame(frame.revision);
      return;
    }
    if (typeof frame.id === "number" && "response" in frame) {
      this.onResponse(frame.id, frame.response as Response);
      return;
    }
    if (isRecord(frame.error)) {
      this.onRefusal(
        typeof frame.id === "number" ? frame.id : null,
        frame.error as ActionError,
      );
    }
  }

  /**
   * The greeting's answer: the Device this connection is, or nothing.
   *
   * Nothing means the token it presented — if it presented one — names no
   * Device any more, so the token is forgotten and the pairing gate is what the
   * person sees. A first connect with no token lands here too, which is the
   * same gate with the same job.
   */
  private onWelcome(device: unknown): void {
    if (isRecord(device)) {
      this.setState({ kind: "ready", device: device as DeviceSummary });
      return;
    }
    const presented = this.options.tokens.read() !== null;
    this.options.tokens.clear();
    this.latest = null;
    this.setState({
      kind: "unpaired",
      notice: presented ? PAIR_AGAIN : PAIR_FIRST,
    });
  }

  private onSnapshotFrame(snapshot: Snapshot): void {
    this.latest = snapshot;
    for (const handler of [...this.snapshotHandlers]) {
      handler(snapshot);
    }
    for (const waiter of this.snapshotWaiters.splice(0)) {
      waiter.resolve(snapshot);
    }
  }

  /** A revised Answer: the Title in it, if it is one, to this connection's handlers. */
  private onRevisionFrame(answer: unknown): void {
    const title = revisedTitleOf(answer);
    if (!title) {
      return;
    }
    for (const handler of [...this.revisionHandlers]) {
      handler(title);
    }
  }

  /**
   * A Reply, or the refusal that answers one command.
   *
   * A pairing's answer carries the token this connection now holds: adopting it
   * here is what makes the rest of the conversation a paired one without a
   * second greeting, and the store is where it outlives the tab.
   */
  private onResponse(id: number, response: Response): void {
    const pending = this.pending.get(id);
    if (!pending) {
      return;
    }
    this.pending.delete(id);

    const answer = response.answer;
    if (answer && "paired" in answer) {
      const paired = answer.paired as { device: DeviceSummary; token?: string };
      if (typeof paired.token === "string" && paired.token.length > 0) {
        this.options.tokens.write(paired.token);
        this.setState({ kind: "ready", device: paired.device });
      }
    }
    pending.resolve(withoutToken(response));
  }

  /**
   * A refusal. With an id it is one command's answer; without one it is the
   * connection's own news — a Device revoked while it sat connected, which the
   * Host says before it hangs up.
   */
  private onRefusal(id: number | null, error: ActionError): void {
    if (id !== null) {
      const pending = this.pending.get(id);
      if (pending) {
        this.pending.delete(id);
        pending.reject(error);
        return;
      }
    }

    if (error.kind === "unpaired") {
      this.options.tokens.clear();
      this.latest = null;
      this.setState({ kind: "unpaired", notice: PAIR_AGAIN });
      return;
    }
    if (error.kind === "unsupported_version") {
      this.shut(
        `This page speaks version ${ACTION_VERSION} and the Host ${error.supported ?? "?"}.`,
      );
    }
  }

  /** The next attempt's wait: short at first, longer each time, and capped. */
  private scheduleReconnect(hold: boolean): void {
    if (this.closed) {
      return;
    }
    this.attempt += 1;
    const delay = Math.min(
      RETRY_CAP_MS,
      Math.round(RETRY_BASE_MS * RETRY_FACTOR ** (this.attempt - 1)),
    );
    if (!hold) {
      this.setState({
        kind: "reconnecting",
        attempt: this.attempt,
        retryAt: this.now() + delay,
      });
    }
    this.cancelRetry = this.schedule(delay, () => {
      this.cancelRetry = null;
      if (!this.closed) {
        this.connect();
      }
    });
  }

  /**
   * Stop for good, and say why.
   *
   * `close()` is this with the Remote's own reason; a version the page does not
   * speak is the other. Both leave the same state and the same silence.
   */
  private shut(reason: string): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.cancelRetry?.();
    this.cancelRetry = null;
    this.stopWatching();
    this.stopFollowingPage();

    const socket = this.socket;
    this.socket = null;
    this.open = false;
    if (socket) {
      try {
        socket.close();
      } catch {
        // A socket already gone is closed enough.
      }
    }
    this.move();

    this.failPending(unreachable(reason));
    this.failSnapshots(unreachable(reason));

    const closed: LinkState = { kind: "closed", reason };
    this.current = closed;
    for (const handler of [...this.stateHandlers]) {
      handler(closed);
    }
    this.stateHandlers.clear();
    this.snapshotHandlers.clear();
    this.revisionHandlers.clear();
  }

  /**
   * Wait until the current socket may be written to: open, and not being asked
   * whether it is still there.
   *
   * What is checked each time the link moves is the truth rather than a
   * promise: a socket opening, a retry booked or a question in the air is a
   * link on its way, and a press waits `holdPress` for it before it is refused.
   */
  private async whenOpen(): Promise<void> {
    const until = this.now() + LIVENESS.holdPress;
    for (;;) {
      if (this.closed) {
        throw unreachable("the link is closed");
      }
      if (this.open && !this.probe) {
        return;
      }
      const left = until - this.now();
      if (left <= 0) {
        throw unreachable("the Host is not connected");
      }
      await this.moved(left);
    }
  }

  /** Resolves the next time the link moves, or after `ms` if it does not. */
  private moved(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      let cancel: () => void = () => undefined;
      const done = (): void => {
        this.movers.delete(done);
        cancel();
        resolve();
      };
      this.movers.add(done);
      cancel = this.schedule(ms, done);
    });
  }

  /** Tell every waiting press the link moved, so it looks again. */
  private move(): void {
    for (const mover of [...this.movers]) {
      mover();
    }
  }

  /** One frame out, or `false` where there is no open socket to carry it. */
  private send(frame: unknown): boolean {
    const socket = this.socket;
    if (!socket || !this.open) {
      return false;
    }
    try {
      socket.send(JSON.stringify(frame));
      return true;
    } catch {
      return false;
    }
  }

  private setState(next: LinkState): void {
    if (this.closed) {
      return;
    }
    this.current = next;
    for (const handler of [...this.stateHandlers]) {
      handler(next);
    }
  }

  private failPending(error: ActionError): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }

  private failSnapshots(error: ActionError): void {
    for (const waiter of this.snapshotWaiters.splice(0)) {
      waiter.reject(error);
    }
  }
}
