import { describe, expect, it } from "vitest";

import {
  cinemetaId,
  cinemetaPreview,
  cinemetaPreviews,
  parseRuntimeSeconds,
  sampleResumeEntries,
  type CinemetaMeta,
} from "./preview";

const film: CinemetaMeta = {
  imdb_id: "tt14173636",
  name: "The Invite",
  type: "movie",
  poster: "https://images.metahub.space/poster/small/tt14173636/img",
  background: "https://images.metahub.space/background/medium/tt14173636/img",
  description: "A dinner party turns.",
  year: "2026",
  imdbRating: "7.5",
  genre: ["Comedy", "Drama"],
  runtime: "107 min",
};

describe("the Cinemeta translation", () => {
  it("reads the id and the fields the Host's Meta preview carries", () => {
    expect(cinemetaId(film)).toBe("tt14173636");
    expect(cinemetaPreview(film, "movie")).toEqual({
      id: "tt14173636",
      type: "movie",
      name: "The Invite",
      poster: "https://images.metahub.space/poster/small/tt14173636/img",
      posterShape: "poster",
      background: "https://images.metahub.space/background/medium/tt14173636/img",
      releaseInfo: "2026",
      imdbRating: "7.5",
      genres: ["Comedy", "Drama"],
      description: "A dinner party turns.",
    });
  });

  it("drops an item with no identity instead of inventing one", () => {
    expect(cinemetaPreview({ name: "Nameless" }, "movie")).toBeNull();
    expect(cinemetaPreviews([{ name: "Nameless" }, film], "movie")).toHaveLength(1);
  });

  it("reads the two runtime spellings the Addon uses", () => {
    expect(parseRuntimeSeconds("107 min")).toBe(6420);
    expect(parseRuntimeSeconds("1h 47min")).toBe(6420);
    expect(parseRuntimeSeconds("")).toBeNull();
    expect(parseRuntimeSeconds(null)).toBeNull();
  });

  it("builds sample progress only for films that say how long they are", () => {
    const withoutRuntime = { ...film, imdb_id: "tt0000002", runtime: undefined };
    const short = { ...film, imdb_id: "tt0000003", runtime: "90 min" };
    const entries = sampleResumeEntries([film, withoutRuntime, short], 4);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.video.id).toBe("tt14173636");
    expect(entries[0]?.duration).toBe(6420);
    expect(entries[0]?.position).toBeGreaterThan(0);
    expect(entries[0]?.unplayable).toBeNull();
    expect(entries[1]?.duration).toBe(5400);
  });
});
