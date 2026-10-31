import { describe, expect, test } from "vitest";

import { asActionError } from "../errors";
import type { ActionError } from "../errors";
import type { HostLink, LinkState } from "../link";
import type { Action, Response, Snapshot } from "../wire";

/**
 * One Host a contract run can drive, and what it owes the link over it.
 *
 * The link is the thing under test; the Host behind it is the fixture's own —
 * a fake transport, the preview's rehearsal host, or B1's fake socket. Every
 * fixture declares the Action its Host takes and the one it refuses, so the
 * same cases run over the window's link and, later, over the Remote's.
 */
export type LinkContractHost = {
  /** An Action this Host takes. */
  accepts: Action;
  /** An Action this Host refuses, and the failure it refuses with. */
  refuses?: { action: Action; error: ActionError };
  /** The Snapshot the Host holds now — what `snapshot()` is owed to resolve. */
  snapshot(): Promise<Snapshot>;
  /** The Actions the Host has been sent, in the order it read them. */
  received(): readonly Action[];
  /** The answers the Host gave, in the order it gave them. */
  answered(): readonly Response[];
  /**
   * Make the Host publish one more Snapshot of its own, and say which one it
   * sent. Absent where the Host only answers Actions.
   */
  publish?: () => Promise<Snapshot>;
  /** Let the connection finish where it starts `connecting`. */
  connect?: () => Promise<void>;
  /** Take this client's pairing away, so the link must stop being `ready`. */
  revoke?: () => Promise<void>;
  /** Let the fixture go, however the case ended. */
  release?: () => void;
};

/** A link and the Host behind it, made fresh for one case. */
export type LinkContractFixture = {
  link: HostLink;
  host: LinkContractHost;
};

/**
 * What this link and this Host can actually do.
 *
 * The window's link is always ready over a paired Host; the served Remote's
 * link connects, reconnects and loses its pairing. A case that only makes sense
 * for one of them is gated rather than faked, so the run over each adapter says
 * what it proved.
 */
export type LinkCapabilities = {
  /** The link starts `ready`; `false` where it starts `connecting`. */
  startsReady: boolean;
  /** `snapshot()` is owed, because the connection is paired. */
  paired: boolean;
  /** The Host publishes Snapshots of its own, after the first. */
  publishes: boolean;
  /** The Host refuses an Action, which the fixture declares. */
  refuses: boolean;
  /** A refusal moves the link's state as well as rejecting the Action. */
  refusalMovesState: boolean;
  /** The Host can take this pairing away, and the link must report it. */
  revokes: boolean;
};

/** The first state the link reports that `match` names, now or on the next change. */
function until(
  link: HostLink,
  match: (state: LinkState) => boolean,
): Promise<LinkState> {
  if (match(link.state())) {
    return Promise.resolve(link.state());
  }
  return new Promise((resolve) => {
    const stop = link.onState((state) => {
      if (match(state)) {
        stop();
        resolve(state);
      }
    });
  });
}

/**
 * The cases every `HostLink` owes its client, run against one adapter.
 *
 * Parameterised by a factory rather than by a class: B1's `WebSocketLink` runs
 * the same cases over a fake socket, with `startsReady: false`, `revokes: true`,
 * and whatever else its connection can do. A case outside the adapter's
 * capability set is skipped, not passed quietly.
 */
