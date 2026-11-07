import { describe, expect, test } from "vitest";

import type { Stream, Title, Video } from "./wire";
import { playStreamAction, playabilityNote, streamsSubject, theFilm } from "./stream";
import { titleStubOf } from "./title";

function film(overrides: Partial<Title> = {}): Title {
  return {
    addon: "community.stremboxd",
    id: "tt0133093",
    key: { kind: "addon", addon: "community.stremboxd", id: "tt0133093" },
    type: "movie",
    name: "The Matrix",
    poster: null,
    background: null,
    logo: null,
    description: null,
    releaseInfo: null,
    runtime: null,
    imdbRating: null,
    genres: [],
    videos: [],
    ...overrides,
  };
}

describe("the Video a film is watched as", () => {
  test("an Addon's own Title is played by the id its Addon indexes", () => {
    expect(theFilm(film()).id).toBe("tt0133093");
  });

  test("a Title TMDB met is played in TMDB's spelling, so progress unifies", () => {
    expect(
      theFilm(
        film({
          key: { kind: "tmdb", id: 603 },
        }),
      ).id,
    ).toBe("tmdb:603");
  });
});

describe("what the Streams are Streams of", () => {
  const video: Video = {
    id: "tt0903747:1:2",
    name: "Cat's in the Bag...",
    season: 1,
    episode: 2,
    thumbnail: null,
  };
  const series = film({ id: "tt0903747", type: "series", name: "Breaking Bad" });

  test("a series' episode is named by its number and the name the Addon gave", () => {
    expect(streamsSubject(series, null, video)).toBe("S1E2 — Cat's in the Bag...");
  });

  test("a film is named by its Title, with the card standing in for a sparse answer", () => {
    const sparse = film({ id: "tt0133093", name: "tt0133093" });

    expect(
      streamsSubject(
        sparse,
        { id: "tt0133093", type: "movie", name: "The Matrix", poster: null },
        {
          id: "tt0133093",
          name: null,
          season: null,
          episode: null,
          thumbnail: null,
        },
      ),
    ).toBe("The Matrix");
  });

  test("a Video with no number is named by its name, and by its id when it has none", () => {
    expect(streamsSubject(series, null, { ...video, season: null, episode: null })).toBe(
      "Cat's in the Bag...",
    );
    expect(
      streamsSubject(series, null, { ...video, season: null, episode: null, name: null }),
    ).toBe("tt0903747:1:2");
  });
});

describe("the Action a chosen Stream is", () => {
  const video: Video = {
    id: "tt0133093",
    name: null,
    season: null,
    episode: null,
    thumbnail: null,
  };
  const stream: Stream = {
    name: "4k DV\nHDR",
    description: "A release, in the Addon's words.",
    playback: { kind: "direct", url: "https://example.test/film.mkv" },
    warnings: ["p2p"],
    filename: "film.mkv",
    bingeGroup: null,
  };

  test("the Video, the Addon, the candidate and the Title card travel exactly as sent", () => {
    expect(playStreamAction(film(), video, "torrentio", stream)).toEqual({
      type: "play_stream",
      video: { type: "movie", id: video.id },
      addon: "torrentio",
      stream,
      title: titleStubOf(film()),
    });
  });

  test("the card stands in for what a sparse meta answer left out", () => {
    const sparse = film({ name: "tt0133093", poster: null });

    const action = playStreamAction(sparse, video, "torrentio", stream, {
      name: "The Matrix",
      poster: "https://images.test/matrix.jpg",
      background: "https://images.test/matrix-backdrop.jpg",
    });

    expect(action.title).toEqual({
      addon: "community.stremboxd",
      id: "tt0133093",
      type: "movie",
      name: "The Matrix",
      poster: "https://images.test/matrix.jpg",
      background: "https://images.test/matrix-backdrop.jpg",
    });
  });

  test("a Title with no backdrop carries no background key at all", () => {
    const action = playStreamAction(film(), video, "torrentio", stream, {
      name: "The Matrix",
      poster: null,
    });

    expect(action.title).not.toHaveProperty("background");
  });
});

/**
 * What the Streams list marks before a press (#249). The Host's `StreamUrl::parse`
 * opens only http(s) addresses of a file; a direct URL outside that rule is
 * listed unplayable rather than refused after the press.
 */
describe("which direct Streams the list marks unplayable", () => {
  test("http and https addresses are playable", () => {
    expect(playabilityNote({ kind: "direct", url: "https://example.test/film.mkv" })).toBeNull();
    expect(playabilityNote({ kind: "direct", url: "http://example.test/a" })).toBeNull();
    expect(
      playabilityNote({ kind: "direct", url: "HTTPS://EXAMPLE.TEST/film.mkv" }),
      "the scheme is not case-sensitive",
    ).toBeNull();
  });

  test("a scheme the Host never opens is marked before the press", () => {
    for (const url of [
      "magnet:?xt=urn:btih:0123456789abcdef",
      "stremio://example.test/film.mkv",
      "ftp://example.test/film.mkv",
      "file:///films/a.mkv",
    ]) {
      expect(playabilityNote({ kind: "direct", url }), url).not.toBeNull();
    }
  });

  test("a relative address or an empty one is not a URL the Host opens", () => {
    for (const url of ["a/film.mkv", "", "https://"]) {
      expect(playabilityNote({ kind: "direct", url }), url).not.toBeNull();
    }
  });

  test("a URL longer than the Stream bound, or carrying a control character, is marked", () => {
    const long = `https://example.test/${"a".repeat(4096)}`;
    expect(playabilityNote({ kind: "direct", url: long })).not.toBeNull();
    expect(
      playabilityNote({ kind: "direct", url: "https://example.test/a\u0000b.mkv" }),
    ).not.toBeNull();
  });

  test("the Stream bound counts bytes, as the Host does, not characters", () => {
    // 2,100 two-byte characters: under 4,096 characters, over 4,096 bytes.
    const wide = `https://example.test/${"é".repeat(2100)}`;
    expect(wide.length).toBeLessThan(4096);
    expect(playabilityNote({ kind: "direct", url: wide })).not.toBeNull();
  });

  test("a torrent is still marked and is not a URL question", () => {
    expect(playabilityNote({ kind: "info_hash", infoHash: "abc" })).toContain("torrent");
  });
});
