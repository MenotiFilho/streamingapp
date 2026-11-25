import { describe, expect, test } from "vitest";

import { explain, type ActionError } from "../core/errors";
import { Session } from "../core/session";
import type { LinkCapabilities, LinkContractFixture } from "../core/testing/linkContract";
import { describeLinkContract } from "../core/testing/linkContract";
import type { Action, Response, Title } from "../core/wire";
import {
  FakeHost,
  FakePage,
  ISSUED_TOKEN,
  NOW,
  PAIRING_CODE,
  PHONE,
  fakeLink,
  memoryTokens,
} from "./fakeSocket.testing";
import { LIVENESS } from "./liveness";
import { WebSocketLink } from "./websocketLink";

/** An Action the fake Host answers. */
const ACCEPTED: Action = { type: "preview", at: 12 };
/** An Action the fake Host refuses. */
const REFUSED: Action = { type: "set_volume", level: 999 };
const REFUSAL: ActionError = { kind: "invalid_volume", level: "999" };

/**
 * The link over the fake Host, as the contract builds it.
 *
 * The fixture starts paired: the token the store holds is the one the Host
 * knows, so the greeting lands on a Device and the state a new client is owed
 * is the Host's own.
 */
function socketFixture(): LinkContractFixture {
  const host = new FakeHost({
    known: { device: PHONE, token: ISSUED_TOKEN },
    refuses: { action: REFUSED, error: REFUSAL },
  });
  const link = new WebSocketLink({
    url: "ws://host/",
    tokens: memoryTokens(ISSUED_TOKEN),
    open: host.open,
    schedule: host.schedule,
    now: () => NOW,
    page: new FakePage(),
  });

  return {
    link,
    host: {
      accepts: ACCEPTED,
      refuses: { action: REFUSED, error: REFUSAL },
      snapshot: () => host.snapshot(),
      received: () => host.received(),
      answered: () => host.answered(),
      publish: () => host.publish(),
      connect: () => host.connect(),
      revoke: () => host.revoke(),
      release: () => host.release(),
    },
  };
}

/**
 * The Remote's link is the one adapter with the states the window never has:
 * it starts connecting, reconnects, and loses its pairing. The refusal it
 * declares moves no state — a refused command leaves a paired connection
 * paired — and a revoke is the case the pairing suite below covers in full.
 */
const CAPABILITIES: LinkCapabilities = {
  startsReady: false,
  paired: true,
  publishes: true,
  refuses: true,
  refusalMovesState: false,
  revokes: true,
};

describeLinkContract("WebSocketLink over a fake socket", socketFixture, CAPABILITIES);

describe("the Remote's link: pairing", () => {
  test("a greeting presents the token the Device was paired with", async () => {
    const { host, link, release } = fakeLink(
      { known: { device: PHONE, token: ISSUED_TOKEN } },
      ISSUED_TOKEN,
    );
    try {
      await host.connect();

      expect(host.helloToken()).toBe(ISSUED_TOKEN);
      expect(link.state()).toEqual({ kind: "ready", device: PHONE });
    } finally {
      release();
    }
  });

  test("a first connect with no token greets with none and asks for the code", async () => {
    const { host, link, release } = fakeLink();
    try {
      await host.connect();

      expect(host.helloToken()).toBeNull();
      const state = link.state();
      expect(state.kind).toBe("unpaired");
      if (state.kind === "unpaired") {
        expect(state.notice.length).toBeGreaterThan(0);
      }
    } finally {
      release();
    }
  });

  test("a pairing writes the token and hands back the Device alone", async () => {
    const { host, tokens, link, release } = fakeLink();
    try {
      await host.connect();

      const response = await link.dispatch({
        type: "pair_device",
        code: PAIRING_CODE,
        name: "Phone",
      });

      expect(host.received()).toContainEqual({
        type: "pair_device",
        code: PAIRING_CODE,
        name: "Phone",
      });
      // The token is the link's: it is written to the store, and the answer the
      // Session reads names the Device and carries no Device token.
      expect(tokens.held()).toBe(ISSUED_TOKEN);
      expect(response.answer).toEqual({ paired: { device: PHONE } });
      expect(JSON.stringify(response)).not.toContain(ISSUED_TOKEN);
      expect(link.state()).toEqual({ kind: "ready", device: PHONE });
    } finally {
      release();
    }
  });

  test("a refused pairing rejects as an ActionError and leaves the gate up", async () => {
    const { host, tokens, link, release } = fakeLink();
    try {
      await host.connect();

      await expect(
        link.dispatch({ type: "pair_device", code: "AAAAAA", name: "Phone" }),
      ).rejects.toEqual({ kind: "pairing" });
      expect(tokens.held()).toBeNull();
      expect(link.state().kind).toBe("unpaired");
    } finally {
      release();
    }
  });
});

