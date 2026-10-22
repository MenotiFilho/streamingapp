import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
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
 * Whether there is a Tauri window at all is answered synchronously by the
 * public `isTauri()` check, which reads the global Tauri sets before the page
 * runs. That is what makes `supported` true on the first render and on a
 * remount, so a control is drawn at once and F11 is bound at once rather than
 * waiting for the first read. A plain browser — Vite's dev window, a test —
 * has no such global: it is never supported, is never believed fullscreen, and
 * keeps the F11 its browser gives it. The served Remote page is a different
 * client in a different browser tab; this module never runs there.
 */

type FullscreenState = {
  /** What the window last said; false until it says anything. */
  fullscreen: boolean;
  /** Whether there is a Tauri window to ask. A browser is never supported. */
  supported: boolean;
};

/** What subscribers read. Replaced, never mutated, so React can compare. */
let state: FullscreenState = { fullscreen: false, supported: isTauri() };
const listeners = new Set<() => void>();

/**
 * The watch and the stamp that makes an old one stale. A subscription can
 * start and stop faster than `isFullscreen()` answers (React's StrictMode does
 * exactly that), and a late answer must not move a window nobody is watching.
 */
let generation = 0;
let unlisten: (() => void) | null = null;

/**
 * Merge a partial fact into the whole state and wake subscribers only when
 * something moved. The comparison has to be against the merged state: a
 * partial that leaves a field out must not read as a change to it, or every
 * `onResized` would publish — and re-render both controls — with the same
 * values (`supported` was the field that always looked different).
 */
function publish(next: Partial<FullscreenState>): void {
  const merged = { ...state, ...next };
  if (merged.fullscreen === state.fullscreen && merged.supported === state.supported) {
    return;
  }
  state = merged;
  for (const listener of [...listeners]) {
    listener();
  }
}

/**
 * The Host's window, or null where there is no Tauri runtime.
 *
 * The synchronous check comes first, so a plain browser never reaches the Tauri
 * API at all; on a Host window the call is the window's constructor, which is
 * cheap and happens once per read.
 */
function hostWindow(): ReturnType<typeof getCurrentWindow> | null {
  if (!isTauri()) {
    return null;
  }
  try {
    return getCurrentWindow();
  } catch {
    return null;
  }
}

/** Read the fact again; a window that refuses leaves the last one standing. */
async function refresh(watchGeneration: number): Promise<void> {
  const host = hostWindow();
  if (!host || watchGeneration !== generation) {
    return;
  }
  try {
    const fullscreen = await host.isFullscreen();
    if (watchGeneration === generation) {
      publish({ fullscreen });
    }
  } catch {
    // The window refused this read; the last fact stands.
  }
}

async function watch(): Promise<void> {
  const watchGeneration = generation;
  const host = hostWindow();
  if (!host || watchGeneration !== generation) {
    return;
  }

  try {
    const first = await host.isFullscreen();
    if (watchGeneration !== generation) {
      return;
    }
    publish({ fullscreen: first });
  } catch {
    // A Tauri window that refuses the read is still a Tauri window: `supported`
    // stays true, so the controls stay drawn and F11 stays bound. The first
    // fact is simply unknown until a resize supplies one.
    if (watchGeneration !== generation) {
      return;
    }
  }

  try {
    const stop = await host.onResized(() => {
      if (watchGeneration === generation) {
        void refresh(watchGeneration);
      }
    });
    if (watchGeneration === generation) {
      unlisten = stop;
    } else {
      stop();
    }
  } catch {
    // The fact is still readable; only its window-level changes would be missed.
  }
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    // A fresh watch cycle starts from what the page says now: the synchronous
    // `isTauri()` check is the first render's answer, and a remount must not
    // trust a fact — or a support claim — from before an unmount.
    generation += 1;
    publish({ fullscreen: false, supported: isTauri() });
    void watch();
  }
  listeners.add(listener);
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
    publish({ fullscreen: false, supported: isTauri() });
  };
}

/**
 * Put the window into fullscreen, or take it out again, and publish what the
 * window says afterwards — a window can refuse, and the controls must show the
 * fact rather than the wish.
 */
export async function toggleFullscreen(): Promise<void> {
  if (!isTauri()) {
    return;
  }
  const host = hostWindow();
  if (!host) {
    return;
  }
  try {
    const next = !(await host.isFullscreen());
    await host.setFullscreen(next);
    publish({ fullscreen: await host.isFullscreen() });
  } catch {
    // The window refused: there is nothing new to show.
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
