import { describe, expect, test } from "vitest";

import { LIVENESS, onTick, onWake, type TickFacts, type WakeFacts } from "./liveness";

/** A paired, open, idle link: what most cases change one fact of. */
const AWAKE: WakeFacts = { hiddenFor: null, socket: "open", ready: true, asking: 0 };

const QUIET: TickFacts = {
  hidden: false,
  socket: "open",
  ready: true,
  asking: 0,
  quietFor: 0,
  sinceGreeting: 0,
};

describe("a page looked at again", () => {
  test("asks the Host at once whether its socket is still there", () => {
    expect(onWake({ ...AWAKE, hiddenFor: 5_000 })).toBe("probe");
    expect(onWake(AWAKE), "the network coming back asks too").toBe("probe");
  });

  test("replaces a socket it was away from for long, rather than asking it", () => {
    // The Host hangs up on a page that has not answered its pings for a
    // minute, and a page that slept through playback holds a backlog of
    // stale Snapshots that would read as an answer to the question.
    expect(onWake({ ...AWAKE, hiddenFor: LIVENESS.replaceAfterHidden })).toBe("replace");
    expect(onWake({ ...AWAKE, hiddenFor: LIVENESS.replaceAfterHidden - 1 })).toBe("probe");
    expect(
      onWake({ ...AWAKE, hiddenFor: 10 * 60_000, ready: false }),
      "the pairing gate's socket slept as long",
    ).toBe("replace");
    expect(
      onWake({ ...AWAKE, hiddenFor: 10 * 60_000, asking: 1 }),
      "a command sent before the sleep is not news a socket can still carry",
    ).toBe("replace");
  });

  test("does not ask while a command is on its way", () => {
    // The Host answers one frame at a time: a greeting queued behind a slow
    // question is not late, and a short deadline would call it dead.
    expect(onWake({ ...AWAKE, hiddenFor: 5_000, asking: 1 })).toBe("none");
  });

  test("does not greet a connection that has not paired", () => {
    // A greeting there would race a pairing and could undo it.
    expect(onWake({ ...AWAKE, hiddenFor: 5_000, ready: false })).toBe("none");
  });

  test("connects at once when it holds no socket, and leaves an opening one alone", () => {
    expect(onWake({ ...AWAKE, socket: "none" })).toBe("connect");
    expect(onWake({ ...AWAKE, socket: "none", hiddenFor: 10 * 60_000 })).toBe("connect");
    expect(onWake({ ...AWAKE, socket: "opening", hiddenFor: 10 * 60_000 })).toBe("none");
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
