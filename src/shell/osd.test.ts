import { describe, expect, test } from "vitest";

import type { Chapter, NowPlaying, PlaybackSnapshot, Track } from "../host-client";
import {
  chapterMarks,
  qualityBadge,
  remainingTime,
  selectedTrack,
  streamDetails,
  streamTitle,
  timelineFraction,
} from "./osd";
import { OSD_IDLE_MS } from "./useOsdVisibility";

function nowPlaying(overrides: Partial<NowPlaying> = {}): NowPlaying {
  return {
    video: { type: "movie", id: "tt0133093" },
    addon: "community.aiostreams",
    name: "AIOStreams\n1080p",
    description: null,
    filename: null,
    bingeGroup: null,
    ...overrides,
  };
}

function track(overrides: Partial<Track> = {}): Track {
  return {
    id: 1,
    kind: "audio",
    language: "en",
    title: "English",
    codec: "truehd",
    embedded: true,
    selected: false,
    default: false,
    forced: false,
    ...overrides,
  };
}

function playback(overrides: Partial<PlaybackSnapshot> = {}): PlaybackSnapshot {
  return {
    state: "playing",
    picture: "in_window",
    failure: null,
    nowPlaying: nowPlaying(),
    episode: null,
    position: 900,
    duration: 3600,
    tracks: [],
    chapters: [],
    chapter: null,
    speed: 1,
    volume: 100,
    muted: false,
    subtitleDelay: 0,
    crop: null,
    aspect: null,
    resolution: null,
    statistics: null,
    ...overrides,
  };
}

describe("the OSD's readings", () => {
  test("the quality badge is the Addon's own resolution line, wherever it sits", () => {
    expect(qualityBadge(nowPlaying({ name: "AIOStreams\n4K HDR" }))).toBe("4K HDR");
    expect(qualityBadge(nowPlaying({ name: "1080p\nTorrentio" }))).toBe("1080p");
    expect(qualityBadge(nowPlaying({ name: "Torrentio\nWeb-DL" }))).toBeNull();
    expect(qualityBadge(nowPlaying({ name: null }))).toBeNull();
    expect(qualityBadge(null)).toBeNull();
  });

  test("the title pill says the Addon's name for it without repeating the quality", () => {
    expect(streamTitle(nowPlaying({ name: "AIOStreams\n4K HDR" }))).toBe("AIOStreams");
    expect(streamTitle(nowPlaying({ name: "1080p\nTorrentio" }))).toBe("Torrentio");
    expect(streamTitle(nowPlaying({ name: "Torrentio\nWeb-DL" }))).toBe("Torrentio · Web-DL");
    expect(streamTitle(nowPlaying({ name: null, filename: "The.Matrix.1999.mkv" }))).toBe(
      "The.Matrix.1999.mkv",
    );
    expect(streamTitle(null)).toBe("a Stream");
  });

  test("the details pill joins the Addon, the codecs on, the bitrate and the decoder", () => {
    const details = streamDetails(
      playback({
        tracks: [
          track({ id: 1, codec: "truehd", selected: true }),
          track({ id: 2, kind: "subtitle", codec: "subrip", selected: true }),
        ],
        statistics: {
          bitrate: 4_000_000,
          droppedFrames: 0,
          hardwareDecode: "d3d11va",
        },
      }),
    );

    expect(details).toBe("community.aiostreams · truehd · subrip · 4.0 Mbps · d3d11va");
  });

  test("a Player that says only a little gets only that little", () => {
    expect(streamDetails(playback())).toBe("community.aiostreams");
    expect(
      streamDetails(
        playback({
          nowPlaying: null,
          statistics: { bitrate: null, droppedFrames: null, hardwareDecode: "no" },
        }),
      ),
      "software decoding is a fact, but an absent Addon and bitrate are not",
    ).toBe("software decode");
    expect(
      streamDetails(
        playback({
          nowPlaying: null,
          statistics: null,
        }),
      ),
    ).toBeNull();
  });

  test("the selected track of a kind is the one the Player marked, not the first", () => {
    const tracks = [
      track({ id: 1, embedded: true, selected: false }),
      track({ id: 2, embedded: false, selected: true }),
    ];
    expect(selectedTrack(tracks, "audio")?.id).toBe(2);
    expect(selectedTrack(tracks, "subtitle")).toBeNull();
  });

  test("the remaining clock is a countdown, and unknown when either end is", () => {
    expect(remainingTime(900, 3600)).toBe("−45:00");
    expect(remainingTime(3600, 3600)).toBe("−0:00");
    expect(remainingTime(3700, 3600)).toBe("−0:00");
    expect(remainingTime(null, 3600)).toBe("--:--");
    expect(remainingTime(900, null)).toBe("--:--");
  });

  test("the timeline fraction is clamped, and zero where the length is unknown", () => {
    expect(timelineFraction(900, 3600)).toBeCloseTo(0.25);
    expect(timelineFraction(-10, 3600)).toBe(0);
    expect(timelineFraction(7200, 3600)).toBe(1);
    expect(timelineFraction(900, null)).toBe(0);
    expect(timelineFraction(900, 0)).toBe(0);
  });

  test("chapter diamonds are placed by their start, and not invented without a length", () => {
    const chapters: Chapter[] = [
      { index: 0, title: "Opening", time: 0 },
      { index: 1, title: "The Choice", time: 1800 },
    ];

    expect(chapterMarks(chapters, 3600)).toEqual([
      { chapter: chapters[0], fraction: 0 },
      { chapter: chapters[1], fraction: 0.5 },
    ]);
    expect(chapterMarks(chapters, null)).toEqual([]);
    expect(chapterMarks(chapters, 0)).toEqual([]);
  });
});

describe("the OSD's idle window", () => {
  test("is three seconds", () => {
    expect(OSD_IDLE_MS).toBe(3000);
  });
});
