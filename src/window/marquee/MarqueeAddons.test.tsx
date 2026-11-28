import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import { useState, type ReactNode } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import type { ActionError } from "../../core/errors";
import { HomeStore } from "../../core/homeStore";
import type { Intent } from "../../core/input";
import { markNavigation, markPointer } from "../../core/inputModality";
import type { Action, AddonManifest, Response, Snapshot } from "../../core/wire";
import { ShellContext, type ActionOutcome, type NewShellLevel, type ShellContextValue } from "../context";
import type { ShellLevel } from "../navigation";
import { previewTransport } from "../repertory/previewHost";
import { quietSession } from "../session.testing";
import { MarqueeAddons } from "./MarqueeAddons";
import { MarqueeFrame } from "./MarqueeFrame";

let previousSkipAnimations: boolean | undefined;
beforeAll(() => {
  previousSkipAnimations = MotionGlobalConfig.skipAnimations;
  MotionGlobalConfig.skipAnimations = true;
});
afterAll(() => {
  MotionGlobalConfig.skipAnimations = previousSkipAnimations;
});

beforeEach(() => {
  markNavigation();
});

afterEach(() => {
  cleanup();
  markPointer();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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
  enabled: true,
};

const TORRENTIO: AddonManifest = {
  id: "torrentio",
  name: "Torrentio",
  version: "0.0.15",
  resources: [{ name: "stream", types: ["movie", "series"], idPrefixes: ["tt"] }],
  types: ["movie", "series"],
  catalogs: [],
  idPrefixes: ["tt"],
  behaviorHints: { configurable: false, configurationRequired: false },
  enabled: true,
};

const AIOSTREAMS: AddonManifest = {
  ...TORRENTIO,
  id: "aiostreams",
  name: "AIOStreams",
  version: "1.4.2",
};

const BASE_SNAPSHOT: Snapshot = {
  revision: 1,
  playback: {
    state: "idle",
    autoplay: null,
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
    stalled: false,
    torrent: null,
    crop: null,
    aspect: null,
    resolution: null,
    statistics: null,
  },
  preferences: {
    subtitleLanguages: [],
    audioLanguages: [],
    subtitleColor: "#FFFFFF",
    subtitleScale: 1,
    streamBuffer: { seconds: 300, megabytes: 512 },
    torrentCache: { megabytes: 2000 },
    upNextPlayback: "direct",
    autoplay: true,
  },
  addons: [CINEMETA, TORRENTIO],
  featuredCatalog: { addon: CINEMETA.id, catalog: { type: "movie", id: "top" } },
  protection: { backend: "file", tmdbHeld: false, stremioHeld: false },
  continueWatching: [],
  watchProgress: [],
  devices: [],
  pairingCode: "K7QX4M",
  address: null,
};

function ok(response: Response | null = null): ActionOutcome {
  return { response, error: null };
}

function refusal(error: ActionError): ActionOutcome {
  return { response: null, error };
}

function harness(snapshot: Snapshot | null = BASE_SNAPSHOT) {
  const pushed: NewShellLevel[] = [];
  const ask = vi.fn(async (_action: Action): Promise<ActionOutcome> => ok());
  const pop = vi.fn();
  let registeredIntent: ((intent: Intent) => boolean) | null = null;

  const value: ShellContextValue = {
    session: quietSession(),
    snapshot,
    error: null,
    destination: "addons",
    chosenDestination: true,
    popover: null,
    unplayable: new Set<string>(),
    pending: new Set<string>(),
    markUnplayable: vi.fn(),
    choose: vi.fn(),
    push: vi.fn((level: NewShellLevel) => {
      pushed.push(level);
      return level.id ?? `level-${pushed.length}`;
    }),
    remove: vi.fn(),
    levelExists: vi.fn(() => true),
    pop,
    back: vi.fn(),
    ask,
    take: vi.fn(async (_action: Action) => null),
    hint: vi.fn(),
    home: new HomeStore(ask),
    setIntentHandler: vi.fn(),
    setBaseIntentHandler: vi.fn((handler) => {
      registeredIntent = handler as typeof registeredIntent;
      return () => {
        if (registeredIntent === handler) {
          registeredIntent = null;
        }
      };
    }),
  };

  return {
    value,
    pushed,
    ask,
    pop,
    sendIntent: (intent: Intent) => registeredIntent?.(intent) ?? false,
  };
}

function withShell(value: ShellContextValue, children: ReactNode) {
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

function actions(ask: ReturnType<typeof harness>["ask"]): Action[] {
  return ask.mock.calls.map(([action]) => action);
}

/** Integrated frame harness so Confirm push/pop, Escape, and focus restore run end-to-end. */
function AddonsFrameHarness({
  snapshot = BASE_SNAPSHOT,
}: {
  snapshot?: Snapshot | null;
}) {
  const [levels, setLevels] = useState<ShellLevel[]>([]);
  const [destination, setDestination] = useState<"addons" | "home">("addons");
  const ask = vi.fn(async () => ok());

  const push = (level: NewShellLevel) => {
    const id = level.id ?? `level-${levels.length + 1}`;
    const full: ShellLevel = { ...level, id };
    setLevels((held) => [...held.filter((item) => item.id !== id), full]);
    return id;
  };
  const pop = () => setLevels((held) => held.slice(0, -1));
  const back = () => {
    if (levels.length > 0) {
      pop();
    } else {
      setDestination("home");
    }
  };

  const value: ShellContextValue = {
    session: quietSession(),
    snapshot,
    error: null,
    destination,
    chosenDestination: true,
    popover: null,
    unplayable: new Set<string>(),
    pending: new Set<string>(),
    markUnplayable: vi.fn(),
    choose: (next) => {
      setDestination(next === "home" ? "home" : "addons");
      setLevels([]);
    },
    push,
    remove: (id) => setLevels((held) => held.filter((item) => item.id !== id)),
    levelExists: (id) => levels.some((item) => item.id === id),
    pop,
    back,
    ask,
    take: vi.fn(async () => null),
    hint: vi.fn(),
    home: new HomeStore(ask),
    setIntentHandler: vi.fn(),
    setBaseIntentHandler: vi.fn(() => () => {}),
  };

  return (
    <ShellContext.Provider value={value}>
      <MarqueeFrame
        destination={destination}
        onChooseDestination={(next) => {
          setDestination(next === "home" ? "home" : "addons");
          setLevels([]);
        }}
        levels={levels}
        onBack={back}
        screen={
          destination === "addons" ? (
            <MarqueeAddons />
          ) : (
            <div data-testid="home-base">Home</div>
          )
        }
      />
    </ShellContext.Provider>
  );
}

describe("Marquee Addons boundary (ADR-0032)", () => {
  test("lists Addons in Host order and toggles enable/disable via set_addon_enabled", async () => {
    const { value, ask } = harness();
    render(withShell(value, <MarqueeAddons />));

    const items = within(screen.getByTestId("addons")).getAllByRole("listitem");
    expect(items).toHaveLength(2);

    fireEvent.click(screen.getByRole("switch", { name: "Enable Torrentio" }));
    await waitFor(() =>
      expect(actions(ask)).toContainEqual({
        type: "set_addon_enabled",
        addon: TORRENTIO.id,
        enabled: false,
      }),
    );

    const disabledHarness = harness({
      ...BASE_SNAPSHOT,
      addons: [CINEMETA, { ...TORRENTIO, enabled: false }],
    });
    cleanup();
    render(withShell(disabledHarness.value, <MarqueeAddons />));
    fireEvent.click(screen.getByRole("switch", { name: "Enable Torrentio" }));
    await waitFor(() =>
      expect(actions(disabledHarness.ask)).toContainEqual({
        type: "set_addon_enabled",
        addon: TORRENTIO.id,
        enabled: true,
      }),
    );
  });

  test("installs a trimmed manifest URL, shows status, and keeps refused URLs for correction", async () => {
    const { value, ask } = harness();
    const added: Snapshot = {
      ...BASE_SNAPSHOT,
      revision: 2,
      addons: [...BASE_SNAPSHOT.addons, AIOSTREAMS],
    };
    ask.mockImplementationOnce(async () => ok({ snapshots: [added], answer: null }));

    render(withShell(value, <MarqueeAddons />));
    const input = screen.getByLabelText("Install an Addon");
    fireEvent.change(input, { target: { value: "  https://example.test/manifest.json  " } });
    fireEvent.click(screen.getByTestId("add-addon-submit"));

    await waitFor(() =>
      expect(actions(ask)).toContainEqual({
        type: "add_addon",
        url: "https://example.test/manifest.json",
      }),
    );
    expect(input).toHaveValue("");
    expect(await screen.findByTestId("add-addon-status")).toBeInTheDocument();

    ask.mockImplementationOnce(async () =>
      refusal({ kind: "manifest", detail: "the manifest is missing name" }),
    );
    fireEvent.change(input, { target: { value: "https://broken.test/manifest.json" } });
    fireEvent.click(screen.getByTestId("add-addon-submit"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "could not read that Addon's manifest",
    );
    expect(input).toHaveValue("https://broken.test/manifest.json");
  });

  test("Details shows only existing Manifest fields and never exposes URL, origin, or OFFLINE (ADR-0009, ADR-0044 §1)", () => {
    const { value } = harness();
    render(withShell(value, <MarqueeAddons />));

    const cinemetaMain = screen.getByRole("button", { name: CINEMETA.name });
    act(() => cinemetaMain.focus());
    fireEvent.click(screen.getByRole("button", { name: "Details" }));

    const details = screen.getByTestId(`addon-details-${CINEMETA.id}`);
    expect(details).toHaveTextContent("Version");
    expect(details).toHaveTextContent("3.0.14");
    expect(details).toHaveTextContent("Id");
    expect(details).toHaveTextContent("com.linvo.cinemeta");
    expect(details).toHaveTextContent("Serves");
    expect(details).toHaveTextContent("catalog (movie, series), meta (movie, series)");
    expect(details).toHaveTextContent("Types");
    expect(details).toHaveTextContent("movie, series");
    expect(details).toHaveTextContent("Catalogs");
    expect(details).toHaveTextContent("Popular (movie)");

    const screenText = screen.getByTestId("addons-screen").textContent ?? "";
    expect(screenText).not.toMatch(/http|manifest\.json|OFFLINE/i);
  });

  test("moving mode sends reorder_addon on Move up/down, steps with arrows and intents, and places on OK", async () => {
    const { value, ask, sendIntent } = harness();
    const view = render(withShell(value, <MarqueeAddons />));

    const cinemetaMain = screen.getByRole("button", { name: CINEMETA.name });
    act(() => cinemetaMain.focus());
    expect(screen.getByRole("button", { name: "Move up" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Move down" }));
    await waitFor(() =>
      expect(actions(ask)).toContainEqual({
        type: "reorder_addon",
        id: CINEMETA.id,
        position: 1,
      }),
    );

    // Rerender with updated Host order so Cinemeta is now at index 1.
    view.rerender(
      withShell(
        { ...value, snapshot: { ...BASE_SNAPSHOT, addons: [TORRENTIO, CINEMETA] } },
        <MarqueeAddons />,
      ),
    );
    expect(cinemetaMain).toHaveFocus();
    expect(screen.getByText("Up and down to move · OK to place")).toBeInTheDocument();

    // Keyboard ArrowUp moves Cinemeta back to 0.
    fireEvent.keyDown(cinemetaMain, { key: "ArrowUp" });
    await waitFor(() =>
      expect(actions(ask)).toContainEqual({
        type: "reorder_addon",
        id: CINEMETA.id,
        position: 0,
      }),
    );

    // Gamepad/spatial intent Up/Down routed while moving, and OK places.
    view.rerender(
      withShell(
        { ...value, snapshot: { ...BASE_SNAPSHOT, addons: [CINEMETA, TORRENTIO] } },
        <MarqueeAddons />,
      ),
    );
    expect(sendIntent("left")).toBe(true);
    expect(sendIntent("down")).toBe(true);
    await waitFor(() => expect(actions(ask).filter((a) => a.type === "reorder_addon")).toHaveLength(3));

    fireEvent.click(cinemetaMain);
    expect(screen.queryByText("Up and down to move · OK to place")).not.toBeInTheDocument();
  });

  test("Remove opens a Confirm level with initial focus on Cancel and re-homes focus after removal", async () => {
    const { value, pushed, ask, pop } = harness();
    const view = render(withShell(value, <MarqueeAddons />));

    act(() => screen.getByRole("button", { name: TORRENTIO.name }).focus());
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    const confirmLevel = pushed.at(-1);
    expect(confirmLevel?.name).toBe("Remove Torrentio?");
    expect(actions(ask)).toEqual([]);

    const confirmView = render(withShell(value, confirmLevel!.payload.render()));
    expect(within(confirmView.container).getByRole("button", { name: "Cancel" })).toHaveFocus();

    fireEvent.click(within(confirmView.container).getByRole("button", { name: "Cancel" }));
    expect(pop).toHaveBeenCalledOnce();
    expect(actions(ask)).toEqual([]);

    fireEvent.click(within(confirmView.container).getByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(actions(ask)).toContainEqual({ type: "remove_addon", id: TORRENTIO.id }),
    );
    confirmView.unmount();

    view.rerender(
      withShell(
        { ...value, snapshot: { ...BASE_SNAPSHOT, addons: [CINEMETA] } },
        <MarqueeAddons />,
      ),
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: CINEMETA.name })),
    );
  });

  test("renders EmptyState when no Addons are configured", () => {
    const { value } = harness({ ...BASE_SNAPSHOT, addons: [] });
    render(withShell(value, <MarqueeAddons />));

    expect(screen.getByTestId("addons-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("addons")).not.toBeInTheDocument();
  });

  test("integrates with MarqueeFrame so Escape from Confirm pops back to Addons", async () => {
    render(<AddonsFrameHarness />);

    const row = screen.getByTestId(`addon-${TORRENTIO.id}`);
    const mainButton = within(row).getByRole("button", { name: TORRENTIO.name });
    act(() => mainButton.focus());

    const removeButton = within(row).getByRole("button", { name: "Remove" });
    act(() => removeButton.focus());
    fireEvent.click(removeButton);

    expect(
      await screen.findByRole("dialog", { name: `Remove ${TORRENTIO.name}?` }),
    ).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: `Remove ${TORRENTIO.name}?` }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("addons-screen")).toBeInTheDocument();
    expect(row.contains(document.activeElement)).toBe(true);
  });
});

describe("previewHost Addon enable/disable mirror (ADR-0044 §2)", () => {
  test("hides featuredCatalog while Addon is disabled and refuses browse_catalog and set_featured_catalog with addon_disabled", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ metas: [] }),
      })),
    );

    const initial = await previewTransport.invoke<Snapshot>("snapshot");
    expect(initial.featuredCatalog).toEqual({
      addon: "cinemeta",
      catalog: { type: "movie", id: "top" },
    });

    const disabled = await previewTransport.invoke<Response>("dispatch", {
      envelope: { action: { type: "set_addon_enabled", addon: "cinemeta", enabled: false } },
    });
    expect(disabled.snapshots[0]?.featuredCatalog).toBeNull();

    await expect(
      previewTransport.invoke("dispatch", {
        envelope: {
          action: {
            type: "browse_catalog",
            addon: "cinemeta",
            catalog: { type: "movie", id: "top" },
            extra: [],
          },
        },
      }),
    ).rejects.toMatchObject({ kind: "addon_disabled", id: "cinemeta" });

    await expect(
      previewTransport.invoke("dispatch", {
        envelope: {
          action: {
            type: "set_featured_catalog",
            addon: "cinemeta",
            catalog: { type: "movie", id: "top" },
          },
        },
      }),
    ).rejects.toMatchObject({ kind: "addon_disabled", id: "cinemeta" });

    // Re-enabling restores the held featuredCatalog automatically.
    const reenabled = await previewTransport.invoke<Response>("dispatch", {
      envelope: { action: { type: "set_addon_enabled", addon: "cinemeta", enabled: true } },
    });
    expect(reenabled.snapshots[0]?.featuredCatalog).toEqual({
      addon: "cinemeta",
      catalog: { type: "movie", id: "top" },
    });
  });
});
