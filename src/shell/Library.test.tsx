import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import {
  HostClient,
  type Action,
  type ActionError,
  type Snapshot,
  type Transport,
} from "../host-client";
import { Shell } from "./Shell";

const GATE_COPY =
  "Your Library will hold the Titles saved in your Stremio account. It is not built yet — sign in to Stremio to connect the account it will draw from.";

const PLACEHOLDER_COPY =
  "Signed in to Stremio. The Titles saved in your account will appear here once the Library is built.";

const NOTHING_SAID: Snapshot = {
  revision: 1,
  playback: {
    state: "idle",
    picture: "in_window",
    failure: null,
    nowPlaying: null,
    episode: null,
    position: null,
    duration: null,
    tracks: [],
    chapters: [],
    chapter: null,
    speed: null,
    volume: null,
    muted: null,
    subtitleDelay: null,
    crop: null,
    aspect: null,
    resolution: null,
    statistics: null,
  },
  preferences: { subtitleLanguage: null },
  addons: [],
  featuredCatalog: null,
  protection: { backend: "keyring", tmdbHeld: false, stremioHeld: false },
  watchProgress: [],
  devices: [],
  pairingCode: "4K7Q2M",
  address: "192.168.1.9:8090",
};

type Invocation = { command: string; args?: Record<string, unknown> };

function fakeHost(
  initial: Snapshot,
  options: { refuse?: (action: Action) => ActionError | null } = {},
) {
  const invocations: Invocation[] = [];
  let current = initial;
  let listener: ((event: { payload: Snapshot }) => void) | undefined;

  const transport: Transport = {
    invoke: async <T,>(command: string, args?: Record<string, unknown>): Promise<T> => {
      invocations.push({ command, args });
      if (command === "snapshot") {
        return current as T;
      }
      const action = (args?.envelope as { action: Action }).action;
      const refusal = options.refuse?.(action);
      if (refusal) {
        throw refusal;
      }
      return { snapshots: [], answer: null } as T;
    },
    listen: async <T,>(_event: string, handler: (event: { payload: T }) => void) => {
      listener = handler as (event: { payload: Snapshot }) => void;
      return () => {
        listener = undefined;
      };
    },
  };

  return {
    client: new HostClient(transport),
    invocations,
    publish(next: Snapshot) {
      current = next;
      listener?.({ payload: next });
    },
  };
}

function actions(invocations: Invocation[]): Action[] {
  return invocations
    .filter(({ command }) => command === "dispatch")
    .map(({ args }) => (args?.envelope as { action: Action }).action);
}

async function openLibrary(host: ReturnType<typeof fakeHost>) {
  render(<Shell client={host.client} />);
  await screen.findByRole("heading", { name: "Home" });
  fireEvent.click(screen.getByRole("button", { name: "Library" }));
  await screen.findByRole("heading", { name: "Library" });
  return host;
}

describe("the Library screen", () => {
  test("with no account, draws the sign-in gate and dispatches sign_in_stremio", async () => {
    const host = fakeHost(NOTHING_SAID);
    await openLibrary(host);

    expect(await screen.findByTestId("library-gate")).toHaveTextContent(GATE_COPY);
    expect(screen.getByLabelText("Stremio email")).toBeInTheDocument();
    expect(screen.getByLabelText("Stremio password")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();

    const body = screen.getByTestId("screen-library");
    expect(within(body).queryByRole("list")).not.toBeInTheDocument();
    expect(body).not.toHaveTextContent(/continue watching/i);

    fireEvent.change(screen.getByLabelText("Stremio email"), {
      target: { value: "  you@example.test  " },
    });
    fireEvent.change(screen.getByLabelText("Stremio password"), {
      target: { value: "hunter2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({
        type: "sign_in_stremio",
        email: "you@example.test",
        password: "hunter2",
      }),
    );
  });

  test("with an account held, draws only the placeholder", async () => {
    const host = fakeHost({
      ...NOTHING_SAID,
      protection: { backend: "keyring", tmdbHeld: false, stremioHeld: true },
    });
    await openLibrary(host);

    expect(await screen.findByTestId("library-placeholder")).toHaveTextContent(
      PLACEHOLDER_COPY,
    );

    const body = screen.getByTestId("screen-library");
    expect(within(body).queryByRole("button")).not.toBeInTheDocument();
    expect(within(body).queryByRole("list")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Stremio email")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Stremio password")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
    expect(body).not.toHaveTextContent(/continue watching/i);
    expect(body).not.toHaveTextContent(/\b(synced|up to date)\b/i);
    expect(
      Array.from(body.children).map((child) => child.textContent),
      "the placeholder is all the screen says",
    ).toEqual(["Library", PLACEHOLDER_COPY]);
    expect(actions(host.invocations)).toEqual([]);
  });

  const REFUSALS: Array<{ kind: ActionError["kind"]; expected: string }> = [
    {
      kind: "invalid_stremio_login",
      expected: "The Host will not send that Stremio sign-in",
    },
    {
      kind: "sync_unavailable",
      expected:
        "This Host was built without Stremio account sync, so it cannot sign in.",
    },
  ];

  test.each(REFUSALS)("$kind stays beside the sign-in form", async ({ kind, expected }) => {
    const host = fakeHost(NOTHING_SAID, {
      refuse: (action) => (action.type === "sign_in_stremio" ? { kind } : null),
    });
    await openLibrary(host);

    const email = screen.getByLabelText("Stremio email");
    const password = screen.getByLabelText("Stremio password");
    fireEvent.change(email, { target: { value: "you@example.test" } });
    fireEvent.change(password, { target: { value: "hunter2" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByTestId("stremio-sign-in-error")).toHaveTextContent(
      expected,
    );
    expect(email).toHaveValue("you@example.test");
    expect(password).toHaveValue("hunter2");
    expect(
      document.querySelector(".shell-alert"),
      "not the window's one alert",
    ).toBeNull();
  });

  test("choosing Library dispatches no Action, and Back returns to Home", async () => {
    const host = fakeHost(NOTHING_SAID);
    await openLibrary(host);

    expect(actions(host.invocations)).toEqual([]);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(await screen.findByRole("heading", { name: "Home" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("button", { name: "Library" })).not.toHaveAttribute(
      "aria-current",
    );
  });
});
