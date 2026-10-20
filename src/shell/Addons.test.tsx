import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import {
  HostClient,
  type Action,
  type ActionError,
  type AddonManifest,
  type Snapshot,
  type Transport,
} from "../host-client";
import { Shell } from "./Shell";

const CINEMETA: AddonManifest = {
  id: "com.linvo.cinemeta",
  name: "Cinemeta",
  version: "3.0.0",
  resources: [
    { name: "catalog", types: ["movie", "series"], idPrefixes: null },
    { name: "meta", types: ["movie", "series"], idPrefixes: ["tt"] },
  ],
  types: ["movie", "series"],
  catalogs: [
    {
      type: "movie",
      id: "top",
      name: "Top",
      extra: [{ name: "skip", isRequired: false, options: [], optionsLimit: 1 }],
    },
  ],
  idPrefixes: ["tt"],
  behaviorHints: { configurable: false, configurationRequired: false },
};

const STREMBOX: AddonManifest = {
  ...CINEMETA,
  id: "community.stremboxd",
  name: "Stremboxd",
  version: "2.0.0",
  catalogs: [
    {
      type: "movie",
      id: "letterboxd-popular",
      name: "Popular This Week",
      extra: [{ name: "skip", isRequired: false, options: [], optionsLimit: 1 }],
    },
  ],
};

const AIOSTREAMS: AddonManifest = {
  ...CINEMETA,
  id: "community.aiostreams",
  name: "AIOStreams",
  version: "1.4.2",
  catalogs: [],
  types: [],
  resources: [{ name: "stream", types: ["movie", "series"], idPrefixes: ["tt"] }],
};

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

function snap(overrides: Partial<Snapshot> = {}): Snapshot {
  return { ...NOTHING_SAID, ...overrides };
}

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

async function openAddons(host: ReturnType<typeof fakeHost>) {
  render(<Shell client={host.client} />);
  await screen.findByRole("heading", { name: "Home" });
  fireEvent.click(screen.getByRole("button", { name: "Addons" }));
  await screen.findByRole("heading", { name: "Addons" });
  return host;
}

function summaryOf(id: string): HTMLElement {
  return screen.getByTestId(`addon-summary-${id}`);
}

function expand(id: string) {
  act(() => summaryOf(id).focus());
  return screen.getByTestId(`addon-details-${id}`);
}

