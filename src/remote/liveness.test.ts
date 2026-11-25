import { describe, expect, test } from "vitest";

import { LIVENESS, onTick, onWake, type TickFacts, type WakeFacts } from "./liveness";

/** A paired, open, idle link: what most cases change one fact of. */
const AWAKE: WakeFacts = { socket: "open", ready: true, asking: 0 };

const QUIET: TickFacts = {
  hidden: false,
  socket: "open",
  ready: true,
  asking: 0,
  quietFor: 0,
  sinceGreeting: 0,
};

describe("a page looked at again", () => {
  test("asks the Host at once whether its socket is still there, however long it was away", () => {
    // Replacing a socket the page had been away from for long made every
    // unlock a reconnect, though the socket was usually still good: the Host
    // keeps a sleeping phone's connection, and asking costs one round trip.
    expect(onWake(AWAKE)).toBe("probe");
  });

  test("does not ask while a command is on its way", () => {
    // The Host answers one frame at a time: a greeting queued behind a slow
    // question is not late, and a deadline would call it dead.
    expect(onWake({ ...AWAKE, asking: 1 })).toBe("none");
  });

  test("does not greet a connection that has not paired", () => {
    // A greeting there would race a pairing and could undo it.
    expect(onWake({ ...AWAKE, ready: false })).toBe("none");
  });

  test("connects at once when it holds no socket, and leaves an opening one alone", () => {
    expect(onWake({ ...AWAKE, socket: "none" })).toBe("connect");
    expect(onWake({ ...AWAKE, socket: "opening" })).toBe("none");
  });

  test("gives a waking phone time to answer", () => {
    // A phone's radio takes a moment to come back from sleep, and the Host may
    // be finishing a write; a second and a half called live sockets dead.
    expect(LIVENESS.probeWait).toBeGreaterThanOrEqual(3_000);
  });
});

describe("the link's own clock", () => {
  test("greets a quiet Host so there is something to hear", () => {
    expect(onTick({ ...QUIET, quietFor: LIVENESS.greetAfter - 1 })).toBe("none");
    expect(
      onTick({
        ...QUIET,
        quietFor: LIVENESS.greetAfter,
        sinceGreeting: LIVENESS.greetAfter,
      }),
    ).toBe("greet");
    expect(
      onTick({ ...QUIET, quietFor: LIVENESS.greetAfter + 5_000, sinceGreeting: 5_000 }),
      "one greeting per quiet spell, not one per tick",
    ).toBe("none");
  });

  test("replaces a socket that stays silent after it was greeted", () => {
    expect(
      onTick({ ...QUIET, quietFor: LIVENESS.deadAfter, sinceGreeting: 15_000 }),
    ).toBe("replace");
  });

  test("waits longer while a command is on its way, and does not greet", () => {
    // An Addon may take its whole fetch timeout, and the Host reads the
    // connection's frames in order: silence while asking is often a busy Host.
    expect(
      onTick({
        ...QUIET,
        asking: 2,
        quietFor: LIVENESS.deadAfter,
        sinceGreeting: LIVENESS.deadAfter,
      }),
    ).toBe("none");
    expect(onTick({ ...QUIET, asking: 2, quietFor: LIVENESS.deadWhileAskingAfter })).toBe(
      "replace",
    );
  });

  test("leaves a hidden page, an opening socket and an unpaired idle one alone", () => {
    const silent = { ...QUIET, quietFor: 10 * 60_000, sinceGreeting: 10 * 60_000 };
    expect(onTick({ ...silent, hidden: true }), "a hidden page waits to be looked at").toBe(
      "none",
    );
    expect(onTick({ ...silent, socket: "opening" })).toBe("none");
    expect(onTick({ ...silent, socket: "none" })).toBe("none");
    expect(
      onTick({ ...silent, ready: false }),
      "the Host pushes nothing to the gate, so its silence says nothing",
    ).toBe("none");
    expect(
      onTick({ ...silent, ready: false, asking: 1 }),
      "a pairing that never comes back is a dead socket all the same",
    ).toBe("replace");
  });
});
