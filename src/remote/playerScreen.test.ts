import { describe, expect, test } from "vitest";

import { actionKey } from "../core/actionKey";
import { autoplayView } from "../core/autoplay";
import type { Level } from "../core/navigation";
import { playbackView } from "../core/playbackView";
import type { PlaybackSnapshot, Title } from "../core/wire";
import type { RemotePayload } from "./levels";
import {
  autoplayBanner,
  autoplaySwitch,
  cardStateNote,
  CARD_NAME,
  ENDED_NOTE,
  openingNote,
  pushesPicker,
  playerLevel,
  playerLevelStale,
  seekTo,
  setMuted,
  setVolume,
  stripControls,
  stripDrawn,
  timelineRange,
  trackFills,
  volumeRange,
} from "./playerScreen";
import { playerSheetLevel } from "./playerSheets";

/**
 * The Remote player's own decisions (#213, ADR-0035 §2).
 *
 * The playback facts are the core's and are tested there; this suite asks the
 * rules the phone's drawing adds — which two controls the strip carries, where
 * the timeline's ends are, how the read-ahead divides the track, and the one
 * Action each commit takes.
 */

function playback(overrides: Partial<PlaybackSnapshot> = {}): PlaybackSnapshot {
  return {
    state: "playing",
    autoplay: null,
    picture: "in_window",
    failure: null,
    nowPlaying: {
      video: { type: "series", id: "tt1:1:2" },
      addon: "torrentio",
      name: "Torrentio\n4k DV",
      description: null,
      filename: "episode.mkv",
      bingeGroup: null,
    },
    episode: { season: 1, episode: 2 },
    position: 300,
    duration: 600,
    buffered: { start: 300, end: 450 },
    tracks: [],
    chapters: [],
    chapter: null,
    speed: 1,
    volume: 60,
    muted: false,
    subtitleDelay: 0,
    crop: null,
    aspect: null,
    resolution: null,
    statistics: null,
    ...overrides,
  };
}

function view(overrides: Partial<PlaybackSnapshot> = {}) {
  return playbackView(playback(overrides), {
    played: 0,
    pending: new Set(),
    watchProgress: [],
  });
}

describe("the Remote's player level", () => {
  test("is the core's player level, named as the room names it", () => {
    expect(playerLevel()).toEqual({
      id: "player",
      name: CARD_NAME,
      kind: "player",
      payload: { kind: "player", title: null },
    });
    expect(CARD_NAME).toBe("Player");
  });

  test("carries the Title the strip already holds, for the Episodes plate", () => {
    const title: Title = {
      addon: "cinemeta",
      id: "tt1",
      key: { kind: "addon", addon: "cinemeta", id: "tt1" },
      type: "series",
      name: "One",
      poster: null,
      background: null,
      logo: null,
      description: null,
      releaseInfo: null,
      runtime: null,
      imdbRating: null,
      genres: [],
      videos: [],
    };

    expect(playerLevel(title).payload).toEqual({ kind: "player", title });
  });

  test("a second push replaces the card instead of stacking one", () => {
    // The id is what `pushLevel` replaces by; changing an episode opens a
    // Streams list above the card, and without the id the Stream picked there
    // would push a second identical level and one Back would leave a card on
    // screen.
    expect(playerLevel().id).toBe("player");
  });

  test("a player level is stale exactly when the Host has nothing playing", () => {
    const player = { kind: "player", title: null } as const;
    const title = {
      kind: "title",
      title: { addon: null, id: "tt1", type: "movie", name: "One" },
      answer: null,
    } as const;

    expect(playerLevelStale(player, "playing")).toBe(false);
    expect(playerLevelStale(player, "paused")).toBe(false);
    expect(playerLevelStale(player, "opening")).toBe(false);
    expect(playerLevelStale(player, "ended")).toBe(false);
    expect(playerLevelStale(player, "idle")).toBe(true);
    expect(playerLevelStale(title, "idle")).toBe(false);
  });
});

/**
 * Where the docked strip is drawn (#258, ADR-0036 §4).
 *
 * The strip points at what is playing from the screen under it, so the player's
 * own screen is the one place it steps aside. A sheet is furniture above that
 * screen, not a screen of its own, and a Streams list opened from the Episodes
 * plate is a screen again — the top screen decides, never the level beneath it.
 */
