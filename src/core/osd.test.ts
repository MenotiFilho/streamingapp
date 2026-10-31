import { describe, expect, test } from "vitest";

import type { Chapter, NowPlaying, PlaybackSnapshot, Track } from "./wire";
import {
  bufferedSpan,
  chapterAt,
  chapterMarks,
  CHAPTER_TICK_SPACING_PX,
  spacedChapterMarks,
  OSD_IDLE_MS,
  PREVIEW_BUCKET_SECONDS,
  previewBucket,
  qualityBadge,
  projectedPosition,
  remainingTime,
  selectedTrack,
  streamDetails,
  streamTitle,
  streamKey,
  timelineFraction,
} from "./osd";

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
    buffered: null,
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
  test("a playing position is projected from its anchor at the Stream's speed", () => {
    const playing = playback({ state: "playing", position: 900, duration: 3600, speed: 1 });
    expect(projectedPosition(playing, 0)).toBe(900);
    expect(projectedPosition(playing, 12.5)).toBe(912.5);
    expect(projectedPosition({ ...playing, speed: 2 }, 10)).toBe(920);
    expect(
      projectedPosition(playing, 10_000),
      "a projection never runs past the Stream's end",
    ).toBe(3600);
    expect(
      projectedPosition({ ...playing, state: "paused" }, 10),
      "a paused Stream holds the anchor",
    ).toBe(900);
    expect(projectedPosition({ ...playing, position: null }, 10)).toBeNull();
  });

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

  test("the buffered span is clamped to the Stream, and absent where there is none", () => {
    expect(bufferedSpan({ start: 900, end: 1800 }, 3600)).toEqual({ left: 0.25, width: 0.25 });
    expect(
      bufferedSpan({ start: -100, end: 7200 }, 3600),
      "a Player that read past either end is still only this Stream",
    ).toEqual({ left: 0, width: 1 });
    expect(
      bufferedSpan({ start: 3000, end: 3200 }, 3600),
      "a forward seek leaves the reading behind the picture, and it is still drawn",
    ).toEqual({ left: 3000 / 3600, width: 200 / 3600 });
    expect(
      bufferedSpan({ start: 1800, end: 900 }, 3600),
      "a span that runs backwards is no span",
    ).toBeNull();
    expect(bufferedSpan({ start: 900, end: 900 }, 3600)).toBeNull();
    expect(bufferedSpan(null, 3600)).toBeNull();
    expect(bufferedSpan({ start: 900, end: 1800 }, null)).toBeNull();
    expect(bufferedSpan({ start: 900, end: 1800 }, 0)).toBeNull();
    expect(bufferedSpan({ start: 900, end: 1800 }, Number.POSITIVE_INFINITY)).toBeNull();
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

  test("chapter ticks keep a minimum spacing, and an unmeasured track keeps them all", () => {
    const chapters: Chapter[] = [
      { index: 0, title: "Opening", time: 0 },
      { index: 1, title: "A beat", time: 120 },
      { index: 2, title: "The turn", time: 1800 },
      { index: 3, title: "A second beat", time: 1900 },
    ];
    const marks = chapterMarks(chapters, 3600);

    expect(CHAPTER_TICK_SPACING_PX).toBe(24);
    expect(spacedChapterMarks(marks, 0), "a first render has no width yet").toEqual(marks);
    expect(
      spacedChapterMarks(marks, 100).map((mark) => mark.chapter.index),
      "24px of a 100px track is the closest two ticks may sit",
    ).toEqual([0, 2]);
    expect(
      spacedChapterMarks(marks, 10_000).map((mark) => mark.chapter.index),
      "a wide track carries every tick",
    ).toEqual([0, 1, 2, 3]);
  });

  test("a still stands for a five-second bucket of the Stream", () => {
    expect(PREVIEW_BUCKET_SECONDS).toBe(5);
    expect(previewBucket(0)).toBe(0);
    expect(previewBucket(4.9)).toBe(0);
    expect(previewBucket(5)).toBe(1);
    expect(previewBucket(-1)).toBe(0);
    expect(previewBucket(Number.NaN)).toBe(0);
  });

  test("the chapter a moment is inside is the last one that began before it", () => {
    const chapters: Chapter[] = [
      { index: 0, title: "Opening", time: 0 },
      { index: 1, title: "The Choice", time: 1800 },
    ];

    expect(chapterAt(chapters, 900)?.title).toBe("Opening");
    // A chapter holds from its own start.
    expect(chapterAt(chapters, 1800)?.title).toBe("The Choice");
    expect(chapterAt(chapters, 3599)?.title).toBe("The Choice");
    expect(chapterAt([], 900)).toBeNull();
    expect(
      chapterAt([{ index: 0, title: "Late", time: 60 }], 30),
      "a Stream that begins before its first chapter has no chapter there",
    ).toBeNull();
  });

  test("a still's cache is keyed by the Stream, not by the Video alone", () => {
    const playing = nowPlaying();
    const key = streamKey(playing);

    expect(streamKey(null)).toBeNull();
    // The same Stream is one key.
    expect(streamKey({ ...playing })).toBe(key);
    // Another Addon's candidate of the same Video is another Stream.
    expect(streamKey({ ...playing, addon: "community.other" })).not.toBe(key);
    // Another release of the same Video is another Stream.
    expect(streamKey({ ...playing, name: "AIOStreams\n2160p" })).not.toBe(key);
    // The binge group tells two releases of one episode apart.
    expect(streamKey({ ...playing, bingeGroup: "aiostreams|2160p" })).not.toBe(key);
  });
});

describe("the OSD's idle window", () => {
  test("is three seconds", () => {
    expect(OSD_IDLE_MS).toBe(3000);
  });
});
