import { describe, expect, test } from "vitest";

import { LANGUAGES } from "./languages";
import {
  THREE_CHOSEN_NOTE,
  chips,
  down,
  dropIndex,
  languagesAction,
  move,
  remove,
  rows,
  tick,
  untick,
  up,
} from "./languageList";

describe("ticking and unticking a language", () => {
  test("a tick appends to the end of the list, so the first tick is the most wanted", () => {
    expect(tick([], "pt-BR")).toEqual(["pt-BR"]);
    expect(tick(["pt-BR"], "en")).toEqual(["pt-BR", "en"]);
  });

  test("a tick at three is a no-op, and so is a tick of a language already chosen", () => {
    expect(tick(["pt-BR", "en", "fr"], "de")).toBeNull();
    expect(tick(["pt-BR", "en"], "pt-BR")).toBeNull();
    // The Host compares tags without case, so a client never sends the clash.
    expect(tick(["pt-BR"], "PT-br")).toBeNull();
  });

  test("an untick closes up the gap and keeps the order of the rest", () => {
    expect(untick(["pt-BR", "en", "fr"], "en")).toEqual(["pt-BR", "fr"]);
    expect(untick(["pt-BR"], "pt-BR")).toEqual([]);
  });

  test("unticking a language that is not chosen changes nothing", () => {
    expect(untick(["pt-BR"], "en")).toBeNull();
  });

  test("removing a chip closes up the gap, and a rank that is not there changes nothing", () => {
    expect(remove(["pt-BR", "en", "fr"], 0)).toEqual(["en", "fr"]);
    expect(remove(["pt-BR", "en", "fr"], 2)).toEqual(["pt-BR", "en"]);
    expect(remove(["pt-BR"], 1)).toBeNull();
    expect(remove(["pt-BR"], -1)).toBeNull();
  });

  test("an operation never changes the list it was given", () => {
    const held = ["pt-BR", "en"];
    tick(held, "fr");
    untick(held, "en");
    remove(held, 0);
    move(held, 0, 1);
    expect(held).toEqual(["pt-BR", "en"]);
  });
});

describe("moving a language in rank", () => {
  test("a move takes one entry to another rank and the rest keep their order", () => {
    expect(move(["pt-BR", "en", "fr"], 2, 0)).toEqual(["fr", "pt-BR", "en"]);
    expect(move(["pt-BR", "en", "fr"], 0, 2)).toEqual(["en", "fr", "pt-BR"]);
  });

  test("a move to where it already is, or off either end, changes nothing", () => {
    expect(move(["pt-BR", "en"], 1, 1)).toBeNull();
    expect(move(["pt-BR", "en"], 0, 2)).toBeNull();
    expect(move(["pt-BR", "en"], -1, 0)).toBeNull();
    expect(move([], 0, 0)).toBeNull();
  });

  test("up and down are one-rank moves, and the ends of the list are walls", () => {
    expect(up(["pt-BR", "en", "fr"], 1)).toEqual(["en", "pt-BR", "fr"]);
    expect(down(["pt-BR", "en", "fr"], 1)).toEqual(["pt-BR", "fr", "en"]);
    expect(up(["pt-BR", "en"], 0)).toBeNull();
    expect(down(["pt-BR", "en"], 1)).toBeNull();
  });
});

describe("the chips a list draws", () => {
  test("each chip carries its rank from one, its name, and where it sits in the list", () => {
    expect(chips(["pt-BR", "en"])).toEqual([
      { tag: "pt-BR", name: "Português (Brasil)", rank: 1, index: 0 },
      { tag: "en", name: "English", rank: 2, index: 1 },
    ]);
  });

  test("an empty list draws no chip", () => {
    expect(chips([])).toEqual([]);
  });

  test("a tag the curated list does not name is still a chip, called Other", () => {
    expect(chips(["fr-CA"])[0]).toMatchObject({ tag: "fr-CA", name: "Other (fr-CA)" });
  });
});

