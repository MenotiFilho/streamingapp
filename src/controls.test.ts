import { describe, expect, test } from "vitest";

import {
  ASPECTS,
  CROP_RATIOS,
  DELAY_STEP,
  SCALE_STEP,
  SPEEDS,
  SUBTITLE_COLORS,
  SUBTITLE_SCALES,
  aspectSelected,
  centredCrop,
  chapterLabel,
  colorSelected,
  controllable,
  cropChoices,
  cropSelected,
  formatDelay,
  formatScale,
  formatSpeed,
  formatVolume,
  nextEpisodeDisabled,
  orderedTracks,
  previousEpisodeDisabled,
  scaleSelected,
  speedSelected,
  statisticsLines,
  stepDelay,
  stepScale,
  subtitlesOn,
  trackLabel,
  trackMarks,
} from "./controls";
import type { Aspect, Crop, CropRectangle, Track, VideoSize } from "./host-client";

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

  test("one OSD press moves the size by five per cent and lands on a chip", () => {
    expect(SCALE_STEP).toBe(0.05);
    expect(stepScale(1, SCALE_STEP)).toBe(1.05);
    expect(stepScale(1.2, SCALE_STEP)).toBe(1.25);
    expect(stepScale(1.25, -SCALE_STEP)).toBe(1.2);
    expect(stepScale(0.82, -SCALE_STEP)).toBe(0.77);
  });

  test("the OSD size stops at the range the Host accepts", () => {
    expect(stepScale(2, SCALE_STEP)).toBe(2);
    expect(stepScale(0.5, -SCALE_STEP)).toBe(0.5);
    expect(stepScale(1.98, SCALE_STEP)).toBe(2);
  });

  test("a size reads as a percentage, and the pressed choice is the Host's value", () => {
    expect(formatScale(0.8)).toBe("80%");
    expect(formatScale(1)).toBe("100%");
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
