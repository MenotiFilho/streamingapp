import { describe, expect, it } from "vitest";

import { openingFill, openingPhase } from "./openingPhase";
import { PANEL_RISE, panelMotion, panelTransition } from "./panelMotion";
import { PLAYER_MENUS, playerMenus } from "./playerMenus";
import {
  levelAt,
  levelKeyTarget,
  pointerFraction,
  secondsAt,
  seekKeyTarget,
  seekable,
} from "./seekMath";
import { sizeFraction } from "./sizeScale";
import { tierTone } from "./streamTier";

describe("seek math", () => {
  const rect = { left: 160, width: 1600 };

  it("names the moment under the pointer, held to the Stream's two ends", () => {
    expect(secondsAt(960, rect, 3000)).toBe(1500);
    expect(secondsAt(0, rect, 3000)).toBe(0);
    expect(secondsAt(4000, rect, 3000)).toBe(3000);
  });

  it("names nothing on a track not laid out or a Stream with no length", () => {
    expect(pointerFraction(10, { left: 0, width: 0 })).toBeNull();
    expect(secondsAt(960, rect, null)).toBeNull();
    expect(secondsAt(960, rect, 0)).toBeNull();
    expect(seekable(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it("steps ten seconds sideways, a minute by page, and to either end", () => {
    expect(seekKeyTarget("ArrowLeft", 100, 3000)).toBe(90);
    expect(seekKeyTarget("ArrowRight", 100, 3000)).toBe(110);
    expect(seekKeyTarget("PageDown", 100, 3000)).toBe(40);
    expect(seekKeyTarget("PageUp", 100, 3000)).toBe(160);
    expect(seekKeyTarget("Home", 100, 3000)).toBe(0);
    expect(seekKeyTarget("End", 100, 3000)).toBe(3000);
  });

  it("clamps a step at the ends and leaves Up, Down and activation to the room", () => {
    expect(seekKeyTarget("ArrowLeft", 4, 3000)).toBe(0);
    expect(seekKeyTarget("ArrowRight", 2999, 3000)).toBe(3000);
    for (const key of ["ArrowUp", "ArrowDown", "Enter", " ", "Escape"]) {
      expect(seekKeyTarget(key, 100, 3000), key).toBeNull();
    }
    expect(seekKeyTarget("ArrowRight", 100, null)).toBeNull();
  });

  it("reads the volume level from the pointer in whole steps of the Host's scale", () => {
    expect(levelAt(240, { left: 160, width: 160 }, 130)).toBe(65);
    expect(levelAt(500, { left: 160, width: 160 }, 130)).toBe(130);
    expect(levelAt(240, { left: 160, width: 0 }, 130)).toBeNull();
  });

  it("gives the level its page and end keys, and never the arrows", () => {
    expect(levelKeyTarget("PageUp", 128, 130, 5)).toBe(130);
    expect(levelKeyTarget("PageDown", 3, 130, 5)).toBe(0);
    expect(levelKeyTarget("Home", 70, 130, 5)).toBe(0);
    expect(levelKeyTarget("End", 70, 130, 5)).toBe(130);
    for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]) {
      expect(levelKeyTarget(key, 70, 130, 5), key).toBeNull();
    }
  });
});

describe("the size stepper's knob (ADR-0044 §5)", () => {
  it("sits at the ends for 25% and 300% and between them for the rest", () => {
    expect(sizeFraction(0.25)).toBe(0);
    expect(sizeFraction(3)).toBe(1);
    expect(sizeFraction(1.15)).toBeCloseTo(0.327, 3);
  });

  it("stays on the track for a size from outside the ladder", () => {
    expect(sizeFraction(0.1)).toBe(0);
    expect(sizeFraction(9)).toBe(1);
    expect(sizeFraction(Number.NaN)).toBe(0);
  });
});

describe("the Opening fill (ADR-0044 §7)", () => {
  it("rises phase by phase and is whole only at playing", () => {
    const fills = (["opening", "finding", "fetching", "playing"] as const).map(openingFill);
    expect(fills).toEqual([...fills].sort((a, b) => a - b));
    expect(new Set(fills).size).toBe(4);
    expect(fills[0]).toBeGreaterThan(0);
    expect(fills[2]).toBeLessThan(1);
    expect(fills[3]).toBe(1);
  });

  it("reads the phase from the Snapshot's state and Torrent status", () => {
    const torrent = (phase: "finding" | "fetching") => ({ phase, peers: 2, rate: 1000 });
    expect(openingPhase({ state: "opening", torrent: null })).toBe("opening");
    expect(openingPhase({ state: "opening", torrent: torrent("finding") })).toBe("finding");
    expect(openingPhase({ state: "opening", torrent: torrent("fetching") })).toBe("fetching");
    expect(openingPhase({ state: "playing", torrent: torrent("fetching") })).toBe("playing");
    expect(openingPhase({ state: "idle", torrent: null })).toBeNull();
    expect(openingPhase({ state: "ended", torrent: null })).toBeNull();
  });
});

describe("panel motion (ADR-0031 §4–§5)", () => {
  it("slides the side panel from its edge and raises a floating one 12–16px", () => {
    expect(panelMotion("side", false).initial).toEqual({ opacity: 0, x: "100%" });
    expect(panelMotion("floating", false).initial).toEqual({ opacity: 0, y: PANEL_RISE });
    expect(PANEL_RISE).toBeGreaterThanOrEqual(12);
    expect(PANEL_RISE).toBeLessThanOrEqual(16);
  });

  it("leaves the way it came", () => {
    for (const placement of ["side", "floating"] as const) {
      const states = panelMotion(placement, false);
      expect(states.exit).toEqual(states.initial);
    }
  });

  it("keeps only the fade under reduced motion", () => {
    for (const placement of ["side", "floating"] as const) {
      expect(panelMotion(placement, true)).toEqual({
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
      });
    }
  });

  it("moves in no time under reduced motion, never on a default spring", () => {
    expect(panelTransition(true)).toMatchObject({ default: { type: "tween", duration: 0 } });
    expect(panelTransition(false)).toMatchObject({ default: { type: "spring", bounce: 0 } });
  });
});

describe("the player's menus", () => {
  it("offers the eight triggers in the sheet's order", () => {
    expect(PLAYER_MENUS.map((menu) => menu.label)).toEqual([
      "Picture",
      "Audio & Subtitles",
      "Streams",
      "Episodes",
      "Speed",
      "Chapters",
      "Details",
      "Full screen",
    ]);
  });

  it("keeps that order whatever a client says this Stream has", () => {
    expect(playerMenus(["fullscreen", "speed", "picture"]).map((menu) => menu.id)).toEqual([
      "picture",
      "speed",
      "fullscreen",
    ]);
    expect(playerMenus()).toHaveLength(8);
  });
});

describe("the Stream tier box", () => {
  it("is lavender for the 4K class and quiet for the rest", () => {
    for (const label of ["4K", "4k", "2160p", "UHD"]) {
      expect(tierTone(label), label).toBe("uhd");
    }
    for (const label of ["1080p", "720p", "480p", "SD"]) {
      expect(tierTone(label), label).toBe("hd");
    }
  });
});