describe("the Remote's link: a revised Title", () => {
  const REVISED: Title = {
    addon: "cinemeta",
    id: "tt1",
    key: { kind: "addon", addon: "cinemeta", id: "tt1" },
    type: "movie",
    name: "One, again",
    poster: null,
    background: null,
    logo: null,
    description: null,
    releaseInfo: null,
    runtime: null,
    imdbRating: null,
    genres: [],
    videos: [],
  };

  test("a revision on this socket arrives as the Title it revises", async () => {
    const { host, link, release } = fakeLink(
      { known: { device: PHONE, token: ISSUED_TOKEN } },
      ISSUED_TOKEN,
    );
    try {
      await host.connect();
      const seen: Title[] = [];
      const stop = link.onRevision((title) => seen.push(title));

      host.revise(REVISED);
      expect(seen).toEqual([REVISED]);

      stop();
      host.revise(REVISED);
      expect(seen, "an unsubscribed screen hears nothing more").toEqual([REVISED]);
    } finally {
      release();
    }
  });

  test("a payload that is not a revision is ignored rather than guessed at", async () => {
    const { host, link, release } = fakeLink(
      { known: { device: PHONE, token: ISSUED_TOKEN } },
      ISSUED_TOKEN,
    );
    try {
      await host.connect();
      const seen: Title[] = [];
      link.onRevision((title) => seen.push(title));

      host.socket()?.deliver({ version: 1, revision: { not: "a revision" } });
      expect(seen).toEqual([]);
    } finally {
      release();
    }
  });
});

