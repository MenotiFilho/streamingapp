import { useEffect, useRef } from "react";

import {
  DEFAULT_RULES,
  decideMove,
  rehome,
  type Direction,
  type Focus,
} from "../focus";
import { isTypingTarget, keyIntent, type Intent } from "../input";
import { firstFocusable, focusOf, readLevel } from "./layout";
import { useGamepad } from "./useGamepad";

type Remembered = Focus & { element: HTMLElement | null };

export type SpatialFocusOptions = {
  /** The root of the level that is on top — the base, or a pushed overlay. */
  root: () => HTMLElement | null;
  /** A stable id for the level; each level keeps its own focus. */
  levelKey: string;
  /** What Back means when the top level has no more local answer. */
  onBack: () => void;
};

/**
 * Drive one level's focus from the DOM.
 *
 * The hook reads the level's rectangles into the pure model, decides a move,
 * and paints the result by focusing the element. It remembers where each level
 * was left so a pushed overlay restores the exact focus underneath when Back
 * pops it, and it re-homes focus when the control it was on disappears.
 *
 * Keyboard and standard-mapping gamepad are one intent stream here. The phone
 * companion has no pad column: it is served over plain HTTP, an insecure
 * origin where `getGamepads()` returns nothing (research #49).
 */
export function useSpatialFocus({ root, levelKey, onBack }: SpatialFocusOptions) {
  const rootRef = useRef(root);
  rootRef.current = root;
  const keyRef = useRef(levelKey);
  keyRef.current = levelKey;
  const backRef = useRef(onBack);
  backRef.current = onBack;

  /** For each level, where each region was last left. */
  const regions = useRef(new Map<string, Record<string, number | undefined>>());
  /** For each level, the exact control focus was on, if it is still there. */
  const remembered = useRef(new Map<string, Remembered>());

  const regionMemory = (key: string): Record<string, number | undefined> => {
    let held = regions.current.get(key);
    if (!held) {
      held = {};
      regions.current.set(key, held);
    }
    return held;
  };

  const focusElement = (element: HTMLElement) => {
    element.focus({ preventScroll: true });
    element.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  };

  const rememberFocus = (focus: Focus, element: HTMLElement | null) => {
    const key = keyRef.current;
    regionMemory(key)[focus.regionId] = focus.index;
    remembered.current.set(key, { ...focus, element });
  };

  const rememberElement = (element: HTMLElement) => {
    const activeRoot = rootRef.current();
    if (!activeRoot || !activeRoot.contains(element) || !element.hasAttribute("data-focusable")) {
      return;
    }
    const { elements } = readLevel(activeRoot, regionMemory(keyRef.current));
    const found = focusOf(element, elements);
    if (found) {
      rememberFocus(found, element);
    }
  };

  const ensureFocus = () => {
    const activeRoot = rootRef.current();
    if (!activeRoot) {
      return;
    }

    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      active !== activeRoot &&
      activeRoot.contains(active) &&
      active.hasAttribute("data-focusable")
    ) {
      return;
    }

    const key = keyRef.current;
    const memory = regionMemory(key);
    const { layout, elements } = readLevel(activeRoot, memory);
    const held = remembered.current.get(key);

    if (held) {
      const exact = held.element;
      if (
        exact &&
        exact.isConnected &&
        activeRoot.contains(exact) &&
        exact.hasAttribute("data-focusable")
      ) {
        focusElement(exact);
        return;
      }

      const landing = rehome(layout, held, DEFAULT_RULES);
      if (landing) {
        const target = elements[landing.regionId]?.[landing.index];
        if (target) {
          rememberFocus(landing, target);
          focusElement(target);
          return;
        }
      }
    }

    const first = firstFocusable(activeRoot);
    if (first) {
      rememberElement(first);
      focusElement(first);
    }
  };

  const move = (direction: Direction) => {
    const activeRoot = rootRef.current();
    if (!activeRoot) {
      return;
    }

    const key = keyRef.current;
    const { layout, elements } = readLevel(activeRoot, regionMemory(key));
    const active = document.activeElement;
    const current =
      focusOf(active instanceof HTMLElement ? active : null, elements) ??
      remembered.current.get(key) ??
      null;

    if (!current) {
      ensureFocus();
      return;
    }

    const decision = decideMove(layout, current, direction, DEFAULT_RULES);
    if (decision.kind === "blocked") {
      return;
    }

    const target = elements[decision.regionId]?.[decision.index];
    if (target) {
      rememberFocus({ regionId: decision.regionId, index: decision.index }, target);
      focusElement(target);
    }
  };

  const run = (intent: Intent) => {
    if (intent === "back") {
      backRef.current();
      return;
    }
    if (intent === "activate") {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.hasAttribute("data-focusable")) {
        active.click();
      }
      return;
    }
    move(intent);
  };

  const runRef = useRef(run);
  runRef.current = run;
  const rememberRef = useRef(rememberElement);
  rememberRef.current = rememberElement;

  // Something is always focused on the level that is on top. This also puts
  // focus back when an overlay pops, and re-homes it when a control vanished.
  useEffect(() => {
    ensureFocus();
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }
      const intent = keyIntent(event.key, isTypingTarget(document.activeElement));
      if (!intent) {
        return;
      }
      event.preventDefault();
      runRef.current(intent);
    };

    const onFocusIn = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement) {
        rememberRef.current(event.target);
      }
    };

    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const control = target.closest("[data-focusable]");
      if (control instanceof HTMLElement) {
        rememberRef.current(control);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("click", onClick, true);
    };
  }, []);

  useGamepad((intent) => runRef.current(intent));
}
