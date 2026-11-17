import { describe, expect, test } from "vitest";

import { autoplayStrip, autoplayView } from "./autoplay";
import type { AutoplaySnapshot } from "./wire";

const NEXT = {
  title: { type: "series", id: "tt0903747" },
  video: { type: "series", id: "tt0903747:1:4" },
  episode: { season: 1, episode: 4 },
  name: "Cancer Man",
  still: "https://images.test/cancer-man.jpg",
};

function autoplay(remaining: number, overrides: Partial<AutoplaySnapshot> = {}): AutoplaySnapshot {
  return {
    next: NEXT,
    phase: "countdown",
    remaining,
    duration: 5,
    ...overrides,
  } as AutoplaySnapshot;
}

/** What the Host publishes at the unattended limit: no countdown, only where it leads. */
function held(): AutoplaySnapshot {
  return { next: NEXT, phase: "unattended_limit" };
}

describe("the autoplay view", () => {
  test("a Snapshot with nothing pending is none", () => {
    expect(autoplayView({ autoplay: null }, 0)).toEqual({ kind: "none" });
    expect(autoplayView({ autoplay: null }, 12_000)).toEqual({ kind: "none" });
  });

  test("a countdown carries the next episode as the Host named it", () => {
    const view = autoplayView({ autoplay: autoplay(5) }, 0);

    expect(view.kind).toBe("countdown");
    if (view.kind !== "countdown") {
      return;
    }
    expect(view.next).toEqual({
      title: { type: "series", id: "tt0903747" },
      video: { type: "series", id: "tt0903747:1:4" },
      label: "S1E4",
      name: "Cancer Man",
      still: "https://images.test/cancer-man.jpg",
    });
  });

  test("the digit is the whole seconds left, rounded up, from the Snapshot's arrival", () => {
    const digitAt = (remaining: number, since: number) => {
      const view = autoplayView({ autoplay: autoplay(remaining) }, since);
      return view.kind === "countdown" ? view.digit : null;
    };

    expect(digitAt(5, 0)).toBe(5);
    expect(digitAt(5, 1)).toBe(5);
    expect(digitAt(5, 999)).toBe(5);
    expect(digitAt(5, 1_000)).toBe(4);
    expect(digitAt(5, 4_001)).toBe(1);
    // A Snapshot built mid-countdown, as a reconnecting Remote receives it.
    expect(digitAt(2.5, 0)).toBe(3);
    expect(digitAt(2.5, 500)).toBe(2);
  });

  test("the digit is never below 1 while the countdown is up", () => {
    const view = (since: number) => autoplayView({ autoplay: autoplay(5) }, since);

    for (const since of [4_999, 5_000, 6_500, 60_000]) {
      const held = view(since);
      expect(held.kind).toBe("countdown");
      expect(held.kind === "countdown" ? held.digit : 0).toBe(1);
    }
  });

  test("the fraction drains from 1 to 0 across the countdown's length", () => {
    const fractionAt = (remaining: number, since: number) => {
      const view = autoplayView({ autoplay: autoplay(remaining) }, since);
      return view.kind === "countdown" ? view.fraction : null;
    };

    expect(fractionAt(5, 0)).toBe(1);
    expect(fractionAt(5, 2_500)).toBeCloseTo(0.5);
    expect(fractionAt(5, 5_000)).toBe(0);
    expect(fractionAt(5, 9_000), "never below empty").toBe(0);
    expect(fractionAt(2.5, 0), "mid-countdown Snapshot starts half drained").toBeCloseTo(0.5);
    expect(fractionAt(5, -3_000), "a clock that stepped back is the start").toBe(1);
  });

  test("a countdown with no length drains to nothing instead of dividing by zero", () => {
    const view = autoplayView({ autoplay: autoplay(0, { duration: 0 }) }, 0);

    expect(view.kind === "countdown" ? view.fraction : null).toBe(0);
    expect(view.kind === "countdown" ? view.digit : null).toBe(1);
  });

  test("the kicker names the episode, and the strip says how long is left", () => {
    const at = (since: number) => autoplayView({ autoplay: autoplay(5) }, since);

    const start = at(0);
    expect(start.kind === "countdown" ? start.kicker : null).toEqual({
      lead: "Up next",
      episode: "S1E4",
      text: "Up next · S1E4",
    });
    expect(start.kind === "countdown" ? start.strip : null).toBe("Up next in 5 · S1E4");

    const later = at(1_200);
    expect(later.kind === "countdown" ? later.strip : null).toBe("Up next in 4 · S1E4");
  });

  describe("still watching", () => {
    test("the hold is its own view, carrying the next episode as the Host named it", () => {
      const view = autoplayView({ autoplay: held() }, 0);

      expect(view).toEqual({
        kind: "still_watching",
        title: "Still watching?",
        next: {
          title: { type: "series", id: "tt0903747" },
          video: { type: "series", id: "tt0903747:1:4" },
          label: "S1E4",
          name: "Cancer Man",
          still: "https://images.test/cancer-man.jpg",
        },
        strip: "Still watching? · S1E4",
      });
    });

    test("the docked strip's text is the countdown's, the hold's, or nothing", () => {
      expect(autoplayStrip(autoplayView({ autoplay: autoplay(4) }, 0))).toBe("Up next in 4 · S1E4");
      expect(autoplayStrip(autoplayView({ autoplay: held() }, 0))).toBe("Still watching? · S1E4");
      expect(autoplayStrip(autoplayView({ autoplay: null }, 0))).toBeNull();
    });

    test("it has no countdown to project: time passing changes nothing", () => {
      const at = (since: number) => autoplayView({ autoplay: held() }, since);

      expect(at(0)).toEqual(at(60_000));
      expect(at(Number.NaN)).toEqual(at(0));
    });
  });
});