describe("the drawer's rows", () => {
  test("Chosen lists the chosen languages in rank with ordinals, the rest follow in curated order", () => {
    const view = rows(["es-419", "en"]);

    expect(view.chosen.map((row) => [row.tag, row.ordinal])).toEqual([
      ["es-419", "1st"],
      ["en", "2nd"],
    ]);
    const restTags = view.rest.map((row) => row.tag);
    expect(restTags).toEqual(
      LANGUAGES.map((language) => language.tag).filter(
        (tag) => tag !== "es-419" && tag !== "en",
      ),
    );
    expect(view.rest.every((row) => row.ordinal === null)).toBe(true);
    expect(view.note).toBeNull();
  });

  test("a chosen row can move up unless it is first and down unless it is last", () => {
    const view = rows(["pt-BR", "en", "fr"]);

    expect(view.chosen.map((row) => [row.canUp, row.canDown])).toEqual([
      [false, true],
      [true, true],
      [true, false],
    ]);
    expect(view.chosen.map((row) => row.index)).toEqual([0, 1, 2]);
  });

  test("at three the rows left in Languages are disabled and the note says to untick one", () => {
    const view = rows(["pt-BR", "en", "fr"]);

    expect(THREE_CHOSEN_NOTE).toBe("Three chosen. Untick one to choose another.");
    expect(view.note).toBe(THREE_CHOSEN_NOTE);
    expect(view.rest.length).toBeGreaterThan(0);
    expect(view.rest.every((row) => row.disabled)).toBe(true);
    // A chosen row stays reachable: it is how a person unticks it.
    expect(view.chosen.every((row) => !row.disabled)).toBe(true);
  });

  test("below three no row is disabled", () => {
    const view = rows(["pt-BR", "en"]);

    expect(view.rest.some((row) => row.disabled)).toBe(false);
  });

  test("an empty list has no Chosen group and every language to choose from", () => {
    const view = rows([]);

    expect(view.chosen).toEqual([]);
    expect(view.rest).toHaveLength(LANGUAGES.length);
  });

  test("an unknown stored tag heads Chosen, can be removed, and is never offered to tick again", () => {
    const view = rows(["fr-CA", "en"]);

    expect(view.chosen[0]).toMatchObject({
      tag: "fr-CA",
      name: "Other (fr-CA)",
      ordinal: "1st",
      known: false,
    });
    expect(view.rest.map((row) => row.tag)).not.toContain("fr-CA");
    expect(untick(["fr-CA", "en"], "fr-CA")).toEqual(["en"]);
    expect(remove(["fr-CA", "en"], 0)).toEqual(["en"]);
    // Once removed it is gone from the list, and nothing in Languages brings it back.
    expect(rows(["en"]).rest.map((row) => row.tag)).not.toContain("fr-CA");
  });

  test("an unknown tag still counts toward the three", () => {
    const view = rows(["fr-CA", "en", "fr"]);

    expect(view.note).toBe(THREE_CHOSEN_NOTE);
    expect(view.rest.every((row) => row.disabled)).toBe(true);
  });
});

describe("where a dragged chip is dropped", () => {
  // Three chips on a line, 100px wide with a 10px gap.
  const line = [
    { x: 0, y: 0, w: 100, h: 40 },
    { x: 110, y: 0, w: 100, h: 40 },
    { x: 220, y: 0, w: 100, h: 40 },
  ];

  test("a drop over a chip lands on that chip's rank", () => {
    expect(dropIndex(line, { x: 150, y: 20 }, 0)).toBe(1);
    expect(dropIndex(line, { x: 10, y: 20 }, 2)).toBe(0);
  });

  test("a drop over the chip it left is that same rank, which moves nothing", () => {
    expect(dropIndex(line, { x: 50, y: 20 }, 0)).toBe(0);
    expect(move(["pt-BR", "en", "fr"], 0, dropIndex(line, { x: 50, y: 20 }, 0))).toBeNull();
  });

  test("a drop in a gap or past the end lands on the nearest chip", () => {
    expect(dropIndex(line, { x: 108, y: 20 }, 0)).toBe(1);
    expect(dropIndex(line, { x: 900, y: 20 }, 0)).toBe(2);
    expect(dropIndex(line, { x: -50, y: 20 }, 2)).toBe(0);
  });

  test("chips that wrap onto a second line are told apart by the line too", () => {
    const wrapped = [
      { x: 0, y: 0, w: 100, h: 40 },
      { x: 110, y: 0, w: 100, h: 40 },
      { x: 0, y: 50, w: 100, h: 40 },
    ];

    expect(dropIndex(wrapped, { x: 40, y: 70 }, 0)).toBe(2);
  });

  test("with no chip to land on a drop stays where it started", () => {
    expect(dropIndex([], { x: 10, y: 10 }, 0)).toBe(0);
  });
});

describe("the Action a list change sends", () => {
  test("each list sends its whole self through its own Action, and an empty list clears it", () => {
    expect(languagesAction("subtitle", ["pt-BR", "en"])).toEqual({
      type: "set_subtitle_languages",
      languages: ["pt-BR", "en"],
    });
    expect(languagesAction("audio", [])).toEqual({
      type: "set_audio_languages",
      languages: [],
    });
  });
});
