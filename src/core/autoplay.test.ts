import { describe, expect, test } from "vitest";

import {
  autoplayStrip,
  autoplayView,
  missingStreamVideo,
  opensPicker,
  pickerTarget,
  plainEnd,
} from "./autoplay";
import type { AutoplaySnapshot, Video } from "./wire";

const NEXT = {
  title: { type: "series", id: "tt0903747" },
  video: { type: "series", id: "tt0903747:1:4" },
  episode: { season: 1, episode: 4 },
  name: "Cancer Man",
  still: "https://images.test/cancer-man.jpg",
};

type Counting = Extract<AutoplaySnapshot, { phase: "countdown" }>;

function autoplay(remaining: number, overrides: Partial<Counting> = {}): Counting {
  return {
    next: NEXT,
    phase: "countdown",
    remaining,
    duration: 5,
    ...overrides,
  };
}

/** What the Host publishes at the unattended limit: no countdown, only where it leads. */
function held(): AutoplaySnapshot {
  return { next: NEXT, phase: "unattended_limit" };
}

describe("the autoplay view", () => {
  test("a Snapshot with nothing pending is none", () => {
    expect(autoplayView({ autoplay: null }, 0)).toEqual({ kind: "none" });
    expect(autoplayView({ autoplay: null }, 12_000)).toEqual({ kind: "none" });
  });

  test("a countdown carries the next episode as the Host named it", () => {
    const view = autoplayView({ autoplay: autoplay(5) }, 0);

    expect(view.kind).toBe("countdown");
    if (view.kind !== "countdown") {
      return;
    }
    expect(view.next).toEqual({
      title: { type: "series", id: "tt0903747" },
      video: { type: "series", id: "tt0903747:1:4" },
      episode: { season: 1, episode: 4 },
      label: "S1E4",
      name: "Cancer Man",
      still: "https://images.test/cancer-man.jpg",
    });
  });

  test("the digit is the whole seconds left, rounded up, from the Snapshot's arrival", () => {
    const digitAt = (remaining: number, since: number) => {
      const view = autoplayView({ autoplay: autoplay(remaining) }, since);
      return view.kind === "countdown" ? view.digit : null;
    };

    expect(digitAt(5, 0)).toBe(5);
    expect(digitAt(5, 1)).toBe(5);
    expect(digitAt(5, 999)).toBe(5);
    expect(digitAt(5, 1_000)).toBe(4);
    expect(digitAt(5, 4_001)).toBe(1);
    // A Snapshot built mid-countdown, as a reconnecting Remote receives it.
    expect(digitAt(2.5, 0)).toBe(3);
    expect(digitAt(2.5, 500)).toBe(2);
  });

  test("the digit is never below 1 while the countdown is up", () => {
    const view = (since: number) => autoplayView({ autoplay: autoplay(5) }, since);

    for (const since of [4_999, 5_000, 6_500, 60_000]) {
      const held = view(since);
      expect(held.kind).toBe("countdown");
      expect(held.kind === "countdown" ? held.digit : 0).toBe(1);
    }
  });

  test("the fraction drains from 1 to 0 across the countdown's length", () => {
    const fractionAt = (remaining: number, since: number) => {
      const view = autoplayView({ autoplay: autoplay(remaining) }, since);
      return view.kind === "countdown" ? view.fraction : null;
    };

    expect(fractionAt(5, 0)).toBe(1);
    expect(fractionAt(5, 2_500)).toBeCloseTo(0.5);
    expect(fractionAt(5, 5_000)).toBe(0);
    expect(fractionAt(5, 9_000), "never below empty").toBe(0);
    expect(fractionAt(2.5, 0), "mid-countdown Snapshot starts half drained").toBeCloseTo(0.5);
    expect(fractionAt(5, -3_000), "a clock that stepped back is the start").toBe(1);
  });

  test("a countdown with no length drains to nothing instead of dividing by zero", () => {
    const view = autoplayView({ autoplay: autoplay(0, { duration: 0 }) }, 0);

    expect(view.kind === "countdown" ? view.fraction : null).toBe(0);
    expect(view.kind === "countdown" ? view.digit : null).toBe(1);
  });

  test("the kicker names the episode, and the strip says how long is left", () => {
    const at = (since: number) => autoplayView({ autoplay: autoplay(5) }, since);

    const start = at(0);
    expect(start.kind === "countdown" ? start.kicker : null).toEqual({
      lead: "Up next",
      episode: "S1E4",
      text: "Up next · S1E4",
    });
    expect(start.kind === "countdown" ? start.strip : null).toBe("Up next in 5 · S1E4");

    const later = at(1_200);
    expect(later.kind === "countdown" ? later.strip : null).toBe("Up next in 4 · S1E4");
  });

  describe("still watching", () => {
    test("the hold is its own view, carrying the next episode as the Host named it", () => {
      const view = autoplayView({ autoplay: held() }, 0);

      expect(view).toEqual({
        kind: "still_watching",
        title: "Still watching?",
        next: {
          title: { type: "series", id: "tt0903747" },
          video: { type: "series", id: "tt0903747:1:4" },
          episode: { season: 1, episode: 4 },
          label: "S1E4",
          name: "Cancer Man",
          still: "https://images.test/cancer-man.jpg",
        },
        strip: "Still watching? · S1E4",
      });
    });

    test("the docked strip's text is the countdown's, the hold's, or nothing", () => {
      expect(autoplayStrip(autoplayView({ autoplay: autoplay(4) }, 0))).toBe("Up next in 4 · S1E4");
      expect(autoplayStrip(autoplayView({ autoplay: held() }, 0))).toBe("Still watching? · S1E4");
      expect(autoplayStrip(autoplayView({ autoplay: null }, 0))).toBeNull();
    });

    test("it has no countdown to project: time passing changes nothing", () => {
      const at = (since: number) => autoplayView({ autoplay: held() }, since);

      expect(at(0)).toEqual(at(60_000));
      expect(at(Number.NaN)).toEqual(at(0));
    });
  });
});

