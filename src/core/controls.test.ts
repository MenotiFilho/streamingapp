import { describe, expect, test } from "vitest";

import {
  ASPECTS,
  AUTOPLAY_CHOICES,
  AUTOPLAY_DEFAULT,
  AUTOPLAY_SETTING_LABEL,
  AUTOPLAY_SWITCH_LABEL,
  CROP_RATIOS,
  DELAY_STEP,
  SPEEDS,
  SUBTITLE_COLORS,
  SUBTITLE_SCALE_MAX,
  SUBTITLE_SCALE_MIN,
  SUBTITLE_SCALES,
  TORRENT_CACHE_DEFAULT_MEGABYTES,
  TORRENT_CACHE_MAX_MEGABYTES,
  TORRENT_CACHE_MEGABYTES,
  TORRENT_CACHE_MIN_MEGABYTES,
  TORRENT_FETCH_NOTE,
  UP_NEXT_PLAYBACK_CHOICES,
  UP_NEXT_PLAYBACK_SETTING_LABEL,
  VOLUME_MAX,
  aspectSelected,
  autoplayOn,
  centredCrop,
  chapterLabel,
  colorSelected,
  controllable,
  cropChoices,
  cropSelected,
  formatDelay,
  formatScale,
  formatSpeed,
  formatTorrentCache,
  formatVolume,
  nextEpisodeDisabled,
  orderedTracks,
  upNextRows,
  previousEpisodeDisabled,
  scalePreset,
  scaleSelected,
  speedSelected,
  statisticsLines,
  stepDelay,
  stepScale,
  subtitlesOn,
  torrentCachePreset,
  torrentCacheRequest,
  trackLabel,
  trackMarks,
  volumeFraction,
} from "./controls";
import type { Aspect, Crop, CropRectangle, Snapshot, Track, VideoSize } from "./wire";
import appearance from "../subtitle-appearance.json";

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
    hearingImpaired: false,
    ...overrides,
  };
}

describe("whether the Host would take a control", () => {
  test("a Stream that is opening, playing or paused is one the Host will control", () => {
    expect(controllable("opening")).toBe(true);
    expect(controllable("playing")).toBe(true);
    expect(controllable("paused")).toBe(true);
  });

  test("a Stream that ended is not one to control, and neither is nothing at all", () => {
    expect(controllable("ended")).toBe(false);
    expect(controllable("idle")).toBe(false);
  });
});

describe("the tracks a Stream carries", () => {
  const tracks: Track[] = [
    track({ id: 1, language: "eng", title: "English stereo", codec: "aac", selected: true }),
    track({ id: 2, kind: "subtitle", language: "por", codec: "subrip", embedded: true }),
    track({ id: 3, kind: "audio", title: "Commentary", embedded: false }),
    track({ id: 4, kind: "subtitle", title: "Added", embedded: false }),
  ];

  test("only the kind asked for is listed", () => {
    expect(orderedTracks(tracks, "audio").map((held) => held.id)).toEqual([1, 3]);
    expect(orderedTracks(tracks, "subtitle").map((held) => held.id)).toEqual([2, 4]);
  });

  test("embedded tracks come first, and mpv's order is kept inside each group", () => {
    const listed = orderedTracks(
      [
        track({ id: 9, embedded: false }),
        track({ id: 7, embedded: true }),
        track({ id: 8, embedded: false }),
      ],
      "audio",
    );
    expect(listed.map((held) => held.id)).toEqual([7, 9, 8]);
  });

  test("subtitles are on only when a subtitle track is the selected one", () => {
    expect(subtitlesOn(tracks)).toBe(false);
    expect(subtitlesOn([...tracks, track({ id: 5, kind: "subtitle", selected: true })])).toBe(true);
  });

  test("a track is named by what the container said, or by the number the Player gave", () => {
    expect(trackLabel(track({ id: 1, language: "eng", title: "English stereo", codec: "aac" }))).toBe(
      "English stereo · eng · aac",
    );
    expect(trackLabel(track({ id: 4 }))).toBe("Track 4");
  });

  test("an embedded, forced or default track is marked as such", () => {
    expect(trackMarks(track({ id: 1, embedded: true, forced: false, default: true }))).toEqual([
      "embedded",
      "default",
    ]);
    expect(trackMarks(track({ id: 2, embedded: false, forced: true }))).toEqual(["forced"]);
    expect(trackMarks(track({ id: 3, embedded: false }))).toEqual([]);
  });
});

