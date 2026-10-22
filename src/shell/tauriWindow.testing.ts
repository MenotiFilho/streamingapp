/**
 * The Tauri window a test can hold, and the runtime check the hook reads
 * synchronously.
 *
 * Both the hook's own tests and the player's / shell frame's tests need the
 * same fake: one fact, the calls that changed it, the resize handlers the app
 * subscribed, and the ways a real window can misbehave (a refused read, a
 * refused change, an answer that arrives late). Keeping it here is what stops
 * the two copies drifting apart.
 *
 * The runner's `*.test.*` glob does not collect this file; it is a helper, not
 * a suite.
 */

export type FakeTauriWindowState = {
  /** What the window says fullscreen is. */
  fullscreen: boolean;
  /** Refuse every read, the way a page with no Tauri API would. */
  fail: boolean;
  /** Hold every read at the window until `releaseReads()` is called. */
  hold: boolean;
  /** Record a requested change but leave the fact alone: the window refused. */
  stubborn: boolean;
  /** How many times the fact was read. */
  reads: number;
  /** The values `setFullscreen` was asked for, in order. */
  calls: boolean[];
  /** The resize handlers the app subscribed. */
  resized: Set<() => void>;
  /** The held reads, released by `releaseReads()`. */
  released: Array<() => void>;
};

const state: FakeTauriWindowState = {
  fullscreen: false,
  fail: false,
  hold: false,
  stubborn: false,
  reads: 0,
  calls: [],
  resized: new Set(),
  released: [],
};

/** The one fake window's state, so a test can set it up and read it back. */
export function fakeWindowState(): FakeTauriWindowState {
  return state;
}

/** The fake window itself, which the module mock's `getCurrentWindow` returns. */
export const fakeTauriWindow = {
  isFullscreen: async (): Promise<boolean> => {
    state.reads += 1;
    if (state.fail) {
      throw new Error("there is no Tauri window here");
    }
    if (state.hold) {
      await new Promise<void>((resolve) => state.released.push(resolve));
    }
    return state.fullscreen;
  },
  setFullscreen: async (next: boolean): Promise<void> => {
    state.calls.push(next);
    if (!state.stubborn) {
      state.fullscreen = next;
    }
  },
  onResized: async (handler: () => void): Promise<() => void> => {
    state.resized.add(handler);
    return () => {
      state.resized.delete(handler);
    };
  },
};

/** Back to a window that answers, before a test arranges its own. */
export function resetFakeWindow(): void {
  state.fullscreen = false;
  state.fail = false;
  state.hold = false;
  state.stubborn = false;
  state.reads = 0;
  state.calls.length = 0;
  state.resized.clear();
  state.released.length = 0;
}

/** Let every held read answer with the fact as it stands now. */
export function releaseReads(): void {
  for (const release of state.released.splice(0)) {
    release();
  }
}

/**
 * Pretend the webview is Tauri's. `window.__TAURI_INTERNALS__` is what Tauri v2
 * injects before the page runs, and what the hook's synchronous check looks for;
 * a bare object is enough, because the mocked window module answers the calls.
 */
export function installTauriRuntime(): void {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    value: {},
    configurable: true,
    writable: true,
  });
}

/** Be a plain browser: no Tauri runtime under the page at all. */
export function removeTauriRuntime(): void {
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
}
