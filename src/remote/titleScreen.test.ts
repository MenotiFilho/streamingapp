import { describe, expect, test } from "vitest";

import type { Title, Video } from "../core/wire";
import { titleLevel, type RemoteTitle } from "./levels";
import {
  answeredTitleLevel,
  cardPreviewOf,
  streamsLevelFor,
  titleOpenAction,
} from "./titleScreen";

/**
 * The Title level's decisions (#210, ADR-0035 §1, ADR-0032).
 *
 * Which of the Host's two Title questions a card names, the fallback a card
 * gives a sparse answer, and the two levels a Title pushes. The drawing is the
 * component test's; these are the decisions it is drawn from.
 */

const ADDON_CARD: RemoteTitle = {
  addon: "cinemeta",
  id: "tt1",
  type: "movie",
  name: "One",
};

const DISCOVERED_CARD: RemoteTitle = {
  addon: null,
  id: "tmdb:603",
  type: "movie",
  name: "The Matrix",
};

const TITLE: Title = {
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
};

const VIDEO: Video = {
  id: "tt1",
  name: null,
  season: null,
  episode: null,
  thumbnail: null,
};

describe("what a card asks the Host", () => {
  test("an Addon's card asks open_title by the Addon that answered its row", () => {
    expect(titleOpenAction(ADDON_CARD)).toEqual({
      type: "open_title",
      addon: "cinemeta",
      title: { type: "movie", id: "tt1" },
    });
  });

  test("a Discovered card asks open_discovered_title with the core's TMDB key", () => {
    expect(titleOpenAction(DISCOVERED_CARD)).toEqual({
      type: "open_discovered_title",
      key: { kind: "tmdb", id: 603 },
      kind: "movie",
    });
  });

  test("a card with no Addon and no TMDB id names no question, so nothing is sent", () => {
    expect(
      titleOpenAction({ addon: null, id: "tt1", type: "movie", name: "One" }),
    ).toBeNull();
  });
});

describe("the fallback a card gives a sparse answer", () => {
  test("the name a person saw, and no art the card does not carry", () => {
    expect(cardPreviewOf(ADDON_CARD)).toEqual({ name: "One", poster: null });
  });
});

describe("the levels a Title pushes", () => {
  test("an answer replaces the level it was asked on, by the same id", () => {
    expect(answeredTitleLevel(ADDON_CARD, TITLE, "level-7")).toEqual({
      id: "level-7",
      name: "Title",
      kind: "overlay",
      payload: { kind: "title", title: ADDON_CARD, answer: TITLE },
    });
  });

  test("a Play pushes Streams with the answered Title and the Video", () => {
    expect(streamsLevelFor(TITLE, VIDEO)).toEqual({
      name: "Streams",
      kind: "overlay",
      payload: { kind: "streams", title: TITLE, video: VIDEO },
    });
  });

  test("the level a card pushes starts with nothing answered", () => {
    expect(titleLevel(ADDON_CARD).payload).toEqual({
      kind: "title",
      title: ADDON_CARD,
      answer: null,
    });
  });
});
