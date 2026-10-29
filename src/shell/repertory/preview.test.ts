import { describe, expect, it } from "vitest";

import {
  cinemetaId,
  cinemetaPreview,
  cinemetaPreviews,
  parseRuntimeSeconds,
  previewStream,
  sampleLibrary,
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

  it("carries an infoHash candidate the way the Host does, with its filename and hints", () => {
    expect(
      previewStream({
        name: "Torrentio\n4k HDR",
        title: "The Shawshank Redemption 1994 2160p BluRay\n👤 190 💾 6.91 GB",
        infoHash: "c3da9a3dc2ce14d0d4fc0e87d1b2023502f8dcd6",
        behaviorHints: {
          filename: "The.Shawshank.Redemption.1994.2160p.mkv",
          bingeGroup: "torrentio|4k|BluRay|x265",
        },
      }),
    ).toEqual({
      name: "Torrentio\n4k HDR",
      description: "The Shawshank Redemption 1994 2160p BluRay\n👤 190 💾 6.91 GB",
      playback: { kind: "info_hash", infoHash: "c3da9a3dc2ce14d0d4fc0e87d1b2023502f8dcd6" },
      warnings: [],
      filename: "The.Shawshank.Redemption.1994.2160p.mkv",
      bingeGroup: "torrentio|4k|BluRay|x265",
    });
  });

  it("keeps a direct candidate's warnings in the Host's order and drops a locationless one", () => {
    expect(
      previewStream({
        url: "https://stream.example.org/x.mkv",
        description: "The Matrix 1999 1080p",
        behaviorHints: {
          notWebReady: true,
          p2p: true,
          proxyHeaders: { request: { "User-Agent": "Stremio" } },
        },
      }),
    ).toMatchObject({
      playback: { kind: "direct", url: "https://stream.example.org/x.mkv" },
      warnings: ["not_web_ready", "p2p", "proxy_headers"],
    });
    expect(previewStream({ name: "no bytes here" })).toBeNull();
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

describe("the preview's sample account Library", () => {
  it("uses live names and posters, newest first, with the Continue mark on played rows", () => {
    const other = { ...film, imdb_id: "tt0000002", name: "Another" };
    const third = { ...film, imdb_id: "tt0000003", name: "A Third" };
    const entries = sampleLibrary([film, other, third], 3);

    expect(entries).toHaveLength(3);
    expect(entries[0]?.name).toBe("The Invite");
    expect(entries[0]?.poster).toContain("tt14173636");
    expect(entries[0]?.continueWatching).toBe(true);
    expect(entries[1]?.continueWatching).toBe(true);
    expect(entries[2]?.continueWatching).toBe(false);
    expect(entries[0]?.mtime).toBeGreaterThan(entries[1]!.mtime);
    expect(entries[1]?.mtime).toBeGreaterThan(entries[2]!.mtime);
  });
});
