import { describe, expect, test } from "vitest";

import {
  audioSection,
  chaptersSection,
  pictureSections,
  speedSection,
  subtitleSections,
  type ChoiceRow,
  type PanelGroup,
  type PanelRow,
} from "./playerPanels";
import type { PlaybackSnapshot, Track } from "./wire";

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
    picture: "in_window",
    failure: null,
    nowPlaying: null,
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
    resolution: { width: 128, height: 72 },
    statistics: { bitrate: 4_000_000, droppedFrames: 0, hardwareDecode: "d3d11va" },
    ...overrides,
  };
}

function rows(groups: PanelGroup[]): PanelRow[] {
  return groups.flatMap((group) => group.rows);
}

function row(groups: PanelGroup[], key: string): PanelRow {
  const found = rows(groups).find((held) => held.key === key);
  if (!found) {
    throw new Error(`no row ${key}`);
  }
  return found;
}

describe("the picture panel", () => {
  test("aspect is a choice per shape, with the one in force pressed", () => {
    const sections = pictureSections(
      playback({ aspect: { kind: "ratio", value: 4 / 3 } }),
      false,
    );
    const aspect = sections.find((group) => group.title === "Aspect")!;

    expect(
      aspect.rows.filter((held): held is ChoiceRow => held.kind === "choice").map((held) => held.label),
    ).toEqual(["Source", "16:9", "4:3", "21:9"]);
    expect(row(sections, "aspect-Source")).toMatchObject({
      kind: "choice",
      pressed: false,
      action: { type: "set_aspect", aspect: { kind: "source" } },
    });
    expect(row(sections, "aspect-4:3")).toMatchObject({
      kind: "choice",
      pressed: true,
      action: { type: "set_aspect", aspect: { kind: "ratio", value: 4 / 3 } },
    });
  });

  test("crop is a choice per computed rectangle, plus Autocrop and its readout", () => {
    const sections = pictureSections(playback(), false);

    expect(rows(sections).filter((held) => held.key.startsWith("crop-"))).toHaveLength(4);
    expect(row(sections, "crop-Full frame")).toMatchObject({
      pressed: true,
      action: { type: "set_crop", crop: { kind: "off" } },
    });
    expect(row(sections, "crop-4:3")).toMatchObject({
      pressed: false,
      action: {
        type: "set_crop",
        crop: { kind: "rectangle", width: 96, height: 72, x: 16, y: 0 },
      },
    });
    expect(row(sections, "autocrop")).toMatchObject({
      kind: "action",
      label: "Autocrop",
      action: { type: "autocrop" },
    });
    expect(row(sections, "autocrop")).not.toHaveProperty("pressed");
    expect(row(sections, "osd-crop-readout")).toMatchObject({
      kind: "readout",
      value: "Autocrop keeps the whole frame.",
    });
  });

  test("a crop set offers to restore the frame and names the rectangle kept", () => {
    const sections = pictureSections(
      playback({ crop: { width: 96, height: 72, x: 16, y: 0 } }),
      false,
    );

    expect(row(sections, "autocrop")).toMatchObject({ label: "Restore full frame" });
    expect(row(sections, "osd-crop-readout")).toMatchObject({
      value: "Autocrop keeps 96×72+16+0.",
    });
  });

  test("statistics is a toggle the client owns, and its lines are the Player's", () => {
    const hidden = pictureSections(playback(), false);
    const shown = pictureSections(playback(), true);

    expect(row(hidden, "toggle-statistics")).toMatchObject({
      kind: "action",
      label: "Show statistics",
      pressed: false,
      action: null,
    });
    expect(rows(hidden).some((held) => held.key === "statistics")).toBe(false);

    expect(row(shown, "toggle-statistics")).toMatchObject({
      label: "Hide statistics",
      pressed: true,
    });
    expect(row(shown, "statistics")).toMatchObject({
      kind: "readout",
      lines: [
        { label: "Bitrate", value: "4.0 Mbps" },
        { label: "Dropped frames", value: "0" },
        { label: "Hardware decode", value: "d3d11va" },
      ],
    });
  });
});

describe("the audio panel", () => {
  test("lists the audio tracks embedded first, each pressed when selected", () => {
    const section = audioSection(
      playback({
        tracks: [
          track({ id: 1, title: "Commentary", embedded: false }),
          track({ id: 2, title: "English", embedded: true, selected: true }),
        ],
      }),
    );

    expect(section.title).toBe("Tracks");
    expect(section.rows.map((held) => held.key)).toEqual(["track-audio-2", "track-audio-1"]);
    expect(row([section], "track-audio-2")).toMatchObject({
      kind: "choice",
      label: "English",
      pressed: true,
      action: { type: "set_audio_track", track: 2 },
    });
  });

  test("a Stream with no audio track says so verbatim", () => {
    const section = audioSection(playback());

    expect(section.rows).toEqual([
      {
        kind: "note",
        key: "no-audio-tracks",
        text: "This Stream carries no audio track to pick.",
      },
    ]);
  });
});

