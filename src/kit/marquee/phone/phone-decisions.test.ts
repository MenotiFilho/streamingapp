import { describe, expect, it } from "vitest";

import {
  ADDON_ROW_PITCH,
  dragLimits,
  dragTarget,
  keyTarget,
} from "./editMove";
import { HERO_SWIPE_DISTANCE, heroSwipe } from "./heroSwipe";
import {
  normalizePairingEntry,
  PAIRING_CODE_LENGTH,
  pairingCells,
} from "./pairingEntry";
import {
  clampRatio,
  levelAt,
  pointerRatio,
  SEEK_KEY_STEP,
  seekKeyTarget,
  VOLUME_KEY_STEP,
  volumeKeyTarget,
} from "./seekMath";
import {
  SHEET_DISMISS_OFFSET,
  SHEET_DISMISS_VELOCITY,
  shouldDismissSheet,
} from "./sheetDismiss";
import { tabItems } from "./tabSelection";

describe("seek and volume math (sheet C8)", () => {
  it("clamps ratios to 0..1 and defaults non-finite values to 0", () => {
    expect(clampRatio(0.45)).toBe(0.45);
    expect(clampRatio(-0.3)).toBe(0);
    expect(clampRatio(1.7)).toBe(1);
    expect(clampRatio(Number.NaN)).toBe(0);
    expect(clampRatio(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("maps pointer coordinates along a track width to a clamped ratio", () => {
    expect(pointerRatio(150, 100, 200)).toBe(0.25);
    expect(pointerRatio(50, 100, 200)).toBe(0);
    expect(pointerRatio(360, 100, 200)).toBe(1);
    expect(pointerRatio(150, 100, 0)).toBe(0);
  });

  it("rounds volume levels onto the Player's scale", () => {
    expect(levelAt(0.624, 100)).toBe(62);
    expect(levelAt(0.625, 100)).toBe(63);
    expect(levelAt(2, 100)).toBe(100);
    expect(levelAt(-1, 100)).toBe(0);
    expect(levelAt(0.5, -10)).toBe(0);
  });

  it("steps seek position by 10s and clamps at both ends", () => {
    expect(SEEK_KEY_STEP).toBe(10);
    expect(seekKeyTarget("ArrowRight", 30, 120)).toBe(40);
    expect(seekKeyTarget("ArrowLeft", 30, 120)).toBe(20);
    expect(seekKeyTarget("ArrowLeft", 4, 120)).toBe(0);
    expect(seekKeyTarget("ArrowRight", 115, 120)).toBe(120);
    expect(seekKeyTarget("Home", 50, 120)).toBe(0);
    expect(seekKeyTarget("End", 50, 120)).toBe(120);
    expect(seekKeyTarget("Enter", 50, 120)).toBeNull();
  });

  it("steps volume by 5 on arrow keys and clamps to 0..max", () => {
    expect(VOLUME_KEY_STEP).toBe(5);
    expect(volumeKeyTarget("ArrowUp", 50, 100)).toBe(55);
    expect(volumeKeyTarget("ArrowRight", 98, 100)).toBe(100);
    expect(volumeKeyTarget("ArrowDown", 50, 100)).toBe(45);
    expect(volumeKeyTarget("ArrowLeft", 2, 100)).toBe(0);
    expect(volumeKeyTarget("Home", 60, 100)).toBe(0);
    expect(volumeKeyTarget("End", 60, 100)).toBe(100);
    expect(volumeKeyTarget("Space", 60, 100)).toBeNull();
  });
});

describe("pairing code entry (sheet C8)", () => {
  it("normalizes typed or pasted characters to 6 uppercase alphanumerics", () => {
    expect(PAIRING_CODE_LENGTH).toBe(6);
    expect(normalizePairingEntry("k7q-x 4m")).toBe("K7QX4M");
    expect(normalizePairingEntry("k7qx4m99")).toBe("K7QX4M");
    expect(normalizePairingEntry("ab!")).toBe("AB");
  });

  it("marks the first empty cell active only while focused and incomplete", () => {
    const partial = pairingCells("k7qx", true);
    expect(partial.map((cell) => cell.char)).toEqual(["K", "7", "Q", "X", "", ""]);
    expect(partial.map((cell) => cell.active)).toEqual([
      false,
      false,
      false,
      false,
      true,
      false,
    ]);

    expect(pairingCells("k7qx", false).every((cell) => !cell.active)).toBe(true);
    expect(pairingCells("k7qx4m", true).every((cell) => !cell.active)).toBe(true);
  });
});

describe("phone tab selection (sheet C8)", () => {
  it("offers the six Host destinations in order and marks only the active one", () => {
    const tabs = tabItems("addons");
    expect(tabs.map((tab) => tab.id)).toEqual([
      "home",
      "discover",
      "search",
      "library",
      "addons",
      "settings",
    ]);
    expect(tabs.map((tab) => tab.label)).toEqual([
      "Home",
      "Discover",
      "Search",
      "Library",
      "Addons",
      "Settings",
    ]);
    expect(tabs.filter((tab) => tab.active).map((tab) => tab.id)).toEqual(["addons"]);
  });
});

describe("Addons Edit-mode move bounds (sheet C8)", () => {
  it("bounds drag distance to the first and last slots", () => {
    expect(ADDON_ROW_PITCH).toBe(88);
    expect(dragLimits(0, 4)).toEqual({ min: 0, max: 3 * 88 });
    expect(dragLimits(2, 4)).toEqual({ min: -2 * 88, max: 88 });
    expect(dragLimits(3, 4)).toEqual({ min: -3 * 88, max: 0 });
    expect(dragLimits(0, 1)).toEqual({ min: 0, max: 0 });
    expect(dragLimits(0, 0)).toEqual({ min: 0, max: 0 });
  });

  it("resolves nearest slot from drag offset and clamps to 0..count-1", () => {
    expect(dragTarget(1, 90, 4)).toBe(2);
    expect(dragTarget(1, -500, 4)).toBe(0);
    expect(dragTarget(1, 500, 4)).toBe(3);
    expect(dragTarget(1, 30, 4)).toBe(1);
    expect(dragTarget(1, 100, 4, 0)).toBe(1);
  });

  it("moves up and down by arrow keys while stopping at both ends", () => {
    expect(keyTarget("ArrowUp", 0, 3)).toBeNull();
    expect(keyTarget("ArrowUp", 2, 3)).toBe(1);
    expect(keyTarget("ArrowDown", 1, 3)).toBe(2);
    expect(keyTarget("ArrowDown", 2, 3)).toBeNull();
    expect(keyTarget("Enter", 1, 3)).toBeNull();
  });
});

describe("phone hero swipe and bottom sheet dismiss (sheet C8)", () => {
  it("recognizes horizontal swipes past the threshold and ignores vertical scroll gestures", () => {
    expect(HERO_SWIPE_DISTANCE).toBe(40);
    expect(heroSwipe(-40, 10)).toBe("next");
    expect(heroSwipe(64, -12)).toBe("previous");
    expect(heroSwipe(-39, 0)).toBeNull();
    expect(heroSwipe(-50, 60)).toBeNull();
    expect(heroSwipe(45, -45)).toBeNull();
  });

  it("dismisses the bottom sheet only on downward offset or downward flick", () => {
    expect(shouldDismissSheet(0, 1000)).toBe(false);
    expect(shouldDismissSheet(-120, 1000)).toBe(false);
    expect(shouldDismissSheet(SHEET_DISMISS_OFFSET, 0)).toBe(true);
    expect(shouldDismissSheet(12, SHEET_DISMISS_VELOCITY)).toBe(true);
    expect(shouldDismissSheet(SHEET_DISMISS_OFFSET - 1, SHEET_DISMISS_VELOCITY - 1)).toBe(false);
  });
});
