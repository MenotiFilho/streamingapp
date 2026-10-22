import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { useFullscreen } from "./useFullscreen";

/**
 * The Tauri window a test can hold: one fact, the calls that changed it, and
 * the resize handlers the app subscribed. `fail` is a browser — `isFullscreen`
 * refuses because there is no Tauri runtime underneath.
 */
const host = vi.hoisted(() => {
  const state = {
    fullscreen: false,
    fail: false,
    reads: 0,
    calls: [] as boolean[],
    resized: new Set<() => void>(),
  };

  return {
    state,
    window: {
      isFullscreen: async () => {
        state.reads += 1;
        if (state.fail) {
          throw new Error("there is no Tauri window here");
        }
        return state.fullscreen;
      },
      setFullscreen: async (next: boolean) => {
        state.fullscreen = next;
        state.calls.push(next);
      },
      onResized: async (handler: () => void) => {
        state.resized.add(handler);
        return () => {
          state.resized.delete(handler);
        };
      },
    },
  };
});

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => host.window,
}));

/** One control that shows the shared fact, so a test can read the label. */
function Probe() {
  const { fullscreen, toggle } = useFullscreen();
  return (
    <button type="button" onClick={() => void toggle()}>
      {fullscreen ? "Exit full screen" : "Full screen"}
    </button>
  );
}

beforeEach(() => {
  host.state.fullscreen = false;
  host.state.fail = false;
  host.state.reads = 0;
  host.state.calls.length = 0;
  host.state.resized.clear();
});

describe("the window's fullscreen fact", () => {
  test("mounting reads the window, and a resize refreshes it", async () => {
    host.state.fullscreen = true;
    render(<Probe />);

    await waitFor(() =>
      expect(screen.getByRole("button")).toHaveAccessibleName("Exit full screen"),
    );
    await waitFor(() => expect(host.state.resized.size).toBe(1));
    expect(host.state.reads).toBe(1);

    // A window-level change the button did not ask for — F11 in the native
    // window, or the OS taking the window out again.
    host.state.fullscreen = false;
    await act(async () => {
      for (const handler of [...host.state.resized]) {
        handler();
      }
    });

    await waitFor(() => expect(screen.getByRole("button")).toHaveAccessibleName("Full screen"));
  });

  test("toggling asks the window, and reads back what actually happened", async () => {
    render(<Probe />);
    await waitFor(() => expect(screen.getByRole("button")).toHaveAccessibleName("Full screen"));

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(host.state.calls).toEqual([true]));
    await waitFor(() =>
      expect(screen.getByRole("button")).toHaveAccessibleName("Exit full screen"),
    );
  });

  test("a browser with no Tauri window is a no-op", async () => {
    host.state.fail = true;
    render(<Probe />);

    await waitFor(() => expect(host.state.reads).toBe(1));
    fireEvent.click(screen.getByRole("button"));

    expect(host.state.calls).toEqual([]);
    expect(screen.getByRole("button")).toHaveAccessibleName("Full screen");
    expect(host.state.resized.size).toBe(0);
  });
});
