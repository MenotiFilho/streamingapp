import { describe, expect, test } from "vitest";

import { actionKey } from "../core/actionKey";
import { autoplayView } from "../core/autoplay";
import type { Level } from "../core/navigation";
import { playbackView } from "../core/playbackView";
import { torrentLine } from "../core/torrentStatus";
import { STALLED_NOTE, STALLED_STRIP_NOTE } from "../core/stall";
import type { PlaybackSnapshot, Title } from "../core/wire";
import type { RemotePayload } from "./levels";
import {
  autoplayBanner,
  autoplaySwitch,
  cardStateNote,
  cardTorrentLine,
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
  stripNote,
  failedOpen,
  playingTitle,
  stripLine,
  timeLeft,
} from "./playerScreen";
import { playerSheetLevel } from "./playerSheets";

/**
 * The Remote player's own decisions (#213, ADR-0035 §2).
 *
 * The playback facts are the core's and are tested there; this suite asks the
 * rules the phone's drawing adds — which two controls the strip carries, what
 * its line reads, which Title art names what is playing, when a failed open
 * keeps the Remote up, and the one Action each commit takes.
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
    stalled: false,
    torrent: null,
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
    ...playerSheetLevel("subtitles", null),
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
  test("sends one level, rounded and clamped to the Host's 0–130 scale", () => {
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

describe("a failed open", () => {
  const FAILED = playback({ state: "idle", failure: "403 Forbidden" });

  test("is the Host's reason while it is idle on a Stream", () => {
    expect(failedOpen(FAILED)).toBe("403 Forbidden");
  });

  test("is nothing once Stop cleared it, while playing, or with no playback", () => {
    expect(failedOpen(playback({ state: "idle", failure: null }))).toBeNull();
    expect(failedOpen(playback({ state: "idle", failure: "x", nowPlaying: null }))).toBeNull();
    expect(failedOpen(playback({ state: "playing", failure: "x" }))).toBeNull();
    expect(failedOpen(null)).toBeNull();
  });

  test("keeps the player level, which any other idle drops", () => {
    const player = { kind: "player", title: null } as const;

    expect(playerLevelStale(player, "idle", true)).toBe(false);
    expect(playerLevelStale(player, "idle", false)).toBe(true);
  });
});

describe("the strip's line", () => {
  test("is the episode and the time left", () => {
    expect(stripLine(view(), false)).toBe("S1 E2 · 5 min left");
    expect(stripLine(view({ episode: null }), false)).toBe("5 min left");
  });

  test("gives the time left up to the wait and to the picture note", () => {
    expect(stripLine(view({ stalled: true }), true)).toBe(`S1 E2 · ${STALLED_STRIP_NOTE}`);
    expect(stripLine(view({ stalled: true }), false)).toBe("S1 E2 · 5 min left");
    const elsewhere = view({ picture: "nowhere" });
    expect(stripLine(elsewhere, false)).toBe(`S1 E2 · ${elsewhere.pictureNote}`);
  });

  test("is Autoplay's own words while the Host counts down", () => {
    const counting = view({
      state: "ended",
      autoplay: {
        next: {
          title: { type: "series", id: "tt1" },
          video: { type: "series", id: "tt1:1:3" },
          episode: { season: 1, episode: 3 },
          name: null,
          still: null,
        },
        phase: "countdown",
        remaining: 4,
        duration: 5,
      },
    });

    expect(stripLine(counting, false)).toBe("Up next in 4 · S1E3");
  });

  test("falls back to the core's episode label where nothing else is known", () => {
    expect(stripLine(view({ episode: null, duration: null }), false)).toBe("Feature");
  });

  test("counts whole minutes, at least one, and none past the end", () => {
    expect(timeLeft(0, 600)).toBe("10 min left");
    expect(timeLeft(590, 600)).toBe("1 min left");
    expect(timeLeft(600, 600)).toBeNull();
    expect(timeLeft(null, 600)).toBeNull();
    expect(timeLeft(10, null)).toBeNull();
  });
});

describe("the Title naming what is playing", () => {
  const PROGRESS = {
    video: {
      id: "tt1:1:2",
      name: "The Choice",
      season: 1,
      episode: 2,
      thumbnail: "https://images.test/frame.jpg",
      airDate: null,
      description: "An episode.",
    },
    title: {
      addon: "cinemeta",
      id: "tt1",
      type: "series",
      name: "One",
      poster: "https://images.test/poster.jpg",
      background: "https://images.test/back.jpg",
    },
    position: 300,
    duration: 600,
    watched: false,
    unplayable: null,
  };
  const held: Title = {
    addon: "cinemeta",
    id: "tt1",
    key: { kind: "addon", addon: "cinemeta", id: "tt1" },
    type: "series",
    name: "Held One",
    poster: "https://images.test/held.jpg",
    background: null,
    logo: null,
    description: "A series.",
    releaseInfo: null,
    runtime: null,
    imdbRating: null,
    genres: [],
    videos: [
      {
        id: "tt1:1:2",
        name: "Held name",
        season: 1,
        episode: 2,
        thumbnail: null,
        airDate: null,
        description: "Held episode.",
      },
    ],
  };

  test("is Watch progress's Title, with its poster and never a frame", () => {
    expect(playingTitle(playback(), [PROGRESS], held)).toEqual({
      id: "tt1",
      name: "One",
      episode: "S1 E2 · The Choice",
      description: "An episode.",
      poster: "https://images.test/poster.jpg",
      backdrop: "https://images.test/back.jpg",
    });
  });

  test("is filled by the held Title that is playing, and by its poster as backdrop", () => {
    expect(playingTitle(playback(), [], held)).toEqual({
      id: "tt1",
      name: "Held One",
      episode: "S1 E2 · Held name",
      description: "Held episode.",
      poster: "https://images.test/held.jpg",
      backdrop: "https://images.test/held.jpg",
    });
  });

  test("takes nothing from a held Title that is not the one playing", () => {
    const other = { ...held, id: "tt2", videos: [] };

    expect(playingTitle(playback(), [], other)).toMatchObject({
      id: null,
      poster: null,
      backdrop: null,
      description: null,
    });
  });

  test("is a film's own description, with no episode line", () => {
    const film = { ...held, id: "tt9", type: "movie", videos: [] };
    const watching = playback({
      episode: null,
      nowPlaying: { ...playback().nowPlaying!, video: { type: "movie", id: "tt9" } },
    });

    expect(playingTitle(watching, [], film)).toMatchObject({
      episode: null,
      description: "A series.",
    });
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
      stalled: false,
      torrent: null,
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

  test("a Stalled Stream's card says it waits, but only once the stall is shown", () => {
    const stalled = view({ state: "playing", stalled: true });

    expect(cardStateNote(stalled, false)).toBeNull();
    expect(cardStateNote(stalled)).toBeNull();
    expect(cardStateNote(stalled, true)).toBe(STALLED_NOTE);
    expect(STALLED_NOTE).toBe("Waiting for the Stream…");
  });

  test("a shown stall is never a note for a Stream that is not stalled", () => {
    expect(cardStateNote(view({ state: "playing", stalled: false }), true)).toBeNull();
  });

  describe("the card's torrent line", () => {
    const FINDING = { phase: "finding", peers: 5, rate: 0 } as const;
    const FETCHING = { phase: "fetching", peers: 3, rate: 180_000 } as const;

    test("rides under the opening note of a torrent, in the core's words", () => {
      const opening = view({ state: "opening", torrent: FINDING });

      expect(cardStateNote(opening)).not.toBeNull();
      expect(cardTorrentLine(opening)).toBe(torrentLine(FINDING));
      expect(cardTorrentLine(opening)).toBe("Finding the torrent · 5 peers");
    });

    test("rides under the Stalled note of a torrent, but only once the stall is shown", () => {
      const stalled = view({ state: "playing", stalled: true, torrent: FETCHING });

      expect(cardTorrentLine(stalled, false)).toBeNull();
      expect(cardTorrentLine(stalled)).toBeNull();
      expect(cardTorrentLine(stalled, true)).toBe(torrentLine(FETCHING));
    });

    test("is never drawn for a direct Stream, opening or Stalled", () => {
      expect(cardTorrentLine(view({ state: "opening", torrent: null }))).toBeNull();
      expect(
        cardTorrentLine(view({ state: "playing", stalled: true, torrent: null }), true),
      ).toBeNull();
    });

    test("is not drawn where the card has no state note to put it under", () => {
      expect(cardTorrentLine(view({ state: "playing", torrent: FETCHING }), true)).toBeNull();
      expect(cardTorrentLine(view({ state: "ended", torrent: FETCHING }), true)).toBeNull();
    });

    test("never reaches the docked strip, which stays Waiting…", () => {
      const stalled = view({ state: "playing", stalled: true, torrent: FETCHING });

      expect(stripNote(stalled, true)).toBe(STALLED_STRIP_NOTE);
    });
  });

  test("the docked strip says Waiting… while a shown stall holds the Stream", () => {
    const stalled = view({ state: "playing", stalled: true });

    expect(stripNote(stalled, true)).toBe(STALLED_STRIP_NOTE);
    expect(STALLED_STRIP_NOTE).toBe("Waiting…");
    expect(stripNote(stalled, false)).toBeNull();
  });

  test("the strip's picture note stays, with the wait ahead of it", () => {
    const elsewhere = view({ state: "playing", stalled: true, picture: "own_window" });

    expect(stripNote(view({ state: "playing", picture: "own_window" }), false)).toBe(
      elsewhere.pictureNote,
    );
    expect(stripNote(elsewhere, true)).toBe(`${STALLED_STRIP_NOTE} · ${elsewhere.pictureNote}`);
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
    expect(pushesPicker(none, missing, "addon-details"), "Addon details").toBe(false);
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
