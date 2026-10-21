import { describe, expect, test } from "vitest";

import {
  AXIS_THRESHOLD,
  KEY_INTENTS,
  PAD_AXES,
  PAD_BUTTONS,
  isTypingTarget,
  keyIntent,
  padIntents,
  type Intent,
  type PadLike,
} from "./input";
import { REPEATABLE } from "./shell/useGamepad";

const button = (pressed: boolean) => ({ pressed });

function pad(overrides: Partial<PadLike> = {}): PadLike {
  return {
    mapping: "standard",
    buttons: [],
    axes: [],
    ...overrides,
  };
}

describe("the keyboard's intent table", () => {
  test("maps the four arrows and Back", () => {
    expect(KEY_INTENTS).toMatchObject({
      ArrowUp: "up",
      ArrowDown: "down",
      ArrowLeft: "left",
      ArrowRight: "right",
      Escape: "back",
      Backspace: "back",
      GoBack: "back",
    });
  });

  test("keeps the keyboard column to navigation: no volume of its own", () => {
    expect(KEY_INTENTS).toEqual({
      ArrowUp: "up",
      ArrowDown: "down",
      ArrowLeft: "left",
      ArrowRight: "right",
      Escape: "back",
      Backspace: "back",
      GoBack: "back",
    });
  });

  test("leaves Enter and Space to the control's own activation", () => {
    expect(keyIntent("Enter", false)).toBeNull();
    expect(keyIntent(" ", false)).toBeNull();
  });

  test("leaves Left and Right to the caret inside a text field, but Up and Down still move out", () => {
    expect(keyIntent("ArrowLeft", true)).toBeNull();
    expect(keyIntent("ArrowRight", true)).toBeNull();
    expect(keyIntent("ArrowUp", true)).toBe("up");
    expect(keyIntent("ArrowDown", true)).toBe("down");
  });

  test("leaves Backspace to the text field, and takes it as Back outside one", () => {
    expect(keyIntent("Backspace", true)).toBeNull();
    expect(keyIntent("Backspace", false)).toBe("back");
  });

  test("Escape is Back wherever it is pressed", () => {
    expect(keyIntent("Escape", true)).toBe("back");
    expect(keyIntent("Escape", false)).toBe("back");
  });

  test("names a text entry by its element, not by any button or range", () => {
    const text = document.createElement("input");
    text.type = "text";
    const search = document.createElement("input");
    search.type = "search";
    const password = document.createElement("input");
    password.type = "password";
    const range = document.createElement("input");
    range.type = "range";
    const textarea = document.createElement("textarea");
    const select = document.createElement("select");

    expect(isTypingTarget(text)).toBe(true);
    expect(isTypingTarget(search)).toBe(true);
    expect(isTypingTarget(password)).toBe(true);
    expect(isTypingTarget(textarea)).toBe(true);
    expect(isTypingTarget(select)).toBe(false);
    expect(isTypingTarget(range)).toBe(false);
    expect(isTypingTarget(document.createElement("button"))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe("the standard-mapping gamepad", () => {
  test("maps the D-pad, A, B, X, Y and Back", () => {
    expect(PAD_BUTTONS).toMatchObject({
      12: "up",
      13: "down",
      14: "left",
      15: "right",
      0: "activate",
      1: "back",
      2: "volume_down",
      3: "volume_up",
      8: "back",
    });
  });

  test("puts the volume on the right cluster's left and top faces, X and Y", () => {
    expect(PAD_BUTTONS[2]).toBe("volume_down");
    expect(PAD_BUTTONS[3]).toBe("volume_up");
  });

  test("repeats the directions and the volume steps while held", () => {
    expect([...REPEATABLE].sort()).toEqual([
      "down",
      "left",
      "right",
      "up",
      "volume_down",
      "volume_up",
    ]);
  });

  test("reads pressed buttons into intents, in index order", () => {
    const held = pad({
      buttons: [button(false), button(true), button(false), button(false), button(false), button(false), button(false), button(false), button(false), button(false), button(false), button(false), button(true)],
    });

    expect(padIntents(held)).toEqual<Intent[]>(["back", "up"]);
  });

  test("reads X and Y as the two volume steps", () => {
    const held = pad({
      buttons: [button(false), button(false), button(true), button(true)],
    });

    expect(padIntents(held)).toEqual<Intent[]>(["volume_down", "volume_up"]);
  });

  test("reads the left stick past the threshold in both directions", () => {
    expect(padIntents(pad({ axes: [-0.6, 0.75] }))).toEqual<Intent[]>(["left", "down"]);
    expect(padIntents(pad({ axes: [0.6, -0.75] }))).toEqual<Intent[]>(["right", "up"]);
  });

  test("ignores a stick resting at or inside the threshold", () => {
    expect(AXIS_THRESHOLD).toBe(0.5);
    expect(padIntents(pad({ axes: [AXIS_THRESHOLD, -AXIS_THRESHOLD] }))).toEqual<Intent[]>([]);
  });

  test("maps the axes by their standard indices", () => {
    expect(PAD_AXES).toMatchObject({
      0: { negative: "left", positive: "right" },
      1: { negative: "up", positive: "down" },
    });
  });

  test("ignores a pad that is not in the standard mapping", () => {
    const deviceSpecific = pad({ mapping: "", buttons: [button(true)], axes: [1, 1] });
    expect(padIntents(deviceSpecific)).toEqual<Intent[]>([]);
  });

  test("says nothing when there is no pad", () => {
    expect(padIntents(null)).toEqual<Intent[]>([]);
    expect(padIntents(undefined)).toEqual<Intent[]>([]);
  });
});
