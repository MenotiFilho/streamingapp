import { describe, expect, test } from "vitest";

import {
  HOST_PICKS_PER_VIDEO,
  SUBTITLE_LANGUAGES,
  subtitleLanguageName,
} from "./languages";

describe("the curated subtitle-language list", () => {
  test("every tag is unique and every language has a name", () => {
    const tags = SUBTITLE_LANGUAGES.map((language) => language.tag);
    expect(new Set(tags).size).toBe(tags.length);
    expect(SUBTITLE_LANGUAGES.every((language) => language.name.length > 0)).toBe(true);
    expect(SUBTITLE_LANGUAGES.length).toBeGreaterThan(10);
  });

  test("a known tag reads as its language, and an unknown one stands as itself", () => {
    expect(subtitleLanguageName("pt-BR")).toBe("Português (Brasil)");
    expect(subtitleLanguageName("xx")).toBe("xx");
    expect(HOST_PICKS_PER_VIDEO).toBe("Host picks per Video");
  });
});