describe("subtitle delay", () => {
  test("a step is rounded to the tenth the buttons work in", () => {
    expect(stepDelay(0.1, 0.2)).toBe(0.3);
    expect(stepDelay(0, DELAY_STEP)).toBe(0.1);
    expect(stepDelay(0.3, -DELAY_STEP)).toBe(0.2);
  });

  test("the value reads with its sign, and zero has none", () => {
    expect(formatDelay(0)).toBe("0.0 s");
    expect(formatDelay(0.1)).toBe("+0.1 s");
    expect(formatDelay(-0.2)).toBe("\u22120.2 s");
  });
});

describe("speed", () => {
  test("the speeds offered are the ones a person picks from", () => {
    expect([...SPEEDS]).toEqual([0.5, 0.75, 1, 1.25, 1.5, 2]);
  });

  test("a rate reads as a multiple", () => {
    expect(formatSpeed(1)).toBe("1×");
    expect(formatSpeed(1.5)).toBe("1.5×");
  });

  test("a choice is the selected one only within a rounding of the rate", () => {
    expect(speedSelected(1, 1)).toBe(true);
    expect(speedSelected(1.0000001, 1)).toBe(true);
    expect(speedSelected(1.25, 1)).toBe(false);
    expect(speedSelected(null, 1)).toBe(false);
  });
});

describe("volume", () => {
  test("a level reads as a percentage on the Player's scale", () => {
    expect(formatVolume(100)).toBe("100%");
    expect(formatVolume(0)).toBe("0%");
    expect(formatVolume(42.4)).toBe("42%");
  });

  test("the fader fraction is clamped to the Player's scale", () => {
    expect(VOLUME_MAX).toBe(130);
    expect(volumeFraction(0)).toBe(0);
    expect(volumeFraction(65)).toBe(0.5);
    expect(volumeFraction(100)).toBeCloseTo(100 / 130);
    expect(volumeFraction(200)).toBe(1);
    expect(volumeFraction(-10)).toBe(0);
  });
});

describe("chapters", () => {
  test("a chapter is named by where it starts, and its title where it has one", () => {
    expect(chapterLabel({ index: 0, title: "Intro", time: 0 })).toBe("0:00 — Intro");
    expect(chapterLabel({ index: 1, title: null, time: 300 })).toBe("5:00");
  });
});

describe("crop", () => {
  const wide: VideoSize = { width: 128, height: 72 };

  test("a crop of a ratio the source is wider than trims the sides, centred", () => {
    // The frozen example: a 128×72 source cut to 4:3 is 96×72, 16 to the left.
    expect(centredCrop(wide, 4 / 3)).toEqual({ width: 96, height: 72, x: 16, y: 0 });
  });

  test("a source already at the ratio crops to itself", () => {
    expect(centredCrop(wide, 16 / 9)).toEqual({ width: 128, height: 72, x: 0, y: 0 });
  });

  test("a crop of a ratio the source is taller than trims top and bottom, centred", () => {
    expect(centredCrop(wide, 21 / 9)).toEqual({ width: 128, height: 55, x: 0, y: 8 });
  });

  test("a portrait source is trimmed the other way", () => {
    // 720×1280 cut to 16:9 keeps the width: 405 tall, centred at 437 from the top.
    expect(centredCrop({ width: 720, height: 1280 }, 16 / 9)).toEqual({
      width: 720,
      height: 405,
      x: 0,
      y: 437,
    });
  });

  test("the choices are the whole frame, then one rectangle per ratio", () => {
    const choices = cropChoices(wide);
    expect(choices.map((choice) => choice.label)).toEqual([
      "Full frame",
      ...CROP_RATIOS.map((ratio) => ratio.label),
    ]);
    expect(choices[0]?.crop).toEqual({ kind: "off" });
    expect(choices[1]?.crop).toEqual({ kind: "rectangle", width: 128, height: 72, x: 0, y: 0 });
  });

  test("a picture of unknown size offers only the whole frame", () => {
    expect(cropChoices(null).map((choice) => choice.label)).toEqual(["Full frame"]);
  });

  test("the current rectangle selects its choice, and no rectangle is the whole frame", () => {
    const rectangle: Crop = { kind: "rectangle", width: 96, height: 72, x: 16, y: 0 };
    const current: CropRectangle = { width: 96, height: 72, x: 16, y: 0 };
    expect(cropSelected(current, rectangle)).toBe(true);
    expect(cropSelected(null, rectangle)).toBe(false);
    expect(cropSelected(null, { kind: "off" })).toBe(true);
    expect(cropSelected(current, { kind: "off" })).toBe(false);
  });
});

