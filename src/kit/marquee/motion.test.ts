import { afterEach, describe, expect, it } from "vitest";

import {
  FADE_EASE,
  FADE_FALLBACK,
  PANEL_FALLBACK,
  QUICK_FALLBACK,
  fade,
  panel,
  parseDuration,
  quick,
} from "./motion";

afterEach(() => {
  document.documentElement.style.removeProperty("--mq-motion-panel");
  document.documentElement.style.removeProperty("--mq-motion-quick");
  document.documentElement.style.removeProperty("--mq-motion-fade");
});

describe("parseDuration", () => {
  it("reads milliseconds as seconds", () => {
    expect(parseDuration("240ms", 1)).toBe(0.24);
    expect(parseDuration("140ms", 1)).toBe(0.14);
    expect(parseDuration("0ms", 1)).toBe(0);
  });

  it("reads seconds as seconds", () => {
    expect(parseDuration("0.24s", 1)).toBe(0.24);
    expect(parseDuration(" 1.5s ", 1)).toBe(1.5);
  });

  it("falls back on anything unreadable, negative or non-finite", () => {
    for (const unreadable of ["", "fast", "240", "-1s", "1e999s", undefined, null]) {
      expect(parseDuration(unreadable, 0.3)).toBe(0.3);
    }
  });
});

describe("Marquee motion presets", () => {
  it("pairs the recorded panel and quick durations with critically damped springs", () => {
    expect(panel()).toEqual({
      type: "spring",
      visualDuration: PANEL_FALLBACK,
      bounce: 0,
    });
    expect(quick()).toEqual({
      type: "spring",
      visualDuration: QUICK_FALLBACK,
      bounce: 0,
    });
  });

  it("carries one fade on the recorded ease curve", () => {
    expect(fade()).toEqual({
      duration: FADE_FALLBACK,
      ease: FADE_EASE,
    });
    expect(FADE_EASE).toEqual([0.22, 1, 0.36, 1]);
  });

  it("reads --mq-motion-* tokens at call time and preserves fade when reduced motion zeroes movement", () => {
    document.documentElement.style.setProperty("--mq-motion-panel", "0.32s");
    document.documentElement.style.setProperty("--mq-motion-quick", "90ms");
    document.documentElement.style.setProperty("--mq-motion-fade", "180ms");

    expect(panel()).toMatchObject({ type: "spring", visualDuration: 0.32, bounce: 0 });
    expect(quick()).toMatchObject({ type: "spring", visualDuration: 0.09, bounce: 0 });
    expect(fade()).toEqual({ duration: 0.18, ease: FADE_EASE });

    // Reduced motion zeroes panel and quick while keeping fade (ADR-0031 §5).
    document.documentElement.style.setProperty("--mq-motion-panel", "0ms");
    document.documentElement.style.setProperty("--mq-motion-quick", "0ms");
    document.documentElement.style.setProperty("--mq-motion-fade", "140ms");

    expect(panel()).toMatchObject({ visualDuration: 0, bounce: 0 });
    expect(quick()).toMatchObject({ visualDuration: 0, bounce: 0 });
    expect(fade()).toEqual({ duration: 0.14, ease: FADE_EASE });
  });
});
