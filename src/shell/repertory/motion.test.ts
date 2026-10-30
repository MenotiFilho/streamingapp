import { afterEach, describe, expect, it } from "vitest";

import {
  FADE_EASE,
  FADE_SECONDS,
  PANEL_FALLBACK,
  QUICK_FALLBACK,
  fade,
  panel,
  parseDuration,
  quick,
} from "./motion";

afterEach(() => {
  document.documentElement.style.removeProperty("--rep-motion-panel");
  document.documentElement.style.removeProperty("--rep-motion-quick");
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

  it("falls back on anything the sheet did not write as a duration", () => {
    for (const unreadable of ["", "fast", "240", "-1s", "1e999s", undefined, null]) {
      expect(parseDuration(unreadable, 0.3)).toBe(0.3);
    }
  });
});

describe("the motion presets", () => {
  it("pairs the recorded panel duration with a critically damped spring", () => {
    expect(panel()).toEqual({
      type: "spring",
      visualDuration: PANEL_FALLBACK,
      bounce: 0,
    });
  });

  it("pairs the recorded quick duration with a critically damped spring", () => {
    expect(quick()).toEqual({
      type: "spring",
      visualDuration: QUICK_FALLBACK,
      bounce: 0,
    });
  });

  it("reads the durations the sheet declares, at call time", () => {
    document.documentElement.style.setProperty("--rep-motion-panel", "0.4s");
    document.documentElement.style.setProperty("--rep-motion-quick", "80ms");

    expect(panel()).toMatchObject({ visualDuration: 0.4 });
    expect(quick()).toMatchObject({ visualDuration: 0.08 });

    document.documentElement.style.setProperty("--rep-motion-panel", "0ms");
    expect(panel()).toMatchObject({ visualDuration: 0 });
  });

  it("carries one fade: the sheet's 140ms on the sheet's curve", () => {
    expect(fade()).toEqual({ duration: FADE_SECONDS, ease: FADE_EASE });
    expect(FADE_EASE).toEqual([0.22, 1, 0.36, 1]);
  });
});
