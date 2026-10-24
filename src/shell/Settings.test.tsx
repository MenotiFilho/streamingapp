import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import {
  HostClient,
  type Action,
  type ActionError,
  type AddonManifest,
  type DeviceSummary,
  type Snapshot,
  type Transport,
} from "../host-client";
import { Shell } from "./Shell";

const CINEMETA: AddonManifest = {
  id: "com.linvo.cinemeta",
  name: "Cinemeta",
  version: "3.0.0",
  resources: [{ name: "catalog", types: ["movie", "series"], idPrefixes: null }],
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
  catalogs: [
    {
      type: "movie",
      id: "letterboxd-popular",
      name: "Popular This Week",
      extra: [{ name: "skip", isRequired: false, options: [], optionsLimit: 1 }],
    },
  ],
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
  preferences: { subtitleLanguage: null, subtitleColor: "#FFFFFF", subtitleScale: 1, streamBuffer: { seconds: 300, megabytes: 512 } },
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

function settingsSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return snap({
    addons: [CINEMETA, STREMBOX],
    preferences: { subtitleLanguage: "en", subtitleColor: "#FFFFFF", subtitleScale: 1, streamBuffer: { seconds: 300, megabytes: 512 } },
    protection: { backend: "file", tmdbHeld: true, stremioHeld: false },
    devices: [LIVING_ROOM, OFFICE],
    ...overrides,
  });
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

async function openSettings(host: ReturnType<typeof fakeHost>) {
  render(<Shell client={host.client} />);
  await screen.findByRole("heading", { name: "Home" });
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await screen.findByRole("heading", { name: "Settings" });
  return host;
}

async function openCategory(name: string) {
  const category = screen.getByRole("button", { name });
  act(() => category.focus());
  fireEvent.click(category);
  await screen.findByRole("heading", { name });
  return category;
}

describe("the Settings screen", () => {
  test("draws the four categories in order", async () => {
    const host = fakeHost(settingsSnapshot());
    await openSettings(host);

    const list = screen.getByTestId("settings-categories");
    expect(
      within(list)
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual(["Credentials", "Preferences", "Remote devices", "About/Credits"]);
  });

  test("each category pushes its sub-screen, and Back pops to the list with its focus", async () => {
    const host = fakeHost(settingsSnapshot());
    await openSettings(host);

    for (const name of ["Credentials", "Preferences", "Remote devices", "About/Credits"]) {
      const category = await openCategory(name);
      fireEvent.keyDown(document, { key: "Escape" });

      await waitFor(() =>
        expect(screen.queryByRole("heading", { name })).not.toBeInTheDocument(),
      );
      expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
      expect(document.activeElement).toBe(category);
    }
  });

  test("Credentials reads the protection, saves a trimmed TMDB key, and clears it through a confirmation", async () => {
    const host = fakeHost(settingsSnapshot());
    await openSettings(host);
    await openCategory("Credentials");

    expect(screen.getByTestId("protection-backend")).toHaveTextContent(
      "owner-only (0600) file",
    );
    expect(screen.getByTestId("protection-tmdb")).toHaveTextContent("A TMDB key is held");
    expect(screen.getByTestId("protection-stremio")).toHaveTextContent(
      "No Stremio account is signed in",
    );

    const input = screen.getByLabelText("TMDB API key or read-access token");
    fireEvent.change(input, { target: { value: "  abc123  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));

    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({
        type: "set_tmdb_key",
        key: "abc123",
      }),
    );
    expect(input).toHaveValue("");

    fireEvent.click(screen.getByRole("button", { name: "Clear key" }));
    const dialog = await screen.findByRole("dialog", { name: "Clear the TMDB key?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Clear key" }));

    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({ type: "clear_tmdb_key" }),
    );
  });

  test("a refused TMDB key is explained beside the form and the value is kept", async () => {
    const host = fakeHost(settingsSnapshot(), {
      refuse: (action) =>
        action.type === "set_tmdb_key"
          ? { kind: "invalid_tmdb_key", detail: "the key is too short" }
          : null,
    });
    await openSettings(host);
    await openCategory("Credentials");

    const input = screen.getByLabelText("TMDB API key or read-access token");
    fireEvent.change(input, { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));

    expect(await screen.findByTestId("tmdb-key-error")).toHaveTextContent(
      "The Host will not keep that TMDB key",
    );
    expect(input).toHaveValue("short");
    expect(document.querySelector(".shell-alert"), "not the window's one alert").toBeNull();
  });

  test("the shared Stremio form signs in, and a refusal keeps the fields beside it", async () => {
    const host = fakeHost(settingsSnapshot(), {
      refuse: (action) =>
        action.type === "sign_in_stremio"
          ? { kind: "invalid_stremio_login", detail: "the password is wrong" }
          : null,
    });
    await openSettings(host);
    await openCategory("Credentials");

    const email = screen.getByLabelText("Stremio email");
    const password = screen.getByLabelText("Stremio password");
    fireEvent.change(email, { target: { value: "you@example.test" } });
    fireEvent.change(password, { target: { value: "hunter2" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByTestId("stremio-sign-in-error")).toHaveTextContent(
      "The Host will not send that Stremio sign-in",
    );
    expect(email).toHaveValue("you@example.test");
    expect(password).toHaveValue("hunter2");
  });

  test("a signed-in Stremio account signs out through a confirmation", async () => {
    const host = fakeHost(
      settingsSnapshot({
        protection: { backend: "keyring", tmdbHeld: true, stremioHeld: true },
      }),
    );
    await openSettings(host);
    await openCategory("Credentials");

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    const dialog = await screen.findByRole("dialog", { name: "Sign out of Stremio?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Sign out" }));

    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({ type: "sign_out_stremio" }),
    );
  });

  test("Preferences picks a curated language, or Host picks per Video", async () => {
    const host = fakeHost(settingsSnapshot());
    await openSettings(host);
    await openCategory("Preferences");

    expect(screen.getByTestId("subtitle-language")).toHaveTextContent("English");
    expect(screen.getByTestId("language-en")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("language-host-picks")).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    fireEvent.click(screen.getByTestId("language-pt-BR"));
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({
        type: "set_subtitle_language",
        language: "pt-BR",
      }),
    );

    fireEvent.click(screen.getByTestId("language-host-picks"));
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({
        type: "clear_subtitle_language",
      }),
    );

    act(() =>
      host.publish(
        settingsSnapshot({
          revision: 2,
          preferences: { subtitleLanguage: "pt-BR", subtitleColor: "#FFFFFF", subtitleScale: 1, streamBuffer: { seconds: 300, megabytes: 512 } },
        }),
      ),
    );
    expect(screen.getByTestId("language-pt-BR")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("language-host-picks")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  test("Preferences picks a subtitle colour and size from the Host's values", async () => {
    const host = fakeHost(settingsSnapshot());
    await openSettings(host);
    await openCategory("Preferences");

    expect(screen.getByTestId("subtitle-appearance")).toHaveTextContent("ASS");
    expect(screen.getByTestId("subtitle-color-white")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("subtitle-scale-default")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("subtitle-scale-default")).toHaveTextContent("100%");

    fireEvent.click(screen.getByTestId("subtitle-color-yellow"));
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({
        type: "set_subtitle_color",
        color: "#FFFF00",
      }),
    );

    fireEvent.click(screen.getByTestId("subtitle-scale-large"));
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({
        type: "set_subtitle_scale",
        scale: 1.25,
      }),
    );

    act(() =>
      host.publish(
        settingsSnapshot({
          revision: 2,
          preferences: {
            subtitleLanguage: "en",
            subtitleColor: "#FFFF00",
            subtitleScale: 1.25, streamBuffer: { seconds: 300, megabytes: 512 },
          },
        }),
      ),
    );
    expect(screen.getByTestId("subtitle-color-yellow")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("subtitle-color-white")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByTestId("subtitle-scale-large")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("subtitle-scale-default")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  test("a size between the four presets is pressed as Other, whatever the Remote set", async () => {
    const host = fakeHost(
      settingsSnapshot({
        preferences: { subtitleLanguage: "en", subtitleColor: "#FFFFFF", subtitleScale: 1.05, streamBuffer: { seconds: 300, megabytes: 512 } },
      }),
    );
    await openSettings(host);
    await openCategory("Preferences");

    // The Host accepts any scale 0.5–2.0, so a Remote can hold one Settings has
    // no chip for. It is named rather than leaving every chip unpressed.
    expect(screen.getByTestId("subtitle-scale-other")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("subtitle-scale-other")).toHaveTextContent("Other (105%)");
    expect(screen.getByTestId("subtitle-scale-default")).toHaveAttribute("aria-pressed", "false");

    for (const [scale, words] of [
      [1.2, "Other (120%)"],
      [1.6, "Other (160%)"],
      [0.5, "Other (50%)"],
    ] as const) {
      act(() =>
        host.publish(
          settingsSnapshot({
            revision: 2,
            preferences: { subtitleLanguage: "en", subtitleColor: "#FFFFFF", subtitleScale: scale, streamBuffer: { seconds: 300, megabytes: 512 } },
          }),
        ),
      );
      expect(screen.getByTestId("subtitle-scale-other")).toHaveTextContent(words);
    }

    fireEvent.click(screen.getByTestId("subtitle-scale-other"));
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({
        type: "set_subtitle_scale",
        scale: 0.5,
      }),
    );

    act(() =>
      host.publish(
        settingsSnapshot({
          revision: 3,
          preferences: { subtitleLanguage: "en", subtitleColor: "#FFFFFF", subtitleScale: 1.25, streamBuffer: { seconds: 300, megabytes: 512 } },
        }),
      ),
    );
    expect(screen.queryByTestId("subtitle-scale-other")).toBeNull();
    expect(screen.getByTestId("subtitle-scale-large")).toHaveAttribute("aria-pressed", "true");
  });

  test("a refused subtitle colour is explained beside the appearance choices", async () => {
    const host = fakeHost(settingsSnapshot(), {
      refuse: (action) =>
        action.type === "set_subtitle_color"
          ? { kind: "invalid_subtitle_color", color: "#00FFFF" }
          : null,
    });
    await openSettings(host);
    await openCategory("Preferences");

    fireEvent.click(screen.getByTestId("subtitle-color-cyan"));

    expect(await screen.findByTestId("subtitle-appearance-error")).toHaveTextContent(
      '"#00FFFF" is not a subtitle colour',
    );
  });

  test("Preferences picks a Stream buffer: a look-ahead and a memory ceiling", async () => {
    const host = fakeHost(settingsSnapshot());
    await openSettings(host);
    await openCategory("Preferences");

    expect(screen.getByTestId("stream-buffer")).toHaveTextContent("read ahead");
    expect(screen.getByTestId("buffer-seconds-300")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("buffer-megabytes-512")).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByTestId("buffer-seconds-600"));
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({
        type: "set_stream_buffer",
        seconds: 600,
        megabytes: 512,
      }),
    );

    fireEvent.click(screen.getByTestId("buffer-megabytes-1024"));
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({
        type: "set_stream_buffer",
        // The second press composes from the first, before the Host has
        // answered: a pair built from the stale Snapshot would revert 600 s.
        seconds: 600,
        megabytes: 1024,
      }),
    );

    act(() =>
      host.publish(
        settingsSnapshot({
          revision: 2,
          preferences: {
            subtitleLanguage: "en",
            subtitleColor: "#FFFFFF",
            subtitleScale: 1,
            streamBuffer: { seconds: 600, megabytes: 2048 },
          },
        }),
      ),
    );
    expect(screen.getByTestId("buffer-seconds-600")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("buffer-megabytes-2048")).toHaveAttribute("aria-pressed", "true");
  });

  test("a buffer between the presets is pressed as Other, whatever the Remote set", async () => {
    const host = fakeHost(
      settingsSnapshot({
        preferences: {
          subtitleLanguage: "en",
          subtitleColor: "#FFFFFF",
          subtitleScale: 1,
          streamBuffer: { seconds: 900, megabytes: 1536 },
        },
      }),
    );
    await openSettings(host);
    await openCategory("Preferences");

    expect(screen.getByTestId("buffer-seconds-other")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("buffer-seconds-other")).toHaveTextContent("15 min");
    expect(screen.getByTestId("buffer-megabytes-other")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("buffer-megabytes-other")).toHaveTextContent("1536 MB");

    fireEvent.click(screen.getByTestId("buffer-seconds-other"));
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({
        type: "set_stream_buffer",
        seconds: 900,
        megabytes: 1536,
      }),
    );
  });

  test("Preferences sets and clears the Featured catalog", async () => {
    const host = fakeHost(settingsSnapshot());
    await openSettings(host);
    await openCategory("Preferences");

    const top = `featured-${CINEMETA.id}/movie/top`;
    expect(screen.getByTestId("featured-none")).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByTestId(top));
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({
        type: "set_featured_catalog",
        addon: CINEMETA.id,
        catalog: { type: "movie", id: "top" },
      }),
    );

    fireEvent.click(screen.getByTestId("featured-none"));
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({
        type: "clear_featured_catalog",
      }),
    );

    act(() =>
      host.publish(
        settingsSnapshot({
          revision: 2,
          featuredCatalog: { addon: CINEMETA.id, catalog: { type: "movie", id: "top" } },
        }),
      ),
    );
    expect(screen.getByTestId(top)).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("featured-none")).toHaveAttribute("aria-pressed", "false");
  });

  test("a refused Featured catalog is explained beside the picker", async () => {
    const host = fakeHost(settingsSnapshot(), {
      refuse: (action) =>
        action.type === "set_featured_catalog"
          ? {
              kind: "unknown_catalog",
              addon: CINEMETA.id,
              catalog: { type: "movie", id: "top" },
            }
          : null,
    });
    await openSettings(host);
    await openCategory("Preferences");

    fireEvent.click(screen.getByTestId(`featured-${CINEMETA.id}/movie/top`));

    expect(await screen.findByTestId("featured-catalog-error")).toHaveTextContent(
      "offers no catalog movie/top",
    );
  });

  test("Remote devices reads the address, code and paired devices", async () => {
    const host = fakeHost(settingsSnapshot());
    await openSettings(host);
    await openCategory("Remote devices");

    expect(screen.getByTestId("remote-address")).toHaveTextContent("192.168.1.9:8090");
    expect(screen.getByTestId("pairing-code")).toHaveTextContent("4K7Q2M");
    expect(screen.getByTestId(`device-${LIVING_ROOM.id}`)).toHaveTextContent("Living room");
    expect(screen.getByTestId(`device-${OFFICE.id}`)).toHaveTextContent("Office");
  });

  test("Revoke confirms, and Back cancels to the exact device control", async () => {
    const host = fakeHost(settingsSnapshot());
    await openSettings(host);
    await openCategory("Remote devices");

    const revoke = screen.getByRole("button", { name: `Revoke ${OFFICE.name}` });
    act(() => revoke.focus());
    fireEvent.click(revoke);

    await screen.findByRole("dialog", { name: `Revoke ${OFFICE.name}?` });
    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: `Revoke ${OFFICE.name}?` }),
      ).not.toBeInTheDocument(),
    );
    expect(document.activeElement).toBe(revoke);
    expect(actions(host.invocations).some((action) => action.type === "revoke_device")).toBe(
      false,
    );
  });

  test("confirming Revoke removes the device and steps focus back to the one before it", async () => {
    const host = fakeHost(settingsSnapshot());
    await openSettings(host);
    await openCategory("Remote devices");

    const revoke = screen.getByRole("button", { name: `Revoke ${OFFICE.name}` });
    act(() => revoke.focus());
    fireEvent.click(revoke);

    const dialog = await screen.findByRole("dialog", { name: `Revoke ${OFFICE.name}?` });
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({
        type: "revoke_device",
        id: OFFICE.id,
      }),
    );

    act(() =>
      host.publish(settingsSnapshot({ revision: 2, devices: [LIVING_ROOM] })),
    );
    await waitFor(() =>
      expect(screen.queryByTestId(`device-${OFFICE.id}`)).not.toBeInTheDocument(),
    );

    const first = screen.getByRole("button", { name: `Revoke ${LIVING_ROOM.name}` });
    await waitFor(() => expect(document.activeElement).toBe(first));
  });

  test("revoking the first device returns focus to the sub-screen's Back", async () => {
    const host = fakeHost(settingsSnapshot());
    await openSettings(host);
    await openCategory("Remote devices");

    const revoke = screen.getByRole("button", { name: `Revoke ${LIVING_ROOM.name}` });
    act(() => revoke.focus());
    fireEvent.click(revoke);

    const dialog = await screen.findByRole("dialog", {
      name: `Revoke ${LIVING_ROOM.name}?`,
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));
    await waitFor(() =>
      expect(actions(host.invocations)).toContainEqual({
        type: "revoke_device",
        id: LIVING_ROOM.id,
      }),
    );

    act(() => host.publish(settingsSnapshot({ revision: 2, devices: [OFFICE] })));
    await waitFor(() =>
      expect(screen.queryByTestId(`device-${LIVING_ROOM.id}`)).not.toBeInTheDocument(),
    );

    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByTestId("settings-remote-devices-back"),
      ),
    );
  });

  test("a refused Revoke keeps the confirmation open with the Host's reason", async () => {
    const host = fakeHost(settingsSnapshot(), {
      refuse: (action) =>
        action.type === "revoke_device"
          ? { kind: "unknown_device", id: OFFICE.id }
          : null,
    });
    await openSettings(host);
    await openCategory("Remote devices");

    fireEvent.click(screen.getByRole("button", { name: `Revoke ${OFFICE.name}` }));
    const dialog = await screen.findByRole("dialog", { name: `Revoke ${OFFICE.name}?` });
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      `No device with the id "${OFFICE.id}" is paired`,
    );
    expect(
      screen.getByRole("dialog", { name: `Revoke ${OFFICE.name}?` }),
    ).toBeInTheDocument();
  });

  test("About/Credits carries the TMDB logo and notice, the version and the software credits", async () => {
    const host = fakeHost(settingsSnapshot());
    await openSettings(host);
    await openCategory("About/Credits");

    const logo = screen.getByTestId("tmdb-logo");
    expect(logo).toHaveAttribute("alt", "TMDB");
    // Vite inlines a small SVG as bytes in a test; a built bundle has its URL.
    expect(logo.getAttribute("src")).toMatch(/tmdb-logo|^data:image\/svg\+xml/);
    expect(screen.getByTestId("tmdb-notice")).toHaveTextContent(
      "This product uses the TMDB API but is not endorsed or certified by TMDB",
    );
    expect(screen.getByTestId("app-version")).toHaveTextContent("0.1.0");
    expect(screen.getByTestId("license-credits")).toHaveTextContent("GPL-3.0-or-later");
    expect(screen.getByTestId("license-credits")).toHaveTextContent("GPLv2 or later");
    expect(screen.getByTestId("license-credits")).toHaveTextContent("mpv (libmpv)");
  });
});