describe("the Addons screen", () => {
  test("lists the Host's Addons in its order, name and version until a row is focused", async () => {
    const host = fakeHost(snap({ addons: [CINEMETA, STREMBOX] }));
    await openAddons(host);

    const list = screen.getByTestId("addons");
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((row) => row.getAttribute("data-testid"))).toEqual([
      `addon-${CINEMETA.id}`,
      `addon-${STREMBOX.id}`,
    ]);

    const first = rows[0]!;
    expect(first).toHaveTextContent("Cinemeta");
    expect(first).toHaveTextContent("3.0.0");
    expect(within(first).queryByTestId(`addon-details-${CINEMETA.id}`)).toBeNull();

    const details = expand(CINEMETA.id);
    expect(details).toHaveTextContent("com.linvo.cinemeta");
    expect(details).toHaveTextContent("catalog (movie, series)");
    expect(details).toHaveTextContent("meta (movie, series)");
    expect(details).toHaveTextContent("Top (movie)");
  });

  test("a row collapses when focus leaves it, and stays open while a detail control has focus", async () => {
    const host = fakeHost(snap({ addons: [CINEMETA, STREMBOX] }));
    await openAddons(host);

    expand(CINEMETA.id);
    const remove = within(screen.getByTestId(`addon-${CINEMETA.id}`)).getByRole(
      "button",
      { name: "Remove" },
    );
    act(() => remove.focus());
    expect(screen.getByTestId(`addon-details-${CINEMETA.id}`)).toBeInTheDocument();

    act(() => screen.getByLabelText("Addon manifest URL").focus());
    await waitFor(() =>
      expect(screen.queryByTestId(`addon-details-${CINEMETA.id}`)).not.toBeInTheDocument(),
    );
  });

  test("with no Addons, the empty state points at the manifest-URL form", async () => {
    const host = fakeHost(snap({ addons: [] }));
    await openAddons(host);

    expect(screen.getByTestId("addons-empty")).toHaveTextContent(
      "No Addons are configured yet",
    );
    expect(screen.getByLabelText("Addon manifest URL")).toBeInTheDocument();
    expect(screen.queryByTestId("addons")).not.toBeInTheDocument();
  });

  test("adding an Addon takes the trimmed URL and clears the field once the Host has it", async () => {
    const host = fakeHost(snap({ addons: [] }));
    await openAddons(host);

    const input = screen.getByLabelText("Addon manifest URL");
    fireEvent.change(input, {
      target: { value: "  https://example.test/manifest.json  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({
        type: "add_addon",
        url: "https://example.test/manifest.json",
      }),
    );
    expect(input).toHaveValue("");

    act(() => host.publish(snap({ revision: 2, addons: [CINEMETA] })));
    const row = await screen.findByTestId(`addon-${CINEMETA.id}`);
    expect(row).toHaveTextContent("Cinemeta");
    expect(row).not.toHaveTextContent("https://example.test/manifest.json");
  });

  test("a refused Addon is explained beside the form and the pasted URL is kept", async () => {
    const url = "https://example.test/manifest.json";
    const host = fakeHost(snap({ addons: [] }), {
      refuse: (action) =>
        action.type === "add_addon"
          ? { kind: "manifest", detail: "the manifest is missing name" }
          : null,
    });
    await openAddons(host);

    const input = screen.getByLabelText("Addon manifest URL");
    fireEvent.change(input, { target: { value: url } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    const refusal = await screen.findByTestId("add-addon-error");
    expect(refusal).toHaveTextContent("could not read that Addon's manifest");
    expect(refusal).toHaveTextContent("the manifest is missing name");
    expect(input).toHaveValue(url);
    expect(document.querySelector(".shell-alert"), "not the window's one alert").toBeNull();
  });

  test("Move up and Move down ask for the 0-based position, disabled at the ends", async () => {
    const host = fakeHost(snap({ addons: [CINEMETA, STREMBOX, AIOSTREAMS] }));
    await openAddons(host);

    expand(CINEMETA.id);
    const firstRow = screen.getByTestId(`addon-${CINEMETA.id}`);
    expect(within(firstRow).getByRole("button", { name: "Move up" })).toBeDisabled();
    expect(within(firstRow).getByRole("button", { name: "Move down" })).toBeEnabled();

    fireEvent.click(within(firstRow).getByRole("button", { name: "Move down" }));
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({
        type: "reorder_addon",
        id: CINEMETA.id,
        position: 1,
      }),
    );

    expand(AIOSTREAMS.id);
    const lastRow = screen.getByTestId(`addon-${AIOSTREAMS.id}`);
    expect(within(lastRow).getByRole("button", { name: "Move down" })).toBeDisabled();
    expect(within(lastRow).getByRole("button", { name: "Move up" })).toBeEnabled();

    fireEvent.click(within(lastRow).getByRole("button", { name: "Move up" }));
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({
        type: "reorder_addon",
        id: AIOSTREAMS.id,
        position: 1,
      }),
    );
  });

  test("the list follows the new order the Host publishes after a reorder", async () => {
    const host = fakeHost(snap({ addons: [CINEMETA, STREMBOX] }));
    await openAddons(host);

    expand(STREMBOX.id);
    fireEvent.click(
      within(screen.getByTestId(`addon-${STREMBOX.id}`)).getByRole("button", {
        name: "Move up",
      }),
    );
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({
        type: "reorder_addon",
        id: STREMBOX.id,
        position: 0,
      }),
    );

    act(() => host.publish(snap({ revision: 2, addons: [STREMBOX, CINEMETA] })));
    await waitFor(() =>
      expect(
        within(screen.getByTestId("addons"))
          .getAllByRole("listitem")
          .map((row) => row.getAttribute("data-testid")),
      ).toEqual([`addon-${STREMBOX.id}`, `addon-${CINEMETA.id}`]),
    );
  });

  test("a refused reorder is explained beside the list, and the order is left alone", async () => {
    const host = fakeHost(snap({ addons: [CINEMETA, STREMBOX] }), {
      refuse: (action) =>
        action.type === "reorder_addon"
          ? { kind: "invalid_position", position: 9, count: 2 }
          : null,
    });
    await openAddons(host);

    expand(CINEMETA.id);
    fireEvent.click(
      within(screen.getByTestId(`addon-${CINEMETA.id}`)).getByRole("button", {
        name: "Move down",
      }),
    );

    expect(await screen.findByTestId("addons-list-error")).toHaveTextContent(
      "The Host has no Addon position 9",
    );
    expect(
      within(screen.getByTestId("addons"))
        .getAllByRole("listitem")
        .map((row) => row.getAttribute("data-testid")),
    ).toEqual([`addon-${CINEMETA.id}`, `addon-${STREMBOX.id}`]);
  });

  test("Remove pushes a confirmation, and Back cancels to the exact control that asked", async () => {
    const host = fakeHost(snap({ addons: [CINEMETA, STREMBOX] }));
    await openAddons(host);

    expand(STREMBOX.id);
    const remove = within(screen.getByTestId(`addon-${STREMBOX.id}`)).getByRole(
      "button",
      { name: "Remove" },
    );
    act(() => remove.focus());
    fireEvent.click(remove);

    const dialog = await screen.findByRole("dialog", {
      name: `Remove ${STREMBOX.name}?`,
    });
    expect(dialog).toHaveTextContent("Watch progress already recorded stays");
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: `Remove ${STREMBOX.name}?` }),
      ).not.toBeInTheDocument(),
    );
    expect(document.activeElement).toBe(remove);
    expect(actions(host.invocations).some((action) => action.type === "remove_addon")).toBe(
      false,
    );
  });

  test("confirming Remove takes the Addon's id, and focus steps back when the row disappears", async () => {
    const host = fakeHost(snap({ addons: [CINEMETA, STREMBOX] }));
    await openAddons(host);

    expand(STREMBOX.id);
    const remove = within(screen.getByTestId(`addon-${STREMBOX.id}`)).getByRole(
      "button",
      { name: "Remove" },
    );
    act(() => remove.focus());
    fireEvent.click(remove);

    const dialog = await screen.findByRole("dialog", {
      name: `Remove ${STREMBOX.name}?`,
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({
        type: "remove_addon",
        id: STREMBOX.id,
      }),
    );

    act(() => host.publish(snap({ revision: 2, addons: [CINEMETA] })));
    await waitFor(() =>
      expect(screen.queryByTestId(`addon-${STREMBOX.id}`)).not.toBeInTheDocument(),
    );

    const first = screen.getByTestId(`addon-${CINEMETA.id}`);
    await waitFor(() => expect(first).toContainElement(document.activeElement as HTMLElement));
  });

  test("removing a middle Addon returns focus to the one before it, not the one after", async () => {
    const host = fakeHost(snap({ addons: [CINEMETA, STREMBOX, AIOSTREAMS] }));
    await openAddons(host);

    expand(STREMBOX.id);
    const remove = within(screen.getByTestId(`addon-${STREMBOX.id}`)).getByRole(
      "button",
      { name: "Remove" },
    );
    act(() => remove.focus());
    fireEvent.click(remove);

    const dialog = await screen.findByRole("dialog", {
      name: `Remove ${STREMBOX.name}?`,
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({
        type: "remove_addon",
        id: STREMBOX.id,
      }),
    );

    act(() =>
      host.publish(snap({ revision: 2, addons: [CINEMETA, AIOSTREAMS] })),
    );
    await waitFor(() =>
      expect(screen.queryByTestId(`addon-${STREMBOX.id}`)).not.toBeInTheDocument(),
    );

    await waitFor(() => expect(document.activeElement).toBe(summaryOf(CINEMETA.id)));
  });

  test("removing the only Addon returns focus to the add form", async () => {
    const host = fakeHost(snap({ addons: [CINEMETA] }));
    await openAddons(host);

    expand(CINEMETA.id);
    const remove = within(screen.getByTestId(`addon-${CINEMETA.id}`)).getByRole(
      "button",
      { name: "Remove" },
    );
    act(() => remove.focus());
    fireEvent.click(remove);

    const dialog = await screen.findByRole("dialog", {
      name: `Remove ${CINEMETA.name}?`,
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({
        type: "remove_addon",
        id: CINEMETA.id,
      }),
    );

    act(() => host.publish(snap({ revision: 2, addons: [] })));
    await screen.findByTestId("addons-empty");

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId("add-addon-submit")),
    );
  });

  test("a refused Remove keeps the confirmation open with the Host's reason", async () => {
    const host = fakeHost(snap({ addons: [CINEMETA, STREMBOX] }), {
      refuse: (action) =>
        action.type === "remove_addon"
          ? { kind: "unknown_addon", id: STREMBOX.id }
          : null,
    });
    await openAddons(host);

    expand(STREMBOX.id);
    const remove = within(screen.getByTestId(`addon-${STREMBOX.id}`)).getByRole(
      "button",
      { name: "Remove" },
    );
    act(() => remove.focus());
    fireEvent.click(remove);

    const dialog = await screen.findByRole("dialog", {
      name: `Remove ${STREMBOX.name}?`,
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      `No Addon with the id "${STREMBOX.id}" is configured.`,
    );
    expect(
      screen.getByRole("dialog", { name: `Remove ${STREMBOX.name}?` }),
    ).toBeInTheDocument();
  });
});
