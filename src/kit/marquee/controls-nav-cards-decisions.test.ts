import { afterEach, describe, expect, it } from "vitest";

import {
  CARD_FOCUS_SCALE,
  cardLabel,
  cardScale,
  firstArt,
  unplayableWords,
  wideCardBadge,
} from "./cards";
import { defaultIconWeight, navIconWeight } from "./controlIcons";
import { showsFocus } from "./controlsFocus";
import { heroArtTransition, heroLayerKeys, heroShift, heroShows } from "./heroLayout";
import { META_GENRE_LIMIT, metaFacts } from "./meta";
import { fade, panel } from "./motion";
import { clampFraction } from "./progressValue";
import { railTransition } from "./railMotion";

afterEach(() => {
  document.documentElement.style.removeProperty("--mq-scale-poster");
});

describe("the focus treatment follows the input modality (ADR-0037)", () => {
  it("draws DOM focus only when navigation chose it", () => {
    expect(showsFocus({ domFocused: true, modality: "navigation" })).toBe(true);
    expect(showsFocus({ domFocused: true, modality: "pointer" })).toBe(false);
    expect(showsFocus({ domFocused: false, modality: "navigation" })).toBe(false);
  });

  it("always draws the explicit focused prop", () => {
    expect(showsFocus({ focused: true, domFocused: false, modality: "pointer" })).toBe(true);
    expect(showsFocus({ focused: false, domFocused: true, modality: "pointer" })).toBe(false);
  });
});

describe("a card's focus scale (§5, §6)", () => {
  it("grows a poster 8%, a wide card 7% and an episode 6%", () => {
    expect(CARD_FOCUS_SCALE).toEqual({ poster: 1.08, wide: 1.07, episode: 1.06 });
    for (const kind of ["poster", "wide", "episode"] as const) {
      expect(cardScale(kind, { shown: true, calm: false })).toBe(CARD_FOCUS_SCALE[kind]);
      expect(cardScale(kind, { shown: false, calm: false })).toBe(1);
    }
  });

  it("does not grow when movement is left out", () => {
    expect(cardScale("poster", { shown: true, calm: true })).toBe(1);
  });

  it("reads the sheet's token, so the one tuning has one place", () => {
    document.documentElement.style.setProperty("--mq-scale-poster", "1.05");
    expect(cardScale("poster", { shown: true, calm: false })).toBe(1.05);

    document.documentElement.style.setProperty("--mq-scale-poster", "large");
    expect(cardScale("poster", { shown: true, calm: false })).toBe(1.08);
  });
});

describe("card art and marks (§9)", () => {
  it("takes the first art that exists and has not failed", () => {
    expect(firstArt(["backdrop", "still"], new Set())).toBe("backdrop");
    expect(firstArt([null, "still"], new Set())).toBe("still");
    expect(firstArt(["backdrop", "still"], new Set(["backdrop"]))).toBe("still");
    expect(firstArt(["backdrop", undefined], new Set(["backdrop"]))).toBeNull();
    expect(firstArt([""], new Set())).toBeNull();
  });

  it("lets the unplayable mark replace Up next", () => {
    expect(wideCardBadge({ upNext: true, unplayable: null })).toBe("up-next");
    expect(wideCardBadge({ upNext: true, unplayable: "addon_disabled" })).toBe("unplayable");
    expect(wideCardBadge({ upNext: false, unplayable: null })).toBeNull();
  });

  it("says why an entry is unplayable, for both reasons", () => {
    expect(unplayableWords("addon_removed")).toBe("Addon removed");
    expect(unplayableWords("addon_disabled")).toBe("Addon disabled");
  });

  it("names a card by what it is and then its marks", () => {
    expect(cardLabel("Dune", false, "Watched", null, undefined)).toBe("Dune, Watched");
  });

  it("clamps a progress reading and refuses one that is not a number", () => {
    expect(clampFraction(0.4)).toBe(0.4);
    expect(clampFraction(-1)).toBe(0);
    expect(clampFraction(7)).toBe(1);
    expect(clampFraction(Number.NaN)).toBeNull();
    expect(clampFraction(null)).toBeNull();
    expect(clampFraction(undefined)).toBeNull();
  });
});

describe("icon weights (§7)", () => {
  it("fills transport, bolds checks and leaves chrome regular", () => {
    for (const name of ["play", "pause", "stop", "skip-back", "skip-forward"] as const) {
      expect(defaultIconWeight(name)).toBe("fill");
    }
    expect(defaultIconWeight("check")).toBe("bold");
    expect(defaultIconWeight("info")).toBe("regular");
    expect(defaultIconWeight("rotate-ccw")).toBe("regular");
  });

  it("fills a destination that is active or has focus", () => {
    expect(navIconWeight({ active: false, focusShown: false })).toBe("regular");
    expect(navIconWeight({ active: true, focusShown: false })).toBe("fill");
    expect(navIconWeight({ active: false, focusShown: true })).toBe("fill");
  });
});

describe("the rail's motion (ADR-0031)", () => {
  it("widens and dims on the panel spring", () => {
    expect(railTransition(false)).toEqual({
      "--mq-rail-open": panel(),
      "--mq-rail-fade": panel(),
    });
  });

  it("snaps the width and keeps the fade when movement is left out", () => {
    expect(railTransition(true)).toEqual({
      "--mq-rail-open": { duration: 0 },
      "--mq-rail-fade": fade(),
    });
  });
});

describe("the hero's two modes (§8)", () => {
  it("draws actions and ticks only while rotating", () => {
    expect(heroShows("rotating")).toEqual({ actions: true, ticks: true });
    expect(heroShows("following")).toEqual({ actions: false, ticks: false });
  });

  it("moves the backdrop right while following", () => {
    expect(heroShift("rotating")).toBe(0);
    expect(heroShift("following")).toBe(1);
  });

  it("slides one backdrop between modes and cross-fades the copy", () => {
    const rotating = heroLayerKeys("rotating", "dune", false);
    const following = heroLayerKeys("following", "dune", false);
    expect(following.art).toBe(rotating.art);
    expect(following.copy).not.toBe(rotating.copy);
    expect(heroLayerKeys("rotating", "mobland", false).art).not.toBe(rotating.art);
    expect(heroArtTransition(false)).toEqual({ opacity: fade(), "--mq-hero-shift": panel() });
  });

  it("switches mode as a fade when movement is left out", () => {
    expect(heroLayerKeys("following", "dune", true).art).not.toBe(
      heroLayerKeys("rotating", "dune", true).art,
    );
    expect(heroArtTransition(true)).toEqual({
      opacity: fade(),
      "--mq-hero-shift": { duration: 0 },
    });
  });
});

describe("the meta line (§8, §9)", () => {
  it("keeps at most three genres, in the Host's order", () => {
    expect(META_GENRE_LIMIT).toBe(3);
    expect(
      metaFacts({
        rating: "8.4",
        year: "2024",
        runtime: "167 min",
        genres: ["Action", "Adventure", "Drama", "Sci-Fi"],
      }),
    ).toEqual({
      rating: "8.4",
      facts: [
        { key: "year", text: "2024" },
        { key: "runtime", text: "167 min" },
        { key: "genres", text: "Action, Adventure, Drama" },
      ],
    });
  });

  it("prints no placeholder for what the Host does not carry", () => {
    expect(metaFacts({ rating: "  ", year: "2023–", runtime: null, genres: [] })).toEqual({
      rating: null,
      facts: [{ key: "year", text: "2023–" }],
    });
    expect(metaFacts({})).toEqual({ rating: null, facts: [] });
  });
});
