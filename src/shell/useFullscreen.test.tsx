import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  fakeWindowState,
  installTauriRuntime,
  releaseReads,
  removeTauriRuntime,
  resetFakeWindow,
} from "./tauriWindow.testing";
import { useFullscreen } from "./useFullscreen";

vi.mock("@tauri-apps/api/window", async () => {
  const fake = await import("./tauriWindow.testing");
  return { getCurrentWindow: () => fake.fakeTauriWindow };
});

/** Every render of the probe, so "an unchanged read publishes nothing" is visible. */
let renders = 0;

/**
 * One control that shows the shared fact, the way the chrome and the OSD's
 * button do. `data-supported` exposes the other half of the hook so a test can
 * see whether the page believes there is a window at all.
 */
function Probe() {
  renders += 1;
  const { fullscreen, supported, toggle } = useFullscreen();
  return (
    <button
      type="button"
      data-supported={supported ? "yes" : "no"}
      aria-pressed={fullscreen}
      onClick={() => void toggle()}
    >
      {fullscreen ? "Exit full screen" : "Full screen"}
    </button>
  );
}

beforeEach(() => {
  resetFakeWindow();
  installTauriRuntime();
  renders = 0;
});

describe("the window's fullscreen fact", () => {
  test("a Tauri window is supported before the first read answers, and the read supplies the fact", async () => {
    // The window is there but its first answer is slow: what a person sees on
    // launch must not depend on the read's timing.
    fakeWindowState().hold = true;
    fakeWindowState().fullscreen = true;
    render(<Probe />);

    expect(screen.getByRole("button")).toHaveAttribute("data-supported", "yes");
    expect(screen.getByRole("button")).toHaveAccessibleName("Full screen");
    // The read has been asked for and is still held: the control was already
    // there, drawn from the synchronous runtime check.
    await waitFor(() => expect(fakeWindowState().reads).toBe(1));
    expect(screen.getByRole("button")).toHaveAccessibleName("Full screen");

    await act(async () => {
      releaseReads();
    });
    await waitFor(() =>
      expect(screen.getByRole("button")).toHaveAccessibleName("Exit full screen"),
    );
  });

  test("mounting reads the window, and a resize refreshes it", async () => {
    fakeWindowState().fullscreen = true;
    render(<Probe />);

    await waitFor(() =>
      expect(screen.getByRole("button")).toHaveAccessibleName("Exit full screen"),
    );
    await waitFor(() => expect(fakeWindowState().resized.size).toBe(1));
    expect(fakeWindowState().reads).toBe(1);

    // A window-level change the button did not ask for — F11 in the native
    // window, or the OS taking the window out again.
    fakeWindowState().fullscreen = false;
    await act(async () => {
      for (const handler of [...fakeWindowState().resized]) {
        handler();
      }
    });

    await waitFor(() => expect(screen.getByRole("button")).toHaveAccessibleName("Full screen"));
  });

  test("a resize that changed nothing publishes nothing", async () => {
    render(<Probe />);
    await waitFor(() => expect(fakeWindowState().resized.size).toBe(1));
    const settled = renders;

    await act(async () => {
      for (const handler of [...fakeWindowState().resized]) {
        handler();
      }
    });

    expect(fakeWindowState().reads, "the resize did read the window").toBe(2);
    expect(
      renders,
      "the same fact is not news, so neither control re-renders",
    ).toBe(settled);
  });

  test("toggling asks the window, and reads back what actually happened", async () => {
    render(<Probe />);
    await waitFor(() => expect(screen.getByRole("button")).toHaveAccessibleName("Full screen"));

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(fakeWindowState().calls).toEqual([true]));
    await waitFor(() =>
      expect(screen.getByRole("button")).toHaveAccessibleName("Exit full screen"),
    );
  });

  test("a window that refuses the change shows the fact, not the wish", async () => {
    render(<Probe />);
    await waitFor(() => expect(screen.getByRole("button")).toHaveAccessibleName("Full screen"));

    // The click asks for fullscreen; the window says it is still not. The
    // control must keep saying what the window says.
    fakeWindowState().stubborn = true;
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(fakeWindowState().calls).toEqual([true]));
    expect(fakeWindowState().reads).toBeGreaterThanOrEqual(3);
    expect(screen.getByRole("button")).toHaveAccessibleName("Full screen");
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "false");
  });

  test("a page with no Fullscreen API is unsupported, draws as such at once, and a click is a no-op", async () => {
    removeTauriRuntime();
    render(<Probe />);

    expect(screen.getByRole("button")).toHaveAttribute("data-supported", "no");
    fireEvent.click(screen.getByRole("button"));
    await act(async () => {
      await Promise.resolve();
    });

    expect(fakeWindowState().calls).toEqual([]);
    expect(screen.getByRole("button")).toHaveAccessibleName("Full screen");
  });

  test("a browser document goes full through its own Fullscreen API", async () => {
    removeTauriRuntime();
    let fullscreen: Element | null = null;
    const request = vi.fn(async () => {
      fullscreen = document.documentElement;
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    const exit = vi.fn(async () => {
      fullscreen = null;
      document.dispatchEvent(new Event("fullscreenchange"));
    });

    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => fullscreen,
    });
    Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: true });
    Object.defineProperty(document, "exitFullscreen", { configurable: true, value: exit });
    Object.defineProperty(document.documentElement, "requestFullscreen", {
      configurable: true,
      value: request,
    });

    try {
      render(<Probe />);
      const button = screen.getByRole("button");
      expect(button).toHaveAttribute("data-supported", "yes");
      expect(button).toHaveAccessibleName("Full screen");

      fireEvent.click(button);
      await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(button).toHaveAccessibleName("Exit full screen"));

      fireEvent.click(button);
      await waitFor(() => expect(exit).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(button).toHaveAccessibleName("Full screen"));
    } finally {
      delete (document as unknown as { fullscreenElement?: unknown }).fullscreenElement;
      delete (document as unknown as { fullscreenEnabled?: unknown }).fullscreenEnabled;
      delete (document as unknown as { exitFullscreen?: unknown }).exitFullscreen;
      delete (document.documentElement as unknown as { requestFullscreen?: unknown })
        .requestFullscreen;
    }
  });

  test("a Tauri window whose first read refuses stays supported", async () => {
    fakeWindowState().fail = true;
    render(<Probe />);

    await waitFor(() => expect(fakeWindowState().reads).toBe(1));
    expect(
      screen.getByRole("button"),
      "there is still a window to change, even if it would not say what state it is in",
    ).toHaveAttribute("data-supported", "yes");
  });

  test("a refused first read still binds the resize, and the next one supplies the fact", async () => {
    fakeWindowState().fail = true;
    render(<Probe />);

    await waitFor(() => expect(fakeWindowState().reads).toBe(1));
    expect(
      fakeWindowState().resized.size,
      "the window still told us when it changed, even though its first answer refused",
    ).toBe(1);
    expect(screen.getByRole("button")).toHaveAccessibleName("Full screen");

    // The refusal was about that one read, not about the window: a later one
    // answers, and the control shows what it said.
    fakeWindowState().fail = false;
    fakeWindowState().fullscreen = true;
    await act(async () => {
      for (const handler of [...fakeWindowState().resized]) {
        handler();
      }
    });

    await waitFor(() =>
      expect(screen.getByRole("button")).toHaveAccessibleName("Exit full screen"),
    );
  });

  test("StrictMode's remount starts over, and a late read from the old watch is discarded", async () => {
    fakeWindowState().hold = true;
    const first = render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    );

    // StrictMode mounts, unmounts and mounts again. Both watches reached the
    // window before its first answer; only the second one is still wanted.
    await waitFor(() => expect(fakeWindowState().reads).toBe(2));

    fakeWindowState().fullscreen = true;
    const [stale] = fakeWindowState().released.splice(0, 1);
    if (!stale) {
      throw new Error("the stale read was never held");
    }
    await act(async () => {
      stale();
    });
    expect(
      screen.getByRole("button"),
      "the discarded watch's answer moved nothing",
    ).toHaveAccessibleName("Full screen");
    expect(
      fakeWindowState().resized.size,
      "and it did not even stay to listen for resizes",
    ).toBe(0);

    await act(async () => {
      releaseReads();
    });
    await waitFor(() =>
      expect(screen.getByRole("button")).toHaveAccessibleName("Exit full screen"),
    );
    expect(fakeWindowState().resized.size).toBe(1);

    // The last unsubscribe resets the store, so the next mount starts from the
    // window rather than from the fact it was holding.
    first.unmount();
    render(<Probe />);
    expect(
      screen.getByRole("button"),
      "a remount does not trust the fact from before the unmount",
    ).toHaveAccessibleName("Full screen");
    await waitFor(() => expect(fakeWindowState().reads).toBe(3));

    await act(async () => {
      releaseReads();
    });
    await waitFor(() =>
      expect(screen.getByRole("button")).toHaveAccessibleName("Exit full screen"),
    );
  });
});
