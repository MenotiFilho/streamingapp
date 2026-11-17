import { describe, expect, test } from "vitest";

import { actionKey } from "./actionKey";
import { playbackView } from "./playbackView";
import { streamKey } from "./osd";
import type { PlaybackSnapshot, ResumeEntry, Track } from "./wire";

function track(overrides: Partial<Track> & { id: number }): Track {
  return {
    kind: "audio",
    language: null,
    title: null,
    codec: null,
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
    autoplay: null,
    picture: "in_window",
    failure: null,
    nowPlaying: {
      video: { type: "movie", id: "tt0133093" },
      addon: "community.aiostreams",
      name: "AIOStreams\n4K HDR",
      description: null,
      filename: null,
      bingeGroup: null,
    },
    episode: null,
    position: 900,
    duration: 3600,
    buffered: { start: 900, end: 1800 },
    tracks: [
      track({ id: 1, language: "en", title: "English", codec: "truehd", selected: true }),
      track({ id: 2, title: "Commentary", embedded: false }),
      track({ id: 3, kind: "subtitle", language: "en", selected: true }),
    ],
    chapters: [
      { index: 0, title: "Opening", time: 0 },
      { index: 1, title: "The Choice", time: 1800 },
    ],
    chapter: 0,
    speed: 1,
    volume: 60,
    muted: true,
    subtitleDelay: 0,
    crop: null,
    aspect: null,
    resolution: { width: 1920, height: 1080 },
    statistics: { bitrate: 4_000_000, droppedFrames: 0, hardwareDecode: "d3d11va" },
    ...overrides,
  };
}

function entry(overrides: Partial<ResumeEntry> = {}): ResumeEntry {
  return {
    video: {
      id: "tt7777777:1:1",
      name: "Episode One",
      season: 1,
      episode: 1,
      thumbnail: "https://images.test/episode-one.jpg",
      airDate: null,
    },
    title: {
      addon: "community.aiostreams",
      id: "tt7777777",
      type: "series",
      name: "A Series That Plays",
      poster: "https://images.test/poster.jpg",
      background: "https://images.test/backdrop.jpg",
    },
    position: 0,
    duration: null,
    watched: false,
    unplayable: null,
    ...overrides,
  };
}

const NO_PROGRESS: ResumeEntry[] = [];
const NO_PENDING: ReadonlySet<string> = new Set();

describe("what the playback facts say", () => {
  test("a Stream that is playing is watched, transportable and controllable", () => {
    const view = playbackView(playback(), {
      played: 0,
      pending: NO_PENDING,
      watchProgress: NO_PROGRESS,
    });

    expect(view.state).toBe("playing");
    expect(view.watching).toBe(true);
    expect(view.transportable).toBe(true);
    expect(view.controllable).toBe(true);
  });

  test("opening is watched and controllable but not transportable yet", () => {
    const view = playbackView(playback({ state: "opening", position: null, duration: null }), {
      played: 0,
      pending: NO_PENDING,
      watchProgress: NO_PROGRESS,
    });

    expect(view.watching).toBe(true);
    expect(view.controllable).toBe(true);
    expect(view.transportable).toBe(false);
    expect(view.state).toBe("opening");
  });

  test("paused still takes controls, and an ended Stream is watched but not controllable", () => {
    const paused = playbackView(playback({ state: "paused" }), {
      played: 10,
      pending: NO_PENDING,
      watchProgress: NO_PROGRESS,
    });
    const ended = playbackView(playback({ state: "ended" }), {
      played: 10,
      pending: NO_PENDING,
      watchProgress: NO_PROGRESS,
    });

    expect(paused.transportable).toBe(true);
    expect(paused.controllable).toBe(true);
    expect(ended.watching).toBe(true);
    expect(ended.transportable).toBe(false);
    expect(ended.controllable).toBe(false);
  });

  test("idle is not watched, and not a control surface", () => {
    const view = playbackView(playback({ state: "idle", position: null, duration: null }), {
      played: 0,
      pending: NO_PENDING,
      watchProgress: NO_PROGRESS,
    });

    expect(view.watching).toBe(false);
    expect(view.transportable).toBe(false);
    expect(view.controllable).toBe(false);
  });

  test("the picture says where it is and what is missing here", () => {
    const inWindow = playbackView(playback({ picture: "in_window" }), {
      played: 0,
      pending: NO_PENDING,
      watchProgress: NO_PROGRESS,
    });
    const ownWindow = playbackView(playback({ picture: "own_window" }), {
      played: 0,
      pending: NO_PENDING,
      watchProgress: NO_PROGRESS,
    });
    const nowhere = playbackView(playback({ picture: "nowhere" }), {
      played: 0,
      pending: NO_PENDING,
      watchProgress: NO_PROGRESS,
    });

    expect(inWindow.picture).toBe("in_window");
    expect(inWindow.pictureNote).toBeNull();
    expect(ownWindow.picture).toBe("own_window");
    expect(ownWindow.pictureNote).toContain("mpv's own window");
    expect(nowhere.picture).toBe("nowhere");
    expect(nowhere.pictureNote).toContain("no picture");
  });
});

