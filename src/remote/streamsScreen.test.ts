import { describe, expect, test } from "vitest";

import type { AddonStreams, Stream, Title, Video } from "../core/wire";
import { streamsAsk, unplayableAfter } from "./streamsScreen";

/**
 * The Streams level's decisions (#210, ADR-0035 §1, ADR-0032).
 *
 * The one question the level asks, and what its answer means for the Title's
 * unplayable mark: ADR-0020's second half, where a candidate anywhere clears
 * the mark, no candidate with every Addon answering sets it, and a failed Addon
 * proves nothing either way.
 */

const TITLE: Title = {
  addon: "cinemeta",
  id: "tt1",
  key: { kind: "addon", addon: "cinemeta", id: "tt1" },
  type: "series",
  name: "One",
  poster: null,
  background: null,
  logo: null,
  description: null,
  releaseInfo: null,
  runtime: null,
  imdbRating: null,
  genres: [],
  videos: [],
};

const VIDEO: Video = {
  id: "tt1:1:2",
  name: "Pilot",
  season: 1,
  episode: 2,
  thumbnail: null,
};

const STREAM: Stream = {
  name: "Torrentio",
  description: null,
  playback: { kind: "direct", url: "https://example.test/film.mkv" },
  warnings: [],
  filename: null,
  bingeGroup: null,
};

function group(
  addon: string,
  streams: Stream[] = [],
  failure: AddonStreams["failure"] = null,
): AddonStreams {
  return { addon, streams, failure };
}

describe("the Streams level's one question", () => {
  test("asks every Addon for the Video the Title's type and the Video's id name", () => {
    expect(streamsAsk(TITLE, VIDEO)).toEqual({
      type: "find_streams",
      video: { type: "series", id: "tt1:1:2" },
    });
  });
});

describe("what an answer means for the unplayable mark", () => {
  test("a candidate anywhere means this Host can play the Title", () => {
    expect(unplayableAfter([group("cinemeta"), group("torrentio", [STREAM])])).toBe(
      false,
    );
  });

  test("a candidate clears a mark even where another Addon failed", () => {
    expect(
      unplayableAfter([
        group("cinemeta", [], { kind: "fetch", detail: "timeout" }),
        group("torrentio", [STREAM]),
      ]),
    ).toBe(false);
  });

  test("no candidate at all, with every Addon answering, marks the Title unplayable", () => {
    expect(unplayableAfter([group("cinemeta"), group("torrentio")])).toBe(true);
  });

  test("no group at all is the same verdict: no configured Addon offers Streams", () => {
    expect(unplayableAfter([])).toBe(true);
  });

  test("a failed Addon proves nothing either way, so the mark is left alone", () => {
    expect(
      unplayableAfter([
        group("cinemeta", [], { kind: "fetch", detail: "timeout" }),
        group("torrentio"),
      ]),
    ).toBeNull();
  });
});
