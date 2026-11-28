import { describe, expect, it } from "vitest";

import type { Row } from "./browse";
import type { AddonManifest, MetaPreview, Snapshot } from "./wire";
import {
  FEATURE_ROTATION_MS,
  FEATURE_START,
  captionParts,
  clampItem,
  continueTag,
  countLabel,
  featureDragBegin,
  featureDragClick,
  featureDragEnd,
  featureDragMove,
  featureElapse,
  featureHold,
  featureJump,
  featureNeighbour,
  featureProgress,
  featureRelease,
  featureRotates,
  featureStep,
  featureStepThrough,
  featureTitleDensity,
  homeEmptyState,
  homeSectionIndex,
  programIndex,
  ratingOf,
  rowTag,
  yearOf,
  type FeatureDrag,
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
  enabled: true,
};

const SNAPSHOT = {
  addons: [ADDON],
  featuredCatalog: null,
  watchProgress: [],
} as unknown as Snapshot;

describe("Home's programme decisions", () => {
  it("holds one feature for 15 seconds", () => {
    expect(FEATURE_ROTATION_MS).toBe(15_000);
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

  it("spends each item's 15 seconds and wraps to the next with the remainder", () => {
    expect(featureElapse(at(0), 4, 12_000)).toEqual(at(0, 12_000));
    expect(featureElapse(at(0), 4, FEATURE_ROTATION_MS)).toEqual(at(1));
    expect(featureElapse(at(3, 14_950), 4, 100)).toEqual(at(0, 50));
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

  it("fills the current tick over the item's 15 seconds", () => {
    expect(featureProgress(at(0))).toBe(0);
    expect(featureProgress(at(0, 7_500))).toBe(0.5);
    expect(featureProgress(at(0, FEATURE_ROTATION_MS))).toBe(1);
  });

  it("keeps the beat under reduced motion", () => {
    expect(featureRotates(4), "ADR-0036 §2 supersedes 'reduced motion stops it'").toBe(true);
    expect(featureRotates(1)).toBe(false);
    expect(featureRotates(0)).toBe(false);
  });
});

/**
 * The gesture both clients read: a hand lands, the slides follow it, and the
 * release either commits to the neighbour or snaps back. The decisions are the
 * same on the window's drag and the Remote's swipe (ADR-0035 §1, ADR-0036 §2).
 *
 * jsdom has no layout, so the width the release is judged against is handed in;
 * the components read it from the frame only at the edges of the gesture.
 */
describe("The feature's gesture", () => {
  const WIDTH = 400;

  function move(drag: FeatureDrag, x: number, y: number, time: number) {
    return featureDragMove(drag, x, y, time, WIDTH);
  }

  function begin(x: number, y: number, time = 0) {
    return featureDragBegin(x, y, time);
  }

  it("keeps a hand inside the slop pending, so a tap is still a tap", () => {
    const moved = move(begin(200, 200), 206, 204, 16);

    expect(moved.drag.axis, "under the slop nothing is claimed").toBe("pending");
    expect(moved.offset).toBe(0);
    expect(moved.direction).toBeNull();
    expect(moved.drag.claimed).toBe(false);
  });

  it("moves the slide with the hand once it travels across", () => {
    const moved = move(begin(300, 200), 220, 204, 16);

    expect(moved.drag.axis).toBe("across");
    expect(moved.direction, "a leftward hand brings the next item").toBe(1);
    expect(moved.offset, "the slide tracks the hand 1:1").toBe(-80);
    expect(moved.drag.claimed).toBe(true);
  });

  it("brings the previous item from the other side, and clamps at one frame", () => {
    const right = move(begin(100, 200), 180, 198, 16);
    expect(right.direction).toBe(-1);
    expect(right.offset).toBe(80);

    const past = move(begin(300, 200), -300, 200, 16);
    expect(past.offset, "one frame is as far as a slide can be pulled").toBe(-WIDTH);
  });

  it("leaves a vertical gesture to the page and does not change its mind", () => {
    const down = move(begin(200, 200), 204, 260, 16);
    expect(down.drag.axis).toBe("down");
    expect(down.offset).toBe(0);
    expect(down.direction).toBeNull();
    expect(down.drag.claimed).toBe(false);

    const later = move(down.drag, 320, 262, 32);
    expect(later.drag.axis, "the page owns the whole gesture").toBe("down");
    expect(later.direction).toBeNull();
  });

  it("commits a release past the share of the frame", () => {
    const dragged = move(begin(300, 200), 190, 200, 16);
    expect(dragged.offset).toBe(-110);

    const released = featureDragEnd(dragged.drag, WIDTH, 32);
    expect(released.direction, "110 of 400 is past the share").toBe(1);
    expect(released.drag.active).toBe(false);
  });

  it("snaps back under the share when the hand has slowed", () => {
    const dragged = move(begin(300, 200), 240, 200, 16);
    expect(dragged.offset).toBe(-60);

    const released = featureDragEnd(dragged.drag, WIDTH, 400);
    expect(released.direction).toBeNull();
  });

  it("commits a short fast flick, and only in the direction the hand is going", () => {
    const flick = move(begin(300, 200), 240, 200, 16);
    const committed = featureDragEnd(flick.drag, WIDTH, 20);
    expect(committed.direction, "60 of 400, but 3.75 px/ms").toBe(1);

    const rested = featureDragEnd(flick.drag, WIDTH, 200);
    expect(rested.direction, "a hand that stopped before letting go is not a flick").toBeNull();

    // Back the other way at the end: the last sample's speed agrees with the
    // pointer, not with the distance travelled, so this is a snap.
    const reversed = move(
      move(begin(300, 200), 220, 200, 16).drag,
      250,
      200,
      20,
    );
    expect(featureDragEnd(reversed.drag, WIDTH, 24).direction).toBeNull();
  });

  it("does not step after the hand has let go", () => {
    const ended = featureDragEnd(begin(320, 200), WIDTH, 16).drag;
    expect(ended.active).toBe(false);
    expect(move(ended, 240, 200, 32).direction).toBeNull();
  });

  it("names the neighbour a step lands on, wrapping at either end", () => {
    expect(featureNeighbour(0, 4, -1)).toBe(3);
    expect(featureNeighbour(3, 4, 1)).toBe(0);
    expect(featureNeighbour(1, 4, 1)).toBe(2);
    expect(featureNeighbour(1, 4, -1)).toBe(0);
  });

  it("claims the click a drag synthesises, and clears the flag for the next press", () => {
    const dragged = move(begin(320, 200), 240, 200, 16).drag;

    const dragClick = featureDragClick(dragged, 1);
    expect(dragClick.ours).toBe(true);
    expect(dragClick.drag.claimed).toBe(false);

    expect(featureDragClick(dragged, 0).ours, "a keyboard click is never the drag's").toBe(false);
  });

  it("does not let a swipe that produced no click swallow the next keyboard Enter", () => {
    const swallowed = move(begin(320, 200), 240, 200, 16).drag;

    const keyboard = featureDragClick(swallowed, 0);
    expect(keyboard.ours).toBe(false);
    expect(keyboard.drag.claimed, "the stale claim is cleared").toBe(false);

    const later = featureDragClick(keyboard.drag, 0);
    expect(later.ours).toBe(false);
  });
});

function meta(overrides: Partial<MetaPreview> = {}): MetaPreview {
  return {
    id: "tt0000001",
    type: "movie",
    name: "A Film",
    poster: null,
    posterShape: "poster",
    releaseInfo: "2026",
    imdbRating: "7.5",
    genres: ["Drama", "Romance"],
    description: null,
    ...overrides,
  };
}

describe("a caption's parts", () => {
  it("are the year, the rating and at most two genres", () => {
    expect(captionParts(meta())).toEqual({
      year: "2026",
      rating: "IMDb 7.5",
      genres: "Drama / Romance",
    });
  });

  it("leave out what the Addon did not say rather than inventing it", () => {
    expect(captionParts(meta({ releaseInfo: null, imdbRating: "", genres: [] }))).toEqual({
      year: null,
      rating: null,
      genres: null,
    });
    expect(ratingOf(meta({ imdbRating: "  " }))).toBeNull();
    expect(yearOf(meta({ releaseInfo: "2023–" }))).toBe("2023");
  });

  it("carry no runtime, which a Meta preview does not have", () => {
    expect(Object.keys(captionParts(meta())).sort()).toEqual(["genres", "rating", "year"]);
  });
});

describe("a row's bookkeeping words", () => {
  it("gives a short feature the full size and a long one the smaller bands", () => {
    expect(featureTitleDensity("The Invite")).toBe("regular");
    expect(featureTitleDensity("A Very Long Title That Still Fits")).toBe("long");
    expect(featureTitleDensity("A Title So Long It Needs The Smallest Band Of All")).toBe(
      "very-long",
    );
  });

  it("numbers from two digits and counts rows in the right noun", () => {
    expect(programIndex(1)).toBe("01");
    expect(programIndex(12)).toBe("12");
    expect(countLabel("movie", 1)).toBe("1 film");
    expect(countLabel("movie", 49)).toBe("49 films");
    expect(countLabel("series", 2)).toBe("2 series");
    expect(countLabel("channel", 2)).toBe("2 titles");
  });
});
