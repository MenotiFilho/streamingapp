import { describe, expect, it } from "vitest";

import {
  addonFilterChips,
  filterStreamGroups,
  isPlayingStream,
  mergeRetriedAddonGroup,
  resolveSelectedAddon,
  streamRowView,
  streamsEmptyState,
  streamsPanelSubtitle,
  streamsSubjectParts,
} from "./marqueeStreams";
import type { AddonManifest, AddonStreams, PlaybackSnapshot, Stream, Title, Video } from "./wire";

const TORRENTIO_MANIFEST: AddonManifest = {
  id: "torrentio",
  name: "Torrentio",
  version: "0.0.14",
  resources: [],
  types: ["movie", "series"],
  catalogs: [],
  idPrefixes: ["tt"],
  behaviorHints: { configurable: false, configurationRequired: false },
  enabled: true,
};

const COMET_MANIFEST: AddonManifest = {
  ...TORRENTIO_MANIFEST,
  id: "comet",
  name: "Comet",
};

const MEDIAFUSION_MANIFEST: AddonManifest = {
  ...TORRENTIO_MANIFEST,
  id: "mediafusion",
  name: "MediaFusion",
};

const ADDONS = [TORRENTIO_MANIFEST, COMET_MANIFEST, MEDIAFUSION_MANIFEST];

const STREAM_4K: Stream = {
  name: "Torrentio\n4k DV | Atmos",
  description: "Severance.S02E03.2160p\n👤 214 💾 8.4 GB ⚙️ ThePirateBay",
  playback: {
    kind: "torrent",
    infoHash: "a584351126afcf50d32be068f3c9a62550d41ecc",
    fileIdx: 0,
    sources: [],
  },
  warnings: ["p2p"],
  filename: "Severance.S02E03.2160p.ATVP.WEB-DL.DDP5.1.Atmos.DV.H.265",
  bingeGroup: "torrentio|4k",
};

const STREAM_HD: Stream = {
  name: "Comet\n1080p",
  description: "Severance S02E03 Who Is Alive 1080p HEVC x265\n💾 1.8 GB 🌐 Comet · direct",
  playback: { kind: "direct", url: "https://comet.example/stream.mkv" },
  warnings: [],
  filename: null,
  bingeGroup: null,
};

const GROUPS: AddonStreams[] = [
  { addon: "torrentio", streams: [STREAM_4K], failure: null },
  { addon: "comet", streams: [STREAM_HD], failure: null },
  {
    addon: "mediafusion",
    streams: [],
    failure: { kind: "fetch", detail: "addon_unreachable" },
  },
];

const SERIES: Title = {
  addon: "cinemeta",
  id: "tt11280740",
  key: { kind: "tmdb", id: 95396 },
  type: "series",
  name: "Severance",
  poster: null,
  background: null,
  logo: null,
  description: null,
  releaseInfo: "2022–",
  runtime: "49 min",
  imdbRating: "8.6",
  genres: ["Drama"],
  videos: [],
};

const EPISODE: Video = {
  id: "tt11280740:2:3",
  name: "Who Is Alive?",
  season: 2,
  episode: 3,
  thumbnail: null,
  airDate: "2025-01-31",
};

describe("Addon filter chips and grouping", () => {
  it("builds All followed by configured Addon names in Host order", () => {
    expect(addonFilterChips(GROUPS, ADDONS)).toEqual([
      { id: null, label: "All" },
      { id: "torrentio", label: "Torrentio" },
      { id: "comet", label: "Comet" },
      { id: "mediafusion", label: "MediaFusion" },
    ]);
    expect(addonFilterChips([], ADDONS)).toEqual([]);
  });

  it("filters groups by selected Addon and resets to All when that Addon disappears", () => {
    expect(filterStreamGroups(GROUPS, null)).toHaveLength(3);
    expect(filterStreamGroups(GROUPS, "comet")).toEqual([GROUPS[1]]);
    expect(resolveSelectedAddon("missing", GROUPS)).toBeNull();
    expect(filterStreamGroups(GROUPS, "missing")).toHaveLength(3);
  });

  it("formats panel subtitle as total streams from answering Addons, or per-Addon when filtered", () => {
    expect(streamsPanelSubtitle(GROUPS, null, ADDONS)).toBe("2 from 2 Addons");
    expect(streamsPanelSubtitle(GROUPS, "torrentio", ADDONS)).toBe("1 from Torrentio");
    expect(streamsPanelSubtitle(GROUPS, "mediafusion", ADDONS)).toBe("MediaFusion did not answer");
  });
});