describe("aspect", () => {
  test("the shapes offered are the Stream's own and the three ratios", () => {
    expect(ASPECTS.map((choice) => choice.label)).toEqual(["Source", "16:9", "4:3", "21:9"]);
  });

  test("the Stream's own shape is selected while no ratio overrides it", () => {
    const source: Aspect = { kind: "source" };
    expect(aspectSelected(null, source)).toBe(true);
    expect(aspectSelected(source, source)).toBe(true);
    expect(aspectSelected({ kind: "ratio", value: 16 / 9 }, source)).toBe(false);
  });

  test("a ratio is selected within a rounding of the value", () => {
    expect(aspectSelected({ kind: "ratio", value: 16 / 9 }, { kind: "ratio", value: 16 / 9 })).toBe(
      true,
    );
    expect(
      aspectSelected({ kind: "ratio", value: 1.7778 }, { kind: "ratio", value: 16 / 9 }),
    ).toBe(true);
    expect(aspectSelected({ kind: "ratio", value: 4 / 3 }, { kind: "ratio", value: 16 / 9 })).toBe(
      false,
    );
    expect(aspectSelected(null, { kind: "ratio", value: 16 / 9 })).toBe(false);
  });
});

describe("statistics", () => {
  test("a report reads as the three numbers a person wants", () => {
    expect(
      statisticsLines({ bitrate: 4_000_000, droppedFrames: 3, hardwareDecode: "d3d11va" }),
    ).toEqual([
      { label: "Bitrate", value: "4.0 Mbps" },
      { label: "Dropped frames", value: "3" },
      { label: "Hardware decode", value: "d3d11va" },
    ]);
  });

  test("a bitrate below a megabit is read in kilobits, and an absent report as unknown", () => {
    expect(statisticsLines({ bitrate: 900_000, droppedFrames: 0, hardwareDecode: null })).toEqual([
      { label: "Bitrate", value: "900 kbps" },
      { label: "Dropped frames", value: "0" },
      { label: "Hardware decode", value: "—" },
    ]);
    expect(statisticsLines(null)).toEqual([
      { label: "Bitrate", value: "—" },
      { label: "Dropped frames", value: "—" },
      { label: "Hardware decode", value: "—" },
    ]);
  });
});

describe("the step to a neighbouring episode", () => {
  test("a film has neither a previous nor a next episode to offer", () => {
    expect(nextEpisodeDisabled(null)).toBe(true);
    expect(previousEpisodeDisabled(null)).toBe(true);
  });

  test("an episode offers a next step, and a previous one everywhere but S1E1", () => {
    expect(nextEpisodeDisabled({ season: 1, episode: 1 })).toBe(false);
    expect(previousEpisodeDisabled({ season: 1, episode: 1 })).toBe(true);
    expect(previousEpisodeDisabled({ season: 1, episode: 2 })).toBe(false);
    expect(previousEpisodeDisabled({ season: 2, episode: 1 })).toBe(false);
  });

  test("a season zero special is not S1E1, so the step back stays live", () => {
    // The Host may still refuse — the Addon's list may begin at it — but a
    // special is not the first episode *of season one*, and the press is what
    // answers (ADR-0021).
    expect(previousEpisodeDisabled({ season: 0, episode: 1 })).toBe(false);
    expect(previousEpisodeDisabled({ season: 0, episode: 0 })).toBe(false);
  });
});

