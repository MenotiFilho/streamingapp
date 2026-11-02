import { afterEach, describe, expect, test, vi } from "vitest";

import {
  inputModality,
  installInputModality,
  markNavigation,
  markPointer,
  subscribeInputModality,
  type ModalityRoot,
} from "./inputModality";

/** A page root with no browser: listeners and the one attribute the installer writes. */
function fakeRoot() {
  const listeners = new Map<string, Set<(event: Event) => void>>();
  const added: string[] = [];
  const root: ModalityRoot = {
    dataset: {} as DOMStringMap,
    addEventListener(type, listener) {
      added.push(type);
      const held = listeners.get(type) ?? new Set();
      held.add(listener);
      listeners.set(type, held);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
  };

  return {
    root,
    added,
    fire(type: string) {
      for (const listener of listeners.get(type) ?? []) {
        listener(new Event(type));
      }
    },
  };
}

afterEach(() => {
  markPointer();
});

describe("the input modality", () => {
  test("starts in pointer mode, before any input", () => {
    expect(inputModality()).toBe("pointer");
  });

  test("a keydown is navigation and writes the stylesheet's attribute", () => {
    const page = fakeRoot();
    const stop = installInputModality(page.root);
    try {
      expect(page.root.dataset.input).toBe("pointer");

      page.fire("keydown");

      expect(inputModality()).toBe("navigation");
      expect(page.root.dataset.input).toBe("navigation");
    } finally {
      stop();
    }
  });

  test("a pointerdown is pointer again, and writes the attribute", () => {
    const page = fakeRoot();
    const stop = installInputModality(page.root);
    try {
      page.fire("keydown");
      expect(page.root.dataset.input).toBe("navigation");

      page.fire("pointerdown");

      expect(inputModality()).toBe("pointer");
      expect(page.root.dataset.input).toBe("pointer");
    } finally {
      stop();
    }
  });

  test("the installer is idempotent and cleanable", () => {
    const page = fakeRoot();
    const first = installInputModality(page.root);
    const second = installInputModality(page.root);

    expect(second, "a second install returns the first teardown").toBe(first);
    expect(page.added, "one capture listener per event, not two").toEqual([
      "keydown",
      "pointerdown",
    ]);

    first();

    page.fire("keydown");
    expect(inputModality(), "a cleaned installer no longer listens").toBe("pointer");
  });

  test("the pad's own mark reaches the attribute without a key event", () => {
    const page = fakeRoot();
    const stop = installInputModality(page.root);
    try {
      markNavigation();
      expect(page.root.dataset.input).toBe("navigation");
    } finally {
      stop();
    }
  });

  test("subscribers hear each change once, and only a change", () => {
    const seen = vi.fn();
    const stop = subscribeInputModality(seen);
    try {
      markNavigation();
      markNavigation();
      markPointer();

      expect(seen.mock.calls).toEqual([["navigation"], ["pointer"]]);
    } finally {
      stop();
    }
  });

  test("a root installed after the last input starts on the current modality", () => {
    markNavigation();
    const page = fakeRoot();
    const stop = installInputModality(page.root);
    try {
      expect(page.root.dataset.input).toBe("navigation");
    } finally {
      stop();
    }
  });
});
