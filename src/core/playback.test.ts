import { describe, expect, test } from "vitest";

import { closingAfter, pictureBehind, requestsStop } from "./playback";

describe("when the shell stops painting its own rectangle", () => {
  test("a Stream in this window puts the picture behind the shell", () => {
    expect(pictureBehind({ state: "playing", picture: "in_window" }, false)).toBe(true);
    expect(pictureBehind({ state: "opening", picture: "in_window" }, false)).toBe(true);
  });

  test("a Stream shown elsewhere, or none, leaves the shell painting", () => {
    expect(pictureBehind({ state: "playing", picture: "own_window" }, false)).toBe(false);
    expect(pictureBehind({ state: "playing", picture: "nowhere" }, false)).toBe(false);
    expect(pictureBehind({ state: "idle", picture: "in_window" }, false)).toBe(false);
    expect(pictureBehind(null, false)).toBe(false);
  });

  test("a requested Stop takes the shell's ink back before the Host reports idle", () => {
    // The Host tears mpv's window down before it publishes `idle`; the hole is
    // unpainted for that gap unless the shell paints first (#250).
    expect(pictureBehind({ state: "playing", picture: "in_window" }, true)).toBe(false);
    expect(pictureBehind({ state: "paused", picture: "in_window" }, true)).toBe(false);
    expect(pictureBehind({ state: "opening", picture: "in_window" }, true)).toBe(false);
  });
});

describe("which Actions close the Stream", () => {
  test("only Stop does", () => {
    expect(requestsStop({ type: "stop_playback" })).toBe(true);
    expect(requestsStop({ type: "set_paused", paused: true })).toBe(false);
    expect(requestsStop({ type: "next_episode" })).toBe(false);
  });
});

describe("how long a Stop is held", () => {
  test("a requested Stop is held while the Stream is still reported", () => {
    expect(closingAfter(true, { state: "playing", picture: "in_window" })).toBe(true);
  });

  test("it ends once the Host reports nothing playing, so the next Stream shows its picture", () => {
    expect(closingAfter(true, { state: "idle", picture: "in_window" })).toBe(false);
    expect(closingAfter(true, null)).toBe(false);
  });

  test("a Stop nobody asked for is never invented", () => {
    expect(closingAfter(false, { state: "playing", picture: "in_window" })).toBe(false);
  });
});
