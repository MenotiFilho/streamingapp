import { describe, expect, it } from "vitest";

import type { MetaPreview } from "../../core/wire";
import {
  captionParts,
  countLabel,
  featureTitleDensity,
  programDate,
  programIndex,
  programShortDate,
  programTime,
  ratingOf,
  yearOf,
} from "./program";

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

describe("the programme's caption rules", () => {
  it("prints the year, the rating and at most two genres", () => {
    expect(captionParts(meta())).toEqual({
      year: "2026",
      rating: "IMDb 7.5",
      genres: "Drama / Romance",
    });
  });

  it("leaves out what the Addon did not say rather than inventing it", () => {
    expect(captionParts(meta({ releaseInfo: null, imdbRating: "", genres: [] }))).toEqual({
      year: null,
      rating: null,
      genres: null,
    });
    expect(ratingOf(meta({ imdbRating: "  " }))).toBeNull();
    expect(yearOf(meta({ releaseInfo: "2023–" }))).toBe("2023");
  });

  it("does not pretend a Meta preview carries a runtime", () => {
    // The caption parts are exactly these three; runtime is a Title's field.
    expect(Object.keys(captionParts(meta())).sort()).toEqual(["genres", "rating", "year"]);
  });
});

describe("the programme's display type", () => {
  it("gives a short feature the full hero size and a long one the smaller bands", () => {
    expect(featureTitleDensity("The Invite")).toBe("regular");
    expect(featureTitleDensity("A Very Long Title That Still Fits")).toBe("long");
    expect(featureTitleDensity("A Title So Long It Needs The Smallest Band Of All")).toBe(
      "very-long",
    );
  });

  it("numbers a programme from two digits and counts its rows in the right noun", () => {
    expect(programIndex(1)).toBe("01");
    expect(programIndex(12)).toBe("12");
    expect(countLabel("movie", 1)).toBe("1 film");
    expect(countLabel("movie", 49)).toBe("49 films");
    expect(countLabel("series", 2)).toBe("2 series");
    expect(countLabel("channel", 2)).toBe("2 titles");
  });
});

describe("the programme's date and clock", () => {
  const date = new Date(2026, 9, 29, 21, 41);

  it("prints a long bill date and a compact frame date", () => {
    expect(programDate(date)).toBe("Thursday 29 October");
    expect(programShortDate(date)).toBe("Thu 29 Oct");
  });

  it("prints the house clock in 24-hour time", () => {
    expect(programTime(date)).toBe("21:41");
  });
});