describe("the Remote's link: staying connected", () => {
  test("a dropped socket reconnects with the token and catches up", async () => {
    const { host, link, release } = fakeLink(
      { known: { device: PHONE, token: ISSUED_TOKEN } },
      ISSUED_TOKEN,
    );
    try {
      await host.connect();
      expect(link.state()).toEqual({ kind: "ready", device: PHONE });

      host.drop();

      expect(link.state()).toEqual({
        kind: "reconnecting",
        attempt: 1,
        retryAt: NOW + 400,
      });

      host.flush();
      await host.connect();

      expect(host.socketCount()).toBe(2);
      expect(host.helloToken()).toBe(ISSUED_TOKEN);
      expect(link.state()).toEqual({ kind: "ready", device: PHONE });
      // The Host hands a reconnecting client the state as it stands.
      expect(await link.snapshot()).toEqual(await host.snapshot());
    } finally {
      release();
    }
  });

  test("a Device revoked mid-connection moves the link to the gate and forgets the token", async () => {
    const { host, tokens, link, release } = fakeLink(
      { known: { device: PHONE, token: ISSUED_TOKEN } },
      ISSUED_TOKEN,
    );
    try {
      await host.connect();
      expect(link.state().kind).toBe("ready");

      // The Host's own news, with no id: this connection is not paired any
      // more, and it says so before it hangs up.
      await host.revoke();

      const state = link.state();
      expect(state.kind).toBe("unpaired");
      if (state.kind === "unpaired") {
        expect(state.notice.length).toBeGreaterThan(0);
      }
      expect(tokens.held()).toBeNull();
    } finally {
      release();
    }
  });

  test("an Action taken while the socket is opening waits for it", async () => {
    const { host, link, release } = fakeLink(
      { known: { device: PHONE, token: ISSUED_TOKEN } },
      ISSUED_TOKEN,
    );
    try {
      // No `host.connect()`: the press is made while the browser is still
      // opening the socket, and it is sent rather than refused.
      const response: Response = await link.dispatch(ACCEPTED);

      expect(response).toEqual({ snapshots: [], answer: null });
      expect(host.received()).toEqual([ACCEPTED]);
    } finally {
      release();
    }
  });

  test("an Action after close rejects as unreachable", async () => {
    const { link, release } = fakeLink();
    link.close();

    await expect(link.dispatch(ACCEPTED)).rejects.toEqual({
      kind: "unreachable",
      detail: "the link is closed",
    });
    release();
  });

  test("close() stops a retry that was waiting", async () => {
    const { host, link, release } = fakeLink(
      { known: { device: PHONE, token: ISSUED_TOKEN } },
      ISSUED_TOKEN,
    );
    try {
      await host.connect();
      host.drop();
      expect(host.scheduled()).toBe(1);

      link.close();
      host.flush();

      expect(host.socketCount()).toBe(1);
      expect(link.state().kind).toBe("closed");
    } finally {
      release();
    }
  });

  test("a page and a Host on different versions stop rather than reconnect", async () => {
    const { host, link, release } = fakeLink(
      { known: { device: PHONE, token: ISSUED_TOKEN } },
      ISSUED_TOKEN,
    );
    try {
      await host.connect();
      host.socket()?.deliver({ version: 99, welcome: { device: null } });

      const state = link.state();
      expect(state.kind).toBe("closed");
      if (state.kind === "closed") {
        expect(state.reason).toContain("version");
      }
      expect(host.scheduled()).toBe(0);
    } finally {
      release();
    }
  });
});

