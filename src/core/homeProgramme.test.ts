import { describe, expect, it } from "vitest";

import type { Row } from "./browse";
import type { AddonManifest, Snapshot } from "./wire";
import {
  FEATURE_ROTATION_MS,
  FEATURE_START,
  clampItem,
  continueTag,
  featureDragBegin,
  featureDragClick,
  featureDragEnd,
  featureDragMove,
  featureElapse,
  featureHold,
  featureJump,
  featureProgress,
  featureRelease,
  featureRotates,
  featureStep,
  featureStepThrough,
  homeEmptyState,
  homeSectionIndex,
  rowTag,
  type FeatureProgramme,
} from "./homeProgramme";

/**
 * Home's programme decisions, asked of the core both clients draw from
 * (ADR-0035 §1): the beat, the feature's position, the section numbering, a
 * row's tag and the empty programme's words.
 */

const ADDON: AddonManifest = {
  id: "cinemeta",
  name: "Cinemeta",
  version: "3.0.14",
  resources: [],
  types: ["movie"],
  catalogs: [],
  idPrefixes: ["tt"],
  behaviorHints: { configurable: false, configurationRequired: false },
};

const SNAPSHOT = {
  addons: [ADDON],
  featuredCatalog: null,
  watchProgress: [],
} as unknown as Snapshot;

describe("Home's programme decisions", () => {
  it("holds one feature for 24 seconds", () => {
    expect(FEATURE_ROTATION_MS).toBe(24_000);
  });

  it("steps a feature only while there is a slide in that direction", () => {
    expect(featureStep(0, 4, 1)).toBe(1);
    expect(featureStep(2, 4, -1)).toBe(1);
    expect(featureStep(0, 4, -1), "Left at the first slide is the frame's").toBeNull();
    expect(featureStep(3, 4, 1), "Right at the last slide is the frame's").toBeNull();
    expect(featureStep(0, 1, 1)).toBeNull();
  });

  it("numbers a section after the feature, and after Continue watching where it is drawn", () => {
    expect(homeSectionIndex(0, true)).toBe("02");
    expect(homeSectionIndex(0, false)).toBe("01");
    expect(homeSectionIndex(2, true)).toBe("04");
  });

  it("prints a row's tag from its Addon and the count it has loaded", () => {
    const row: Row = {
      addon: "cinemeta",
      type: "movie",
      id: "top",
      name: "Popular",
      metas: [],
      offset: 0,
      failure: null,
      done: false,
    };

    expect(rowTag(null, row), "the Addon's id before the Snapshot names it").toBe(
      "cinemeta / 0 films",
    );
    expect(rowTag(SNAPSHOT, row)).toBe("Cinemeta / 0 films");
  });

  it("prints the count a caller caps, while the whole row prints its own", () => {
    const metas = Array.from({ length: 30 }, (_, index) => ({
      id: `tt${index}`,
      type: "movie" as const,
      name: `Film ${index}`,
      poster: null,
      posterShape: "poster" as const,
      releaseInfo: "2026",
      imdbRating: null,
      genres: [],
      description: null,
    }));
    const row = {
      addon: "cinemeta",
      type: "movie" as const,
      id: "top",
      name: "Popular",
      metas,
      offset: 0,
      failure: null,
      done: true,
    };
    expect(rowTag(SNAPSHOT, row, 20)).toBe("Cinemeta / 20 films");
    expect(rowTag(SNAPSHOT, row)).toBe("Cinemeta / 30 films");
  });

  it("spells Continue watching's bookkeeping once, for every row that prints it", () => {
    expect(continueTag(0)).toBe("0 in progress");
    expect(continueTag(1)).toBe("1 in progress");
    expect(continueTag(7)).toBe("7 in progress");
  });

  it("holds an item's index inside a programme of its size", () => {
    expect(clampItem(2, 4)).toBe(2);
    expect(clampItem(9, 4)).toBe(3);
    expect(clampItem(-1, 4)).toBe(0);
    expect(clampItem(2, 0)).toBe(0);
  });

  it("says what an empty programme needs in the record's voice", () => {
    expect(homeEmptyState(null, 0)).toBeNull();
    expect(homeEmptyState(SNAPSHOT, 1)).toBeNull();
    expect(homeEmptyState({ ...SNAPSHOT, addons: [] }, 0)).toEqual({
      title: "Nothing is screening tonight.",
      body: "Add an Addon to open the programme.",
      action: "addons",
    });
    expect(homeEmptyState(SNAPSHOT, 0)).toEqual({
      title: "Nothing is screening tonight.",
      body: "No Addon offers a Catalog to print.",
      action: "addons",
    });
  });
});

/** A programme part-way through an item, as the seam's callers hold it. */
function at(index: number, elapsed = 0, held = false): FeatureProgramme {
  return { index, elapsed, held };
}

/**
 * The feature's programme as both clients steer it (ADR-0036 §2): a step that
 * wraps, a tick that jumps and restarts, a hold that pauses, and a beat that
 * keeps turning under reduced motion.
 */
