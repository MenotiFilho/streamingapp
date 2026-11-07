import { describe, expect, test } from "vitest";

import { episodesOf, firstPlayableStream, seriesAction, seriesRef } from "./episodes";
import type {
  AddonStreams,
  NowPlaying,
  PlaybackSnapshot,
  ResumeEntry,
  Snapshot,
  Title,
  Video,
} from "./wire";

const EMPTY_PLAYBACK: PlaybackSnapshot = {
  state: "idle",
  picture: "in_window",
  failure: null,
  nowPlaying: null,
  episode: null,
  position: null,
  duration: null,
  buffered: null,
  tracks: [],
  chapters: [],
  chapter: null,
  speed: null,
  volume: null,
  muted: null,
  subtitleDelay: null,
  crop: null,
  aspect: null,
  resolution: null,
  statistics: null,
};

function snapshot(entries: ResumeEntry[]): Snapshot {
  return {
    revision: 1,
    playback: EMPTY_PLAYBACK,
    preferences: {
      subtitleLanguage: null,
      subtitleColor: "#FFFFFF",
      subtitleScale: 1,
      streamBuffer: { seconds: 300, megabytes: 512 },
    },
    addons: [],
    featuredCatalog: null,
    protection: { backend: "file", tmdbHeld: false, stremioHeld: false },
    continueWatching: [],
    watchProgress: entries,
    devices: [],
    pairingCode: "4K7Q2M",
    address: null,
  };
}

function nowPlaying(overrides: Partial<NowPlaying> = {}): NowPlaying {
  return {
    video: { type: "series", id: "tt7777777:1:1" },
    addon: "community.aiostreams",
    name: "AIOStreams\n1080p",
    description: null,
    filename: null,
    bingeGroup: null,
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
      thumbnail: null,
      airDate: null,
    },
    title: {
      addon: "cinemeta",
      id: "tt7777777",
      type: "series",
      name: "A Series That Plays",
      poster: null,
      background: null,
    },
    position: 0,
    duration: null,
    watched: false,
    unplayable: null,
    ...overrides,
  };
}

function video(overrides: Partial<Video> = {}): Video {
  return {
    id: "tt1:1:1",
    name: "Episode",
    season: 1,
    episode: 1,
    thumbnail: null,
    airDate: null,
    ...overrides,
  };
}

