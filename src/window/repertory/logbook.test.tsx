import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, test, vi } from "vitest";

import {
  HostClient,
  type Action,
  type ActionError,
  type AddonManifest,
  type DeviceSummary,
  type LibraryEntry,
  type Response,
  type Snapshot,
  type Transport,
} from "../../host-client";
import { ShellContext, type NewShellLevel, type ShellContextValue } from "../context";
import { HomeStore } from "../homeStore";
import { Shell } from "../Shell";
import { PreviewDataProvider } from "./context";
import { RepertoryAddonsScreen } from "./RepertoryAddons";
import { RepertoryLibraryScreen } from "./RepertoryLibrary";
import { RepertorySettingsScreen } from "./RepertorySettings";
import { SETTINGS_CATEGORIES } from "./settingsRegister";

const CINEMETA: AddonManifest = {
  id: "com.linvo.cinemeta",
  name: "Cinemeta",
  version: "3.0.14",
  resources: [
    { name: "catalog", types: ["movie", "series"], idPrefixes: null },
    { name: "meta", types: ["movie", "series"], idPrefixes: ["tt"] },
  ],
  types: ["movie", "series"],
  catalogs: [
    {
      type: "movie",
      id: "top",
      name: "Popular",
      extra: [{ name: "skip", isRequired: false, options: [], optionsLimit: 0 }],
    },
  ],
  idPrefixes: ["tt"],
  behaviorHints: { configurable: false, configurationRequired: false },
};

const TORRENTIO: AddonManifest = {
  ...CINEMETA,
  id: "torrentio",
  name: "Torrentio",
  version: "0.0.14",
  resources: [{ name: "stream", types: ["movie", "series"], idPrefixes: ["tt"] }],
  types: [],
  catalogs: [],
};

const AIOSTREAMS: AddonManifest = {
  ...TORRENTIO,
  id: "aiostreams",
  name: "AIOStreams",
  version: "1.4.2",
};

const LIVING_ROOM: DeviceSummary = {
  id: "device-living-room",
  name: "Living room",
  pairedAt: 1_700_000_000_000,
};

const OFFICE: DeviceSummary = {
  id: "device-office",
  name: "Office",
  pairedAt: 1_700_100_000_000,
};

