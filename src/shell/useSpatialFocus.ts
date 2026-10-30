import { useEffect, useRef } from "react";

import {
  DEFAULT_RULES,
  decideMove,
  rehome,
  type Direction,
  type Focus,
  type Rules,
} from "../focus";
import {
  isTypingTarget,
  keyIntent,
  REPEAT_AFTER_MS,
  REPEAT_EVERY_MS,
  type Intent,
} from "../input";
import { firstFocusable, focusOf, readLevel } from "./layout";
import { focusLanded, onRevealed, reveal } from "./reveal";
import { useGamepad } from "./useGamepad";

type Remembered = Focus & { element: HTMLElement | null };

export type SpatialFocusOptions = {
  /** The root of the level that is on top — the base, or a pushed overlay. */
  root: () => HTMLElement | null;
  /** A stable id for the level; each level keeps its own focus. */
  levelKey: string;
  /** What Back means when the top level has no more local answer. */
  onBack: () => void;
  /**
   * The level's own first look at an intent that is not Back — the player's
   * Up/Down ladder and its volume. Return true when the level took it, and the
   * focus engine leaves the intent alone.
   */
  onIntent?: (intent: Intent) => boolean;
  /** The edge rules this level uses; the settled defaults when omitted. */
  rules?: Rules;
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
export function useSpatialFocus({
  root,
  levelKey,
  onBack,
  onIntent,
  rules = DEFAULT_RULES,
}: SpatialFocusOptions) {
  const rootRef = useRef(root);
  const rulesRef = useRef(rules);
  rulesRef.current = rules;
  rootRef.current = root;
  const keyRef = useRef(levelKey);
  keyRef.current = levelKey;
  const backRef = useRef(onBack);
  backRef.current = onBack;
  const intentRef = useRef(onIntent);
  intentRef.current = onIntent;

  /** For each level, where each region was last left. */
  const regions = useRef(new Map<string, Record<string, number | undefined>>());
  /** For each level, the exact control focus was on, if it is still there. */
  const remembered = useRef(new Map<string, Remembered>());
  /**
   * For each level, the last control focus was on outside the rail, the window
   * chrome and a dialog. The rail's Right returns here when the rules ask for
   * it, so leaving the content for the programme index is not a one-way trip.
   */
  const lastContent = useRef(new Map<string, Remembered>());
  /** The control the reveal last ran for, so an ordinary render does not scroll again. */
  const revealed = useRef<HTMLElement | null>(null);
  /** A held key's first and last accepted press, so the keyboard repeats like the pad. */
  const keyRepeat = useRef(new Map<string, { first: number; last: number }>());

  /**
   * Take a direct `focusAndReveal`'s reveal as the engine's own, so the render
   * that follows does not repeat it. A control outside the level is not the
   * engine's to guard.
   */
  const seedRevealed = (element: HTMLElement) => {
    const activeRoot = rootRef.current();
    if (activeRoot?.contains(element)) {
      revealed.current = element;
    }
  };

  const regionMemory = (key: string): Record<string, number | undefined> => {
    let held = regions.current.get(key);
    if (!held) {
      held = {};
      regions.current.set(key, held);
    }
    return held;
  };

  /**
   * Reveal a focused control once, and only when focus actually moved to it.
   * The focusin path catches programmatic focus anywhere in the level; the
   * guard keeps a re-render from scrolling a control a person deliberately
   * wheeled away. Focus leaving the level forgets the guard, so a return to the
   * same control reveals it again.
   */
  const revealFocused = (element: HTMLElement) => {
    const activeRoot = rootRef.current();
    if (!activeRoot) {
      return;
    }
    if (!activeRoot.contains(element)) {
      revealed.current = null;
      return;
    }
    if (revealed.current === element) {
      return;
    }
    revealed.current = element;
    reveal(element);
  };

  /**
   * Focus without the browser's own scroll, then reveal. The focusin listener
   * may have revealed it already (focus moves fire it synchronously); the guard
   * makes the second look a no-op. Focus can also be refused — a remembered
   * control that turned disabled or hidden since the level measured it — and its
   * 0x0 rectangle would jolt the page, so only the element that now holds focus
   * is revealed.
   */
  const focusElement = (element: HTMLElement) => {
    element.focus({ preventScroll: true });
    const landed = focusLanded(element);
    if (landed) {
      revealFocused(landed);
    }
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
    const { layout, elements } = readLevel(activeRoot, regionMemory(keyRef.current));
    const found = focusOf(element, elements);
    if (found) {
      const kind = layout.regions[found.regionId]?.kind;
      if (kind !== undefined && kind !== "rail" && kind !== "window" && kind !== "dialog") {
        lastContent.current.set(keyRef.current, { ...found, element });
      }
      rememberFocus(found, element);
    }
  };

  /**
   * Where the content was last focused, if that control is still one this level
   * can give focus to. A control that left, turned disabled, or was pruned with
   * an emptied region is not a landing, and the rail's Right falls back to the
   * first content control instead.
   */
  const rememberedContent = (
    activeRoot: HTMLElement,
    elements: Record<string, HTMLElement[]>,
  ): Focus | null => {
    const held = lastContent.current.get(keyRef.current);
    const element = held?.element;
    if (
      !element ||
      !element.isConnected ||
      !activeRoot.contains(element) ||
      !element.hasAttribute("data-focusable") ||
      element.matches(":disabled")
    ) {
      return null;
    }
    return focusOf(element, elements);
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
      // A control auto-focused while the level mounted reaches neither the
      // engine nor a focusin listener that was not bound yet; reveal it once.
      revealFocused(active);
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

      const landing = rehome(layout, held, rulesRef.current);
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

    const rules = rulesRef.current;
    const last =
      rules.railExit === "last" ? rememberedContent(activeRoot, elements) : null;
    const decision = decideMove(layout, current, direction, rules, last);
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
    // The level on top gets the first word: the player's Up/Down ladder and its
    // volume are not geometry, and its own answer is the one that holds.
    if (intentRef.current?.(intent)) {
      return;
    }
    if (intent === "activate") {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.hasAttribute("data-focusable")) {
        active.click();
      }
      return;
    }
    // Anything the level did not claim and the engine has no use for — a
    // volume step outside the player — is not a move and is ignored.
    if (intent === "up" || intent === "down" || intent === "left" || intent === "right") {
      move(intent);
    }
  };

  const runRef = useRef(run);
  runRef.current = run;
  const rememberRef = useRef(rememberElement);
  rememberRef.current = rememberElement;
  const ensureRef = useRef(ensureFocus);
  ensureRef.current = ensureFocus;
  const revealRef = useRef(revealFocused);
  revealRef.current = revealFocused;
  const seedRef = useRef(seedRevealed);
  seedRef.current = seedRevealed;

  // Direct focus moves (`focusAndReveal`) reveal without the engine, so their
  // control seeds the guard the engine's own reveal keeps. The subscription is
  // declared before `ensureFocus`'s effect: on a mount, a child's focus effect
  // runs before the engine's effects, and the replay in `onRevealed` lets that
  // same first `ensureFocus` skip the repeat. A later render is covered too.
  useEffect(() => onRevealed((element) => seedRef.current(element)), []);

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
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      if (event.repeat) {
        const held = keyRepeat.current.get(event.key);
        if (
          held &&
          (now - held.first < REPEAT_AFTER_MS || now - held.last < REPEAT_EVERY_MS)
        ) {
          event.preventDefault();
          return;
        }
        if (held) {
          held.last = now;
        }
      } else {
        keyRepeat.current.set(event.key, { first: now, last: now });
      }
      event.preventDefault();
      runRef.current(intent);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      keyRepeat.current.delete(event.key);
    };

    const onFocusIn = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement) {
        rememberRef.current(event.target);
        revealRef.current(event.target);
      }
    };

    // A control can leave while the level stays: a screen inside the level
    // answers and swaps its waiting state for the real one. The focus engine
    // only re-homes on a render, and that swap is a child's render, so focus
    // would be left on the removed control. Put it back on the next control the
    // level offers.
    const onFocusOut = (event: FocusEvent) => {
      const root = rootRef.current();
      if (!root) {
        return;
      }
      const next = event.relatedTarget;
      if (next instanceof Node && root.contains(next)) {
        return;
      }
      queueMicrotask(() => {
        const latest = rootRef.current();
        if (!latest) {
          return;
        }
        const active = document.activeElement;
        if (
          active instanceof HTMLElement &&
          latest.contains(active) &&
          active.hasAttribute("data-focusable")
        ) {
          return;
        }
        ensureRef.current();
      });
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
    document.addEventListener("keyup", onKeyUp);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut, true);
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut, true);
      document.removeEventListener("click", onClick, true);
    };
  }, []);

  useGamepad((intent) => runRef.current(intent));
}