describe("the docked strip's place", () => {
  const title: Level<RemotePayload> = {
    id: "title",
    name: "Title",
    kind: "overlay",
    payload: {
      kind: "title",
      title: { addon: null, id: "tt1", type: "movie", name: "One" },
      answer: null,
    },
  };
  const card: Level<RemotePayload> = { ...playerLevel(), id: "player" };
  const sheet: Level<RemotePayload> = {
    ...playerSheetLevel("audio", null),
    id: "player-sheet",
  };
  const streams: Level<RemotePayload> = {
    id: "streams",
    name: "Streams",
    kind: "overlay",
    payload: {
      kind: "streams",
      title: {
        addon: "cinemeta",
        id: "tt1",
        key: { kind: "addon", addon: "cinemeta", id: "tt1" },
        type: "movie",
        name: "One",
        poster: null,
        background: null,
        logo: null,
        description: null,
        releaseInfo: null,
        runtime: null,
        imdbRating: null,
        genres: [],
        videos: [],
      },
      video: { id: "tt1", name: null, season: null, episode: null, thumbnail: null, airDate: null },
    },
  };

  test("is drawn on a destination and a Title, and steps aside on the player screen", () => {
    expect(stripDrawn([])).toBe(true);
    expect(stripDrawn([title])).toBe(true);
    expect(stripDrawn([card])).toBe(false);
  });

  test("stays away under the player's sheets, and returns on a screen above the card", () => {
    expect(stripDrawn([card, sheet])).toBe(false);
    expect(stripDrawn([card, streams])).toBe(true);
    expect(stripDrawn([title, streams])).toBe(true);
  });
});

describe("the docked strip's controls", () => {
  test("are the core's rewind and play/pause, with the core's own Actions", () => {
    const strip = stripControls(view());

    expect(strip.map((control) => control.id)).toEqual(["rewind", "playPause"]);
    expect(strip.map((control) => control.action)).toEqual([
      { type: "seek", target: { kind: "by", seconds: -10 } },
      { type: "set_paused", paused: true },
    ]);
    expect(strip.map((control) => control.icon)).toEqual(["rewind-10", "pause"]);
  });

  test("are disabled, and pending, exactly where the core says so", () => {
    const opening = stripControls(view({ state: "opening" }));
    expect(opening.map((control) => control.disabled)).toEqual([true, true]);

    const paused = stripControls(view({ state: "paused" }));
    expect(paused.map((control) => control.label)).toEqual([
      "Back ten seconds",
      "Play",
    ]);
  });
});

describe("the timeline's range", () => {
  test("runs the Stream's whole length, one second at a time, at the projection", () => {
    expect(timelineRange(view())).toEqual({ min: 0, max: 600, step: 1, value: 300 });
  });

  test("has a placeholder length while the Host has not said one", () => {
    expect(timelineRange(view({ duration: null }))).toMatchObject({
      max: 1,
      value: 1,
    });
    expect(timelineRange(view({ position: null }))).toMatchObject({ value: 0 });
  });

  test("keeps its value inside its own ends", () => {
    expect(timelineRange(view({ position: 900, duration: 600 }))).toMatchObject({
      value: 600,
    });
    expect(timelineRange(view({ position: -5 }))).toMatchObject({ value: 0 });
  });
});

describe("a committed seek", () => {
  test("is the core's to-Action, clamped into the Stream", () => {
    expect(seekTo(420, 600)).toEqual({
      type: "seek",
      target: { kind: "to", seconds: 420 },
    });
    expect(seekTo(-5, 600)).toEqual({
      type: "seek",
      target: { kind: "to", seconds: 0 },
    });
    expect(seekTo(900, 600)).toEqual({
      type: "seek",
      target: { kind: "to", seconds: 600 },
    });
    expect(seekTo(120, null)).toEqual({
      type: "seek",
      target: { kind: "to", seconds: 120 },
    });
  });
});

describe("the volume box", () => {
  test("starts where the Host's level is, on the Host's own 0–130 scale", () => {
    expect(volumeRange(view())).toEqual({ min: 0, max: 130, step: 1, value: 60 });
    expect(volumeRange(view({ volume: 140 }))).toMatchObject({ value: 130 });
  });

  test("sends one level, rounded and clamped", () => {
    expect(setVolume(90)).toEqual({ type: "set_volume", level: 90 });
    expect(setVolume(90.4)).toEqual({ type: "set_volume", level: 90 });
    expect(setVolume(-2)).toEqual({ type: "set_volume", level: 0 });
    expect(setVolume(200)).toEqual({ type: "set_volume", level: 130 });
  });

  test("mutes the other way, as one Action", () => {
    expect(setMuted(true)).toEqual({ type: "set_muted", muted: true });
    expect(setMuted(false)).toEqual({ type: "set_muted", muted: false });
  });
});