describe("the subtitles panel", () => {
  test("lists the subtitle tracks embedded first, then Subtitles off", () => {
    const sections = subtitleSections(
      playback({
        tracks: [
          track({ id: 4, kind: "subtitle", title: "Portuguese", embedded: false }),
          track({ id: 3, kind: "subtitle", title: "English", embedded: true, selected: true }),
          track({ id: 1, kind: "audio", title: "English" }),
        ],
      }),
      1,
    );
    const tracks = sections[0]!;

    expect(tracks.title).toBe("Tracks");
    expect(tracks.rows.map((held) => held.key)).toEqual([
      "track-subtitle-3",
      "track-subtitle-4",
      "subtitles-off",
    ]);
    expect(row(sections, "track-subtitle-3")).toMatchObject({
      pressed: true,
      action: { type: "set_subtitle_track", track: 3 },
    });
    expect(row(sections, "subtitles-off")).toMatchObject({
      pressed: false,
      action: { type: "set_subtitle_track", track: null },
    });
  });

  test("Subtitles off is pressed when no subtitle track is on", () => {
    const sections = subtitleSections(
      playback({ tracks: [track({ id: 3, kind: "subtitle", selected: false })] }),
      1,
    );

    expect(row(sections, "subtitles-off")).toMatchObject({ pressed: true });
  });

  test("a Stream with no subtitle track says so verbatim before Subtitles off", () => {
    const sections = subtitleSections(playback(), 1);

    expect(sections[0]!.rows.map((held) => held.key)).toEqual([
      "no-subtitle-tracks",
      "subtitles-off",
    ]);
    expect(sections[0]!.rows[0]).toMatchObject({
      kind: "note",
      text: "This Stream carries no subtitle track to pick.",
    });
  });

  test("the delay steps by a tenth, resets to zero, and is pressed at zero", () => {
    const sections = subtitleSections(playback({ subtitleDelay: 0.1 }), 1);
    const delay = sections.find((group) => group.title === "Delay · +0.1 s")!;

    expect(delay).toBeDefined();
    expect(row(sections, "subtitle-delay")).toMatchObject({
      kind: "readout",
      value: "+0.1 s",
    });
    expect(row(sections, "delay-back")).toMatchObject({
      kind: "action",
      label: "−0.1 s",
      action: { type: "set_subtitle_delay", seconds: 0 },
    });
    expect(row(sections, "delay-back")).not.toHaveProperty("pressed");
    expect(row(sections, "delay-forward")).toMatchObject({
      label: "+0.1 s",
      action: { type: "set_subtitle_delay", seconds: 0.2 },
    });
    expect(row(sections, "delay-reset")).toMatchObject({
      label: "Reset",
      pressed: false,
      action: { type: "set_subtitle_delay", seconds: 0 },
    });

    const atZero = subtitleSections(playback({ subtitleDelay: 0 }), 1);
    expect(atZero.some((group) => group.title === "Delay · 0.0 s")).toBe(true);
    expect(row(atZero, "delay-reset")).toMatchObject({ pressed: true });
    expect(row(atZero, "delay-back")).toMatchObject({
      action: { type: "set_subtitle_delay", seconds: -0.1 },
    });
  });

  test("the size readout is the Host's preference, and its buttons step the presets", () => {
    const sections = subtitleSections(playback(), 1.25);

    expect(row(sections, "subtitle-scale")).toMatchObject({
      kind: "readout",
      label: "Subtitle size 125%",
      value: "Subtitle size 125%",
    });
    expect(row(sections, "subtitle-scale-down")).toMatchObject({
      label: "Smaller subtitles",
      text: "−",
      action: { type: "set_subtitle_scale", scale: 1 },
    });
    expect(row(sections, "subtitle-scale-up")).toMatchObject({
      label: "Larger subtitles",
      text: "+",
      action: { type: "set_subtitle_scale", scale: 1.5 },
    });
  });
});

describe("the speed panel", () => {
  test("offers every preset with the one in force pressed", () => {
    const section = speedSection(playback({ speed: 1.5 }));

    expect(section.title).toBe("Playback speed");
    expect(
      section.rows.filter((held): held is ChoiceRow => held.kind === "choice").map((held) => held.label),
    ).toEqual(["0.5×", "0.75×", "1×", "1.25×", "1.5×", "2×"]);
    expect(row([section], "speed-1.5")).toMatchObject({
      kind: "choice",
      pressed: true,
      action: { type: "set_speed", rate: 1.5 },
    });
    expect(row([section], "speed-1")).toMatchObject({ pressed: false });
  });
});

describe("the chapters panel", () => {
  test("offers the steps and the container's chapters, with the one playing pressed", () => {
    const section = chaptersSection(
      playback({
        chapters: [
          { index: 0, title: "Opening", time: 0 },
          { index: 1, title: "The Choice", time: 1800 },
        ],
        chapter: 1,
      }),
    );

    expect(section.title).toBe("Chapters");
    expect(section.rows.map((held) => held.key)).toEqual([
      "previous-chapter",
      "next-chapter",
      "chapter-0",
      "chapter-1",
    ]);
    expect(row([section], "previous-chapter")).toMatchObject({
      kind: "action",
      label: "Previous chapter",
      action: { type: "previous_chapter" },
    });
    expect(row([section], "next-chapter")).toMatchObject({
      label: "Next chapter",
      action: { type: "next_chapter" },
    });
    expect(row([section], "chapter-1")).toMatchObject({
      kind: "choice",
      label: "30:00 — The Choice",
      pressed: true,
      action: { type: "set_chapter", index: 1 },
    });
    expect(row([section], "chapter-0")).toMatchObject({ pressed: false });
  });

  test("a Stream with no chapters says so verbatim", () => {
    const section = chaptersSection(playback());

    expect(section.rows).toEqual([
      {
        kind: "action",
        key: "previous-chapter",
        label: "Previous chapter",
        action: { type: "previous_chapter" },
        disabled: true,
      },
      {
        kind: "action",
        key: "next-chapter",
        label: "Next chapter",
        action: { type: "next_chapter" },
        disabled: true,
      },
      {
        kind: "note",
        key: "no-chapters",
        text: "This Stream lists no chapters.",
      },
    ]);
  });
});
