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
    fire(type: string, init: Record<string, unknown> = {}) {
      const event = new Event(type);
      for (const [key, value] of Object.entries(init)) {
        Object.defineProperty(event, key, { value, configurable: true });
      }
      for (const listener of listeners.get(type) ?? []) {
        listener(event);
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

  test("arrow keys enter navigation and write the stylesheet's attribute", () => {
    const page = fakeRoot();
    const stop = installInputModality(page.root);
    try {
      expect(page.root.dataset.input).toBe("pointer");

      page.fire("keydown", { key: "ArrowDown" });

      expect(inputModality()).toBe("navigation");
      expect(page.root.dataset.input).toBe("navigation");
    } finally {
      stop();
    }
  });

  test("Tab, Shift+Tab, Enter, Escape, and typing keys keep pointer modality", () => {
    const page = fakeRoot();
    const stop = installInputModality(page.root);
    try {
      for (const init of [
        { key: "Tab" },
        { key: "Tab", shiftKey: true },
        { key: "Enter" },
        { key: "Escape" },
        { key: "a" },
        { key: "ArrowLeft", target: { tagName: "INPUT", type: "text" } },
      ]) {
        page.fire("keydown", init);
        expect(inputModality()).toBe("pointer");
        expect(page.root.dataset.input).toBe("pointer");
      }

      // Vertical arrows leave a text input, and horizontal arrows outside one navigate.
      page.fire("keydown", { key: "ArrowUp", target: { tagName: "INPUT", type: "text" } });
      expect(inputModality()).toBe("navigation");
    } finally {
      stop();
    }
  });

  test("pointerdown, wheel, and real mouse movement return to pointer modality", () => {
    const page = fakeRoot();
    const stop = installInputModality(page.root);
    try {
      page.fire("keydown", { key: "ArrowRight" });
      expect(inputModality()).toBe("navigation");

      page.fire("pointerdown", { clientX: 100, clientY: 100 });
      expect(inputModality()).toBe("pointer");
      expect(page.root.dataset.input).toBe("pointer");

      page.fire("keydown", { key: "ArrowDown" });
      expect(inputModality()).toBe("navigation");

      // A stationary synthetic pointermove at the previous coordinates does not flip modality.
      page.fire("pointermove", { pointerType: "mouse", clientX: 100, clientY: 100 });
      expect(inputModality()).toBe("navigation");

      // Moving the mouse to new coordinates returns to pointer modality.
      page.fire("pointermove", { pointerType: "mouse", clientX: 240, clientY: 320 });
      expect(inputModality()).toBe("pointer");

      page.fire("keydown", { key: "ArrowLeft" });
      expect(inputModality()).toBe("navigation");

      page.fire("wheel");
      expect(inputModality()).toBe("pointer");
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
      "pointermove",
      "wheel",
    ]);

    first();

    page.fire("keydown", { key: "ArrowDown" });
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