function noStream(videoId: string, detail = "No addon has a Stream for it"): AutoplaySnapshot {
  return {
    next: {
      title: { type: "series", id: "tt0903747" },
      video: { type: "series", id: videoId },
      episode: { season: 1, episode: 4 },
      name: "Cancer Man",
      still: null,
    },
    phase: "no_stream",
    detail,
  };
}

describe("the missing Stream view", () => {
  test("no_stream carries the next episode and the Host's reason", () => {
    const view = autoplayView({ autoplay: noStream("tt0903747:1:4", "The Addon is down") }, 9_000);

    expect(view.kind).toBe("no_stream");
    if (view.kind !== "no_stream") {
      return;
    }
    expect(view.detail).toBe("The Addon is down");
    expect(view.next).toMatchObject({
      title: { type: "series", id: "tt0903747" },
      video: { type: "series", id: "tt0903747:1:4" },
      label: "S1E4",
      name: "Cancer Man",
    });
  });
});

describe("opening the Streams picker for a missing Stream", () => {
  const view = (videoId: string | null) =>
    autoplayView({ autoplay: videoId === null ? null : noStream(videoId) }, 0);
  const counting = autoplayView({ autoplay: autoplay(5) }, 0);

  test("it opens when a missing Stream first appears", () => {
    expect(opensPicker(view(null), view("tt0903747:1:4"))).toBe(true);
    expect(opensPicker(counting, view("tt0903747:1:4"))).toBe(true);
  });

  test("a repeated Snapshot for the same target opens nothing more", () => {
    expect(opensPicker(view("tt0903747:1:4"), view("tt0903747:1:4"))).toBe(false);
  });

  test("a different target opens it again", () => {
    expect(opensPicker(view("tt0903747:1:4"), view("tt0903747:1:5"))).toBe(true);
  });

  test("nothing else opens it", () => {
    expect(opensPicker(view(null), view(null))).toBe(false);
    expect(opensPicker(view("tt0903747:1:4"), view(null))).toBe(false);
    expect(opensPicker(view(null), counting)).toBe(false);
    expect(opensPicker(view("tt0903747:1:4"), autoplayView({ autoplay: held() }, 0))).toBe(false);
    expect(opensPicker(autoplayView({ autoplay: held() }, 0), view(null))).toBe(false);
  });

  test("the same target after it was dismissed opens it once more", () => {
    expect(opensPicker(view(null), view("tt0903747:1:4"))).toBe(true);
  });
});

describe("the plain ended state", () => {
  test("is what an ended Stream shows unless a card is up", () => {
    expect(plainEnd(autoplayView({ autoplay: null }, 0))).toBe(true);
    expect(
      plainEnd(autoplayView({ autoplay: noStream("tt0903747:1:4") }, 0)),
      "a missing Stream leaves the ended state as it is",
    ).toBe(true);
    expect(plainEnd(autoplayView({ autoplay: autoplay(5) }, 0))).toBe(false);
    expect(
      plainEnd(autoplayView({ autoplay: held() }, 0)),
      "the hold is a card, and a missing Stream is not",
    ).toBe(false);
  });
});

describe("the picker's target", () => {
  const missing = (id: string) =>
    autoplayView(
      {
        autoplay: {
          next: { ...NEXT, video: { type: "series", id } },
          phase: "no_stream",
          detail: "none",
        },
      },
      0,
    );

  test("is the Video a missing Stream is about, and nothing else has one", () => {
    expect(pickerTarget(missing("tt0903747:1:4"))).toBe("series|tt0903747:1:4");
    expect(pickerTarget(missing("tt0903747:1:5"))).not.toBe(pickerTarget(missing("tt0903747:1:4")));
    expect(pickerTarget({ kind: "none" })).toBeNull();
    expect(pickerTarget(autoplayView({ autoplay: autoplay(5) }, 0))).toBeNull();
    expect(pickerTarget(autoplayView({ autoplay: held() }, 0))).toBeNull();
  });

  test("the episode is the Host's, so the view carries it", () => {
    const view = autoplayView({ autoplay: held() }, 0);
    expect(view.kind === "still_watching" ? view.next.episode : null).toEqual({
      season: 1,
      episode: 4,
    });
  });
});

describe("the Video the picker opens on", () => {
  const listed: Video = {
    id: "tt0903747:1:4",
    name: "Cancer Man (listed)",
    season: 1,
    episode: 4,
    thumbnail: null,
    airDate: "2008-02-17",
  };

  function next(id: string) {
    const view = autoplayView(
      { autoplay: { next: { ...NEXT, video: { type: "series", id } }, phase: "unattended_limit" } },
      0,
    );
    if (view.kind !== "still_watching") {
      throw new Error("expected a view with a next episode");
    }
    return view.next;
  }

  test("is the Title's own entry where its list holds the episode", () => {
    expect(missingStreamVideo({ videos: [listed] }, next("tt0903747:1:4"))).toBe(listed);
  });

  test("is built from what Autoplay named where the list does not, with no parsing of the id", () => {
    // An id shape ADR-0012 does not rule out: nothing in it says season or episode.
    const video = missingStreamVideo({ videos: [listed] }, next("kitsu:44:opaque"));

    expect(video).toEqual({
      id: "kitsu:44:opaque",
      name: "Cancer Man",
      season: 1,
      episode: 4,
      thumbnail: "https://images.test/cancer-man.jpg",
      airDate: null,
    });
  });
});
