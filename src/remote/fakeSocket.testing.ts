import type { ActionError } from "../core/errors";
import { ACTION_VERSION } from "../core/wire";
import type { Action, DeviceSummary, Response, Snapshot, Title } from "../core/wire";
import type { TokenStore } from "./tokenStore";
import { WebSocketLink } from "./websocketLink";
import type { Schedule, SocketFactory, SocketLike } from "./websocketLink";

/**
 * The wire Host and the browser's socket, faked (ADR-0032).
 *
 * The link's conversation is what the suites are about, so both ends of it are
 * here: a socket the link can hold, and a Host that speaks the protocol's four
 * frames over it. Nothing opens a network connection, and the retry queue is
 * hand-cranked so a reconnect is a fact a test decides rather than a wait.
 */

/** A Device a Host has paired. */
export const PHONE: DeviceSummary = {
  id: "device-1",
  name: "Phone",
  pairedAt: 1_700_000_000_000,
};

/** The token a pairing issues: forty-three characters, as the Host mints them. */
export const ISSUED_TOKEN = "a".repeat(43);

/** The code the fake Host is showing. */
export const PAIRING_CODE = "4K7Q2M";

/** The clock every case measures a retry by. */
export const NOW = 1_000;

/** A Host with nothing playing: the state a paired client is owed. */
export const NOTHING: Snapshot = {
  revision: 1,
  playback: {
    state: "idle",
    picture: "in_window",
    failure: null,
    nowPlaying: null,
    episode: null,
    position: null,
    duration: null,
    buffered: null,
    tracks: [],
    chapters: [],
    chapter: null,
    speed: null,
    volume: null,
    muted: null,
    subtitleDelay: null,
    crop: null,
    aspect: null,
    resolution: null,
    statistics: null,
  },
  preferences: {
    subtitleLanguage: null,
    subtitleColor: "#FFFFFF",
    subtitleScale: 1,
    streamBuffer: { seconds: 300, megabytes: 512 },
  },
  addons: [],
  featuredCatalog: null,
  protection: { backend: "file", tmdbHeld: false, stremioHeld: false },
  continueWatching: [],
  watchProgress: [],
  devices: [],
  pairingCode: PAIRING_CODE,
  address: null,
};

export type FakeHostOptions = {
  /** The state the Host holds. */
  snapshot?: Snapshot;
  /** A Device already paired, and the token that names it. */
  known?: { device: DeviceSummary; token: string };
  /** The Device a successful pairing issues. */
  pairedDevice?: DeviceSummary;
  /** The Action this Host refuses, and the failure it refuses with. */
  refuses?: { action: Action; error: ActionError };
};

/** One socket the fake Host answered on. */
export class FakeSocket implements SocketLike {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  /** Every frame the link wrote, as text. */
  readonly sent: string[] = [];
  closed = false;
  opened = false;

  constructor(
    readonly url: string,
    private readonly host: FakeHost,
  ) {}

  /** Deliver the browser's `open`, once. */
  open(): void {
    if (this.closed || this.opened) {
      return;
    }
    this.opened = true;
    this.onopen?.();
  }

  send(data: string): void {
    if (this.closed) {
      throw new Error("the socket is closed");
    }
    this.sent.push(data);
    this.host.receive(this, data);
  }

  close(): void {
    this.shut();
  }

  /** Close from the Host's side, as a dropped connection does. */
  shut(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.onclose?.();
  }

  /** Deliver one frame to the link. */
  deliver(frame: unknown): void {
    if (this.closed) {
      return;
    }
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
}

/**
 * The Host's end of the wire: a greeting, commands, pushed Snapshots.
 *
 * It answers the way `host-wire` does — a welcome with the Device a token names
 * or nothing, a Snapshot to a paired connection, a correlated reply or refusal,
 * and an id-less refusal when a pairing is taken away — so a suite exercises the
 * link's reading of the protocol rather than a mock of the link's own methods.
 */
export class FakeHost {
  readonly schedule: Schedule;
  readonly open: SocketFactory;

  private readonly sockets: FakeSocket[] = [];
  private readonly actions: Action[] = [];
  private readonly answers: Response[] = [];
  private readonly timers = new Map<number, () => void>();
  private nextTimer = 1;
  private held: Snapshot;
  private knownDevice: DeviceSummary | null;
  private knownToken: string | null;
  private readonly pairedDevice: DeviceSummary;
  private readonly refuses: FakeHostOptions["refuses"];

  constructor(options: FakeHostOptions = {}) {
    this.held = options.snapshot ?? NOTHING;
    this.knownDevice = options.known?.device ?? null;
    this.knownToken = options.known?.token ?? null;
    this.pairedDevice = options.pairedDevice ?? PHONE;
    this.refuses = options.refuses;

    this.schedule = (_delay, run) => {
      const id = this.nextTimer;
      this.nextTimer += 1;
      this.timers.set(id, run);
      return () => {
        this.timers.delete(id);
      };
    };

    this.open = (url) => {
      const socket = new FakeSocket(url, this);
      this.sockets.push(socket);
      // A browser's `open` is never delivered inside the constructor: the
      // socket is created now and answers on a later turn.
      queueMicrotask(() => socket.open());
      return socket;
    };
  }

  /** Let the pending turn run, so a socket that was just created has opened. */
  async connect(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
  }

