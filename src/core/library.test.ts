import { expect, test } from "vitest";

import { cardName, cardNote, progressOf, resumable } from "./library";
import type { ResumeEntry } from "./wire";

function entry(overrides: Partial<ResumeEntry> = {}): ResumeEntry {
  return {
    video: { id: "tt0133093", name: null, season: null, episode: null, thumbnail: null, airDate: null },
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
        video: { id: "tt0903747:1:2", name: "Cat's in the Bag...", season: 1, episode: 2, thumbnail: null, airDate: null },
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