describe("the subtitle appearance a person picks", () => {
  test("the window imports the one JSON file the Remote splices in", () => {
    expect(SUBTITLE_COLORS).toEqual(appearance.colors);
    expect(SUBTITLE_SCALES).toEqual(appearance.scales);
    expect(SUBTITLE_SCALE_MIN).toBe(appearance.minScale);
    expect(SUBTITLE_SCALE_MAX).toBe(appearance.maxScale);
  });

  test("Settings offers white, yellow, cyan and green, and the white is the default", () => {
    expect(SUBTITLE_COLORS.map((choice) => choice.label)).toEqual([
      "White",
      "Yellow",
      "Cyan",
      "Green",
    ]);
    expect(SUBTITLE_COLORS.map((choice) => choice.color)).toEqual([
      "#FFFFFF",
      "#FFFF00",
      "#00FFFF",
      "#00FF00",
    ]);
    expect(SUBTITLE_COLORS[0]?.color).toBe("#FFFFFF");
  });

  test("Settings offers four sizes, from 80% to 150%", () => {
    expect(SUBTITLE_SCALES).toEqual([
      { label: "Small", scale: 0.8 },
      { label: "Default", scale: 1 },
      { label: "Large", scale: 1.25 },
      { label: "Larger", scale: 1.5 },
    ]);
    expect(SUBTITLE_SCALES.map((choice) => formatScale(choice.scale))).toEqual([
      "80%",
      "100%",
      "125%",
      "150%",
    ]);
  });

  test("one OSD press moves to the neighbouring preset, never between them", () => {
    expect(stepScale(0.8, 1)).toBe(1);
    expect(stepScale(1, 1)).toBe(1.25);
    expect(stepScale(1.25, 1)).toBe(1.5);
    expect(stepScale(1.5, -1)).toBe(1.25);
    expect(stepScale(1.25, -1)).toBe(1);
    expect(stepScale(1, -1)).toBe(0.8);
  });

  test("the OSD size clamps at the ends of the four presets", () => {
    expect(stepScale(1.5, 1)).toBe(1.5);
    expect(stepScale(0.8, -1)).toBe(0.8);
  });

  test("a size the Remote set is brought onto the four presets", () => {
    // The Host accepts any scale in 0.5–2.0 on the wire; the OSD's four presses
    // still land on a chip, and 105/120/160% are named by Settings' Other chip.
    expect(stepScale(1.05, 1)).toBe(1.25);
    expect(stepScale(1.05, -1)).toBe(1);
    expect(stepScale(1.2, 1)).toBe(1.25);
    expect(stepScale(1.2, -1)).toBe(1);
    expect(stepScale(1.6, 1)).toBe(1.5);
    expect(stepScale(1.6, -1)).toBe(1.5);
    expect(stepScale(0.5, 1)).toBe(0.8);
    expect(stepScale(0.5, -1)).toBe(0.8);
  });

  test("only the four presets press a Settings chip", () => {
    for (const choice of SUBTITLE_SCALES) {
      expect(scalePreset(choice.scale)).toBe(true);
    }
    for (const held of [0.5, 1.05, 1.2, 1.6, 2]) {
      expect(scalePreset(held)).toBe(false);
    }
  });

  test("a size reads as a percentage, and the pressed choice is the Host's value", () => {
    expect(formatScale(0.8)).toBe("80%");
    expect(formatScale(1)).toBe("100%");
    expect(formatScale(1.05)).toBe("105%");
    expect(formatScale(1.25)).toBe("125%");
    expect(scaleSelected(1.25, 1.25)).toBe(true);
    expect(scaleSelected(1.3, 1.25)).toBe(false);
  });

  test("a colour compares whatever case the Host wrote it in", () => {
    expect(colorSelected("#FFFF00", "#FFFF00")).toBe(true);
    expect(colorSelected("#ffcc00", "#FFCC00")).toBe(true);
    expect(colorSelected("#FFFFFF", "#FFFF00")).toBe(false);
  });
});

describe("Up next and Autoplay", () => {
  test("Settings offers both Up next rows and their choices", () => {
    expect(AUTOPLAY_SETTING_LABEL).toBe("When an episode ends");
    expect(AUTOPLAY_CHOICES).toEqual([
      { autoplay: true, label: "Play it after 5 seconds" },
      { autoplay: false, label: "Wait" },
    ]);
    expect(UP_NEXT_PLAYBACK_SETTING_LABEL).toBe("When Play is pressed on it");
    expect(UP_NEXT_PLAYBACK_CHOICES).toEqual([
      { playback: "direct", label: "Play directly" },
      { playback: "picker", label: "Open the Streams picker" },
    ]);
  });

  test("the player switch carries the shared Autoplay label", () => {
    expect(AUTOPLAY_SWITCH_LABEL).toBe("Autoplay the next episode");
  });
});