export function describeLinkContract(
  name: string,
  open: () => LinkContractFixture,
  capabilities: LinkCapabilities,
): void {
  describe(`the HostLink contract: ${name}`, () => {
    /** Build the link, run the case, and let the fixture go however it ended. */
    async function withLink(
      run: (fixture: LinkContractFixture) => Promise<void>,
    ): Promise<void> {
      const fixture = open();
      try {
        await run(fixture);
      } finally {
        fixture.link.close();
        fixture.host.release?.();
      }
    }

    test("state() starts where the connection is", async () => {
      await withLink(async ({ link, host }) => {
        if (capabilities.startsReady) {
          expect(link.state()).toEqual({ kind: "ready", device: null });
          return;
        }

        expect(link.state().kind).toBe("connecting");
        expect(host.connect).toBeDefined();
        await host.connect?.();
        await until(link, (state) => state.kind === "ready");
        expect(link.state()).toMatchObject({ kind: "ready" });
      });
    });

    test.skipIf(!capabilities.paired)(
      "snapshot() resolves the state a new client is owed",
      async () => {
        await withLink(async ({ link, host }) => {
          expect(await link.snapshot()).toEqual(await host.snapshot());
        });
      },
    );

    test.skipIf(capabilities.paired)(
      "snapshot() never settles for an unpaired link",
      async () => {
        await withLink(async ({ link }) => {
          // An unpaired link has no state to hand over and owes no promise that
          // cannot settle: it stays pending until the pairing (or the close)
          // arrives (#190 §2).
          const settled = await Promise.race([
            link.snapshot().then(
              () => "resolved",
              () => "rejected",
            ),
            new Promise<string>((resolve) => {
              setTimeout(() => resolve("pending"), 0);
            }),
          ]);

          expect(settled).toBe("pending");
        });
      },
    );

    test("one dispatch is answered once, and the Host reads the Action once", async () => {
      await withLink(async ({ link, host }) => {
        const response = await link.dispatch(host.accepts);

        expect(host.received()).toEqual([host.accepts]);
        expect(host.answered()).toEqual([response]);
      });
    });

    test.skipIf(!capabilities.refuses)(
      "a refusal rejects as an ActionError",
      async () => {
        await withLink(async ({ link, host }) => {
          const refused = host.refuses;
          if (!refused) {
            throw new Error("the fixture promised a refusal and declared none");
          }

          const caught = await link.dispatch(refused.action).then(
            () => {
              throw new Error("the Host answered an Action it was to refuse");
            },
            (error: unknown) => error,
          );

          expect(asActionError(caught)).toEqual(refused.error);
          expect(host.received()).toEqual([refused.action]);
        });
      },
    );

    test.skipIf(!capabilities.refusalMovesState)(
      "a refusal that moves the link's state says so",
      async () => {
        await withLink(async ({ link, host }) => {
          const refused = host.refuses;
          if (!refused) {
            throw new Error("the fixture promised a refusal and declared none");
          }

          const states: LinkState[] = [];
          link.onState((state) => states.push(state));

          await link.dispatch(refused.action).catch(() => undefined);
          const state = await until(link, (held) => held.kind !== "ready");

          expect(["unpaired", "closed"]).toContain(state.kind);
          expect(states.at(-1)).toEqual(state);
        });
      },
    );

    test.skipIf(!capabilities.publishes)(
      "the Snapshots the Host publishes arrive in order",
      async () => {
        await withLink(async ({ link, host }) => {
          const publish = host.publish;
          if (!publish) {
            throw new Error("the fixture promised publications and declared none");
          }

          const seen: Snapshot[] = [];
          const stop = link.onSnapshot((snapshot) => seen.push(snapshot));
          const published: Snapshot[] = [];
          for (let index = 0; index < 3; index += 1) {
            published.push(await publish());
          }
          stop();

          // A link may replay the state it holds on subscribe; what must hold is
          // that every Snapshot the Host published arrived, in that order.
          expect(seen.slice(-published.length)).toEqual(published);
        });
      },
    );

    test.skipIf(!capabilities.publishes)(
      "onSnapshot's unsubscribe stops that handler and no other",
      async () => {
        await withLink(async ({ link, host }) => {
          const publish = host.publish;
          if (!publish) {
            throw new Error("the fixture promised publications and declared none");
          }

          const dropped: Snapshot[] = [];
          const kept: Snapshot[] = [];
          const stop = link.onSnapshot((snapshot) => dropped.push(snapshot));
          link.onSnapshot((snapshot) => kept.push(snapshot));
          stop();
          const before = dropped.length;

          const latest = await publish();

          expect(dropped.length).toBe(before);
          expect(kept.at(-1)).toEqual(latest);
        });
      },
    );

    test("close() reports closed, silences delivery, and unsubscribes", async () => {
      await withLink(async ({ link, host }) => {
        const seen: Snapshot[] = [];
        const states: LinkState[] = [];
        const unsubscribed: LinkState[] = [];

        link.onSnapshot((snapshot) => seen.push(snapshot));
        const stopState = link.onState((state) => unsubscribed.push(state));
        link.onState((state) => states.push(state));
        stopState();
        const before = seen.length;

        link.close();

        const closed = link.state();
        expect(closed.kind).toBe("closed");
        if (closed.kind === "closed") {
          expect(closed.reason.length).toBeGreaterThan(0);
        }
        expect(states).toEqual([closed]);
        expect(unsubscribed).toEqual([]);

        if (host.publish) {
          await host.publish();
          expect(seen.length).toBe(before);
        }

        // A subscription made after `close()` is silent too: the link has
        // nothing more to say to anyone.
        const late: Snapshot[] = [];
        const lateStates: LinkState[] = [];
        link.onSnapshot((snapshot) => late.push(snapshot));
        link.onState((state) => lateStates.push(state));
        if (host.publish) {
          await host.publish();
        }
        expect(late).toEqual([]);
        expect(lateStates).toEqual([]);

        // Closing what is already closed changes nothing and tells no one twice.
        link.close();
        expect(states).toEqual([closed]);
      });
    });

    test.skipIf(!capabilities.revokes)(
      "a revoke moves the link off ready, and says so",
      async () => {
        await withLink(async ({ link, host }) => {
          const revoke = host.revoke;
          if (!revoke) {
            throw new Error("the fixture promised a revoke and declared none");
          }

          const states: LinkState[] = [];
          link.onState((state) => states.push(state));

          await revoke();
          const state = await until(link, (held) => held.kind !== "ready");

          expect(["unpaired", "closed"]).toContain(state.kind);
          expect(states.at(-1)).toEqual(state);
        });
      },
    );
  });
}
