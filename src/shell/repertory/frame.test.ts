import { describe, expect, test } from "vitest";

import { FADE_SECONDS, PANEL_FALLBACK } from "./motion";
import {
  DESTINATION_FADE_SECONDS,
  LEVEL_PUSH_PX,
  SPINE_LIMIT,
  destinationTransition,
  levelPushed,
  spineDestinations,
  spineLabelTransition,
  spineWidthTransition,
} from "./frame";

describe("the frame's decisions", () => {
  test("the spine lists at most fifteen destinations, then the More card", () => {
    const many = Array.from({ length: 20 }, (_, index) => `destination-${index}`);
    expect(spineDestinations(many)).toHaveLength(SPINE_LIMIT);
    expect(spineDestinations(many)).toEqual(many.slice(0, SPINE_LIMIT));
  });

  test("the spine's width uses the panel spring and snaps under reduced motion", () => {
    expect(spineWidthTransition(false)).toMatchObject({
      type: "spring",
      visualDuration: PANEL_FALLBACK,
      bounce: 0,
    });
    expect(spineWidthTransition(true), "movement is gone under reduced motion").toEqual({
      duration: 0,
    });
  });

  test("the label reveal keeps a fade under reduced motion", () => {
    expect(spineLabelTransition(false)).toMatchObject({
      type: "spring",
      visualDuration: PANEL_FALLBACK,
      bounce: 0,
    });
    expect(spineLabelTransition(true)).toMatchObject({
      duration: FADE_SECONDS,
    });
  });

  test("a destination switch cross-fades the base in 240ms and does not wait", () => {
    expect(DESTINATION_FADE_SECONDS).toBe(0.24);
    expect(destinationTransition()).toMatchObject({ duration: 0.24 });
  });

  test("an overlay is a pushed level; the player and the OSD's popovers are not", () => {
    expect(levelPushed("overlay"), "a Title, Streams, a leaf, a dialog, the grid").toBe(true);
    expect(levelPushed("player"), "the player takes the window").toBe(false);
    expect(levelPushed("popover"), "an OSD popover rises from its own anchor").toBe(false);
  });

  test("a pushed level enters 24px from the trailing edge", () => {
    expect(LEVEL_PUSH_PX).toBe(24);
  });
});