describe("The feature's programme", () => {
  it("starts on the first item with its whole time ahead of it", () => {
    expect(FEATURE_START).toEqual(at(0));
  });

  it("steps through the programme, wrapping at either end and restarting the item's time", () => {
    expect(featureStepThrough(at(0, 12_000), 4, 1)).toEqual(at(1));
    expect(
      featureStepThrough(at(0, 12_000), 4, -1),
      "Left at the first item wraps",
    ).toEqual(at(3));
    expect(
      featureStepThrough(at(3, 23_000), 4, 1),
      "Right at the last item wraps",
    ).toEqual(at(0));
  });

  it("spends each item's 24 seconds and wraps to the next with the remainder", () => {
    expect(featureElapse(at(0), 4, 12_000)).toEqual(at(0, 12_000));
    expect(featureElapse(at(0), 4, FEATURE_ROTATION_MS)).toEqual(at(1));
    expect(featureElapse(at(3, 23_950), 4, 100)).toEqual(at(0, 50));
    expect(
      featureElapse(at(0, 1_000), 1, FEATURE_ROTATION_MS),
      "one item has nowhere to turn",
    ).toEqual(at(0, 1_000));
  });

  it("jumps to the tick a person presses and restarts that item's time", () => {
    expect(featureJump(at(0, 12_000), 4, 2)).toEqual(at(2));
    expect(featureJump(at(0), 4, 9), "a tick outside the programme lands on the last").toEqual(
      at(3),
    );
    expect(featureJump(at(0), 4, -1)).toEqual(at(0));
  });

  it("holds the fill and resumes it from where it stopped", () => {
    const held = featureHold(at(0, 5_000));
    expect(featureElapse(held, 4, FEATURE_ROTATION_MS)).toEqual(held);
    expect(featureElapse(featureRelease(held), 4, 4_000)).toEqual(at(0, 9_000));
  });

  it("fills the current tick over the item's 24 seconds", () => {
    expect(featureProgress(at(0))).toBe(0);
    expect(featureProgress(at(0, 12_000))).toBe(0.5);
    expect(featureProgress(at(0, FEATURE_ROTATION_MS))).toBe(1);
  });

  it("keeps the beat under reduced motion", () => {
    expect(featureRotates(4), "ADR-0036 §2 supersedes 'reduced motion stops it'").toBe(true);
    expect(featureRotates(1)).toBe(false);
    expect(featureRotates(0)).toBe(false);
  });
});

/**
 * The gesture both clients read: a hand lands, travels, and lets go. The rule
 * that decides a step is the same on the window's drag and the Remote's swipe
 * (ADR-0035 §1, ADR-0036 §2).
 */
describe("The feature's drag", () => {
  it("steps forward on a leftward gesture and back on a rightward one", () => {
    expect(featureDragMove(featureDragBegin(320, 200), 240, 204).direction).toBe(1);
    expect(featureDragMove(featureDragBegin(200, 200), 300, 198).direction).toBe(-1);
  });

  it("leaves a short gesture, or one that travelled further down, to the page", () => {
    expect(
      featureDragMove(featureDragBegin(200, 200), 220, 200).direction,
      "under the threshold",
    ).toBeNull();
    expect(
      featureDragMove(featureDragBegin(200, 200), 260, 260).direction,
      "across and down by the same amount is not across",
    ).toBeNull();
    expect(featureDragMove(featureDragBegin(200, 200), 200, 400).direction).toBeNull();
  });

  it("steps once per gesture: a long drag does not run through the programme", () => {
    const first = featureDragMove(featureDragBegin(320, 200), 240, 200);
    expect(first.direction).toBe(1);
    expect(
      featureDragMove(first.drag, 0, 200),
      "the rest of the gesture is spent",
    ).toEqual({ drag: first.drag, direction: null });
  });

  it("does not step after the hand has let go", () => {
    const ended = featureDragEnd(featureDragBegin(320, 200));
    expect(ended.active).toBe(false);
    expect(featureDragMove(ended, 240, 200).direction).toBeNull();
  });

  it("claims the click a drag synthesises, and clears the flag for the next press", () => {
    const stepped = featureDragMove(featureDragBegin(320, 200), 240, 200).drag;

    const dragClick = featureDragClick(stepped, 1);
    expect(dragClick.ours).toBe(true);
    expect(dragClick.drag.stepped).toBe(false);

    expect(featureDragClick(stepped, 0).ours, "a keyboard click is never the drag's").toBe(false);
  });

  it("does not let a swipe that produced no click swallow the next keyboard Enter", () => {
    const swallowed = featureDragMove(featureDragBegin(320, 200), 240, 200).drag;

    const keyboard = featureDragClick(swallowed, 0);
    expect(keyboard.ours).toBe(false);
    expect(keyboard.drag.stepped, "the stale step is cleared").toBe(false);

    const later = featureDragClick(keyboard.drag, 0);
    expect(later.ours).toBe(false);
  });
});