const SNAPSHOT: Snapshot = {
  revision: 1,
  playback: {
    state: "idle",
    picture: "in_window",
    failure: null,
    nowPlaying: null,
    episode: null,
    position: null,
    duration: null,
    buffered: null,
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
  preferences: {
    subtitleLanguage: "en",
    subtitleColor: "#FFFFFF",
    subtitleScale: 1,
    streamBuffer: { seconds: 300, megabytes: 512 },
  },
  addons: [CINEMETA, TORRENTIO],
  featuredCatalog: null,
  protection: { backend: "file", tmdbHeld: true, stremioHeld: false },
  watchProgress: [],
  devices: [LIVING_ROOM, OFFICE],
  pairingCode: "4K7Q2M",
  address: "192.168.1.9:8090",
};

type Outcome = { response: Response | null; error: ActionError | null };

function ok(response: Response | null = null): Outcome {
  return { response, error: null };
}

function refusal(error: ActionError): Outcome {
  return { response: null, error };
}

function harness(
  overrides: Partial<ShellContextValue> = {},
  snapshot: Snapshot | null = SNAPSHOT,
) {
  const pushed: NewShellLevel[] = [];
  const ask = vi.fn(async (_action: Action): Promise<Outcome> => ok());
  const pop = vi.fn();
  const value: ShellContextValue = {
    snapshot,
    error: null,
    destination: "settings",
    chosenDestination: false,
    popover: null,
    unplayable: new Set<string>(),
    markUnplayable: vi.fn(),
    choose: vi.fn(),
    push: vi.fn((level: NewShellLevel) => {
      pushed.push(level);
      return `level-${pushed.length}`;
    }),
    remove: vi.fn(),
    levelExists: vi.fn(() => true),
    pop,
    back: vi.fn(),
    ask,
    take: vi.fn(async (_action: Action) => null),
    home: new HomeStore(ask),
    setIntentHandler: vi.fn(),
    setBaseIntentHandler: vi.fn(() => () => {}),
    ...overrides,
  };
  return { value, pushed, ask, pop };
}

function withShell(value: ShellContextValue, children: ReactNode) {
  return (
    <ShellContext.Provider value={value}>
      <PreviewDataProvider value={false}>{children}</PreviewDataProvider>
    </ShellContext.Provider>
  );
}

function show(value: ShellContextValue, children: ReactNode) {
  return render(withShell(value, children));
}

function showLevel(level: NewShellLevel, value: ShellContextValue) {
  return show(value, level.render());
}

function actions(ask: ReturnType<typeof harness>["ask"]): Action[] {
  return ask.mock.calls.map(([action]) => action);
}

function categoryLevel(pushed: NewShellLevel[], id: string): NewShellLevel {
  const level = pushed.find((held) => held.id === `settings-${id}`);
  if (!level) {
    throw new Error(`Settings did not push ${id}`);
  }
  return level;
}

describe("the repertory Addons register", () => {
  test("lists the Host's Addons in its order and opens the focused row in place", () => {
    const { value } = harness();
    show(value, <RepertoryAddonsScreen />);

    const rows = within(screen.getByTestId("addons")).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByRole("button")).toHaveAccessibleName(
      new RegExp(CINEMETA.name),
    );
    expect(within(rows[1]!).getByRole("button")).toHaveAccessibleName(
      new RegExp(TORRENTIO.name),
    );
    expect(screen.queryByTestId(`addon-details-${CINEMETA.id}`)).not.toBeInTheDocument();

    const summary = screen.getByTestId(`addon-summary-${CINEMETA.id}`);
    act(() => summary.focus());

    const details = screen.getByTestId(`addon-details-${CINEMETA.id}`);
    expect(details).toHaveTextContent("catalog (movie, series)");
    expect(details).toHaveTextContent("Popular (movie)");
    expect(
      document.activeElement,
      "the row expands around focus; it does not move focus",
    ).toBe(summary);
    expect(within(details).getByRole("button", { name: "Move up" })).toBeDisabled();
    expect(within(details).getByRole("button", { name: "Move down" })).toBeEnabled();
  });

  test("adds a manifest URL, says which Addon arrived, and clears the field", async () => {
    const { value, ask } = harness();
    const added: Snapshot = {
      ...SNAPSHOT,
      revision: 2,
      addons: [...SNAPSHOT.addons, AIOSTREAMS],
    };
    ask.mockImplementationOnce(async () => ok({ snapshots: [added], answer: null }));

    show(value, <RepertoryAddonsScreen />);
    const input = screen.getByLabelText("Addon manifest URL");
    fireEvent.change(input, {
      target: { value: "  https://example.test/manifest.json  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(actions(ask)).toContainEqual({
        type: "add_addon",
        url: "https://example.test/manifest.json",
      }),
    );
    expect(input).toHaveValue("");
    expect(await screen.findByTestId("add-addon-status")).toBeInTheDocument();
  });

  test("keeps a refused manifest beside the form and leaves the URL to correct", async () => {
    const { value, ask } = harness();
    ask.mockImplementationOnce(async () =>
      refusal({ kind: "manifest", detail: "the manifest is missing name" }),
    );

    show(value, <RepertoryAddonsScreen />);
    const input = screen.getByLabelText("Addon manifest URL");
    fireEvent.change(input, { target: { value: "https://example.test/manifest.json" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByTestId("add-addon-error")).toHaveTextContent(
      "could not read that Addon's manifest",
    );
    expect(input).toHaveValue("https://example.test/manifest.json");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  test("moves a row to the 0-based position and refuses past the ends", async () => {
    const { value, ask } = harness();
    show(value, <RepertoryAddonsScreen />);

    act(() => screen.getByTestId(`addon-summary-${CINEMETA.id}`).focus());
    fireEvent.click(screen.getByRole("button", { name: "Move down" }));

    await waitFor(() =>
      expect(actions(ask)).toContainEqual({
        type: "reorder_addon",
        id: CINEMETA.id,
        position: 1,
      }),
    );

    act(() => screen.getByTestId(`addon-summary-${TORRENTIO.id}`).focus());
    expect(screen.getByRole("button", { name: "Move down" })).toBeDisabled();
  });

  test("a refused reorder stays in the row that asked for it", async () => {
    const { value, ask } = harness();
    ask.mockImplementationOnce(async () =>
      refusal({ kind: "invalid_position", position: 3, count: 2 }),
    );
    show(value, <RepertoryAddonsScreen />);
    act(() => screen.getByTestId(`addon-summary-${CINEMETA.id}`).focus());

    const moveDown = screen.getByRole("button", { name: "Move down" });
    act(() => moveDown.focus());
    fireEvent.click(moveDown);

    const row = screen.getByTestId(`addon-${CINEMETA.id}`);
    expect(await within(row).findByRole("alert")).toBeInTheDocument();
    expect(document.activeElement).toBe(moveDown);
  });

  test("removes through a confirmation level, and Back cancels without an Action", () => {
    const { value, pushed, ask, pop } = harness();
    show(value, <RepertoryAddonsScreen />);
    act(() => screen.getByTestId(`addon-summary-${TORRENTIO.id}`).focus());
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    const confirm = pushed.at(-1);
    expect(confirm?.name).toBe("Remove Torrentio?");
    expect(actions(ask)).toEqual([]);

    const view = showLevel(confirm!, value);
    fireEvent.click(within(view.container).getByRole("button", { name: "Cancel" }));

    expect(pop).toHaveBeenCalled();
    expect(actions(ask)).toEqual([]);
  });

  test("after a removal, focus steps to the Addon before it", async () => {
    const { value, pushed, ask } = harness();
    const view = show(value, <RepertoryAddonsScreen />);
    act(() => screen.getByTestId(`addon-summary-${TORRENTIO.id}`).focus());
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    const confirmView = showLevel(pushed.at(-1)!, value);
    fireEvent.click(within(confirmView.container).getByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(actions(ask)).toContainEqual({ type: "remove_addon", id: TORRENTIO.id }),
    );
    confirmView.unmount();

    view.rerender(
      withShell(
        { ...value, snapshot: { ...SNAPSHOT, addons: [CINEMETA] } },
        <RepertoryAddonsScreen />,
      ),
    );

    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByTestId(`addon-summary-${CINEMETA.id}`),
      ),
    );
  });

  test("after removing the last Addon, focus returns to the form", async () => {
    const { value, pushed, ask } = harness();
    const view = show(value, <RepertoryAddonsScreen />);
    act(() => screen.getByTestId(`addon-summary-${CINEMETA.id}`).focus());
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    const confirmView = showLevel(pushed.at(-1)!, value);
    fireEvent.click(within(confirmView.container).getByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(actions(ask)).toContainEqual({ type: "remove_addon", id: CINEMETA.id }),
    );
    confirmView.unmount();

    view.rerender(
      withShell(
        { ...value, snapshot: { ...SNAPSHOT, addons: [] } },
        <RepertoryAddonsScreen />,
      ),
    );

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId("add-addon-submit")),
    );
  });

  test("with no Addons the register says so and points at the form", () => {
    const { value } = harness({}, { ...SNAPSHOT, addons: [] });
    show(value, <RepertoryAddonsScreen />);

    expect(screen.getByTestId("addons-empty")).toHaveTextContent(
      "No Addons are configured yet",
    );
    expect(screen.getByLabelText("Addon manifest URL")).toBeInTheDocument();
    expect(screen.queryByTestId("addons")).not.toBeInTheDocument();
  });
});