function title(overrides: Partial<Title> = {}): Title {
  return {
    addon: "cinemeta",
    id: "tt7777777",
    key: { kind: "tmdb", id: 7777777 },
    type: "series",
    name: "A Series That Plays",
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

describe("the series a playing Stream belongs to", () => {
  test("the Watch-progress Title's Addon is the one that can list its episodes", () => {
    const held = seriesRef(snapshot([entry()]), nowPlaying());

    expect(held).toEqual({
      kind: "addon",
      addon: "cinemeta",
      title: { type: "series", id: "tt7777777" },
      cache: "cinemeta|series|tt7777777",
    });
  });

  test("a held Title with no Addon is asked for as the TMDB key it carries", () => {
    const held = seriesRef(
      snapshot([
        entry({
          title: {
            addon: null,
            id: "tmdb:7777777",
            type: "series",
            name: "A Series That Plays",
            poster: null,
            background: null,
          },
        }),
      ]),
      nowPlaying(),
    );

    expect(held).toEqual({
      kind: "discovered",
      key: { kind: "tmdb", id: 7777777 },
      type: "series",
      fallbackAddon: "community.aiostreams",
      cache: "tmdb|series|7777777",
    });
  });

  test("a TMDB-keyed Video id is the discovered key, even with no progress at all", () => {
    const held = seriesRef(
      null,
      nowPlaying({ video: { type: "series", id: "tmdb:4242:1:3" } }),
    );

    expect(held).toEqual({
      kind: "discovered",
      key: { kind: "tmdb", id: 4242 },
      type: "series",
      fallbackAddon: "community.aiostreams",
      cache: "tmdb|series|4242",
    });
  });

  test("otherwise the Stream's own Addon is the fallback, and the episode suffix is dropped", () => {
    const held = seriesRef(null, nowPlaying({ video: { type: "series", id: "tt123456:2:4" } }));

    expect(held).toEqual({
      kind: "addon",
      addon: "community.aiostreams",
      title: { type: "series", id: "tt123456" },
      cache: "community.aiostreams|series|tt123456",
    });
  });

  test("a film's Addon-keyed id is its title id unchanged", () => {
    const held = seriesRef(
      null,
      nowPlaying({ video: { type: "movie", id: "tt0133093" } }),
    );

    expect(held).toEqual({
      kind: "addon",
      addon: "community.aiostreams",
      title: { type: "movie", id: "tt0133093" },
      cache: "community.aiostreams|movie|tt0133093",
    });
  });
});

describe("the question an Episodes menu asks about its series", () => {
  test("an Addon's series is open_title with that Addon and its key", () => {
    expect(
      seriesAction({
        kind: "addon",
        addon: "cinemeta",
        title: { type: "series", id: "tt7777777" },
        cache: "cinemeta|series|tt7777777",
      }),
    ).toEqual({
      type: "open_title",
      addon: "cinemeta",
      title: { type: "series", id: "tt7777777" },
    });
  });

  test("a Discovered series is open_discovered_title with the TMDB key and kind", () => {
    expect(
      seriesAction({
        kind: "discovered",
        key: { kind: "tmdb", id: 7777777 },
        type: "series",
        fallbackAddon: "community.aiostreams",
        cache: "tmdb|series|7777777",
      }),
    ).toEqual({
      type: "open_discovered_title",
      key: { kind: "tmdb", id: 7777777 },
      kind: "series",
    });
  });
});

describe("the episodes of a Title", () => {
  test("are grouped into seasons in the Host's order, Videos kept in order", () => {
    const seasons = episodesOf(
      title({
        videos: [
          video({ id: "tt1:1:1", season: 1, episode: 1 }),
          video({ id: "tt1:1:2", season: 1, episode: 2 }),
          video({ id: "tt1:2:1", season: 2, episode: 1 }),
          video({ id: "tt1:0:1", season: 0, episode: 1 }),
        ],
      }),
    );

    expect(seasons.map((season) => season.season)).toEqual([1, 2, 0]);
    expect(seasons.map((season) => season.videos.map((held) => held.id))).toEqual([
      ["tt1:1:1", "tt1:1:2"],
      ["tt1:2:1"],
      ["tt1:0:1"],
    ]);
  });

  test("a Video the Addon placed in no season is a group of its own, where it first appears", () => {
    const seasons = episodesOf(
      title({
        videos: [
          video({ id: "tt1:x", season: null, episode: null }),
          video({ id: "tt1:1:1", season: 1, episode: 1 }),
        ],
      }),
    );

    expect(seasons.map((season) => season.season)).toEqual([null, 1]);
  });

  test("a film lists no episodes", () => {
    expect(episodesOf(title({ type: "movie" }))).toEqual([]);
  });
});

describe("the first Stream an Episodes press can play", () => {
  test("skips a candidate this Host cannot play and names the Addon that offered it", () => {
    const groups: AddonStreams[] = [
      {
        addon: "first",
        failure: null,
        streams: [
          { name: "torrent", description: null, playback: { kind: "info_hash", infoHash: "abc" }, warnings: [], filename: null, bingeGroup: null },
          { name: "direct", description: null, playback: { kind: "direct", url: "https://x" }, warnings: [], filename: null, bingeGroup: null },
        ],
      },
    ];

    expect(firstPlayableStream(groups)).toEqual({
      addon: "first",
      stream: groups[0]!.streams[1],
    });
  });

  test("the Addons are read in the configured order, each group taking its first playable", () => {
    const groups: AddonStreams[] = [
      {
        addon: "first",
        failure: null,
        streams: [{ name: "torrent", description: null, playback: { kind: "info_hash", infoHash: "abc" }, warnings: [], filename: null, bingeGroup: null }],
      },
      {
        addon: "second",
        failure: null,
        streams: [{ name: "direct", description: null, playback: { kind: "direct", url: "https://y" }, warnings: [], filename: null, bingeGroup: null }],
      },
    ];

    expect(firstPlayableStream(groups)).toEqual({ addon: "second", stream: groups[1]!.streams[0] });
  });

  test("no playable candidate is null", () => {
    expect(
      firstPlayableStream([
        {
          addon: "only",
          failure: null,
          streams: [{ name: "torrent", description: null, playback: { kind: "info_hash", infoHash: "abc" }, warnings: [], filename: null, bingeGroup: null }],
        },
      ]),
    ).toBeNull();
    expect(firstPlayableStream([])).toBeNull();
  });
});