describe("the track's fills", () => {
  test("draw the read-ahead ahead of the playhead, and the played part before it", () => {
    expect(trackFills(0.5, { left: 0.5, width: 0.25 })).toEqual([
      { from: 0, to: 0.5, role: "played" },
      { from: 0.5, to: 0.75, role: "buffered" },
    ]);
  });

  test("draw nothing of a read-ahead the playhead has already passed", () => {
    expect(trackFills(0.5, { left: 0.1, width: 0.2 })).toEqual([
      { from: 0, to: 0.5, role: "played" },
    ]);
    expect(trackFills(0.9, { left: 0.2, width: 0.5 })).toEqual([
      { from: 0, to: 0.9, role: "played" },
    ]);
  });

  test("keep the gap between the playhead and a read-ahead that starts later", () => {
    expect(trackFills(0.4, { left: 0.6, width: 0.2 })).toEqual([
      { from: 0, to: 0.4, role: "played" },
      { from: 0.6, to: 0.8, role: "buffered" },
    ]);
  });

  test("are only the played part where the Player has no read-ahead", () => {
    expect(trackFills(0.25, null)).toEqual([{ from: 0, to: 0.25, role: "played" }]);
    expect(trackFills(0, null)).toEqual([]);
  });

  test("are clamped into the track the Player's own span names", () => {
    expect(trackFills(1.2, { left: -0.2, width: 0.4 })).toEqual([
      { from: 0, to: 1, role: "played" },
    ]);
    expect(trackFills(0.2, { left: 0.1, width: 5 })).toEqual([
      { from: 0, to: 0.2, role: "played" },
      { from: 0.2, to: 1, role: "buffered" },
    ]);
  });
});

/**
 * What the card and the strip draw of Autoplay (#318, ADR-0035 §2).
 *
 * The view and its text are the core's (`autoplayView`); the Remote decides
 * only where each part sits and which Action each control takes.
 */