describe("the repertory Settings register", () => {
  test("pushes each of the four categories as its own level", () => {
    const { value, pushed } = harness();
    show(value, <RepertorySettingsScreen />);

    for (const category of SETTINGS_CATEGORIES) {
      fireEvent.click(screen.getByTestId(`settings-category-${category.id}`));
      expect(pushed.at(-1)).toMatchObject({
        id: `settings-${category.id}`,
        name: `Settings — ${category.title}`,
        kind: "overlay",
      });
    }
  });

  test("each sub-screen starts with Back, which pops the level", () => {
    const { value, pushed, pop } = harness();
    show(value, <RepertorySettingsScreen />);
    fireEvent.click(screen.getByTestId("settings-category-credentials"));

    const credentials = categoryLevel(pushed, "credentials");
    const view = showLevel(credentials, value);
    const back = screen.getByTestId("settings-credentials-back");
    expect(back, "a pushed leaf opens on the way out").toHaveFocus();
    fireEvent.click(back);

    expect(pop).toHaveBeenCalled();
    view.unmount();
  });

  test("Credentials reads the protection and dispatches a trimmed TMDB key", async () => {
    const { value, pushed, ask } = harness();
    show(value, <RepertorySettingsScreen />);
    fireEvent.click(screen.getByTestId("settings-category-credentials"));
    showLevel(categoryLevel(pushed, "credentials"), value);

    expect(screen.getByTestId("protection-backend")).toBeInTheDocument();
    expect(screen.getByTestId("protection-tmdb")).toBeInTheDocument();
    expect(screen.getByTestId("protection-stremio")).toBeInTheDocument();

    const input = screen.getByLabelText("TMDB API key or read-access token");
    fireEvent.change(input, { target: { value: "  abc123  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));

    await waitFor(() =>
      expect(actions(ask)).toContainEqual({ type: "set_tmdb_key", key: "abc123" }),
    );
    expect(input).toHaveValue("");
    expect(await screen.findByTestId("tmdb-key-status")).toBeInTheDocument();
  });

  test("a refused TMDB key stays beside the form", async () => {
    const { value, pushed, ask } = harness();
    ask.mockImplementationOnce(async () =>
      refusal({ kind: "invalid_tmdb_key", detail: "the key is too short" }),
    );
    show(value, <RepertorySettingsScreen />);
    fireEvent.click(screen.getByTestId("settings-category-credentials"));
    showLevel(categoryLevel(pushed, "credentials"), value);

    const input = screen.getByLabelText("TMDB API key or read-access token");
    fireEvent.change(input, { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));

    expect(await screen.findByTestId("tmdb-key-error")).toHaveTextContent(
      "The Host will not keep that TMDB key",
    );
    expect(input).toHaveValue("short");
  });

  test("Credentials clears the key through a confirmation", async () => {
    const { value, pushed, ask, pop } = harness();
    show(value, <RepertorySettingsScreen />);
    fireEvent.click(screen.getByTestId("settings-category-credentials"));
    showLevel(categoryLevel(pushed, "credentials"), value);

    const input = screen.getByLabelText("TMDB API key or read-access token");
    fireEvent.change(input, { target: { value: "abc123" } });
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));
    expect(await screen.findByTestId("tmdb-key-status")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear key" }));
    const confirm = pushed.at(-1);
    expect(confirm?.name).toBe("Clear the TMDB key?");
    const view = showLevel(confirm!, value);
    fireEvent.click(within(view.container).getByRole("button", { name: "Clear key" }));

    await waitFor(() =>
      expect(actions(ask)).toContainEqual({ type: "clear_tmdb_key" }),
    );
    await waitFor(() =>
      expect(screen.queryByTestId("tmdb-key-status")).not.toBeInTheDocument(),
    );
    expect(pop).toHaveBeenCalled();
  });

  test("a held Stremio account signs out through a confirmation", async () => {
    const { value, pushed, ask, pop } = harness(
      {},
      {
        ...SNAPSHOT,
        protection: { ...SNAPSHOT.protection, stremioHeld: true },
      },
    );
    show(value, <RepertorySettingsScreen />);
    fireEvent.click(screen.getByTestId("settings-category-credentials"));
    showLevel(categoryLevel(pushed, "credentials"), value);

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    const confirm = pushed.at(-1);
    expect(confirm?.name).toBe("Sign out of Stremio?");
    const view = showLevel(confirm!, value);
    fireEvent.click(within(view.container).getByRole("button", { name: "Sign out" }));

    await waitFor(() =>
      expect(actions(ask)).toContainEqual({ type: "sign_out_stremio" }),
    );
    expect(pop).toHaveBeenCalled();
  });

  test("Preferences dispatches the language, the buffer pair, and the featured catalog", async () => {
    const { value, pushed, ask } = harness();
    show(value, <RepertorySettingsScreen />);
    fireEvent.click(screen.getByTestId("settings-category-preferences"));
    showLevel(categoryLevel(pushed, "preferences"), value);

    fireEvent.click(screen.getByTestId("language-pt-BR"));
    await waitFor(() =>
      expect(actions(ask)).toContainEqual({
        type: "set_subtitle_language",
        language: "pt-BR",
      }),
    );

    fireEvent.click(screen.getByTestId("buffer-seconds-600"));
    await waitFor(() =>
      expect(actions(ask)).toContainEqual({
        type: "set_stream_buffer",
        seconds: 600,
        megabytes: 512,
      }),
    );

    // The second press composes from the first, before the Host answers.
    fireEvent.click(screen.getByTestId("buffer-megabytes-1024"));
    await waitFor(() =>
      expect(actions(ask)).toContainEqual({
        type: "set_stream_buffer",
        seconds: 600,
        megabytes: 1024,
      }),
    );

    fireEvent.click(screen.getByTestId(`featured-${CINEMETA.id}/movie/top`));
    await waitFor(() =>
      expect(actions(ask)).toContainEqual({
        type: "set_featured_catalog",
        addon: CINEMETA.id,
        catalog: { type: "movie", id: "top" },
      }),
    );
  });

  test("values outside the presets are one Other chip, still selected", () => {
    const { value, pushed } = harness(
      {},
      {
        ...SNAPSHOT,
        preferences: {
          ...SNAPSHOT.preferences,
          subtitleLanguage: "fr-CA",
          subtitleColor: "#123456",
        },
      },
    );
    show(value, <RepertorySettingsScreen />);
    fireEvent.click(screen.getByTestId("settings-category-preferences"));
    showLevel(categoryLevel(pushed, "preferences"), value);

    expect(screen.getByTestId("language-fr-CA")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("subtitle-color-other")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("a refused subtitle colour is explained beside the appearance choices", async () => {
    const { value, pushed, ask } = harness();
    ask.mockImplementationOnce(async () =>
      refusal({ kind: "invalid_subtitle_color", color: "#00FFFF" }),
    );
    show(value, <RepertorySettingsScreen />);
    fireEvent.click(screen.getByTestId("settings-category-preferences"));
    showLevel(categoryLevel(pushed, "preferences"), value);

    fireEvent.click(screen.getByTestId("subtitle-color-cyan"));

    expect(await screen.findByTestId("subtitle-appearance-error")).toHaveTextContent(
      '"#00FFFF" is not a subtitle colour',
    );
  });

  test("the Featured catalog says when no Addon offers one", () => {
    const { value, pushed } = harness({}, { ...SNAPSHOT, addons: [TORRENTIO] });
    show(value, <RepertorySettingsScreen />);
    fireEvent.click(screen.getByTestId("settings-category-preferences"));
    showLevel(categoryLevel(pushed, "preferences"), value);

    expect(screen.getByTestId("featured-empty")).toBeInTheDocument();
    expect(screen.getByTestId("featured-none")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("Remote devices draws the address, code and devices, then revokes through a confirmation", async () => {
    const { value, pushed, ask, pop } = harness();
    show(value, <RepertorySettingsScreen />);
    fireEvent.click(screen.getByTestId("settings-category-remote-devices"));
    showLevel(categoryLevel(pushed, "remote-devices"), value);

    expect(screen.getByTestId("remote-address")).toHaveTextContent("192.168.1.9:8090");
    expect(screen.getByTestId("pairing-code")).toHaveTextContent("4K7Q2M");
    expect(screen.getByTestId(`device-${LIVING_ROOM.id}`)).toHaveTextContent("Living room");
    expect(screen.getByTestId(`device-${OFFICE.id}`)).toHaveTextContent("Office");

    fireEvent.click(screen.getByRole("button", { name: `Revoke ${OFFICE.name}` }));
    const confirm = pushed.at(-1);
    expect(confirm?.name).toBe(`Revoke ${OFFICE.name}?`);

    const view = showLevel(confirm!, value);
    fireEvent.click(within(view.container).getByRole("button", { name: "Revoke" }));
    await waitFor(() =>
      expect(actions(ask)).toContainEqual({
        type: "revoke_device",
        id: OFFICE.id,
      }),
    );
    expect(pop).toHaveBeenCalled();
  });

  test("after a revoke, focus steps to the device before it", async () => {
    const { value, pushed, ask } = harness();
    const view = show(value, <RepertorySettingsScreen />);
    fireEvent.click(screen.getByTestId("settings-category-remote-devices"));
    const level = categoryLevel(pushed, "remote-devices");
    const levelView = showLevel(level, value);

    fireEvent.click(screen.getByRole("button", { name: `Revoke ${OFFICE.name}` }));
    const confirmView = showLevel(pushed.at(-1)!, value);
    fireEvent.click(within(confirmView.container).getByRole("button", { name: "Revoke" }));
    await waitFor(() =>
      expect(actions(ask)).toContainEqual({ type: "revoke_device", id: OFFICE.id }),
    );
    confirmView.unmount();

    levelView.rerender(
      withShell(
        { ...value, snapshot: { ...SNAPSHOT, devices: [LIVING_ROOM] } },
        level.render(),
      ),
    );

    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: `Revoke ${LIVING_ROOM.name}` }),
      ),
    );
    view.unmount();
  });

  test("Remote devices names an empty paired list", () => {
    const { value, pushed } = harness({}, { ...SNAPSHOT, devices: [] });
    show(value, <RepertorySettingsScreen />);
    fireEvent.click(screen.getByTestId("settings-category-remote-devices"));
    showLevel(categoryLevel(pushed, "remote-devices"), value);

    expect(screen.getByTestId("no-devices")).toBeInTheDocument();
  });

  test("Remote devices waits for the Host instead of claiming an empty list", () => {
    const { value, pushed } = harness({}, null);
    show(value, <RepertorySettingsScreen />);
    fireEvent.click(screen.getByTestId("settings-category-remote-devices"));
    showLevel(categoryLevel(pushed, "remote-devices"), value);

    expect(screen.queryByTestId("no-devices")).not.toBeInTheDocument();
  });

  test("About carries the TMDB notice, version and licence", () => {
    const { value, pushed } = harness();
    show(value, <RepertorySettingsScreen />);
    fireEvent.click(screen.getByTestId("settings-category-about"));
    showLevel(categoryLevel(pushed, "about"), value);

    expect(screen.getByTestId("tmdb-notice")).toBeInTheDocument();
    expect(screen.getByTestId("app-version")).toHaveTextContent("0.1.0");
    expect(screen.getByTestId("license-credits")).toBeInTheDocument();
  });
});

function fakeHostClient(snapshot: Snapshot): HostClient {
  const transport: Transport = {
    invoke: async <T,>(command: string): Promise<T> => {
      if (command === "snapshot") {
        return snapshot as T;
      }
      return { snapshots: [], answer: null } as T;
    },
    listen: async <T,>(_event: string, _handler: (event: { payload: T }) => void) => {
      return () => undefined;
    },
  };
  return new HostClient(transport);
}

describe("the repertory frame's destinations", () => {
  test("routes every destination, and pushes Credentials from the register", async () => {
    render(<Shell client={fakeHostClient(SNAPSHOT)} />);

    fireEvent.click(await screen.findByRole("button", { name: "Addons" }));
    expect(await screen.findByRole("heading", { name: "Addons" })).toBeInTheDocument();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Addons" })),
    );

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Settings" })),
    );

    fireEvent.click(screen.getByTestId("settings-category-credentials"));
    expect(await screen.findByRole("heading", { name: "Credentials" })).toBeInTheDocument();

    // A Settings leaf leaves the spine live, so another destination can be
    // chosen without backing out of the leaf first.
    expect(
      screen.getByRole("navigation", { name: "Destinations" }).closest("[inert]"),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Addons" }));
    expect(await screen.findByRole("heading", { name: "Addons" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Credentials" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Discover" }));
    expect(await screen.findByTestId("discover-screen")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByTestId("search-screen")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Library" }));
    expect(await screen.findByTestId("library-gate")).toBeInTheDocument();
  });

  test("a Settings leaf keeps the spine live, and Back restores the row that opened it", async () => {
    render(<Shell client={fakeHostClient(SNAPSHOT)} />);

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    const category = await screen.findByTestId("settings-category-credentials");
    act(() => category.focus());
    fireEvent.click(category);

    expect(await screen.findByRole("heading", { name: "Credentials" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "Credentials" }),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(document.activeElement).toBe(category));
  });

  test("Back from the Addons base returns to Home", async () => {
    render(<Shell client={fakeHostClient(SNAPSHOT)} />);

    fireEvent.click(await screen.findByRole("button", { name: "Addons" }));
    expect(await screen.findByRole("heading", { name: "Addons" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(await screen.findByTestId("home-screen")).toBeInTheDocument();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Home" })),
    );
  });
});

function libraryEntry(overrides: Partial<LibraryEntry> = {}): LibraryEntry {
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

function libraryAnswer(
  entries: LibraryEntry[],
  failure: ActionError | null = null,
): Response {
  return { snapshots: [], answer: { library: { entries, failure } } };
}

function heldLibraryHarness(entries: LibraryEntry[], failure: ActionError | null = null) {
  const { value, ask, ...rest } = harness(
    {},
    { ...SNAPSHOT, protection: { ...SNAPSHOT.protection, stremioHeld: true } },
  );
  ask.mockImplementation(async (action) =>
    action.type === "library" ? ok(libraryAnswer(entries, failure)) : ok(),
  );
  return { value, ask, ...rest };
}

describe("the repertory Library", () => {
  test("with no account, draws the gate and dispatches the Stremio sign-in", async () => {
    const { value, ask } = harness();
    show(value, <RepertoryLibraryScreen />);

    expect(screen.getByTestId("library-gate")).toHaveTextContent(
      "Your Library holds the Titles saved in your Stremio account",
    );
    expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Stremio email"), {
      target: { value: "  you@example.test  " },
    });
    fireEvent.change(screen.getByLabelText("Stremio password"), {
      target: { value: "hunter2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() =>
      expect(actions(ask)).toContainEqual({
        type: "sign_in_stremio",
        email: "you@example.test",
        password: "hunter2",
      }),
    );
  });

  test("reads the account Library, keeps its order, and marks a position past the start", async () => {
    const entries = [
      libraryEntry({
        id: "tt0903747",
        name: "Breaking Bad",
        type: "series",
        mtime: 1_700_300_000_000,
        videoId: "tt0903747:5:14",
        position: 612,
        duration: 2820,
        continueWatching: true,
      }),
      libraryEntry({
        id: "tt0133093",
        name: "The Matrix",
        mtime: 1_700_100_000_000,
      }),
    ];
    const { value, ask } = heldLibraryHarness(entries);
    show(value, <RepertoryLibraryScreen />);

    expect(await screen.findByTestId("library-grid")).toBeInTheDocument();
    const cards = within(screen.getByTestId("library-grid")).getAllByRole("button");
    expect(cards.map((card) => card.getAttribute("data-testid"))).toEqual([
      "library-card-tt0903747",
      "library-card-tt0133093",
    ]);
    expect(screen.getByTestId("library-card-tt0903747")).toHaveTextContent("Continue");
    expect(screen.getByTestId("library-card-tt0133093")).not.toHaveTextContent("Continue");
    expect(actions(ask)).toContainEqual({ type: "library" });
    expect(screen.queryByTestId("library-gate")).not.toBeInTheDocument();
  });

  test("opens a Library Title through the Addon that answers its meta", async () => {
    const entries = [libraryEntry()];
    const { value } = heldLibraryHarness(entries);
    show(value, <RepertoryLibraryScreen />);

    const card = await screen.findByTestId("library-card-tt0133093");
    fireEvent.click(card);

    await waitFor(() =>
      expect(value.take).toHaveBeenCalledWith({
        type: "open_title",
        addon: CINEMETA.id,
        title: { type: "movie", id: "tt0133093" },
      }),
    );
  });

  test("an expired session is a failure that asks for sign-in again, not an empty room", async () => {
    const failure: ActionError = {
      kind: "library",
      detail: "Stremio refused the request: Session does not exist",
    };
    const { value } = heldLibraryHarness([], failure);
    show(value, <RepertoryLibraryScreen />);

    expect(await screen.findByTestId("library-failure")).toHaveTextContent(
      "Session does not exist",
    );
    expect(screen.getByLabelText("Stremio email")).toBeInTheDocument();
    expect(screen.getByLabelText("Stremio password")).toBeInTheDocument();
    expect(screen.queryByTestId("library-empty")).not.toBeInTheDocument();
  });

  test("an empty account is an empty room, not a failure", async () => {
    const { value } = heldLibraryHarness([]);
    show(value, <RepertoryLibraryScreen />);

    expect(await screen.findByTestId("library-empty")).toHaveTextContent(
      "The Library is empty.",
    );
    expect(screen.queryByTestId("library-failure")).not.toBeInTheDocument();
  });
});

describe("the repertory Library's unopenable entries", () => {
  test("keeps the picture and the Unplayable mark, and is not a control", async () => {
    const { value } = heldLibraryHarness([
      libraryEntry({ id: "kitsu:123", name: "A Title No Addon Knows" }),
    ]);
    show(value, <RepertoryLibraryScreen />);

    const card = await screen.findByTestId("library-card-kitsu:123");
    expect(within(card).getByText("Unplayable")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /A Title No Addon Knows/ }),
    ).not.toBeInTheDocument();

    fireEvent.click(card);
    expect(value.take).not.toHaveBeenCalled();
  });
});
