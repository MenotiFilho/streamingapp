import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { explain } from "../core/errors";
import type { HostLink } from "../core/link";
import type { AddonManifest, CatalogRow, MetaPreview, Snapshot } from "../core/wire";
import { RemoteApp } from "./RemoteApp";
import {
  ISSUED_TOKEN,
  NOTHING,
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
    onRevision: (handler) => link.onRevision(handler),
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

/**
 * Whether a destination's own control is the one showing.
 *
 * The destination is the navigation's decision, and the control announces it
 * through the same `aria-pressed` the kit gives every toggle: a test reads that
 * rather than the copy of the screen the destination happens to be drawn with.
 */
let previousSkipAnimations: boolean | undefined;
beforeAll(() => {
  previousSkipAnimations = MotionGlobalConfig.skipAnimations;
  MotionGlobalConfig.skipAnimations = true;
});
afterAll(() => {
  MotionGlobalConfig.skipAnimations = previousSkipAnimations;
});

function pressed(label: string): boolean {
  return screen.getByRole("button", { name: label }).getAttribute("aria-current") === "page";
}

describe("the Remote's app", () => {
  test("the pairing gate sends pair_device, and the token it answers with is stored", async () => {
    const { host, tokens, link, release } = openLink(false);
    const view = render(<RemoteApp link={link} />);
    try {
      const code = await screen.findByLabelText("Pairing code");
      expect(screen.getByTestId("pairing-host")).toBeInTheDocument();
      fireEvent.change(code, { target: { value: PAIRING_CODE } });
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

  test("a dropped socket keeps the destination the person was reading", async () => {
    const { host, link, release } = openLink(true);
    await host.connect();
    const view = render(<RemoteApp link={link} />);
    try {
      fireEvent.click(await screen.findByRole("button", { name: "Library" }));
      expect(pressed("Library")).toBe(true);

      // A phone that locked is still in the room it was in, and still on the
      // destination it was reading: the socket is the connection's business,
      // the visit is the client's.
      host.drop();
      expect(pressed("Library")).toBe(true);
      await waitFor(() => expect(link.state().kind).toBe("reconnecting"));

      host.flush();
      await host.connect();
      await waitFor(() => expect(link.state().kind).toBe("ready"));
      expect(pressed("Library")).toBe(true);
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

  test("TabBar stays visible on pushed browse and settings Levels, and hides on player Levels and sheets", async () => {
    const addon: AddonManifest = {
      id: "cinemeta",
      name: "Cinemeta",
      version: "3.0.14",
      resources: [{ name: "catalog", types: ["movie"], idPrefixes: ["tt"] }],
      types: ["movie"],
      catalogs: [{ type: "movie", id: "top", name: "Popular", extra: [] }],
      idPrefixes: ["tt"],
      behaviorHints: { configurable: false, configurationRequired: false },
      enabled: true,
    };
    const preview: MetaPreview = {
      id: "tt1",
      type: "movie",
      name: "One",
      poster: null,
      posterShape: "poster",
      releaseInfo: "2024",
      imdbRating: null,
      genres: [],
      description: null,
    };
    const row: CatalogRow = {
      addon: "cinemeta",
      type: "movie",
      id: "top",
      name: "Popular",
      sent: 1,
      metas: [preview],
      failure: null,
    };
    const playing: Snapshot = {
      ...NOTHING,
      revision: 2,
      addons: [addon],
      playback: {
        ...NOTHING.playback,
        state: "playing",
        nowPlaying: {
          video: { type: "movie", id: "tt1" },
          addon: "cinemeta",
          name: "One",
          description: null,
          filename: null,
          bingeGroup: null,
        },
        position: 10,
        duration: 100,
      },
    };
    const { host, link, release } = fakeLink(
      {
        snapshot: playing,
        known: { device: PHONE, token: ISSUED_TOKEN },
      },
      ISSUED_TOKEN,
    );
    const appLink: HostLink = {
      snapshot: () => link.snapshot(),
      dispatch: (action) => {
        if (action.type === "browse_catalog") {
          return Promise.resolve({ snapshots: [], answer: { catalogs: [row] } });
        }
        if (action.type === "open_title") {
          return Promise.resolve({
            snapshots: [],
            answer: {
              title: {
                addon: "cinemeta",
                id: "tt1",
                key: { kind: "addon", addon: "cinemeta", id: "tt1" },
                type: "movie",
                name: "One",
                poster: null,
                background: null,
                logo: null,
                description: null,
                releaseInfo: "2024",
                runtime: null,
                imdbRating: null,
                genres: [],
                videos: [],
              },
            },
          });
        }
        return link.dispatch(action);
      },
      onSnapshot: (handler) => link.onSnapshot(handler),
      onRevision: (handler) => link.onRevision(handler),
      state: () => link.state(),
      onState: (handler) => link.onState(handler),
      close: () => link.close(),
    };
    await host.connect();
    const view = render(<RemoteApp link={appLink} />);
    try {
      // Pushed browse Level (Title) keeps the TabBar visible.
      fireEvent.click(await screen.findByTestId("card-cinemeta-tt1"));
      await screen.findByTestId("remote-title-screen");
      expect(screen.getByRole("navigation", { name: "Destinations" })).toBeInTheDocument();

      // Pushed Settings leaf and sub-level keep the TabBar visible.
      fireEvent.click(screen.getByRole("button", { name: "Settings" }));
      const prefsCat = await screen.findByTestId("settings-category-preferences");
      fireEvent.click(within(prefsCat).getByRole("button"));
      await screen.findByTestId("settings-preferences");
      expect(screen.getByRole("navigation", { name: "Destinations" })).toBeInTheDocument();

      fireEvent.click(within(screen.getByTestId("pref-row-subtitle-languages")).getByRole("button"));
      await screen.findByTestId("settings-sublevel-subtitle-languages");
      expect(screen.getByRole("navigation", { name: "Destinations" })).toBeInTheDocument();

      // Player Level hides the TabBar.
      fireEvent.click(screen.getByRole("button", { name: /Open the remote/ }));
      await screen.findByTestId("remote-player-card");
      expect(screen.queryByRole("navigation", { name: "Destinations" })).not.toBeInTheDocument();

      // Player sheet over player Level also hides the TabBar.
      fireEvent.click(screen.getByRole("button", { name: "Speed" }));
      await screen.findByTestId("player-sheet-speed");
      expect(screen.queryByRole("navigation", { name: "Destinations" })).not.toBeInTheDocument();
    } finally {
      view.unmount();
      release();
    }
  });
});