  /** The newest socket, or nothing before the first connect. */
  socket(): FakeSocket | null {
    return this.sockets.at(-1) ?? null;
  }

  /** How many sockets the link has asked for. */
  socketCount(): number {
    return this.sockets.length;
  }

  /** The Actions the Host has been sent, in the order it read them. */
  received(): readonly Action[] {
    return this.actions;
  }

  /** The answers the Host gave, in the order it gave them. */
  answered(): readonly Response[] {
    return this.answers;
  }

  /** The state as it stands. */
  snapshot(): Promise<Snapshot> {
    return Promise.resolve(this.held);
  }

  /** Publish one more Snapshot of the Host's own, and say which one it sent. */
  async publish(): Promise<Snapshot> {
    await this.connect();
    this.held = { ...this.held, revision: this.held.revision + 1 };
    this.socket()?.deliver({ version: ACTION_VERSION, snapshot: this.held });
    return this.held;
  }

  /** Send one revised Answer to the newest socket, as a background refresh does. */
  revise(title: Title): void {
    this.socket()?.deliver({
      version: ACTION_VERSION,
      revision: { revision: title },
    });
  }

  /** Take this client's pairing away, the way a revoke does: refuse, then hang up. */
  async revoke(): Promise<void> {
    await this.connect();
    const socket = this.socket();
    socket?.deliver({ version: ACTION_VERSION, error: { kind: "unpaired" } });
    socket?.shut();
  }

  /** Drop the connection, as a phone's radio does. */
  drop(): void {
    this.socket()?.shut();
  }

  /** The token of the first greeting on the newest socket, or nothing. */
  helloToken(): string | null {
    const socket = this.socket();
    if (!socket) {
      return null;
    }
    for (const text of socket.sent) {
      const frame = JSON.parse(text) as { hello?: { token: string | null } };
      if (frame.hello) {
        return frame.hello.token ?? null;
      }
    }
    return null;
  }

  /** How many retries are waiting for their turn. */
  scheduled(): number {
    return this.timers.size;
  }

  /** Run every waiting retry now. */
  flush(): void {
    for (const [id, run] of [...this.timers]) {
      this.timers.delete(id);
      run();
    }
  }

  /** Let the fixture go, however the case ended. */
  release(): void {
    this.timers.clear();
    for (const socket of this.sockets) {
      socket.closed = true;
    }
  }

  /** One frame from the link. Public because the socket holds the other end. */
  receive(socket: FakeSocket, text: string): void {
    let frame: unknown;
    try {
      frame = JSON.parse(text);
    } catch {
      return;
    }
    if (typeof frame !== "object" || frame === null) {
      return;
    }
    const held = frame as {
      id?: number;
      hello?: { token: string | null };
      command?: Action;
    };

    if (held.hello) {
      const token = held.hello.token ?? null;
      const device =
        token !== null && token === this.knownToken ? this.knownDevice : null;
      socket.deliver({ version: ACTION_VERSION, welcome: { device } });
      if (device) {
        socket.deliver({ version: ACTION_VERSION, snapshot: this.held });
      }
      return;
    }

    if (typeof held.id !== "number" || !held.command) {
      return;
    }
    const action = held.command;
    this.actions.push(action);

    if (action.type === "pair_device") {
      if (action.code === PAIRING_CODE) {
        this.knownDevice = this.pairedDevice;
        this.knownToken = ISSUED_TOKEN;
        this.reply(socket, held.id, {
          snapshots: [],
          answer: {
            paired: { device: this.pairedDevice, token: ISSUED_TOKEN },
          },
        } as unknown as Response);
      } else {
        this.refuse(socket, held.id, { kind: "pairing" });
      }
      return;
    }

    if (
      this.refuses &&
      JSON.stringify(this.refuses.action) === JSON.stringify(action)
    ) {
      this.refuse(socket, held.id, this.refuses.error);
      return;
    }

    this.reply(socket, held.id, { snapshots: [], answer: null });
  }

  private reply(socket: FakeSocket, id: number, response: Response): void {
    this.answers.push(response);
    socket.deliver({ version: ACTION_VERSION, id, response });
  }

  private refuse(socket: FakeSocket, id: number, error: ActionError): void {
    socket.deliver({ version: ACTION_VERSION, id, error });
  }
}

/** A TokenStore with no storage behind it, and what it holds for the assertions. */
export function memoryTokens(initial: string | null = null): TokenStore & {
  held: () => string | null;
} {
  let token = initial;
  return {
    read: () => token,
    write: (next) => {
      token = next;
    },
    clear: () => {
      token = null;
    },
    held: () => token,
  };
}

/**
 * A link over the fake Host, and the two things a case lets go of.
 *
 * The scheduler is the fake's own, so a reconnect is a fact a test decides: a
 * drop puts the link in `reconnecting` and nothing moves until `host.flush()`.
 */
export function fakeLink(
  options: FakeHostOptions = {},
  token: string | null = null,
): {
  host: FakeHost;
  tokens: ReturnType<typeof memoryTokens>;
  link: WebSocketLink;
  release: () => void;
} {
  const host = new FakeHost(options);
  const tokens = memoryTokens(token);
  const link = new WebSocketLink({
    url: "ws://host/",
    tokens,
    open: host.open,
    schedule: host.schedule,
    now: () => NOW,
  });

  return {
    host,
    tokens,
    link,
    release: () => {
      link.close();
      host.release();
    },
  };
}
