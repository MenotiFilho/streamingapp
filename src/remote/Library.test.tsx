import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { explain, type ActionError } from "../core/errors";
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
import { titleLevel, type RemotePayload } from "./levels";
import { LIBRARY_RETRY_CONTROL } from "./libraryScreen";
import {
  STREMIO_EMAIL_LABEL,
  STREMIO_PASSWORD_LABEL,
  STREMIO_SIGN_IN,
} from "./settingsScreen";

const CINEMETA: AddonManifest = {
  id: "cinemeta",
  name: "Cinemeta",
  version: "3.0.14",
  resources: [{ name: "meta", types: ["movie", "series"], idPrefixes: ["tt"] }],
  types: ["movie", "series"],
  catalogs: [],
  idPrefixes: ["tt"],
  behaviorHints: { configurable: false, configurationRequired: false },
  enabled: true,
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
}: {
  link: HostLink;
  pushes: NewLevel<RemotePayload>[];
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
  const view = render(<Show link={host} pushes={pushes} />);
  return { host, pushes, view };
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
  test("draws the inline Stremio sign-in gate, sends sign_in_stremio, and asks no library yet", async () => {
    const { host } = mount({ snapshot: WITHOUT_ACCOUNT });

    const gate = await screen.findByTestId("remote-library-gate");
    expect(gate).toBeInTheDocument();
    expect(host.actions).toEqual([]);

    fireEvent.change(screen.getByLabelText(STREMIO_EMAIL_LABEL), {
      target: { value: "viewer@example.com" },
    });
    fireEvent.change(screen.getByLabelText(STREMIO_PASSWORD_LABEL), {
      target: { value: "secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: STREMIO_SIGN_IN }));

    await waitFor(() =>
      expect(host.asked("sign_in_stremio")).toEqual([
        { type: "sign_in_stremio", email: "viewer@example.com", password: "secret" },
      ]),
    );
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

  test("filter chips narrow All / Movies / Series cleanly", async () => {
    mount({
      respond: () =>
        account([
          entry({ id: "tt0133093", type: "movie", name: "The Matrix" }),
          entry({ id: "tt0944947", type: "series", name: "Game of Thrones" }),
        ]),
    });

    await screen.findByTestId("library-card-tt0133093");
    expect(screen.getByTestId("library-card-tt0944947")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("library-filter-series"));
    expect(screen.queryByTestId("library-card-tt0133093")).not.toBeInTheDocument();
    expect(screen.getByTestId("library-card-tt0944947")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("library-filter-movie"));
    expect(screen.getByTestId("library-card-tt0133093")).toBeInTheDocument();
    expect(screen.queryByTestId("library-card-tt0944947")).not.toBeInTheDocument();
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
    ).toBe(false);
  });

  test("an entry no Addon answers keeps its picture and mark, and presses nothing", async () => {
    const { pushes } = mount({
      snapshot: { ...WITH_ACCOUNT, addons: [] },
      respond: () => account([entry()]),
    });

    const card = await screen.findByTestId("library-card-tt0133093");
    expect(card).toBeDisabled();
    fireEvent.click(card);
    expect(pushes).toEqual([]);
  });

  test("an expired session draws the Host's words and inline Stremio re-sign-in form", async () => {
    const expired: ActionError = {
      kind: "library",
      detail: "Stremio refused the request: Session does not exist",
    };
    const { host } = mount({ respond: () => expired });

    const gate = await screen.findByTestId("library-expired");
    expect(gate).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent(explain(expired));
    expect(screen.queryByTestId("remote-library-empty")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: LIBRARY_RETRY_CONTROL })).not.toBeInTheDocument();
    expect(screen.getByLabelText(STREMIO_EMAIL_LABEL)).toBeInTheDocument();
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

    expect(await screen.findByTestId("remote-library-failure")).toHaveTextContent(
      explain(unreachable),
    );

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

    expect(await screen.findByTestId("remote-library-failure")).toHaveTextContent(
      explain(unreachable),
    );
    expect(screen.getByRole("button", { name: LIBRARY_RETRY_CONTROL })).toBeInTheDocument();
    expect(host.asked("library")).toHaveLength(1);
  });
});
