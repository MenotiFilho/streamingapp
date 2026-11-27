import type { Transition } from "motion/react";

/**
 * Marquee's Motion presets (ADR-0031, `docs/design-system.md` §6).
 *
 * The durations live in `src/kit/marquee/tokens.css` as `--mq-motion-panel`,
 * `--mq-motion-quick` and `--mq-motion-fade`, so CSS transitions and Motion
 * components read one set of numbers from one sheet. Properties are read at
 * call time — never at import time — because `@media (prefers-reduced-motion:
 * reduce)` zeroes the two movement durations without a reload while leaving
 * `--mq-motion-fade` intact (ADR-0031 §5).
 *
 * `document` and `getComputedStyle` are guarded so the presets can be called in
 * a non-DOM context and still answer with the recorded fallbacks.
 */

/** The recorded panel spring duration in seconds (`--mq-motion-panel`). */
export const PANEL_FALLBACK = 0.24;

/** The recorded quick spring duration in seconds (`--mq-motion-quick`). */
export const QUICK_FALLBACK = 0.14;

/** The recorded fade duration in seconds (`--mq-motion-fade`). */
export const FADE_FALLBACK = 0.14;

/** `cubic-bezier(0.22, 1, 0.36, 1)`, as Motion spells a bezier. */
export const FADE_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/**
 * Read a CSS duration as seconds.
 *
 * `240ms` and `0.24s` are both `0.24`; anything unreadable, negative or
 * non-finite falls back rather than producing a transition that never settles.
 */
export function parseDuration(value: string | null | undefined, fallback: number): number {
  if (value === null || value === undefined) {
    return fallback;
  }
  const match = /^\s*(\d*\.?\d+)\s*(ms|s)\s*$/i.exec(value);
  if (!match) {
    return fallback;
  }
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount < 0) {
    return fallback;
  }
  return match[2]?.toLowerCase() === "ms" ? amount / 1000 : amount;
}

/** One custom property's duration in seconds, or the fallback without a DOM. */
function readDuration(property: string, fallback: number): number {
  if (typeof document === "undefined" || typeof getComputedStyle !== "function") {
    return fallback;
  }
  try {
    const value = getComputedStyle(document.documentElement).getPropertyValue(property);
    return parseDuration(value, fallback);
  } catch {
    return fallback;
  }
}

/** Rail expand/collapse, hero mode slide, row scroll, panels and moving Addon rows. */
export function panel(): Transition {
  return {
    type: "spring",
    visualDuration: readDuration("--mq-motion-panel", PANEL_FALLBACK),
    bounce: 0,
  };
}

/** Focused card scale and other quick state changes. */
export function quick(): Transition {
  return {
    type: "spring",
    visualDuration: readDuration("--mq-motion-quick", QUICK_FALLBACK),
    bounce: 0,
  };
}

/** Opacity and colour fades: the same curve CSS carries, preserved under reduced motion. */
export function fade(): Transition {
  return {
    duration: readDuration("--mq-motion-fade", FADE_FALLBACK),
    ease: FADE_EASE,
  };
}
