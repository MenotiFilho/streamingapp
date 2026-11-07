import { describe, expect, test } from "vitest";

import {
  LOOK_HINT_DWELL_MS,
  LookHintDwell,
  lookHint,
  type LookHintTarget,
} from "./lookHint";

/**
 * The desktop's dwell decision (#278, ADR-0038 §3).
 *
 * A card is read ahead once focus or the pointer has rested on it briefly. The
 * decision is pure and its clock is injected, so "briefly" is a fact a test
 * sets rather than a timer it races.
 */

function clock(start = 1_000) {
  let at = start;
  return {
    now: () => at,
    tick: (milliseconds: number) => {
      at += milliseconds;
    },
  };
}

const ONE: LookHintTarget = { addon: "cinemeta", type: "movie", id: "tt1" };
const TWO: LookHintTarget = { addon: null, type: "series", id: "tmdb:1396" };

describe("the look-hint dwell", () => {
  test("a rest that lasts the dwell is due", () => {
    const time = clock();
    const dwell = new LookHintDwell(time.now);

    dwell.rest("focus", ONE);
    time.tick(LOOK_HINT_DWELL_MS - 1);
    expect(dwell.due(), "not yet").toBeNull();

    time.tick(1);
    expect(dwell.due()).toEqual(ONE);
    expect(dwell.due(), "one rest is one hint").toBeNull();
  });

  test("a card focused only in passing is never due", () => {
    const time = clock();
    const dwell = new LookHintDwell(time.now);

    dwell.rest("focus", ONE);
    time.tick(LOOK_HINT_DWELL_MS - 1);
    dwell.left("focus");
    time.tick(LOOK_HINT_DWELL_MS * 4);

    expect(dwell.due()).toBeNull();
    expect(dwell.remaining()).toBeNull();
  });

  test("focus and the pointer on one card are one hint", () => {
    const time = clock();
    const dwell = new LookHintDwell(time.now);

    dwell.rest("focus", ONE);
    time.tick(100);
    dwell.rest("pointer", ONE);
    time.tick(LOOK_HINT_DWELL_MS - 100);

    expect(dwell.due()).toEqual(ONE);
    expect(dwell.due(), "both rests were the one target").toBeNull();
  });

  test("a pointer leaving does not cancel the keyboard's rest", () => {
    const time = clock();
    const dwell = new LookHintDwell(time.now);

    dwell.rest("focus", ONE);
    dwell.rest("pointer", ONE);
    time.tick(100);
    dwell.left("pointer");
    time.tick(LOOK_HINT_DWELL_MS - 100);

    expect(dwell.due()).toEqual(ONE);
  });

  test("a rest that moves to another card replaces the card it left", () => {
    const time = clock();
    const dwell = new LookHintDwell(time.now);

    dwell.rest("pointer", ONE);
    time.tick(LOOK_HINT_DWELL_MS - 1);
    dwell.rest("pointer", TWO);
    time.tick(1);

    expect(dwell.due(), "the first card was left before its dwell").toBeNull();
    time.tick(LOOK_HINT_DWELL_MS - 1);
    expect(dwell.due()).toEqual(TWO);
  });

  test("the remaining time is the soonest rest's", () => {
    const time = clock();
    const dwell = new LookHintDwell(time.now);

    dwell.rest("focus", ONE);
    time.tick(150);
    dwell.rest("pointer", TWO);

    expect(dwell.remaining()).toBe(LOOK_HINT_DWELL_MS - 150);
    time.tick(LOOK_HINT_DWELL_MS - 150);
    expect(dwell.due()).toEqual(ONE);
    expect(
      dwell.remaining(),
      "the pointer's rest has less of the dwell left",
    ).toBe(LOOK_HINT_DWELL_MS - 250);
    time.tick(LOOK_HINT_DWELL_MS - 250);
    expect(dwell.due()).toEqual(TWO);
  });

  test("a hint names the Title the way a card does", () => {
    expect(lookHint(ONE)).toEqual({
      type: "look_hint",
      addon: "cinemeta",
      title: { type: "movie", id: "tt1" },
    });
    expect(lookHint(TWO)).toEqual({
      type: "look_hint",
      addon: null,
      title: { type: "series", id: "tmdb:1396" },
    });
  });
});
