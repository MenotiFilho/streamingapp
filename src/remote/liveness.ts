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
   * Quiet this long while a command is on its way. Questions resolve off the
   * Host's connection thread so a greeting is answered promptly even behind a
   * slow Addon, while a slow Change (such as adding an Addon or resuming across
   * Addons) still runs on it up to the 30-second fetch timeout.
   */
  deadWhileAskingAfter: 45_000,
  /**
   * A page looked at again greets at once, and something must come back this
   * soon. Generous, because a phone's radio takes a moment to come back from
   * sleep; a press made meanwhile waits for the answer rather than failing.
   */
  probeWait: 3_000,
  /**
   * How long a press waits for a socket that is opening, reconnecting or being
   * asked, before it is refused. A press is better late by a moment than
   * refused while the link is already on its way back.
   */
  holdPress: 8_000,
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
  socket: SocketHeld;
  /** Whether the connection is paired: only a paired one is greeted. */
  ready: boolean;
  /** How many commands are on their way. */
  asking: number;
};

/**
 * The page is in front of a person again (or the network came back): decide
 * before they press anything.
 *
 * However long it was away, the socket is asked rather than replaced. The Host
 * keeps a sleeping phone's connection, so it is usually still good, and
 * replacing it anyway made every unlock a reconnect.
 */
export function onWake(facts: WakeFacts): LivenessMove {
  if (facts.socket === "none") {
    return "connect";
  }
  if (facts.socket === "opening") {
    return "none";
  }
  // A greeting on an unpaired connection could land behind a pairing and undo
  // it, and a Change in flight on the connection thread can exceed `probeWait`.
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
  const deadAfter =
    facts.asking > 0 ? LIVENESS.deadWhileAskingAfter : LIVENESS.deadAfter;
  // The Host pushes nothing to a connection that has not paired, and the gate
  // is not greeted (see `onWake`), so its silence is not evidence of anything —
  // unless a pairing attempt itself never comes back.
  if (!facts.ready && facts.asking === 0) {
    return "none";
  }
  if (facts.quietFor >= deadAfter) {
    return "replace";
  }
  if (
    facts.ready &&
    facts.quietFor >= LIVENESS.greetAfter &&
    facts.sinceGreeting >= LIVENESS.greetAfter
  ) {
    return "greet";
  }
  return "none";
}