describe("the Autoplay preference a client reads", () => {
  const held = (autoplay: boolean, upNextPlayback: "direct" | "picker" = "direct") =>
    ({
      preferences: { autoplay, upNextPlayback },
    }) as Pick<Snapshot, "preferences">;

  test("is what the Host last published", () => {
    expect(autoplayOn(held(true))).toBe(true);
    expect(autoplayOn(held(false))).toBe(false);
  });

  test("before any Snapshot it is the Host's own default, on", () => {
    expect(AUTOPLAY_DEFAULT).toBe(true);
    expect(autoplayOn(null)).toBe(true);
  });

  test("the Up next rows mark the held choices and each chip sends its own Action", () => {
    const [autoplayRow, playbackRow] = upNextRows(held(false, "picker"));

    expect(autoplayRow!.id).toBe("autoplay");
    expect(autoplayRow!.choices.map((choice) => [choice.pressed, choice.action])).toEqual([
      [false, { type: "set_autoplay", autoplay: true }],
      [true, { type: "set_autoplay", autoplay: false }],
    ]);
    expect(playbackRow!.id).toBe("playback");
    expect(playbackRow!.choices.map((choice) => [choice.pressed, choice.action])).toEqual([
      [false, { type: "set_up_next_playback", playback: "direct" }],
      [true, { type: "set_up_next_playback", playback: "picker" }],
    ]);
  });

  test("before any Snapshot the rows hold the defaults: Autoplay on, Play directly", () => {
    const [autoplayRow, playbackRow] = upNextRows(null);

    expect(autoplayRow!.choices.filter((choice) => choice.pressed).map((choice) => choice.id)).toEqual([
      "autoplay-true",
    ]);
    expect(playbackRow!.choices.filter((choice) => choice.pressed).map((choice) => choice.id)).toEqual([
      "direct",
    ]);
  });

  test("the rows carry the words Settings uses", () => {
    const rows = upNextRows(null);

    expect(rows.map((row) => row.label)).toEqual([AUTOPLAY_SETTING_LABEL, UP_NEXT_PLAYBACK_SETTING_LABEL]);
    expect(rows[0]!.choices.map((choice) => choice.label)).toEqual(AUTOPLAY_CHOICES.map((choice) => choice.label));
    expect(rows[1]!.choices.map((choice) => choice.label)).toEqual(
      UP_NEXT_PLAYBACK_CHOICES.map((choice) => choice.label),
    );
  });
});

describe("the Torrent cache a person picks", () => {
  test("Settings offers 512 MB, 2 GB, 8 GB and 32 GB, in decimal megabytes", () => {
    expect(TORRENT_CACHE_MEGABYTES.map((choice) => [choice.label, choice.megabytes])).toEqual([
      ["512 MB", 512],
      ["2 GB", 2000],
      ["8 GB", 8000],
      ["32 GB", 32000],
    ]);
  });

  test("every preset is a size the Host takes, and the default is one of them", () => {
    for (const choice of TORRENT_CACHE_MEGABYTES) {
      expect(choice.megabytes).toBeGreaterThanOrEqual(TORRENT_CACHE_MIN_MEGABYTES);
      expect(choice.megabytes).toBeLessThanOrEqual(TORRENT_CACHE_MAX_MEGABYTES);
    }
    expect([TORRENT_CACHE_MIN_MEGABYTES, TORRENT_CACHE_MAX_MEGABYTES]).toEqual([256, 32000]);
    expect(TORRENT_CACHE_DEFAULT_MEGABYTES).toBe(2000);
    expect(torrentCachePreset(TORRENT_CACHE_DEFAULT_MEGABYTES)).toBe(true);
  });

  test("a size the ladder does not hold is its own chip, in megabytes", () => {
    expect(torrentCachePreset(8000)).toBe(true);
    expect(torrentCachePreset(1500)).toBe(false);
    expect(formatTorrentCache(2000)).toBe("2 GB");
    expect(formatTorrentCache(1500)).toBe("1500 MB");
  });

  test("a press sends the one Action, with the megabytes alone", () => {
    expect(torrentCacheRequest(8000)).toEqual({ type: "set_torrent_cache", megabytes: 8000 });
  });

  test("the Stream buffer says a torrent is fetched that far ahead too", () => {
    expect(TORRENT_FETCH_NOTE).toBe("Torrents are fetched this far ahead too.");
  });
});