describe("the projected position", () => {
  test("moves from the anchor while playing, at the Stream's speed", () => {
    const view = playbackView(playback({ position: 900, speed: 2 }), {
      played: 10,
      pending: NO_PENDING,
      watchProgress: NO_PROGRESS,
    });

    expect(view.position).toBe(920);
  });

  test("a paused Stream holds its anchor", () => {
    const view = playbackView(playback({ state: "paused", position: 300 }), {
      played: 10,
      pending: NO_PENDING,
      watchProgress: NO_PROGRESS,
    });

    expect(view.position).toBe(300);
  });

  test("an ended Stream holds the position it ended at", () => {
    const view = playbackView(playback({ state: "ended", position: 3600, speed: 2 }), {
      played: 10,
      pending: NO_PENDING,
      watchProgress: NO_PROGRESS,
    });

    expect(view.position).toBe(3600);
    expect(view.fraction).toBe(1);
  });

  test("the projection never runs past the Stream's end", () => {
    const view = playbackView(playback({ position: 3590, speed: 2 }), {
      played: 10,
      pending: NO_PENDING,
      watchProgress: NO_PROGRESS,
    });

    expect(view.position).toBe(3600);
  });

  test("no position is still no position", () => {
    const view = playbackView(playback({ position: null }), {
      played: 10,
      pending: NO_PENDING,
      watchProgress: NO_PROGRESS,
    });

    expect(view.position).toBeNull();
  });

  test("the clocks, the fraction and the buffered span are the OSD's readings", () => {
    const view = playbackView(playback(), {
      played: 0,
      pending: NO_PENDING,
      watchProgress: NO_PROGRESS,
    });

    expect(view.duration).toBe(3600);
    expect(view.remaining).toBe("−45:00");
    expect(view.fraction).toBe(0.25);
    expect(view.buffered).toEqual({ left: 0.25, width: 0.25 });
  });

  test("a buffered span outside the Stream is clamped into it", () => {
    const view = playbackView(playback({ buffered: { start: -60, end: 7200 } }), {
      played: 0,
      pending: NO_PENDING,
      watchProgress: NO_PROGRESS,
    });

    expect(view.buffered).toEqual({ left: 0, width: 1 });
  });

  test("a backwards or empty buffered span draws nothing", () => {
    const view = playbackView(
      playback({ buffered: { start: 1800, end: 900 }, duration: null }),
      { played: 0, pending: NO_PENDING, watchProgress: NO_PROGRESS },
    );

    expect(view.buffered).toBeNull();
  });
});

describe("the timeline's chapters", () => {
  test("marks are placed by the container's own times, unspaced", () => {
    const view = playbackView(playback(), {
      played: 0,
      pending: NO_PENDING,
      watchProgress: NO_PROGRESS,
    });

    expect(view.marks.map((mark) => mark.fraction)).toEqual([0, 0.5]);
    expect(view.marks.map((mark) => mark.chapter.index)).toEqual([0, 1]);
  });

  test("a Stream with no length has nowhere to put its chapters", () => {
    const view = playbackView(playback({ duration: null }), {
      played: 0,
      pending: NO_PENDING,
      watchProgress: NO_PROGRESS,
    });

    expect(view.marks).toEqual([]);
  });

  test("chapterAt names the last chapter that began at or before the moment", () => {
    const view = playbackView(playback(), {
      played: 0,
      pending: NO_PENDING,
      watchProgress: NO_PROGRESS,
    });

    expect(view.chapterAt(0)?.index).toBe(0);
    expect(view.chapterAt(1800)?.index).toBe(1);
    expect(view.chapterAt(-1)).toBeNull();
  });
});

