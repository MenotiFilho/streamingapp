import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import {
  HostClient,
  type Action,
  type PlaybackSnapshot,
  type Snapshot,
  type Transport,
} from "../host-client";
import { Shell } from "./Shell";

const NOTHING_SAID: Snapshot = {
  revision: 0,
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
  preferences: { subtitleLanguage: null, subtitleColor: "#FFFFFF", subtitleScale: 1, streamBuffer: { seconds: 300, megabytes: 512 } },
  addons: [],
  featuredCatalog: null,
  protection: { backend: "keyring", tmdbHeld: false, stremioHeld: false },
  watchProgress: [],
  devices: [],
  pairingCode: "4K7Q2M",
  address: "192.168.1.9:8090",
};

function playback(overrides: Partial<PlaybackSnapshot> = {}): PlaybackSnapshot {
  return {
    state: "playing",
    picture: "in_window",
    failure: null,
    nowPlaying: {
      video: { type: "movie", id: "tt0133093" },
      addon: "community.aiostreams",
      name: "AIOStreams\n1080p",
      description: null,
      filename: null,
      bingeGroup: null,
    },
    episode: null,
    position: 12,
    duration: 8100,
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
    ...overrides,
  };
}

function fakeHost(initial: Snapshot) {
  const invocations: Array<{ command: string; args?: Record<string, unknown> }> = [];
  let listener: ((event: { payload: Snapshot }) => void) | undefined;
  let current = initial;

  const transport: Transport = {
    invoke: async <T,>(command: string, args?: Record<string, unknown>): Promise<T> => {
      invocations.push({ command, args });
      if (command === "snapshot") {
        return current as T;
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

function actions(invocations: Array<{ command: string; args?: Record<string, unknown> }>): Action[] {
  return invocations
    .filter(({ command }) => command === "dispatch")
    .map(({ args }) => (args?.envelope as { action: Action }).action);
}

describe("the shell", () => {
  test("draws Home and its six-destination rail", async () => {
    render(<Shell client={fakeHost(NOTHING_SAID).client} />);

    expect(await screen.findByRole("heading", { name: "Home" })).toBeInTheDocument();
    const rail = screen.getByRole("navigation", { name: "Destinations" });
    expect(within(rail).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Home",
      "Discover",
      "Search",
      "Library",
      "Addons",
      "Settings",
    ]);
  });

  test("choosing a destination replaces the base screen", async () => {
    render(<Shell client={fakeHost(NOTHING_SAID).client} />);
    await screen.findByRole("heading", { name: "Home" });

    fireEvent.click(screen.getByRole("button", { name: "Discover" }));
    expect(await screen.findByRole("heading", { name: "Discover" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Home" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Addons" }));
    expect(await screen.findByRole("heading", { name: "Addons" })).toBeInTheDocument();
  });

  test("Back from a non-Home screen returns to Home", async () => {
    render(<Shell client={fakeHost(NOTHING_SAID).client} />);
    await screen.findByRole("heading", { name: "Home" });

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    await screen.findByRole("heading", { name: "Settings" });

    fireEvent.keyDown(document, { key: "Escape" });

    expect(await screen.findByRole("heading", { name: "Home" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("an in-window Stream takes the window, and Back stops it", async () => {
    const host = fakeHost({ ...NOTHING_SAID, playback: playback() });
    render(<Shell client={host.client} />);

    const player = await screen.findByTestId("shell-player");
    expect(player).toHaveAttribute("data-picture", "in_window");
    expect(screen.getByTestId("shell-now-playing")).toHaveTextContent("AIOStreams");
    expect(document.body).toHaveClass("picture-behind");
    expect(screen.getByTestId("shell-frame").firstElementChild).toHaveAttribute(
      "data-takeover",
      "true",
    );

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(actions(host.invocations)).toContainEqual({ type: "stop_playback" }));
  });

  test("stopping returns to the exact browsing stack the Stream started over", async () => {
    const host = fakeHost(NOTHING_SAID);
    render(<Shell client={host.client} />);
    await screen.findByRole("heading", { name: "Home" });

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    await screen.findByRole("heading", { name: "Settings" });
    const settings = screen.getByRole("button", { name: "Settings" });
    await waitFor(() => expect(document.activeElement).toBe(settings));

    act(() => host.publish({ ...NOTHING_SAID, revision: 1, playback: playback() }));
    await screen.findByTestId("shell-player");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(actions(host.invocations)).toContainEqual({ type: "stop_playback" }));

    act(() => host.publish({ ...NOTHING_SAID, revision: 2 }));
    await waitFor(() => expect(screen.queryByTestId("shell-player")).not.toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(document.body).not.toHaveClass("picture-behind");
    expect(
      document.activeElement,
      "the rail item chosen before playback is where focus comes back",
    ).toBe(settings);
  });

  test("a picture in another window leaves the shell browsing", async () => {
    const host = fakeHost({ ...NOTHING_SAID, playback: playback({ picture: "own_window" }) });
    render(<Shell client={host.client} />);

    expect(await screen.findByRole("heading", { name: "Home" })).toBeInTheDocument();
    expect(screen.queryByTestId("shell-player")).not.toBeInTheDocument();
    expect(document.body).not.toHaveClass("picture-behind");
  });

  test("a Stream that failed to open says so, and the shell is not the player", async () => {
    const failure = "That Stream could not be opened - mpv could not load it.";
    const host = fakeHost({
      ...NOTHING_SAID,
      playback: { ...NOTHING_SAID.playback, state: "idle", failure },
    });
    render(<Shell client={host.client} />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(failure);
    expect(alert).toHaveTextContent("Pick another Stream from the list.");
    expect(screen.queryByTestId("shell-player")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Home" })).toBeInTheDocument();
  });

  test("the Stop control takes the same Action Back does", async () => {
    const host = fakeHost({ ...NOTHING_SAID, playback: playback() });
    render(<Shell client={host.client} />);
    await screen.findByTestId("shell-player");

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));

    await waitFor(() => expect(actions(host.invocations)).toContainEqual({ type: "stop_playback" }));
  });
});
