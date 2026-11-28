import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import { useState, type ReactNode } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import type { ActionError } from "../../core/errors";
import { HomeStore } from "../../core/homeStore";
import { markNavigation, markPointer } from "../../core/inputModality";
import { SETTINGS_CATEGORIES } from "../../core/settingsRegister";
import type { Action, AddonManifest, DeviceSummary, Response, Snapshot } from "../../core/wire";
import { ShellContext, type ActionOutcome, type NewShellLevel, type ShellContextValue } from "../context";
import { readLevel } from "../layout";
import type { ShellLevel } from "../navigation";
import { quietSession } from "../session.testing";
import { MarqueeFrame } from "./MarqueeFrame";
import { MarqueeSettings, marqueeCredentialsLevel } from "./MarqueeSettings";

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
  vi.restoreAllMocks();
});

const CINEMETA: AddonManifest = {
  id: "cinemeta",
  name: "Cinemeta",
  version: "3.0.14",
  resources: [{ name: "catalog", types: ["movie"], idPrefixes: null }],
  types: ["movie"],
  catalogs: [
    { type: "movie", id: "top", name: "Popular", extra: [] },
  ],
  idPrefixes: ["tt"],
  behaviorHints: { configurable: false, configurationRequired: false },
  enabled: true,
};

const LIVING_ROOM: DeviceSummary = {
  id: "device-living-room",
  name: "Living-room phone",
  pairedAt: Date.UTC(2026, 10, 12, 12, 0),
};

const TABLET: DeviceSummary = {
  id: "device-tablet",
  name: "Tablet",
  pairedAt: Date.UTC(2026, 9, 3, 12, 0),
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
    subtitleLanguages: ["en"],
    audioLanguages: [],
    subtitleColor: "#FFFFFF",
    subtitleScale: 1,
    streamBuffer: { seconds: 300, megabytes: 512 },
    torrentCache: { megabytes: 2000 },
    upNextPlayback: "direct",
    autoplay: true,
  },
  addons: [CINEMETA],
  featuredCatalog: { addon: "cinemeta", catalog: { type: "movie", id: "top" } },
  protection: { backend: "keyring", tmdbHeld: true, stremioHeld: false },
  continueWatching: [],
  watchProgress: [],
  devices: [LIVING_ROOM, TABLET],
  pairingCode: "K7QX4M",
  address: "http://192.168.0.12:7878",
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

  const value: ShellContextValue = {
    session: quietSession(),
    snapshot,
    error: null,
    destination: "settings",
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
    setBaseIntentHandler: vi.fn(() => () => {}),
  };

  return { value, pushed, ask, pop };
}

function withShell(value: ShellContextValue, children: ReactNode) {
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

function actions(ask: ReturnType<typeof harness>["ask"]): Action[] {
  return ask.mock.calls.map(([action]) => action);
}

/** Integrated frame harness so level push/pop, Back, and focus restore run end-to-end. */
function SettingsFrameHarness({
  snapshot = BASE_SNAPSHOT,
  ask: customAsk,
}: {
  snapshot?: Snapshot | null;
  ask?: (action: Action) => Promise<ActionOutcome>;
}) {
  const [levels, setLevels] = useState<ShellLevel[]>([]);
  const [destination, setDestination] = useState<"settings" | "home">("settings");
  const ask = customAsk ?? vi.fn(async () => ok());

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
      setDestination(next === "home" ? "home" : "settings");
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
          setDestination(next === "home" ? "home" : "settings");
          setLevels([]);
        }}
        levels={levels}
        onBack={back}
        screen={
          destination === "settings" ? (
            <MarqueeSettings />
          ) : (
            <div data-testid="home-base">Home</div>
          )
        }
      />
    </ShellContext.Provider>
  );
}

