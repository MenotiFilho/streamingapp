import { expect, test } from "vitest";

import { cardName, cardNote, progressOf, resumable } from "./library";
import type { ContinueEntry } from "./wire";

function entry(overrides: Partial<ContinueEntry> = {}): ContinueEntry {
  return {
    video: { id: "tt0133093", name: null, season: null, episode: null, thumbnail: null },
    title: {
      addon: "com.linvo.cinemeta",
      id: "tt0133093",
      type: "movie",
      name: "The Matrix",
      poster: null,
    },
    position: 1284,
    duration: 8160,
    watched: false,
    upNext: false,
    unplayable: null,
    ...overrides,
  };
}

test("how far through a Video is a fraction of the length the Host stated", () => {
  expect(progressOf(entry({ position: 0, duration: 100 }))).toBe(0);
  expect(progressOf(entry({ position: 25, duration: 100 }))).toBe(0.25);
  expect(
    progressOf(entry({ position: 200, duration: 100 })),
    "a position past the end is still the whole thing",
  ).toBe(1);

  expect(
    progressOf(entry({ position: null })),
    "a Stream that has not started has no fraction",
  ).toBeNull();
  expect(
    progressOf(entry({ duration: null })),
    "a Stream that never said how long it is has none either",
  ).toBeNull();
  expect(progressOf(entry({ duration: 0 }))).toBeNull();
});

test("an entry whose Addon is gone is not one the Host will play", () => {
  expect(resumable(entry())).toBe(true);
  expect(
    resumable(entry({ unplayable: { reason: "addon_removed", addon: "community.gone" } })),
  ).toBe(false);
});

test("a card is named by its Title, and by the episode where the Video is one", () => {
  expect(cardName(entry())).toBe("The Matrix");
  expect(
    cardName(
      entry({
        video: { id: "tt0903747:1:2", name: "Cat's in the Bag...", season: 1, episode: 2, thumbnail: null },
        title: {
          addon: "com.linvo.cinemeta",
          id: "tt0903747",
          type: "series",
          name: "Breaking Bad",
          poster: null,
        },
      }),
    ),
  ).toBe("Breaking Bad — S1E2");
});

test("a card says how much is left, or that it is done, or why it cannot be played", () => {
  expect(cardNote(entry({ position: 1284, duration: 8160 }))).toBe("1:54:36 left");
  expect(cardNote(entry({ position: null }))).toBe("Not started yet");
  expect(
    cardNote(entry({ position: 600, duration: null })),
    "a live Stream has a position and no length to subtract from",
  ).toBe("10:00 in");
  expect(cardNote(entry({ watched: true }))).toBe("Watched");
  expect(
    cardNote(entry({ unplayable: { reason: "addon_removed", addon: "community.gone" } })),
    "the reason a stub is unplayable is what its card has to say",
  ).toBe("Unplayable — the Addon community.gone that supplied this Title is gone.");
});

test("an Up next with no progress says what it is, with no progress bar", () => {
  const next = entry({
    video: { id: "tt0903747:1:4", name: null, season: 1, episode: 4, thumbnail: null },
    title: {
      addon: "com.linvo.cinemeta",
      id: "tt0903747",
      type: "series",
      name: "Breaking Bad",
      poster: null,
    },
    position: null,
    duration: null,
    watched: false,
    upNext: true,
  });

  expect(cardNote(next)).toBe("Up next · S1E4");
  expect(
    progressOf(next),
    "an Up next that was never started has no progress bar",
  ).toBeNull();
});

test("an Up next already partly watched reads like any other card", () => {
  const started = entry({
    video: { id: "tt0903747:1:4", name: null, season: 1, episode: 4, thumbnail: null },
    title: {
      addon: "com.linvo.cinemeta",
      id: "tt0903747",
      type: "series",
      name: "Breaking Bad",
      poster: null,
    },
    position: 600,
    duration: 2820,
    upNext: true,
  });

  expect(cardNote(started)).toBe("37:00 left");
  expect(progressOf(started)).toBeCloseTo(600 / 2820);
});
