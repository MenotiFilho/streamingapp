import { describe, expect, test } from "vitest";

import { FADE_SECONDS, PANEL_FALLBACK } from "./motion";
import {
  DESTINATION_FADE_SECONDS,
  SPINE_LIMIT,
  SPINE_POINTER_GRACE_MS,
  destinationTransition,
  spineDestinations,
  spineLabelTransition,
  spineOpensOnFocus,
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

  test("a fresh pointer press does not open the spine, but keyboard focus does", () => {
    expect(spineOpensOnFocus(1_000, 1_000 + SPINE_POINTER_GRACE_MS)).toBe(false);
    expect(spineOpensOnFocus(1_000, 1_000 + SPINE_POINTER_GRACE_MS + 1)).toBe(true);
    expect(spineOpensOnFocus(0, 1_000), "no press at all is keyboard or programmatic").toBe(
      true,
    );
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
});
