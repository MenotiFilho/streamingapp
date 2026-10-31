import { describe, expect, test } from "vitest";

import type { Action } from "./wire";
import { actionKey, repeats } from "./actionKey";

describe("actionKey", () => {
  test("the same Action built in a different field order has one key", () => {
    const first = {
      type: "seek",
      target: { kind: "by", seconds: 10 },
    } as Action;
    const second = {
      target: { seconds: 10, kind: "by" },
      type: "seek",
    } as Action;

    expect(actionKey(first)).toBe(actionKey(second));
  });

  test("two different Actions never share a key", () => {
    const forward = {
      type: "seek",
      target: { kind: "by", seconds: 10 },
    } as Action;
    const backward = {
      type: "seek",
      target: { kind: "by", seconds: -10 },
    } as Action;

    expect(actionKey(forward)).not.toBe(actionKey(backward));
  });

  test("an array's order is part of the key", () => {
    const first = {
      type: "browse_catalog",
      addon: "community.example",
      catalog: { type: "movie", id: "top" },
      extra: [
        { name: "skip", value: "0" },
        { name: "genre", value: "drama" },
      ],
    } as Action;
    const second = {
      ...first,
      extra: [
        { name: "genre", value: "drama" },
        { name: "skip", value: "0" },
      ],
    } as Action;

    expect(actionKey(first)).not.toBe(actionKey(second));
  });
});

describe("repeats", () => {
  test("relative and toggling Actions are never joined", () => {
    for (const action of [
      { type: "seek", target: { kind: "by", seconds: 10 } },
      { type: "next_chapter" },
      { type: "previous_chapter" },
      { type: "autocrop" },
    ] as Action[]) {
      expect(repeats(action)).toBe(true);
    }
  });

  test("absolute Actions and the episode steps may be joined", () => {
    for (const action of [
      { type: "set_paused", paused: true },
      { type: "next_episode" },
      { type: "play_stream" },
    ] as Action[]) {
      expect(repeats(action)).toBe(false);
    }
  });
});
