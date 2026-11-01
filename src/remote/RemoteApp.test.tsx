import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { explain } from "../core/errors";
import type { HostLink } from "../core/link";
import { RemoteApp } from "./RemoteApp";
import {
  ISSUED_TOKEN,
  PAIRING_CODE,
  PHONE,
  fakeLink,
} from "./fakeSocket.testing";

/**
 * The link, with the one call the first-mount rule is about counted.
 *
 * A test cannot see a Snapshot read in the drawing, and should not: the
 * decision is that a paired client is owed exactly one on arrival, so the link
 * is wrapped rather than the page being read for text.
 */
function counting(link: HostLink): { link: HostLink; reads: () => number } {
  let reads = 0;
  const counted: HostLink = {
    snapshot: () => {
      reads += 1;
      return link.snapshot();
    },
    dispatch: (action) => link.dispatch(action),
    onSnapshot: (handler) => link.onSnapshot(handler),
    state: () => link.state(),
    onState: (handler) => link.onState(handler),
    close: () => link.close(),
  };
  return { link: counted, reads: () => reads };
}

/** A link over the fake Host: paired, or waiting at the gate. */
function openLink(paired: boolean) {
  return fakeLink(
    paired ? { known: { device: PHONE, token: ISSUED_TOKEN } } : {},
    paired ? ISSUED_TOKEN : null,
  );
}

describe("the Remote's app", () => {
  test("the pairing gate sends pair_device, and the token it answers with is stored", async () => {
    const { host, tokens, link, release } = openLink(false);
    const view = render(<RemoteApp link={link} />);
    try {
      const code = await screen.findByLabelText("Pairing code");
      fireEvent.change(code, { target: { value: PAIRING_CODE } });
      fireEvent.change(screen.getByLabelText("Device name"), {
        target: { value: "Phone" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Pair" }));

      await waitFor(() =>
        expect(host.received()).toContainEqual({
          type: "pair_device",
          code: PAIRING_CODE,
          name: "Phone",
        }),
      );
      expect(tokens.held()).toBe(ISSUED_TOKEN);
      await waitFor(() =>
        expect(link.state()).toEqual({ kind: "ready", device: PHONE }),
      );
    } finally {
      view.unmount();
      release();
    }
  });

  test("a paired link is read for its Snapshot once on the first mount", async () => {
    const { host, link, release } = openLink(true);
    await host.connect();
    const { link: counted, reads } = counting(link);
    const view = render(<RemoteApp link={counted} />);
    try {
      await waitFor(() => expect(reads()).toBe(1));
      // A second render is not a second arrival: the state is held, not asked
      // for again.
      await Promise.resolve();
      expect(reads()).toBe(1);
    } finally {
      view.unmount();
      release();
    }
  });

  test("an unpaired link is never read for a Snapshot", async () => {
    const { host, link, release } = openLink(false);
    await host.connect();
    const { link: counted, reads } = counting(link);
    const view = render(<RemoteApp link={counted} />);
    try {
      await screen.findByLabelText("Pairing code");
      expect(reads()).toBe(0);
    } finally {
      view.unmount();
      release();
    }
  });

  test("a refused pairing is explained in the Host's words", async () => {
    const { link, release } = openLink(false);
    const view = render(<RemoteApp link={link} />);
    try {
      const code = await screen.findByLabelText("Pairing code");
      fireEvent.change(code, { target: { value: "AAAAAA" } });
      fireEvent.click(screen.getByRole("button", { name: "Pair" }));

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toBe(explain({ kind: "pairing" }));
      expect(link.state().kind).toBe("unpaired");
    } finally {
      view.unmount();
      release();
    }
  });
});
