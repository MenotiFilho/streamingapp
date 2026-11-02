import { describe, expect, it } from "vitest";

import { ICON_NAMES } from "./icons";

/**
 * The set design record §7 locks: the six destinations, More, back, close,
 * previous episode, next episode, −10s, +10s, play, pause, stop, fullscreen,
 * volume, volume muted, picture, subtitles, audio, speed, chapters, episodes
 * and the chevron. A mark added or removed is a decision, so it is asserted
 * here.
 */
const DOCUMENTED = [
  "home",
  "discover",
  "search",
  "library",
  "addons",
  "settings",
  "more",
  "back",
  "close",
  "previous-episode",
  "next-episode",
  "rewind-10",
  "forward-10",
  "play",
  "pause",
  "stop",
  "fullscreen",
  "volume",
  "volume-muted",
  "picture",
  "subtitles",
  "audio",
  "speed",
  "chapters",
  "episodes",
  "chevron",
];

describe("the drawn icon set", () => {
  it("is exactly the documented set, and no mark is named twice", () => {
    expect([...ICON_NAMES].sort()).toEqual([...DOCUMENTED].sort());
    expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length);
  });
});
