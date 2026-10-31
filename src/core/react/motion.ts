import type { Transition } from "motion/react";

/**
 * The repertory's motion presets (ADR-0031, design record §6).
 *
 * The two durations live in `tokens.css` as `--rep-motion-panel` and
 * `--rep-motion-quick`, so the window's Motion components and the served
 * Remote's `animate()` calls read one number from one sheet. This module reads
 * those custom properties at call time — not at import time — because the sheet
 * changes under a reduced-motion media query without a reload.
 *
 * `document` and `getComputedStyle` are guarded so the presets can be imported
 * by a test or a non-DOM renderer and still answer with the recorded fallbacks.
 */

/** The recorded panel duration, in seconds: `--rep-motion-panel`'s value. */
export const PANEL_FALLBACK = 0.24;

/** The recorded quick duration, in seconds: `--rep-motion-quick`'s value. */
export const QUICK_FALLBACK = 0.14;

/** The one fade: opacity and colour only, never movement. */
export const FADE_SECONDS = 0.14;

/** `cubic-bezier(0.22, 1, 0.36, 1)`, as Motion spells a bezier. */
export const FADE_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/**
 * Read a CSS duration as seconds.
 *
 * `240ms` and `0.24s` are both `0.24`; anything unreadable, negative or
 * infinite is `fallback` rather than a motion that never settles.
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

/** One custom property's duration, or the fallback when there is no document. */
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

/** A pushed level, a drawer, a popover, the spine, a rail's scroll. */
export function panel(): Transition {
  return {
    type: "spring",
    visualDuration: readDuration("--rep-motion-panel", PANEL_FALLBACK),
    bounce: 0,
  };
}

/** A focus reveal inside a rail, and other small state changes. */
export function quick(): Transition {
  return {
    type: "spring",
    visualDuration: readDuration("--rep-motion-quick", QUICK_FALLBACK),
    bounce: 0,
  };
}

/** Opacity and colour: the same fade CSS carries, in Motion. */
export function fade(): Transition {
  return { duration: FADE_SECONDS, ease: FADE_EASE };
}