describe("the Remote's Autoplay drawings", () => {
  const COUNTDOWN: PlaybackSnapshot["autoplay"] = {
    next: {
      title: { type: "series", id: "tt1" },
      video: { type: "series", id: "tt1:1:4" },
      episode: { season: 1, episode: 4 },
      name: "The Fourth",
      still: "https://images.test/4.jpg",
    },
    phase: "countdown",
    remaining: 4,
    duration: 5,
  };

  const MISSING: PlaybackSnapshot["autoplay"] = {
    next: COUNTDOWN!.next,
    phase: "no_stream",
    detail: "No Stream continues the release",
  };

  function view(
    overrides: Partial<PlaybackSnapshot> = {},
    pending: ReadonlySet<string> = new Set(),
  ) {
    const playback: PlaybackSnapshot = {
      state: "ended",
      autoplay: null,
      picture: "in_window",
      failure: null,
      nowPlaying: null,
      episode: { season: 1, episode: 3 },
      position: null,
      duration: 600,
      buffered: null,
      tracks: [],
      chapters: [],
      chapter: null,
      speed: null,
      volume: null,
      muted: null,
      subtitleDelay: 0,
      crop: null,
      aspect: null,
      resolution: null,
      statistics: null,
      ...overrides,
    };
    return playbackView(playback, { played: 0, pending, watchProgress: [] });
  }

  test("the switch row is drawn for an episode and takes the flipped preference", () => {
    expect(autoplaySwitch(view(), true)?.toggle(false)).toEqual({
      type: "set_autoplay",
      autoplay: false,
    });
    expect(autoplaySwitch(view(), false)?.toggle(true)).toEqual({
      type: "set_autoplay",
      autoplay: true,
    });
    expect(autoplaySwitch(view(), true)?.on).toBe(true);
    expect(autoplaySwitch(view(), false)?.on).toBe(false);
  });

  test("a film has no Autoplay switch", () => {
    expect(autoplaySwitch(view({ episode: null }), true)).toBeNull();
  });

  test("the banner is the countdown's, with Play now and Cancel as the Host's own Actions", () => {
    const banner = autoplayBanner(view({ autoplay: COUNTDOWN }));

    expect(banner).not.toBeNull();
    expect(banner?.kind).toBe("countdown");
    if (banner?.kind !== "countdown") {
      return;
    }
    expect(banner.kicker.text).toBe("Up next · S1E4");
    expect(banner.digit).toBe(4);
    expect(banner.next.name).toBe("The Fourth");
    expect(banner.next.still).toBe("https://images.test/4.jpg");
    expect(banner.playNow.action).toEqual({ type: "next_episode" });
    expect(banner.cancel.action).toEqual({ type: "cancel_autoplay" });
  });

  const HELD: PlaybackSnapshot["autoplay"] = {
    next: COUNTDOWN!.next,
    phase: "unattended_limit",
  };

  test("the hold's banner has Keep watching, which is the Host's next_episode, and no Cancel", () => {
    const banner = autoplayBanner(view({ autoplay: HELD }));

    expect(banner?.kind).toBe("still_watching");
    if (banner?.kind !== "still_watching") {
      return;
    }
    expect(banner.title).toBe("Still watching?");
    expect(banner.next.name).toBe("The Fourth");
    expect(banner.keepWatching.action).toEqual({ type: "next_episode" });
    expect("cancel" in banner).toBe(false);
  });

  test("Keep watching waits while the step it took is in flight", () => {
    const waiting = autoplayBanner(
      view({ autoplay: HELD }, new Set([actionKey({ type: "next_episode" })])),
    );

    expect(waiting?.kind === "still_watching" ? waiting.keepWatching.pending : null).toBe(true);
  });

  test("the card's note steps aside for the hold too", () => {
    expect(cardStateNote(view({ autoplay: HELD }))).toBeNull();
  });

  test("Play now waits while the step it took is in flight", () => {
    const idle = autoplayBanner(view({ autoplay: COUNTDOWN }));
    const waiting = autoplayBanner(
      view({ autoplay: COUNTDOWN }, new Set([actionKey({ type: "next_episode" })])),
    );

    expect(idle?.kind === "countdown" ? idle.playNow.pending : null).toBe(false);
    expect(waiting?.kind === "countdown" ? waiting.playNow.pending : null).toBe(true);
  });

  test("no countdown, no banner", () => {
    expect(autoplayBanner(view())).toBeNull();
  });

  test("the card's note is the ended one only while no countdown is up", () => {
    expect(cardStateNote(view())).toBe(ENDED_NOTE);
    expect(cardStateNote(view({ autoplay: COUNTDOWN }))).toBeNull();
    expect(cardStateNote(view({ state: "playing" }))).toBeNull();
    expect(cardStateNote(view({ state: "opening", nowPlaying: null }))).toBe(
      openingNote("a Stream"),
    );
  });

  test("a missing Stream leaves the ended note, because the Host stays on the ended state", () => {
    expect(cardStateNote(view({ autoplay: MISSING }))).toBe(ENDED_NOTE);
    expect(autoplayBanner(view({ autoplay: MISSING }))).toBeNull();
  });

  test("the Streams picker is pushed only while the Remote is on its expanded card", () => {
    const none = autoplayView({ autoplay: null }, 0);
    const missing = autoplayView({ autoplay: MISSING }, 0);

    expect(pushesPicker(none, missing, "player")).toBe(true);
    expect(pushesPicker(none, missing, null), "the Home screen").toBe(false);
    expect(pushesPicker(none, missing, "title"), "a Title").toBe(false);
    expect(pushesPicker(none, missing, "grid"), "a browse grid").toBe(false);
    expect(pushesPicker(none, missing, "settings"), "Settings").toBe(false);
    expect(pushesPicker(none, missing, "sheet"), "a plate over the card").toBe(false);
    expect(pushesPicker(none, missing, "streams"), "a list already open").toBe(false);
    expect(pushesPicker(missing, missing, "player"), "once per target").toBe(false);
  });

  test("the strip's two transport cells do not change during a countdown", () => {
    const during = stripControls(view({ autoplay: COUNTDOWN })).map((control) => [
      control.id,
      control.action,
    ]);
    const plain = stripControls(view()).map((control) => [control.id, control.action]);

    expect(during).toEqual(plain);
  });
});
