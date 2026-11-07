import { describe, expect, test } from "vitest";

import { decideRevision } from "./revision";
import type { Title } from "./wire";

/**
 * What a Title screen does with a revised Answer (ADR-0038 §2).
 *
 * The decision is a pure function because it is the same on both clients: a
 * revision is the Title the screen is still showing, or it is ignored. The
 * drawing is the screens' business; this is the rule they are drawn from.
 */

function title(overrides: Partial<Title> = {}): Title {
  return {
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
    ...overrides,
  };
}

describe("a revised Title against the Title on screen", () => {
  test("the Title still open is replaced by its revision", () => {
    const open = title();
    const revised = title({ name: "One, again", videos: [] });

    expect(decideRevision(open, revised)).toEqual({
      kind: "replace",
      title: revised,
    });
  });

  test("a revision for another Title is ignored", () => {
    expect(decideRevision(title(), title({ id: "tt2" }))).toEqual({
      kind: "ignore",
    });
    expect(decideRevision(title(), title({ type: "series" }))).toEqual({
      kind: "ignore",
    });
  });

  test("a revision landing with nothing open is ignored", () => {
    expect(decideRevision(null, title())).toEqual({ kind: "ignore" });
  });

  test("a Title is the same Title under the id its card carries", () => {
    // The id, not the name or the art, is the identity: a refresh that renamed
    // the Title still replaces it, and one for a different id never does.
    const open = title({ id: "tmdb:603", name: "The Matrix" });
    const revised = title({ id: "tmdb:603", name: "The Matrix (1999)" });

    expect(decideRevision(open, revised)).toMatchObject({ kind: "replace" });
  });
});
