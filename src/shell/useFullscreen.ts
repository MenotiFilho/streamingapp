import { useSyncExternalStore } from "react";

/**
 * The window's fullscreen fact, and the one place that changes it.
 *
 * Fullscreen is a fact about the Host's window, not about the Host's state:
 * no Action asks for it and no Snapshot carries it (ADR-0002). The Tauri window
 * is its only owner, so this module follows it — `isFullscreen()` when
 * something starts watching, another read on every `onResized`, and a read back
 * after `setFullscreen` — and every control that shows the fact (the OSD's
 * button and the shell's chrome) reads this one subscription. A control that
 * kept its own boolean showed the wrong label after a window-level change
 * (#125).
 *
 * A browser or a test has no Tauri window. `getCurrentWindow()` throws there,
 * so every call is a no-op, nothing is ever believed fullscreen, and the
 * Remote client keeps its own browser's F11.
 */

type FullscreenState = {
  /** What the window last said; false until it says anything. */
  fullscreen: boolean;
  /** Whether there is a Tauri window to ask. A browser is never supported. */
  supported: boolean;
};

/** What subscribers read. Replaced, never mutated, so React can compare. */
let state: FullscreenState = { fullscreen: false, supported: false };
const listeners = new Set<() => void>();

/**
 * The watch and the number that makes an old one stale. A subscription can
 * start and stop faster than `isFullscreen()` answers (React's StrictMode does
 * exactly that), and a late answer must not move a window nobody is watching.
 */
let generation = 0;
let unlisten: (() => void) | null = null;

function publish(next: Partial<FullscreenState>): void {
  if (next.fullscreen === state.fullscreen && next.supported === state.supported) {
    return;
  }
  state = { ...state, ...next };
  for (const listener of [...listeners]) {
    listener();
  }
}

/** The Host's window, or null where there is no Tauri runtime. */
async function hostWindow() {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    return getCurrentWindow();
  } catch {
    return null;
  }
}

/** Read the fact again; a window that refuses leaves the last one standing. */
async function refresh(watching: number): Promise<void> {
  const host = await hostWindow();
  if (!host || watching !== generation) {
    return;
  }
  try {
    const fullscreen = await host.isFullscreen();
    if (watching === generation) {
      publish({ fullscreen });
    }
  } catch {
    // Not a Tauri window after all: a browser's own state is not ours to move.
  }
}

async function watch(): Promise<void> {
  const watching = generation;
  const host = await hostWindow();
  if (!host || watching !== generation) {
    return;
  }

  let first: boolean;
  try {
    first = await host.isFullscreen();
  } catch {
    return;
  }
  if (watching !== generation) {
    return;
  }
  publish({ fullscreen: first, supported: true });

  try {
    const stop = await host.onResized(() => {
      if (watching === generation) {
        void refresh(watching);
      }
    });
    if (watching === generation) {
      unlisten = stop;
    } else {
      stop();
    }
  } catch {
    // The fact is still readable; only its window-level changes would be missed.
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    generation += 1;
    void watch();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) {
      return;
    }
    // Nobody is watching, so there is nothing to keep: the next mount reads the
    // window again rather than trusting a fact from before an unmount.
    generation += 1;
    unlisten?.();
    unlisten = null;
    state = { fullscreen: false, supported: false };
  };
}

/**
 * Put the window into fullscreen, or take it out again, and publish what the
 * window says afterwards — a window can refuse, and the controls must show the
 * fact rather than the wish.
 */
export async function toggleFullscreen(): Promise<void> {
  const host = await hostWindow();
  if (!host) {
    return;
  }
  try {
    const next = !(await host.isFullscreen());
    await host.setFullscreen(next);
    publish({ fullscreen: await host.isFullscreen(), supported: true });
  } catch {
    // Not a Tauri window, or the window refused: there is nothing to show.
  }
}

/**
 * The shared fullscreen fact, as a hook. `supported` says whether there is a
 * Tauri window at all, which is what lets the shell leave a browser's F11
 * alone; `toggle` reads the window rather than a remembered boolean.
 */
export function useFullscreen(): {
  fullscreen: boolean;
  supported: boolean;
  toggle: () => Promise<void>;
} {
  const current = useSyncExternalStore(subscribe, () => state);
  return {
    fullscreen: current.fullscreen,
    supported: current.supported,
    toggle: toggleFullscreen,
  };
}
