/**
 * How the served Remote tells a socket the Host is on from one that only says so.
 *
 * A browser keeps a WebSocket OPEN long after the far end has gone: a phone's
 * radio slept, the Host hung up on a page that had been frozen, the Host's
 * machine went to sleep. The browser answers the Host's pings itself, so the page
 * never sees them, and nothing fires until the phone's own network stack gives
 * up, which can be minutes. Until then the page says it is live and every press
 * waits for an answer that is never coming.
 *
 * So the link judges by what it hears. Any frame is proof the Host is there, a
 * greeting asks for one (the Host answers it with a Welcome and the state as it
 * stands, ADR-0017 §7), and silence past a bound is a dead socket, replaced by a
 * new one. These are those decisions, kept apart from the socket so a suite can
 * state them as facts; `WebSocketLink` holds the clock and the socket and acts
 * on them.
 */

export const LIVENESS = {
  /** A socket that has not opened by now is given up on and tried again. */
  openWithin: 8_000,
  /** How often the link looks at how long it has been quiet. */
  tick: 5_000,
  /** Quiet this long, the link greets the Host so it has something to hear. */
  greetAfter: 12_000,
  /** Quiet this long with nothing asked, the socket is dead. */
  deadAfter: 30_000,
  /**
   * Quiet this long while a command is on its way. The Host reads one frame at
   * a time on a connection, and an Addon may take its whole 30-second fetch
   * timeout, so a busy Host and a dead socket look alike for longer.
   */
  deadWhileAskingAfter: 90_000,
  /** A page looked at again greets at once, and the answer must come this soon. */
  probeWait: 1_500,
  /**
   * Out of sight this long, the socket is replaced rather than asked. The Host
   * hangs up on a page that has not answered its pings for a minute, and a page
   * that slept through playback holds a backlog of stale Snapshots that would
   * read as an answer — the press made after it would go down a socket the Host
   * is about to close.
   */
  replaceAfterHidden: 30_000,
} as const;

/** The socket as the link holds it. */
export type SocketHeld = "open" | "opening" | "none";

/**
 * What the link does about its socket.
 *
 * `probe` greets and replaces the socket if nothing answers within
 * `probeWait`; `connect` opens a socket now rather than waiting out the
 * backoff of a retry that is already booked.
 */
export type LivenessMove = "none" | "greet" | "probe" | "replace" | "connect";

/** What the link knows when the page is looked at again, or the network returns. */
export type WakeFacts = {
  /**
   * How long the socket in hand was out of sight — since the page was put
   * away, or since the socket opened if it opened later — or null when the
   * page had not been put away.
   */
  hiddenFor: number | null;
  socket: SocketHeld;
  /** Whether the connection is paired: only a paired one is greeted. */
  ready: boolean;
  /** How many commands are on their way. */
  asking: number;
};

/**
 * The page is in front of a person again (or the network came back): decide
 * before they press anything.
 */
export function onWake(facts: WakeFacts): LivenessMove {
  if (facts.socket === "none") {
    return "connect";
  }
  if (facts.socket === "opening") {
    return "none";
  }
  if (facts.hiddenFor !== null && facts.hiddenFor >= LIVENESS.replaceAfterHidden) {
    return "replace";
  }
  // A greeting on an unpaired connection could land behind a pairing and undo
  // it, and one queued behind a command in flight is late without being lost.
  if (facts.ready && facts.asking === 0) {
    return "probe";
  }
  return "none";
}

/** What the link knows each time its own clock comes round. */
export type TickFacts = {
  /** Whether the page is out of sight: a hidden page waits to be looked at. */
  hidden: boolean;
  socket: SocketHeld;
  ready: boolean;
  asking: number;
  /** How long since the last frame the Host sent. */
  quietFor: number;
  /** How long since the link last greeted the Host. */
  sinceGreeting: number;
};

/** The link's clock came round: greet a quiet Host, replace a silent socket. */
export function onTick(facts: TickFacts): LivenessMove {
  if (facts.hidden || facts.socket !== "open") {
    return "none";
  }
  if (facts.asking > 0) {
    return facts.quietFor >= LIVENESS.deadWhileAskingAfter ? "replace" : "none";
  }
  // The Host pushes nothing to a connection that has not paired, and the gate
  // is not greeted (see `onWake`), so its silence is not evidence of anything.
  if (!facts.ready) {
    return "none";
  }
  if (facts.quietFor >= LIVENESS.deadAfter) {
    return "replace";
  }
  if (
    facts.quietFor >= LIVENESS.greetAfter &&
    facts.sinceGreeting >= LIVENESS.greetAfter
  ) {
    return "greet";
  }
  return "none";
}
