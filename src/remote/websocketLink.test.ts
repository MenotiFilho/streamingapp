import { describe, expect, test } from "vitest";

import type { ActionError } from "../core/errors";
import type { LinkCapabilities, LinkContractFixture } from "../core/testing/linkContract";
import { describeLinkContract } from "../core/testing/linkContract";
import type { Action, Response } from "../core/wire";
import {
  FakeHost,
  ISSUED_TOKEN,
  NOW,
  PAIRING_CODE,
  PHONE,
  fakeLink,
  memoryTokens,
} from "./fakeSocket.testing";
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