describe("Marquee Settings categories, sub-level stack, and Back behaviour (ADR-0032)", () => {
  test("lists the four categories and switches between them", () => {
    const { value } = harness();
    render(withShell(value, <MarqueeSettings />));

    const nav = screen.getByTestId("settings-categories");
    for (const cat of SETTINGS_CATEGORIES) {
      expect(within(nav).getByRole("button", { name: cat.title })).toBeInTheDocument();
    }
    expect(screen.getByTestId("settings-pane-preferences")).toBeInTheDocument();

    fireEvent.click(within(nav).getByRole("button", { name: "Credentials" }));
    expect(screen.getByTestId("settings-pane-credentials")).toBeInTheDocument();

    fireEvent.click(within(nav).getByRole("button", { name: "Remote devices" }));
    expect(screen.getByTestId("settings-pane-remote-devices")).toBeInTheDocument();

    fireEvent.click(within(nav).getByRole("button", { name: "About/Credits" }));
    expect(screen.getByTestId("settings-pane-about")).toBeInTheDocument();
  });

  test("inline Autoplay switch in Preferences dispatches set_autoplay", async () => {
    const { value, ask } = harness();
    render(withShell(value, <MarqueeSettings />));

    const toggle = screen.getByRole("switch", { name: "Autoplay the next episode" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    fireEvent.click(toggle);

    await waitFor(() =>
      expect(actions(ask)).toContainEqual({ type: "set_autoplay", autoplay: false }),
    );
  });

  test("opening a Preferences sub-level pushes onto the stack and Back pops to Preferences keeping focus on the opener", async () => {
    render(<SettingsFrameHarness />);

    const opener = screen.getByRole("button", { name: /Subtitle appearance/ });
    act(() => opener.focus());
    fireEvent.click(opener);

    expect(await screen.findByTestId("settings-sublevel-subtitle-appearance")).toBeInTheDocument();

    // Pressing Escape pops the sub-level back to Preferences (does not jump to Home).
    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() =>
      expect(screen.queryByTestId("settings-sublevel-subtitle-appearance")).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("settings-pane-preferences")).toBeInTheDocument();
    expect(document.activeElement).toBe(opener);

    // Opening another sub-level and clicking the Back IconButton also pops back.
    const bufferOpener = screen.getByRole("button", { name: /Stream buffer/ });
    fireEvent.click(bufferOpener);
    expect(await screen.findByTestId("settings-sublevel-stream-buffer")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("settings-stream-buffer-back"));
    await waitFor(() =>
      expect(screen.queryByTestId("settings-sublevel-stream-buffer")).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("settings-pane-preferences")).toBeInTheDocument();
  });

  test("standalone Credentials level ignores non-Credentials category choices", () => {
    const { value, pop } = harness();
    render(withShell(value, marqueeCredentialsLevel().payload.render()));

    expect(screen.getByTestId("settings-pane-credentials")).toBeInTheDocument();

    const nav = screen.getByTestId("settings-categories");
    fireEvent.click(within(nav).getByRole("button", { name: "Preferences" }));
    fireEvent.click(within(nav).getByRole("button", { name: "Remote devices" }));
    fireEvent.click(within(nav).getByRole("button", { name: "About/Credits" }));

    expect(value.choose).not.toHaveBeenCalled();
    expect(pop).not.toHaveBeenCalled();
    expect(screen.getByTestId("settings-pane-credentials")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("settings-credentials-back"));
    expect(pop).toHaveBeenCalledOnce();
  });
});

describe("Marquee Preferences sub-levels (23 – 26)", () => {
  test("Subtitle and Audio languages support Following the file, adding, reordering, and removing", async () => {
    const { value, pushed, ask } = harness();
    render(withShell(value, <MarqueeSettings />));

    // Audio languages starts empty ("Follow the file").
    fireEvent.click(screen.getByRole("button", { name: /Audio languages/ }));
    const audioView = render(withShell(value, pushed.at(-1)!.payload.render()));
    expect(screen.getByTestId("language-follow-audio")).toHaveTextContent("Follow the file");
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    await waitFor(() =>
      expect(actions(ask)).toContainEqual({
        type: "set_audio_languages",
        languages: ["en"],
      }),
    );
    audioView.unmount();

    // Subtitle languages has ["en"]; adding pt-BR then moving it up sends the whole ordered list.
    fireEvent.click(screen.getByRole("button", { name: /Subtitle languages/ }));
    const subView = render(withShell(value, pushed.at(-1)!.payload.render()));
    fireEvent.click(screen.getByRole("button", { name: "Português (Brasil)" }));
    await waitFor(() =>
      expect(actions(ask)).toContainEqual({
        type: "set_subtitle_languages",
        languages: ["en", "pt-BR"],
      }),
    );
    const ptRow = screen.getByRole("group", { name: "Português (Brasil)" });
    fireEvent.click(within(ptRow).getByRole("button", { name: "Move up" }));
    await waitFor(() =>
      expect(actions(ask)).toContainEqual({
        type: "set_subtitle_languages",
        languages: ["pt-BR", "en"],
      }),
    );
    subView.unmount();
  });

  test("Subtitle appearance steps 5% across 25%–300% using scaleAtBound and dispatches colour", async () => {
    const { value, pushed, ask } = harness();
    render(withShell(value, <MarqueeSettings />));
    fireEvent.click(screen.getByRole("button", { name: /Subtitle appearance/ }));
    const subView = render(withShell(value, pushed.at(-1)!.payload.render()));

    fireEvent.click(screen.getByTestId("subtitle-color-yellow"));
    await waitFor(() =>
      expect(actions(ask)).toContainEqual({ type: "set_subtitle_color", color: "#FFFF00" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Larger" }));
    await waitFor(() =>
      expect(actions(ask)).toContainEqual({ type: "set_subtitle_scale", scale: 1.05 }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Smaller" }));
    await waitFor(() =>
      expect(actions(ask)).toContainEqual({ type: "set_subtitle_scale", scale: 0.95 }),
    );
    subView.unmount();

    // Bounds check at 25% and 300%.
    const minHarness = harness({
      ...BASE_SNAPSHOT,
      preferences: { ...BASE_SNAPSHOT.preferences, subtitleScale: 0.25 },
    });
    const minRender = render(withShell(minHarness.value, <MarqueeSettings />));
    fireEvent.click(within(minRender.container).getByRole("button", { name: /Subtitle appearance/ }));
    const minSub = render(withShell(minHarness.value, minHarness.pushed.at(-1)!.payload.render()));
    expect(within(minSub.container).getByRole("button", { name: "Smaller" })).toBeDisabled();
    expect(within(minSub.container).getByRole("button", { name: "Larger" })).toBeEnabled();
    minSub.unmount();
    minRender.unmount();

    const maxHarness = harness({
      ...BASE_SNAPSHOT,
      preferences: { ...BASE_SNAPSHOT.preferences, subtitleScale: 3 },
    });
    const maxRender = render(withShell(maxHarness.value, <MarqueeSettings />));
    fireEvent.click(within(maxRender.container).getByRole("button", { name: /Subtitle appearance/ }));
    const maxSub = render(withShell(maxHarness.value, maxHarness.pushed.at(-1)!.payload.render()));
    expect(within(maxSub.container).getByRole("button", { name: "Larger" })).toBeDisabled();
    expect(within(maxSub.container).getByRole("button", { name: "Smaller" })).toBeEnabled();
  });

  test("Stream buffer & torrent cache composes buffer pair and sends torrent cache alone", async () => {
    const { value, pushed, ask } = harness();
    render(withShell(value, <MarqueeSettings />));
    fireEvent.click(screen.getByRole("button", { name: /Stream buffer/ }));
    render(withShell(value, pushed.at(-1)!.payload.render()));

    fireEvent.click(screen.getByTestId("buffer-seconds-600"));
    await waitFor(() =>
      expect(actions(ask)).toContainEqual({
        type: "set_stream_buffer",
        seconds: 600,
        megabytes: 512,
      }),
    );

    fireEvent.click(screen.getByTestId("buffer-megabytes-1024"));
    await waitFor(() =>
      expect(actions(ask)).toContainEqual({
        type: "set_stream_buffer",
        seconds: 600,
        megabytes: 1024,
      }),
    );

    fireEvent.click(screen.getByTestId("torrent-cache-8000"));
    await waitFor(() =>
      expect(actions(ask)).toContainEqual({ type: "set_torrent_cache", megabytes: 8000 }),
    );
  });

  test("Up next & featured catalog updates Autoplay, Up next playback, and Featured catalog", async () => {
    const { value, pushed, ask } = harness();
    render(withShell(value, <MarqueeSettings />));
    fireEvent.click(screen.getByRole("button", { name: /Featured catalog/ }));
    const subView = render(withShell(value, pushed.at(-1)!.payload.render()));

    fireEvent.click(screen.getByTestId("up-next-picker"));
    await waitFor(() =>
      expect(actions(ask)).toContainEqual({
        type: "set_up_next_playback",
        playback: "picker",
      }),
    );

    fireEvent.click(screen.getByTestId("featured-none"));
    await waitFor(() =>
      expect(actions(ask)).toContainEqual({ type: "clear_featured_catalog" }),
    );

    fireEvent.click(screen.getByTestId("featured-cinemeta/movie/top"));
    await waitFor(() =>
      expect(actions(ask)).toContainEqual({
        type: "set_featured_catalog",
        addon: "cinemeta",
        catalog: { type: "movie", id: "top" },
      }),
    );
    subView.unmount();
  });

  test("every Preferences sub-level keeps distinct data-region ids for spatial focus", () => {
    const { value, pushed } = harness();
    render(withShell(value, <MarqueeSettings />));

    for (const name of [
      /Subtitle languages/,
      /Audio languages/,
      /Subtitle appearance/,
      /Stream buffer/,
      /Featured catalog/,
    ]) {
      fireEvent.click(screen.getByRole("button", { name }));
      const subView = render(withShell(value, pushed.at(-1)!.payload.render()));
      const regionIds = Array.from(
        subView.container.querySelectorAll("[data-region]"),
        (el) => el.getAttribute("data-region"),
      );
      expect(new Set(regionIds).size).toBe(regionIds.length);
      expect(() => readLevel(subView.container, {})).not.toThrow();
      subView.unmount();
    }
  });
});

describe("Marquee Credentials, Remote devices, and About/Credits (20 – 22, 27)", () => {
  test("Credentials saves and clears TMDB key (behind Confirm) and handles Stremio sign-in and sign-out", async () => {
    const { value, pushed, ask, pop } = harness();
    render(withShell(value, <MarqueeSettings />));
    fireEvent.click(screen.getByRole("button", { name: "Credentials" }));

    expect(screen.getByTestId("protection-backend")).toHaveTextContent("OS keyring");
    expect(screen.getByTestId("protection-tmdb")).toHaveTextContent("Held");
    expect(screen.getByTestId("protection-stremio")).toHaveTextContent("Not signed in");

    const tmdbInput = screen.getByLabelText("TMDB API key or read-access token");
    fireEvent.change(tmdbInput, { target: { value: "  tmdb-secret  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));
    await waitFor(() =>
      expect(actions(ask)).toContainEqual({ type: "set_tmdb_key", key: "tmdb-secret" }),
    );
    expect(tmdbInput).toHaveValue("");
    expect(await screen.findByTestId("tmdb-key-status")).toBeInTheDocument();

    // Clear key goes through Confirm with initial focus on Cancel.
    fireEvent.click(screen.getByRole("button", { name: "Clear key" }));
    const clearConfirm = render(withShell(value, pushed.at(-1)!.payload.render()));
    expect(within(clearConfirm.container).getByRole("button", { name: "Cancel" })).toHaveFocus();
    fireEvent.click(within(clearConfirm.container).getByRole("button", { name: "Clear key" }));
    await waitFor(() => expect(actions(ask)).toContainEqual({ type: "clear_tmdb_key" }));
    expect(pop).toHaveBeenCalled();
    clearConfirm.unmount();

    // Signed-out Stremio form signs in; refused login shows inline error.
    ask.mockImplementationOnce(async () =>
      refusal({ kind: "invalid_stremio_login", detail: "wrong password" }),
    );
    fireEvent.change(screen.getByLabelText("Stremio email"), {
      target: { value: " owner@example.com " },
    });
    fireEvent.change(screen.getByLabelText("Stremio password"), {
      target: { value: "badpass" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByTestId("stremio-sign-in-error")).toHaveTextContent("wrong password");

    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() =>
      expect(actions(ask)).toContainEqual({
        type: "sign_in_stremio",
        email: "owner@example.com",
        password: "badpass",
      }),
    );

    // Signed-in Stremio card signs out through Confirm.
    cleanup();
    const signedIn = harness({
      ...BASE_SNAPSHOT,
      protection: { backend: "keyring", tmdbHeld: true, stremioHeld: true },
    });
    render(withShell(signedIn.value, <MarqueeSettings />));
    fireEvent.click(screen.getByRole("button", { name: "Credentials" }));
    expect(screen.getByTestId("stremio-signed-in")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    const signOutConfirm = render(
      withShell(signedIn.value, signedIn.pushed.at(-1)!.payload.render()),
    );
    expect(within(signOutConfirm.container).getByRole("button", { name: "Cancel" })).toHaveFocus();
    fireEvent.click(within(signOutConfirm.container).getByRole("button", { name: "Sign out" }));
    await waitFor(() =>
      expect(actions(signedIn.ask)).toContainEqual({ type: "sign_out_stremio" }),
    );
  });

  test("Remote devices shows PairingCode and revokes a device via Confirm with Cancel focused", async () => {
    const { value, pushed, ask, pop } = harness();
    const view = render(withShell(value, <MarqueeSettings />));
    fireEvent.click(screen.getByRole("button", { name: "Remote devices" }));

    expect(screen.getByRole("img", { name: "Pairing code K 7 Q X 4 M" })).toBeInTheDocument();
    expect(screen.getByText("http://192.168.0.12:7878")).toBeInTheDocument();
    expect(screen.getByTestId(`device-${LIVING_ROOM.id}`)).toHaveTextContent("Living-room phone");
    expect(screen.getByTestId(`device-${TABLET.id}`)).toHaveTextContent("Tablet");

    fireEvent.click(screen.getByRole("button", { name: `Revoke ${TABLET.name}` }));
    const confirmLevel = pushed.at(-1)!;
    expect(confirmLevel.name).toBe(`Revoke ${TABLET.name}?`);

    const confirmView = render(withShell(value, confirmLevel.payload.render()));
    expect(within(confirmView.container).getByRole("button", { name: "Cancel" })).toHaveFocus();
    fireEvent.click(within(confirmView.container).getByRole("button", { name: "Revoke" }));

    await waitFor(() =>
      expect(actions(ask)).toContainEqual({ type: "revoke_device", id: TABLET.id }),
    );
    expect(pop).toHaveBeenCalled();
    confirmView.unmount();

    view.rerender(
      withShell({ ...value, snapshot: { ...BASE_SNAPSHOT, devices: [LIVING_ROOM] } }, <MarqueeSettings />),
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: `Revoke ${LIVING_ROOM.name}` }),
      ),
    );
  });

  test("About/Credits displays TMDB notice, version, and GPL-3.0-or-later licence", () => {
    const { value } = harness();
    render(withShell(value, <MarqueeSettings />));
    fireEvent.click(screen.getByRole("button", { name: "About/Credits" }));

    expect(screen.getByTestId("tmdb-logo")).toBeInTheDocument();
    expect(screen.getByTestId("tmdb-notice")).toHaveTextContent(
      "This product uses the TMDB API but is not endorsed or certified by TMDB",
    );
    expect(screen.getByTestId("app-version")).toHaveTextContent(/^v\d/);
    expect(screen.getByTestId("license-credits")).toHaveTextContent("GPL-3.0-or-later");
  });
});