describe("the Remote's link: a socket that only says it is open", () => {
  /** A Session over a paired link whose first socket is open and welcomed. */
  async function pairedPhone() {
    const fixture = fakeLink({ known: { device: PHONE, token: ISSUED_TOKEN } }, ISSUED_TOKEN);
    await fixture.host.connect();
    const session = new Session(fixture.link);
    const stop = session.start();
    return {
      ...fixture,
      session,
      release: () => {
        stop();
        fixture.release();
      },
    };
  }

  /** Let a press that is waiting on a socket's answer, or on a socket, move on. */
  async function settle(): Promise<void> {
    for (let turn = 0; turn < 10; turn += 1) {
      await Promise.resolve();
    }
  }

  const PLAY: Action = { type: "set_paused", paused: false };

  test("a phone that slept keeps a socket the Host still answers, and the press goes down it", async () => {
    // A locked phone's connection is usually still there when it wakes: the
    // page asks, the Host answers, and nothing is reconnected.
    const { host, link, page, clock, session, release } = await pairedPhone();
    try {
      const seen: string[] = [];
      link.onState((state) => seen.push(state.kind));
      page.hide();
      clock.advance(5 * 60_000);
      page.show();

      await session.take(PLAY);

      expect(host.socketCount(), "the socket is kept").toBe(1);
      expect(seen, "the page never says it is reconnecting").not.toContain("reconnecting");
      expect(host.received()).toContainEqual(PLAY);
      expect(session.getState().error).toBeNull();
    } finally {
      release();
    }
  });

  test("a phone that slept on a dead socket finds out at once, and a press made meanwhile goes down the new one", async () => {
    // The report: the Remote sat idle, the phone slept, and on waking the page
    // said Live while play spun and spun, until the socket finally closed.
    const { host, link, page, clock, session, release } = await pairedPhone();
    try {
      page.hide();
      host.stall();
      clock.advance(5 * 60_000);
      page.show();

      const pressed = session.take(PLAY);
      await settle();
      const asked = host.socket()?.sent ?? [];
      expect(
        asked.some((text) => text.includes('"command"')),
        "the press waits for the answer rather than going down a socket that may be dead",
      ).toBe(false);

      clock.advance(LIVENESS.probeWait);
      host.flush();
      expect(host.socketCount(), "silence is a dead socket").toBe(2);
      await host.connect();
      await pressed;

      expect(host.received()).toContainEqual(PLAY);
      expect(session.getState().pending.size, "nothing is left spinning").toBe(0);
      expect(session.getState().error).toBeNull();
      expect(link.state()).toEqual({ kind: "ready", device: PHONE });
    } finally {
      release();
    }
  });

  test("a page looked at again soon asks at once, and a socket that does not answer is replaced", async () => {
    const { host, link, page, clock, release } = await pairedPhone();
    try {
      page.hide();
      clock.advance(5_000);
      host.stall();
      const greeted = host.greetings();
      page.show();

      expect(host.greetings(), "the page asks the moment it is looked at").toBe(greeted + 1);
      expect(host.socketCount()).toBe(1);

      clock.advance(LIVENESS.probeWait);
      host.flush();

      expect(host.socketCount(), "silence is a dead socket").toBe(2);
      await host.connect();
      expect(link.state()).toEqual({ kind: "ready", device: PHONE });
    } finally {
      release();
    }
  });

  test("the link tells the Host why it let a socket go", async () => {
    // The Host logs the reason a device gives, so a phone that keeps
    // reconnecting can be read about rather than guessed at.
    const { host, page, clock, release } = await pairedPhone();
    try {
      const first = host.socket();
      host.stall();
      page.hide();
      page.show();
      clock.advance(LIVENESS.probeWait);
      host.flush();

      expect(first?.closedWith?.code).toBe(4000);
      expect(first?.closedWith?.reason).toContain("no answer");
    } finally {
      release();
    }
  });

  test("a press made while the link reconnects waits for the new socket", async () => {
    // A press that failed with "could not reach the Host" while the link was
    // already on its way back was the other half of the report.
    const { host, link, session, release } = await pairedPhone();
    try {
      host.drop();
      expect(link.state().kind).toBe("reconnecting");

      const pressed = session.take(PLAY);
      await settle();
      expect(session.getState().error, "not refused while the link comes back").toBeNull();

      host.flush();
      await host.connect();
      await pressed;

      expect(host.received()).toContainEqual(PLAY);
      expect(session.getState().error).toBeNull();
    } finally {
      release();
    }
  });

  test("a press waits a few seconds for the Host, then is refused in words", async () => {
    const { host, clock, session, release } = await pairedPhone();
    try {
      host.holdOpens();
      host.drop();

      const pressed = session.take(PLAY);
      await settle();
      clock.advance(LIVENESS.holdPress);
      host.flush();
      await pressed;

      const error = session.getState().error;
      expect(error && explain(error)).toBe(
        "The window could not reach the Host: the Host is not connected.",
      );
    } finally {
      release();
    }
  });

  test("a socket that answers the question is kept", async () => {
    const { host, link, page, clock, release } = await pairedPhone();
    try {
      page.hide();
      clock.advance(5_000);
      page.show();
      clock.advance(LIVENESS.probeWait);
      host.flush();

      expect(host.socketCount()).toBe(1);
      expect(link.state()).toEqual({ kind: "ready", device: PHONE });
    } finally {
      release();
    }
  });

  test("a press on a socket that stopped answering is refused in the link's own words, not left spinning", async () => {
    const { host, link, clock, session, release } = await pairedPhone();
    try {
      host.stall();
      const pressed = session.take(PLAY);
      await settle();
      expect(session.getState().pending.size).toBe(1);

      // A press in flight may be a slow question on a busy Host, so the link
      // waits longer than it would for an idle socket — but not for ever.
      clock.advance(LIVENESS.deadAfter);
      host.flush();
      expect(host.socketCount()).toBe(1);

      clock.advance(LIVENESS.deadWhileAskingAfter - LIVENESS.deadAfter);
      host.flush();
      await pressed;

      expect(host.socketCount()).toBe(2);
      expect(session.getState().pending.size).toBe(0);
      const error = session.getState().error;
      expect(error && explain(error)).toBe(
        "The window could not reach the Host: the Host stopped answering.",
      );
      // The replacement was opened at once rather than after a backoff, and is
      // already the Host's again.
      await host.connect();
      expect(link.state()).toEqual({ kind: "ready", device: PHONE });
    } finally {
      release();
    }
  });

  test("a press in flight when the socket closes is explained in words, not as [object Object]", async () => {
    const { host, session, release } = await pairedPhone();
    try {
      host.stall();
      const pressed = session.take(PLAY);
      await settle();
      host.drop();
      await pressed;

      const error = session.getState().error;
      expect(error && explain(error)).toBe(
        "The window could not reach the Host: the Host is not connected.",
      );
    } finally {
      release();
    }
  });

  test("a quiet Host is greeted, and a socket silent past the bound is replaced", async () => {
    const { host, clock, release } = await pairedPhone();
    try {
      host.stall();
      const greeted = host.greetings();

      clock.advance(LIVENESS.greetAfter);
      host.flush();
      expect(host.greetings(), "the link asks the Host to say something").toBe(greeted + 1);
      expect(host.socketCount()).toBe(1);

      clock.advance(LIVENESS.deadAfter - LIVENESS.greetAfter);
      host.flush();
      expect(host.socketCount()).toBe(2);
    } finally {
      release();
    }
  });

  test("a quiet Host that answers its greeting keeps its socket", async () => {
    const { host, link, clock, release } = await pairedPhone();
    try {
      clock.advance(LIVENESS.greetAfter);
      host.flush();
      clock.advance(LIVENESS.deadAfter - LIVENESS.greetAfter);
      host.flush();

      expect(host.socketCount()).toBe(1);
      expect(link.state()).toEqual({ kind: "ready", device: PHONE });
    } finally {
      release();
    }
  });

  test("a hidden page is neither greeted nor reconnected by the clock", async () => {
    // A locked phone is not woken by its own page: looking at it again is what
    // decides.
    const { host, page, clock, release } = await pairedPhone();
    try {
      page.hide();
      host.stall();
      const greeted = host.greetings();
      clock.advance(10 * 60_000);
      host.flush();

      expect(host.greetings()).toBe(greeted);
      expect(host.socketCount()).toBe(1);
    } finally {
      release();
    }
  });

  test("a page looked at while a retry waits connects at once", async () => {
    const { host, link, page, release } = await pairedPhone();
    try {
      host.drop();
      expect(link.state().kind).toBe("reconnecting");

      page.show();
      expect(host.socketCount(), "no backoff left to wait out").toBe(2);
      await host.connect();
      expect(link.state()).toEqual({ kind: "ready", device: PHONE });
    } finally {
      release();
    }
  });

  test("a socket that never opens is given up on and tried again", async () => {
    const { host, link, release } = await pairedPhone();
    try {
      host.holdOpens();
      host.drop();
      host.flush();
      expect(host.socketCount()).toBe(2);
      await host.connect();
      expect(link.state().kind, "the second socket is still opening").toBe("reconnecting");

      host.flush();
      expect(host.socket()?.closed, "the attempt that never opened is closed").toBe(true);
      expect(host.scheduled(), "and another is booked").toBe(1);
    } finally {
      release();
    }
  });

  test("a closed link stops following the page", async () => {
    const { link, page, release } = await pairedPhone();
    try {
      expect(page.following()).toBe(1);
      link.close();
      expect(page.following()).toBe(0);
    } finally {
      release();
    }
  });
});