describe("the control facts", () => {
  test("tracks are ordered by kind, embedded first", () => {
    const view = playbackView(playback(), {
      played: 0,
      pending: NO_PENDING,
      watchProgress: NO_PROGRESS,
    });

    expect(view.tracks.audio.map((held) => held.id)).toEqual([1, 2]);
    expect(view.tracks.subtitle.map((held) => held.id)).toEqual([3]);
  });

  test("speed defaults to 1, and the volume to the Player's full 100", () => {
    const view = playbackView(playback({ speed: null, volume: null, muted: null }), {
      played: 0,
      pending: NO_PENDING,
      watchProgress: NO_PROGRESS,
    });

    expect(view.speed).toBe(1);
    expect(view.volume.level).toBe(100);
    expect(view.volume.fraction).toBeCloseTo(100 / 130);
    expect(view.volume.muted).toBe(false);
    expect(view.volume.label).toBe("100%");
  });

  test("a published volume is rounded and its mute carried", () => {
    const view = playbackView(playback({ volume: 60.4, muted: true }), {
      played: 0,
      pending: NO_PENDING,
      watchProgress: NO_PROGRESS,
    });

    expect(view.volume).toEqual({ level: 60, fraction: 60 / 130, muted: true, label: "60%" });
  });

  test("the pending keys are the Session's, and the stream key is the Stream's", () => {
    const pending = new Set([actionKey({ type: "next_episode" })]);
    const playing = playback();
    const view = playbackView(playing, {
      played: 0,
      pending,
      watchProgress: NO_PROGRESS,
    });

    expect(view.pending).toBe(pending);
    expect(view.streamKey).toBe(streamKey(playing.nowPlaying));
    expect(view.episode).toBeNull();
    expect(view.nowPlaying).toBe(playing.nowPlaying);
  });
});

describe("the programme note", () => {
  test("the Watch-progress Title names the programme, over the Stream's badges", () => {
    const view = playbackView(playback({ episode: { season: 1, episode: 1 }, nowPlaying: {
      video: { type: "series", id: "tt7777777:1:1" },
      addon: "community.aiostreams",
      name: "AIOStreams\n4K HDR",
      description: null,
      filename: null,
      bingeGroup: null,
    } }), {
      played: 0,
      pending: NO_PENDING,
      watchProgress: [entry()],
    });

    expect(view.title).toBe("A Series That Plays");
    expect(view.episodeLabel).toBe("S1E1");
    expect(view.episode).toEqual({ season: 1, episode: 1 });
  });

  test("without a Watch-progress entry the Stream's own title is the name", () => {
    const view = playbackView(playback(), {
      played: 0,
      pending: NO_PENDING,
      watchProgress: NO_PROGRESS,
    });

    expect(view.title).toBe("AIOStreams");
    expect(view.episodeLabel).toBe("Feature");
    expect(view.openingPreview).toBeNull();
  });

  test("a film's Watch-progress entry is a Feature, with its art and no episode label", () => {
    const film = entry({
      video: { id: "tt0133093", name: "The Matrix", season: null, episode: null, thumbnail: null, airDate: null },
      title: {
        addon: "cinemeta",
        id: "tt0133093",
        type: "movie",
        name: "The Matrix",
        poster: "https://images.test/matrix-poster.jpg",
        background: "https://images.test/matrix-backdrop.jpg",
      },
    });
    const view = playbackView(playback(), {
      played: 0,
      pending: NO_PENDING,
      watchProgress: [film],
    });

    expect(view.title).toBe("The Matrix");
    expect(view.episodeLabel).toBe("Feature");
    expect(view.openingPreview).toEqual({
      art: "https://images.test/matrix-backdrop.jpg",
      title: "The Matrix",
      subtitle: "The Matrix",
    });
  });

  test("an episode's opening preview prefers its still, and labels it with the episode", () => {
    const view = playbackView(
      playback({
        episode: { season: 1, episode: 1 },
        nowPlaying: {
          video: { type: "series", id: "tt7777777:1:1" },
          addon: "community.aiostreams",
          name: "AIOStreams\n1080p",
          description: null,
          filename: null,
          bingeGroup: null,
        },
      }),
      {
        played: 0,
        pending: NO_PENDING,
        watchProgress: [entry()],
      },
    );

    expect(view.openingPreview).toEqual({
      art: "https://images.test/episode-one.jpg",
      title: "A Series That Plays",
      subtitle: "S1E1 · Episode One",
    });
  });

  test("an Autoplay countdown is projected from the time since the Snapshot arrived", () => {
    const counting = playback({
      state: "ended",
      autoplay: {
        next: {
          title: { type: "series", id: "tt7777777" },
          video: { type: "series", id: "tt7777777:1:2" },
          episode: { season: 1, episode: 2 },
          name: "Episode Two",
          still: null,
        },
        phase: "countdown",
        remaining: 5,
        duration: 5,
      },
    });

    const fresh = playbackView(counting, { played: 0, pending: NO_PENDING, watchProgress: [] });
    expect(fresh.autoplay.kind === "countdown" ? fresh.autoplay.digit : null).toBe(5);

    const later = playbackView(counting, { played: 2.2, pending: NO_PENDING, watchProgress: [] });
    expect(later.autoplay.kind === "countdown" ? later.autoplay.digit : null).toBe(3);

    const none = playbackView(playback(), { played: 0, pending: NO_PENDING, watchProgress: [] });
    expect(none.autoplay).toEqual({ kind: "none" });
  });
});