describe("mergeRetriedAddonGroup", () => {
  it("replaces only the retried Addon group while preserving every other group", () => {
    const recovered: AddonStreams = {
      addon: "mediafusion",
      streams: [STREAM_HD],
      failure: null,
    };
    const merged = mergeRetriedAddonGroup(GROUPS, "mediafusion", [
      { addon: "torrentio", streams: [], failure: { kind: "fetch", detail: "changed" } },
      { addon: "comet", streams: [], failure: null },
      recovered,
    ]);

    expect(merged[0]).toBe(GROUPS[0]);
    expect(merged[1]).toBe(GROUPS[1]);
    expect(merged[2]).toEqual(recovered);
  });

  it("drops the retried Addon if it is no longer present in the new response", () => {
    const merged = mergeRetriedAddonGroup(GROUPS, "mediafusion", [GROUPS[0]!, GROUPS[1]!]);
    expect(merged).toEqual([GROUPS[0], GROUPS[1]]);
  });
});

describe("streamsSubjectParts", () => {
  it("formats Season/Episode overline and episode name for series", () => {
    expect(streamsSubjectParts(SERIES, null, EPISODE)).toEqual({
      titleName: "Severance",
      overline: "Season 2 · Episode 3",
      heading: "Who Is Alive?",
    });
  });

  it("formats release year and film name for movies", () => {
    const film: Title = { ...SERIES, type: "movie", name: "Dune: Part Two", releaseInfo: "2024" };
    const filmVideo: Video = { id: "tmdb:693134", name: null, season: null, episode: null, thumbnail: null, airDate: null };
    expect(streamsSubjectParts(film, null, filmVideo)).toEqual({
      titleName: "Dune: Part Two",
      overline: "2024",
      heading: "Dune: Part Two",
    });
  });
});

describe("streamRowView", () => {
  it("extracts tier, peers, size, source and verbatim marks without re-wording", () => {
    expect(streamRowView(STREAM_4K)).toEqual({
      name: "Severance.S02E03.2160p.ATVP.WEB-DL.DDP5.1.Atmos.DV.H.265",
      tier: "4K",
      peers: "214",
      size: "8.4 GB",
      source: "ThePirateBay",
      marks: ["Torrentio", "4k DV | Atmos"],
      warnings: [{ tag: "P2P", note: "Peer-to-peer — this Stream comes from peers." }],
      unplayable: null,
    });

    expect(streamRowView(STREAM_HD)).toEqual({
      name: "Severance S02E03 Who Is Alive 1080p HEVC x265",
      tier: "1080p",
      peers: null,
      size: "1.8 GB",
      source: "Comet · direct",
      marks: ["Comet", "1080p"],
      warnings: [],
      unplayable: null,
    });
  });

  it("marks unplayable direct URLs using playabilityNote", () => {
    const unplayable: Stream = {
      ...STREAM_HD,
      playback: { kind: "direct", url: "ftp://example.test/file.mkv" },
    };
    expect(streamRowView(unplayable).unplayable).toContain("Not playable");
  });
});

describe("isPlayingStream and streamsEmptyState", () => {
  it("identifies the Stream currently playing on the Host", () => {
    const playback: PlaybackSnapshot = {
      state: "playing",
      picture: "in_window",
      failure: null,
      nowPlaying: {
        video: { type: "series", id: EPISODE.id },
        addon: "torrentio",
        name: STREAM_4K.name,
        description: STREAM_4K.description,
        filename: STREAM_4K.filename,
        bingeGroup: STREAM_4K.bingeGroup,
      },
      episode: null,
      position: 10,
      duration: 100,
      buffered: null,
      stalled: false,
      torrent: null,
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
      autoplay: null,
    };

    expect(isPlayingStream(playback, "torrentio", EPISODE, STREAM_4K)).toBe(true);
    expect(isPlayingStream(playback, "comet", EPISODE, STREAM_HD)).toBe(false);
    expect(isPlayingStream({ ...playback, state: "idle" }, "torrentio", EPISODE, STREAM_4K)).toBe(false);
  });

  it("distinguishes no configured Stream Addons from all-empty answers", () => {
    expect(streamsEmptyState([])?.title).toBe("No Streams available");
    expect(streamsEmptyState([{ addon: "torrentio", streams: [], failure: null }])?.title).toBe(
      "No Streams found",
    );
    expect(streamsEmptyState(GROUPS)).toBeNull();
  });
});
