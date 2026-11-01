import { describe, expect, test } from "vitest";

import type { ActionError } from "../core/errors";
import type { AddonManifest, Library, LibraryEntry } from "../core/wire";
import { titleLevelOf } from "./levels";
import {
  LIBRARY_EMPTY,
  LIBRARY_SETTINGS_CONTROL,
  SIGNED_OUT,
  libraryCards,
  libraryFailure,
  libraryFailureCopy,
  libraryPhase,
} from "./libraryScreen";

/**
 * The Library screen's own decisions (#208, ADR-0032).
 *
 * The four states, the failure that is a way back in rather than an empty
 * Library, the signed-out offer that is a destination change, and the card that
 * opens only where an Addon answers it. Nothing here draws; the component test
 * reads the boundary.
 */

const CINEMETA: AddonManifest = {
  id: "cinemeta",
  name: "Cinemeta",
  version: "3.0.14",
  resources: [{ name: "meta", types: ["movie", "series"], idPrefixes: ["tt"] }],
  types: ["movie", "series"],
  catalogs: [],
  idPrefixes: ["tt"],
  behaviorHints: { configurable: false, configurationRequired: false },
};

const TORRENTIO: AddonManifest = {
  ...CINEMETA,
  id: "torrentio",
  resources: [{ name: "stream", types: ["movie", "series"], idPrefixes: ["tt"] }],
};

function entry(overrides: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
    id: "tt0133093",
    name: "The Matrix",
    type: "movie",
    poster: "https://images.test/matrix.jpg",
    posterShape: "poster",
    mtime: 1_700_000_000_000,
    videoId: null,
    position: null,
    duration: null,
    continueWatching: false,
    ...overrides,
  };
}

function library(entries: LibraryEntry[], failure: ActionError | null = null): Library {
  return { entries, failure };
}

const EXPIRED: ActionError = {
  kind: "library",
  detail: "Stremio refused the request: Session does not exist",
};

const UNREACHABLE: ActionError = {
  kind: "library",
  detail: "Stremio did not answer",
};

describe("the Library's four states", () => {
  test("a read still in flight is reading, and so is the first paint before one", () => {
    expect(libraryPhase(null, null, true)).toBe("reading");
    expect(
      libraryPhase(null, null, false),
      "no answer yet is a wait, never an empty account",
    ).toBe("reading");
  });

  test("an account with nothing saved is the empty state, not a failure", () => {
    expect(libraryPhase(library([]), null, false)).toBe("empty");
    expect(libraryPhase(library([]), null, true), "the retry's wait wins").toBe("reading");
  });

  test("entries are the list", () => {
    expect(libraryPhase(library([entry()]), null, false)).toBe("list");
  });

  test("a failure is a failure whether the link refused or the answer carried it", () => {
    expect(libraryFailure(null, UNREACHABLE)).toEqual(UNREACHABLE);
    expect(libraryFailure(library([], UNREACHABLE), null)).toEqual(UNREACHABLE);
    expect(libraryFailure(library([]), null)).toBeNull();
    expect(libraryPhase(library([], UNREACHABLE), null, false)).toBe("failure");
    expect(
      libraryPhase(library([entry()], UNREACHABLE), null, false),
      "an answer that names a failure never draws a list over it",
    ).toBe("failure");
  });
});

describe("the Library's way out of a failure", () => {
  test("an expired session says how to read again, and its control is Settings", () => {
    const copy = libraryFailureCopy(EXPIRED);
    expect(copy.control).toBe("settings");
    expect(copy.note).toContain("Settings");
  });

  test("any other failure offers the retry, and no second explanation over the Host's", () => {
    const copy = libraryFailureCopy(UNREACHABLE);
    expect(copy.control).toBe("retry");
    expect(copy.note).toBeNull();
  });
});

describe("the Library's signed-out offer", () => {
  test("says where the account is linked, because sign-in is Settings' form (B7)", () => {
    expect(SIGNED_OUT.body).toContain("Settings");
    expect(SIGNED_OUT.control).toBe(LIBRARY_SETTINGS_CONTROL);
  });

  test("the empty account says what the room will hold", () => {
    expect(LIBRARY_EMPTY.title.length).toBeGreaterThan(0);
    expect(LIBRARY_EMPTY.body).toContain("Stremio");
  });
});

describe("the Library's cards", () => {
  test("an entry opens through the Addon whose meta resource answers it", () => {
    const [card] = libraryCards([TORRENTIO, CINEMETA], [entry()]);
    expect(card?.openable).toBe(true);
    expect(card?.level).toEqual(
      titleLevelOf("cinemeta", {
        id: "tt0133093",
        type: "movie",
        name: "The Matrix",
      }),
    );
  });

  test("an entry no Addon answers is a still with the Unplayable mark, not a press", () => {
    const [card] = libraryCards([TORRENTIO], [entry()]);
    expect(card?.openable).toBe(false);
    expect(card?.level).toBeNull();
  });

  test("the Continue mark is the account entry's own, carried without arithmetic", () => {
    const [marked, plain] = libraryCards(
      [CINEMETA],
      [
        entry({ id: "tt0133093", continueWatching: true }),
        entry({ id: "tt0234215", continueWatching: false }),
      ],
    );
    expect(marked?.continueWatching).toBe(true);
    expect(plain?.continueWatching).toBe(false);
  });
});
