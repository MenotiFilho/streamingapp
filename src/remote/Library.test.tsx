import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { explain } from "../core/errors";
import type { ActionError } from "../core/errors";
import type { Destination } from "../core/destinations";
import type { HostLink } from "../core/link";
import type { NewLevel } from "../core/navigation";
import { useSession } from "../core/react/useSession";
import type {
  AddonManifest,
  LibraryEntry,
  Response,
  Snapshot,
} from "../core/wire";
import { Library as LibraryScreen } from "./Library";
import { FakeHost, type Respond } from "./fakeHost.testing";
import { NOTHING } from "./fakeSocket.testing";
import {
  LIBRARY_RETRY_CONTROL,
  LIBRARY_SETTINGS_CONTROL,
} from "./libraryScreen";
import { titleLevel, type RemotePayload } from "./levels";

/**
 * The Library over a fake HostLink (#208, ADR-0032, docs/agents/testing.md).
 *
 * The screen is the harness; every assertion is a decision at the boundary: the
 * one `library` ask a signed-in mount sends, the answer that stops being an
 * ask, the level a press pushes, and the two ways out of a failure. The states
 * are found by their screen test ids; the words each state says belong to
 * `libraryScreen`, and are read there rather than through the DOM.
 */

const CINEMETA: AddonManifest = {
  id: "cinemeta",
  name: "Cinemeta",
  version: "3.0.14",
  resources: [{ name: "meta", types: ["movie", "series"], idPrefixes: ["tt"] }],
  types: ["movie", "series"],
  catalogs: [],
  idPrefixes: ["tt"],
  behaviorHints: { configurable: false, configurationRequired: false },
};

const WITH_ACCOUNT: Snapshot = {
  ...NOTHING,
  addons: [CINEMETA],
  protection: { backend: "file", tmdbHeld: false, stremioHeld: true },
};

const WITHOUT_ACCOUNT: Snapshot = {
  ...WITH_ACCOUNT,
  protection: { ...WITH_ACCOUNT.protection, stremioHeld: false },
};

function entry(overrides: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
    id: "tt0133093",
    name: "The Matrix",
    type: "movie",
    poster: "https://images.test/matrix.jpg",
    posterShape: "poster",
    mtime: 1_700_000_000_000,
    videoId: null,
    position: null,
    duration: null,
    continueWatching: false,
    ...overrides,
  };
}

function account(entries: LibraryEntry[], failure: ActionError | null = null): Response {
  return { snapshots: [], answer: { library: { entries, failure } } };
}

function Show({
  link,
  pushes,
  choose,
}: {
  link: HostLink;
  pushes: NewLevel<RemotePayload>[];
  choose: (destination: Destination) => void;
}) {
  const { session, state } = useSession(link);
  return (
    <LibraryScreen
      session={session}
      state={state}
      push={(level) => {
        pushes.push(level);
        return `level-${pushes.length}`;
      }}
      choose={choose}
    />
  );
}

function mount({
  snapshot = WITH_ACCOUNT,
  respond = () => account([]),
}: {
  snapshot?: Snapshot;
  respond?: Respond;
} = {}) {
  const host = new FakeHost(snapshot, respond);
  const pushes: NewLevel<RemotePayload>[] = [];
  const choose = vi.fn();
  const view = render(<Show link={host} pushes={pushes} choose={choose} />);
  return { host, pushes, choose, view };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

describe("the Library with no Stremio account", () => {
  test("draws the offer to sign in, presses through to Settings, and asks nothing", async () => {
    const { host, choose } = mount({ snapshot: WITHOUT_ACCOUNT });

    fireEvent.click(
      await screen.findByRole("button", { name: LIBRARY_SETTINGS_CONTROL }),
    );
    expect(choose).toHaveBeenCalledWith("settings");

    await flush();
    expect(host.actions, "with no account there is no Library to read").toEqual([]);
  });
});

describe("the Library with an account", () => {
  test("a mount reads the account once, and a second render is not a second arrival", async () => {
    const { host } = mount();

    await waitFor(() => expect(host.asked("library")).toHaveLength(1));
    expect(host.asked("library")[0]).toEqual({ type: "library" });

    await flush();
    expect(host.asked("library")).toHaveLength(1);
  });

  test("an empty account draws the empty state and asks once", async () => {
    const { host } = mount();

    expect(await screen.findByTestId("remote-library-empty")).toBeInTheDocument();
    expect(host.asked("library")).toHaveLength(1);
  });

  test("a list entry's press pushes the Title level carrying its Addon, and nothing else", async () => {
    const { host, pushes } = mount({
      respond: () => account([entry()]),
    });

    fireEvent.click(await screen.findByTestId("library-card-tt0133093"));

    expect(pushes).toEqual([
      titleLevel({
        addon: "cinemeta",
        id: "tt0133093",
        type: "movie",
        name: "The Matrix",
      }),
    ]);
    expect(
      host.actions.some(
        (action) => action.type === "open_title" || action.type === "resume",
      ),
      "B4 opens a level; the Title request is B6's and the resume B8/B9's",
    ).toBe(false);
  });

  test("an entry no Addon answers keeps its picture and mark, and presses nothing", async () => {
    const { pushes } = mount({
      snapshot: { ...WITH_ACCOUNT, addons: [] },
      respond: () => account([entry()]),
    });

    fireEvent.click(await screen.findByTestId("library-card-tt0133093"));
    expect(pushes).toEqual([]);
  });

  test("an expired session draws the Host's words and the way back to Settings", async () => {
    const expired: ActionError = {
      kind: "library",
      detail: "Stremio refused the request: Session does not exist",
    };
    const { host, choose } = mount({ respond: () => expired });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(explain(expired));
    expect(
      screen.queryByTestId("remote-library-empty"),
      "an expired session is never an empty Library",
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: LIBRARY_RETRY_CONTROL })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: LIBRARY_SETTINGS_CONTROL }));
    expect(choose).toHaveBeenCalledWith("settings");
    expect(host.asked("library")).toHaveLength(1);
  });

  test("any other failure offers a retry that asks the Host again", async () => {
    const unreachable: ActionError = {
      kind: "library",
      detail: "Stremio did not answer",
    };
    let asked = 0;
    const { host } = mount({
      respond: () => {
        asked += 1;
        return asked === 1 ? unreachable : account([entry()]);
      },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(explain(unreachable));

    fireEvent.click(screen.getByRole("button", { name: LIBRARY_RETRY_CONTROL }));

    expect(await screen.findByTestId("library-card-tt0133093")).toBeInTheDocument();
    expect(host.asked("library")).toHaveLength(2);
    expect(screen.queryByTestId("remote-library-failure")).not.toBeInTheDocument();
  });

  test("the answer's own failure is a failure too, with the retry control", async () => {
    const unreachable: ActionError = {
      kind: "library",
      detail: "Stremio did not answer",
    };
    const { host } = mount({
      respond: () => account([], unreachable),
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(explain(unreachable));
    expect(screen.getByRole("button", { name: LIBRARY_RETRY_CONTROL })).toBeInTheDocument();
    expect(host.asked("library")).toHaveLength(1);
  });
});
